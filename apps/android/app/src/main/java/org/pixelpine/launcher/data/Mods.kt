package org.pixelpine.launcher.data

import android.os.Build
import android.os.Environment
import java.io.File

/** 已安装的一个 Mod（目录或 .rwmod 文件）。 */
data class LocalMod(
    val name: String,
    val path: String,
    val isDirectory: Boolean,
    val size: Long,
    val files: Int,
    val modified: Long,
)

object Mods {
    /** 扫描 mods/units：目录算一项，.rwmod 文件也算一项。 */
    fun scan(dir: String): List<LocalMod> {
        val root = File(dir)
        if (!root.isDirectory) return emptyList()

        return root.listFiles()
            ?.filter { it.isDirectory || it.name.endsWith(".rwmod", ignoreCase = true) }
            ?.map { file ->
                val stats = if (file.isDirectory) walk(file) else Pair(file.length(), 1)
                LocalMod(
                    name = file.name,
                    path = file.absolutePath,
                    isDirectory = file.isDirectory,
                    size = stats.first,
                    files = stats.second,
                    modified = file.lastModified(),
                )
            }
            ?.sortedBy { it.name.lowercase() }
            ?: emptyList()
    }

    /** 目录体积与文件数。加个上限：用户把整个游戏目录填进来时不至于卡死。 */
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
        return Pair(bytes, count)
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
}
