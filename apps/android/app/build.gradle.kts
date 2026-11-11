plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

/**
 * 版本号只有一个来源：`apps/desktop/src-tauri/tauri.conf.json`。
 *
 * 原先这里写死 `versionName = "0.1.3"`，打 v0.1.4 时 APK 里仍然是 0.1.3，
 * 应用内更新把「远程版本」和「本地版本」一比就永远是「已是最新」——
 * 表现就是「更新检查没反应、版本号也不对」。发版时 CI 用 `-Pppl.version=` 覆盖，
 * 保证包内版本与标签一致；本地构建跟随桌面端版本。
 */
val pplVersion: String =
    (findProperty("ppl.version") as String?)?.trim()?.takeIf { it.isNotEmpty() }
        ?: run {
            val conf = rootProject.file("../desktop/src-tauri/tauri.conf.json")
            check(conf.isFile) { "找不到 $conf，无法确定版本号" }
            Regex("\"version\"\\s*:\\s*\"([0-9]+\\.[0-9]+\\.[0-9]+)\"")
                .find(conf.readText())
                ?.groupValues
                ?.get(1)
                ?: error("tauri.conf.json 里没有 version 字段")
        }

val versionParts = pplVersion.split(".").map { it.toIntOrNull() ?: 0 }
check(versionParts.size == 3) { "版本号必须是 x.y.z：$pplVersion" }

/**
 * versionCode 必须严格递增，否则覆盖安装会被系统按「降级」拒绝。
 * 0.1.3 → 0*1_000_000 + 1*10_000 + 3*100 = 10300，
 * 高于旧包写死的 10003，所以老用户可以直接覆盖升级。
 */
val pplVersionCode =
    versionParts[0] * 1_000_000 + versionParts[1] * 10_000 + versionParts[2] * 100

android {
    namespace = "org.pixelpine.launcher"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.pixelpine.launcher"
        minSdk = 26
        targetSdk = 35
        versionCode = pplVersionCode
        versionName = pplVersion
    }

    buildTypes {
        release {
            // 目前只发 debug 签名包（Actions 产物），签名密钥还没进 CI
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    // FileProvider：把下载好的 APK 交给系统安装器时要用，
    // 不能直接传 file:// （7.0 起系统会拒绝）
    implementation("androidx.core:core-ktx:1.13.1")
}
