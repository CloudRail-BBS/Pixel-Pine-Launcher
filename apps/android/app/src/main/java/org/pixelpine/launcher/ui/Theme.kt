package org.pixelpine.launcher.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// 和桌面端同一套 token：近黑画布 + 蓝色强调，不做第二套视觉
private val PplColors = darkColorScheme(
    primary = Color(0xFF7FB0FF),
    onPrimary = Color(0xFF06101F),
    background = Color(0xFF0A0A0B),
    onBackground = Color(0xFFF4F4F5),
    surface = Color(0xFF121214),
    onSurface = Color(0xFFF4F4F5),
    surfaceVariant = Color(0xFF1B1B1F),
    onSurfaceVariant = Color(0xFFB9B9C0),
    outline = Color(0xFF2A2A30),
    error = Color(0xFFF87171),
)

@Composable
fun PplTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = PplColors, content = content)
}
