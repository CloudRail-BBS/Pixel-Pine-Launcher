//! `mod-info.txt` 解析。
//!
//! 铁锈战争的 Mod 元数据只有这一个文件，格式是「INI 风格 + 冒号分隔」，
//! 且**没有 id、没有版本号**——这是整个市场体系必须先解决的问题（见方案 §1）。
//!
//! 现实约束（都是踩过的坑）：
//! - 国内 Mod 大量使用 GBK 编码，直接按 UTF-8 读会得到乱码；
//! - `description` 经常跨多行；
//! - 字段名大小写不统一（`minVersion` / `minversion`）；
//! - 缺字段是常态，不能当错误处理。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// 从 `mod-info.txt` 解析出的元数据。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModInfo {
    /// 显示标题。
    pub title: String,
    /// 简介，可能包含换行。
    pub description: String,
    /// 可加载的最低游戏版本，例如 `v1.15`。
    pub min_version: Option<String>,
    /// 其余字段原样保留，方便将来扩展而不改结构。
    pub extra: BTreeMap<String, String>,
}

impl ModInfo {
    /// 从原始字节解析，自动处理 BOM 与 GBK。
    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self::parse_str(&decode_text(bytes))
    }

    /// 从已解码的文本解析。
    pub fn parse_str(text: &str) -> Self {
        let mut info = ModInfo::default();
        // 当前所在 section，`None` 表示还没遇到任何 section
        let mut section: Option<String> = None;
        let mut seen_section = false;
        // 上一个键，用于识别多行续写
        let mut last_key: Option<String> = None;

        for raw in text.lines() {
            let line = raw.trim_end_matches('\r').trim();
            if line.is_empty() {
                continue;
            }

            // [section]
            if line.starts_with('[') && line.ends_with(']') && line.len() >= 2 {
                seen_section = true;
                section = Some(line[1..line.len() - 1].trim().to_ascii_lowercase());
                last_key = None;
                continue;
            }

            let in_mod = match &section {
                Some(name) => name == "mod",
                // 整个文件没有 section 头时，视作顶级即为 mod
                None => !seen_section,
            };
            if !in_mod {
                last_key = None;
                continue;
            }

            match split_key_value(line) {
                Some((key, value)) => {
                    let normalized = key.to_ascii_lowercase();
                    match normalized.as_str() {
                        "title" => info.title = value.trim().to_string(),
                        "description" => info.description = value.trim().to_string(),
                        "minversion" | "min_version" => {
                            info.min_version = Some(value.trim().to_string());
                        }
                        _ => {
                            info.extra.insert(key.to_string(), value.trim().to_string());
                        }
                    }
                    last_key = Some(normalized);
                }
                None => {
                    // 没有冒号的行：如果紧跟 description，就当作续行
                    if last_key.as_deref() == Some("description") && !info.description.is_empty() {
                        info.description.push('\n');
                        info.description.push_str(line);
                    }
                }
            }
        }

        info
    }

    /// 标题为空时给一个兜底显示名，避免界面上出现空白卡片。
    pub fn display_title(&self, fallback: &str) -> String {
        if self.title.trim().is_empty() {
            fallback.to_string()
        } else {
            self.title.trim().to_string()
        }
    }
}

/// 解码文本：优先 UTF-8（含 BOM），失败回退 GBK。
pub fn decode_text(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        // `decode` 内部对非法序列使用替换字符，不会 panic
        Err(_) => encoding_rs::GBK.decode(bytes).0.into_owned(),
    }
}

/// 拆分 `key:value`，要求 key 不含空白，避免把 `标题:xxx` 这类正文误判为字段。
fn split_key_value(line: &str) -> Option<(&str, &str)> {
    let idx = line.find(':')?;
    let key = line[..idx].trim();
    if key.is_empty() || key.len() > 32 {
        return None;
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    Some((key, &line[idx + 1..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_standard_block() {
        let text = "\u{feff}[mod]\nminVersion:v1.15\ntitle:现代战争\ndescription:一个大型模组\n";
        let info = ModInfo::parse_str(text);
        assert_eq!(info.title, "现代战争");
        assert_eq!(info.description, "一个大型模组");
        assert_eq!(info.min_version.as_deref(), Some("v1.15"));
    }

    #[test]
    fn keeps_multiline_description() {
        let text = "[mod]\ntitle:T\ndescription:第一行\n第二行\n第三行\n";
        let info = ModInfo::parse_str(text);
        assert_eq!(info.description, "第一行\n第二行\n第三行");
    }

    #[test]
    fn ignores_other_sections() {
        let text = "[mod]\ntitle:Real\n[music]\ntitle:NotThis\n";
        let info = ModInfo::parse_str(text);
        assert_eq!(info.title, "Real");
    }

    #[test]
    fn falls_back_to_gbk() {
        // "标题" 的 GBK 编码
        let gbk = [0xB1, 0xEA, 0xCC, 0xE2];
        let mut payload = b"title:".to_vec();
        payload.extend_from_slice(&gbk);
        assert_eq!(decode_text(&payload), "title:标题");
    }

    #[test]
    fn keeps_unknown_fields() {
        let text = "[mod]\ntitle:T\nmusic:battle.ogg\n";
        let info = ModInfo::parse_str(text);
        assert_eq!(
            info.extra.get("music").map(String::as_str),
            Some("battle.ogg")
        );
    }
}
