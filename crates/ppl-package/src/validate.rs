//! 资源包安全校验。
//!
//! `.rwmod` 本质上就是一个 zip，因此天然是投毒载体：塞个 `setup.exe`、
//! 用 `../` 做路径穿越、或者做个解压炸弹，都能骗过只看后缀的检查。
//!
//! 这套规则**同时被客户端本地扫描和服务端上传校验使用**（同一个 crate），
//! 目的就是不让两边的判定标准发生漂移。

use serde::{Deserialize, Serialize};

/// 单个 zip 条目的元数据，取自中央目录，不需要解压。
#[derive(Debug, Clone)]
pub struct EntryInfo {
    /// 条目名，已把反斜杠统一成正斜杠。
    pub name: String,
    /// 解压后大小。
    pub size: u64,
    /// 压缩后大小。
    pub compressed: u64,
    /// 内容 CRC32，可直接用作轻量指纹。
    pub crc32: u32,
    /// 是否为目录条目。
    pub is_dir: bool,
}

/// 校验阈值。默认值按方案 §4.6 的约定，服务端可配置。
#[derive(Debug, Clone)]
pub struct Limits {
    /// 整个包的压缩后体积上限。
    pub max_package_bytes: u64,
    /// 单文件解压后上限。
    pub max_entry_bytes: u64,
    /// 全部文件解压后总量上限。
    pub max_unpacked_bytes: u64,
    /// 单文件压缩比上限，超过视为可疑。
    pub max_compression_ratio: f64,
    /// 条目数上限。
    pub max_entries: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_package_bytes: 200 * 1024 * 1024,
            max_entry_bytes: 64 * 1024 * 1024,
            max_unpacked_bytes: 512 * 1024 * 1024,
            max_compression_ratio: 200.0,
            max_entries: 20_000,
        }
    }
}

/// 问题等级。`Error` 直接拒收，`Warning` 只提示。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueLevel {
    /// 拒收。
    Error,
    /// 提示，不阻断。
    Warning,
}

/// 一条校验结论。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    /// 等级。
    pub level: IssueLevel,
    /// 机器可读的原因码，便于服务端落库与前端做文案映射。
    pub code: String,
    /// 给用户看的中文说明。
    pub message: String,
}

/// 校验报告。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ValidationReport {
    /// 全部结论。
    pub issues: Vec<Issue>,
}

impl ValidationReport {
    /// 是否存在阻断性问题。
    pub fn is_ok(&self) -> bool {
        !self
            .issues
            .iter()
            .any(|issue| issue.level == IssueLevel::Error)
    }

    /// 所有错误信息拼接，用于直接展示。
    pub fn error_summary(&self) -> Option<String> {
        let errors: Vec<&str> = self
            .issues
            .iter()
            .filter(|issue| issue.level == IssueLevel::Error)
            .map(|issue| issue.message.as_str())
            .collect();
        if errors.is_empty() {
            None
        } else {
            Some(errors.join("；"))
        }
    }

    fn push(&mut self, level: IssueLevel, code: &'static str, message: impl Into<String>) {
        self.issues.push(Issue {
            level,
            code: code.to_string(),
            message: message.into(),
        });
    }
}

/// 允许出现在资源包里的扩展名。
const ALLOWED_EXTS: &[&str] = &[
    "ini", "txt", "tmx", "png", "jpg", "jpeg", "ogg", "wav", "json", "md",
];

/// 明确的危险扩展名，命中即拒收。
const BLOCKED_EXTS: &[&str] = &[
    "exe",
    "dll",
    "bat",
    "cmd",
    "ps1",
    "sh",
    "jar",
    "msi",
    "scr",
    "com",
    "vbs",
    "js",
    "lnk",
    "pif",
    "application",
    "app",
    "apk",
    "dylib",
    "so",
];

/// 校验条目集合。
pub fn validate_entries(
    entries: &[EntryInfo],
    package_bytes: u64,
    limits: &Limits,
) -> ValidationReport {
    let mut report = ValidationReport::default();

    if package_bytes > limits.max_package_bytes {
        report.push(
            IssueLevel::Error,
            "package_too_large",
            format!(
                "资源包体积 {} 超过上限 {}",
                human_bytes(package_bytes),
                human_bytes(limits.max_package_bytes)
            ),
        );
    }

    if entries.len() > limits.max_entries {
        report.push(
            IssueLevel::Error,
            "too_many_entries",
            format!("文件数 {} 超过上限 {}", entries.len(), limits.max_entries),
        );
    }

    let mut total_unpacked: u64 = 0;
    let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let mut has_mod_info = false;
    let mut has_map = false;

    for entry in entries {
        // 路径穿越：绝对路径、盘符、`..` 一律拒收
        if let Some(reason) = path_traversal_reason(&entry.name) {
            report.push(
                IssueLevel::Error,
                "zip_slip",
                format!("文件路径不合法（{}）：{}", reason, entry.name),
            );
            continue;
        }

        if entry.is_dir {
            continue;
        }

        if !seen.insert(entry.name.as_str()) {
            report.push(
                IssueLevel::Warning,
                "duplicate_entry",
                format!("重复文件：{}", entry.name),
            );
        }

        total_unpacked = total_unpacked.saturating_add(entry.size);

        let ext = extension_of(&entry.name);
        if let Some(ext) = ext {
            if BLOCKED_EXTS.contains(&ext) {
                report.push(
                    IssueLevel::Error,
                    "blocked_extension",
                    format!("资源包内不允许包含可执行文件：{}", entry.name),
                );
            } else if !ALLOWED_EXTS.contains(&ext) {
                report.push(
                    IssueLevel::Warning,
                    "unknown_extension",
                    format!("未识别的文件类型（.{}）：{}", ext, entry.name),
                );
            }
        }

        if entry.size > limits.max_entry_bytes {
            report.push(
                IssueLevel::Error,
                "entry_too_large",
                format!(
                    "单文件 {} 超过上限 {}",
                    entry.name,
                    human_bytes(limits.max_entry_bytes)
                ),
            );
        }

        // 压缩比异常：解压炸弹的典型特征
        if entry.compressed > 0 {
            let ratio = entry.size as f64 / entry.compressed as f64;
            if ratio > limits.max_compression_ratio {
                report.push(
                    IssueLevel::Warning,
                    "high_compression_ratio",
                    format!("{} 压缩比 {:.0}:1，高得不太正常", entry.name, ratio),
                );
            }
        }

        let lower = entry.name.to_ascii_lowercase();
        // 兼容两种布局：根目录直接放，或包在一个文件夹里（玩家打包习惯）
        if lower == "mod-info.txt" || lower.ends_with("/mod-info.txt") {
            has_mod_info = true;
        }
        if lower.ends_with(".tmx") {
            has_map = true;
        }
    }

    if total_unpacked > limits.max_unpacked_bytes {
        report.push(
            IssueLevel::Error,
            "unpacked_too_large",
            format!(
                "解压后总体积 {} 超过上限 {}",
                human_bytes(total_unpacked),
                human_bytes(limits.max_unpacked_bytes)
            ),
        );
    }

    if !has_mod_info && !has_map {
        report.push(
            IssueLevel::Error,
            "not_a_package",
            "既没有 mod-info.txt 也没有地图文件，无法识别为资源包",
        );
    }

    report
}

/// 检查路径是否可安全解压到目标目录内。
fn path_traversal_reason(name: &str) -> Option<&'static str> {
    if name.is_empty() {
        return Some("空文件名");
    }
    // 绝对路径 / UNC
    if name.starts_with('/') || name.starts_with("\\\\") {
        return Some("绝对路径");
    }
    // 盘符，例如 C:/
    let bytes = name.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && (bytes[0] as char).is_ascii_alphabetic() {
        return Some("包含盘符");
    }
    // 任一段为 `..`
    if name.split(['/', '\\']).any(|segment| segment == "..") {
        return Some("包含上级目录引用");
    }
    if name.chars().any(|c| c.is_control()) {
        return Some("包含控制字符");
    }
    None
}

/// 取小写扩展名。
fn extension_of(name: &str) -> Option<&str> {
    let file = name.rsplit(['/', '\\']).next()?;
    let (_, ext) = file.rsplit_once('.')?;
    if ext.is_empty() {
        return None;
    }
    Some(ext)
}

/// 人类可读的体积。
fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{} {}", bytes, UNITS[unit])
    } else {
        format!("{:.1} {}", value, UNITS[unit])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, size: u64) -> EntryInfo {
        EntryInfo {
            name: name.to_string(),
            size,
            compressed: size,
            crc32: 0,
            is_dir: false,
        }
    }

    #[test]
    fn accepts_normal_mod() {
        let entries = vec![
            entry("mod-info.txt", 120),
            entry("all-units.template", 300),
            entry("units/tank/tank.ini", 2048),
            entry("units/tank/tank.png", 4096),
        ];
        let report = validate_entries(&entries, 10_000, &Limits::default());
        assert!(report.is_ok(), "{:?}", report.issues);
    }

    #[test]
    fn rejects_executable() {
        let entries = vec![entry("mod-info.txt", 10), entry("units/a/setup.exe", 10)];
        let report = validate_entries(&entries, 100, &Limits::default());
        assert!(!report.is_ok());
        assert!(report.error_summary().unwrap().contains("可执行文件"));
    }

    #[test]
    fn rejects_zip_slip() {
        for name in [
            "../evil.ini",
            "/etc/passwd",
            "C:/win.ini",
            "units/../../x.ini",
        ] {
            let entries = vec![entry("mod-info.txt", 10), entry(name, 10)];
            let report = validate_entries(&entries, 100, &Limits::default());
            assert!(!report.is_ok(), "{name} 应被拒收");
        }
    }

    #[test]
    fn rejects_unknown_content() {
        let entries = vec![entry("readme.md", 10)];
        let report = validate_entries(&entries, 100, &Limits::default());
        assert!(!report.is_ok());
        assert_eq!(report.issues[0].code, "not_a_package");
    }

    #[test]
    fn warns_on_high_ratio() {
        let entries = vec![
            entry("mod-info.txt", 10),
            EntryInfo {
                name: "units/a/huge.png".into(),
                size: 50_000_000,
                compressed: 1000,
                crc32: 0,
                is_dir: false,
            },
        ];
        let report = validate_entries(&entries, 2000, &Limits::default());
        assert!(report.is_ok());
        assert!(
            report
                .issues
                .iter()
                .any(|issue| issue.code == "high_compression_ratio")
        );
    }

    #[test]
    fn rejects_oversized_package() {
        let entries = vec![entry("mod-info.txt", 10)];
        let report = validate_entries(&entries, 300 * 1024 * 1024, &Limits::default());
        assert!(!report.is_ok());
        assert_eq!(report.issues[0].code, "package_too_large");
    }
}
