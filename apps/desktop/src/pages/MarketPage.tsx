import { useMemo, useState } from "react";

import { PixelCover } from "../components/PixelCover";
import { AlertIcon, RefreshIcon, SearchIcon } from "../components/Icons";
import { formatBytes } from "../lib/format";
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
            {packages.length === 0 ? "作者上传并通过审核后会出现在这里" : "换个关键词，或切换上面的筛选"}
          </div>
        </div>
      ) : (
        <div className="grid">
          {visible.map((item) => (
            <article key={item.id} className="pkg-card">
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

/** 有封面图就用真图，加载失败退回像素封面——不至于留一块空白。 */
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
  if (state === "installed") {
    return (
      <button className="btn btn-sm btn-ghost" disabled>
        已安装
      </button>
    );
  }
  if (state === "update") {
    return (
      <button className="btn btn-sm" onClick={onClick}>
        更新
      </button>
    );
  }
  return (
    <button className="btn btn-sm btn-primary" onClick={onClick}>
      安装
    </button>
  );
}
