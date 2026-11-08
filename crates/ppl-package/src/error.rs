//! 统一的错误类型。
//!
//! 设计原则：错误要能直接展示给玩家，而不是让 UI 层再去翻译一遍
//! `io::Error` 的英文原文。因此 `Display` 全是中文短句 + 具体原因。

use std::path::PathBuf;

/// 资源包处理过程中的错误。
#[derive(Debug, thiserror::Error)]
pub enum PackageError {
    /// 文件读写失败。
    #[error("读取文件失败：{0}")]
    Io(#[from] std::io::Error),

    /// zip 结构损坏、加密或使用了不支持的压缩算法。
    #[error("压缩包损坏或格式不受支持：{0}")]
    Zip(#[from] zip::result::ZipError),

    /// 结构合法但不符合资源包约定。
    #[error("不是有效的资源包：{0}")]
    Invalid(String),

    /// 命中安全规则，直接拒收。
    #[error("安全校验未通过：{0}")]
    Unsafe(String),

    /// 路径无法访问。
    #[error("路径不可访问：{}", .0.display())]
    Path(PathBuf),
}

/// 本 crate 的统一 `Result`。
pub type Result<T> = std::result::Result<T, PackageError>;
