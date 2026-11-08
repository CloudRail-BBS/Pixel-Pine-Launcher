//! PPL 扩展：我们自己的加载器规范。
//!
//! 《铁锈战争》没有官方加载器，社区里那套（RWML / RWPP）的许可证与本项目不兼容，
//! 所以这里**不复用它的目录、描述符或包格式**，另起一套：
//!
//! | | 社区方案 | PPL |
//! |---|---|---|
//! | 目录 | `extensions/` | `ppl/extensions/` |
//! | 描述符 | `META-INF/extension.properties` | 包根 `ppl-extension.json` |
//! | 包后缀 | `.jar` | `.pplx`（本质是 zip） |
//! | 依赖 | 加载器自行解析 | 启动器算出加载顺序再交给运行时 |
//!
//! 目录单独放在 `ppl/` 下还有个实际好处：用户同时装了社区加载器时，
//! 两边互不干扰，不会出现「我禁用了怎么还在跑」。
//!
//! ## 分工
//!
//! 内核只做**静态部分**：识别、安装、启停、依赖解析、加载顺序。
//! 真正改写游戏类的那部分在运行时（JVM agent）里，它读启动器生成的清单。
//! 这样拆的原因是：顺序算错会让游戏直接崩，必须有单元测试兜住；
//! 而字节码改写没法在启动器进程里做。
//!
//! 运行时尚未实现，设计见 `docs/EXTENSIONS.md`。

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// PPL 在游戏目录下的私有根目录。
pub const PPL_DIR: &str = "ppl";
/// 扩展所在子目录。
pub const EXTENSIONS_DIR: &str = "extensions";
/// 停用的扩展挪到这里。
pub const DISABLED_DIR: &str = ".disabled";
/// 描述符文件名。
pub const DESCRIPTOR: &str = "ppl-extension.json";
/// 当前描述符格式版本。
pub const SCHEMA: u32 = 1;
/// 当前运行时 API 版本。扩展声明更高的版本就不加载。
pub const API_VERSION: u32 = 1;

/// 扩展描述符。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Descriptor {
    /// 格式版本，目前只认 1。
    #[serde(default = "default_schema")]
    pub schema: u32,
    /// 唯一标识，也是依赖关系的键。建议用反向域名。
    pub id: String,
    /// 展示名。
    #[serde(default)]
    pub name: String,
    /// 版本号，仅展示。
    #[serde(default)]
    pub version: String,
    /// 需要的运行时 API 版本。
    #[serde(default = "default_api")]
    pub api_version: u32,
    /// 入口类。由运行时实例化。
    #[serde(default)]
    pub main_class: Option<String>,
    /// 要注入的 mixin 类。
    #[serde(default)]
    pub mixins: Vec<String>,
    /// 硬依赖。可带 `@` 版本约束，启动器只取 id。
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// 希望排在谁后面。
    #[serde(default)]
    pub load_after: Vec<String>,
    /// 希望排在谁前面。
    #[serde(default)]
    pub load_before: Vec<String>,
    /// 作者。
    #[serde(default)]
    pub author: String,
    /// 简介。
    #[serde(default)]
    pub description: String,
    /// 最低游戏版本。
    #[serde(default)]
    pub min_game: Option<String>,
}

fn default_schema() -> u32 {
    SCHEMA
}

fn default_api() -> u32 {
    API_VERSION
}

impl Descriptor {
    /// 解析并校验。id 不合法直接拒收——它会变成文件名。
    pub fn parse(text: &str) -> crate::Result<Self> {
        let mut descriptor: Descriptor = serde_json::from_str(text)
            .map_err(|error| crate::Error::Manifest(error.to_string()))?;

        if descriptor.schema != SCHEMA {
            return Err(crate::Error::Manifest(format!(
                "扩展格式版本是 {}，这个启动器只认 {SCHEMA}",
                descriptor.schema
            )));
        }
        if !is_valid_id(&descriptor.id) {
            return Err(crate::Error::Manifest(format!(
                "扩展 id 不合法：{}（只允许字母、数字、点、下划线、短横线）",
                descriptor.id
            )));
        }

        // 版本约束在解析阶段就剥掉，后面所有比较都只看 id
        descriptor.depends_on = normalize_list(&descriptor.depends_on);
        descriptor.load_after = normalize_list(&descriptor.load_after);
        descriptor.load_before = normalize_list(&descriptor.load_before);

        if descriptor.name.trim().is_empty() {
            descriptor.name = descriptor.id.clone();
        }

        Ok(descriptor)
    }

    /// 能不能在当前运行时上加载。
    pub fn is_compatible(&self) -> bool {
        self.api_version <= API_VERSION
    }
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
        && !id.starts_with('.')
}

/// `a, b@1.0` → `["a", "b"]`。
fn normalize_list(items: &[String]) -> Vec<String> {
    let mut out: Vec<String> = items
        .iter()
        .flat_map(|item| item.split(','))
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(|item| item.split('@').next().unwrap_or(item).trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    out.sort();
    out.dedup();
    out
}

/// 一个已安装的扩展。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extension {
    /// 描述符。
    pub descriptor: Descriptor,
    /// 相对于扩展目录的文件名。
    pub file: String,
    /// 包体积。
    pub size: u64,
    /// 是否启用。
    pub enabled: bool,
    /// 描述符是否读得出来。读不出来说明包是坏的，放进去也不会生效。
    pub valid: bool,
    /// 读不出来时的原因。
    pub problem: Option<String>,
}

impl Extension {
    /// id，快捷访问。
    pub fn id(&self) -> &str {
        &self.descriptor.id
    }

    /// 展示名。
    pub fn title(&self) -> &str {
        &self.descriptor.name
    }
}

/// 加载计划。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadPlan {
    /// 按加载顺序排好的 id。
    pub order: Vec<String>,
    /// 被依赖但没装（或装了但停用）的。
    pub missing: Vec<MissingDependency>,
    /// 互相依赖成环的 id 组。有环时整组都不加载。
    pub cycles: Vec<Vec<String>>,
    /// API 版本过高、加载不了的。
    pub incompatible: Vec<String>,
}

/// 一条缺失依赖。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingDependency {
    /// 谁需要它。
    pub owner: String,
    /// 缺的 id。
    pub missing: String,
}

/// 扩展目录。
pub fn extensions_dir(root: &Path) -> PathBuf {
    root.join(PPL_DIR).join(EXTENSIONS_DIR)
}

/// 扫描已安装与已停用的扩展。
pub fn scan_extensions(root: &Path) -> crate::Result<Vec<Extension>> {
    let dir = extensions_dir(root);
    let mut list = Vec::new();

    if dir.is_dir() {
        collect(&dir, true, &mut list)?;
    }
    let disabled = dir.join(DISABLED_DIR);
    if disabled.is_dir() {
        collect(&disabled, false, &mut list)?;
    }

    list.sort_by_key(|item| item.title().to_lowercase());
    Ok(list)
}

fn collect(dir: &Path, enabled: bool, out: &mut Vec<Extension>) -> crate::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file = entry.file_name().to_string_lossy().into_owned();
        if !is_package(&file) {
            continue;
        }
        let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);

        out.push(match read_descriptor(&path) {
            Ok(descriptor) => Extension {
                descriptor,
                file,
                size,
                enabled,
                valid: true,
                problem: None,
            },
            Err(error) => Extension {
                // 坏包也要列出来：用户明明把文件放进去了，
                // 界面上却什么都没有，比报错更让人困惑
                descriptor: empty_descriptor(&file),
                file,
                size,
                enabled,
                valid: false,
                problem: Some(error.to_string()),
            },
        });
    }
    Ok(())
}

fn empty_descriptor(file: &str) -> Descriptor {
    Descriptor {
        schema: SCHEMA,
        id: file.to_string(),
        name: file.to_string(),
        version: String::new(),
        api_version: API_VERSION,
        main_class: None,
        mixins: Vec::new(),
        depends_on: Vec::new(),
        load_after: Vec::new(),
        load_before: Vec::new(),
        author: String::new(),
        description: String::new(),
        min_game: None,
    }
}

/// 只认 `.pplx` 和 `.zip`。
fn is_package(file: &str) -> bool {
    let lower = file.to_ascii_lowercase();
    lower.ends_with(".pplx") || lower.ends_with(".zip")
}

/// 从包里读描述符。
fn read_descriptor(path: &Path) -> crate::Result<Descriptor> {
    let file = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| crate::Error::InvalidPackage(format!("不是有效的 zip 包：{error}")))?;

    let index = (0..archive.len())
        .find(|&index| {
            archive
                .by_index(index)
                .map(|entry| {
                    entry
                        .name()
                        .map(|name| {
                            name.trim_start_matches("./")
                                .eq_ignore_ascii_case(DESCRIPTOR)
                        })
                        .unwrap_or(false)
                })
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            crate::Error::InvalidPackage(format!("包里没有 {DESCRIPTOR}，不是 PPL 扩展"))
        })?;

    let mut entry = archive
        .by_index(index)
        .map_err(|error| crate::Error::InvalidPackage(format!("读取描述符失败：{error}")))?;
    let mut buffer = Vec::new();
    // 描述符只有几百字节，但坏包不该有机会吃内存
    std::io::copy(&mut entry.by_ref().take(256 * 1024), &mut buffer)?;
    let text = String::from_utf8_lossy(&buffer).into_owned();

    Descriptor::parse(&text)
}

/// 算出启用的扩展该怎么排序加载。
///
/// 排序规则：先按 `dependsOn`（硬依赖必须先加载），再按 `loadAfter` / `loadBefore`
/// 的偏好，最后按 id 字典序兜底——**必须是确定的**，
/// 否则同一批扩展装在两台机器上加载顺序不同，问题会变得极难复现。
pub fn build_plan(extensions: &[Extension]) -> LoadPlan {
    let enabled: Vec<&Extension> = extensions
        .iter()
        .filter(|item| item.enabled && item.valid)
        .collect();

    let mut plan = LoadPlan::default();

    // 版本太高的直接剔除，不参与排序
    let mut usable: Vec<&Extension> = Vec::new();
    for item in enabled {
        if item.descriptor.is_compatible() {
            usable.push(item);
        } else {
            plan.incompatible.push(item.id().to_string());
        }
    }

    let ids: std::collections::HashSet<&str> = usable.iter().map(|item| item.id()).collect();

    // 缺依赖：先记下来，但不阻止加载其他人——少一个扩展总比整组不加载好
    for item in &usable {
        for dep in &item.descriptor.depends_on {
            if !ids.contains(dep.as_str()) {
                plan.missing.push(MissingDependency {
                    owner: item.title().to_string(),
                    missing: dep.clone(),
                });
            }
        }
    }

    // 拓扑排序：边是「u 必须在 v 之前」
    let mut edges: std::collections::HashMap<&str, Vec<&str>> = std::collections::HashMap::new();
    let mut indegree: std::collections::HashMap<&str, usize> =
        usable.iter().map(|item| (item.id(), 0)).collect();

    for item in &usable {
        for dep in &item.descriptor.depends_on {
            if ids.contains(dep.as_str()) && dep != item.id() {
                edges.entry(dep.as_str()).or_default().push(item.id());
                if let Some(count) = indegree.get_mut(item.id()) {
                    *count += 1;
                }
            }
        }
        for after in &item.descriptor.load_after {
            if ids.contains(after.as_str()) && after != item.id() {
                edges.entry(after.as_str()).or_default().push(item.id());
                if let Some(count) = indegree.get_mut(item.id()) {
                    *count += 1;
                }
            }
        }
        for before in &item.descriptor.load_before {
            if ids.contains(before.as_str()) && before != item.id() {
                edges.entry(item.id()).or_default().push(before.as_str());
                if let Some(count) = indegree.get_mut(before.as_str()) {
                    *count += 1;
                }
            }
        }
    }

    // Kahn 算法，每轮从「入度为 0」里取字典序最小的，保证结果稳定
    let mut ready: Vec<&str> = indegree
        .iter()
        .filter(|(_, count)| **count == 0)
        .map(|(id, _)| *id)
        .collect();
    ready.sort_unstable();

    while let Some(next) = ready.first().copied() {
        ready.remove(0);
        plan.order.push(next.to_string());

        if let Some(targets) = edges.get(next) {
            let mut unlocked: Vec<&str> = Vec::new();
            for target in targets {
                if let Some(count) = indegree.get_mut(target) {
                    *count = count.saturating_sub(1);
                    if *count == 0 {
                        unlocked.push(target);
                    }
                }
            }
            ready.extend(unlocked);
            ready.sort_unstable();
        }
    }

    // 排不完的就是环里的，整组报出来
    if plan.order.len() != usable.len() {
        let mut stuck: Vec<String> = usable
            .iter()
            .map(|item| item.id().to_string())
            .filter(|id| !plan.order.contains(id))
            .collect();
        stuck.sort();
        plan.cycles.push(stuck);
    }

    plan
}

/// 导入一个扩展包。
pub fn import_extension(root: &Path, package: &Path) -> crate::Result<Extension> {
    if !package.is_file() {
        return Err(crate::Error::InvalidPackage(format!(
            "{} 不存在",
            package.display()
        )));
    }

    // 先解析一遍：不合格的包不该被复制进游戏目录
    let descriptor = read_descriptor(package)?;

    let dir = extensions_dir(root);
    std::fs::create_dir_all(&dir)?;

    let file = format!("{}.pplx", descriptor.id);
    let target = dir.join(&file);

    // 同 id 的停用版先清掉，避免「启用版 + 停用版」并存
    let stale = dir.join(DISABLED_DIR).join(&file);
    if stale.is_file() {
        let _ = std::fs::remove_file(&stale);
    }

    std::fs::copy(package, &target)?;

    let size = std::fs::metadata(&target)
        .map(|meta| meta.len())
        .unwrap_or(0);
    Ok(Extension {
        descriptor,
        file,
        size,
        enabled: true,
        valid: true,
        problem: None,
    })
}

/// 启用 / 停用。停用是移进 `.disabled/`，随时能移回来。
pub fn set_extension_enabled(root: &Path, file: &str, enabled: bool) -> crate::Result<()> {
    let dir = extensions_dir(root);
    let disabled = dir.join(DISABLED_DIR);

    let (from, to) = if enabled {
        (disabled.join(file), dir.join(file))
    } else {
        (dir.join(file), disabled.join(file))
    };

    if !from.is_file() {
        return Err(crate::Error::ExtensionNotFound(file.to_string()));
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

/// 删除扩展包。只删包，不碰它可能生成的数据。
pub fn remove_extension(root: &Path, file: &str) -> crate::Result<()> {
    let dir = extensions_dir(root);
    for candidate in [dir.join(file), dir.join(DISABLED_DIR).join(file)] {
        if candidate.is_file() {
            std::fs::remove_file(candidate)?;
            return Ok(());
        }
    }
    Err(crate::Error::ExtensionNotFound(file.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ppl-ext-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("建临时目录");
        dir
    }

    fn make_package(path: &Path, descriptor: Option<&str>) {
        let file = std::fs::File::create(path).expect("建包");
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        if let Some(text) = descriptor {
            zip.start_file(DESCRIPTOR, options).expect("写描述符");
            zip.write_all(text.as_bytes()).expect("写内容");
        }
        zip.start_file("com/example/Main.class", options)
            .expect("写类");
        zip.write_all(b"\xca\xfe\xba\xbe").expect("写字节");
        zip.finish().expect("收尾");
    }

    fn ext(id: &str, deps: &[&str], after: &[&str]) -> Extension {
        Extension {
            descriptor: Descriptor {
                schema: SCHEMA,
                id: id.to_string(),
                name: id.to_string(),
                version: "1.0.0".into(),
                api_version: API_VERSION,
                main_class: None,
                mixins: Vec::new(),
                depends_on: normalize_list(&deps.iter().map(|s| s.to_string()).collect::<Vec<_>>()),
                load_after: normalize_list(
                    &after.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                ),
                load_before: Vec::new(),
                author: String::new(),
                description: String::new(),
                min_game: None,
            },
            file: format!("{id}.pplx"),
            size: 0,
            enabled: true,
            valid: true,
            problem: None,
        }
    }

    #[test]
    fn parses_descriptor_and_strips_version_constraints() {
        let text = r#"{
            "schema": 1,
            "id": "org.example.zoom",
            "name": "缩放控制",
            "dependsOn": ["ppl.core@>=1", "other,third"],
            "loadAfter": ["ppl.ui"]
        }"#;

        let descriptor = Descriptor::parse(text).expect("解析");
        assert_eq!(descriptor.id, "org.example.zoom");
        assert_eq!(descriptor.name, "缩放控制");
        assert_eq!(descriptor.depends_on, vec!["other", "ppl.core", "third"]);
        assert_eq!(descriptor.load_after, vec!["ppl.ui"]);
    }

    #[test]
    fn rejects_bad_id_and_schema() {
        assert!(Descriptor::parse(r#"{"schema": 2, "id": "a.b"}"#).is_err());
        // 含斜杠的 id 会变成路径，必须拒
        assert!(Descriptor::parse(r#"{"schema": 1, "id": "a/b"}"#).is_err());
        assert!(Descriptor::parse(r#"{"schema": 1, "id": "../evil"}"#).is_err());
    }

    #[test]
    fn orders_by_dependency_then_preference() {
        let list = vec![
            ext("app", &["lib"], &[]),
            ext("lib", &["core"], &[]),
            ext("core", &[], &[]),
            ext("plugin", &[], &["app"]),
        ];

        let plan = build_plan(&list);
        let position = |id: &str| plan.order.iter().position(|item| item == id).unwrap();

        assert!(position("core") < position("lib"));
        assert!(position("lib") < position("app"));
        assert!(position("app") < position("plugin"));
        assert!(plan.missing.is_empty());
        assert!(plan.cycles.is_empty());
    }

    #[test]
    fn reports_missing_dependency_without_blocking() {
        let list = vec![ext("app", &["absent.lib"], &[]), ext("other", &[], &[])];

        let plan = build_plan(&list);
        assert_eq!(plan.missing.len(), 1);
        assert_eq!(plan.missing[0].missing, "absent.lib");
        // 缺依赖不该把其他扩展一起拖下水
        assert!(plan.order.contains(&"other".to_string()));
    }

    #[test]
    fn detects_cycle() {
        let list = vec![
            ext("a", &["b"], &[]),
            ext("b", &["a"], &[]),
            ext("c", &[], &[]),
        ];

        let plan = build_plan(&list);
        assert_eq!(plan.cycles.len(), 1);
        assert_eq!(plan.cycles[0], vec!["a", "b"]);
        // 环外的 c 照常加载
        assert_eq!(plan.order, vec!["c"]);
    }

    #[test]
    fn disabled_extensions_are_skipped() {
        let mut list = vec![ext("core", &[], &[]), ext("app", &["core"], &[])];
        list[0].enabled = false;

        let plan = build_plan(&list);
        assert_eq!(plan.order, vec!["app"]);
        // core 停用了，app 的依赖就是缺的
        assert_eq!(plan.missing.len(), 1);
    }

    #[test]
    fn imports_scans_and_toggles() {
        let base = temp("lifecycle");
        let game = base.join("game");
        std::fs::create_dir_all(&game).expect("建游戏目录");

        let package = base.join("zoom.pplx");
        make_package(
            &package,
            Some(r#"{"schema":1,"id":"org.example.zoom","name":"缩放"}"#),
        );

        let imported = import_extension(&game, &package).expect("导入");
        assert_eq!(imported.file, "org.example.zoom.pplx");

        let list = scan_extensions(&game).expect("扫描");
        assert_eq!(list.len(), 1);
        assert!(list[0].enabled);

        set_extension_enabled(&game, &imported.file, false).expect("停用");
        let list = scan_extensions(&game).expect("再扫");
        assert!(!list[0].enabled);

        remove_extension(&game, &imported.file).expect("删除");
        assert!(scan_extensions(&game).expect("三扫").is_empty());
    }

    #[test]
    fn keeps_broken_package_visible() {
        let base = temp("broken");
        let game = base.join("game");
        std::fs::create_dir_all(extensions_dir(&game)).expect("建扩展目录");

        make_package(&extensions_dir(&game).join("bad.pplx"), None);

        let list = scan_extensions(&game).expect("扫描");
        assert_eq!(list.len(), 1);
        assert!(!list[0].valid);
        assert!(list[0].problem.is_some());

        // 坏包不参与排序
        assert!(build_plan(&list).order.is_empty());
    }

    #[test]
    fn rejects_package_without_descriptor() {
        let base = temp("reject");
        let game = base.join("game");
        std::fs::create_dir_all(&game).expect("建游戏目录");

        let package = base.join("plain.zip");
        make_package(&package, None);

        let error = import_extension(&game, &package).expect_err("应拒绝");
        assert!(matches!(error, crate::Error::InvalidPackage(_)));
        assert!(!extensions_dir(&game).join("plain.pplx").exists());
    }
}
