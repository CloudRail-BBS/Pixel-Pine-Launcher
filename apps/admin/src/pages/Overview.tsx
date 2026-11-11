import { useCallback, useEffect, useState } from "react";

import * as api from "../lib/api";
import type { AdminStats } from "../lib/api";
import { actionLabel } from "../lib/format";

interface OverviewProps {
  onNavigate: (page: "queue" | "reports" | "packages") => void;
  onError: (message: string | null) => void;
}

/** 概览：先回答「有没有活要干」，再给背景读数。 */
export function Overview({ onNavigate, onError }: OverviewProps) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      setStats(await api.stats());
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const count = (status: string) => stats?.packages?.[status] ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">概览</h2>
          <p className="page-desc">待办在前，读数在后。点卡片直接进对应列表。</p>
        </div>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      <div className="cards cards-4">
        <button className="card metric" onClick={() => onNavigate("queue")}>
          <span className="metric-num">{loading ? "—" : count("pending") + count("draft")}</span>
          <span className="metric-label">待审资源</span>
          <span className="metric-hint">进队列处理</span>
        </button>
        <button className="card metric" onClick={() => onNavigate("reports")}>
          <span className="metric-num">{loading ? "—" : stats?.openReports ?? 0}</span>
          <span className="metric-label">待处理举报</span>
          <span className="metric-hint">处理或下架</span>
        </button>
        <button className="card metric" onClick={() => onNavigate("packages")}>
          <span className="metric-num">{loading ? "—" : stats?.pendingVersions ?? 0}</span>
          <span className="metric-label">待审版本</span>
          <span className="metric-hint">新版本等放行</span>
        </button>
        <button className="card metric" onClick={() => onNavigate("packages")}>
          <span className="metric-num">{loading ? "—" : count("published")}</span>
          <span className="metric-label">已上架</span>
          <span className="metric-hint">市场里可见</span>
        </button>
      </div>

      <div className="cards cards-3">
        <div className="card metric" style={{ cursor: "default" }}>
          <span className="metric-num">{loading ? "—" : stats?.downloads ?? 0}</span>
          <span className="metric-label">累计下载</span>
          <span className="metric-hint">所有版本合计</span>
        </div>
        <div className="card metric" style={{ cursor: "default" }}>
          <span className="metric-num">{loading ? "—" : stats?.users ?? 0}</span>
          <span className="metric-label">注册用户</span>
          <span className="metric-hint">验证码登录即注册</span>
        </div>
        <div className="card metric" style={{ cursor: "default" }}>
          <span className="metric-num">{loading ? "—" : stats?.announcements ?? 0}</span>
          <span className="metric-label">生效公告</span>
          <span className="metric-hint">含长期置顶</span>
        </div>
      </div>

      <section className="card panel">
        <div className="panel-head">
          <span>最近动作</span>
          <span className="panel-hint">审计日志，按时间倒序</span>
        </div>
        {loading && <div className="panel-empty">加载中…</div>}
        {!loading && (stats?.recent.length ?? 0) === 0 && (
          <div className="panel-empty">还没有动作记录</div>
        )}
        <ul className="log">
          {(stats?.recent ?? []).map((entry, index) => (
            <li className="log-row" key={`${entry.created}-${index}`}>
              <span className="log-time">{entry.created}</span>
              <span className="log-action">{actionLabel(entry.action)}</span>
              <span className="log-target">{entry.target}</span>
              <span className="log-actor">{entry.actor ?? "—"}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
