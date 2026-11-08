//! Loadout（作战预设）——本项目的核心概念。
//!
//! 游戏只认一个 `mods/units` 目录，所有 Mod 混在一起。PPL 的做法是：
//! 真实文件放在自己的存储区，`mods/units` 只是一个**目录联接**指向当前预设。
//! 切换预设 = 重建一次联接，零拷贝、毫秒级（方案 §4.3）。
//!
//! 平台差异被封在 `create_link` / `remove_link` 后面，上层完全无感：
//! - Windows：NTFS junction，不需要管理员权限
//! - macOS / Linux：符号链接
//! - 其他情况：由调用方降级为复制（本 crate 暂不实现）

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// 资源来源。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageSource {
    /// 来自资源市场。
    Market,
    /// 用户本地导入。
    Local,
}

fn default_true() -> bool {
    true
}

/// 预设里的一项资源。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadoutPackage {
    /// 资源 id。
    pub id: String,
    /// 版本号，本地导入可能为空。
    #[serde(default)]
    pub version: String,
    /// 来源。
    pub source: PackageSource,
    /// 存储区里的目录名，例如 `modern-war@2.3.1`。
    pub dir: String,
    /// 是否启用。禁用只改这里，不动文件。
    #[serde(default = "default_true")]
    pub enabled: bool,
}

/// 一套预设。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Loadout {
    /// 数据版本。
    #[serde(default = "default_schema")]
    pub schema: u32,
    /// id，也是存储目录名。
    pub id: String,
    /// 展示名。
    pub name: String,
    /// 资源列表。
    #[serde(default)]
    pub packages: Vec<LoadoutPackage>,
    /// 关联地图（文件名）。
    #[serde(default)]
    pub maps: Vec<String>,
    /// 启动参数。
    #[serde(default)]
    pub args: Vec<String>,
    /// 图标（文件路径或内联 data URI）。
    #[serde(default)]
    pub icon: Option<String>,
}

fn default_schema() -> u32 {
    1
}

impl Loadout {
    /// 新建空预设。
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            schema: 1,
            id: id.into(),
            name: name.into(),
            packages: Vec::new(),
            maps: Vec::new(),
            args: Vec::new(),
            icon: None,
        }
    }

    /// 启用的资源。
    pub fn enabled_packages(&self) -> impl Iterator<Item = &LoadoutPackage> {
        self.packages.iter().filter(|package| package.enabled)
    }

    /// 切换某一项的启用状态，返回是否找到。
    pub fn set_enabled(&mut self, package_id: &str, enabled: bool) -> bool {
        match self
            .packages
            .iter_mut()
            .find(|package| package.id == package_id)
        {
            Some(package) => {
                package.enabled = enabled;
                true
            }
            None => false,
        }
    }

    /// 移除一项，返回是否找到。
    pub fn remove_package(&mut self, package_id: &str) -> bool {
        let before = self.packages.len();
        self.packages.retain(|package| package.id != package_id);
        before != self.packages.len()
    }

    /// 加入或替换同 id 的资源。
    pub fn upsert_package(&mut self, package: LoadoutPackage) {
        match self
            .packages
            .iter_mut()
            .find(|existing| existing.id == package.id)
        {
            Some(existing) => *existing = package,
            None => self.packages.push(package),
        }
    }
}

/// `mods/units` 的当前状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkStatus {
    /// 不存在，可以接管。
    Absent,
    /// 指向预设的链接，归 PPL 管。
    Managed,
    /// 真实目录，里面可能是玩家手动装的 Mod。
    ForeignDirectory,
}

/// 预设存储。
#[derive(Debug, Clone)]
pub struct LoadoutStore {
    root: PathBuf,
}

impl LoadoutStore {
    /// 指定根目录。
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// 使用默认数据目录。
    pub fn default_store() -> Self {
        Self::new(crate::paths::loadouts_root())
    }

    /// 存储根目录。
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// 某个预设的目录。
    pub fn dir(&self, id: &str) -> PathBuf {
        self.root.join(id)
    }

    /// 建目录。
    pub fn ensure(&self) -> Result<()> {
        std::fs::create_dir_all(&self.root)?;
        Ok(())
    }

    /// 列出全部预设。
    pub fn list(&self) -> Result<Vec<Loadout>> {
        let mut loadouts = Vec::new();
        if !self.root.is_dir() {
            return Ok(loadouts);
        }
        for entry in std::fs::read_dir(&self.root)? {
            let entry = entry?;
            if !entry.path().is_dir() {
                continue;
            }
            let manifest = entry.path().join("loadout.json");
            if !manifest.is_file() {
                continue;
            }
            // 单个坏配置不该让整个列表消失
            if let Ok(loadout) = self.load_from(&manifest) {
                loadouts.push(loadout);
            }
        }
        loadouts.sort_by_key(|loadout| loadout.name.to_lowercase());
        Ok(loadouts)
    }

    /// 读取一个预设。
    pub fn load(&self, id: &str) -> Result<Loadout> {
        let manifest = self.dir(id).join("loadout.json");
        if !manifest.is_file() {
            return Err(Error::LoadoutNotFound(id.to_string()));
        }
        self.load_from(&manifest)
    }

    fn load_from(&self, manifest: &Path) -> Result<Loadout> {
        let text = std::fs::read_to_string(manifest)?;
        Ok(serde_json::from_str(&text)?)
    }

    /// 写入预设。
    pub fn save(&self, loadout: &Loadout) -> Result<()> {
        let dir = self.dir(&loadout.id);
        std::fs::create_dir_all(&dir)?;
        let json = serde_json::to_string_pretty(loadout)?;
        std::fs::write(dir.join("loadout.json"), json)?;
        Ok(())
    }

    /// 新建预设。
    pub fn create(&self, id: impl Into<String>, name: impl Into<String>) -> Result<Loadout> {
        let loadout = Loadout::new(id, name);
        self.save(&loadout)?;
        Ok(loadout)
    }

    /// 删除预设（只删 manifest 与目录，不动里面的文件由调用方决定）。
    pub fn remove(&self, id: &str) -> Result<()> {
        let dir = self.dir(id);
        if !dir.is_dir() {
            return Err(Error::LoadoutNotFound(id.to_string()));
        }
        std::fs::remove_dir_all(dir)?;
        Ok(())
    }

    /// `mods/units` 的路径。
    pub fn units_link(game_root: &Path) -> PathBuf {
        game_root.join("mods").join("units")
    }

    /// 查看当前接管状态。
    pub fn link_status(&self, game_root: &Path) -> LinkStatus {
        let link = Self::units_link(game_root);
        if is_link(&link) {
            return LinkStatus::Managed;
        }
        if link.exists() {
            return LinkStatus::ForeignDirectory;
        }
        LinkStatus::Absent
    }

    /// 把预设挂到游戏目录。
    ///
    /// 返回 `mods/units` 路径。若该处已是真实目录（玩家手动装的 Mod），
    /// 直接报错而不是删掉——数据无价。
    pub fn attach(&self, game_root: &Path, id: &str) -> Result<PathBuf> {
        let target = self.dir(id);
        if !target.is_dir() {
            return Err(Error::LoadoutNotFound(id.to_string()));
        }

        let mods = game_root.join("mods");
        std::fs::create_dir_all(&mods)?;
        let link = mods.join("units");

        match self.link_status(game_root) {
            LinkStatus::Managed => remove_link(&link)?,
            LinkStatus::ForeignDirectory => return Err(Error::UnitsOccupied(link)),
            LinkStatus::Absent => {}
        }

        create_link(&target, &link)?;
        Ok(link)
    }

    /// 解除挂载。返回是否真的移除了一条链接。
    pub fn detach(&self, game_root: &Path) -> Result<bool> {
        let link = Self::units_link(game_root);
        if is_link(&link) {
            remove_link(&link)?;
            return Ok(true);
        }
        Ok(false)
    }
}

#[cfg(windows)]
fn is_link(path: &Path) -> bool {
    junction::exists(path).unwrap_or(false)
        || std::fs::symlink_metadata(path)
            .map(|meta| meta.file_type().is_symlink())
            .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_link(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
}

#[cfg(windows)]
fn create_link(target: &Path, link: &Path) -> Result<()> {
    junction::create(target, link)?;
    Ok(())
}

#[cfg(not(windows))]
fn create_link(target: &Path, link: &Path) -> Result<()> {
    std::os::unix::fs::symlink(target, link)?;
    Ok(())
}

#[cfg(windows)]
fn remove_link(link: &Path) -> Result<()> {
    // 注意：`FSCTL_DELETE_REPARSE_POINT` 只摘掉重解析点，
    // 会在原地留下一个**空目录**。不清掉它，下次 attach 会报 183（已存在）。
    // 这里留下的目录一定是空的，remove_dir 不会动到预设里的数据。
    junction::delete(link)?;
    if link.exists() {
        let _ = std::fs::remove_dir(link);
    }
    Ok(())
}

#[cfg(not(windows))]
fn remove_link(link: &Path) -> Result<()> {
    std::fs::remove_file(link)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ppl-loadout-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("创建临时目录");
        dir
    }

    #[test]
    fn attach_and_detach() {
        let base = temp_dir("attach");
        let store = LoadoutStore::new(base.join("loadouts"));
        store.ensure().expect("建存储");

        let loadout = store.create("modern-war", "现代战争").expect("建预设");
        // 预设目录里放一个假的 Mod 文件
        std::fs::write(store.dir(&loadout.id).join("demo.ini"), b"[unit]").expect("写文件");

        let game = base.join("game");
        std::fs::create_dir_all(&game).expect("建游戏目录");

        assert_eq!(store.link_status(&game), LinkStatus::Absent);
        let link = store.attach(&game, "modern-war").expect("挂载");
        assert_eq!(store.link_status(&game), LinkStatus::Managed);

        // 透过链接能读到预设里的文件
        let content = std::fs::read(link.join("demo.ini")).expect("读文件");
        assert_eq!(content, b"[unit]");

        assert!(store.detach(&game).expect("卸载"));
        assert_eq!(store.link_status(&game), LinkStatus::Absent);
        // 卸载只删链接，不删数据
        assert!(store.dir("modern-war").join("demo.ini").is_file());

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn refuses_to_take_over_real_directory() {
        let base = temp_dir("foreign");
        let store = LoadoutStore::new(base.join("loadouts"));
        store.create("x", "X").expect("建预设");

        let game = base.join("game");
        let units = game.join("mods").join("units");
        std::fs::create_dir_all(&units).expect("建 units 目录");

        assert_eq!(store.link_status(&game), LinkStatus::ForeignDirectory);
        let error = store.attach(&game, "x").expect_err("应拒绝");
        assert!(matches!(error, Error::UnitsOccupied(_)));
        // 玩家原来的目录必须还在
        assert!(units.is_dir());

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn switching_loadouts_keeps_data() {
        let base = temp_dir("switch");
        let store = LoadoutStore::new(base.join("loadouts"));
        store.create("a", "A").expect("建 A");
        store.create("b", "B").expect("建 B");
        std::fs::write(store.dir("a").join("a.ini"), b"a").expect("写 A");
        std::fs::write(store.dir("b").join("b.ini"), b"b").expect("写 B");

        let game = base.join("game");
        std::fs::create_dir_all(&game).expect("建游戏目录");

        store.attach(&game, "a").expect("挂 A");
        let link = LoadoutStore::units_link(&game);
        assert!(link.join("a.ini").is_file());

        store.attach(&game, "b").expect("挂 B");
        assert!(link.join("b.ini").is_file());
        assert!(!link.join("a.ini").exists());
        assert!(store.dir("a").join("a.ini").is_file(), "A 的数据不能丢");

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn package_manifest_operations() {
        let mut loadout = Loadout::new("x", "X");
        loadout.upsert_package(LoadoutPackage {
            id: "modern-war".into(),
            version: "2.3.1".into(),
            source: PackageSource::Market,
            dir: "modern-war@2.3.1".into(),
            enabled: true,
        });
        assert_eq!(loadout.enabled_packages().count(), 1);
        assert!(loadout.set_enabled("modern-war", false));
        assert_eq!(loadout.enabled_packages().count(), 0);
        assert!(loadout.remove_package("modern-war"));
        assert!(loadout.packages.is_empty());
    }
}
