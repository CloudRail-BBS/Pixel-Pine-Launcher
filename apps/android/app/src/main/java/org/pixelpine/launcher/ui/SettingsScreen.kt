package org.pixelpine.launcher.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.pixelpine.launcher.BuildConfig
import org.pixelpine.launcher.data.Mods
import org.pixelpine.launcher.data.Net
import org.pixelpine.launcher.data.Prefs
import org.pixelpine.launcher.data.ReleaseInfo
import org.pixelpine.launcher.data.Updater
import java.io.File

@Composable
fun SettingsScreen(prefs: Prefs) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var server by remember { mutableStateOf(prefs.server) }
    var modsDir by remember { mutableStateOf(prefs.modsDir) }
    var saved by remember { mutableStateOf<String?>(null) }

    var checking by remember { mutableStateOf(false) }
    var downloading by remember { mutableStateOf(false) }
    var percent by remember { mutableStateOf(-1) }
    var release by remember { mutableStateOf<ReleaseInfo?>(null) }
    var updateState by remember { mutableStateOf<String?>(null) }
    var apk by remember { mutableStateOf<File?>(null) }

    val currentVersion = BuildConfig.VERSION_NAME

    fun startDownload(info: ReleaseInfo) {
        scope.launch {
            downloading = true
            percent = 0
            updateState = "正在下载 v${info.version}…"
            runCatching { Updater.downloadApk(context, info) { percent = it } }
                .onSuccess { file ->
                    apk = file
                    val installed = Updater.install(context, file)
                    updateState = installed.fold(
                        onSuccess = { "已下载 v${info.version}，按系统提示完成安装" },
                        onFailure = { it.message ?: "打开安装器失败" },
                    )
                }
                .onFailure { updateState = "下载失败：${it.message}" }
            downloading = false
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        Text("设置", fontSize = 28.sp, fontWeight = FontWeight.SemiBold)

        // ── 更新 ─────────────────────────────────────────────
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("更新", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Text(
                    "当前版本 v$currentVersion（${BuildConfig.VERSION_CODE}）",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Button(
                        onClick = {
                            scope.launch {
                                checking = true
                                updateState = null
                                apk = null
                                runCatching { Updater.latest() }
                                    .onSuccess { info ->
                                        release = info
                                        updateState = if (Updater.isNewer(info.version, currentVersion)) {
                                            "发现新版本 v${info.version}" +
                                                if (info.apkSize > 0) {
                                                    "（${Net.formatBytes(info.apkSize)}）"
                                                } else {
                                                    ""
                                                }
                                        } else {
                                            "已是最新版本"
                                        }
                                    }
                                    .onFailure { updateState = "检查失败：${it.message}" }
                                checking = false
                            }
                        },
                        enabled = !checking && !downloading,
                    ) {
                        Text(if (checking) "检查中…" else "检查更新")
                    }

                    val target = release
                    if (target != null && Updater.isNewer(target.version, currentVersion)) {
                        Button(
                            onClick = { startDownload(target) },
                            enabled = !downloading && !checking,
                        ) { Text(if (downloading) "下载中…" else "下载并安装") }
                    }
                }

                if (downloading) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        CircularProgressIndicator(strokeWidth = 2.dp)
                        Text(
                            if (percent >= 0) "下载中 $percent%" else "下载中…",
                            fontSize = 12.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                updateState?.let {
                    Text(
                        it,
                        fontSize = 12.5.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                if (release?.notes?.isNotEmpty() == true) {
                    Text(
                        release!!.notes.lines().take(4).joinToString("\n"),
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                // 安装未知来源应用是系统级开关，不给用户指路的话，点下载只会「没反应」
                if (!Updater.canInstall(context)) {
                    Text(
                        "系统还没允许本应用安装应用，安装前需要先授权。",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.error,
                    )
                    TextButton(onClick = { Updater.openInstallPermission(context) }) {
                        Text("去授权")
                    }
                }

                apk?.let { file ->
                    if (file.isFile) {
                        TextButton(onClick = {
                            Updater.install(context, file).onFailure {
                                updateState = it.message ?: "打开安装器失败"
                            }
                        }) { Text("重新打开安装器") }
                    }
                }

                Text(
                    "更新包来自 GitHub Releases 的 Android APK；桌面端走各自的更新清单，互不影响。",
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // ── 资源市场 ─────────────────────────────────────────
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("资源市场", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                OutlinedTextField(
                    value = server,
                    onValueChange = { server = it },
                    label = { Text("服务器地址") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "默认指向官方实例，换成自建源也可以，接口格式一致（与桌面端同一套接口）。",
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // ── 游戏目录 ─────────────────────────────────────────
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("游戏目录", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                OutlinedTextField(
                    value = modsDir,
                    onValueChange = { modsDir = it },
                    label = { Text("mods/units 路径") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "市场安装、库扫描、预设切换都用这个目录；地图会自动落到同级的 mods/maps。",
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(
                        onClick = {
                            val found = Mods.detect()
                            if (found == null) {
                                saved = "没找到游戏目录，手动填一下"
                            } else {
                                modsDir = found
                                saved = "已填入：$found"
                            }
                        },
                    ) { Text("自动检测") }
                    TextButton(onClick = { modsDir = Prefs.defaultModsDir() }) {
                        Text("恢复默认路径")
                    }
                }
            }
        }

        Row(
            Modifier.padding(top = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Button(
                onClick = {
                    prefs.server = server
                    prefs.modsDir = modsDir
                    server = prefs.server
                    saved = "已保存"
                },
            ) { Text("保存") }
            OutlinedButton(
                onClick = {
                    prefs.server = Prefs.DEFAULT_SERVER
                    prefs.modsDir = Prefs.defaultModsDir()
                    server = prefs.server
                    modsDir = prefs.modsDir
                    saved = "已恢复默认值"
                },
            ) { Text("恢复默认") }
        }

        saved?.let {
            Text(
                it,
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(top = 8.dp),
            )
        }

        // ── 关于 ─────────────────────────────────────────────
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth().padding(top = 18.dp),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("关于", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Text(
                    "Pixel-Pine-Launcher v$currentVersion",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "《铁锈战争》的第三方启动器。不包含游戏本体，与 Corroding Games 无隶属关系。",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { open(context, "https://ppl.pixelpine.org/") }) {
                        Text("官网")
                    }
                    TextButton(
                        onClick = {
                            open(
                                context,
                                "https://github.com/CloudRail-BBS/Pixel-Pine-Launcher",
                            )
                        },
                    ) { Text("源码") }
                    TextButton(onClick = { open(context, "https://ppl.pixelpine.org/docs/") }) {
                        Text("文档")
                    }
                }
            }
        }
    }
}

private fun open(context: android.content.Context, url: String) {
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }
}
