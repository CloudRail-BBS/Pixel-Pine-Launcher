//! 本地资源库：扫描 `mods/units` 下的 Mod。
//!
//! 兼容两种现实形态：`.rwmod` 打包文件，以及直接摊开的文件夹。
//! 后者在老玩家手里非常常见，不能只认 `.rwmod`。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;

/// 扫描到的一个本地 Mod。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMod {
    /// 目录名或文件名（不含扩展名）。
    pub name: String,
    /// 完整路径。
    pub path: PathBuf,
    /// 显示标题。
    pub title: String,
    /// 单位数量。
    pub unit_count: usize,
    /// 单位目录名清单，用于冲突预检。
    #[serde(default)]
    pub unit_dirs: Vec<String>,
    /// 是否为打包文件（`.rwmod` / `.zip`）。
    pub packaged: bool,
    /// 体积（字节）。
    pub size: u64,
    /// 内容指纹，仅打包文件可算。
    pub content_hash: Option<String>,
    /// 声明的最低游戏版本。
    pub min_version: Option<String>,
    /// 是否启用。禁用时文件被移入 `mods/units/.disabled/`。
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

/// 被禁用的 Mod 存放目录。游戏不会读取以点开头的目录。
pub const DISABLED_DIR: &str = ".disabled";

/// 扫描目录下的所有 Mod。
///
/// 单个条目出错只跳过它，不影响其余结果——玩家的目录里什么都有。
pub fn scan_units(units_dir: &Path) -> Result<Vec<LocalMod>> {
    let mut mods = Vec::new();
    if !units_dir.is_dir() {
        return Ok(mods);
    }

    for entry in std::fs::read_dir(units_dir)? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy().into_owned();

        // 跳过点开头的条目：既有 `.disabled` 这种自己的目录，
        // 也有 macOS 的 `__MACOSX`、`.DS_Store` 之类垃圾。
        // 不跳过的话，`.disabled` 会因为内含子目录的 mod-info.txt 被误认成一个 Mod。
        if name.starts_with('.') || name.eq_ignore_ascii_case("__MACOSX") {
            continue;
        }

        if path.is_dir() {
            if let Some(local) = scan_folder(&name, &path) {
                mods.push(local);
            }
            continue;
        }

        let lower = name.to_ascii_lowercase();
        if !(lower.ends_with(".rwmod") || lower.ends_with(".zip")) {
            continue;
        }
        if let Some(local) = scan_package_file(&name, &path) {
            mods.push(local);
        }
    }

    mods.sort_by_key(|item| item.title.to_lowercase());
    Ok(mods)
}

/// 扫描「启用 + 禁用」两部分。
///
/// 禁用不是删除，而是把条目移进 `mods/units/.disabled/`。
/// 游戏只读 `units/` 下一层，点开头的目录会被忽略，所以这样做既生效又可逆。
pub fn scan_units_with_disabled(units_dir: &Path) -> Result<Vec<LocalMod>> {
    let mut mods = scan_units(units_dir)?;
    let disabled_dir = units_dir.join(DISABLED_DIR);
    if disabled_dir.is_dir() {
        let mut disabled = scan_units(&disabled_dir)?;
        for item in &mut disabled {
            item.enabled = false;
        }
        mods.extend(disabled);
    }
    mods.sort_by_key(|item| (item.title.to_lowercase(), !item.enabled));
    Ok(mods)
}

/// 启用或禁用某个 Mod（文件级移动，可逆）。
pub fn set_mod_enabled(units_dir: &Path, name: &str, enabled: bool) -> Result<()> {
    let disabled_dir = units_dir.join(DISABLED_DIR);
    let (from, to) = if enabled {
        (disabled_dir.join(name), units_dir.join(name))
    } else {
        (units_dir.join(name), disabled_dir.join(name))
    };

    if !from.exists() {
        return Err(crate::Error::ModNotFound(name.to_string()));
    }
    if enabled {
        std::fs::create_dir_all(units_dir)?;
    } else {
        std::fs::create_dir_all(&disabled_dir)?;
    }
    std::fs::rename(&from, &to)?;
    Ok(())
}

fn scan_package_file(name: &str, path: &Path) -> Option<LocalMod> {
    let meta = ppl_package::scan_path(path).ok()?;
    let stem = Path::new(name)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_string());

    let title = if meta.title.trim().is_empty() {
        stem.clone()
    } else {
        meta.title.clone()
    };

    Some(LocalMod {
        name: stem.clone(),
        path: path.to_path_buf(),
        title,
        unit_count: meta.unit_count,
        unit_dirs: meta.unit_dirs,
        packaged: true,
        size: meta.package_size,
        content_hash: Some(meta.content_hash),
        min_version: meta.min_version,
        enabled: true,
    })
}

fn scan_folder(name: &str, path: &Path) -> Option<LocalMod> {
    // 文件夹形态：找 mod-info.txt（根目录或一层之内）
    let info_path = find_mod_info(path)?;
    let bytes = std::fs::read(&info_path).ok()?;
    let info = ppl_package::ModInfo::from_bytes(&bytes);

    // 单位目录：看 `units/` 下的子目录，或直接数一级子目录
    let units_root = if path.join("units").is_dir() {
        path.join("units")
    } else {
        path.to_path_buf()
    };
    let unit_dirs: Vec<String> = std::fs::read_dir(&units_root)
        .map(|entries| {
            let mut dirs: Vec<String> = entries
                .flatten()
                .filter(|entry| entry.path().is_dir())
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect();
            dirs.sort();
            dirs
        })
        .unwrap_or_default();
    let unit_count = unit_dirs.len();

    Some(LocalMod {
        name: name.to_string(),
        path: path.to_path_buf(),
        title: info.display_title(name),
        unit_count,
        unit_dirs,
        packaged: false,
        size: dir_size(path),
        content_hash: None,
        min_version: info.min_version,
        enabled: true,
    })
}

fn find_mod_info(dir: &Path) -> Option<PathBuf> {
    let direct = dir.join("mod-info.txt");
    if direct.is_file() {
        return Some(direct);
    }
    // 常见错误：压缩包解压后多套了一层同名目录
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let nested = path.join("mod-info.txt");
            if nested.is_file() {
                return Some(nested);
            }
        }
    }
    None
}

fn dir_size(dir: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            total += dir_size(&path);
        } else if let Ok(meta) = path.metadata() {
            total += meta.len();
        }
    }
    total
}

/// 一个冲突：某个 Mod 与另一个 Mod 存在同名单位目录。#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conflict {
    /// 出问题的 Mod 名。
    pub name: String,
    /// 与之冲突的 Mod 标题。
    pub with: String,
    /// 冲突的单位目录（最多列几个，避免刷屏）。
    pub dirs: Vec<String>,
}

/// 找出同名单位目录的冲突。
///
/// 游戏按 `units/<目录名>/` 识别单位，同名目录会被后加载的覆盖。
/// 这是纯文件名运算，万级规模也是毫秒级。
pub fn detect_conflicts(mods: &[LocalMod]) -> Vec<Conflict> {
    use std::collections::HashMap;

    // 目录名（小写）→ 拥有它的 Mod 下标
    let mut owners: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, item) in mods.iter().enumerate() {
        for dir in &item.unit_dirs {
            owners.entry(dir.to_lowercase()).or_default().push(index);
        }
    }

    let mut conflicts: Vec<Conflict> = Vec::new();
    for (index, item) in mods.iter().enumerate() {
        let mut shared: Vec<(String, usize)> = Vec::new();
        for dir in &item.unit_dirs {
            let key = dir.to_lowercase();
            if let Some(list) = owners.get(&key)
                && let Some(&other) = list.iter().find(|&&owner| owner != index)
            {
                shared.push((dir.clone(), other));
            }
        }
        if shared.is_empty() {
            continue;
        }
        let with = mods[shared[0].1].title.clone();
        let mut dirs: Vec<String> = shared.into_iter().map(|(dir, _)| dir).collect();
        dirs.sort();
        dirs.dedup();
        dirs.truncate(5);
        conflicts.push(Conflict {
            name: item.name.clone(),
            with,
            dirs,
        });
    }
    conflicts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ppl-library-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("创建临时目录");
        dir
    }

    #[test]
    fn toggling_moves_between_units_and_disabled() {
        let dir = temp_dir("toggle");
        let mod_dir = dir.join("测试Mod");
        std::fs::create_dir_all(mod_dir.join("units").join("tank")).expect("建目录");
        std::fs::write(mod_dir.join("mod-info.txt"), b"[mod]\ntitle:Toggle\n").expect("写元数据");

        assert_eq!(scan_units_with_disabled(&dir).expect("扫描").len(), 1);

        set_mod_enabled(&dir, "测试Mod", false).expect("禁用");
        let mods = scan_units_with_disabled(&dir).expect("扫描");
        assert_eq!(mods.len(), 1);
        assert!(!mods[0].enabled);
        assert!(dir.join(DISABLED_DIR).join("测试Mod").is_dir());

        set_mod_enabled(&dir, "测试Mod", true).expect("启用");
        let mods = scan_units_with_disabled(&dir).expect("扫描");
        assert!(mods[0].enabled);
        // 文件本身没丢
        assert!(mod_dir.join("units").join("tank").is_dir());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn detects_shared_unit_dirs() {
        fn fake(name: &str, title: &str, dirs: &[&str]) -> LocalMod {
            LocalMod {
                name: name.to_string(),
                path: PathBuf::from("/tmp/fake"),
                title: title.to_string(),
                unit_count: dirs.len(),
                unit_dirs: dirs.iter().map(|dir| (*dir).to_string()).collect(),
                packaged: true,
                size: 0,
                content_hash: None,
                min_version: None,
                enabled: true,
            }
        }

        let mods = vec![
            fake("a", "甲", &["tank", "jeep"]),
            fake("b", "乙", &["TANK", "boat"]),
            fake("c", "丙", &["plane"]),
        ];
        let conflicts = detect_conflicts(&mods);
        assert_eq!(conflicts.len(), 2, "甲与乙都应与对方冲突");
        assert_eq!(conflicts[0].with, "乙");
        assert_eq!(conflicts[0].dirs, vec!["tank".to_string()]);
        assert_eq!(conflicts[1].with, "甲");
        assert!(conflicts.iter().all(|item| item.name != "c"));
    }

    #[test]
    fn scans_folder_mod() {
        let dir = temp_dir("folder");
        let mod_dir = dir.join("现代战争");
        std::fs::create_dir_all(mod_dir.join("units").join("tank")).expect("建目录");
        std::fs::write(mod_dir.join("mod-info.txt"), b"[mod]\ntitle:Mine\n").expect("写元数据");
        std::fs::write(mod_dir.join("units").join("tank").join("a.ini"), b"[unit]")
            .expect("写单位");

        let mods = scan_units(&dir).expect("扫描");
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].title, "Mine");
        assert_eq!(mods[0].unit_count, 1);
        assert!(!mods[0].packaged);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn skips_unrelated_entries() {
        let dir = temp_dir("skip");
        std::fs::create_dir_all(dir.join("noise")).expect("建目录");
        std::fs::write(dir.join("readme.txt"), b"hi").expect("写文件");

        let mods = scan_units(&dir).expect("扫描");
        assert!(mods.is_empty());

        let _ = std::fs::remove_dir_all(dir);
    }
}
