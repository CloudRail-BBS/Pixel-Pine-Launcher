//! 内容指纹。
//!
//! 铁锈战争的 Mod 没有版本号，判断「是不是同一个包」「内容有没有变过」
//! 只能靠自身内容算指纹。这里用中央目录里的 `name + size + crc32` 聚合，
//! **不解压**——一个 200MB 的包也能在毫秒级算完。

use sha2::{Digest, Sha256};

use crate::validate::EntryInfo;

/// 计算内容指纹，格式 `sha256:<hex>`。
///
/// 文件名统一小写、按字典序排序，保证同一份内容在不同机器上得到同一结果。
pub fn content_fingerprint(entries: &[EntryInfo]) -> String {
    let mut files: Vec<&EntryInfo> = entries.iter().filter(|entry| !entry.is_dir).collect();
    files.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
    });

    let mut hasher = Sha256::new();
    for entry in files {
        hasher.update(entry.name.to_ascii_lowercase().as_bytes());
        hasher.update(b"\0");
        hasher.update(entry.size.to_le_bytes());
        hasher.update(entry.crc32.to_le_bytes());
        hasher.update(b"\n");
    }

    format!("sha256:{}", to_hex(&hasher.finalize()))
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, size: u64, crc: u32) -> EntryInfo {
        EntryInfo {
            name: name.to_string(),
            size,
            compressed: size,
            crc32: crc,
            is_dir: false,
        }
    }

    #[test]
    fn stable_regardless_of_order() {
        let a = vec![entry("b.ini", 1, 2), entry("a.ini", 3, 4)];
        let b = vec![entry("a.ini", 3, 4), entry("b.ini", 1, 2)];
        assert_eq!(content_fingerprint(&a), content_fingerprint(&b));
        assert!(content_fingerprint(&a).starts_with("sha256:"));
    }

    #[test]
    fn changes_with_content() {
        let a = vec![entry("a.ini", 1, 2)];
        let b = vec![entry("a.ini", 1, 3)];
        assert_ne!(content_fingerprint(&a), content_fingerprint(&b));
    }

    #[test]
    fn ignores_directories() {
        let mut dir = entry("units/", 0, 0);
        dir.is_dir = true;
        let a = vec![entry("a.ini", 1, 2), dir];
        let b = vec![entry("a.ini", 1, 2)];
        assert_eq!(content_fingerprint(&a), content_fingerprint(&b));
    }
}
