import { useCallback, useEffect, useState } from "react";

import * as api from "../lib/api";
import type { AdminStats } from "../lib/api";
import { actionLabel } from "../lib/format";

type NavTarget = "queue" | "reports" | "packages" | "announce" | "game" | "launcher";

interface OverviewProps {
  onNavigate: (page: NavTarget) => void;
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
  const pending = count("pending") + count("draft");
  const reports = stats?.openReports ?? 0;
  const versions = stats?.pendingVersions ?? 0;

  /** 有待办才高亮：一个全是 0 的红色角标只会让人麻木。 */
  const tone = (value: number) => (value > 0 ? " is-hot" : "");

  return (
    <div className="page page-overview">
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
        <button className={`card metric${tone(pending)}`} onClick={() => onNavigate("queue")}>
          <span className="metric-num">{loading ? "—" : pending}</span>
          <span className="metric-label">待审资源</span>
          <span className="metric-hint">进队列处理</span>
          <span className="metric-go" aria-hidden="true">
            打开队列
            <span className="metric-arrow">→</span>
          </span>
        </button>
        <button className={`card metric${tone(reports)}`} onClick={() => onNavigate("reports")}>
          <span className="metric-num">{loading ? "—" : reports}</span>
          <span className="metric-label">待处理举报</span>
          <span className="metric-hint">处理或下架</span>
          <span className="metric-go" aria-hidden="true">
            查看举报
            <span className="metric-arrow">→</span>
          </span>
        </button>
        <button className={`card metric${tone(versions)}`} onClick={() => onNavigate("packages")}>
          <span className="metric-num">{loading ? "—" : versions}</span>
          <span className="metric-label">待审版本</span>
          <span className="metric-hint">新版本等放行</span>
          <span className="metric-go" aria-hidden="true">
            去资源管理
            <span className="metric-arrow">→</span>
          </span>
        </button>
        <button className="card metric" onClick={() => onNavigate("packages")}>
          <span className="metric-num">{loading ? "—" : count("published")}</span>
          <span className="metric-label">已上架</span>
          <span className="metric-hint">市场里可见</span>
          <span className="metric-go" aria-hidden="true">
            浏览资源
            <span className="metric-arrow">→</span>
          </span>
        </button>
      </div>

      <div className="overview-split">
        <section className="card panel">
          <div className="panel-head">
            <span>最近动作</span>
            <span className="panel-hint">审计日志，按时间倒序</span>
          </div>
          {loading && <div className="panel-empty">加载中…</div>}
          {!loading && (stats?.recent.length ?? 0) === 0 && (
            <div className="panel-empty">
              <span className="panel-empty-title">还没有动作记录</span>
              <span className="panel-empty-hint">审核、上传、发布公告都会记在这里</span>
            </div>
          )}
          {(stats?.recent.length ?? 0) > 0 && (
            <ul className="log">
              <li className="log-head" aria-hidden="true">
                <span>时间</span>
                <span>动作</span>
                <span>对象</span>
                <span>操作人</span>
              </li>
              {(stats?.recent ?? []).map((entry, index) => (
                <li className="log-row" key={`${entry.created}-${index}`}>
                  <span className="log-time">{entry.created}</span>
                  <span className="log-action">{actionLabel(entry.action)}</span>
                  <span className="log-target" title={entry.target}>
                    {entry.target}
                  </span>
                  <span className="log-actor" title={entry.actor ?? ""}>
                    {entry.actor ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 背景读数放进右栏：它们是「了解现状」，不该和待办抢同一行 */}
        <aside className="card aside-stats">
          <div className="panel-head">
            <span>运营读数</span>
          </div>
          <div className="stat-list">
            <div className="stat-row">
              <span className="stat-label">累计下载</span>
              <span className="stat-value">{loading ? "—" : stats?.downloads ?? 0}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">注册用户</span>
              <span className="stat-value">{loading ? "—" : stats?.users ?? 0}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">生效公告</span>
              <span className="stat-value">{loading ? "—" : stats?.announcements ?? 0}</span>
            </div>
          </div>
          <p className="aside-note">所有版本合计；验证码登录即注册；含长期置顶。</p>

          {/* 常用操作：概览页最该省掉「先去左边找入口」这一步 */}
          <div className="aside-actions">
            <button className="aside-link" onClick={() => onNavigate("announce")}>
              发布公告
              <span aria-hidden="true">→</span>
            </button>
            <button className="aside-link" onClick={() => onNavigate("game")}>
              管理游戏下载
              <span aria-hidden="true">→</span>
            </button>
            <button className="aside-link" onClick={() => onNavigate("launcher")}>
              启动器更新
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
