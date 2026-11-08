/** PPL 扩展的前端接口层。
 *
 * 注意这是**我们自己的一套**规范和目录（`<游戏目录>/ppl/extensions`），
 * 与社区加载器的 `extensions/` 不共用：
 * 包格式、描述符、启停语义都由本项目定义，见 `docs/EXTENSIONS.md`。
 */

import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "./api";
import type { ExtensionsView, PplExtension } from "./types";

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
