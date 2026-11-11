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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.pixelpine.launcher.data.LocalMod
import org.pixelpine.launcher.data.Mods
import org.pixelpine.launcher.data.Prefs
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun LibraryScreen(prefs: Prefs) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var mods by remember { mutableStateOf<List<LocalMod>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var granted by remember { mutableStateOf(hasAccess(context)) }

    suspend fun refresh() {
        loading = true
        granted = hasAccess(context)
        if (!granted) {
            loading = false
            return
        }
        runCatching { withContext(Dispatchers.IO) { Mods.scan(prefs.modsDir) } }
            .onSuccess { mods = it; error = null }
            .onFailure { error = it.message ?: "读取失败" }
        loading = false
    }

    LaunchedEffect(prefs.modsDir) { refresh() }

    Column(Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 16.dp)) {
        Text("库", fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
        Text(
            "${mods.size} 个 Mod · ${prefs.modsDir}",
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
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
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text("需要文件访问权限", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    Text(
                        "Android 11 起，读游戏目录需要在系统设置里允许「所有文件访问」。\n" +
                            "默认目录：" + Prefs.defaultModsDir(),
                        fontSize = 12.5.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
            return@Column
        }

        if (!loading && mods.isEmpty() && error == null) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text("这个目录里还没有 Mod", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    Text(
                        "去市场装一个，或把 .rwmod 放进 mods/units。路径可以在设置里改。",
                        fontSize = 12.5.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(top = 12.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(mods, key = { it.path }) { mod ->
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Text(mod.name, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                        Text(
                            buildString {
                                append(if (mod.isDirectory) "目录" else ".rwmod")
                                append(" · ${mod.files} 个文件")
                                append(" · ${formatBytes(mod.size)}")
                                append(" · ${formatDate(mod.modified)}")
                            },
                            fontSize = 11.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
            }
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
