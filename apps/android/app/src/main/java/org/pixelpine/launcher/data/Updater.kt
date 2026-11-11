package org.pixelpine.launcher.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** GitHub Release 里与 Android 相关的那部分信息。 */
data class ReleaseInfo(
    val version: String,
    val notes: String,
    val pageUrl: String,
    val apkUrl: String,
    val apkName: String,
    val apkSize: Long,
)

/**
 * 应用内更新。
 *
 * 之前 Android 端没有任何更新检查：用户只能自己去 Release 页面找 APK，
 * 而版本号又写死在 gradle 里，两者叠加就是「更新不了、版本号也不对」。
 *
 * 这里的语义和桌面端保持一致：**检查失败不打扰**（返回 null / 抛给调用方让界面显示原因），
 * 有新版才提示，安装完成后由系统安装器接管。
 */
object Updater {
    private const val REPO = "CloudRail-BBS/Pixel-Pine-Launcher"

    /**
     * 最近一个带 Android 安装包的发布。
     *
     * 不能直接用 `/releases/latest`：那个接口**不返回预发布**，而仓库里的发布
     * 全部标了 prerelease（预览版），请求会直接 404——这正是「更新检查失败」的
     * 一个隐蔽来源。这里读列表，跳过草稿，取版本最高且带 APK 的那一个。
     *
     * 没有 APK 的版本（纯桌面端修复）会被跳过：不该让 Android 用户去升一个装不上的版本。
     */
    suspend fun latest(): ReleaseInfo = withContext(Dispatchers.IO) {
        val list = Net.getJsonArray(
            "https://api.github.com/repos/$REPO/releases?per_page=30",
            accept = "application/vnd.github+json",
        )

        var best: ReleaseInfo? = null
        for (index in 0 until list.length()) {
            val item = list.optJSONObject(index) ?: continue
            if (item.optBoolean("draft", false)) continue

            val version = item.optString("tag_name").removePrefix("v").trim()
            if (version.isEmpty()) continue

            var apkUrl = ""
            var apkName = ""
            var apkSize = 0L
            item.optJSONArray("assets")?.let { assets ->
                for (position in 0 until assets.length()) {
                    val asset = assets.optJSONObject(position) ?: continue
                    val name = asset.optString("name")
                    if (!name.endsWith(".apk", ignoreCase = true)) continue
                    apkUrl = asset.optString("browser_download_url")
                    apkName = name
                    apkSize = asset.optLong("size")
                    break
                }
            }
            if (apkUrl.isEmpty()) continue

            val info = ReleaseInfo(
                version = version,
                notes = item.optString("body").trim(),
                pageUrl = item.optString("html_url"),
                apkUrl = apkUrl,
                apkName = apkName,
                apkSize = apkSize,
            )

            val current = best
            if (current == null || isNewer(info.version, current.version)) {
                best = info
            }
        }

        best ?: error("还没有带 Android 安装包的发布")
    }

    /** 逐段比较数字，`0.1.10` 要大于 `0.1.9`——字符串比较会判错。 */
    fun isNewer(remote: String, current: String): Boolean {
        val left = parts(remote)
        val right = parts(current)
        for (index in 0 until maxOf(left.size, right.size)) {
            val a = left.getOrElse(index) { 0 }
            val b = right.getOrElse(index) { 0 }
            if (a != b) return a > b
        }
        return false
    }

    private fun parts(text: String): List<Int> =
        text.trim()
            .removePrefix("v")
            .split('.', '-', '+')
            .mapNotNull { it.toIntOrNull() }

    /** 下载到应用私有目录。返回的文件只能经 FileProvider 交给系统安装器。 */
    suspend fun downloadApk(
        context: Context,
        release: ReleaseInfo,
        onProgress: (Int) -> Unit,
    ): File = withContext(Dispatchers.IO) {
        require(release.apkUrl.isNotEmpty()) { "这个版本没有 APK 资源，请到 Release 页面手动下载" }

        val dir = File(context.getExternalFilesDir(null), "updates").apply { mkdirs() }
        // 旧安装包留着没用，先清掉，免得几个版本叠起来占几十兆
        dir.listFiles()?.forEach { it.delete() }

        val target = File(dir, "ppl-${release.version}.apk")
        Net.download(release.apkUrl, target) { done, total ->
            // 总长度未知时给 -1，界面显示不确定进度而不是一个假的百分比
            onProgress(if (total > 0) ((done * 100) / total).toInt() else -1)
        }
        target
    }

    /** 系统是否允许本应用安装未知来源的应用。 */
    fun canInstall(context: Context): Boolean =
        context.packageManager.canRequestPackageInstalls()

    /** 跳转到「安装未知应用」授权页。 */
    fun openInstallPermission(context: Context) {
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}"),
        )
        runCatching { context.startActivity(intent) }
            .onFailure {
                runCatching { context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)) }
            }
    }

    /** 交给系统安装器。没有 REQUEST_INSTALL_PACKAGES 授权时先引导授权。 */
    fun install(context: Context, file: File): Result<Unit> = runCatching {
        require(file.isFile) { "安装包不在了，请重新下载" }
        if (!canInstall(context)) {
            openInstallPermission(context)
            throw IllegalStateException("请先允许本应用安装应用，然后再点一次安装")
        }

        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            file,
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}
