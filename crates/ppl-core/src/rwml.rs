//! RWML 扩展兼容层（只读识别 + 文件管理）。
//!
//! 说明几件事，避免误解：
//!
//! - **只做互操作，不复用代码**。这里只解析对方扩展包里的描述符字段，
//!   用于在启动器里展示和开关，不加载、不注入、不包含对方任何二进制。
//! - **不替用户装加载器**。RWML 本体由用户自己安装；我们只检测它在不在，
//!   不在就提示——启动器没有权限也没有理由去改写游戏的 `game-lib.jar`。
//! - **停用方式未经验证**。把扩展移进 `extensions/.disabled/` 是合理推测
//!   （对方按目录扫描 jar），但没有实测过。界面与文档都如实标注了这点。
//!
//! 默认仍然使用 PPL 自有格式（[`crate::extensions`]），这里是一个可选项。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// 对方扩展所在目录。
pub const RWML_DIR: &str = "extensions";
/// 停用目录（推测，未验证）。
pub const DISABLED_DIR: &str = ".disabled";
/// 描述符在 jar 内的路径。
pub const DESCRIPTOR: &str = "META-INF/extension.properties";
/// 安装加载器后会留下的原版备份。
const ORIGINAL_JAR: &str = "game-lib.jar.original";
/// 加载器自带的运行时目录。
const RUNTIME_DIR: &str = "rwml-runtime";

/// 加载器安装状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderStatus {
    /// 有原版备份或运行时目录，任一存在即视为已安装。
    pub installed: bool,
    pub original_backup: bool,
    pub runtime: bool,
    pub dir: String,
    pub dir_exists: bool,
}

/// 一个 RWML 扩展。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RwmlExtension {
    pub id: String,
    /// 对方描述符没有 name 字段，展示名就用 id。
    pub name: String,    pub file: String,
    pub main_class: Option<String>,
    pub ui_framework: Option<String>,
    pub depends_on: Vec<String>,
    pub size: u64,
    pub enabled: bool,
    pub valid: bool,
    pub problem: Option<String>,
}

/// 扩展目录。
pub fn extensions_dir(root: &Path) -> PathBuf {
    root.join(RWML_DIR)
}

/// 同一个 id 被多个 jar 声明。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateId {
    pub id: String,
    pub files: Vec<String>,
}

/// 一条缺失依赖。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingDependency {
    pub owner: String,
    pub missing: String,
}

/// 兼容层的检查结果。
///
/// 这里**不做加载顺序**：排序是对方加载器的事，我们算出来也不算数。
/// 只做启动器能负责的静态检查——同一 id 多份、依赖缺失、坏包。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RwmlPlan {
    /// 同时启用、且声明了同一个 id 的包。
    pub duplicate_ids: Vec<DuplicateId>,
    /// 启用的扩展声明了依赖，但目录里没有（或只是被停用）。
    pub missing: Vec<MissingDependency>,
    /// 同一个文件名同时出现在启用与停用目录：正常操作不会出现，出现就是状态坏了。
    pub same_name: Vec<String>,
}

/// 静态检查：重复 id、缺失依赖、同名冲突。
///
/// 只检查**已启用且描述符可读**的扩展——停用的包不会进加载器，
/// 把它们算进重复或缺失只会制造噪音。
pub fn analyze(extensions: &[RwmlExtension]) -> RwmlPlan {
    use std::collections::BTreeMap;

    let mut plan = RwmlPlan::default();
    let active: Vec<&RwmlExtension> = extensions
        .iter()
        .filter(|item| item.enabled && item.valid)
        .collect();

    // 重复 id：按 id 聚一次，文件多于一个就是冲突
    let mut by_id: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for item in &active {
        by_id
            .entry(item.id.as_str())
            .or_default()
            .push(item.file.as_str());
    }
    for (id, files) in by_id {
        if files.len() > 1 {
            plan.duplicate_ids.push(DuplicateId {
                id: id.to_string(),
                files: files.into_iter().map(str::to_string).collect(),
            });
        }
    }

    // 缺失依赖：只认「启用且可读」的 id
    let installed: std::collections::HashSet<&str> =
        active.iter().map(|item| item.id.as_str()).collect();
    for item in &active {
        for dep in &item.depends_on {
            if !installed.contains(dep.as_str()) {
                plan.missing.push(MissingDependency {
                    owner: item.id.clone(),
                    missing: dep.clone(),
                });
            }
        }
    }

    // 同名文件同时存在于两个目录：扫描会把它们都列出来
    let mut names: BTreeMap<&str, usize> = BTreeMap::new();
    for item in extensions {
        *names.entry(item.file.as_str()).or_default() += 1;
    }
    plan.same_name = names
        .into_iter()
        .filter(|(_, count)| *count > 1)
        .map(|(name, _)| name.to_string())
        .collect();

    plan
}

/// 探测加载器。
pub fn loader_status(root: &Path) -> LoaderStatus {
    let dir = extensions_dir(root);
    let original_backup = root.join(ORIGINAL_JAR).is_file();
    let runtime = root.join(RUNTIME_DIR).is_dir();

    LoaderStatus {
        installed: original_backup || runtime,
        original_backup,
        runtime,
        dir: dir.to_string_lossy().into_owned(),
        dir_exists: dir.is_dir(),
    }
}

/// 扫描已安装与已停用的扩展。
pub fn scan(root: &Path) -> Result<Vec<RwmlExtension>> {
    let dir = extensions_dir(root);
    let mut list = Vec::new();

    if dir.is_dir() {
        collect(&dir, true, &mut list)?;
    }
    let disabled = dir.join(DISABLED_DIR);
    if disabled.is_dir() {
        collect(&disabled, false, &mut list)?;
    }

    list.sort_by_key(|item| item.name.to_lowercase());
    Ok(list)
}

fn collect(dir: &Path, enabled: bool, out: &mut Vec<RwmlExtension>) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file = entry.file_name().to_string_lossy().into_owned();
        if !file.to_ascii_lowercase().ends_with(".jar") {
            continue;
        }
        let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);

        out.push(match read_descriptor(&path) {
            Ok(props) => {
                let id = props
                    .get("id")
                    .cloned()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| stem(&file));
                RwmlExtension {
                    name: id.clone(),
                    id,
                    file,
                    main_class: props.get("mainClass").cloned(),
                    ui_framework: props.get("ui-framework").cloned(),
                    depends_on: split_list(props.get("dependsOn")),
                    size,
                    enabled,
                    valid: true,
                    problem: None,
                }
            }
            Err(error) => RwmlExtension {
                id: file.clone(),
                name: file.clone(),
                file,
                main_class: None,
                ui_framework: None,
                depends_on: Vec::new(),
                size,
                enabled,
                valid: false,
                problem: Some(error.to_string()),
            },
        });
    }
    Ok(())
}

fn stem(file: &str) -> String {
    match file.rsplit_once('.') {
        Some((head, _)) if !head.is_empty() => head.to_string(),
        _ => file.to_string(),
    }
}

/// 读 `META-INF/extension.properties`。只取需要展示与判断依赖的字段。
fn read_descriptor(path: &Path) -> Result<std::collections::HashMap<String, String>> {
    let file = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| Error::InvalidPackage(format!("不是有效的 jar：{error}")))?;

    let index = (0..archive.len())
        .find(|&index| {
            archive
                .by_index(index)
                .map(|entry| {
                    entry
                        .name()
                        .map(|name| name.eq_ignore_ascii_case(DESCRIPTOR))
                        .unwrap_or(false)
                })
                .unwrap_or(false)
        })
        .ok_or_else(|| Error::InvalidPackage(format!("jar 里没有 {DESCRIPTOR}，不是 RWML 扩展")))?;

    let mut entry = archive
        .by_index(index)
        .map_err(|error| Error::InvalidPackage(format!("读取描述符失败：{error}")))?;
    let mut buffer = Vec::new();
    use std::io::Read;
    std::io::copy(&mut entry.by_ref().take(256 * 1024), &mut buffer)?;

    Ok(parse_properties(&String::from_utf8_lossy(&buffer)))
}

/// 极简 java properties 解析：`key=value` / `key:value`、`#`/`!` 注释、行尾 `\` 续行。
///
/// 不展开 `\uXXXX`：id 和类名里不会出现，为它写解码器不值当。
fn parse_properties(text: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let mut pending = String::new();

    for raw in text.lines() {
        let line = raw.trim();
        if pending.is_empty() && (line.is_empty() || line.starts_with('#') || line.starts_with('!'))
        {
            continue;
        }

        if let Some(head) = line.strip_suffix('\\') {
            pending.push_str(head.trim_end());
            continue;
        }

        let full = if pending.is_empty() {
            line.to_string()
        } else {
            let joined = format!("{pending}{}", line.trim_start());
            pending.clear();
            joined
        };

        let Some((key, value)) = full.split_once('=').or_else(|| full.split_once(':')) else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        map.insert(key.to_string(), value.trim().to_string());
    }

    map
}

/// `a, b@1.0; c` → `["a", "b", "c"]`。
fn split_list(value: Option<&String>) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    value
        .split([',', ';'])
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(|item| item.split('@').next().unwrap_or(item).trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

/// 导入一个 jar。
///
/// 文件名沿用原文件名——对方的加载器可能按文件名去重，
/// 我们擅自改名反而可能让两个版本并存。
pub fn import(root: &Path, package: &Path) -> Result<RwmlExtension> {
    if !package.is_file() {
        return Err(Error::InvalidPackage(format!(
            "{} 不存在",
            package.display()
        )));
    }
    if !package
        .to_string_lossy()
        .to_ascii_lowercase()
        .ends_with(".jar")
    {
        return Err(Error::InvalidPackage(
            "RWML 扩展是 .jar 文件；.zip 请先解出里面的 jar".to_string(),
        ));
    }

    // 先解析：不合格的包不进目录
    let props = read_descriptor(package)?;
    let id = props
        .get("id")
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| Error::InvalidPackage("描述符里没有 id".into()))?;

    let dir = extensions_dir(root);
    std::fs::create_dir_all(&dir)?;

    let file = package
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| Error::InvalidPackage("文件名读不出来".into()))?;

    // 同名的停用版先清掉，避免两份并存
    let stale = dir.join(DISABLED_DIR).join(&file);
    if stale.is_file() {
        let _ = std::fs::remove_file(&stale);
    }

    std::fs::copy(package, dir.join(&file))?;

    let size = std::fs::metadata(dir.join(&file))
        .map(|meta| meta.len())
        .unwrap_or(0);

    Ok(RwmlExtension {
        name: id.clone(),
        id,
        file,
        main_class: props.get("mainClass").cloned(),
        ui_framework: props.get("ui-framework").cloned(),
        depends_on: split_list(props.get("dependsOn")),
        size,
        enabled: true,
        valid: true,
        problem: None,
    })
}

/// 启用 / 停用：在 `extensions/` 与 `extensions/.disabled/` 之间移动。
///
/// 这是对对方加载行为的**推测**，没有实测。若发现停用不生效，
/// 说明它扫描子目录，届时改成重命名后缀。
pub fn set_enabled(root: &Path, file: &str, enabled: bool) -> Result<()> {
    let dir = extensions_dir(root);
    let disabled = dir.join(DISABLED_DIR);

    let (from, to) = if enabled {
        (disabled.join(file), dir.join(file))
    } else {
        (dir.join(file), disabled.join(file))
    };

    if !from.is_file() {
        return Err(Error::ExtensionNotFound(file.to_string()));
    }
    if enabled {
        std::fs::create_dir_all(&dir)?;
    } else {
        std::fs::create_dir_all(&disabled)?;
    }
    if to.exists() {
        std::fs::remove_file(&to)?;
    }
    std::fs::rename(&from, &to)?;
    Ok(())
}

/// 删除扩展包。
pub fn remove(root: &Path, file: &str) -> Result<()> {
    let dir = extensions_dir(root);
    for candidate in [dir.join(file), dir.join(DISABLED_DIR).join(file)] {
        if candidate.is_file() {
            std::fs::remove_file(candidate)?;
            return Ok(());
        }
    }
    Err(Error::ExtensionNotFound(file.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ppl-rwml-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("建临时目录");
        dir
    }

    fn make_jar(path: &Path, props: Option<&str>) {
        let file = std::fs::File::create(path).expect("建包");
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        if let Some(text) = props {
            zip.start_file(DESCRIPTOR, options).expect("写描述符");
            zip.write_all(text.as_bytes()).expect("写内容");
        }
        zip.start_file("com/example/Main.class", options)
            .expect("写类");
        zip.write_all(b"\xca\xfe\xba\xbe").expect("写字节");
        zip.finish().expect("收尾");
    }

    #[test]
    fn parses_properties_like_java() {
        let map = parse_properties(
            "# 注释\n\
             id=io.github.rwpp\n\
             mainClass = io.github.rwpp.Client\n\
             dependsOn=io.github.rwpp.api@1.6.2, other\n\
             name:Cool\\\n\
             \x20Pack\n",
        );
        assert_eq!(map.get("id").map(String::as_str), Some("io.github.rwpp"));
        assert_eq!(map.get("name").map(String::as_str), Some("CoolPack"));
    }

    #[test]
    fn imports_and_toggles_jar() {
        let base = temp("life");
        let game = base.join("game");
        std::fs::create_dir_all(&game).expect("建游戏目录");

        let jar = base.join("rwpp-client.jar");
        make_jar(
            &jar,
            Some("id=io.github.rwpp\nmainClass=Client\ndependsOn=io.github.rwpp.api@1.6.2\n"),
        );

        let imported = import(&game, &jar).expect("导入");
        assert_eq!(imported.file, "rwpp-client.jar");
        assert!(imported.enabled);

        let list = scan(&game).expect("扫描");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].depends_on.len(), 1);

        set_enabled(&game, &imported.file, false).expect("停用");
        let list = scan(&game).expect("再扫");
        assert!(!list[0].enabled);

        remove(&game, &imported.file).expect("删除");
        assert!(scan(&game).expect("三扫").is_empty());
    }

    #[test]
    fn rejects_non_jar_and_missing_descriptor() {
        let base = temp("reject");
        let game = base.join("game");
        std::fs::create_dir_all(&game).expect("建游戏目录");

        let zip = base.join("pack.zip");
        make_jar(&zip, Some("id=x"));
        assert!(import(&game, &zip).is_err());

        let bare = base.join("plain.jar");
        make_jar(&bare, None);
        assert!(import(&game, &bare).is_err());
    }

    #[test]
    fn detects_loader_install() {
        let base = temp("loader");
        let game = base.join("game");
        std::fs::create_dir_all(&game).expect("建游戏目录");

        assert!(!loader_status(&game).installed);

        std::fs::create_dir_all(game.join(RUNTIME_DIR)).expect("建运行时");
        let status = loader_status(&game);
        assert!(status.installed);
        assert!(status.runtime);
        assert!(!status.original_backup);
    }

    #[test]
    fn broken_jar_stays_visible() {
        let base = temp("broken");
        let game = base.join("game");
        std::fs::create_dir_all(extensions_dir(&game)).expect("建扩展目录");

        make_jar(&extensions_dir(&game).join("bad.jar"), None);

        let list = scan(&game).expect("扫描");
        assert_eq!(list.len(), 1);
        assert!(!list[0].valid);
        assert!(list[0].problem.is_some());
    }

    fn sample(id: &str, file: &str, enabled: bool, deps: &[&str]) -> RwmlExtension {
        RwmlExtension {
            id: id.to_string(),
            name: id.to_string(),
            file: file.to_string(),
            main_class: None,
            ui_framework: None,
            depends_on: deps.iter().map(|dep| dep.to_string()).collect(),
            size: 0,
            enabled,
            valid: true,
            problem: None,
        }
    }

    #[test]
    fn flags_duplicate_ids_and_missing_deps() {
        let list = vec![
            sample("io.a", "a.jar", true, &[]),
            sample("io.a", "a-copy.jar", true, &[]),
            sample("io.b", "b.jar", true, &["io.a", "io.gone"]),
            // 停用的包不参与检查：它不会进加载器
            sample("io.c", "c.jar", false, &["io.zzz"]),
        ];

        let plan = analyze(&list);
        assert_eq!(plan.duplicate_ids.len(), 1);
        assert_eq!(plan.duplicate_ids[0].id, "io.a");
        assert_eq!(plan.duplicate_ids[0].files.len(), 2);
        assert_eq!(plan.missing.len(), 1);
        assert_eq!(plan.missing[0].owner, "io.b");
        assert_eq!(plan.missing[0].missing, "io.gone");
        assert!(plan.same_name.is_empty());
    }

    #[test]
    fn clean_set_has_no_findings() {
        let list = vec![
            sample("io.api", "api.jar", true, &[]),
            sample("io.client", "client.jar", true, &["io.api"]),
        ];

        let plan = analyze(&list);
        assert!(plan.duplicate_ids.is_empty());
        assert!(plan.missing.is_empty());
        assert!(plan.same_name.is_empty());
    }

    #[test]
    fn detects_same_file_in_both_dirs() {
        let list = vec![
            sample("io.a", "a.jar", true, &[]),
            sample("io.a", "a.jar", false, &[]),
        ];

        let plan = analyze(&list);
        assert_eq!(plan.same_name, vec!["a.jar".to_string()]);
        // 一启用一停用不算重复 id
        assert!(plan.duplicate_ids.is_empty());
    }
}
