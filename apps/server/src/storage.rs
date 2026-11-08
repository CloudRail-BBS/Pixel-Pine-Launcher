//! 资源包落盘。
//!
//! 目录结构 `storage/<slug>/<version>.rwmod`，对外通过 `/files` 静态提供。
//! 目前是本地磁盘，将来换对象存储只要替换这个模块，路由不用动。

use sha2::{Digest, Sha256};

use crate::config::Config;
use crate::error::ApiError;

/// 只留 ASCII 字母数字与 `- _ .`，其余替换成 `-`。
/// 版本号和 slug 都会被拼进路径，这里必须挡住 `..` 之类。
pub fn safe_segment(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(['.', '-', '_']).to_string();
    if trimmed.is_empty() {
        "package".to_string()
    } else {
        trimmed
    }
}

/// 保存资源包，返回（相对文件名，文件 sha256）。
pub fn save(
    config: &Config,
    slug: &str,
    version: &str,
    bytes: &[u8],
) -> Result<(String, String), ApiError> {
    let dir = config.storage_dir.join(safe_segment(slug));
    std::fs::create_dir_all(&dir)
        .map_err(|error| ApiError::internal(format!("创建存储目录失败：{error}")))?;

    let file_name = format!("{}.rwmod", safe_segment(version));
    let path = dir.join(&file_name);
    std::fs::write(&path, bytes)
        .map_err(|error| ApiError::internal(format!("写入资源包失败：{error}")))?;

    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let sha256 = hex::encode(hasher.finalize());

    Ok((file_name, sha256))
}

/// 下载地址。
pub fn download_url(config: &Config, slug: &str, file_name: &str) -> String {
    format!(
        "{}/files/{}/{}",
        config.public_base,
        safe_segment(slug),
        file_name
    )
}
