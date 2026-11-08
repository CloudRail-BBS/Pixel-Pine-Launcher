import { useCallback, useEffect, useMemo, useState } from "react";

import { Login } from "./components/Login";
import * as api from "./lib/api";
import type { AdminUser, Announcement, QueueItem, ReportItem } from "./lib/api";
import { applyTheme, readThemeMode } from "./lib/theme";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: "待审核", cls: "badge badge-warn" },
  draft: { text: "草稿", cls: "badge" },
  published: { text: "已上架", cls: "badge badge-ok" },
  rejected: { text: "已驳回", cls: "badge badge-danger" },
  takendown: { text: "已下架", cls: "badge badge-danger" },
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
  const [tab, setTab] = useState<"queue" | "reports" | "announce">("queue");
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [reportId, setReportId] = useState<number | null>(null);
  const [takedownTarget, setTakedownTarget] = useState<ReportItem | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  // null = 正在写新公告；有值 = 在看某一条
  const [announceId, setAnnounceId] = useState<string | null>(null);

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
          setError("这个账号没有审核权限，请用管理员账号登录");
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
      if (tab === "queue") {
        const result = await api.queue();
        setItems(result.items);
        setSelectedId((current) => current ?? result.items[0]?.id ?? null);
      } else if (tab === "reports") {
        const result = await api.reports();
        setReports(result.items);
        setReportId((current) => current ?? result.items[0]?.id ?? null);
      } else {
        const result = await api.listAnnouncements();
        setAnnouncements(result.items);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const selectedReport = useMemo(
    () => reports.find((item) => item.id === reportId) ?? null,
    [reports, reportId],
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

  /** 举报的两个终态：忽略 / 已处理。下架是单独动作，处理完再点。 */
  async function actReport(item: ReportItem, action: "dismissed" | "handled") {
    setBusy(true);
    setError(null);
    try {
      await api.handleReport(item.id, action);
      setReports((current) => current.filter((row) => row.id !== item.id));
      setReportId((current) => (current === item.id ? null : current));
      setNotice(
        action === "dismissed" ? `已忽略对《${item.title}》的举报` : `已标记《${item.title}》的举报`,
      );
      window.setTimeout(() => setNotice(null), 4000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function doTakedown(item: ReportItem, note: string) {
    setBusy(true);
    setError(null);
    try {
      await api.takedown(item.packageId, note);
      // 同一资源的多条举报一起清掉，避免重复处理
      setReports((current) => current.filter((row) => row.packageId !== item.packageId));
      setTakedownTarget(null);
      setNotice(`已下架《${item.title}》`);
      window.setTimeout(() => setNotice(null), 4000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  /** 发布公告。成功后清空表单并刷新列表。 */
  async function publishAnnouncement(input: {
    title: string;
    body: string;
    level: string;
    pinned: boolean;
    hours: number;
  }) {
    setBusy(true);
    setError(null);
    try {
      await api.createAnnouncement(input);
      setNotice(`已发布《${input.title}》`);
      window.setTimeout(() => setNotice(null), 4000);
      setTab("announce");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function dropAnnouncement(item: Announcement) {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAnnouncement(item.id);
      setAnnouncements((current) => current.filter((row) => row.id !== item.id));
      setAnnounceId(null);
      setNotice(`已删除《${item.title}》`);
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

      {/* 用三张卡代替页签：既是切换入口，也是「现在有多少活」的读数 */}
      <nav className="stat-strip" aria-label="视图">
        <button
          className={`stat${tab === "queue" ? " active" : ""}`}
          aria-current={tab === "queue" ? "page" : undefined}
          onClick={() => setTab("queue")}
        >
          <span className="stat-value">{items.length}</span>
          <span className="stat-label">待审资源</span>
        </button>
        <button
          className={`stat${tab === "reports" ? " active" : ""}`}
          aria-current={tab === "reports" ? "page" : undefined}
          onClick={() => setTab("reports")}
        >
          <span className="stat-value">{reports.length}</span>
          <span className="stat-label">待处理举报</span>
        </button>
        <button
          className={`stat${tab === "announce" ? " active" : ""}`}
          aria-current={tab === "announce" ? "page" : undefined}
          onClick={() => setTab("announce")}
        >
          <span className="stat-value">{announcements.length}</span>
          <span className="stat-label">已发布公告</span>
        </button>
      </nav>

      <div className="body">
        <aside className="queue">
          <div className="queue-head">
            <span className="queue-title">
              {tab === "queue" ? "待审队列" : tab === "reports" ? "待处理举报" : "已发布公告"}
            </span>
            {tab === "announce" && (
              <button
                className="btn btn-sm"
                onClick={() => setAnnounceId(null)}
                aria-label="写新公告"
              >
                写公告
              </button>
            )}
          </div>
          <div className="queue-list">
            {loading && (tab === "queue" ? items.length : reports.length) === 0 && (
              <>
                <div className="skeleton-row" />
                <div className="skeleton-row" />
                <div className="skeleton-row" />
              </>
            )}

            {tab === "announce" && !loading && announcements.length === 0 && (
              <div className="empty">
                还没有发过公告
                <br />
                点右边「写公告」发布第一条
              </div>
            )}

            {tab === "queue" && !loading && items.length === 0 && (
              <div className="empty">
                队列是空的
                <br />
                有人提交资源后会出现在这里
              </div>
            )}

            {tab === "reports" && !loading && reports.length === 0 && (
              <div className="empty">
                没有待处理举报
                <br />
                用户举报后会出现在这里
              </div>
            )}

            {tab === "queue" &&
              items.map((item) => {
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

            {tab === "announce" &&
              announcements.map((item) => (
                <button
                  key={item.id}
                  className={`queue-item${item.id === announceId ? " selected" : ""}`}
                  onClick={() => setAnnounceId(item.id)}
                >
                  <div className="queue-item-title">{item.title}</div>
                  <div className="queue-item-meta">
                    <span className={item.level === "important" ? "badge badge-danger" : "badge"}>
                      {item.pinned ? "置顶" : item.level === "important" ? "重要" : "公告"}
                    </span>
                    <span>{item.published}</span>
                  </div>
                </button>
              ))}

            {tab === "reports" &&
              reports.map((item) => (
                <button
                  key={item.id}
                  className={`queue-item${item.id === reportId ? " selected" : ""}`}
                  onClick={() => setReportId(item.id)}
                >
                  <div className="queue-item-title">{item.title}</div>
                  <div className="queue-item-meta">
                    <span className="badge badge-danger">举报</span>
                    <span>{item.created}</span>
                  </div>
                </button>
              ))}
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

          {tab === "queue" ? (
            !selected ? (
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
            )
          ) : tab === "reports" ? (
            !selectedReport ? (
              <div className="detail-empty">
                左边选一条举报
                <br />
                这里会显示举报理由和对应资源
              </div>
            ) : (
              <ReportDetail
                item={selectedReport}
                busy={busy}
                onDismiss={() => void actReport(selectedReport, "dismissed")}
                onHandle={() => void actReport(selectedReport, "handled")}
                onTakedown={() => setTakedownTarget(selectedReport)}
              />
            )
          ) : announceId ? (
            <AnnounceDetail
              item={announcements.find((row) => row.id === announceId) ?? null}
              busy={busy}
              onDelete={(item) => void dropAnnouncement(item)}
            />
          ) : (
            <AnnounceCompose
              busy={busy}
              onPublish={(input) => void publishAnnouncement(input)}
            />
          )}
        </main>
      </div>

      {takedownTarget && (
        <NoteDialog
          title={`下架《${takedownTarget.title}》`}
          description="资源会立刻从市场消失，已上架的版本转为 rejected。原因会展示给作者。"
          placeholder="例如：举报属实，包内含未授权的商业素材"
          confirmText="确认下架"
          busy={busy}
          onCancel={() => setTakedownTarget(null)}
          onConfirm={(note) => void doTakedown(takedownTarget, note)}
        />
      )}

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

/** 一条举报的详情。左侧是举报内容，右侧动作分三档：忽略 / 已处理 / 下架。 */
function ReportDetail({
  item,
  busy,
  onDismiss,
  onHandle,
  onTakedown,
}: {
  item: ReportItem;
  busy: boolean;
  onDismiss: () => void;
  onHandle: () => void;
  onTakedown: () => void;
}) {
  const status = STATUS_LABEL[item.packageStatus] ?? STATUS_LABEL.draft;

  return (
    <>
      <div className="detail-kind">
        <span className="badge badge-danger">举报</span>
        <span className={status.cls}>{status.text}</span>
        <span className="badge">{item.kind === "mod" ? "Mod" : "地图"}</span>
      </div>

      <h1 className="detail-title">{item.title}</h1>
      <p className="detail-sub">
        {item.slug} · 举报于 {item.created}
      </p>

      <div className="report-reason">
        <div className="report-reason-label">举报理由</div>
        <p className="report-reason-body">{item.reason}</p>
      </div>

      <div className="meta-grid">
        <div className="meta-cell">
          <div className="meta-label">联系方式</div>
          <div className="meta-value">{item.contact || "未留"}</div>
        </div>
        <div className="meta-cell">
          <div className="meta-label">资源状态</div>
          <div className="meta-value">{status.text}</div>
        </div>
      </div>

      <div className="action-bar">
        <button className="btn btn-danger" disabled={busy} onClick={onTakedown}>
          下架资源
        </button>
        <button className="btn" disabled={busy} onClick={onHandle}>
          标记已处理
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={onDismiss}>
          忽略这条举报
        </button>
      </div>

      <p className="detail-hint">
        「标记已处理」只关掉举报，资源仍在架上；确认内容有问题请用「下架资源」。
      </p>
    </>
  );
}

/** 通用原因弹窗：下架这类动作必须留下理由，否则作者申诉时无据可依。 */
function NoteDialog({
  title,
  description,
  placeholder,
  confirmText,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  placeholder: string;
  confirmText: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const short = note.trim().length < 4;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2 className="modal-title">{title}</h2>
        <p className="modal-desc">{description}</p>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={placeholder}
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
            {busy ? "处理中…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 写公告。 */
function AnnounceCompose({
  busy,
  onPublish,
}: {
  busy: boolean;
  onPublish: (input: {
    title: string;
    body: string;
    level: string;
    pinned: boolean;
    hours: number;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [level, setLevel] = useState("info");
  const [pinned, setPinned] = useState(false);
  const [hours, setHours] = useState(0);

  const ready = title.trim().length >= 2 && body.trim().length >= 2;

  return (
    <>
      <div className="detail-kind">
        <span className="badge">新公告</span>
      </div>
      <h1 className="detail-title">写一条公告</h1>
      <p className="detail-sub">
        发布后会出现在客户端「库」页顶部。用户关掉之后不会再看到同一条。
      </p>

      <div className="announce-form">
        <label>
          <span className="meta-label">标题</span>
          <input
            className="field"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：市场服务维护通知"
            maxLength={80}
          />
        </label>

        <label>
          <span className="meta-label">正文</span>
          <textarea
            className="field announce-textarea"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="说明时间、影响范围、用户可以做什么"
            maxLength={4000}
          />
        </label>

        <div className="announce-form-row">
          <label>
            <span className="meta-label">级别</span>
            <select
              className="field"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
            >
              <option value="info">普通</option>
              <option value="important">重要</option>
            </select>
          </label>

          <label>
            <span className="meta-label">有效期（小时，0 = 长期）</span>
            <input
              className="field"
              type="number"
              min={0}
              value={hours}
              onChange={(event) => setHours(Number(event.target.value) || 0)}
            />
          </label>

          <label className="announce-check">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(event) => setPinned(event.target.checked)}
            />
            <span>置顶</span>
          </label>
        </div>

        <div className="action-bar">
          <button
            className="btn btn-primary"
            disabled={busy || !ready}
            onClick={() => onPublish({ title: title.trim(), body: body.trim(), level, pinned, hours })}
          >
            {busy ? "发布中…" : "发布"}
          </button>
        </div>
      </div>
    </>
  );
}

/** 看一条已发布的公告。 */
function AnnounceDetail({
  item,
  busy,
  onDelete,
}: {
  item: Announcement | null;
  busy: boolean;
  onDelete: (item: Announcement) => void;
}) {
  if (!item) {
    return <div className="detail-empty">这条公告已经不在列表里了</div>;
  }

  return (
    <>
      <div className="detail-kind">
        <span className={item.level === "important" ? "badge badge-danger" : "badge"}>
          {item.pinned ? "置顶" : item.level === "important" ? "重要" : "公告"}
        </span>
        <span className="badge">{item.published}</span>
      </div>

      <h1 className="detail-title">{item.title}</h1>
      <p className="detail-sub">{item.id}</p>

      <div className="report-reason">
        <div className="report-reason-label">正文</div>
        <p className="report-reason-body">{item.body}</p>
      </div>

      <div className="action-bar">
        <button className="btn btn-danger" disabled={busy} onClick={() => onDelete(item)}>
          删除公告
        </button>
      </div>

      <p className="detail-hint">
        删除后客户端不会再显示。只是想让它下线的话，也可以等有效期到了自动过期。
      </p>
    </>
  );
}
