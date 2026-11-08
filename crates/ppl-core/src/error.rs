//! 内核统一错误类型。

use std::path::PathBuf;

/// 内核操作错误。
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// 文件系统错误。
    #[error("文件操作失败：{0}")]
    Io(#[from] std::io::Error),

    /// 资源包解析错误。
    #[error("{0}")]
    Package(#[from] ppl_package::PackageError),

    /// 配置读写错误。
    #[error("配置读写失败：{0}")]
    Json(#[from] serde_json::Error),

    /// 目录里没找到可执行文件。
    #[error("{} 下没有找到《铁锈战争》可执行文件", .0.display())]
    NotPlayable(PathBuf),

    /// `mods/units` 已是真实目录（可能装着玩家的 Mod），不能强行接管。
    #[error("{} 已经是普通目录，可能存放着你手动安装的 Mod；请先备份再让 PPL 接管", .0.display())]
    UnitsOccupied(PathBuf),

    /// 预设不存在。
    #[error("找不到预设：{0}")]
    LoadoutNotFound(String),

    /// 文件不是有效的资源包。
    #[error("不是有效的资源包：{0}")]
    InvalidPackage(String),

    /// 指定名称的 Mod 不存在。
    #[error("找不到 Mod：{0}")]
    ModNotFound(String),

    /// 压缩包内容不安全（路径穿越、符号链接、解压炸弹）。
    #[error("{0}")]
    UnsafeArchive(String),

    /// 安装目标已被占用。
    #[error("{} 里已经有文件，不会覆盖", .0.display())]
    GameTargetOccupied(PathBuf),

    /// 校验值对不上。
    #[error("文件校验失败：期望 {expected}，实际 {actual}")]
    HashMismatch {
        /// 清单里写的值。
        expected: String,
        /// 实际算出来的值。
        actual: String,
    },

    /// 找不到这个扩展。
    #[error("找不到扩展：{0}")]
    ExtensionNotFound(String),

    /// 版本清单格式不对。
    #[error("版本清单有问题：{0}")]
    Manifest(String),
}

/// 内核统一 `Result`。
pub type Result<T> = std::result::Result<T, Error>;
