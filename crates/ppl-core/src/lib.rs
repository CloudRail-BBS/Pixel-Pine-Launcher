//! # ppl-core
//!
//! Pixel-Pine-Launcher 的内核。**不依赖任何 UI 框架**——Tauri 只是它的一个壳，
//! CLI 也可以调用同一套逻辑，测试不需要起窗口。
//!
//! 当前提供三块能力：
//!
//! - [`instance`]：发现游戏目录、探测可执行文件与写权限、启动
//! - [`library`]：扫描 `mods/units`，兼容 `.rwmod` 与摊开的文件夹
//! - [`loadout`]：作战预设的存储与挂载（junction / symlink）
//!
//! ```no_run
//! use ppl_core::{Instance, InstanceSource, LoadoutStore};
//!
//! let game = std::path::Path::new(r"D:\Steam\steamapps\common\Rusted Warfare");
//! let instance = Instance::from_root(game, InstanceSource::Steam)?;
//!
//! let store = LoadoutStore::default_store();
//! store.create("modern-war", "现代战争")?;
//! store.attach(game, "modern-war")?;   // mods/units 指向预设
//! instance.launch()?;
//! # Ok::<(), ppl_core::Error>(())
//! ```

pub mod archive;
pub mod error;
pub mod extensions;
pub mod gamedl;
pub mod import;
pub mod instance;
pub mod library;
pub mod loadout;
pub mod maps;
pub mod paths;

pub use paths::games_root;

pub use archive::{ExtractLimits, ExtractStats, extract_zip, locate_root};
pub use error::{Error, Result};
pub use extensions::{
    Descriptor, Extension, LoadPlan, MissingDependency, build_plan, extensions_dir,
    import_extension, remove_extension, scan_extensions, set_extension_enabled,
};
pub use gamedl::{
    GameInstall, GameManifest, GameVersion, current_platform, install_game, sha256_file,
    verify_sha256,
};
pub use import::{
    ImportedPackage, import_many, import_package, install_from_path, uninstall_package,
};
pub use instance::{Instance, InstanceSource, Probe, discover};
pub use library::{
    Conflict, DISABLED_DIR, LocalMod, detect_conflicts, scan_units, scan_units_with_disabled,
    set_mod_enabled,
};
pub use loadout::{LinkStatus, Loadout, LoadoutPackage, LoadoutStore, PackageSource};
pub use maps::{GameMap, TmxSize, read_tmx_size, scan_maps};
