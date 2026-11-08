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

/// 拉取联机中继的房间列表。
///
/// 必须走 Rust 侧：中继是明文 HTTP，在 webview 里会被混合内容策略直接拦掉，
/// 连错误信息都拿不到。返回原始 JSON，由前端按 `data.rooms` 取。
#[tauri::command]
async fn fetch_relay_rooms(url: String) -> Result<serde_json::Value, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("联机地址不是 http(s)".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent(concat!("PixelPineLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("初始化请求失败：{error}"))?;

    let response = client.get(&url).send().await.map_err(|error| {
        if error.is_timeout() {
            "联机服务响应超时，稍后重试".to_string()
        } else if error.is_connect() {
            "连不上联机服务".to_string()
        } else {
            format!("请求联机服务失败：{error}")
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("联机服务返回 {}", status.as_u16()));
    }

    response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("解析房间数据失败：{error}"))
}

/// 从预设卸载资源：删文件 + 改清单。
/// 命令名带 market 前缀，避免和内核同名函数混淆。
#[tauri::command]
fn uninstall_market_package(loadout_id: String, package_id: String) -> Result<bool, String> {
    let store = LoadoutStore::default_store();
    ppl_core::uninstall_package(&store, &loadout_id, &package_id).map_err(fail)
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

/// 游戏版本目录（按平台 + 通道整理好，前端不再自己比版本号）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GameCatalog {
    platform: String,
    channels: Vec<String>,
    versions: Vec<ppl_core::GameVersion>,
}

/// 拉取游戏版本清单。
///
/// 清单地址不写死在代码里：能不能分发游戏本体取决于授权，
/// 运营方把 URL 填进设置就行，拿不到授权就让这个接口失败，
/// 界面自动退回「去官方渠道」。
#[tauri::command]
async fn fetch_game_catalog(url: String) -> Result<GameCatalog, String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("版本清单地址不是 http(s)".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent(concat!("PixelPineLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("初始化请求失败：{error}"))?;

    let response = client.get(&url).send().await.map_err(|error| {
        if error.is_timeout() {
            "版本清单响应超时".to_string()
        } else if error.is_connect() {
            "连不上版本清单服务器".to_string()
        } else {
            format!("拉取版本清单失败：{error}")
        }
    })?;

    // 204 是约定好的「暂时没有可下载版本」，不是错误
    if response.status().as_u16() == 204 {
        return Ok(GameCatalog {
            platform: ppl_core::current_platform().to_string(),
            channels: Vec::new(),
            versions: Vec::new(),
        });
    }
    if !response.status().is_success() {
        return Err(format!("版本清单返回 {}", response.status().as_u16()));
    }

    let text = response
        .text()
        .await
        .map_err(|error| format!("读取版本清单失败：{error}"))?;
    let manifest = ppl_core::GameManifest::parse(&text).map_err(fail)?;

    Ok(GameCatalog {
        platform: ppl_core::current_platform().to_string(),
        channels: manifest.channels(),
        versions: manifest
            .sorted_for_platform()
            .into_iter()
            .cloned()
            .collect(),
    })
}

/// 单个游戏压缩包的上限。游戏本体比 Mod 大得多，但也不能没有上限。
const MAX_GAME_BYTES: u64 = 3 * 1024 * 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GameProgress {
    downloaded: u64,
    total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GameInstallView {
    root: String,
    files: usize,
    bytes: u64,
}

/// 下载并安装游戏本体。
///
/// 链路：流式下载到临时文件（边下边报进度）→ 校验 SHA256 →
/// 解压到暂存目录 → 整体 rename 到位。任何一步失败都清干净，
/// 不会在目标路径留下半个游戏。
#[tauri::command]
async fn install_game_from_url(
    app: tauri::AppHandle,
    url: String,
    target: String,
    sha256: String,
    entry: Option<String>,
) -> Result<GameInstallView, String> {
    use tauri::Emitter;

    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("下载地址不是 http(s)，已拒绝".to_string());
    }

    let client = reqwest::Client::builder()
        // 不再设整体超时：150MB+ 的包在慢网下会被误杀。
        // 连接阶段单独给 20 秒，卡住的连接才需要掐断。
        .connect_timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!("PixelPineLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("初始化下载器失败：{error}"))?;

    let mut response = client.get(&url).send().await.map_err(|error| {
        if error.is_timeout() {
            "连接下载服务器超时".to_string()
        } else if error.is_connect() {
            "连不上下载服务器".to_string()
        } else {
            format!("下载失败：{error}")
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            404 => "下载地址失效（404）".to_string(),
            403 => "没有下载权限（403）".to_string(),
            code => format!("下载失败：服务端返回 {code}"),
        });
    }

    let total = response.content_length().unwrap_or(0);
    if total > MAX_GAME_BYTES {
        return Err(format!(
            "安装包 {:.1} GB，超过上限",
            total as f64 / 1_073_741_824.0
        ));
    }

    let stamp = std::process::id();
    let temp = std::env::temp_dir().join(format!("ppl-game-{stamp}.zip"));
    let mut file =
        std::fs::File::create(&temp).map_err(|error| format!("创建临时文件失败：{error}"))?;

    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;
    use std::io::Write;

    loop {
        let chunk = response.chunk().await.map_err(|error| {
            let _ = std::fs::remove_file(&temp);
            format!("下载中断：{error}")
        })?;

        let Some(chunk) = chunk else { break };
        file.write_all(&chunk)
            .map_err(|error| format!("写入临时文件失败：{error}"))?;

        downloaded += chunk.len() as u64;
        if downloaded > MAX_GAME_BYTES {
            let _ = std::fs::remove_file(&temp);
            return Err("安装包超过上限，已中止".to_string());
        }

        // 每 4MB 报一次进度：每块都发事件会把 IPC 打满
        if downloaded - last_emit >= 4 * 1024 * 1024 {
            last_emit = downloaded;
            let _ = app.emit("game-progress", GameProgress { downloaded, total });
        }
    }

    // 关掉句柄再校验：Windows 上文件被占着时读取会失败
    drop(file);

    let _ = app.emit(
        "game-progress",
        GameProgress {
            downloaded,
            total: if total == 0 { downloaded } else { total },
        },
    );

    // 校验放在解压之前：坏包连解压的机会都不给
    let result = (|| -> ppl_core::Result<ppl_core::GameInstall> {
        ppl_core::verify_sha256(&temp, &sha256)?;
        let entry = entry.unwrap_or_else(|| {
            if cfg!(windows) {
                "Rusted Warfare.exe".to_string()
            } else {
                "Rusted Warfare".to_string()
            }
        });
        ppl_core::install_game(&temp, std::path::Path::new(&target), &entry)
    })();

    let _ = std::fs::remove_file(&temp);

    let install = result.map_err(fail)?;
    Ok(GameInstallView {
        root: install.root.to_string_lossy().into_owned(),
        files: install.files,
        bytes: install.bytes,
    })
}

/// 一次扫描的结果：已装扩展 + 加载计划 + 目录信息。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionsView {
    /// 扩展目录（可能还不存在，前端据此显示提示语）。
    dir: String,
    dir_exists: bool,
    extensions: Vec<ppl_core::Extension>,
    /// 加载顺序、缺失依赖、成环、API 版本不兼容，全在这一个结构里
    plan: ppl_core::LoadPlan,
}

/// 扫描 PPL 扩展。
///
/// 顺带把加载计划算好：顺序算错会让游戏直接崩，缺依赖会让扩展静默失效。
/// 这两件事都不该等用户启动游戏之后才发现。
#[tauri::command]
fn scan_extensions(root: String) -> Result<ExtensionsView, String> {
    let path = Path::new(&root);
    let extensions = ppl_core::scan_extensions(path).map_err(fail)?;
    let plan = ppl_core::build_plan(&extensions);
    let dir = ppl_core::extensions_dir(path);

    Ok(ExtensionsView {
        dir_exists: dir.is_dir(),
        dir: dir.to_string_lossy().into_owned(),
        extensions,
        plan,
    })
}

/// 导入一个扩展包（.pplx / .zip）。必须含 `ppl-extension.json`。
#[tauri::command]
fn import_extension(root: String, path: String) -> Result<ppl_core::Extension, String> {
    ppl_core::import_extension(Path::new(&root), Path::new(&path)).map_err(fail)
}

#[tauri::command]
fn set_extension_enabled(root: String, file: String, enabled: bool) -> Result<(), String> {
    ppl_core::set_extension_enabled(Path::new(&root), &file, enabled).map_err(fail)
}

#[tauri::command]
fn remove_extension(root: String, file: String) -> Result<(), String> {
    ppl_core::remove_extension(Path::new(&root), &file).map_err(fail)
}

/// 从本地压缩包安装游戏本体。
///
/// 走的是和在线下载同一条落盘路径，只是跳过了下载与哈希校验——
/// 用户自己选的文件，我们没法知道期望的哈希。
#[tauri::command]
fn install_game_from_archive(path: String, target: String) -> Result<GameInstallView, String> {
    let archive = Path::new(&path);
    if !archive.is_file() {
        return Err(format!("{} 不存在", archive.display()));
    }

    let entry = if cfg!(windows) {
        "Rusted Warfare.exe"
    } else {
        "Rusted Warfare"
    };

    let install = ppl_core::install_game(archive, Path::new(&target), entry).map_err(fail)?;
    Ok(GameInstallView {
        root: install.root.to_string_lossy().into_owned(),
        files: install.files,
        bytes: install.bytes,
    })
}

/// 默认的游戏安装根目录。前端在它下面按「Rusted Warfare」建子目录。
#[tauri::command]
fn games_root() -> String {
    ppl_core::games_root().to_string_lossy().into_owned()
}

/// 用系统默认浏览器打开一个链接。
///
/// 不用插件是因为只需要「打开」一件事；而且插件会把 URL 处理
/// 变成一条命令权限，多一个可被前端调用的入口。
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("只允许打开 http(s) 链接".to_string());
    }

    #[cfg(windows)]
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn();

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();

    result
        .map(|_| ())
        .map_err(|error| format!("打开浏览器失败：{error}"))
}

#[tauri::command]
fn launch_game(root: String) -> Result<u32, String> {
    let instance = Instance::from_root(&root, InstanceSource::Manual).map_err(fail)?;
    instance.launch().map_err(fail)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            fetch_relay_rooms,
            uninstall_market_package,
            set_mod_enabled,
            attach_loadout,
            link_status,
            launch_game,
            fetch_game_catalog,
            install_game_from_url,
            games_root,
            open_url,
            scan_extensions,
            import_extension,
            set_extension_enabled,
            remove_extension,
            install_game_from_archive
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
