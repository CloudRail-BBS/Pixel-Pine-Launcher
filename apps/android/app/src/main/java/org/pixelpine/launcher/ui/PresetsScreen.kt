package org.pixelpine.launcher.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import org.pixelpine.launcher.data.Mods
import org.pixelpine.launcher.data.Prefs
import org.pixelpine.launcher.data.Preset
import org.pixelpine.launcher.data.Presets

/**
 * 作战预设。
 *
 * Android 上做不到桌面端的「重建目录联接」，所以这里切换的是启用状态：
 * 命中的 Mod 移回 `units/`，其余移进 `units/.disabled/`。效果一样、可逆，
 * 文件本身一字节都不动。
 *
 * 预设文件与桌面端同格式，可导入导出——换设备时把 JSON 带过去即可。
 */
@Composable
fun PresetsScreen(prefs: Prefs) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var presets by remember { mutableStateOf<List<Preset>>(emptyList()) }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    var createOpen by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }
    var removeTarget by remember { mutableStateOf<Preset?>(null) }
    var exportTarget by remember { mutableStateOf<Preset?>(null) }

    fun reload() {
        presets = Presets.list(context)
    }

    LaunchedEffect(Unit) { reload() }

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        val target = exportTarget
        exportTarget = null
        if (uri == null || target == null) return@rememberLauncherForActivityResult
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val text = Presets.toJson(target)
                    context.contentResolver.openOutputStream(uri)?.bufferedWriter()?.use {
                        it.write(text)
                    } ?: error("无法写入所选位置")
                }
            }.onSuccess { status = "已导出「${target.name}」" }
                .onFailure { error = it.message ?: "导出失败" }
        }
    }

    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val text = context.contentResolver.openInputStream(uri)
                        ?.bufferedReader()
                        ?.use { it.readText() }
                        ?: error("读不到所选文件")
                    Presets.importText(context, text)
                }
            }.onSuccess {
                reload()
                status = "已导入「${it.name}」，共 ${it.packages.size} 项"
                error = null
            }.onFailure { error = it.message ?: "导入失败" }
        }
    }

    Column(Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 16.dp)) {
        Text("预设", fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
        Text(
            "一套预设 = 一组启用的 Mod。切换只移动启停状态，不改文件。",
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp),
        )

        Row(
            Modifier.padding(top = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Button(
                onClick = {
                    newName = ""
                    createOpen = true
                },
                enabled = !busy,
            ) { Text("从当前库新建") }

            OutlinedButton(
                onClick = { importLauncher.launch(arrayOf("*/*")) },
                enabled = !busy,
            ) { Text("导入") }
        }

        status?.let {
            Text(
                it,
                fontSize = 12.5.sp,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(top = 10.dp),
            )
        }
        error?.let {
            Text(
                it,
                fontSize = 12.5.sp,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 10.dp),
            )
        }

        if (!Mods.canRead(prefs.modsDir)) {
            Text(
                "还没有文件访问权限，应用预设前请先到设置里授权。",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 10.dp),
            )
        }

        if (presets.isEmpty()) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text("还没有预设", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    Text(
                        "先在「库」里把要启用的 Mod 打开、其余关掉，再点上面的「从当前库新建」。",
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
            items(presets, key = { it.id }) { preset ->
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Text(preset.name, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                        Text(
                            "${preset.packages.size} 个 Mod · 启用 ${preset.enabledCount}",
                            fontSize = 11.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 4.dp),
                        )

                        Row(
                            Modifier.padding(top = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Button(
                                onClick = {
                                    busy = true
                                    scope.launch {
                                        val result = withContext(Dispatchers.IO) {
                                            Presets.apply(prefs.modsDir, preset)
                                        }
                                        busy = false
                                        status = buildString {
                                            append("已应用「${preset.name}」：")
                                            append("启用 ${result.enabled}，停用 ${result.disabled}")
                                            if (result.missing.isNotEmpty()) {
                                                append("；缺 ${result.missing.size} 个")
                                                append("（${result.missing.take(3).joinToString()}）")
                                            }
                                        }
                                        error = null
                                    }
                                },
                                enabled = !busy,
                            ) { Text(if (busy) "处理中…" else "应用") }

                            TextButton(
                                onClick = {
                                    exportTarget = preset
                                    exportLauncher.launch("${preset.id}.json")
                                },
                                enabled = !busy,
                            ) { Text("导出") }

                            TextButton(
                                onClick = { removeTarget = preset },
                                enabled = !busy,
                            ) { Text("删除") }
                        }
                    }
                }
            }
        }
    }

    if (createOpen) {
        AlertDialog(
            onDismissRequest = { createOpen = false },
            title = { Text("新建预设", fontSize = 18.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                Column {
                    Text(
                        "会记录当前每个 Mod 的启用/停用状态。换个名字再来一次，就是第二套组合。",
                        fontSize = 12.5.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        value = newName,
                        onValueChange = { newName = it },
                        label = { Text("预设名称") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val name = newName.trim()
                        if (name.isEmpty()) return@TextButton
                        scope.launch {
                            val mods = withContext(Dispatchers.IO) { Mods.scan(prefs.modsDir) }
                            if (mods.isEmpty()) {
                                error = "当前库里没有 Mod，先装一个再建预设"
                            } else {
                                val created = withContext(Dispatchers.IO) {
                                    Presets.createFromCurrent(context, name, mods)
                                }
                                reload()
                                status = "已保存「${created.name}」"
                                error = null
                            }
                        }
                        createOpen = false
                    },
                ) { Text("保存") }
            },
            dismissButton = {
                TextButton(onClick = { createOpen = false }) { Text("取消") }
            },
        )
    }

    removeTarget?.let { preset ->
        AlertDialog(
            onDismissRequest = { removeTarget = null },
            title = { Text("删除预设", fontSize = 18.sp, fontWeight = FontWeight.SemiBold) },
            text = { Text("只删这份记录，Mod 文件不受影响。", fontSize = 13.sp) },
            confirmButton = {
                TextButton(
                    onClick = {
                        Presets.delete(context, preset)
                        removeTarget = null
                        reload()
                        status = "已删除「${preset.name}」"
                    },
                ) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { removeTarget = null }) { Text("取消") }
            },
        )
    }
}
