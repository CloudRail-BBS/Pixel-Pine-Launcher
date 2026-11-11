package org.pixelpine.launcher.ui

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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.pixelpine.launcher.BuildConfig
import org.pixelpine.launcher.data.Prefs

@Composable
fun SettingsScreen(prefs: Prefs) {
    val context = LocalContext.current

    var server by remember { mutableStateOf(prefs.server) }
    var modsDir by remember { mutableStateOf(prefs.modsDir) }
    var saved by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        Text("设置", fontSize = 28.sp, fontWeight = FontWeight.SemiBold)

        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
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
                    "默认指向官方实例，换成自建源也可以，接口格式一致。",
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

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
                TextButton(onClick = { modsDir = Prefs.defaultModsDir() }) {
                    Text("恢复默认路径")
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

        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth().padding(top = 18.dp),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("关于", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Text(
                    "Pixel-Pine-Launcher v${BuildConfig.VERSION_NAME}",
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
