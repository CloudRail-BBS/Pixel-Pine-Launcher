//! # ppl-package
//!
//! 铁锈战争资源包（`.rwmod` / 地图包）的解析、指纹与安全校验。
//!
//! 这个 crate 被**客户端和服务端同时依赖**：客户端扫描本地 Mod 用的是它，
//! 服务端审核上传也用它。规则只写一遍，就不会出现「本地能装、上传被拒」
//! 这种两头不一致的情况。
//!
//! ## 能力
//!
//! - [`scan_path`] / [`scan_reader`]：只读 zip 中央目录，取出标题、单位数、封面
//! - [`content_fingerprint`]：`name + size + crc32` 聚合指纹，不解压
//! - [`validate_entries`]：路径穿越、可执行文件、体积与压缩比检查
//!
//! ## 示例
//!
//! ```no_run
//! use ppl_package::scan_path;
//!
//! let meta = scan_path("现代战争.rwmod".as_ref())?;
//! println!("{}（{} 个单位，{}）", meta.title, meta.unit_count, meta.content_hash);
//! # Ok::<(), ppl_package::PackageError>(())
//! ```

mod error;
mod fingerprint;
mod mod_info;
mod scan;
mod validate;

pub use error::{PackageError, Result};
pub use fingerprint::content_fingerprint;
pub use mod_info::{ModInfo, decode_text};
pub use scan::{PackageKind, PackageMeta, scan_path, scan_reader, scan_with_limits};
pub use validate::{EntryInfo, Issue, IssueLevel, Limits, ValidationReport, validate_entries};
