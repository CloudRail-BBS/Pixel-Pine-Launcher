//! Tauri 桥接层。
//!
//! 这一层只做三件事：参数转换、错误字符串化、命令注册。
//! 所有业务逻辑都在 `ppl-core` 里，壳子保持得越薄，换壳的成本越低。

use std::path::{Path, PathBuf};

use ppl_core::{Instance, InstanceSource, LinkStatus, Loadout, LoadoutStore};
use serde::Serialize;

/// 把内核错误转成前端能直接展示的字符串。
fn fail(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn units_dir(root: &str) -> PathBuf {
    Path::new(root).join("mods").join("units")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstanceView {
    id: String,
    name: String,
    root: String,
    source: String,
    version: Option<String>,
    active_loadout: Option<String>,
}

impl From<Instance> for InstanceView {
    fn from(value: Instance) -> Self {
        let source = match value.source {
            InstanceSource::Steam => "steam",
            InstanceSource::Portable => "portable",
            InstanceSource::Manual => "manual",
        };
        Self {
            id: value.id,
            name: value.name,
            root: value.root.to_string_lossy().into_owned(),
            source: source.to_string(),
            version: value.version,
            active_loadout: value.active_loadout,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeView {
    root: String,
    playable: bool,
    exe: Option<String>,
    mods_exists: bool,
    writable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModView {
    id: String,
    name: String,
    title: String,
    unit_count: usize,
    packaged: bool,
    size: u64,
    enabled: bool,
    min_version: Option<String>,
    conflict_with: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResult {
    mods: Vec<ModView>,
    /// 实际发生冲突的 Mod 名称 → 冲突数量，用于界面提示。
    conflicts: Vec<ConflictView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConflictView {
    name: String,
    with: String,
    dirs: Vec<String>,
}

#[tauri::command]
fn discover_instances() -> Vec<InstanceView> {
    ppl_core::discover()
        .into_iter()
        .map(InstanceView::from)
        .collect()
}

#[tauri::command]
fn list_instances() -> Result<Vec<InstanceView>, String> {
    Ok(Instance::load_all()
        .map_err(fail)?
        .into_iter()
        .map(InstanceView::from)
        .collect())
}

#[tauri::command]
fn probe_directory(path: String) -> Result<ProbeView, String> {
    let probe = Instance::probe(&path).map_err(fail)?;
    Ok(ProbeView {
        root: probe.root.to_string_lossy().into_owned(),
        playable: probe.is_playable(),
        exe: probe.exe.map(|exe| exe.to_string_lossy().into_owned()),
        mods_exists: probe.mods_exists,
        writable: probe.writable,
    })
}

#[tauri::command]
fn add_instance(root: String) -> Result<InstanceView, String> {
    let instance = Instance::from_root(&root, InstanceSource::Manual).map_err(fail)?;
    if !Path::new(&root).join("mods").is_dir() {
        std::fs::create_dir_all(Path::new(&root).join("mods")).map_err(fail)?;
    }
    instance.save().map_err(fail)?;
    Ok(instance.into())
}

#[tauri::command]
fn list_loadouts() -> Result<Vec<Loadout>, String> {
    let store = LoadoutStore::default_store();
    store.ensure().map_err(fail)?;
    store.list().map_err(fail)
}

#[tauri::command]
fn create_loadout(id: String, name: String) -> Result<Loadout, String> {
    let store = LoadoutStore::default_store();
    store.ensure().map_err(fail)?;
    store.create(id, name).map_err(fail)
}

#[tauri::command]
fn scan_mods(root: String) -> Result<ScanResult, String> {
    let mods = ppl_core::scan_units_with_disabled(&units_dir(&root)).map_err(fail)?;
    let conflicts = ppl_core::detect_conflicts(&mods);

    let mut by_name: std::collections::HashMap<&str, &str> = std::collections::HashMap::new();
    for conflict in &conflicts {
        by_name.insert(conflict.name.as_str(), conflict.with.as_str());
    }

    let views = mods
        .iter()
        .map(|item| ModView {
            id: item.name.clone(),
            name: item.name.clone(),
            title: item.title.clone(),
            unit_count: item.unit_count,
            packaged: item.packaged,
            size: item.size,
            enabled: item.enabled,
            min_version: item.min_version.clone(),
            conflict_with: by_name
                .get(item.name.as_str())
                .map(|with| (*with).to_string()),
        })
        .collect();

    Ok(ScanResult {
        mods: views,
        conflicts: conflicts
            .into_iter()
            .map(|conflict| ConflictView {
                name: conflict.name,
                with: conflict.with,
                dirs: conflict.dirs,
            })
            .collect(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MapView {
    name: String,
    size_label: Option<String>,
    size: u64,
    has_preview: bool,
}

#[tauri::command]
fn scan_maps(root: String) -> Result<Vec<MapView>, String> {
    let dir = Path::new(&root).join("mods").join("maps");
    Ok(ppl_core::scan_maps(&dir)
        .map_err(fail)?
        .into_iter()
        .map(|map| {
            let size_label = map.size_label();
            MapView {
                name: map.name,
                size_label,
                size: map.size,
                has_preview: map.has_preview,
            }
        })
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportView {
    id: String,
    title: String,
    file: String,
    size: u64,
    unit_count: usize,
    /// 导入后是否已把这个预设挂到游戏目录
    attached: bool,
}

/// 把本地 .rwmod 导入某个预设。写进的是预设存储目录，不是游戏的 mods/units。
#[tauri::command]
fn import_package(root: String, loadout_id: String, path: String) -> Result<ImportView, String> {
    let store = LoadoutStore::default_store();
    let imported = ppl_core::import_package(&store, &loadout_id, Path::new(&path)).map_err(fail)?;
    Ok(attach_after_import(&store, &root, &loadout_id, imported))
}

/// 市场下载的单包体积上限，和资源包校验的口径保持一致。
const MAX_DOWNLOAD_BYTES: u64 = 256 * 1024 * 1024;

/// 只用做文件名，别让 slug 带出路径穿越。
fn safe_slug(slug: &str) -> String {
    let cleaned: String = slug
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    if cleaned.trim_matches('-').is_empty() {
        "package".to_string()
    } else {
        cleaned
    }
}

/// 从市场下载并安装。
///
/// 整个链路是「下载到临时文件 → 内核校验 → 进预设目录」，
/// 校验不过的包不会在用户目录里留下任何东西。
#[tauri::command]
async fn install_from_url(
    root: String,
    loadout_id: String,
    url: String,
    slug: String,
    version: String,
) -> Result<ImportView, String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("下载地址不是 http(s)，已拒绝".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .user_agent(concat!("PixelPineLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("初始化下载器失败：{error}"))?;

    let response = client.get(&url).send().await.map_err(|error| {
        if error.is_timeout() {
            "下载超时，检查网络后重试".to_string()
        } else if error.is_connect() {
            "连不上下载服务器".to_string()
        } else {
            format!("下载失败：{error}")
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            404 => "下载地址失效（404），这个版本可能已下架".to_string(),
            403 => "没有下载权限（403）".to_string(),
            code => format!("下载失败：服务端返回 {code}"),
        });
    }
    if let Some(length) = response.content_length() {
        if length > MAX_DOWNLOAD_BYTES {
            return Err(format!(
                "资源体积 {:.0} MB 超过上限",
                length as f64 / 1_048_576.0
            ));
        }
    }

    // 一次性读进内存：资源包上限 256MB，比起流式写入，
    // 这里换来的是「要么完整拿到、要么彻底失败」，不会留下半个文件。
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("下载中断：{error}"))?;
    if bytes.is_empty() {
        return Err("下载到的文件是空的".to_string());
    }
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err("资源体积超过上限".to_string());
    }

    // 临时文件名用 slug，导入后预设里记的 id 才是市场里的那个
    let temp = std::env::temp_dir().join(format!("ppl-market-{}.rwmod", safe_slug(&slug)));
    std::fs::write(&temp, &bytes).map_err(|error| format!("写临时文件失败：{error}"))?;

    let store = LoadoutStore::default_store();
    let outcome = ppl_core::install_from_path(&store, &loadout_id, &temp, &slug, &version)
        .map_err(fail)
        .map(|imported| attach_after_import(&store, &root, &loadout_id, imported));
    let _ = std::fs::remove_file(&temp);
    outcome
}

/// 导入完成后顺手接管游戏目录。
///
/// 没接管的话，包进了预设但游戏看不见，用户会以为安装失败。
/// `ForeignDirectory` 绝不擅自动——那是玩家自己扫进来的 Mod。
fn attach_after_import(
    store: &LoadoutStore,
    root: &str,
    loadout_id: &str,
    imported: ppl_core::ImportedPackage,
) -> ImportView {
    let game_root = Path::new(root);
    let attached = match store.link_status(game_root) {
        LinkStatus::Absent => store.attach(game_root, loadout_id).is_ok(),
        LinkStatus::Managed => true,
        LinkStatus::ForeignDirectory => false,
    };

    ImportView {
        id: imported.id,
        title: imported.title,
        file: imported.file,
        size: imported.size,
        unit_count: imported.unit_count,
        attached,
    }
}

#[tauri::command]
fn set_mod_enabled(root: String, name: String, enabled: bool) -> Result<(), String> {
    ppl_core::set_mod_enabled(&units_dir(&root), &name, enabled).map_err(fail)
}

#[tauri::command]
fn attach_loadout(root: String, loadout_id: String) -> Result<String, String> {
    let store = LoadoutStore::default_store();
    let link = store.attach(Path::new(&root), &loadout_id).map_err(fail)?;
    Ok(link.to_string_lossy().into_owned())
}

#[tauri::command]
fn link_status(root: String) -> String {
    match LoadoutStore::default_store().link_status(Path::new(&root)) {
        LinkStatus::Absent => "absent",
        LinkStatus::Managed => "managed",
        LinkStatus::ForeignDirectory => "foreign",
    }
    .to_string()
}

#[tauri::command]
fn launch_game(root: String) -> Result<u32, String> {
    let instance = Instance::from_root(&root, InstanceSource::Manual).map_err(fail)?;
    instance.launch().map_err(fail)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            discover_instances,
            list_instances,
            probe_directory,
            add_instance,
            list_loadouts,
            create_loadout,
            scan_mods,
            scan_maps,
            import_package,
            install_from_url,
            set_mod_enabled,
            attach_loadout,
            link_status,
            launch_game
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
