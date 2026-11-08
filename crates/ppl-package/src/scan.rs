//! 资源包扫描：只读中央目录，不完整解压。
//!
//! 一个 200MB 的 `.rwmod`，扫描耗时取决于条目数量而不是体积——
//! 这是市场列表能在滚动时实时出封面的原因。

use std::fs::File;
use std::io::{Read, Seek};
use std::path::Path;

use serde::{Deserialize, Serialize};
use zip::ZipArchive;

use crate::error::{PackageError, Result};
use crate::fingerprint::content_fingerprint;
use crate::mod_info::ModInfo;
use crate::validate::{EntryInfo, Issue, Limits, validate_entries};

/// 资源包类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageKind {
    /// 单位 Mod。
    Mod,
    /// 地图包。
    Map,
    /// 无法识别。
    Unknown,
}

/// 扫描结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageMeta {
    /// 类型。
    pub kind: PackageKind,
    /// 标题，来自 `mod-info.txt`，缺失时用文件名兜底。
    pub title: String,
    /// 简介。
    pub description: String,
    /// 可加载的最低游戏版本。
    pub min_version: Option<String>,
    /// 单位目录数量（`units/<id>/`）。
    pub unit_count: usize,
    /// 单位目录名清单，用于冲突预检（游戏按目录名识别单位）。
    #[serde(default)]
    pub unit_dirs: Vec<String>,
    /// 地图数量（`.tmx`）。
    pub map_count: usize,
    /// 文件总数。
    pub file_count: usize,
    /// 压缩包体积。
    pub package_size: u64,
    /// 解压后总体积。
    pub unpacked_size: u64,
    /// 内容指纹，`sha256:...`。
    pub content_hash: String,
    /// 建议用作封面的文件路径。
    pub cover: Option<String>,
    /// 是否包含 `mod-info.txt`。
    pub has_mod_info: bool,
    /// 是否包含 `all-units.template`。
    pub has_all_units_template: bool,
    /// 非阻断性提示。
    pub warnings: Vec<Issue>,
}

impl PackageMeta {
    /// 该包是否声明了最低游戏版本。
    pub fn requires_version(&self) -> Option<&str> {
        self.min_version.as_deref()
    }
}

/// 扫描磁盘上的资源包。
pub fn scan_path(path: &Path) -> Result<PackageMeta> {
    let file = File::open(path).map_err(|_| PackageError::Path(path.to_path_buf()))?;
    let size = file.metadata()?.len();
    let mut meta = scan_reader(file, size)?;
    if meta.title.trim().is_empty() {
        meta.title = path
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_else(|| "未命名资源".to_string());
    }
    Ok(meta)
}

/// 扫描任意可 Seek 的数据源（内存、文件、网络流落盘后的临时文件都行）。
pub fn scan_reader<R: Read + Seek>(reader: R, package_size: u64) -> Result<PackageMeta> {
    scan_with_limits(reader, package_size, &Limits::default())
}

/// 带自定义阈值的扫描。服务端上传校验用这个。
pub fn scan_with_limits<R: Read + Seek>(
    reader: R,
    package_size: u64,
    limits: &Limits,
) -> Result<PackageMeta> {
    let mut archive = ZipArchive::new(reader)?;

    let mut entries: Vec<EntryInfo> = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let file = archive.by_index(index)?;
        let name = file.name()?.replace('\\', "/");
        entries.push(EntryInfo {
            name,
            size: file.size(),
            compressed: file.compressed_size(),
            crc32: file.crc32(),
            is_dir: file.is_dir(),
        });
    }

    let report = validate_entries(&entries, package_size, limits);
    if let Some(summary) = report.error_summary() {
        return Err(PackageError::Unsafe(summary));
    }

    let mod_info_index = find_mod_info(&entries);
    let mod_info = match mod_info_index {
        Some(index) => {
            let mut file = archive.by_index(index)?;
            let mut buffer = Vec::new();
            // 元数据文件通常只有几 KB，这里不做额外限制
            file.read_to_end(&mut buffer)?;
            ModInfo::from_bytes(&buffer)
        }
        None => ModInfo::default(),
    };

    let unit_dirs = collect_unit_dirs(&entries);
    let unit_count = unit_dirs.len();
    let map_count = entries
        .iter()
        .filter(|entry| !entry.is_dir && entry.name.to_ascii_lowercase().ends_with(".tmx"))
        .count();

    let kind = if mod_info_index.is_some() || unit_count > 0 {
        PackageKind::Mod
    } else if map_count > 0 {
        PackageKind::Map
    } else {
        PackageKind::Unknown
    };

    Ok(PackageMeta {
        kind,
        title: mod_info.title.clone(),
        description: mod_info.description.clone(),
        min_version: mod_info.min_version.clone(),
        unit_count,
        unit_dirs,
        map_count,
        file_count: entries.iter().filter(|entry| !entry.is_dir).count(),
        package_size,
        unpacked_size: entries.iter().map(|entry| entry.size).sum(),
        content_hash: content_fingerprint(&entries),
        cover: pick_cover(&entries),
        has_mod_info: mod_info_index.is_some(),
        has_all_units_template: entries.iter().any(|entry| {
            !entry.is_dir
                && entry
                    .name
                    .to_ascii_lowercase()
                    .ends_with("all-units.template")
        }),
        warnings: report
            .issues
            .into_iter()
            .filter(|issue| issue.level == crate::validate::IssueLevel::Warning)
            .collect(),
    })
}

/// 找 `mod-info.txt`：优先根目录，其次最浅的一层。
fn find_mod_info(entries: &[EntryInfo]) -> Option<usize> {
    let mut best: Option<(usize, usize)> = None; // (深度, 索引)
    for (index, entry) in entries.iter().enumerate() {
        if entry.is_dir {
            continue;
        }
        let lower = entry.name.to_ascii_lowercase();
        if !lower.ends_with("mod-info.txt") {
            continue;
        }
        let depth = lower.matches('/').count();
        if best.is_none_or(|(current, _)| depth < current) {
            best = Some((depth, index));
        }
    }
    best.map(|(_, index)| index)
}

/// 收集单位目录名。
///
/// 兼容两种布局：`units/tank/tank.ini` 和 `我的Mod/units/tank/tank.ini`。
/// 保留原始大小写（游戏按目录名匹配），但用于比对时调用方应转小写。
fn collect_unit_dirs(entries: &[EntryInfo]) -> Vec<String> {
    let mut units: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for entry in entries {
        if entry.is_dir {
            continue;
        }
        let lower = entry.name.to_ascii_lowercase();
        let Some(pos) = lower.find("units/") else {
            continue;
        };
        let rest = &entry.name[pos + "units/".len()..];
        // 需要形如 `<unit>/<file>`，只有目录名没有文件的不算
        if let Some((unit, _file)) = rest.split_once('/')
            && !unit.is_empty()
        {
            units.insert(unit.to_string());
        }
    }
    units.into_iter().collect()
}

/// 挑封面：优先根目录下、非 `*_map.png`、体积适中的 png。
fn pick_cover(entries: &[EntryInfo]) -> Option<String> {
    const MAX_COVER_BYTES: u64 = 4 * 1024 * 1024;

    let mut candidates: Vec<(usize, usize, &str)> = Vec::new();
    let mut map_previews: Vec<(usize, &str)> = Vec::new();

    for entry in entries {
        if entry.is_dir || entry.size == 0 || entry.size > MAX_COVER_BYTES {
            continue;
        }
        let lower = entry.name.to_ascii_lowercase();
        if !lower.ends_with(".png") {
            continue;
        }
        let depth = lower.matches('/').count();
        if lower.ends_with("_map.png") {
            map_previews.push((depth, entry.name.as_str()));
        } else {
            candidates.push((depth, entry.size as usize, entry.name.as_str()));
        }
    }

    if let Some((_, _, name)) = candidates.into_iter().min_by_key(|(depth, size, name)| {
        // 先浅后小，再按名字稳定排序
        (*depth, *size, name.to_string())
    }) {
        return Some(name.to_string());
    }

    map_previews
        .into_iter()
        .min_by_key(|(depth, name)| (*depth, name.to_string()))
        .map(|(_, name)| name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;

    fn build_zip(files: &[(&str, &[u8])]) -> (Cursor<Vec<u8>>, u64) {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            for (name, content) in files {
                writer
                    .start_file(*name, SimpleFileOptions::default())
                    .expect("创建条目");
                writer.write_all(content).expect("写入条目");
            }
            writer.finish().expect("完成写入");
        }
        let bytes = buffer.into_inner();
        let size = bytes.len() as u64;
        (Cursor::new(bytes), size)
    }

    #[test]
    fn scans_a_normal_mod() {
        let (reader, size) = build_zip(&[
            (
                "mod-info.txt",
                "[mod]\nminVersion:v1.15\ntitle:现代战争\ndescription:大型模组\n".as_bytes(),
            ),
            ("all-units.template", b"[global]\n".as_slice()),
            ("units/tank/tank.ini", "[unit]\nname:坦克\n".as_bytes()),
            ("units/tank/tank.png", &[0x89, 0x50, 0x4E, 0x47]),
        ]);

        let meta = scan_reader(reader, size).expect("扫描应成功");
        assert_eq!(meta.kind, PackageKind::Mod);
        assert_eq!(meta.title, "现代战争");
        assert_eq!(meta.unit_count, 1);
        assert_eq!(meta.file_count, 4);
        assert!(meta.has_mod_info);
        assert!(meta.has_all_units_template);
        assert_eq!(meta.cover.as_deref(), Some("units/tank/tank.png"));
    }

    #[test]
    fn scans_a_map_package() {
        let (reader, size) = build_zip(&[
            ("maps/crossroads.tmx", b"<map width=\"64\"/>".as_slice()),
            ("maps/crossroads_map.png", &[0x89, 0x50]),
        ]);
        let meta = scan_reader(reader, size).expect("扫描应成功");
        assert_eq!(meta.kind, PackageKind::Map);
        assert_eq!(meta.map_count, 1);
        assert_eq!(meta.cover.as_deref(), Some("maps/crossroads_map.png"));
    }

    #[test]
    fn rejects_malicious_package() {
        let (reader, size) = build_zip(&[
            ("mod-info.txt", b"[mod]\ntitle:x\n".as_slice()),
            ("../escape.ini", b"bad".as_slice()),
        ]);
        let error = scan_reader(reader, size).expect_err("应被拒收");
        assert!(matches!(error, PackageError::Unsafe(_)));
    }

    #[test]
    fn nested_mod_still_found() {
        let (reader, size) = build_zip(&[
            ("我的模组/mod-info.txt", b"[mod]\ntitle:Nested\n".as_slice()),
            ("我的模组/units/a/a.ini", b"[unit]\n".as_slice()),
        ]);
        let meta = scan_reader(reader, size).expect("扫描应成功");
        assert_eq!(meta.title, "Nested");
        assert_eq!(meta.unit_count, 1);
    }

    #[test]
    fn fingerprint_is_stable_across_scans() {
        let files: &[(&str, &[u8])] = &[
            ("mod-info.txt", b"[mod]\ntitle:x\n"),
            ("units/a/a.ini", b"[unit]\n"),
        ];
        let (r1, s1) = build_zip(files);
        let (r2, s2) = build_zip(files);
        let a = scan_reader(r1, s1).unwrap();
        let b = scan_reader(r2, s2).unwrap();
        assert_eq!(a.content_hash, b.content_hash);
    }
}
