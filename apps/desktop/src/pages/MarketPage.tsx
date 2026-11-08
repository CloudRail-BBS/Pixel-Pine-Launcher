import { useCallback, useEffect, useMemo, useState } from "react";

import { PixelCover } from "../components/PixelCover";
import { AlertIcon, RefreshIcon, SearchIcon } from "../components/Icons";
import { formatBytes } from "../lib/format";
import { activeSource, fetchDetail, reportPackage } from "../lib/market";
import type { MarketPackage } from "../lib/types";

type Filter = "all" | "mod" | "map" | "installed" | "update";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "mod", label: "Mod" },
  { id: "map", label: "地图" },
  { id: "installed", label: "已安装" },
  { id: "update", label: "可更新" },
];

interface MarketPageProps {
  packages: MarketPackage[];
  total: number;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onInstall: (item: MarketPackage) => void;
}

export function MarketPage({
  packages,
  total,
  loading,
  error,
  onRetry,
  onInstall,
}: MarketPageProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const opened = useMemo(
    () => packages.find((item) => item.id === openId) ?? null,
    [packages, openId],
  );

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return packages.filter((item) => {
      if (filter === "mod" && item.kind !== "mod") return false;
      if (filter === "map" && item.kind !== "map") return false;
      if (filter === "installed" && item.state === "available") return false;
      if (filter === "update" && item.state !== "update") return false;
      if (!keyword) return true;
      return (
        item.title.toLowerCase().includes(keyword) ||
        item.author.toLowerCase().includes(keyword) ||
        item.summary.toLowerCase().includes(keyword)
      );
    });
  }, [packages, query, filter]);

  if (opened) {
    return (
      <DetailView item={opened} onBack={() => setOpenId(null)} onInstall={() => onInstall(opened)} />
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">市场</h1>
          <p className="page-desc">
            {error
              ? "市场暂时连不上"
              : loading && packages.length === 0
                ? "正在读取资源…"
                : `${total} 个资源 · 安装后加入当前预设`}
          </p>
        </div>

        <label className="search page-search">
          <SearchIcon className="nav-icon" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Mod、地图或作者"
            aria-label="搜索资源"
          />
        </label>
      </header>

      <div className="filter-row">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            className={`chip${filter === item.id ? " active" : ""}`}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="market-error" role="alert">
          <div className="market-error-head">
            <AlertIcon className="nav-icon" />
            <span>读不到资源列表</span>
          </div>
          <p className="market-error-body">{error}</p>
          <button className="btn btn-sm" onClick={onRetry}>
            <RefreshIcon className="nav-icon" />
            重试
          </button>
        </div>
      ) : loading && packages.length === 0 ? (
        <div className="grid">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="pkg-card skeleton" aria-hidden="true">
              <div className="pkg-cover" />
              <div className="pkg-body">
                <div className="skeleton-line" style={{ width: "62%" }} />
                <div className="skeleton-line" style={{ width: "38%" }} />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <div>{packages.length === 0 ? "市场还没有上架资源" : "没有匹配的资源"}</div>
          <div style={{ fontSize: 12 }}>
            {packages.length === 0
              ? "作者上传并通过审核后会出现在这里"
              : "换个关键词，或切换上面的筛选"}
          </div>
        </div>
      ) : (
        <div className="grid">
          {visible.map((item) => (
            <article
              key={item.id}
              className="pkg-card"
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(item.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setOpenId(item.id);
                }
              }}
            >
              <div className="pkg-cover">
                <MarketCover item={item} />
                <div className="pkg-cover-badge">
                  <span className="badge">{item.kind === "mod" ? "Mod" : "地图"}</span>
                </div>
              </div>
              <div className="pkg-body">
                <div className="pkg-title" title={item.title}>
                  {item.title}
                </div>
                <div className="pkg-sub">
                  <span className="pkg-author">{item.author}</span>
                  <span>·</span>
                  <span>v{item.version}</span>
                </div>
                <p className="pkg-summary" title={item.summary}>
                  {item.summary || "作者没有填写简介"}
                </p>
                <div className="pkg-foot">
                  <div className="pkg-stat">
                    <span>{formatBytes(item.size)}</span>
                  </div>
                  <ActionButton state={item.state} onClick={() => onInstall(item)} />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

/** 详情：本体信息 + 版本历史 + 举报。 */
function DetailView({
  item,
  onBack,
  onInstall,
}: {
  item: MarketPackage;
  onBack: () => void;
  onInstall: () => void;
}) {
  const [versions, setVersions] = useState<
    { version: string; size: number; changelog: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async () => {
    if (activeSource().format !== "ppl") {
      setNote("这个市场源不提供版本历史");
      return;
    }
    setLoading(true);
    try {
      const detail = await fetchDetail(item.slug);
      setVersions(detail.versions);
      if (detail.versions.length === 0) setNote("这只是第一个版本");
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [item.slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <header className="page-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <button className="btn btn-sm btn-ghost" onClick={onBack}>
            ← 返回
          </button>
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title" style={{ fontSize: 20 }}>
              {item.title}
            </h1>
            <p className="page-desc">
              {item.author} · {item.kind === "mod" ? "Mod" : "地图"} · v{item.version}
            </p>
          </div>
        </div>
        <div className="head-actions">
          <ActionButton state={item.state} onClick={onInstall} />
        </div>
      </header>

      <div className="detail-hero">
        <div className="detail-cover">
          <MarketCover item={item} />
        </div>
        <div className="detail-info">
          <p className="detail-intro">{item.summary || "作者没有填写简介"}</p>
          <div className="kv">
            <span>当前版本</span>
            <span>v{item.version}</span>
          </div>
          <div className="kv">
            <span>体积</span>
            <span>{formatBytes(item.size)}</span>
          </div>
          <div className="kv">
            <span>标识</span>
            <span className="detail-slug">{item.slug}</span>
          </div>
        </div>
      </div>

      <section className="section">
        <div className="section-title">版本历史</div>
        {loading ? (
          <div className="empty">正在读取…</div>
        ) : versions.length === 0 ? (
          <div className="empty">{note ?? "没有更多版本"}</div>
        ) : (
          <div className="version-list">
            {versions.map((version, index) => (
              <div key={version.version} className="version-row">
                <div className="version-head">
                  <span className="version-tag">v{version.version}</span>
                  {index === 0 && <span className="badge badge-ok">最新</span>}
                  <span className="version-size">{formatBytes(version.size)}</span>
                </div>
                {version.changelog && <div className="version-note">{version.changelog}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="detail-foot">
        <button className="btn btn-sm btn-ghost" onClick={() => setReporting(true)}>
          举报这个资源
        </button>
      </div>

      {reporting && (
        <ReportDialog
          title={item.title}
          onClose={() => setReporting(false)}
          onSubmit={async (reason, contact) => {
            await reportPackage(item.slug, reason, contact);
            setReporting(false);
          }}
        />
      )}
    </>
  );
}

function MarketCover({ item }: { item: MarketPackage }) {
  const [broken, setBroken] = useState(false);
  if (!item.cover || broken) return <PixelCover seed={item.slug} />;
  return (
    <img
      src={item.cover}
      alt=""
      loading="lazy"
      className="pkg-cover-img"
      onError={() => setBroken(true)}
    />
  );
}

function ActionButton({
  state,
  onClick,
}: {
  state: MarketPackage["state"];
  onClick: () => void;
}) {
  const handle = (event: React.MouseEvent) => {
    // 卡片本身可点开详情，按钮必须拦住冒泡
    event.stopPropagation();
    onClick();
  };

  if (state === "installed") {
    return (
      <button className="btn btn-sm btn-ghost" disabled>
        已安装
      </button>
    );
  }
  if (state === "update") {
    return (
      <button className="btn btn-sm" onClick={handle}>
        更新
      </button>
    );
  }
  return (
    <button className="btn btn-sm btn-primary" onClick={handle}>
      安装
    </button>
  );
}

function ReportDialog({
  title,
  onClose,
  onSubmit,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (reason: string, contact: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const short = reason.trim().length < 4;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim(), contact.trim());
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        // 点遮罩关闭，但别把点击带到卡片上
        event.stopPropagation();
        if (!busy) onClose();
      }}
    >
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal-title">举报《{title}》</h2>
        {done ? (
          <>
            <p className="modal-desc">已经收到，管理员会处理。感谢你帮忙维护市场秩序。</p>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={onClose}>
                知道了
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="modal-desc">
              说清楚问题所在——侵权、恶意代码、与描述不符。空泛的「有问题」帮不上忙。
            </p>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：这个包里的 units 覆盖了原版单位，导致联机不同步"
              autoFocus
            />
            <input
              className="field"
              style={{ marginTop: 8 }}
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              placeholder="联系方式（可选，方便回访）"
            />
            {error && (
              <div className="notice notice-error" style={{ marginTop: 10 }}>
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={onClose} disabled={busy}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void submit()}
                disabled={busy || short}
              >
                {busy ? "提交中…" : "提交举报"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
