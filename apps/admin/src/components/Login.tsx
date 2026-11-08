import { useEffect, useRef, useState } from "react";

import * as api from "../lib/api";
import type { AdminUser, AuthConfig, GeetestResult } from "../lib/api";

interface LoginProps {
  onDone: (user: AdminUser) => void;
}

type Step = "email" | "code";

export function Login({ onDone }: LoginProps) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [captcha, setCaptcha] = useState<GeetestResult | null>(null);
  const captchaSlot = useRef<HTMLDivElement>(null);

  // 先问服务端要不要人机验证，没启用的实例不该多拉 SDK
  useEffect(() => {
    let cancelled = false;
    api
      .authConfig()
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch(() => {
        if (!cancelled) setConfig({ geetestId: null, devMode: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 每次需要重新验证时都重建实例：极验的成功回调只触发一次
  useEffect(() => {
    const captchaId = config?.geetestId;
    const slot = captchaSlot.current;
    if (!captchaId || !slot || captcha) return;

    slot.innerHTML = "";
    let cancelled = false;
    api
      .mountGeetest(captchaId, slot, (result) => {
        if (!cancelled) setCaptcha(result);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [config, captcha]);

  async function sendCode() {
    if (!email.trim()) {
      setError("先填邮箱");
      return;
    }
    if (config?.geetestId && !captcha) {
      setError("请先完成人机验证");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await api.requestCode(email.trim(), captcha);
      setCaptcha(null);
      setStep("code");
      if (result.devCode) {
        setCode(result.devCode);
        setHint(`开发模式：验证码已直接填入（${result.devCode}）`);
      } else {
        setHint(`验证码已发到 ${email.trim()}，10 分钟内有效`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCaptcha(null);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (code.trim().length !== 6) {
      setError("验证码是 6 位数字");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.verifyCode(email.trim(), code.trim());
      api.setToken(result.token);
      onDone(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
          if (step === "email") void sendCode();
          else void submitCode();
        }}
      >
        <h1 className="login-title">PPL 审核后台</h1>
        <p className="login-desc">
          {step === "email"
            ? "用管理员邮箱登录。没有密码，验证码即登录凭证。"
            : "输入邮件里的 6 位验证码。"}
        </p>

        <input
          className="field"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          disabled={step === "code"}
          aria-label="邮箱"
        />

        {step === "email" && (
          <>
            {config?.geetestId && <div className="captcha-slot" ref={captchaSlot} />}
            {config?.geetestId && captcha && (
              <div className="login-hint">人机验证已完成，可以发送验证码</div>
            )}
          </>
        )}

        {step === "code" && (
          <input
            className="field"
            style={{ marginTop: 10, letterSpacing: "0.4em", textAlign: "center" }}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoFocus
            aria-label="验证码"
          />
        )}

        {error && (
          <div className="notice notice-error" style={{ marginTop: 12 }} role="alert">
            {error}
          </div>
        )}
        {!error && hint && (
          <div className="notice notice-ok" style={{ marginTop: 12 }}>
            {hint}
          </div>
        )}

        <div className="login-actions">
          {step === "email" ? (
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} type="submit">
              {busy ? "发送中…" : "发送验证码"}
            </button>
          ) : (
            <>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setHint(null);
                  setError(null);
                }}
                disabled={busy}
              >
                改邮箱
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={busy}
                type="submit"
              >
                {busy ? "验证中…" : "登录"}
              </button>
            </>
          )}
        </div>

        <div className="login-hint">
          服务地址：{api.apiBase()}
          <br />
          <button
            type="button"
            style={{ color: "var(--accent)", fontSize: 12, padding: 0 }}
            onClick={() => {
              const next = window.prompt("服务地址（例如 https://ziyuan.pixelpine.org）", api.apiBase());
              if (next) {
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
