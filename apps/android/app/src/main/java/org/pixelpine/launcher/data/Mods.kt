package org.pixelpine.launcher.data

import android.os.Build
import android.os.Environment
import java.io.File
import java.util.zip.ZipFile

/**
 * 已安装的一个 Mod。字段刻意和桌面端 `ppl_core::library::LocalMod` 对齐：
 * 两端的「启用/停用」都是把条目在 `units/` 与 `units/.disabled/` 之间移动，
 * 冲突判定都用「同名单位目录」，这样同一套判断在两边给出的结论一致。
 */
data class LocalMod(
    val name: String,
    val title: String,
    val path: String,
    val packaged: Boolean,
    val size: Long,
    val files: Int,
    val modified: Long,
    val unitCount: Int,
    val unitDirs: List<String>,
    val enabled: Boolean,
)

/** 两个 Mod 含同名单位目录：后加载的会覆盖先加载的。 */
data class ModConflict(val name: String, val with: String, val dirs: List<String>)

object Mods {
    /** 游戏不读点开头的目录，所以停用 = 移进这里，随时可逆。 */
    const val DISABLED_DIR = ".disabled"

    /** 扫描启用与停用两部分。 */
    fun scan(unitsDir: String): List<LocalMod> {
        val root = File(unitsDir)
        val list = ArrayList<LocalMod>()
        list.addAll(scanOne(root, enabled = true))
        list.addAll(scanOne(File(root, DISABLED_DIR), enabled = false))
        return list.sortedWith(compareBy({ it.title.lowercase() }, { !it.enabled }))
    }

    private fun scanOne(dir: File, enabled: Boolean): List<LocalMod> {
        if (!dir.isDirectory) return emptyList()
        val files = dir.listFiles() ?: return emptyList()
        val result = ArrayList<LocalMod>()
        for (file in files) {
            val name = file.name
            // `.disabled` 自己、macOS 的 __MACOSX、.DS_Store 都不算资源
            if (name.startsWith(".") || name.equals("__MACOSX", ignoreCase = true)) continue

            if (file.isDirectory) {
                result.add(folder(name, file, enabled))
                continue
            }

            val lower = name.lowercase()
            if (!lower.endsWith(".rwmod") && !lower.endsWith(".zip")) continue
            packageFile(name, file, enabled)?.let { result.add(it) }
        }
        return result
    }

    private fun folder(name: String, file: File, enabled: Boolean): LocalMod {
        val stats = walk(file)
        // 单位目录：优先 `units/` 下一层，没有就数自己的一级子目录（和桌面端一致）
        val unitsRoot = File(file, "units").takeIf { it.isDirectory } ?: file
        val dirs = (unitsRoot.listFiles() ?: emptyArray<File>())
            .filter { it.isDirectory }
            .map { it.name }
            .sorted()

        return LocalMod(
            name = name,
            title = folderTitle(file) ?: name,
            path = file.absolutePath,
            packaged = false,
            size = stats.first,
            files = stats.second,
            modified = file.lastModified(),
            unitCount = dirs.size,
            unitDirs = dirs,
            enabled = enabled,
        )
    }

    private fun packageFile(name: String, file: File, enabled: Boolean): LocalMod? {
        val info = runCatching {
            ZipFile(file).use { zip ->
                var files = 0
                val dirs = LinkedHashSet<String>()
                val entries = zip.entries()
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    if (entry.isDirectory) continue
                    files += 1
                    val parts = entry.name.split('/')
                    if (parts.size >= 3 && parts[0].equals("units", ignoreCase = true)) {
                        dirs.add(parts[1])
                    }
                }
                val title = zip.getEntry("mod-info.txt")?.let { entry ->
                    zip.getInputStream(entry).bufferedReader().use { reader ->
                        reader.readLines()
                            .firstOrNull { it.trimStart().startsWith("title", ignoreCase = true) }
                            ?.substringAfter(':')
                            ?.trim()
                            ?.takeIf { it.isNotEmpty() }
                    }
                }
                Triple(dirs.toList().sorted(), files, title)
            }
        }.getOrNull() ?: return null

        return LocalMod(
            name = name.substringBeforeLast('.'),
            title = info.third ?: name.substringBeforeLast('.'),
            path = file.absolutePath,
            packaged = true,
            size = file.length(),
            files = info.second,
            modified = file.lastModified(),
            unitCount = info.first.size,
            unitDirs = info.first,
            enabled = enabled,
        )
    }

    /** 启用 / 停用：文件级移动，可逆。 */
    fun setEnabled(unitsDir: String, name: String, enabled: Boolean): Result<Unit> = runCatching {
        val root = File(unitsDir)
        val disabledRoot = File(root, DISABLED_DIR)
        val from = if (enabled) File(disabledRoot, name) else File(root, name)
        val to = if (enabled) File(root, name) else File(disabledRoot, name)

        check(from.exists()) { "找不到 $name，可能在别处被移动过" }
        if (enabled) root.mkdirs() else disabledRoot.mkdirs()
        check(!to.exists()) { "目标位置已存在同名条目：${to.name}" }

        if (!from.renameTo(to)) {
            // 跨挂载点（比如应用私有目录 → 外置存储）时 rename 会失败，退回复制 + 删除
            if (from.isDirectory) from.copyRecursively(to, overwrite = false) else from.copyTo(to)
            from.deleteRecursively()
        }
    }

    /** 同名单位目录 → 冲突。和桌面端 detect_conflicts 同一套规则。 */
    fun conflicts(mods: List<LocalMod>): List<ModConflict> {
        val owners = HashMap<String, MutableList<Int>>()
        mods.forEachIndexed { index, mod ->
            for (dir in mod.unitDirs) {
                owners.getOrPut(dir.lowercase()) { mutableListOf() }.add(index)
            }
        }

        val result = ArrayList<ModConflict>()
        mods.forEachIndexed { index, mod ->
            val shared = ArrayList<Pair<String, Int>>()
            for (dir in mod.unitDirs) {
                val other = owners[dir.lowercase()]?.firstOrNull { it != index } ?: continue
                shared.add(dir to other)
            }
            if (shared.isEmpty()) return@forEachIndexed

            result.add(
                ModConflict(
                    name = mod.title,
                    with = mods[shared.first().second].title,
                    dirs = shared.map { it.first }.distinct().sorted().take(5),
                )
            )
        }
        return result
    }

    /** 目录体积与文件数。带上限：用户把整个存储填进来时不至于卡死。 */
    private fun walk(dir: File): Pair<Long, Int> {
        var bytes = 0L
        var count = 0
        val stack = ArrayDeque<File>()
        stack.add(dir)
        while (stack.isNotEmpty() && count < 20_000) {
            val current = stack.removeLast()
            val children = current.listFiles() ?: continue
            for (child in children) {
                if (child.isDirectory) stack.add(child) else {
                    bytes += child.length()
                    count += 1
                }
            }
        }
        return bytes to count
    }

    private fun folderTitle(dir: File): String? {
        val direct = File(dir, "mod-info.txt")
        val info = when {
            direct.isFile -> direct
            else -> dir.listFiles()
                ?.firstOrNull { it.isDirectory && File(it, "mod-info.txt").isFile }
                ?.let { File(it, "mod-info.txt") }
        } ?: return null

        return runCatching {
            info.readLines()
                .firstOrNull { it.trimStart().startsWith("title", ignoreCase = true) }
                ?.substringAfter(':')
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
        }.getOrNull()
    }

    /** Android 11 起读任意路径需要「所有文件访问」；8/9 用旧读权限。 */
    fun canRead(modsDir: String): Boolean {
        val readable = File(modsDir).let { it.exists() && it.canRead() }
        if (readable) return true
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            false
        }
    }

    /**
     * 常见安装位置。铁锈战争在不同渠道（Play / 官网 / 国内商店）包名与目录不同，
     * 逐个试一遍比让用户手打路径现实。
     */
    fun candidates(): List<String> {
        val base = Environment.getExternalStorageDirectory().absolutePath
        return listOf(
            "$base/Rusted Warfare/mods/units",
            "$base/Android/data/com.corrodinggames.rts/files/Rusted Warfare/mods/units",
            "$base/Android/data/com.corrodinggames.rts/files/mods/units",
            "$base/Download/Rusted Warfare/mods/units",
        ).distinct()
    }

    /** 自动检测：返回第一个存在的候选目录。 */
    fun detect(): String? = candidates().firstOrNull { File(it).isDirectory }
}
