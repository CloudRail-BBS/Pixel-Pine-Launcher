/** 前端与内核之间的唯一通道。
 *
 * 浏览器里（没有 Tauri 环境）自动退回演示数据，方便直接开 `npm run dev` 调样式。
 * 一旦跑在 Tauri 里，所有数据都来自真实目录。 */

import { invoke } from "@tauri-apps/api/core";

import * as mock from "./mock";
import type { GameMap, ImportedPackage, Instance, Loadout, LocalMod } from "./types";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface Probe {
  root: string;
  playable: boolean;
  exe: string | null;
  modsExists: boolean;
  writable: boolean;
}

export interface ConflictInfo {
  name: string;
  with: string;
  dirs: string[];
}

export interface ScanResult {
  mods: LocalMod[];
  conflicts: ConflictInfo[];
}

export interface Workspace {
  instances: Instance[];
  loadouts: Loadout[];
  mods: LocalMod[];
  /** 数据是否来自演示数据 */
  demo: boolean;
}

const DEMO_LOADOUTS: Loadout[] = mock.loadouts;

/** 首次加载：实例 → 预设 → Mod 列表。 */
export async function loadWorkspace(): Promise<Workspace> {
  if (!isTauri()) {
    return {
      instances: [mock.instance],
      loadouts: DEMO_LOADOUTS,
      mods: mock.localMods,
      demo: true,
    };
  }

  let instances = await invoke<Instance[]>("discover_instances");
  if (instances.length === 0) {
    instances = await invoke<Instance[]>("list_instances");
  }

  let loadouts = await invoke<Loadout[]>("list_loadouts");
  if (loadouts.length === 0) {
    const created = await invoke<Loadout>("create_loadout", {
      id: "vanilla",
      name: "原版纯净",
    });
    loadouts = [created];
  }

  const active = instances[0];
  const mods = active ? (await invoke<ScanResult>("scan_mods", { root: active.root })).mods : [];

  return { instances, loadouts, mods, demo: false };
}

export async function scanMods(root: string): Promise<ScanResult> {
  return invoke<ScanResult>("scan_mods", { root });
}

/** 扫描地图目录。演示模式下给几条假数据，免得页面空得莫名其妙。 */
export async function scanMaps(root: string): Promise<GameMap[]> {
  if (!isTauri()) {
    return [
      { name: "Big Island (2p)", sizeLabel: "64 × 64", size: 1_240_000, hasPreview: true },
      { name: "十字路口", sizeLabel: "48 × 48", size: 860_000, hasPreview: true },
      { name: "沙漠风暴", sizeLabel: "96 × 96", size: 1_540_000, hasPreview: false },
      { name: "冰封前线", sizeLabel: "32 × 32", size: 640_000, hasPreview: true },
      { name: "12p 大两岸", sizeLabel: "128 × 96", size: 2_180_000, hasPreview: false },
    ];
  }
  return invoke<GameMap[]>("scan_maps", { root });
}

export async function importPackage(
  root: string,
  loadoutId: string,
  path: string,
): Promise<ImportedPackage> {
  return invoke<ImportedPackage>("import_package", { root, loadoutId, path });
}

/** 从市场下载并安装。下载、校验、落盘都在内核侧完成，浏览器预览里不可用。 */
export async function installFromUrl(
  root: string,
  loadoutId: string,
  url: string,
  slug: string,
  version: string,
): Promise<ImportedPackage> {
  if (!isTauri()) {
    throw new Error("浏览器预览里不能安装资源，请在桌面端操作");
  }
  return invoke<ImportedPackage>("install_from_url", { root, loadoutId, url, slug, version });
}

export async function listLoadouts(): Promise<Loadout[]> {
  return invoke<Loadout[]>("list_loadouts");
}

export async function setModEnabled(root: string, name: string, enabled: boolean): Promise<void> {
  await invoke("set_mod_enabled", { root, name, enabled });
}

export async function launchGame(root: string): Promise<number> {
  return invoke<number>("launch_game", { root });
}

export async function attachLoadout(root: string, loadoutId: string): Promise<string> {
  return invoke<string>("attach_loadout", { root, loadoutId });
}

export async function linkStatus(root: string): Promise<"absent" | "managed" | "foreign"> {
  return invoke<"absent" | "managed" | "foreign">("link_status", { root });
}

/** 打开系统文件管理器选游戏目录。浏览器预览里没有这个能力，返回 null。 */
export async function pickDirectory(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择《铁锈战争》的游戏目录",
  });
  return typeof selected === "string" ? selected : null;
}

export async function addInstance(root: string): Promise<Instance> {
  return invoke<Instance>("add_instance", { root });
}

export async function probeDirectory(path: string): Promise<Probe> {
  return invoke<Probe>("probe_directory", { path });
}

export async function createLoadout(id: string, name: string): Promise<Loadout> {
  return invoke<Loadout>("create_loadout", { id, name });
}
