# Android 客户端

Kotlin + Jetpack Compose 原生实现，不套 WebView、不复用桌面端的 Tauri 壳。

## 现在有什么

| 页面 | 能力 |
|---|---|
| 市场 | 搜索、分页、详情、版本列表；**直接装进 `mods/units`**（地图落 `mods/maps`），带下载进度 |
| 库 | 扫描启用与停用两部分；单位数、体积、时间；**同名单位目录冲突提示**；开关启停 |
| 预设 | 从当前库新建、应用、删除、导入 / 导出（JSON 与桌面端同格式） |
| 设置 | 应用内更新、市场地址、游戏目录（含自动检测）、文件访问授权、关于 |

刻意没做的：

- **扩展管理**：`.pplx` 的运行时是 JVM agent，Android 是 dex，两套东西；
  界面里不提供入口，免得点进去发现什么都不生效
- **联机**：桌面端读的是游戏进程的内存快照，Android 上做不到

## 和桌面端怎么对齐

| 能力 | 桌面端 | Android |
|---|---|---|
| 市场 | 同一套 `/v1/packages` 接口 | 同左，服务器地址可改 |
| 启停 Mod | 在 `units/` 与 `units/.disabled/` 之间移动 | 同左，同一套目录约定 |
| 冲突判定 | 同名单位目录 | 同一套算法，只对启用中的 Mod 计算 |
| 预设 | `Loadout` JSON（`schema`/`id`/`name`/`packages`/`maps`/`args`/`icon`） | 同格式，可导入导出 |
| 更新 | Tauri updater + `latest.json` | GitHub Releases 的 APK，版本号逐段比较 |

预设之所以不用「重建目录联接」：Android 的外置存储（sdcardfs / exFAT）不支持符号链接，
`File.renameTo` 之外没有可靠办法。改成移动启停状态后效果等价、可逆，也一字节不动 Mod 文件。

## 版本号

`versionName` 与 `versionCode` **不写死**，构建时从 `apps/desktop/src-tauri/tauri.conf.json`
读取，发版时由标签覆盖：

```bash
gradle :app:assembleDebug -Pppl.version=0.1.4
```

- `versionCode = major*1_000_000 + minor*10_000 + patch*100`
- 0.1.3 → `10300`，高于旧包写死的 `10003`，老用户可以覆盖升级

写死的版本号会导致「应用内更新永远说已是最新」——这正是之前的问题。

## 应用内更新

设置页 → 更新 → 检查更新。流程：

1. 读 `https://api.github.com/repos/CloudRail-BBS/Pixel-Pine-Launcher/releases/latest`
2. 逐段比较数字版本（`0.1.10 > 0.1.9`）
3. 下载 `.apk` 到 `getExternalFilesDir(updates)`（每次先清旧包）
4. 经 `FileProvider` 交给系统安装器

需要系统「安装未知应用」授权；没授权时会跳到设置页并说明原因，不会静默失败。

## 构建

需要 JDK 17 与 Android SDK（compileSdk 35）。仓库里没有提交 Gradle Wrapper，
用系统 Gradle 8.9 即可：

```bash
cd apps/android
gradle :app:assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

CI 里由 `.github/workflows/ci.yml` 的 `android` 任务做编译校验，
`.github/workflows/release.yml` 的 `android` 任务在打标签时出包，
产物重命名为 `Pixel-Pine-Launcher-<tag>-android.apk` 后随 Release 一起发布。

## 权限

- `INTERNET`：市场接口与更新检查
- `REQUEST_INSTALL_PACKAGES`：应用内更新安装 APK
- `MANAGE_EXTERNAL_STORAGE`（Android 11+）/ `READ_EXTERNAL_STORAGE`（≤ 10）：
  读写游戏的 `mods/units`。库页会引导去系统设置授权，没授权时明确说明原因，不做静默失败

## 安装包签名

目前只发 debug 签名包（Actions 产物），仅供预览；正式分发前需要把签名密钥放进 CI。
