import { useCallback, useEffect, useMemo, useState } from "react";

import { Login } from "./components/Login";
import * as api from "./lib/api";
import type { AdminUser, QueueItem } from "./lib/api";
import { applyTheme, readThemeMode } from "./lib/theme";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: "待审核", cls: "badge badge-warn" },
  draft: { text: "草稿", cls: "badge" },
  published: { text: "已上架", cls: "badge badge-ok" },
  rejected: { text: "已驳回", cls: "badge badge-danger" },
};

export default function App() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<QueueItem | null>(null);

  useEffect(() => {
    applyTheme(readThemeMode());
  }, []);

  // 有 token 就先确认身份：过期或不是管理员都直接退回登录页
  useEffect(() => {
    if (!api.getToken()) {
      setBooting(false);
      return;
    }
    api
      .me()
      .then((me) => {
        if (me.role !== "admin") {
          api.setToken(null);
          setError("这个账号没有审核权限，用管理员邮箱登录");
          return;
        }
        setUser({
          id: me.id,
          email: me.email,
          name: me.email.split("@")[0],
          role: me.role,
        });
      })
      .catch(() => api.setToken(null))
      .finally(() => setBooting(false));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.queue();
      setItems(result.items);
      setSelectedId((current) => current ?? result.items[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  async function act(kind: "approve" | "reject", item: QueueItem, note = "") {
    setBusy(true);
    setError(null);
    try {
      if (kind === "approve") await api.approve(item.id);
      else await api.reject(item.id, note);

      setNotice(
        kind === "approve" ? `已通过《${item.title}》` : `已驳回《${item.title}》`,
      );
      setItems((current) => current.filter((row) => row.id !== item.id));
      setSelectedId((current) => (current === item.id ? null : current));
      setRejectTarget(null);
      window.setTimeout(() => setNotice(null), 4000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (booting) {
    return (
      <div className="login-wrap">
        <div className="login-hint">正在确认登录状态…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        {error && (
          <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 50 }}>
            <div className="notice notice-error">{error}</div>
          </div>
        )}
        <Login onDone={(value) => setUser(value)} />
      </>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img src="/logo.png" alt="" />
          PPL 审核后台
        </div>
        <span className={STATUS_LABEL.pending.cls}>{items.length} 条待处理</span>
        <div className="topbar-spacer" />
        <div className="user-chip">
          <span>{user.email}</span>
        </div>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </button>
        <button
          className="btn"
          onClick={() => {
            api.setToken(null);
            setUser(null);
            setItems([]);
          }}
        >
          退出
        </button>
      </header>

      <div className="body">
        <aside className="queue">
          <div className="queue-head">
            <span className="queue-title">待审队列</span>
          </div>
          <div className="queue-list">
            {loading && items.length === 0 && (
              <>
                <div className="skeleton-row" />
                <div className="skeleton-row" />
                <div className="skeleton-row" />
              </>
            )}

            {!loading && items.length === 0 && (
              <div className="empty">
                队列是空的
                <br />
                有人提交资源后会出现在这里
              </div>
            )}

            {items.map((item) => {
              const status = STATUS_LABEL[item.status] ?? STATUS_LABEL.draft;
              return (
                <button
                  key={item.id}
                  className={`queue-item${item.id === selectedId ? " selected" : ""}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="queue-item-title">{item.title}</div>
                  <div className="queue-item-meta">
                    <span className={status.cls}>{status.text}</span>
                    <span>{item.kind === "mod" ? "Mod" : "地图"}</span>
                    <span>{item.version ? `v${item.version}` : "无版本"}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="detail">
          {error && (
            <div className="notice notice-error" style={{ marginBottom: 16 }} role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice notice-ok" style={{ marginBottom: 16 }}>
              {notice}
            </div>
          )}

          {!selected ? (
            <div className="detail-empty">
              左边选一条资源
              <br />
              这里会显示它的版本、体积和下载地址
            </div>
          ) : (
            <Detail
              item={selected}
              busy={busy}
              onApprove={() => void act("approve", selected)}
              onReject={() => setRejectTarget(selected)}
            />
          )}
        </main>
      </div>

      {rejectTarget && (
        <RejectDialog
          item={rejectTarget}
          busy={busy}
          onCancel={() => setRejectTarget(null)}
          onConfirm={(note) => void act("reject", rejectTarget, note)}
        />
      )}
    </div>
  );
}

function Detail({
  item,
  busy,
  onApprove,
  onReject,
}: {
  item: QueueItem;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const status = STATUS_LABEL[item.status] ?? STATUS_LABEL.draft;
  const download =
    item.version && item.status === "pending"
      ? `${api.apiBase()}/files/${item.slug}/${item.version}.rwmod`
      : null;

  return (
    <>
      <div className="detail-kind">
        <span className={status.cls}>{status.text}</span>
        <span className="badge">{item.kind === "mod" ? "Mod" : "地图"}</span>
      </div>

      <h1 className="detail-title">{item.title}</h1>
      <p className="detail-sub">
        作者 {item.author} · {item.submitted}
      </p>

      <div className="meta-grid">
        <div className="meta-cell">
          <div className="meta-label">版本</div>
          <div className="meta-value">{item.version ?? "—"}</div>
        </div>
        <div className="meta-cell">
          <div className="meta-label">体积</div>
          <div className="meta-value">
            {item.size ? `${(item.size / 1_048_576).toFixed(1)} MB` : "—"}
          </div>
        </div>
        <div className="meta-cell">
          <div className="meta-label">slug</div>
          <div className="meta-value">{item.slug}</div>
        </div>
      </div>

      <p className="detail-summary">{item.summary || "作者没有填写简介"}</p>

      {download && (
        <div style={{ marginBottom: 8 }}>
          <div className="meta-label" style={{ marginBottom: 4 }}>
            下载审阅（先自己装一遍再决定）
          </div>
          <a className="detail-link" href={download} target="_blank" rel="noreferrer">
            {download}
          </a>
        </div>
      )}

      {item.status === "draft" && (
        <div className="notice" style={{ marginTop: 16 }}>
          这条还是草稿，作者没提交审核。草稿不该出现在队列里，若看到请联系作者。
        </div>
      )}

      <div className="action-bar">
        <button className="btn btn-primary" disabled={busy} onClick={onApprove}>
          通过并上架
        </button>
        <button className="btn btn-danger" disabled={busy} onClick={onReject}>
          驳回
        </button>
      </div>
    </>
  );
}

function RejectDialog({
  item,
  busy,
  onCancel,
  onConfirm,
}: {
  item: QueueItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const short = note.trim().length < 4;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2 className="modal-title">驳回《{item.title}》</h2>
        <p className="modal-desc">
          原因会原样展示给作者。写清楚「哪里不合规、怎么改」，
          比一句「不符合要求」有用得多。
        </p>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="例如：包含未经授权的商业素材，请替换后重新提交"
          autoFocus
        />
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            className="btn btn-danger"
            disabled={busy || short}
            onClick={() => onConfirm(note.trim())}
          >
            {busy ? "提交中…" : "确认驳回"}
          </button>
        </div>
      </div>
    </div>
  );
}
