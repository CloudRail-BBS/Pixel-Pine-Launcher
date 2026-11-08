/** 公告。
 *
 * 公告跟着市场源走：用户连哪个市场，就看哪个市场发的公告。
 * 只在启动时拉一次——公告不是实时数据，为它保持轮询不值得。
 */

import { OFFICIAL_BASE, activeSource } from "./market";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  /** `info` 普通提示，`important` 需要用户主动关掉 */
  level: string;
  pinned: boolean;
  published: string;
}

const DISMISS_KEY = "ppl.announce.dismissed";

/** 读到过哪些公告 id。存本地，不上报。 */
function dismissed(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function isDismissed(id: string): boolean {
  return dismissed().includes(id);
}

/** 关掉一条。只记 id，不记内容。 */
export function dismiss(id: string): void {
  if (typeof localStorage === "undefined") return;
  const list = dismissed();
  if (list.includes(id)) return;
  // 只保留最近 200 条，避免这个 key 无限增长
  const next = [...list, id].slice(-200);
  localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
}

/** 拉公告。失败静默返回空数组——公告拉不到不该打断用户。 */
export async function fetchAnnouncements(): Promise<Announcement[]> {
  const source = activeSource();
  const base = source.format === "ppl" ? source.base : OFFICIAL_BASE;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${base}/v1/announcements`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return [];

    const body = (await response.json()) as { items?: unknown };
    const items = Array.isArray(body.items) ? body.items : [];

    return items
      .map((raw): Announcement | null => {
        if (!raw || typeof raw !== "object") return null;
        const row = raw as Record<string, unknown>;
        if (typeof row.id !== "string" || typeof row.title !== "string") return null;
        return {
          id: row.id,
          title: row.title,
          body: typeof row.body === "string" ? row.body : "",
          level: typeof row.level === "string" ? row.level : "info",
          pinned: row.pinned === true,
          published: typeof row.published === "string" ? row.published : "",
        };
      })
      .filter((item): item is Announcement => item !== null);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
