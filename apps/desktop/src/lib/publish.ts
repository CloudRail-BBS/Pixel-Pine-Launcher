/** 发布相关接口：登录、我的资源、上传版本、提交审核。
 *
 * 走的是市场服务端，接口契约见 docs/API.md。
 * 只有 PPL 协议的市场源才支持发布，第三方源只能读。 */

import type { GeetestResult } from "./geetest";
import { activeSource } from "./market";

const TOKEN_KEY = "ppl.publish.token";

export interface PublishUser {
  id: string;
  email: string;
  role: string;
}

export interface MyPackage {
  id: string;
  slug: string;
  kind: string;
  title: string;
  summary: string;
  status: string;
  reviewNote: string;
  version: string | null;
  versionStatus: string | null;
  updated: string;
}

export interface AuthConfig {
  geetestId: string | null;
  devMode: boolean;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** 发布只走 PPL 协议的服务端；当前源是通用格式时退回官方地址。 */
function base(): string {
  const source = activeSource();
  return source.format === "ppl" ? source.base : "https://ziyuan.pixelpine.org";
}

export class PublishError extends Error {
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
    response = await fetch(`${base()}${path}`, { ...init, headers });
  } catch {
    throw new PublishError(0, "连不上市场服务，检查网络或服务地址");
  }

  if (response.status === 401) {
    setToken(null);
    throw new PublishError(401, "登录已过期，请重新验证邮箱");
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
    throw new PublishError(response.status, message);
  }
  return body as T;
}

export function authConfig(): Promise<AuthConfig> {
  return request<AuthConfig>("/v1/auth/config");
}

export function requestCode(
  email: string,
  geetest?: GeetestResult | null,
): Promise<{ ok: boolean; delivery: string; devCode?: string }> {
  return request("/v1/auth/email/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, geetest: geetest ?? undefined }),
  });
}

export function verifyCode(
  email: string,
  code: string,
): Promise<{ token: string; user: PublishUser }> {
  return request("/v1/auth/email/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
}

export function me(): Promise<PublishUser> {
  return request("/v1/me");
}

export function myPackages(): Promise<{ items: MyPackage[] }> {
  return request("/v1/me/packages");
}

export function createDraft(input: {
  kind: string;
  title: string;
  summary: string;
  slug?: string;
}): Promise<{ id: string; slug: string; status: string }> {
  return request("/v1/me/packages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** 上传版本。FormData 让浏览器自己算 boundary，不要手写 content-type。 */
export function uploadVersion(
  packageId: string,
  file: File,
  version: string,
  changelog: string,
): Promise<{ ok: boolean; version: string; url: string; unitCount: number }> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("version", version);
  form.append("changelog", changelog);

  return request(`/v1/packages/${packageId}/versions`, {
    method: "POST",
    body: form,
  });
}

export function submit(packageId: string): Promise<{ ok: boolean; status: string }> {
  return request(`/v1/packages/${packageId}/submit`, { method: "POST" });
}

export const STATUS_TEXT: Record<string, { label: string; tone: string }> = {
  draft: { label: "草稿", tone: "muted" },
  pending: { label: "待审核", tone: "warn" },
  published: { label: "已上架", tone: "ok" },
  rejected: { label: "已驳回", tone: "danger" },
  takendown: { label: "已下架", tone: "danger" },
};
