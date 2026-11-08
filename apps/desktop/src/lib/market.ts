/** 资源市场的取数层。
 *
 * 支持多个市场源：
 * - `ppl`：自家服务端协议（`/v1/packages` 返回 `{ items, page, pageSize, total }`）
 * - `generic`：任何返回 JSON 列表的第三方市场，按常见字段名做归一化
 *
 * 官方实例默认 HTTPS。填 http 会自动升级——线上服务做了 301 强制跳转，
 * 而跨域预检遇到 301 会直接失败，所以 http 在现代浏览器里根本走不通。
 */

import type { MarketPageResult, RemotePackage } from "./types";

export type MarketFormat = "ppl" | "generic";

export interface MarketSource {
  id: string;
  /** 显示名，可改 */
  name: string;
  base: string;
  format: MarketFormat;
  /** 官方源不允许删除 */
  builtin: boolean;
}

export const OFFICIAL_BASE = "https://ziyuan.pixelpine.org";
export const OFFICIAL_ID = "official";

const SOURCES_KEY = "ppl.market.sources";
const ACTIVE_KEY = "ppl.market.active";

/** 一次取多少条。数量小，前端过滤比来回请求更顺滑。 */
export const PAGE_SIZE = 100;

const OFFICIAL: MarketSource = {
  id: OFFICIAL_ID,
  name: "官方市场",
  base: OFFICIAL_BASE,
  format: "ppl",
  builtin: true,
};

/** 公网地址一律升级到 HTTPS；本地和内网保留 http，否则自建实例调试不了。 */
function normalizeBase(input: string): string {
  let value = input.trim().replace(/\/+$/, "");
  if (!value) return OFFICIAL_BASE;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  const isLocal =
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
      value,
    );
  if (!isLocal && /^http:\/\//i.test(value)) value = value.replace(/^http:/i, "https:");
  return value;
}

function readCustom(): MarketSource[] {
  try {
    const raw = localStorage.getItem(SOURCES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is MarketSource => {
        if (!item || typeof item !== "object") return false;
        const row = item as Partial<MarketSource>;
        return typeof row.id === "string" && typeof row.base === "string";
      })
      .map((item) => ({
        ...item,
        base: normalizeBase(item.base),
        format: item.format === "generic" ? "generic" : "ppl",
        builtin: false,
      }));
  } catch {
    return [];
  }
}

function writeCustom(sources: MarketSource[]): void {
  try {
    localStorage.setItem(
      SOURCES_KEY,
      JSON.stringify(sources.filter((item) => !item.builtin)),
    );
  } catch {
    // 隐私模式下存不下，本次会话仍然生效
  }
}

export function listSources(): MarketSource[] {
  return [OFFICIAL, ...readCustom()];
}

export function activeSource(): MarketSource {
  const id = localStorage.getItem(ACTIVE_KEY);
  const all = listSources();
  return all.find((item) => item.id === id) ?? OFFICIAL;
}

export function setActiveSource(id: string): void {
  if (id === OFFICIAL_ID) localStorage.removeItem(ACTIVE_KEY);
  else localStorage.setItem(ACTIVE_KEY, id);
}

export function addSource(input: {
  name: string;
  base: string;
  format: MarketFormat;
}): MarketSource {
  const source: MarketSource = {
    id: `src-${Date.now().toString(36)}`,
    name: input.name.trim() || "自定义市场",
    base: normalizeBase(input.base),
    format: input.format,
    builtin: false,
  };
  const custom = readCustom().filter((item) => item.base !== source.base);
  writeCustom([...custom, source]);
  return source;
}

export function removeSource(id: string): void {
  writeCustom(readCustom().filter((item) => item.id !== id));
  if (localStorage.getItem(ACTIVE_KEY) === id) localStorage.removeItem(ACTIVE_KEY);
}

/** 兼容旧接口：只返回当前源地址。 */
export function marketBase(): string {
  return activeSource().base;
}

/** 兼容旧接口：设地址等于更新官方源之外的“唯一自定义源”。 */
export function setMarketBase(value: string): string {
  const base = normalizeBase(value);
  if (base === OFFICIAL_BASE) {
    setActiveSource(OFFICIAL_ID);
    return OFFICIAL_BASE;
  }
  const custom = readCustom();
  const existing = custom.find((item) => item.base === base);
  if (existing) {
    setActiveSource(existing.id);
    return base;
  }
  const created = addSource({ name: "自定义市场", base, format: "ppl" });
  setActiveSource(created.id);
  return created.base;
}

export function isDefaultBase(): boolean {
  return activeSource().id === OFFICIAL_ID;
}

// ---------- 取数 ----------

/** 拉取资源列表。失败时抛出的 Error.message 已是中文短句，可直接展示。 */
export async function listPackages(
  options: { q?: string; page?: number; size?: number; source?: MarketSource } = {},
): Promise<MarketPageResult> {
  const source = options.source ?? activeSource();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const { url, init } = buildRequest(source, options);
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      if (response.status === 503) {
        throw new Error("市场服务暂时不可用（数据库未就绪）");
      }
      if (response.status === 404) {
        throw new Error("这个地址没有市场接口（404），检查是否填错路径");
      }
      throw new Error(`市场返回 ${response.status}`);
    }
    const body: unknown = await response.json();
    return source.format === "ppl" ? parsePpl(body) : parseGeneric(body);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("连接市场超时，检查网络或在设置里换市场源");
    }
    if (error instanceof TypeError) {
      throw new Error("连不上市场服务，检查网络或在设置里换市场源");
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}

function buildRequest(
  source: MarketSource,
  options: { q?: string; page?: number; size?: number },
): { url: string; init: RequestInit } {
  const headers = { accept: "application/json" };

  if (source.format === "ppl") {
    const params = new URLSearchParams();
    const query = options.q?.trim();
    if (query) params.set("q", query);
    params.set("page", String(options.page ?? 1));
    params.set("size", String(options.size ?? PAGE_SIZE));
    return {
      url: `${source.base}/v1/packages?${params.toString()}`,
      init: { headers },
    };
  }

  // 通用源：地址就是列表端点本身，用户自己填完整 URL
  return { url: source.base, init: { headers } };
}

function parsePpl(body: unknown): MarketPageResult {
  const data = (body ?? {}) as Partial<MarketPageResult>;
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    items: items.map(normalizePackage).filter((item): item is RemotePackage => item !== null),
    page: typeof data.page === "number" ? data.page : 1,
    pageSize: typeof data.pageSize === "number" ? data.pageSize : items.length,
    total:
      typeof data.total === "number"
        ? data.total
        : items.length,
  };
}

/** 通用源：接受数组，或 `{items|data|packages|list}` 包一层。 */
function parseGeneric(body: unknown): MarketPageResult {
  const list = Array.isArray(body)
    ? body
    : pickArray(body as Record<string, unknown>, ["items", "data", "packages", "list", "results"]);

  const items = list
    .map(normalizePackage)
    .filter((item): item is RemotePackage => item !== null);

  return { items, page: 1, pageSize: items.length, total: items.length };
}

function pickArray(
  body: Record<string, unknown> | null,
  keys: string[],
): unknown[] {
  if (!body) return [];
  for (const key of keys) {
    const value = body[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

/** 把各种市场的字段名归一到自己的结构。认不出标题的条目直接丢弃。 */
function normalizePackage(raw: unknown): RemotePackage | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;

  const title = text(row, ["title", "name", "displayName", "packageName"]);
  if (!title) return null;

  const slug = text(row, ["slug", "id", "packageId", "key"]) ?? title;
  const kindRaw = (text(row, ["kind", "type", "category"]) ?? "mod").toLowerCase();
  const kind: "mod" | "map" = kindRaw.includes("map") || kindRaw.includes("地图") ? "map" : "mod";

  const urls = collectUrls(row);
  const size = number(row, ["size", "fileSize", "bytes", "packageSize"]);

  return {
    id: text(row, ["id", "slug", "packageId", "key"]) ?? slug,
    slug,
    kind,
    title,
    summary: text(row, ["summary", "description", "desc", "intro"]) ?? "",
    author: text(row, ["author", "uploader", "owner", "publisher", "username"]) ?? "未知作者",
    cover: text(row, ["cover", "icon", "image", "thumbnail"]),
    version: text(row, ["version", "latestVersion", "ver"]) ?? "—",
    size: size ?? 0,
    contentHash: text(row, ["contentHash", "sha256", "hash"]),
    urls,
  };
}

function text(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function number(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  return null;
}

function collectUrls(row: Record<string, unknown>): string[] {
  const candidate = row.urls ?? row.urls_ ?? row.downloadUrl ?? row.download ?? row.file;
  if (typeof candidate === "string" && candidate.startsWith("http")) return [candidate];
  if (Array.isArray(candidate)) {
    return candidate.filter((item): item is string => typeof item === "string");
  }
  return [];
}

/** 设置页用：拉一次看看这个源通不通、能不能解析出条目。 */
export async function testSource(
  base: string,
  format: MarketFormat,
): Promise<{ ok: boolean; count: number; message: string }> {
  const source: MarketSource = {
    id: "probe",
    name: "probe",
    base: normalizeBase(base),
    format,
    builtin: false,
  };
  try {
    const result = await listPackages({ source, size: 20 });
    return {
      ok: true,
      count: result.items.length,
      message:
        result.items.length > 0
          ? `连接正常，读到 ${result.items.length} 个资源`
          : "连接正常，但没读到资源（可能是空市场，或字段名不认识）",
    };
  } catch (error) {
    return {
      ok: false,
      count: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
