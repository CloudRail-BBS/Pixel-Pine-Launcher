/** PPL 扩展的前端接口层。
 *
 * 注意这是**我们自己的一套**规范和目录（`<游戏目录>/ppl/extensions`），
 * 与社区加载器的 `extensions/` 不共用：
 * 包格式、描述符、启停语义都由本项目定义，见 `docs/EXTENSIONS.md`。
 */

import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "./api";
import type { ExtensionsView, PplExtension, RwmlExtension, RwmlView } from "./types";

/**
 * 浏览器预览用的假数据。
 *
 * `npm run dev` 直接开页面调样式时没有 Tauri，内核调不到；
 * 给一份带「缺依赖 / 坏包 / 已停用」的样本，才能看到各种状态长什么样。
 */
const DEMO_VIEW: ExtensionsView = {
  dir: "D:/Steam/steamapps/common/Rusted Warfare/ppl/extensions",
  dirExists: true,
  extensions: [
    {
      descriptor: {
        schema: 1,
        id: "org.ppl.core",
        name: "PPL 核心库",
        version: "1.2.0",
        apiVersion: 1,
        mainClass: "org.ppl.core.CoreExtension",
        mixins: [],
        dependsOn: [],
        loadAfter: [],
        loadBefore: [],
        author: "CloudRail BBS",
        description: "其它扩展共用的接口与工具类，单独放一个包，避免互相抄实现。",
        minGame: "1.15",
      },
      file: "org.ppl.core.pplx",
      size: 48_200,
      enabled: true,
      valid: true,
      problem: null,
    },
    {
      descriptor: {
        schema: 1,
        id: "org.example.zoom",
        name: "缩放控制",
        version: "1.0.0",
        apiVersion: 1,
        mainClass: "org.example.zoom.ZoomExtension",
        mixins: ["org.example.zoom.mixin.CameraMixin"],
        dependsOn: ["org.ppl.core"],
        loadAfter: [],
        loadBefore: [],
        author: "someone",
        description: "相机缩放上限放宽到 4 倍，滚轮手感更接近即时战略的常规值。",
        minGame: "1.15",
      },
      file: "org.example.zoom.pplx",
      size: 132_400,
      enabled: true,
      valid: true,
      problem: null,
    },
    {
      descriptor: {
        schema: 1,
        id: "org.example.audio",
        name: "音效增强",
        version: "0.3.0",
        apiVersion: 1,
        mainClass: null,
        mixins: [],
        dependsOn: ["org.example.missing"],
        loadAfter: [],
        loadBefore: [],
        author: "",
        description: "替换部分环境音，缺少依赖所以不会被加载。",
        minGame: null,
      },
      file: "org.example.audio.pplx",
      size: 2_411_000,
      enabled: true,
      valid: true,
      problem: null,
    },
    {
      descriptor: {
        schema: 1,
        id: "old-pack.pplx",
        name: "old-pack.pplx",
        version: "",
        apiVersion: 1,
        mainClass: null,
        mixins: [],
        dependsOn: [],
        loadAfter: [],
        loadBefore: [],
        author: "",
        description: "",
        minGame: null,
      },
      file: "old-pack.pplx",
      size: 8_900,
      enabled: false,
      valid: false,
      problem: "包里没有 ppl-extension.json，不是 PPL 扩展",
    },
  ],
  plan: {
    order: ["org.ppl.core", "org.example.zoom"],
    missing: [{ owner: "org.example.audio", missing: "org.example.missing" }],
    cycles: [],
    incompatible: [],
  },
};

/** 扫描已装扩展并算出加载计划。 */
export async function scanExtensions(root: string): Promise<ExtensionsView> {
  if (!isTauri()) return DEMO_VIEW;
  return invoke<ExtensionsView>("scan_extensions", { root });
}

/** 导入一个 `.pplx` / `.zip`。不含描述符的包会被内核拒收。 */
export async function importExtension(root: string, path: string): Promise<PplExtension> {
  return invoke<PplExtension>("import_extension", { root, path });
}

export async function setExtensionEnabled(
  root: string,
  file: string,
  enabled: boolean,
): Promise<void> {
  await invoke("set_extension_enabled", { root, file, enabled });
}

export async function removeExtension(root: string, file: string): Promise<void> {
  await invoke("remove_extension", { root, file });
}

/** 打开系统文件选择器挑扩展包。浏览器预览里返回 null。 */
export async function pickPackage(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    title: "选择 PPL 扩展包",
    filters: [{ name: "PPL 扩展", extensions: ["pplx", "zip"] }],
  });
  return typeof selected === "string" ? selected : null;
}

/* ---------- RWML 兼容模式 ----------
 *
 * 只做文件管理：读对方的描述符做展示，开关就是移动文件。
 * 不加载、不注入，也不替用户安装加载器本体。
 */

export async function scanRwml(root: string): Promise<RwmlView> {
  return invoke<RwmlView>("scan_rwml", { root });
}

export async function importRwml(root: string, path: string): Promise<RwmlExtension> {
  return invoke<RwmlExtension>("import_rwml", { root, path });
}

export async function setRwmlEnabled(
  root: string,
  file: string,
  enabled: boolean,
): Promise<void> {
  await invoke("set_rwml_enabled", { root, file, enabled });
}

export async function removeRwml(root: string, file: string): Promise<void> {
  await invoke("remove_rwml", { root, file });
}

/** 挑 RWML 扩展的 jar。 */
export async function pickJar(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    title: "选择 RWML 扩展（.jar）",
    filters: [{ name: "RWML 扩展", extensions: ["jar"] }],
  });
  return typeof selected === "string" ? selected : null;
}

/** 记住用户选的格式，默认 PPL。 */
const FORMAT_KEY = "ppl.extensions.format";

export type ExtensionFormat = "ppl" | "rwml";

export function readFormat(): ExtensionFormat {
  if (typeof localStorage === "undefined") return "ppl";
  return localStorage.getItem(FORMAT_KEY) === "rwml" ? "rwml" : "ppl";
}

export function saveFormat(format: ExtensionFormat): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(FORMAT_KEY, format);
}
