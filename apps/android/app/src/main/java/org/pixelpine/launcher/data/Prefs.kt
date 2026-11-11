package org.pixelpine.launcher.data

import android.content.Context
import android.os.Environment

/** 本地设置：市场地址与 Mod 目录都允许改，默认值只是省事。 */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("ppl", Context.MODE_PRIVATE)

    var server: String
        get() = (sp.getString("server", DEFAULT_SERVER) ?: DEFAULT_SERVER).trimEnd('/')
        set(value) {
            val clean = value.trim().trimEnd('/')
            sp.edit().putString("server", clean.ifEmpty { DEFAULT_SERVER }).apply()
        }

    var modsDir: String
        get() = sp.getString("modsDir", defaultModsDir()) ?: defaultModsDir()
        set(value) {
            sp.edit().putString("modsDir", value.trim()).apply()
        }

    companion object {
        const val DEFAULT_SERVER = "https://ziyuan.pixelpine.org"

        /** 铁锈战争 Android 版把 Mod 放在这里，和桌面端一样是 mods/units。 */
        fun defaultModsDir(): String =
            Environment.getExternalStorageDirectory().absolutePath + "/Rusted Warfare/mods/units"
    }
}
