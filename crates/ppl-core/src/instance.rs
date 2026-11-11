//! 游戏实例：发现、探测、启动。
//!
//! 「实例」= 一份可以独立启动的游戏目录。同一台机器上可以有多份
//! （Steam 一份、免安装一份、不同版本各一份），各自挂不同的预设。

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::paths;

/// 实例来源。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstanceSource {
    /// 从 Steam 库中发现。
    Steam,
    /// 免安装版本。
    Portable,
    /// 用户手动指定。
    Manual,
}

/// 一个游戏实例。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Instance {
    /// 稳定 id（由路径推导，移动目录后会变）。
    pub id: String,
    /// 展示名。
    pub name: String,
    /// 游戏根目录。
    pub root: PathBuf,
    /// 来源。
    pub source: InstanceSource,
    /// 游戏版本，暂时可能为空（读 exe 版本号属于 M0.5 待验证项）。
    #[serde(default)]
    pub version: Option<String>,
    /// 当前激活的预设 id。
    #[serde(default)]
    pub active_loadout: Option<String>,
}

/// 目录探测结果。
#[derive(Debug, Clone)]
pub struct Probe {
    /// 游戏根目录。
    pub root: PathBuf,
    /// 找到的可执行文件。
    pub exe: Option<PathBuf>,
    /// `mods` 目录路径。
    pub mods_dir: PathBuf,
    /// `mods` 目录是否存在。
    pub mods_exists: bool,
    /// 目录是否可写——写不了就装不了 Mod，必须提前告诉用户。
    pub writable: bool,
}

impl Probe {
    /// 能不能启动。
    pub fn is_playable(&self) -> bool {
        self.exe.is_some()
    }
}

/// 可能的可执行文件名（大小写不敏感匹配）。
///
/// 前两项是 Windows 的 exe，后两项是 Linux/Steam 的原生二进制（没有扩展名）。
const EXE_NAMES: &[&str] = &[
    "rusted warfare.exe",
    "rustedwarfare.exe",
    "rusted warfare",
    "rustedwarfare",
];

// macOS 的游戏是 `.app` 包，Steam 会把它装成 `Rusted Warfare.app`。
// 包结构由 `bundle_root` 负责换算，这里不参与名字匹配——
// 免得某个 Windows 用户把文件夹命名成 `foo.app` 就被误判成游戏。

impl Instance {
    /// 探测一个目录。
    pub fn probe(root: impl AsRef<Path>) -> Result<Probe> {
        let mut root = root.as_ref().to_path_buf();
        if root.is_file() {
            root.pop();
        }

        // macOS 的游戏是 `.app` 包。包本身不是能 spawn 的程序，
        // 而且它内部结构固定，所以先把根目录换算到包里的 `Contents/MacOS`，
        // 之后所有「可执行文件旁边就是 mods」的假设在三个平台上就一致了。
        if let Some(inner) = bundle_root(&root) {
            root = inner;
        }

        let exe = find_executable(&root);
        let mods_dir = root.join("mods");
        let mods_exists = mods_dir.is_dir();
        let writable = is_writable(if mods_exists { &mods_dir } else { &root });

        Ok(Probe {
            root,
            exe,
            mods_dir,
            mods_exists,
            writable,
        })
    }

    /// 从目录创建实例（不写磁盘）。
    pub fn from_root(root: impl AsRef<Path>, source: InstanceSource) -> Result<Self> {
        let probe = Self::probe(root)?;
        let root = probe.root.clone();
        let name = root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "铁锈战争".to_string());

        Ok(Self {
            id: instance_id(&root),
            name,
            root,
            source,
            version: None,
            active_loadout: None,
        })
    }

    /// 配置文件路径。
    pub fn config_path(&self) -> PathBuf {
        paths::instances_root().join(format!("{}.json", self.id))
    }

    /// 写入 `instance.json`。
    pub fn save(&self) -> Result<()> {
        let path = self.config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(path, json)?;
        Ok(())
    }

    /// 读取全部已保存的实例。
    pub fn load_all() -> Result<Vec<Instance>> {
        let dir = paths::instances_root();
        let mut instances = Vec::new();
        if !dir.is_dir() {
            return Ok(instances);
        }
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            // 单个坏文件不该拖垮整个列表
            if let Ok(text) = std::fs::read_to_string(&path)
                && let Ok(instance) = serde_json::from_str::<Instance>(&text)
            {
                instances.push(instance);
            }
        }
        instances.sort_by_key(|instance| instance.name.to_lowercase());
        Ok(instances)
    }

    /// 启动游戏。
    ///
    /// 工作目录必须设为游戏根目录，否则 Mod 的相对路径会解析到别处。
    /// 启动前会把扩展清单写到 `ppl/runtime/plan.json`，供运行时读取；
    /// 写清单失败不拦启动——没有扩展的玩家不该因为一个目录权限进不了游戏。
    pub fn launch(&self) -> Result<u32> {
        let probe = Self::probe(&self.root)?;
        let exe = probe
            .exe
            .ok_or_else(|| Error::NotPlayable(self.root.clone()))?;

        if let Err(error) = crate::extensions::write_runtime_plan(&self.root) {
            // 这里没有 logger，用 stderr 留痕：真出问题时至少能从启动日志看到
            eprintln!("[ppl] 写入扩展清单失败，继续启动：{error}");
        }

        let child = Command::new(&exe).current_dir(&self.root).spawn()?;
        Ok(child.id())
    }
}

/// 扫描常见位置，返回可用的实例。
pub fn discover() -> Vec<Instance> {
    let mut candidates: Vec<(PathBuf, InstanceSource)> = Vec::new();

    for library in steam_libraries() {
        candidates.push((
            library
                .join("steamapps")
                .join("common")
                .join("Rusted Warfare"),
            InstanceSource::Steam,
        ));
    }
    for path in portable_candidates() {
        candidates.push((path, InstanceSource::Portable));
    }

    let mut seen: Vec<PathBuf> = Vec::new();
    let mut found = Vec::new();
    for (path, source) in candidates {
        if !path.is_dir() {
            continue;
        }
        let canonical = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if seen.iter().any(|existing| existing == &canonical) {
            continue;
        }
        seen.push(canonical);
        if let Ok(instance) = Instance::from_root(&path, source)
            && Instance::probe(&instance.root)
                .map(|probe| probe.is_playable())
                .unwrap_or(false)
        {
            found.push(instance);
        }
    }
    found
}

/// 把 macOS `.app` 包换算成包内的 `Contents/MacOS`。
///
/// 两种入口都要认：用户直接选中 `Rusted Warfare.app`，
/// 或者选中装着这个包的 Steam 目录。
///
/// 不是 macOS 包就返回 `None`，调用方保持原路径——所以这个函数在
/// Windows / Linux 上只是白跑一次 `read_dir`。
fn bundle_root(root: &Path) -> Option<PathBuf> {
    if is_app_bundle(root) {
        let inner = root.join("Contents").join("MacOS");
        return inner.is_dir().then_some(inner);
    }

    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_app_bundle(&path) {
            continue;
        }
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if !name.starts_with("rusted") {
            continue;
        }
        let inner = path.join("Contents").join("MacOS");
        if inner.is_dir() {
            return Some(inner);
        }
    }
    None
}

fn is_app_bundle(path: &Path) -> bool {
    path.is_dir()
        && path
            .extension()
            .map(|ext| ext.eq_ignore_ascii_case("app"))
            .unwrap_or(false)
}

fn find_executable(root: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    let mut fallback: Option<PathBuf> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if EXE_NAMES.contains(&name.as_str()) {
            return Some(path);
        }
        // `.app` 包里的启动器名字千奇百怪（Java 打包常见 `JavaApplicationStub`），
        // 名字对不上时退而求其次：包内第一个可执行文件。
        if fallback.is_none() && name.starts_with("javaapplicationstub") {
            fallback = Some(path);
        }
    }

    fallback
}

fn is_writable(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let probe = dir.join(".ppl-write-test");
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(probe);
            true
        }
        Err(_) => false,
    }
}

/// 由路径推导稳定 id。
fn instance_id(root: &Path) -> String {
    let canonical = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let key = canonical.to_string_lossy().to_ascii_lowercase();
    // FNV-1a 32 位：够短、够稳，不追求抗碰撞
    let mut hash: u32 = 0x811c_9dc5;
    for byte in key.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(0x0100_0193);
    }
    format!("rw-{hash:08x}")
}

/// Steam 库目录（含 `steamapps` 的那些）。
fn steam_libraries() -> Vec<PathBuf> {
    let mut libraries: Vec<PathBuf> = Vec::new();

    for install in steam_install_dirs() {
        libraries.push(install.clone());
        let vdf = install.join("steamapps").join("libraryfolders.vdf");
        if let Ok(text) = std::fs::read_to_string(&vdf) {
            for path in parse_library_paths(&text) {
                libraries.push(path);
            }
        }
    }

    libraries.retain(|path| path.is_dir());
    libraries
}

fn steam_install_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        if let Some(path) = registry_steam_path() {
            dirs.push(path);
        }
        for program_files in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Some(base) = std::env::var_os(program_files) {
                dirs.push(PathBuf::from(base).join("Steam"));
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        dirs.push(
            paths::home_dir()
                .join("Library")
                .join("Application Support")
                .join("Steam"),
        );
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        dirs.push(paths::home_dir().join(".steam").join("steam"));
        dirs.push(paths::home_dir().join(".local").join("share").join("Steam"));
    }

    dirs.retain(|path| path.is_dir());
    dirs
}

#[cfg(windows)]
fn registry_steam_path() -> Option<PathBuf> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(r"Software\Valve\Steam").ok()?;
    // 优先 SteamPath，老版本可能只有 SteamExe
    if let Ok(path) = key.get_value::<String, _>("SteamPath") {
        return Some(PathBuf::from(path));
    }
    let exe: String = key.get_value("SteamExe").ok()?;
    Some(PathBuf::from(exe).parent()?.to_path_buf())
}

/// 从 `libraryfolders.vdf` 里抠出库路径。
///
/// 不去实现完整 VDF 解析器——这里只关心 `"path"  "D:\\SteamLibrary"` 这种行，
/// 手写状态机反而比引一个依赖更容易出错。
fn parse_library_paths(text: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for line in text.lines() {
        if !line.contains("\"path\"") {
            continue;
        }
        let mut values = quoted_values(line);
        values.retain(|value| *value != "path");
        for value in values {
            // VDF 里反斜杠是转义的
            let unescaped = value.replace("\\\\", "\\");
            paths.push(PathBuf::from(unescaped));
        }
    }
    paths
}

/// 取出一行里所有引号中的字符串。
fn quoted_values(line: &str) -> Vec<&str> {
    let mut values = Vec::new();
    let mut chars = line.char_indices();
    while let Some((_, ch)) = chars.next() {
        if ch != '"' {
            continue;
        }
        let start = match chars.next() {
            Some((index, _)) => index,
            None => break,
        };
        for (index, ch) in chars.by_ref() {
            if ch == '"' {
                values.push(&line[start..index]);
                break;
            }
        }
    }
    values
}

/// 常见免安装目录。
fn portable_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    #[cfg(windows)]
    {
        if let Some(base) = std::env::var_os("ProgramFiles(x86)") {
            candidates.push(PathBuf::from(base).join("Rusted Warfare"));
        }
        if let Some(base) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(base).join("Rusted Warfare"));
        }
        candidates.push(PathBuf::from(r"C:\Rusted Warfare"));
    }

    candidates.push(paths::home_dir().join("Rusted Warfare"));

    // macOS 上用户自己拖到「应用程序」或桌面的也很常见
    // （Steam 装的由 `steam_libraries()` 覆盖）
    #[cfg(target_os = "macos")]
    {
        let home = paths::home_dir();
        candidates.push(home.join("Applications").join("Rusted Warfare.app"));
        candidates.push(home.join("Desktop").join("Rusted Warfare.app"));
    }

    // Linux 上 Steam 与免安装各有各的习惯目录
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let home = paths::home_dir();
        candidates.push(home.join("Games").join("Rusted Warfare"));
        candidates.push(home.join(".local").join("share").join("Rusted Warfare"));
    }

    candidates
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ppl-instance-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("创建临时目录");
        dir
    }

    #[test]
    fn probes_directory_without_exe() {
        let dir = temp_dir("empty");
        let probe = Instance::probe(&dir).expect("探测");
        assert!(!probe.is_playable());
        assert!(probe.writable);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn parses_library_paths() {
        let text = r#"
"libraryfolders"
{
    "0"
    {
        "path"		"C:\\Program Files (x86)\\Steam"
    }
    "1"
    {
        "path"		"D:\\SteamLibrary"
    }
}
"#;
        let paths = parse_library_paths(text);
        assert_eq!(paths.len(), 2);
        assert_eq!(paths[1], PathBuf::from(r"D:\SteamLibrary"));
    }

    #[test]
    fn id_is_stable() {
        let dir = temp_dir("id");
        let a = instance_id(&dir);
        let b = instance_id(&dir);
        assert_eq!(a, b);
        assert!(a.starts_with("rw-"));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Linux / Steam 的原生二进制没有扩展名，靠名字命中。
    #[test]
    fn finds_extensionless_binary() {
        let dir = temp_dir("linux-bin");
        std::fs::write(dir.join("RustedWarfare"), b"\x7fELF").expect("写文件");
        let probe = Instance::probe(&dir).expect("探测");
        assert!(probe.is_playable());
        assert_eq!(
            probe.exe.as_deref().and_then(|path| path.file_name()),
            Some(std::ffi::OsStr::new("RustedWarfare"))
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    /// macOS：`.app` 是目录，根目录必须换算到包内的 `Contents/MacOS`，
    /// 否则既 spawn 不了，`mods/units` 也会挂到包外面去。
    #[test]
    fn resolves_macos_bundle_inside_game_dir() {
        let dir = temp_dir("mac-bundle");
        let macos = dir
            .join("Rusted Warfare.app")
            .join("Contents")
            .join("MacOS");
        std::fs::create_dir_all(&macos).expect("建包目录");
        std::fs::write(macos.join("Rusted Warfare"), b"#!/bin/sh\n").expect("写二进制");

        let probe = Instance::probe(&dir).expect("探测");
        assert!(probe.is_playable());
        assert_eq!(probe.root, macos);
        assert_eq!(probe.mods_dir, macos.join("mods"));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// macOS：用户直接选中 `.app` 本身（文件选择器返回的就是包路径）。
    #[test]
    fn resolves_macos_bundle_from_bundle_path() {
        let dir = temp_dir("mac-bundle-pick");
        let app = dir.join("Rusted Warfare.app");
        let macos = app.join("Contents").join("MacOS");
        std::fs::create_dir_all(&macos).expect("建包目录");
        std::fs::write(macos.join("JavaApplicationStub"), b"#!/bin/sh\n").expect("写二进制");

        let probe = Instance::probe(&app).expect("探测");
        assert!(probe.is_playable());
        assert_eq!(probe.root, macos);
        let _ = std::fs::remove_dir_all(dir);
    }
}
