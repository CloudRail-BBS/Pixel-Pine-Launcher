## Pixel-Pine-Launcher 0.1.2 预览版

这一版把安装包补齐到了三个平台，并把审核后台的登录从「邮箱验证码」换成了**密码**。

### 新增

- **Linux / macOS 安装包**
  - Linux x64：`.AppImage`（免安装）与 `.deb`
  - macOS：Apple 芯片（arm64）与 Intel（x64）各一份 `.dmg`
  - 三平台共用同一套自动更新通道，`latest.json` 里各平台的条目一次发全
- **macOS 游戏包识别**：游戏是 `Rusted Warfare.app`，启动器会自动换算到包内的
  `Contents/MacOS`，`mods/units` 挂在可执行文件旁边，和 Windows 的行为对齐
- **Linux 原生二进制识别**：没有 `.exe` 后缀的 `RustedWarfare` 也能认出来

### 变更

- **审核后台改为密码登录**：`/admin/` 现在是「邮箱 + 密码」。
  - 服务端用 `PPL_ADMIN_PASSWORD` 配置，支持明文或 PBKDF2-SHA256 哈希
  - 配置了密码之后，邮箱验证码登录**不再带管理员角色**——
    否则「能收到那个邮箱的信」就等于绕过了密码
  - 连续 5 次密码错误锁定 15 分钟，按来源 IP 计
- 客户端普通用户仍然是邮箱验证码登录，不受影响

### 已知限制

- **macOS 包没有代码签名**（没有 Apple 开发者证书）。首次打开需要
  `右键 → 打开`，或在终端执行
  `xattr -dr com.apple.quarantine /Applications/Pixel-Pine-Launcher.app`
- **Linux 包在 Ubuntu 22.04 上构建**，需要 glibc ≥ 2.35；更老的发行版请用 AppImage
- macOS 上的 Mod 挂载依赖对 `.app` 包内目录的写权限，若游戏来自 App Store
  沙盒版本可能失败；Steam 版不受影响
- 预览版固定走 pre-release 通道，不会自动升级到后续正式版

### 安装

| 平台 | 下载 |
|---|---|
| Windows x64 | `Pixel-Pine-Launcher_0.1.2_x64-setup.exe`，装到当前用户目录，不需要管理员权限 |
| Linux x64 | `*.AppImage`（`chmod +x` 后直接运行）或 `*.deb` |
| macOS arm64 | `Pixel-Pine-Launcher_0.1.2_aarch64.dmg` |
| macOS x64 | `Pixel-Pine-Launcher_0.1.2_x64.dmg` |

Windows 与 macOS 都会提示「未知发布者 / 无法验证开发者」，原因是预览版没有购买
代码签名证书。
