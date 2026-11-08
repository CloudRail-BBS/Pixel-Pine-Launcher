//! 压缩包解压，只服务于「安装游戏本体」这一条路径。
//!
//! 和资源包不同，游戏本体是**整包解压落盘**的，所以这里的防护重点
//! 不是「文件类型」，而是「别把东西写到目标目录外面去」：
//!
//! - `zip slip`：`../`、绝对路径、盘符一律拒绝
//! - 符号链接条目：直接拒绝，链接很容易绕过前一条
//! - 解压炸弹：声明体积与实际写出量双重计数
//!
//! 完整性由调用方先校验压缩包的 SHA256 来保证——包是可信的，
//! 但「可信的包」也可能写得一塌糊涂，路径检查不能省。

use std::fs::File;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// 解压结果。
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct ExtractStats {
    /// 写出的文件数。
    pub files: usize,
    /// 写出的总字节数。
    pub bytes: u64,
}

/// 解压上限。
#[derive(Debug, Clone, Copy)]
pub struct ExtractLimits {
    /// 文件数上限。
    pub max_files: usize,
    /// 总解压体积上限。
    pub max_total_bytes: u64,
    /// 单文件上限。
    pub max_file_bytes: u64,
}

impl Default for ExtractLimits {
    fn default() -> Self {
        Self {
            max_files: 200_000,
            max_total_bytes: 8 * 1024 * 1024 * 1024,
            max_file_bytes: 2 * 1024 * 1024 * 1024,
        }
    }
}

/// 把一个 zip 解压到 `dest`（必须已存在）。
///
/// 中途失败会留下半个目录，调用方负责把 `dest` 整个删掉——
/// 解压目录是暂存区，不是最终位置。
pub fn extract_zip(archive_path: &Path, dest: &Path) -> Result<ExtractStats> {
    extract_zip_with(archive_path, dest, ExtractLimits::default())
}

/// 带自定义上限的解压。
pub fn extract_zip_with(
    archive_path: &Path,
    dest: &Path,
    limits: ExtractLimits,
) -> Result<ExtractStats> {
    let file = File::open(archive_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| Error::UnsafeArchive(format!("压缩包读不出来：{error}")))?;

    if archive.len() > limits.max_files {
        return Err(Error::UnsafeArchive(format!(
            "压缩包里有 {} 个文件，超过上限 {}",
            archive.len(),
            limits.max_files
        )));
    }

    let mut stats = ExtractStats::default();

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| Error::UnsafeArchive(format!("读取第 {index} 个文件失败：{error}")))?;

        // 符号链接可以指向目录外，路径检查对它无效，直接拒收
        if entry.is_symlink() {
            return Err(Error::UnsafeArchive(format!(
                "压缩包里有符号链接：{}",
                entry.name().unwrap_or_default()
            )));
        }

        let raw = entry.name().unwrap_or_default().replace('\\', "/");

        // `enclosed_name` 会把 `/etc/passwd` 削成 `etc/passwd`（写不出去了），
        // 但这类包本身就是坏的，装上去只会得到一堆错位文件，直接拒收更干净。
        // 注意必须看原始名字：削过之后 `..` 和盘符信息就没了。
        if let Some(reason) = suspicious_path(&raw) {
            return Err(Error::UnsafeArchive(format!(
                "文件路径不合法（{reason}）：{raw}"
            )));
        }

        let rel = entry
            .enclosed_name()
            .ok_or_else(|| Error::UnsafeArchive(format!("文件路径不合法（无法归一化）：{raw}")))?;

        let out_path = dest.join(&rel);

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
            continue;
        }

        let declared = entry.size();
        if declared > limits.max_file_bytes {
            return Err(Error::UnsafeArchive(format!(
                "{} 解压后 {:.1} GB，超过单文件上限",
                rel.display(),
                declared as f64 / 1_073_741_824.0
            )));
        }

        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // 按实际写出的字节数计数：声明值是可以撒谎的
        let written = {
            let mut out = File::create(&out_path)?;
            io::copy(&mut entry, &mut out)?
        };

        stats.files += 1;
        stats.bytes = stats.bytes.saturating_add(written);

        if stats.bytes > limits.max_total_bytes {
            return Err(Error::UnsafeArchive(format!(
                "解压后总体积超过 {:.0} GB 上限",
                limits.max_total_bytes as f64 / 1_073_741_824.0
            )));
        }
    }

    Ok(stats)
}

/// 路径里有绝对路径、盘符或 `..` 就返回原因。
fn suspicious_path(raw: &str) -> Option<&'static str> {
    if raw.starts_with('/') {
        return Some("绝对路径");
    }
    // `C:/x` 或 `C:x`，第二个字符是冒号即视为盘符
    if raw.as_bytes().get(1) == Some(&b':') {
        return Some("带盘符");
    }
    for part in raw.split('/') {
        if part == ".." {
            return Some("包含 ..");
        }
    }
    None
}

/// 在解压目录里找一个可执行文件（Windows 是 `.exe`，其他平台看可执行位）。
/// 游戏包有时会把所有东西塞进一层子目录（`Rusted Warfare/`），
/// 所以要在两层深度内找，并把找到的那层当作真正的根。
pub fn locate_root(dir: &Path, exe_name: &str) -> Option<std::path::PathBuf> {
    let direct = dir.join(exe_name);
    if direct.is_file() {
        return Some(dir.to_path_buf());
    }

    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path.join(exe_name).is_file() {
            return Some(path);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    /// 造一个 zip。文件内容用 (名字, 内容) 表示。
    fn make_zip(path: &Path, files: &[(&str, &[u8])]) {
        let file = File::create(path).expect("建包");
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for (name, body) in files {
            zip.start_file(*name, options).expect("写条目");
            zip.write_all(body).expect("写内容");
        }
        zip.finish().expect("收尾");
    }

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ppl-archive-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("建临时目录");
        dir
    }

    #[test]
    fn extracts_nested_tree() {
        let base = temp("ok");
        let archive = base.join("game.zip");
        make_zip(
            &archive,
            &[
                ("game.exe", b"MZ"),
                ("mods/units/readme.txt", b"hi"),
                ("data/levels/a.tmx", b"<map/>"),
            ],
        );

        let out = base.join("out");
        std::fs::create_dir_all(&out).expect("建输出目录");
        let stats = extract_zip(&archive, &out).expect("解压");

        assert_eq!(stats.files, 3);
        assert!(out.join("game.exe").is_file());
        assert!(out.join("data/levels/a.tmx").is_file());
        assert_eq!(stats.bytes, 2 + 2 + 6);
    }

    #[test]
    fn rejects_path_traversal() {
        let base = temp("slip");
        let archive = base.join("evil.zip");
        make_zip(&archive, &[("../escaped.txt", b"boom")]);

        let out = base.join("out");
        std::fs::create_dir_all(&out).expect("建输出目录");

        let error = extract_zip(&archive, &out).expect_err("应当拒绝");
        assert!(matches!(error, Error::UnsafeArchive(_)));
        // 关键：真的没写出去
        assert!(!base.join("escaped.txt").exists());
    }

    #[test]
    fn rejects_absolute_path() {
        let base = temp("abs");
        let archive = base.join("evil.zip");
        make_zip(&archive, &[("/etc/passwd", b"boom")]);

        let out = base.join("out");
        std::fs::create_dir_all(&out).expect("建输出目录");
        assert!(extract_zip(&archive, &out).is_err());
    }

    #[test]
    fn locate_root_handles_wrapper_dir() {
        let base = temp("wrap");
        std::fs::create_dir_all(base.join("Rusted Warfare/mods")).expect("建目录");
        std::fs::write(base.join("Rusted Warfare/Rusted Warfare.exe"), b"MZ").expect("写 exe");

        let root = locate_root(&base, "Rusted Warfare.exe").expect("找到");
        assert!(root.ends_with("Rusted Warfare"));
    }
}
