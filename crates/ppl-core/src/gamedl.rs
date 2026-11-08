//! 游戏本体的分发与安装。
//!
//! 这里刻意**不内置任何下载地址**。《铁锈战争》是买断制商业软件，
//! 能不能由 PPL 直接分发，取决于是否拿到授权——这是法律问题，不是技术问题。
//!
//! 所以内核只做三件事，地址由运营方填进清单：
//!
//! 1. 解析 `game-index.json`（格式见 [`GameManifest`]）
//! 2. 按平台 / 通道挑一个版本
//! 3. 校验 SHA256 → 安全解压 → 原子落位
//!
//! 没配清单时上层会退回「打开官方商店」，而不是给一个点了没反应的按钮。

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::archive::{extract_zip, locate_root};
use crate::error::{Error, Result};

/// 一个可下载的游戏版本。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameVersion {
    /// 版本号，例如 `1.15`。
    pub version: String,
    /// 通道：`stable` / `beta`。
    #[serde(default = "default_channel")]
    pub channel: String,
    /// 平台：`windows` / `macos` / `linux` / `android`。
    pub platform: String,
    /// 压缩包体积。
    #[serde(default)]
    pub size: u64,
    /// 压缩包的 SHA256（小写十六进制）。
    #[serde(default)]
    pub sha256: String,
    /// 下载地址，按顺序尝试。
    #[serde(default)]
    pub urls: Vec<String>,
    /// 压缩格式，目前只支持 `zip`。
    #[serde(default = "default_archive")]
    pub archive: String,
    /// 解压后用于定位游戏根目录的可执行文件名。
    #[serde(default = "default_entry")]
    pub entry: String,
    /// 更新说明。
    #[serde(default)]
    pub notes: String,
}

fn default_channel() -> String {
    "stable".to_string()
}

fn default_archive() -> String {
    "zip".to_string()
}

fn default_entry() -> String {
    if cfg!(windows) {
        "Rusted Warfare.exe".to_string()
    } else {
        "Rusted Warfare".to_string()
    }
}

impl GameVersion {
    /// 是否能在当前平台安装。
    pub fn is_current_platform(&self) -> bool {
        self.platform.eq_ignore_ascii_case(current_platform())
    }

    /// 下载地址是否可用。
    pub fn is_downloadable(&self) -> bool {
        !self.urls.is_empty() && self.archive.eq_ignore_ascii_case("zip")
    }
}

/// 版本清单。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameManifest {
    /// 清单格式版本，目前只认 1。
    #[serde(default = "default_schema")]
    pub schema: u32,
    /// 生成时间，仅用于展示。
    #[serde(default)]
    pub generated: String,
    /// 全部版本。
    #[serde(default)]
    pub versions: Vec<GameVersion>,
}

fn default_schema() -> u32 {
    1
}

impl GameManifest {
    /// 解析清单。字段缺失按默认值处理，格式不对直接报错——
    /// 宁可让运营方看到「清单有问题」，也不要静默显示「暂无版本」。
    pub fn parse(text: &str) -> Result<Self> {
        let manifest: GameManifest =
            serde_json::from_str(text).map_err(|error| Error::Manifest(error.to_string()))?;
        if manifest.schema != 1 {
            return Err(Error::Manifest(format!(
                "清单 schema 是 {}，这个版本只认 1",
                manifest.schema
            )));
        }
        Ok(manifest)
    }

    /// 挑出当前平台、指定通道里版本最高的一个。
    pub fn latest(&self, channel: &str) -> Option<&GameVersion> {
        self.versions
            .iter()
            .filter(|item| item.is_current_platform())
            .filter(|item| item.channel.eq_ignore_ascii_case(channel))
            .filter(|item| item.is_downloadable())
            .max_by(|a, b| compare_versions(&a.version, &b.version))
    }

    /// 当前平台有哪些通道可选。
    pub fn channels(&self) -> Vec<String> {
        let mut list: Vec<String> = self
            .versions
            .iter()
            .filter(|item| item.is_current_platform())
            .map(|item| item.channel.clone())
            .collect();
        list.sort();
        list.dedup();
        list
    }

    /// 当前平台的版本，按版本号从新到旧。
    ///
    /// 排序放在内核里，界面就不用再实现一遍版本比较——
    /// 两处各写一份，早晚会出现「列表说 1.9 最新、下载却下了 1.10」。
    pub fn sorted_for_platform(&self) -> Vec<&GameVersion> {
        let mut list: Vec<&GameVersion> = self
            .versions
            .iter()
            .filter(|item| item.is_current_platform())
            .filter(|item| item.is_downloadable())
            .collect();
        list.sort_by(|a, b| compare_versions(&b.version, &a.version));
        list
    }
}

/// 当前平台的标识，和清单里的 `platform` 对得上。
pub fn current_platform() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "android") {
        "android"
    } else {
        "linux"
    }
}

/// 比较两个版本号，只按数字段比。
///
/// 铁锈的版本是 `1.15`、`1.15.1` 这种，不需要完整的 semver；
/// 遇到非数字段（`1.15-beta`）按 0 处理，够用且不会 panic。
fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |value: &str| -> Vec<u64> {
        value
            .split('.')
            .map(|part| {
                part.chars()
                    .take_while(|ch| ch.is_ascii_digit())
                    .collect::<String>()
                    .parse::<u64>()
                    .unwrap_or(0)
            })
            .collect()
    };

    let left = parse(a);
    let right = parse(b);
    let len = left.len().max(right.len());

    for index in 0..len {
        let l = left.get(index).copied().unwrap_or(0);
        let r = right.get(index).copied().unwrap_or(0);
        match l.cmp(&r) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

/// 算文件的 SHA256（小写十六进制）。
pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    // 64KB 缓冲，150MB 的包大约读 2300 次，比整读进内存省得多
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// 校验下载到的包。清单没写 sha256 时只算不比对（并返回实际值供展示）。
pub fn verify_sha256(path: &Path, expected: &str) -> Result<String> {
    let actual = sha256_file(path)?;
    let expected = expected.trim().to_ascii_lowercase();
    if !expected.is_empty() && expected != actual {
        return Err(Error::HashMismatch { expected, actual });
    }
    Ok(actual)
}

/// 安装结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameInstall {
    /// 游戏根目录。
    pub root: PathBuf,
    /// 写出的文件数。
    pub files: usize,
    /// 写出的总字节数。
    pub bytes: u64,
}

/// 把下载好的压缩包解压到 `target`。
///
/// 顺序是「解压到兄弟暂存目录 → 校验入口文件 → 整体 rename」。
/// 中途失败时 `target` 一个字节都不会被碰到；成功时 `target` 要么不存在、
/// 要么是完整的一份。**不存在「装到一半」的中间态**，这是用户最恨的东西。
///
/// `target` 已存在且非空时直接报错，不覆盖——覆盖一个已经能玩的游戏
/// 会把存档和玩家自己的 Mod 一起带走。
pub fn install_game(archive: &Path, target: &Path, entry: &str) -> Result<GameInstall> {
    if target.exists() {
        let empty = std::fs::read_dir(target)
            .map(|mut dir| dir.next().is_none())
            .unwrap_or(false);
        if !empty {
            return Err(Error::GameTargetOccupied(target.to_path_buf()));
        }
        // 空目录留着会和 rename 冲突，先清掉
        std::fs::remove_dir(target)?;
    }

    let parent = target
        .parent()
        .ok_or_else(|| Error::Manifest(format!("安装路径没有父目录：{}", target.display())))?;
    std::fs::create_dir_all(parent)?;

    let staging = parent.join(format!(
        "{}.ppltmp",
        target
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "game".to_string())
    ));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)?;

    let stats = match extract_zip(archive, &staging) {
        Ok(stats) => stats,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error);
        }
    };

    // 有些包多套一层同名目录，把那一层当作真正的根
    let actual_root = match locate_root(&staging, entry) {
        Some(root) => root,
        None => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(Error::NotPlayable(staging));
        }
    };

    std::fs::rename(&actual_root, target).map_err(|error| {
        let _ = std::fs::remove_dir_all(&staging);
        Error::Io(error)
    })?;

    // 多套的那层目录现在空了，顺手清掉
    if actual_root != staging {
        let _ = std::fs::remove_dir_all(&staging);
    }

    Ok(GameInstall {
        root: target.to_path_buf(),
        files: stats.files,
        bytes: stats.bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ppl-gamedl-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("建临时目录");
        dir
    }

    fn make_zip(path: &Path, files: &[(&str, &[u8])]) {
        let file = std::fs::File::create(path).expect("建包");
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for (name, body) in files {
            zip.start_file(*name, options).expect("写条目");
            zip.write_all(body).expect("写内容");
        }
        zip.finish().expect("收尾");
    }

    #[test]
    fn picks_newest_of_platform() {
        let text = r#"{
            "schema": 1,
            "versions": [
                {"version": "1.14", "platform": "windows", "urls": ["a"], "sha256": "x"},
                {"version": "1.15", "platform": "windows", "urls": ["b"], "sha256": "y"},
                {"version": "1.16", "platform": "linux", "urls": ["c"], "sha256": "z"},
                {"version": "9.99", "platform": "windows", "channel": "beta", "urls": ["d"], "sha256": "w"}
            ]
        }"#;

        let manifest = GameManifest::parse(text).expect("解析");
        let latest = manifest.latest("stable").expect("有稳定版");

        // 只在当前平台的 stable 里挑，1.16 是 linux、9.99 是 beta，都不该选中
        assert_eq!(latest.version, "1.15");
        assert!(manifest.channels().contains(&"stable".to_string()));
    }

    #[test]
    fn rejects_unknown_schema() {
        let error = GameManifest::parse(r#"{"schema": 2, "versions": []}"#).expect_err("应拒绝");
        assert!(matches!(error, Error::Manifest(_)));
    }

    #[test]
    fn compares_versions_numerically() {
        use std::cmp::Ordering;
        // 按字符串比的话 "1.9" > "1.10"，这里必须反过来
        assert_eq!(compare_versions("1.10", "1.9"), Ordering::Greater);
        assert_eq!(compare_versions("1.15", "1.15.0"), Ordering::Equal);
        assert_eq!(compare_versions("2", "1.99"), Ordering::Greater);
    }

    #[test]
    fn installs_into_target_atomically() {
        let base = temp("install");
        let archive = base.join("game.zip");
        make_zip(
            &archive,
            &[("Rusted Warfare.exe", b"MZ"), ("mods/units/x.txt", b"hi")],
        );

        let target = base.join("Rusted Warfare");
        let result = install_game(&archive, &target, "Rusted Warfare.exe").expect("安装");

        assert_eq!(result.files, 2);
        assert!(target.join("Rusted Warfare.exe").is_file());
        // 暂存目录必须清理干净
        assert!(!base.join("Rusted Warfare.ppltmp").exists());
    }

    #[test]
    fn refuses_to_overwrite_existing_install() {
        let base = temp("occupied");
        let archive = base.join("game.zip");
        make_zip(&archive, &[("Rusted Warfare.exe", b"MZ")]);

        let target = base.join("game");
        std::fs::create_dir_all(&target).expect("建目录");
        std::fs::write(target.join("save.dat"), b"save").expect("写存档");

        let error = install_game(&archive, &target, "Rusted Warfare.exe").expect_err("应拒绝");
        assert!(matches!(error, Error::GameTargetOccupied(_)));
        // 关键：存档还在
        assert!(target.join("save.dat").is_file());
    }

    #[test]
    fn hash_check_catches_corruption() {
        let base = temp("hash");
        let file = base.join("a.bin");
        std::fs::write(&file, b"hello").expect("写文件");

        let good = sha256_file(&file).expect("算哈希");
        assert_eq!(
            good,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );

        let error = verify_sha256(&file, "deadbeef").expect_err("应失败");
        assert!(matches!(error, Error::HashMismatch { .. }));

        // 空期望值 = 只算不比对
        assert_eq!(verify_sha256(&file, "").expect("不比对"), good);
    }
}
