//! 地图库：扫描 `mods/maps` 下的 `.tmx`。
//!
//! TMX 是 Tiled 的 XML 格式，`<map>` 标签上就有地图尺寸。
//! 只读文件开头一小段就能拿到，不需要把整张图解析成 DOM——
//! 一张 8MB 的地图也只是读几 KB。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;

/// 一张地图。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameMap {
    /// 文件名（不含扩展名）。
    pub name: String,
    /// 完整路径。
    pub path: PathBuf,
    /// 宽（格）。
    pub width: Option<u32>,
    /// 高（格）。
    pub height: Option<u32>,
    /// 文件体积。
    pub size: u64,
    /// 是否存在同名预览图 `<name>_map.png`。
    pub has_preview: bool,
}

impl GameMap {
    /// 尺寸标签，例如 `64 × 64`；解析失败时返回 `None`。
    pub fn size_label(&self) -> Option<String> {
        match (self.width, self.height) {
            (Some(width), Some(height)) => Some(format!("{width} × {height}")),
            _ => None,
        }
    }
}

/// TMX 里读取的地图尺寸。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TmxSize {
    /// 宽。
    pub width: u32,
    /// 高。
    pub height: u32,
}

/// 扫描地图目录。
pub fn scan_maps(maps_dir: &Path) -> Result<Vec<GameMap>> {
    let mut maps = Vec::new();
    if !maps_dir.is_dir() {
        return Ok(maps);
    }

    for entry in std::fs::read_dir(maps_dir)? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if file_name.starts_with('.') {
            continue;
        }
        if !file_name.to_ascii_lowercase().ends_with(".tmx") {
            continue;
        }

        let name = file_name
            .trim_end_matches(".tmx")
            .trim_end_matches(".TMX")
            .to_string();

        let size = path.metadata().map(|meta| meta.len()).unwrap_or(0);
        let parsed = read_tmx_size(&path).ok().flatten();

        maps.push(GameMap {
            name: name.clone(),
            path: path.clone(),
            width: parsed.map(|value| value.width),
            height: parsed.map(|value| value.height),
            size,
            has_preview: maps_dir.join(format!("{name}_map.png")).is_file(),
        });
    }

    maps.sort_by_key(|item| item.name.to_lowercase());
    Ok(maps)
}

/// 只读文件开头，解析 `<map>` 标签的 `width` / `height`。
pub fn read_tmx_size(path: &Path) -> Result<Option<TmxSize>> {
    use std::io::Read;

    let mut file = std::fs::File::open(path)?;
    // 8KB 足够覆盖 XML 声明 + 注释 + map 标签
    let mut buffer = vec![0u8; 8 * 1024];
    let read = file.read(&mut buffer)?;
    buffer.truncate(read);
    let text = String::from_utf8_lossy(&buffer);

    let Some(start) = text.find("<map") else {
        return Ok(None);
    };
    let rest = &text[start..];
    let Some(end) = rest.find('>') else {
        return Ok(None);
    };
    let tag = &rest[..end];

    match (attr(tag, "width"), attr(tag, "height")) {
        (Some(width), Some(height)) => Ok(Some(TmxSize { width, height })),
        _ => Ok(None),
    }
}

/// 从标签里取一个整数属性，兼容单双引号。
fn attr(tag: &str, key: &str) -> Option<u32> {
    let pattern = format!("{key}=\"");
    let start = tag
        .find(&pattern)
        .map(|index| index + pattern.len())
        .or_else(|| {
            let pattern = format!("{key}='");
            tag.find(&pattern).map(|index| index + pattern.len())
        })?;
    let rest = &tag[start..];
    let end = rest.find(['"', '\''])?;
    rest[..end].trim().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ppl-maps-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("创建临时目录");
        dir
    }

    #[test]
    fn parses_map_size() {
        let dir = temp_dir("size");
        let path = dir.join("crossroads.tmx");
        std::fs::write(
            &path,
            r#"<?xml version="1.0" encoding="UTF-8"?>
<map version="1.0" orientation="orthogonal" width="64" height="48" tilewidth="16" tileheight="16">
 <layer name="Ground" width="64" height="48"/>
</map>"#,
        )
        .expect("写地图");

        let size = read_tmx_size(&path).expect("读取").expect("应有尺寸");
        assert_eq!(
            size,
            TmxSize {
                width: 64,
                height: 48
            }
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn scans_directory_with_preview() {
        let dir = temp_dir("scan");
        std::fs::write(dir.join("a.tmx"), r#"<map width="32" height="32"/>"#).expect("写地图");
        std::fs::write(dir.join("a_map.png"), b"\x89PNG").expect("写预览");
        std::fs::write(dir.join("readme.txt"), b"hi").expect("写杂项");

        let maps = scan_maps(&dir).expect("扫描");
        assert_eq!(maps.len(), 1);
        assert_eq!(maps[0].name, "a");
        assert!(maps[0].has_preview);
        assert_eq!(maps[0].size_label().as_deref(), Some("32 × 32"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn tolerates_broken_tmx() {
        let dir = temp_dir("broken");
        std::fs::write(dir.join("bad.tmx"), b"not xml at all").expect("写文件");
        let maps = scan_maps(&dir).expect("扫描");
        assert_eq!(maps.len(), 1);
        assert!(maps[0].width.is_none());

        let _ = std::fs::remove_dir_all(dir);
    }
}
