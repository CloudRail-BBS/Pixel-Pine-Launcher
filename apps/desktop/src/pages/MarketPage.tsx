import { useMemo, useState } from "react";

import { PixelCover } from "../components/PixelCover";
import { SearchIcon } from "../components/Icons";
import { formatBytes, formatCount } from "../lib/format";
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
  onInstall: (id: string) => void;
}

export function MarketPage({ packages, onInstall }: MarketPageProps) {
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
        item.tag.toLowerCase().includes(keyword)
      );
    });
  }, [packages, query, filter]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">市场</h1>
          <p className="page-desc">共 {packages.length} 个资源 · 安装后自动加入当前预设</p>
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

      {visible.length === 0 ? (
        <div className="empty">
          <div>没有匹配的资源</div>
          <div style={{ fontSize: 12 }}>换个关键词，或切换上面的筛选</div>
        </div>
      ) : (
        <div className="grid">
          {visible.map((item) => (
            <article key={item.id} className="pkg-card">
              <div className="pkg-cover">
                <PixelCover seed={item.id} />
                <div className="pkg-cover-badge">
                  <span className="badge">{item.kind === "mod" ? "Mod" : "地图"}</span>
                </div>
              </div>
              <div className="pkg-body">
                <div className="pkg-title">{item.title}</div>
                <div className="pkg-sub">
                  <span>{item.author}</span>
                  <span>·</span>
                  <span>v{item.version}</span>
                </div>
                <div className="pkg-foot">
                  <div className="pkg-stat">
                    <span>↓ {formatCount(item.downloads)}</span>
                    <span>★ {item.rating.toFixed(1)}</span>
                    <span>{formatBytes(item.size)}</span>
                  </div>
                  <ActionButton state={item.state} onClick={() => onInstall(item.id)} />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
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
