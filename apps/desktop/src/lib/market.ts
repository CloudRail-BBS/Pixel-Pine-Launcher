/** 资源市场的取数层。
 *
 * 服务地址可改（自建服务端），配置存 localStorage，默认指向官方实例。
 * 这里只负责「拿数据」和「把错误翻译成人话」，
 * 安装状态、筛选、排序都交给调用方，避免两处各算一遍。 */

import type { MarketPageResult } from "./types";

const DEFAULT_BASE = "https://ziyuan.pixelpine.org";
const BASE_KEY = "ppl.market.base";

/** 一次取多少条。数量小，前端过滤比来回请求更顺滑。 */
export const PAGE_SIZE = 100;

export function marketBase(): string {
  if (typeof localStorage === "undefined") return DEFAULT_BASE;
  const saved = localStorage.getItem(BASE_KEY)?.trim();
  return saved ? normalizeBase(saved) : DEFAULT_BASE;
}

export function setMarketBase(value: string): string {
  const next = normalizeBase(value);
  if (typeof localStorage !== "undefined") {
    if (next && next !== DEFAULT_BASE) localStorage.setItem(BASE_KEY, next);
    else localStorage.removeItem(BASE_KEY);
  }
  return next || DEFAULT_BASE;
}

/** 线上服务强制 HTTPS，所以公网地址填了 http 就直接升级；
 * 本地和内网保留 http，否则自建实例调试不了。 */
function normalizeBase(input: string): string {
  let value = input.trim().replace(/\/+$/, "");
  if (!value) return DEFAULT_BASE;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  const isLocal =
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
      value,
    );
  if (!isLocal && /^http:\/\//i.test(value)) {
    value = value.replace(/^http:/i, "https:");
  }
  return value;
}

export function isDefaultBase(): boolean {
  return marketBase() === DEFAULT_BASE;
}

export const OFFICIAL_BASE = DEFAULT_BASE;

/** 拉取资源列表。失败时抛出的 Error.message 已经是中文短句，可直接展示。 */
export async function listPackages(options: {
  q?: string;
  page?: number;
  size?: number;
} = {}): Promise<MarketPageResult> {
  const params = new URLSearchParams();
  const query = options.q?.trim();
  if (query) params.set("q", query);
  params.set("page", String(options.page ?? 1));
  params.set("size", String(options.size ?? PAGE_SIZE));

  const url = `${marketBase()}/v1/packages?${params.toString()}`;

  // 用 AbortController 而不是依赖浏览器默认超时：连不上时默认要等很久，
  // 界面上就是一个转不完的圈。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      if (response.status === 503) {
        throw new Error("市场服务暂时不可用（数据库未就绪）");
      }
      throw new Error(`市场返回 ${response.status}`);
    }
    return (await response.json()) as MarketPageResult;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("连接市场超时，检查网络或在设置里换服务地址");
    }
    if (error instanceof TypeError) {
      throw new Error("连不上市场服务，检查网络或在设置里换服务地址");
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}
