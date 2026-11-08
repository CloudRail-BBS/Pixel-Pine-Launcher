/** 审核后台的接口层。
 *
 * 与服务端唯一契约见 docs/API.md。错误消息已经是中文短句，直接展示即可。 */

const BASE_KEY = "ppl.admin.base";
const TOKEN_KEY = "ppl.admin.token";

export const OFFICIAL_BASE = "https://ziyuan.pixelpine.org";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface QueueItem {
  id: string;
  slug: string;
  kind: string;
  title: string;
  summary: string;
  author: string;
  status: string;
  version: string | null;
  size: number | null;
  submitted: string;
}

export interface ReportItem {
  id: number;
  reason: string;
  contact: string;
  created: string;
  packageId: string;
  slug: string;
  title: string;
  kind: string;
  packageStatus: string;
}

/** 空字符串表示「同源」——后台由服务端自己托管时用它，换域名不用改配置。 */
export function apiBase(): string {
  const saved = localStorage.getItem(BASE_KEY)?.trim();
  return saved ? normalizeBase(saved) : "";
}

export function setApiBase(value: string): string {
  const next = value.trim() ? normalizeBase(value) : "";
  if (!next) localStorage.removeItem(BASE_KEY);
  else localStorage.setItem(BASE_KEY, next);
  return next;
}

/** 线上强制 HTTPS，公网地址填 http 直接升级；本地/内网保留 http。 */
function normalizeBase(input: string): string {
  let value = input.trim().replace(/\/+$/, "");
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  const isLocal =
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
      value,
    );
  if (!isLocal && /^http:\/\//i.test(value)) value = value.replace(/^http:/i, "https:");
  return value;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "连不上服务端，检查网络或服务地址");
  }

  if (response.status === 401) {
    setToken(null);
    throw new ApiError(401, "登录已过期，请重新登录");
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `请求失败（${response.status}）`;
    throw new ApiError(response.status, message);
  }

  return body as T;
}

/** 后台登录：邮箱 + 密码。成功时 token 由调用方写入（见 `setToken`）。 */
export function login(
  email: string,
  password: string,
): Promise<{ token: string; user: AdminUser }> {
  return request("/v1/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export function me(): Promise<{ id: string; email: string; role: string }> {
  return request("/v1/me");
}

export function queue(): Promise<{ items: QueueItem[] }> {
  return request("/v1/admin/queue");
}

export function approve(id: string): Promise<{ ok: boolean }> {
  return request(`/v1/admin/packages/${id}/approve`, { method: "POST" });
}

export function reject(id: string, note: string): Promise<{ ok: boolean }> {
  return request(`/v1/admin/packages/${id}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note }),
  });
}

export function reports(): Promise<{ items: ReportItem[] }> {
  return request("/v1/admin/reports");
}

export function handleReport(
  id: number,
  action: "dismissed" | "handled",
  note = "",
): Promise<{ ok: boolean }> {
  return request(`/v1/admin/reports/${id}/handle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, note }),
  });
}

/** 下架：资源转 takendown，已过审版本一并 rejected，市场里立刻消失。 */
export function takedown(packageId: string, note: string): Promise<{ ok: boolean }> {
  return request(`/v1/admin/packages/${packageId}/takedown`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note }),
  });
}

/* ---------- 公告 ---------- */

export interface Announcement {
  id: string;
  title: string;
  body: string;
  /** info | important */
  level: string;
  pinned: boolean;
  published: string;
}

export function listAnnouncements(): Promise<{ items: Announcement[] }> {
  return request("/v1/admin/announcements");
}

export function createAnnouncement(input: {
  title: string;
  body: string;
  level: string;
  pinned: boolean;
  hours: number;
}): Promise<{ ok: boolean; id: string }> {
  return request("/v1/admin/announcements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deleteAnnouncement(id: string): Promise<{ ok: boolean }> {
  return request(`/v1/admin/announcements/${id}`, { method: "DELETE" });
}
