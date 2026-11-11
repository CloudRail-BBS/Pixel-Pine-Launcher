/** 审核后台的接口层。
 *
 * 与服务端唯一契约见 docs/API.md。错误消息已经是中文短句，直接展示即可。 */

import { demoResponse } from "./demo";

const BASE_KEY = "ppl.admin.base";

/** `?demo=1` 时走演示数据：不用部署服务端也能看界面，写操作一律失败。 */
export const DEMO_MODE =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");
const TOKEN_KEY = "ppl.admin.token";

export const OFFICIAL_BASE = "https://ziyuan.pixelpine.org";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

/** 概览读数。 */
export interface AdminStats {
  packages: Record<string, number>;
  pendingVersions: number;
  openReports: number;
  announcements: number;
  downloads: number;
  users: number;
  recent: AuditEntry[];
}

export interface AuditEntry {
  action: string;
  target: string;
  payload: unknown;
  created: string;
  actor: string | null;
}

/** 资源管理列表里的一行。 */
export interface AdminPackage {
  id: string;
  slug: string;
  kind: string;
  title: string;
  summary: string;
  author: string;
  status: string;
  reviewNote: string;
  updated: string;
  version: string | null;
  size: number | null;
  downloads: number;
  versionCount: number;
}

export interface AdminVersion {
  version: string;
  status: string;
  size: number;
  downloads: number;
  sha256: string;
  fileName: string;
  urls: string[];
  changelog: string;
  created: string;
}

export interface AdminPackageDetail extends AdminPackage {
  cover: string | null;
  owner: string | null;
  created: string;
  versions: AdminVersion[];
}

/** 游戏本体清单里的一个版本，字段名与客户端 `gamedl::GameVersion` 一致。 */
export interface GameEntry {
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

export interface GameManifest {
  schema: number;
  generated?: string;
  versions: GameEntry[];
}

export interface GameUpload {
  fileName: string;
  url: string;
  size: number;
  sha256: string;
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
  if (!saved) return "";

  const base = normalizeBase(saved);
  try {
    const url = new URL(base);
    // 只保留 origin：填成 `https://xxx/admin` 时，拼出来的 `/admin/v1/...`
    // 会被静态站点或网关接走，返回的 404 / HTML 完全不像接口错误，很难查
    if (url.pathname !== "/" && url.pathname !== "") {
      console.warn(`[ppl] 服务地址带了路径 ${url.pathname}，已忽略，只使用 ${url.origin}`);
      return url.origin;
    }
    return url.origin;
  } catch {
    return base;
  }
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
  // 演示模式直接给一个假 token，让启动时的 me() 能走通
  if (DEMO_MODE) return "demo";
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** 把状态码翻成人话。带 5xx/404 的原始状态码，方便直接对上部署问题。 */
function describeStatus(status: number, contentType: string): string {
  if (status === 404) return "接口不存在（404）：服务端可能还是旧版本，重新部署后再试";
  if (status === 405) return "请求方法不被接受（405）：前后端版本对不上";
  if (status === 502 || status === 503 || status === 504) {
    return `网关连不上服务端（${status}）：反向代理或容器可能没起来（具体地址见控制台）`;
  }
  if (contentType.includes("html")) {
    return `请求被静态页面接走了（${status}）：路径或服务地址不对`;
  }
  return `请求失败（${status}）`;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (DEMO_MODE) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    try {
      const data = demoResponse(path, (init.method ?? "GET").toUpperCase());
      if (data === undefined) throw new Error(`演示模式没有准备 ${path} 的数据`);
      return data as T;
    } catch (cause) {
      throw new ApiError(0, cause instanceof Error ? cause.message : String(cause));
    }
  }

  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);

  // 同源时用 origin 拼绝对地址：相对路径在 `/admin/` 这类子路径页面下会解析错位
  const endpoint = apiBase() ? `${apiBase()}${path}` : new URL(path, window.location.origin).toString();

  let response: Response;
  try {
    response = await fetch(endpoint, { ...init, headers });
  } catch {
    console.warn(`[ppl] 请求发不出去：${init.method ?? "GET"} ${endpoint}`);
    throw new ApiError(0, `连不上服务端（${new URL(endpoint).origin}），检查网络或服务地址`);
  }

  if (!response.ok) {
    // 报错时把真实地址和状态打出来：界面上的文案只说「网关 502」，
    // 看不出来打的是哪台机器——地址被 localStorage 改过时尤其难查
    console.warn(`[ppl] ${init.method ?? "GET"} ${endpoint} → ${response.status}`);
  }

  if (response.status === 401) {
    setToken(null);
    throw new ApiError(401, "登录已过期，请重新登录");
  }

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  let body: unknown = null;
  if (text && contentType.includes("json")) {
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
        : describeStatus(response.status, contentType);
    throw new ApiError(response.status, message);
  }

  // 2xx 却不是 JSON：几乎都是路径被静态站点接管了（返回了 index.html）
  if (text && !contentType.includes("json")) {
    throw new ApiError(
      response.status,
      `服务端返回的是 ${contentType || "非 JSON"}，不是接口数据——检查服务地址是否指到了后台页面本身`,
    );
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

/* ---------- 管理控制台 ---------- */

export function stats(): Promise<AdminStats> {
  return request("/v1/admin/stats");
}

export function auditLog(limit = 60): Promise<{ items: AuditEntry[] }> {
  return request(`/v1/admin/audit?limit=${limit}`);
}

export function adminPackages(params: {
  status?: string;
  kind?: string;
  q?: string;
  page?: number;
  size?: number;
}): Promise<{ items: AdminPackage[]; page: number; pageSize: number; total: number }> {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.kind) search.set("kind", params.kind);
  if (params.q) search.set("q", params.q);
  if (params.page) search.set("page", String(params.page));
  if (params.size) search.set("size", String(params.size));
  const query = search.toString();
  return request(`/v1/admin/packages${query ? `?${query}` : ""}`);
}

export function adminPackageDetail(id: string): Promise<AdminPackageDetail> {
  return request(`/v1/admin/packages/${id}`);
}

export function restorePackage(id: string): Promise<{ ok: boolean }> {
  return request(`/v1/admin/packages/${id}/restore`, { method: "POST" });
}

export function deletePackage(id: string): Promise<{ ok: boolean }> {
  return request(`/v1/admin/packages/${id}`, { method: "DELETE" });
}

/** 游戏本体清单（后台视角：文件不存在时返回空骨架，不是 204）。 */
export function gameManifest(): Promise<GameManifest> {
  return request("/v1/admin/game");
}

export function saveGameManifest(
  manifest: GameManifest,
): Promise<{ ok: boolean; versions: number }> {
  return request("/v1/admin/game", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(manifest),
  });
}

/**
 * 上传游戏本体压缩包。
 *
 * 用 XHR 而不是 fetch：150MB 的包没有进度条，等于让用户盯一个不动的按钮。
 * 返回的 sha256 / size 直接填进清单条目，省掉手工算哈希——那是最容易抄错的字段。
 */
export function uploadGameArchive(
  file: File,
  version: string,
  onProgress?: (percent: number) => void,
): Promise<GameUpload> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    if (version.trim()) form.append("version", version.trim());

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBase()}/v1/admin/game/upload`);
    const token = getToken();
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.setRequestHeader("accept", "application/json");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };

    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) {
        onProgress?.(100);
        resolve(body as GameUpload);
        return;
      }
      const message =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `上传失败（${xhr.status}）`;
      reject(new ApiError(xhr.status, message));
    };

    xhr.onerror = () => reject(new ApiError(0, "上传中断，检查网络后重试"));
    xhr.send(form);
  });
}

/** 客户端更新清单（公开接口，读的就是客户端拿到的同一份文件）。 */
export function launcherManifest(): Promise<unknown> {
  return request("/v1/launcher/latest.json");
}

/** 推送更新清单；服务端校验 version / platforms 后原子写入。 */
export function pushLauncherManifest(
  manifest: unknown,
): Promise<{ ok: boolean; version: string }> {
  return request("/v1/admin/launcher", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(manifest),
  });
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
