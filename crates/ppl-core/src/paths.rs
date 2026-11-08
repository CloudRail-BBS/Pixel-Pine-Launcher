//! 应用数据目录。
//!
//! 约定：**用户数据不写在游戏目录里**。游戏目录只放一个链接，
//! 这样 Steam 装在 `Program Files` 时也不会因为权限问题崩掉（方案 §4.3）。

use std::path::PathBuf;

/// PPL 的数据根目录。
///
/// - Windows：`%LOCALAPPDATA%\PixelPine`
/// - macOS：`~/Library/Application Support/PixelPine`
/// - Linux：`$XDG_DATA_HOME/pixelpine`（默认 `~/.local/share/pixelpine`）
pub fn data_root() -> PathBuf {
    #[cfg(windows)]
    {
        match std::env::var_os("LOCALAPPDATA") {
            Some(base) => PathBuf::from(base).join("PixelPine"),
            None => home_dir().join("AppData").join("Local").join("PixelPine"),
        }
    }

    #[cfg(target_os = "macos")]
    {
        home_dir()
            .join("Library")
            .join("Application Support")
            .join("PixelPine")
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        match std::env::var_os("XDG_DATA_HOME") {
            Some(base) => PathBuf::from(base).join("pixelpine"),
            None => home_dir().join(".local").join("share").join("pixelpine"),
        }
    }
}

/// 用户主目录。
pub fn home_dir() -> PathBuf {
    #[cfg(windows)]
    {
        match std::env::var_os("USERPROFILE") {
            Some(profile) => PathBuf::from(profile),
            None => PathBuf::from("."),
        }
    }

    #[cfg(not(windows))]
    {
        match std::env::var_os("HOME") {
            Some(home) => PathBuf::from(home),
            None => PathBuf::from("."),
        }
    }
}

/// 预设（Loadout）存储根目录。
pub fn loadouts_root() -> PathBuf {
    data_root().join("loadouts")
}

/// 实例配置文件目录。
pub fn instances_root() -> PathBuf {
    data_root().join("instances")
}

/// PPL 自己下载的游戏装在哪里。
///
/// 不往 Steam 目录里塞：那是 Steam 的地盘，混进去会让「验证文件完整性」
/// 和卸载都变得莫名其妙。用户的 Steam 版照旧由 Steam 管，两份互不干扰。
pub fn games_root() -> PathBuf {
    data_root().join("games")
}
