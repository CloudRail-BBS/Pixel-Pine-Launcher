//! 从本地导入资源包。
//!
//! 导入的目标**不是**游戏的 `mods/units`，而是预设的存储目录：
//! `mods/units` 只是指向预设的一条链接，所以往预设里放就等于把它装进这个组合。
//! 好处是同一个包可以在不同预设里各存一份、互不影响（方案 §4.5）。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::loadout::{LoadoutPackage, LoadoutStore, PackageSource};

/// 导入结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedPackage {
    /// 资源 id（由文件名推导）。
    pub id: String,
    /// 显示标题。
    pub title: String,
    /// 落在预设目录里的文件名。
    pub file: String,
    /// 字节数。
    pub size: u64,
    /// 单位数量。
    pub unit_count: usize,
}

/// 把一个 `.rwmod`（或 `.zip`）导入指定预设。
///
/// 同名会覆盖——重复导入同一个包是常见操作，报错反而碍事。
pub fn import_package(
    store: &LoadoutStore,
    loadout_id: &str,
    source: &Path,
) -> Result<ImportedPackage> {
    let stem = source
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "imported".to_string());
    import_inner(
        store,
        loadout_id,
        source,
        &sanitize(&stem),
        "local",
        PackageSource::Local,
    )
}

/// 从市场安装：id 用服务端 slug、版本用服务端版本、来源标为 market。
///
/// 版本要真的记下来，否则「已安装 / 可更新」永远判不出来。
/// 文件名带上版本号，同一包的两个版本可以在一个预设里共存。
pub fn install_from_path(
    store: &LoadoutStore,
    loadout_id: &str,
    source: &Path,
    id: &str,
    version: &str,
) -> Result<ImportedPackage> {
    import_inner(
        store,
        loadout_id,
        source,
        &sanitize(id),
        version,
        PackageSource::Market,
    )
}

fn import_inner(
    store: &LoadoutStore,
    loadout_id: &str,
    source: &Path,
    id: &str,
    version: &str,
    origin: PackageSource,
) -> Result<ImportedPackage> {
    if !source.is_file() {
        return Err(Error::NotPlayable(source.to_path_buf()));
    }

    // 先完整校验一遍再落盘：宁可拒收，也不要往用户目录里塞一个坏包
    let meta = ppl_package::scan_path(source)?;
    if meta.kind == ppl_package::PackageKind::Unknown {
        return Err(Error::InvalidPackage(
            "这个文件既不是 Mod 也不是地图包".to_string(),
        ));
    }

    let dir = store.dir(loadout_id);
    if !dir.is_dir() {
        return Err(Error::LoadoutNotFound(loadout_id.to_string()));
    }

    let file_name = match origin {
        PackageSource::Market => format!("{}@{}.rwmod", sanitize(id), sanitize(version)),
        PackageSource::Local => format!("{}.rwmod", sanitize(id)),
    };
    let dest = dir.join(&file_name);
    std::fs::copy(source, &dest)?;

    let mut loadout = store.load(loadout_id)?;
    loadout.upsert_package(LoadoutPackage {
        id: id.to_string(),
        version: version.to_string(),
        source: origin,
        dir: file_name.clone(),
        enabled: true,
    });
    store.save(&loadout)?;

    let title = if meta.title.trim().is_empty() {
        id.to_string()
    } else {
        meta.title.clone()
    };

    Ok(ImportedPackage {
        id: id.to_string(),
        title,
        file: file_name,
        size: meta.package_size,
        unit_count: meta.unit_count,
    })
}

/// 把文件名清洗成安全的目录/文件片段。
///
/// Windows 上 `\ / : * ? " < > |` 都不能进文件名；中文要保留。
fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| {
            if ch.is_control() || ch == ' ' || "\\/:*?\"<>|".contains(ch) {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(['_', '.']).to_string();
    if trimmed.is_empty() {
        "imported".to_string()
    } else {
        trimmed
    }
}

/// 批量导入，逐个返回结果；单个失败不影响其余。
pub fn import_many(
    store: &LoadoutStore,
    loadout_id: &str,
    sources: &[PathBuf],
) -> Vec<std::result::Result<ImportedPackage, String>> {
    sources
        .iter()
        .map(|path| {
            import_package(store, loadout_id, path)
                .map_err(|error| format!("{}：{}", path.display(), error))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ppl-import-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("创建临时目录");
        dir
    }

    fn write_rwmod(path: &Path) {
        let file = std::fs::File::create(path).expect("建包");
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("mod-info.txt", SimpleFileOptions::default())
            .expect("条目");
        writer
            .write_all("[mod]\ntitle:导入测试\ndescription:测试用\n".as_bytes())
            .expect("写元数据");
        writer
            .start_file("units/tank/tank.ini", SimpleFileOptions::default())
            .expect("条目");
        writer.write_all(b"[unit]\nname:tank\n").expect("写单位");
        writer.finish().expect("收尾");
    }

    #[test]
    fn imports_into_loadout_store() {
        let base = temp_dir("ok");
        let store = LoadoutStore::new(base.join("loadouts"));
        store.create("modern-war", "现代战争").expect("建预设");

        let source = base.join("现代战争 v2.3.rwmod");
        write_rwmod(&source);

        let imported = import_package(&store, "modern-war", &source).expect("导入");
        assert_eq!(imported.title, "导入测试");
        assert_eq!(imported.unit_count, 1);
        assert_eq!(imported.file, "现代战争_v2.3.rwmod");
        assert!(store.dir("modern-war").join(&imported.file).is_file());

        let loadout = store.load("modern-war").expect("读预设");
        assert_eq!(loadout.packages.len(), 1);
        assert_eq!(loadout.packages[0].source, PackageSource::Local);

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn rejects_garbage_file() {
        let base = temp_dir("bad");
        let store = LoadoutStore::new(base.join("loadouts"));
        store.create("x", "X").expect("建预设");

        let source = base.join("broken.rwmod");
        std::fs::write(&source, b"not a zip").expect("写文件");

        let error = import_package(&store, "x", &source).expect_err("应拒绝");
        assert!(matches!(error, Error::Package(_)));

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn sanitizes_windows_illegal_chars() {
        assert_eq!(sanitize("a/b:c*d"), "a_b_c_d");
        assert_eq!(sanitize("  "), "imported");
        assert_eq!(sanitize("现代 战争"), "现代_战争");
    }
}
