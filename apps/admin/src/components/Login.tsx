import { useEffect, useRef, useState } from "react";

import * as api from "../lib/api";
import type { AdminUser } from "../lib/api";

interface LoginProps {
  onDone: (user: AdminUser) => void;
}

/** 上次登录用的邮箱。只是省一次输入，不存密码。 */
const EMAIL_KEY = "ppl.admin.email";

export function Login({ onDone }: LoginProps) {
  const [email, setEmail] = useState(() => readEmail());
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 邮箱有值就直接把焦点落在密码上：这个页面只有一个真正的输入动作
    if (readEmail()) passwordRef.current?.focus();
  }, []);

  async function submit() {
    if (!email.trim()) {
      setError("先填管理员邮箱");
      return;
    }
    if (!password) {
      setError("先填密码");
      passwordRef.current?.focus();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await api.login(email.trim(), password);
      api.setToken(result.token);
      rememberEmail(email.trim());
      setPassword("");
      onDone(result.user);
    } catch (cause) {
      // 失败也清空密码框：留在页面上只会被下一次误提交
      setPassword("");
      setError(cause instanceof Error ? cause.message : String(cause));
      passwordRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form
        className="login-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h1 className="login-title">PPL 审核后台</h1>
        <p className="login-desc">用管理员账号登录。密码由服务端的 PPL_ADMIN_PASSWORD 决定。</p>

        <input
          className="field"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="username"
          aria-label="管理员邮箱"
        />

        <div style={{ position: "relative", marginTop: 10 }}>
          <input
            className="field"
            ref={passwordRef}
            type={reveal ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="密码"
            autoComplete="current-password"
            aria-label="密码"
            style={{ paddingRight: 56 }}
          />
          <button
            type="button"
            onClick={() => setReveal((value) => !value)}
            style={{
              position: "absolute",
              top: 0,
              right: 6,
              height: "100%",
              padding: "0 8px",
              color: "var(--muted)",
              fontSize: 12,
            }}
            tabIndex={-1}
          >
            {reveal ? "隐藏" : "显示"}
          </button>
        </div>

        {error && (
          <div className="notice notice-error" style={{ marginTop: 12 }} role="alert">
            {error}
          </div>
        )}

        <div className="login-actions">
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} type="submit">
            {busy ? "登录中…" : "登录"}
          </button>
        </div>

        <div className="login-hint">
          服务地址：{api.apiBase() || "同源（当前站点）"}
          <br />
          <button
            type="button"
            style={{ color: "var(--accent)", fontSize: 12, padding: 0 }}
            onClick={() => {
              const next = window.prompt(
                "服务地址（留空表示同源；也可填 https://ziyuan.pixelpine.org）",
                api.apiBase(),
              );
              // prompt 取消时返回 null，别把它当成「清空」
              if (next !== null) {
                api.setApiBase(next);
                window.location.reload();
              }
            }}
          >
            修改
          </button>
        </div>
      </form>
    </div>
  );
}

function readEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberEmail(value: string): void {
  try {
    localStorage.setItem(EMAIL_KEY, value);
  } catch {
    // 隐私模式下写不进去，不影响登录
  }
}
