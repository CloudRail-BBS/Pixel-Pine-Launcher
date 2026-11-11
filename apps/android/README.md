# Android 客户端

Kotlin + Jetpack Compose 原生实现，不套 WebView、不复用桌面端的 Tauri 壳。

## 现在有什么

| 页面 | 能力 |
|---|---|
| 市场 | 搜索、分页、详情、版本列表；下载走系统 `DownloadManager`，存到「下载」目录 |
| 库 | 扫描 `Rusted Warfare/mods/units`，列出目录与 `.rwmod` 的文件数与体积 |
| 设置 | 市场地址、游戏目录、文件访问授权、关于 |

刻意没做的：

- **预设切换**：手机上一般只有一套 Mod 组合，做多预设只增加理解成本
- **自更新**：直接重新下 APK；在应用内更新需要额外的签名与分发校验
- **扩展管理**：`.pplx` 的运行时是 JVM agent，Android 是 dex，两套东西；
  界面里不提供入口，免得点进去发现什么都不生效

## 构建

需要 JDK 17 与 Android SDK（compileSdk 35）。仓库里没有提交 Gradle Wrapper，
用系统 Gradle 8.9 即可：

```bash
cd apps/android
gradle :app:assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

CI 里由 `.github/workflows/release.yml` 的 `android` 任务构建，
产物重命名为 `Pixel-Pine-Launcher-<tag>-android.apk` 后随 Release 一起发布。

## 权限

- `INTERNET`：市场接口
- `MANAGE_EXTERNAL_STORAGE`（Android 11+）/ `READ_EXTERNAL_STORAGE`（≤ 10）：
  读游戏的 `mods/units`。库页会引导去系统设置授权，没授权时明确说明原因，不做静默失败
