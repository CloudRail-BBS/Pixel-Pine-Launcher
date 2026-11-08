import { useCallback, useEffect, useRef, useState } from "react";

import { Modal } from "../components/Modal";
import { UploadIcon } from "../components/Icons";
import { mountGeetest, type GeetestResult } from "../lib/geetest";
import * as publish from "../lib/publish";
import type { AuthConfig, MyPackage, PublishUser } from "../lib/publish";

/** 发布页：登录 → 填表上传 → 提交审核 → 看状态。 */
export function PublishPage() {
  const [user, setUser] = useState<PublishUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    if (!publish.getToken()) {
      setBooting(false);
      return;
    }
    publish
      .me()
      .then(setUser)
      .catch(() => publish.setToken(null))
      .finally(() => setBooting(false));
  }, []);

  if (booting) {
    return (
      <div className="empty">
        <div>正在确认登录状态…</div>
      </div>
    );
  }

  if (user) {
    return (
      <Workspace
        user={user}
        onLogout={() => {
          publish.setToken(null);
          setUser(null);
        }}
      />
    );
  }

  // 没登录时不把整页做成一张表单：先给一个明确的入口，
  // 点开才出弹层。页面上其余信息（能发什么、审核怎么走）保持可读。
  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">发布</h1>
          <p className="page-desc">上传 .rwmod 或地图包，通过审核后会出现在市场里</p>
        </div>
      </header>

      <div className="gate">
        <div className="gate-icon" aria-hidden="true">
          <UploadIcon />
        </div>
        <h2 className="gate-title">登录后发布资源</h2>
        <p className="gate-desc">
          用邮箱验证码登录，不需要密码，也不用注册。
          登录后可以上传 Mod 或地图，提交后由人工审核。
        </p>
        <button className="btn btn-primary" onClick={() => setLoginOpen(true)}>
          邮箱登录
        </button>
        <p className="gate-hint">账号与审核后台通用，没有密码可以丢失。</p>
      </div>

      <LoginDialog
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onDone={(next) => {
          setUser(next);
          setLoginOpen(false);
        }}
      />
    </>
  );
}

/** 登录弹层：邮箱 → 人机验证 → 6 位验证码。 */
function LoginDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (user: PublishUser) => void;
}) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [captcha, setCaptcha] = useState<GeetestResult | null>(null);
  const slot = useRef<HTMLDivElement>(null);

  // 关上就把状态清回初始：下次打开不该还停在输验证码那一步
  useEffect(() => {
    if (open) return;
    setStep("email");
    setCode("");
    setError(null);
    setHint(null);
    setCaptcha(null);
    setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    publish
      .authConfig()
      .then((value) => {
        if (alive) setConfig(value);
      })
      .catch(() => {
        if (alive) setConfig({ geetestId: null, devMode: false });
      });
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    const id = config?.geetestId;
    const node = slot.current;
    if (!open || !id || !node || captcha) return;

    node.innerHTML = "";
    let alive = true;
    void mountGeetest(id, node, (result) => {
      if (alive) setCaptcha(result);
    }).catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      alive = false;
    };
  }, [open, config, captcha]);

  async function send() {
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
      const result = await publish.requestCode(email.trim(), captcha);
      setCaptcha(null);
      setStep("code");
      setHint(
        result.devCode
          ? `开发模式验证码：${result.devCode}`
          : `验证码已发到 ${email.trim()}`,
      );
      if (result.devCode) setCode(result.devCode);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCaptcha(null);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (code.trim().length !== 6) {
      setError("验证码是 6 位数字");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await publish.verifyCode(email.trim(), code.trim());
      publish.setToken(result.token);
      onDone(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="登录"
      description={
        step === "email"
          ? "用邮箱接收一次性验证码，不设密码。"
          : "输入邮件里的 6 位验证码。"
      }
      onClose={onClose}
      dismissable={!busy}
      footer={
        <>
          {step === "code" && (
            <button
              className="btn"
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
          )}
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void (step === "email" ? send() : verify())}
          >
            {busy ? "处理中…" : step === "email" ? "发送验证码" : "登录"}
          </button>
        </>
      }
    >
      <label className="publish-field">
        <span className="meta-label">邮箱</span>
        <input
          className="field"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          disabled={step === "code" || busy}
          autoComplete="email"
        />
      </label>

      {step === "email" && config?.geetestId && <div className="captcha-slot" ref={slot} />}

      {step === "code" && (
        <label className="publish-field" style={{ marginTop: 12 }}>
          <span className="meta-label">验证码</span>
          <input
            className="field code-input"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
          />
        </label>
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
    </Modal>
  );
}

const KIND_LABEL: Record<string, string> = { mod: "Mod", map: "地图" };

/** 状态表按索引取值可能是 undefined，给一个固定的兜底对象 */
const FALLBACK_STATUS = { label: "草稿", tone: "muted" };

function Workspace({ user, onLogout }: { user: PublishUser; onLogout: () => void }) {
  const [items, setItems] = useState<MyPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await publish.myPackages();
      setItems(result.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">发布</h1>
          <p className="page-desc">
            上传 .rwmod 或地图包，通过审核后会出现在市场里
          </p>
        </div>
        <div className="head-actions">
          <button className="btn btn-sm" onClick={() => void reload()} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={onLogout}>
            退出
          </button>
        </div>
      </header>

      {error && (
        <div className="notice notice-error" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="notice notice-ok" style={{ marginBottom: 14 }}>
          {notice}
        </div>
      )}

      <div className="kv" style={{ marginBottom: 14 }}>
        <span>当前账号</span>
        <span>{user.email}</span>
      </div>

      {formOpen ? (
        <UploadForm
          onCancel={() => setFormOpen(false)}
          onDone={(message) => {
            setFormOpen(false);
            setNotice(message);
            void reload();
            window.setTimeout(() => setNotice(null), 6000);
          }}
        />
      ) : (
        <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
          发布新资源
        </button>
      )}

      <section className="section" style={{ marginTop: 24 }}>
        <div className="section-title">我的资源</div>

        {items.length === 0 && !loading ? (
          <div className="empty">
            <div>还没有发布过资源</div>
            <div style={{ fontSize: 12 }}>点上面的「发布新资源」上传第一个</div>
          </div>
        ) : (
          <div className="publish-list">
            {items.map((item) => {
              const status = publish.STATUS_TEXT[item.status] ?? FALLBACK_STATUS;
              return (
                <div key={item.id} className="publish-row">
                  <div className="publish-row-main">
                    <div className="publish-row-title">
                      {item.title}
                      <span className={`badge badge-${status.tone}`}>{status.label}</span>
                    </div>
                    <div className="publish-row-meta">
                      {KIND_LABEL[item.kind] ?? item.kind}
                      {item.version ? ` · v${item.version}` : ""} · 更新于 {item.updated}
                    </div>
                    {item.reviewNote && (
                      <div className="publish-row-note">审核意见：{item.reviewNote}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function UploadForm({
  onCancel,
  onDone,
}: {
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const [kind, setKind] = useState<"mod" | "map">("mod");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [version, setVersion] = useState("");
  const [changelog, setChangelog] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooBig = file ? file.size > 200 * 1024 * 1024 : false;
  const ready = title.trim() && version.trim() && file && !tooBig;

  async function submit() {
    if (!ready || !file) return;
    setBusy(true);
    setError(null);
    try {
      setStep("创建草稿…");
      const draft = await publish.createDraft({
        kind,
        title: title.trim(),
        summary: summary.trim(),
      });

      setStep("上传文件…");
      await publish.uploadVersion(draft.id, file, version.trim(), changelog.trim());

      setStep("提交审核…");
      await publish.submit(draft.id);

      onDone(`《${title.trim()}》已提交审核，通过后会出现在市场里`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStep(null);
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 4 }}>
      <div style={{ fontSize: 14, marginBottom: 12 }}>发布新资源</div>

      <div className="publish-form-row">
        <label className="publish-field">
          <span className="meta-label">类型</span>
          <div className="loadout-bar" role="radiogroup" aria-label="资源类型">
            {(["mod", "map"] as const).map((value) => (
              <button
                key={value}
                role="radio"
                aria-checked={kind === value}
                className={`chip${kind === value ? " active" : ""}`}
                onClick={() => setKind(value)}
                disabled={busy}
              >
                {KIND_LABEL[value]}
              </button>
            ))}
          </div>
        </label>

        <label className="publish-field">
          <span className="meta-label">版本号</span>
          <input
            className="field"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            placeholder="2.3.1"
            disabled={busy}
          />
        </label>
      </div>

      <label className="publish-field" style={{ marginTop: 12 }}>
        <span className="meta-label">标题</span>
        <input
          className="field"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="现代战争"
          maxLength={60}
          disabled={busy}
        />
      </label>

      <label className="publish-field" style={{ marginTop: 12 }}>
        <span className="meta-label">简介</span>
        <textarea
          className="field publish-textarea"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="一句话说清这个资源是什么、有什么特色"
          maxLength={200}
          disabled={busy}
        />
      </label>

      <label className="publish-field" style={{ marginTop: 12 }}>
        <span className="meta-label">资源包（.rwmod / .zip，≤ 200MB）</span>
        <input
          type="file"
          accept=".rwmod,.zip"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          disabled={busy}
          className="publish-file"
        />
        {file && (
          <span className="field-hint">
            {file.name} · {(file.size / 1_048_576).toFixed(1)} MB
            {tooBig && " · 超过 200MB 上限"}
          </span>
        )}
      </label>

      <label className="publish-field" style={{ marginTop: 12 }}>
        <span className="meta-label">更新说明（可选）</span>
        <input
          className="field"
          value={changelog}
          onChange={(event) => setChangelog(event.target.value)}
          placeholder="这次改了什么"
          disabled={busy}
        />
      </label>

      {error && (
        <div className="notice notice-error" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button
          className="btn btn-primary"
          disabled={!ready || busy}
          onClick={() => void submit()}
        >
          {busy ? (step ?? "上传中…") : "上传并提交审核"}
        </button>
        <button className="btn" onClick={onCancel} disabled={busy}>
          取消
        </button>
      </div>

      <div className="field-hint">
        上传后会立即按客户端同一套规则校验：路径穿越、可执行文件、压缩炸弹、体积上限。
        不通过不会落盘，也不会进入审核队列。
      </div>
    </div>
  );
}
