/** 游戏本体的下载与安装。
 *
 * 版本清单由运营方托管，代码里不写死任何下载地址——
 * 能不能分发《铁锈战争》本体取决于授权，属于运营决策，不该埋进二进制。
 * 没有清单时界面会退回「去官方渠道」，而不是给一个点了没反应的按钮。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { isTauri } from "./api";

export interface GameVersion {
  version: string;
  channel: string;
  platform: string;
  size: number;
  sha256: string;
  urls: string[];
  archive: string;
  entry: string;
  notes: string;
}

export interface GameCatalog {
  platform: string;
  channels: string[];
  /** 已按版本号从新到旧排好，前端不用再比一次 */
  versions: GameVersion[];
}

export interface GameProgress {
  downloaded: number;
  total: number;
}

const SOURCE_KEY = "ppl.game.source";

/** 官方清单地址。没有内容时服务端返回 204，界面按「暂无版本」处理。 */
export const OFFICIAL_GAME_SOURCE = "https://ziyuan.pixelpine.org/v1/game/index.json";

/** 拿不到下载时引导去的官方渠道。 */
export const STORE_URL = "https://store.steampowered.com/app/647960/";

export function gameSource(): string {
  if (typeof localStorage === "undefined") return OFFICIAL_GAME_SOURCE;
  return localStorage.getItem(SOURCE_KEY)?.trim() || OFFICIAL_GAME_SOURCE;
}

export function setGameSource(value: string): string {
  const next = value.trim();
  if (typeof localStorage !== "undefined") {
    if (next && next !== OFFICIAL_GAME_SOURCE) localStorage.setItem(SOURCE_KEY, next);
    else localStorage.removeItem(SOURCE_KEY);
  }
  return next || OFFICIAL_GAME_SOURCE;
}

/** 拉版本清单。浏览器预览里直接 fetch，桌面端走 Rust（避开跨域与混合内容）。 */
export async function fetchCatalog(source = gameSource()): Promise<GameCatalog> {
  if (isTauri()) {
    return invoke<GameCatalog>("fetch_game_catalog", { url: source });
  }

  const response = await fetch(source, { headers: { accept: "application/json" } });
  if (response.status === 204) {
    return { platform: "windows", channels: [], versions: [] };
  }
  if (!response.ok) throw new Error(`版本清单返回 ${response.status}`);

  const body = (await response.json()) as {
    versions?: GameVersion[];
  };
  const versions = (body.versions ?? []).filter(
    (item) => item.platform === "windows" && item.urls?.length > 0,
  );
  versions.sort((a, b) => compare(b.version, a.version));

  const channels = Array.from(new Set(versions.map((item) => item.channel))).sort();
  return { platform: "windows", channels, versions };
}

function compare(a: string, b: string): number {
  const parse = (value: string) =>
    value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const len = Math.max(left.length, right.length);
  for (let index = 0; index < len; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l !== r) return l - r;
  }
  return 0;
}

/** 推荐安装目录：`<数据根>/games/Rusted Warfare`。 */
export async function suggestedTarget(): Promise<string> {
  if (!isTauri()) return "Rusted Warfare";
  const root = await invoke<string>("games_root");
  return `${root}\\Rusted Warfare`;
}

export interface GameInstall {
  root: string;
  files: number;
  bytes: number;
}

/**
 * 下载并安装。按 urls 顺序试，前一个失败自动换下一个。
 *
 * 进度通过 `game-progress` 事件推过来，所以调用方要先订阅
 * [`onGameProgress`]，否则只能看到开始和结束。
 */
export async function installGame(
  version: GameVersion,
  target: string,
  onNote?: (message: string) => void,
): Promise<GameInstall> {
  if (!isTauri()) {
    throw new Error("浏览器预览里不能安装游戏，请在桌面端操作");
  }
  if (version.urls.length === 0) {
    throw new Error("这个版本没有可用的下载地址");
  }

  let lastError: unknown = null;
  for (const url of version.urls) {
    try {
      return await invoke<GameInstall>("install_game_from_url", {
        url,
        target,
        sha256: version.sha256,
        entry: version.entry || null,
      });
    } catch (error) {
      lastError = error;
      onNote?.(`下载源失败，正在换源：${String(error)}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** 订阅下载进度。返回取消订阅函数。 */
export async function onGameProgress(
  handler: (progress: GameProgress) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const unlisten = await listen<GameProgress>("game-progress", (event) => handler(event.payload));
  return unlisten;
}

/** 用系统浏览器打开链接（商店页、清单文档等）。 */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    await invoke("open_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** 体积格式化，和列表里的口径保持一致。 */
export function formatSize(bytes: number): string {
  if (!bytes) return "未知大小";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
