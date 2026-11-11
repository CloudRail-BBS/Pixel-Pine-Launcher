package org.pixelpine.launcher.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.pixelpine.launcher.data.LocalMod
import org.pixelpine.launcher.data.ModConflict
import org.pixelpine.launcher.data.Mods
import org.pixelpine.launcher.data.Net
import org.pixelpine.launcher.data.Prefs
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun LibraryScreen(prefs: Prefs) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var mods by remember { mutableStateOf<List<LocalMod>>(emptyList()) }
    var conflicts by remember { mutableStateOf<List<ModConflict>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var granted by remember { mutableStateOf(hasAccess(context)) }
    var busy by remember { mutableStateOf<String?>(null) }

    suspend fun refresh() {
        loading = true
        granted = hasAccess(context)
        if (!granted) {
            loading = false
            return
        }
        runCatching { withContext(Dispatchers.IO) { Mods.scan(prefs.modsDir) } }
            .onSuccess { list ->
                mods = list
                // 只对启用中的 Mod 判冲突：停用的一份不会参与加载
                conflicts = Mods.conflicts(list.filter { it.enabled })
                error = null
            }
            .onFailure { error = it.message ?: "读取失败" }
        loading = false
    }

    LaunchedEffect(prefs.modsDir) { refresh() }

    Column(Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 16.dp)) {
        Text("库", fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
        Text(
            "${mods.count { it.enabled }} 个启用 · 共 ${mods.size} 个 · ${prefs.modsDir}",
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            modifier = Modifier.padding(top = 4.dp),
        )

        Row(
            Modifier.padding(top = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            OutlinedButton(onClick = { scope.launch { refresh() } }, enabled = !loading) {
                Text(if (loading) "读取中…" else "刷新")
            }
            if (!granted) {
                Button(onClick = { requestAccess(context) }) { Text("授予文件访问") }
            }
        }

        if (error != null) {
            Text(
                error!!,
                color = MaterialTheme.colorScheme.error,
                fontSize = 13.sp,
                modifier = Modifier.padding(top = 10.dp),
            )
        }

        if (!granted) {
            HintCard(
                title = "需要文件访问权限",
                body = "Android 11 起，读写游戏目录要在系统设置里允许「所有文件访问」。\n" +
                    "默认目录：" + Prefs.defaultModsDir(),
            )
            return@Column
        }

        if (conflicts.isNotEmpty()) {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                ),
                modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        "有 ${conflicts.size} 处单位冲突",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                    )
                    Text(
                        "两个 Mod 含同名单位目录时，游戏只会保留后加载的那份。" +
                            "停用其中一个，或接受覆盖。",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    conflicts.take(4).forEach { conflict ->
                        Text(
                            "· ${conflict.name} ↔ ${conflict.with}（${conflict.dirs.joinToString()}）",
                            fontSize = 11.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }

        if (!loading && mods.isEmpty() && error == null) {
            HintCard(
                title = "这个目录里还没有 Mod",
                body = "去市场装一个，或把 .rwmod 放进 mods/units。路径可以在设置里改。",
            )
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(top = 12.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(mods, key = { it.path }) { mod ->
                ModRow(
                    mod = mod,
                    busy = busy == mod.name,
                    onToggle = { next ->
                        busy = mod.name
                        scope.launch {
                            withContext(Dispatchers.IO) {
                                Mods.setEnabled(prefs.modsDir, mod.name, next)
                            }.onFailure { error = it.message ?: "移动失败" }
                            busy = null
                            refresh()
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun ModRow(mod: LocalMod, busy: Boolean, onToggle: (Boolean) -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    mod.title,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    buildString {
                        append(if (mod.packaged) ".rwmod" else "目录")
                        append(" · ${mod.unitCount} 个单位")
                        append(" · ${Net.formatBytes(mod.size)}")
                        append(" · ${formatDate(mod.modified)}")
                    },
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
                if (!mod.enabled) {
                    Text(
                        "已停用 · 文件在 .disabled/ 里，随时可以开回来",
                        fontSize = 11.5.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
            }
            Switch(
                checked = mod.enabled,
                enabled = !busy,
                onCheckedChange = onToggle,
            )
        }
    }
}

@Composable
private fun HintCard(title: String, body: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(
                body,
                fontSize = 12.5.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

private fun hasAccess(context: Context): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Environment.isExternalStorageManager()
    } else {
        context.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
    }

private fun requestAccess(context: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val intent = Intent(
            Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
            Uri.parse("package:${context.packageName}"),
        )
        runCatching { context.startActivity(intent) }.onFailure {
            context.startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
        }
    } else {
        context.startActivity(
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:${context.packageName}"),
            )
        )
    }
}

private fun formatDate(millis: Long): String =
    if (millis <= 0) "—"
    else SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date(millis))
