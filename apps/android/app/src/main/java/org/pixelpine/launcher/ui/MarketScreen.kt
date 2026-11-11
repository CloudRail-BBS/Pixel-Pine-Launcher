package org.pixelpine.launcher.ui

import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.pixelpine.launcher.data.Installer
import org.pixelpine.launcher.data.MarketApi
import org.pixelpine.launcher.data.MarketItem
import org.pixelpine.launcher.data.MarketVersion
import org.pixelpine.launcher.data.Mods
import org.pixelpine.launcher.data.Net
import org.pixelpine.launcher.data.Prefs

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MarketScreen(prefs: Prefs) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var query by remember { mutableStateOf("") }
    var items by remember { mutableStateOf<List<MarketItem>>(emptyList()) }
    var total by remember { mutableIntStateOf(0) }
    var page by remember { mutableIntStateOf(1) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<MarketItem?>(null) }

    suspend fun fetch(target: Int, replace: Boolean) {
        if (loading) return
        loading = true
        error = null
        try {
            val result = MarketApi.list(prefs.server, query.trim(), target)
            items = if (replace) result.items else items + result.items
            total = result.total
            page = target
        } catch (cause: Exception) {
            error = cause.message ?: "请求失败"
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) { fetch(1, true) }

    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
            Text("市场", fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
            Text(
                "${if (total > 0) total else items.size} 个资源 · ${prefs.server}",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 4.dp),
            )

            Row(
                modifier = Modifier.padding(top = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    placeholder = { Text("搜索 Mod 或地图") },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { scope.launch { fetch(1, true) } }),
                )
                Spacer(Modifier.width(10.dp))
                Button(onClick = { scope.launch { fetch(1, true) } }, enabled = !loading) {
                    Text("搜索")
                }
            }
        }

        if (error != null) {
            Text(
                error!!,
                color = MaterialTheme.colorScheme.error,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
            )
        }

        if (loading && items.isEmpty()) {
            Row(
                Modifier.fillMaxWidth().padding(32.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                CircularProgressIndicator(strokeWidth = 2.dp)
            }
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 16.dp,
                end = 16.dp,
                top = 4.dp,
                bottom = 24.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(items, key = { it.id }) { item ->
                MarketCard(item) { selected = item }
            }

            if (items.isNotEmpty() && items.size < total) {
                item {
                    TextButton(
                        onClick = { scope.launch { fetch(page + 1, false) } },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (loading) "加载中…" else "加载更多（${items.size}/$total）")
                    }
                }
            }

            if (items.isEmpty() && !loading && error == null) {
                item {
                    Text(
                        "没有匹配的资源",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 24.dp),
                    )
                }
            }
        }
    }

    selected?.let { item ->
        DetailDialog(item = item, prefs = prefs, context = context) { selected = null }
    }
}

@Composable
private fun MarketCard(item: MarketItem, onOpen: () -> Unit) {
    Card(
        onClick = onOpen,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    item.title,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    if (item.kind == "map") "地图" else "Mod",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.primary,
                )
            }

            if (item.summary.isNotEmpty()) {
                Text(
                    item.summary,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }

            Row(
                Modifier.padding(top = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    item.author.ifEmpty { "佚名" },
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    item.version?.let { "v$it" } ?: "无版本",
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    item.size?.let { Net.formatBytes(it) } ?: "—",
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun DetailDialog(
    item: MarketItem,
    prefs: Prefs,
    context: Context,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var versions by remember { mutableStateOf<List<MarketVersion>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    // 安装状态：正在装的版本、下载进度、结果文案
    var installing by remember { mutableStateOf<String?>(null) }
    var progress by remember { mutableStateOf(-1) }
    var message by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(item.id) {
        versions = runCatching { MarketApi.detail(prefs.server, item.id) }.getOrDefault(emptyList())
        loading = false
    }

    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(item.title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                if (item.summary.isNotEmpty()) {
                    Text(
                        item.summary,
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Text(
                    "${item.slug} · ${item.author.ifEmpty { "佚名" }}",
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )

                when {
                    loading -> CircularProgressIndicator(
                        strokeWidth = 2.dp,
                        modifier = Modifier.padding(top = 16.dp).width(22.dp).height(22.dp),
                    )

                    versions.isEmpty() -> Text(
                        "暂无可用版本",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 14.dp),
                    )

                    else -> versions.forEach { version ->
                        Row(
                            Modifier.fillMaxWidth().padding(top = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text("v${version.version}", fontSize = 14.sp)
                                Text(
                                    Net.formatBytes(version.size),
                                    fontSize = 11.5.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Button(
                                onClick = {
                                    val url = version.urls.firstOrNull()
                                    if (url == null) {
                                        Toast.makeText(context, "这个版本没有下载地址", Toast.LENGTH_SHORT)
                                            .show()
                                    } else {
                                        // 直接装进游戏目录：桌面端也是点一下就进预设，
                                        // 留个「下载到 Downloads」等于把最后一步丢给用户
                                        val name = if (item.kind == "map") {
                                            url.substringBefore('?').substringAfterLast('/')
                                                .ifBlank { "map.zip" }
                                        } else {
                                            Installer.suggestedName(
                                                item.slug.ifEmpty { item.id },
                                                version.version,
                                                url,
                                            )
                                        }
                                        scope.launch {
                                            installing = version.version
                                            progress = 0
                                            message = null
                                            runCatching {
                                                Installer.install(
                                                    context = context,
                                                    url = url,
                                                    kind = item.kind,
                                                    modsDir = prefs.modsDir,
                                                    fileName = name,
                                                ) { progress = it }
                                            }.onSuccess {
                                                message = "已安装：${it.name}"
                                            }.onFailure {
                                                message = it.message ?: "安装失败"
                                            }
                                            installing = null
                                            progress = -1
                                        }
                                    }
                                },
                                enabled = installing == null && version.urls.isNotEmpty(),
                            ) {
                                Text(if (installing == version.version) "安装中…" else "安装")
                            }
                        }
                        if (installing == version.version) {
                            Text(
                                if (progress >= 0) "已下载 $progress%" else "下载中…",
                                fontSize = 11.5.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = 6.dp),
                            )
                        }
                    }
                }

                message?.let {
                    Text(
                        it,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }

                if (!Mods.canRead(prefs.modsDir)) {
                    Text(
                        "还没拿到文件访问权限，安装会失败。先去「设置 → 游戏目录」授权。",
                        fontSize = 11.5.sp,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text("关闭") } },
    )
}
