package org.pixelpine.launcher.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.zip.ZipFile

/**
 * 市场资源安装。
 *
 * 之前市场里的「下载」只是把文件丢进系统下载目录，用户还要自己去文件管理器
 * 搬进 `mods/units`——这也是「和电脑端不同步」最明显的地方：桌面端点一下
 * 就把资源装进预设了。这里改成下载到应用缓存，再落到游戏目录。
 */
object Installer {
    suspend fun install(
        context: Context,
        url: String,
        kind: String,
        modsDir: String,
        fileName: String,
        onProgress: (Int) -> Unit,
    ): File = withContext(Dispatchers.IO) {
        val isMap = kind.equals("map", ignoreCase = true)
        val targetDir = File(if (isMap) mapsDir(modsDir) else modsDir)
        check(targetDir.isDirectory) {
            "目录不存在：${targetDir.absolutePath}\n先到设置里选对游戏目录"
        }

        val temp = File(context.cacheDir, "ppl-market.tmp")
        Net.download(url, temp) { done, total ->
            onProgress(if (total > 0) ((done * 100) / total).toInt() else -1)
        }

        val placed = if (isMap && temp.extension.equals("zip", ignoreCase = true)) {
            // 地图通常是 .tmx + 同名预览图打成 zip，直接摊进 mods/maps
            extractZip(temp, targetDir)
        } else {
            val name = sanitize(fileName)
            val target = File(targetDir, name)
            if (target.exists()) target.deleteRecursively()
            if (!temp.renameTo(target)) {
                temp.copyTo(target, overwrite = true)
            }
            target
        }

        temp.delete()
        onProgress(100)
        placed
    }

    /** `mods/units` 的兄弟目录 `mods/maps`，与桌面端一致。 */
    fun mapsDir(modsDir: String): String {
        val units = File(modsDir)
        val mods = units.parentFile ?: units
        return File(mods, "maps").absolutePath
    }

    /** 资源落到游戏目录时用的文件名：去掉查询串与路径分隔符。 */
    fun suggestedName(slug: String, version: String, url: String): String {
        val cleanSlug = slug.replace(Regex("[^A-Za-z0-9._-]+"), "-").trim('-').ifEmpty { "package" }
        val cleanVersion = version.replace(Regex("[^A-Za-z0-9._-]+"), "-").trim('-')
        val ext = url.substringBefore('?').substringAfterLast('/')
            .substringAfterLast('.', "")
            .lowercase()
        // .rwmod 与 .zip 都是游戏认的包；其他扩展名一律按 .rwmod 存
        val safeExt = if (ext == "rwmod" || ext == "zip") ext else "rwmod"
        return if (cleanVersion.isEmpty()) "$cleanSlug.$safeExt" else "$cleanSlug-$cleanVersion.$safeExt"
    }

    private fun sanitize(name: String): String {
        val cleaned = name.substringBefore('?')
            .substringAfterLast('/')
            .replace(Regex("[^A-Za-z0-9._\\-\\u4e00-\\u9fff ]+"), "_")
        return cleaned.ifEmpty { "package.rwmod" }
    }

    private fun extractZip(zip: File, targetDir: File): File {
        ZipFile(zip).use { archive ->
            val entries = archive.entries()
            while (entries.hasMoreElements()) {
                val entry = entries.nextElement()
                val out = File(targetDir, entry.name)
                // zip-slip：解出来的路径必须仍在目标目录里
                val root = targetDir.canonicalPath + File.separator
                if (!out.canonicalPath.startsWith(root)) continue
                if (entry.isDirectory) {
                    out.mkdirs()
                } else {
                    out.parentFile?.mkdirs()
                    archive.getInputStream(entry).use { input ->
                        out.outputStream().use { output -> input.copyTo(output) }
                    }
                }
            }
        }
        return targetDir
    }
}
