package org.pixelpine.launcher

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import org.pixelpine.launcher.data.Prefs
import org.pixelpine.launcher.ui.PplApp
import org.pixelpine.launcher.ui.PplTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(applicationContext)
        setContent {
            PplTheme {
                PplApp(prefs)
            }
        }
    }
}
