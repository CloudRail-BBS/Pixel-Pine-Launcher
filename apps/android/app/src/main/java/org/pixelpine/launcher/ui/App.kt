package org.pixelpine.launcher.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import org.pixelpine.launcher.data.Prefs

private data class Tab(val label: String, val icon: ImageVector)

// 和桌面端对齐：市场 / 库 / 预设 / 设置。桌面端还有联机与扩展，
// 但它们依赖 JVM 运行时或原生启动，Android 上不具备条件，不摆空按钮。
private val tabs = listOf(
    Tab("市场", Icons.Outlined.Storefront),
    Tab("库", Icons.Outlined.Inventory2),
    Tab("预设", Icons.Outlined.Layers),
    Tab("设置", Icons.Outlined.Settings),
)

@Composable
fun PplApp(prefs: Prefs) {
    var index by rememberSaveable { mutableIntStateOf(0) }
    val tabList = remember { tabs }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                tabList.forEachIndexed { position, tab ->
                    NavigationBarItem(
                        selected = index == position,
                        onClick = { index = position },
                        icon = { Icon(tab.icon, contentDescription = null) },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding)) {
            when (index) {
                0 -> MarketScreen(prefs)
                1 -> LibraryScreen(prefs)
                2 -> PresetsScreen(prefs)
                else -> SettingsScreen(prefs)
            }
        }
    }
}
