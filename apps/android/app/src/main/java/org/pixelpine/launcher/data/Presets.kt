package org.pixelpine.launcher.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** 预设里的一项。字段与桌面端 `LoadoutPackage` 对齐。 */
data class PresetPackage(
    val id: String,
    val version: String,
    val dir: String,
    val enabled: Boolean,
)

data class Preset(
    val id: String,
    val name: String,
    val packages: List<PresetPackage>,
    val maps: List<String> = emptyList(),
) {
    val enabledCount: Int get() = packages.count { it.enabled }
}

data class ApplyResult(val enabled: Int, val disabled: Int, val missing: List<String>)

/**
 * 作战预设。
 *
 * 桌面端切预设是重建 `mods/units` 的联接；Android 的外置存储（sdcardfs/exFAT）
 * 不支持符号链接，照搬不了。这里改用「把 Mod 在 `units/` 与 `units/.disabled/`
 * 之间移动」达到同样的效果：同样是零拷贝、可逆，也不改动 Mod 文件本身。
 *
 * 文件格式与桌面端一致（schema / id / name / packages / maps / args / icon），
 * 所以预设可以在两端之间导入导出——这也是「和电脑端同步」最实际的做法：
 * 不依赖账号，不要求两端同时在线。
 */
object Presets {
    private const val FILE_SCHEMA = 1

    fun dir(context: Context): File =
        File(context.getExternalFilesDir(null), "presets").apply { mkdirs() }

    fun list(context: Context): List<Preset> =
        dir(context).listFiles()
            ?.filter { it.isFile && it.name.endsWith(".json") }
            ?.mapNotNull { file -> runCatching { fromJson(file.readText()) }.getOrNull() }
            ?.sortedBy { it.name.lowercase() }
            ?: emptyList()

    fun save(context: Context, preset: Preset): Preset {
        File(dir(context), "${preset.id}.json").writeText(toJson(preset))
        return preset
    }

    fun delete(context: Context, preset: Preset) {
        File(dir(context), "${preset.id}.json").delete()
    }

    /** 把当前的启用/停用状态存成一个预设。 */
    fun createFromCurrent(context: Context, name: String, mods: List<LocalMod>): Preset =
        save(
            context,
            Preset(
                id = newId(name),
                name = name.trim().ifEmpty { "未命名预设" },
                packages = mods.map {
                    PresetPackage(id = it.name, version = "", dir = it.name, enabled = it.enabled)
                },
            ),
        )

    /**
     * 应用预设：命中的启用，其余停用。
     *
     * 只动启用状态，不删除任何文件——这也是两端一致的行为。
     * `missing` 是预设里列了、但当前目录里没有的 Mod（多半是在另一台设备上装的）。
     */
    fun apply(unitsDir: String, preset: Preset): ApplyResult {
        val wanted = preset.packages.filter { it.enabled }.map { it.id }.toSet()
        val mods = Mods.scan(unitsDir)

        var enabled = 0
        var disabled = 0
        for (mod in mods) {
            val target = mod.name in wanted
            if (target == mod.enabled) continue
            if (Mods.setEnabled(unitsDir, mod.name, target).isSuccess) {
                if (target) enabled += 1 else disabled += 1
            }
        }

        return ApplyResult(
            enabled = enabled,
            disabled = disabled,
            missing = wanted.filterNot { id -> mods.any { it.name == id } }.sorted(),
        )
    }

    fun toJson(preset: Preset): String {
        val packages = JSONArray()
        preset.packages.forEach { item ->
            packages.put(
                JSONObject()
                    .put("id", item.id)
                    .put("version", item.version)
                    .put("source", "local")
                    .put("dir", item.dir)
                    .put("enabled", item.enabled)
            )
        }

        val maps = JSONArray()
        preset.maps.forEach { maps.put(it) }

        return JSONObject()
            .put("schema", FILE_SCHEMA)
            .put("id", preset.id)
            .put("name", preset.name)
            .put("packages", packages)
            .put("maps", maps)
            .put("args", JSONArray())
            .put("icon", JSONObject.NULL)
            .toString(2)
    }

    /** 容忍桌面端写出的文件：缺字段就用默认值，不让一个空 version 把整份预设判死。 */
    fun fromJson(text: String): Preset {
        val json = JSONObject(text)

        val packages = ArrayList<PresetPackage>()
        val array = json.optJSONArray("packages")
        if (array != null) {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                // 桌面端旧数据可能只有 dir 没有 id，两者取其一即可
                val id = item.optString("id").ifEmpty { item.optString("dir") }
                if (id.isEmpty()) continue
                packages.add(
                    PresetPackage(
                        id = id,
                        version = item.optString("version"),
                        dir = item.optString("dir").ifEmpty { id },
                        enabled = item.optBoolean("enabled", true),
                    )
                )
            }
        }

        val maps = ArrayList<String>()
        json.optJSONArray("maps")?.let { items ->
            for (index in 0 until items.length()) {
                val name = items.optString(index)
                if (name.isNotEmpty()) maps.add(name)
            }
        }

        return Preset(
            id = json.optString("id").ifEmpty { newId(json.optString("name")) },
            name = json.optString("name").ifEmpty { "导入的预设" },
            packages = packages,
            maps = maps,
        )
    }

    /** 导入总是分配新 id：同名预设不该互相覆盖。 */
    fun importText(context: Context, text: String): Preset {
        val parsed = fromJson(text)
        return save(context, parsed.copy(id = newId(parsed.name)))
    }

    private fun newId(name: String): String {
        val base = name.lowercase()
            .replace(Regex("[^a-z0-9\\u4e00-\\u9fff]+"), "-")
            .trim('-')
            .ifEmpty { "preset" }
        return "$base-${System.currentTimeMillis() / 1000}"
    }
}
