package org.pixelpine.launcher.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class MarketItem(
    val id: String,
    val slug: String,
    val kind: String,
    val title: String,
    val summary: String,
    val author: String,
    val cover: String?,
    val version: String?,
    val size: Long?,
    val urls: List<String>,
)

data class MarketPage(val items: List<MarketItem>, val total: Int)

data class MarketVersion(
    val version: String,
    val size: Long,
    val urls: List<String>,
    val changelog: String,
)

/**
 * 市场接口。用 HttpURLConnection + org.json，不引第三方网络库：
 * 只有两个只读接口，加 OkHttp / 序列化框架的收益抵不过 APK 体积与版本冲突。
 */
object MarketApi {
    suspend fun list(base: String, query: String, page: Int, size: Int = 20): MarketPage =
        withContext(Dispatchers.IO) {
            val encoded = URLEncoder.encode(query, "UTF-8")
            val json = get("$base/v1/packages?page=$page&size=$size&q=$encoded")
            val array = json.optJSONArray("items") ?: return@withContext MarketPage(emptyList(), 0)
            val items = buildList {
                for (index in 0 until array.length()) {
                    array.optJSONObject(index)?.let { add(parseItem(it)) }
                }
            }
            MarketPage(items, json.optInt("total", items.size))
        }

    suspend fun detail(base: String, id: String): List<MarketVersion> = withContext(Dispatchers.IO) {
        val json = get("$base/v1/packages/$id")
        val array = json.optJSONArray("versions") ?: return@withContext emptyList()
        buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                add(
                    MarketVersion(
                        version = item.optString("version"),
                        size = item.optLong("size"),
                        urls = readUrls(item),
                        changelog = item.optString("changelog"),
                    )
                )
            }
        }
    }

    private fun parseItem(item: JSONObject) = MarketItem(
        id = item.optString("id"),
        slug = item.optString("slug"),
        kind = item.optString("kind", "mod"),
        title = item.optString("title", "未命名"),
        summary = item.optString("summary"),
        author = item.optString("author"),
        cover = item.optString("cover").ifEmpty { null },
        version = item.optString("version").ifEmpty { null },
        size = if (item.isNull("size")) null else item.optLong("size"),
        urls = readUrls(item),
    )

    private fun readUrls(item: JSONObject): List<String> {
        val array = item.optJSONArray("urls") ?: return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val url = array.optString(index)
                if (url.isNotEmpty()) add(url)
            }
        }
    }

    private fun get(url: String): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 12_000
        connection.readTimeout = 20_000
        connection.setRequestProperty("accept", "application/json")
        try {
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) {
                throw IllegalStateException("服务端返回 $code：${text.take(120)}")
            }
            return JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }
}
