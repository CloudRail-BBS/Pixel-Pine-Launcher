/** PPL 扩展的前端接口层。
 *
 * 注意这是**我们自己的一套**规范和目录（`<游戏目录>/ppl/extensions`），
 * 与社区加载器的 `extensions/` 不共用：
 * 包格式、描述符、启停语义都由本项目定义，见 `docs/EXTENSIONS.md`。
 */

import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "./api";
import type { ExtensionsView, PplExtension, RwmlExtension, RwmlView } from "./types";

/** 扫描已装扩展并算出加载计划。 */
export async function scanExtensions(root: string): Promise<ExtensionsView> {
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
