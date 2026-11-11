package org.pixelpine.launcher.data

import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * 最小的网络工具。整个 App 只有三个只读接口（市场列表/详情、Release 信息）
 * 和两种下载，引 OkHttp 换不来什么。
 */
object Net {
    private const val UA = "Pixel-Pine-Launcher"

    fun getJson(url: String, accept: String = "application/json"): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 12_000
        connection.readTimeout = 20_000
        connection.setRequestProperty("accept", accept)
        connection.setRequestProperty("user-agent", UA)
        try {
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) {
                throw IllegalStateException("服务端返回 $code：${text.take(140)}")
            }
            return JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }

    /**
     * 下载到指定文件。总长度未知时 [onProgress] 的第二个参数为 -1，
     * 由调用方决定显示不确定进度还是百分比——不要硬算一个假的 100%。
     */
    fun download(url: String, target: File, onProgress: (Long, Long) -> Unit = { _, _ -> }) {
        target.parentFile?.mkdirs()
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.setRequestProperty("user-agent", UA)
        connection.instanceFollowRedirects = true
        try {
            val code = connection.responseCode
            if (code !in 200..299) {
                throw IllegalStateException("下载失败：HTTP $code")
            }
            val total = connection.contentLengthLong
            var done = 0L
            connection.inputStream.use { input ->
                FileOutputStream(target).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var lastReport = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                        done += read
                        // 每 256KB 报一次，避免进度回调本身成为负担
                        if (done - lastReport >= 256 * 1024) {
                            lastReport = done
                            onProgress(done, total)
                        }
                    }
                    output.flush()
                }
            }
            onProgress(done, total)
        } catch (error: Throwable) {
            target.delete()
            throw error
        } finally {
            connection.disconnect()
        }
    }

    /** 字节数转人话。 */
    fun formatBytes(bytes: Long): String {
        if (bytes <= 0) return "—"
        val units = listOf("B", "KB", "MB", "GB")
        var value = bytes.toDouble()
        var unit = 0
        while (value >= 1024 && unit < units.lastIndex) {
            value /= 1024
            unit += 1
        }
        return if (value >= 10 || unit == 0) {
            "${value.toInt()} ${units[unit]}"
        } else {
            String.format("%.1f %s", value, units[unit])
        }
    }
}
