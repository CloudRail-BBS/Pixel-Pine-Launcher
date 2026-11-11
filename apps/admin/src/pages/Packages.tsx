import { useCallback, useEffect, useState } from "react";

import * as api from "../lib/api";
import type { AdminPackage, AdminPackageDetail } from "../lib/api";
import { formatSize } from "../lib/format";

const STATUS: Record<string, { text: string; cls: string }> = {
  draft: { text: "草稿", cls: "badge" },
  pending: { text: "待审核", cls: "badge badge-warn" },
  published: { text: "已上架", cls: "badge badge-ok" },
  rejected: { text: "已驳回", cls: "badge badge-danger" },
  takendown: { text: "已下架", cls: "badge badge-danger" },
};

const VERSION_STATUS: Record<string, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已驳回",
};

interface PackagesProps {
  onError: (message: string | null) => void;
  onToast: (message: string | null) => void;
}

/** 资源管理：所有状态的资源都能在这里查、改、删。 */
export function Packages({ onError, onToast }: PackagesProps) {
  const [items, setItems] = useState<AdminPackage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [detail, setDetail] = useState<AdminPackageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [takedownTarget, setTakedownTarget] = useState<AdminPackage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminPackage | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(
    async (nextPage = page) => {
      setLoading(true);
      onError(null);
      try {
        const result = await api.adminPackages({
          status,
          kind,
          q: keyword.trim() || undefined,
          page: nextPage,
          size: pageSize,
        });
        setItems(result.items);
        setTotal(result.total);
        setPage(result.page);
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [status, kind, keyword, page, pageSize, onError],
  );

  useEffect(() => {
    void load(1);
    // 筛选条件变化时回到第一页
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, kind]);

  async function openDetail(id: string) {
    setDetailLoading(true);
    onError(null);
    try {
      setDetail(await api.adminPackageDetail(id));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDetailLoading(false);
    }
  }

  async function act(kindOf: "restore" | "takedown" | "delete", row: AdminPackage) {
    setBusy(true);
    onError(null);
    try {
      if (kindOf === "restore") {
        await api.restorePackage(row.id);
        onToast(`已恢复《${row.title}》`);
      } else if (kindOf === "takedown") {
        await api.takedown(row.id, note.trim());
        onToast(`已下架《${row.title}》`);
      } else {
        await api.deletePackage(row.id);
        onToast(`已删除《${row.title}》`);
      }
      setTakedownTarget(null);
      setDeleteTarget(null);
      setNote("");
      setDetail(null);
      await load(page);
      window.setTimeout(() => onToast(null), 4000);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">资源管理</h2>
          <p className="page-desc">包含草稿、待审、已上架、已下架的全部资源。删除不可恢复。</p>
        </div>
        <button className="btn" onClick={() => void load(page)} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      <div className="toolbar">
        <input
          className="field toolbar-search"
          placeholder="搜标题 / slug / 作者"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void load(1);
          }}
        />
        <select className="field" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="pending">待审核</option>
          <option value="draft">草稿</option>
          <option value="published">已上架</option>
          <option value="rejected">已驳回</option>
          <option value="takendown">已下架</option>
        </select>
        <select className="field" value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="">全部类型</option>
          <option value="mod">Mod</option>
          <option value="map">地图</option>
        </select>
        <button className="btn" onClick={() => void load(1)} disabled={loading}>
          搜索
        </button>
        <span className="toolbar-count">共 {total} 条</span>
      </div>

      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>资源</th>
              <th>类型</th>
              <th>状态</th>
              <th className="cell-num">最新版本</th>
              <th className="cell-num">体积</th>
              <th className="cell-num">下载</th>
              <th>更新时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="table-empty">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="table-empty">
                  <strong>没有匹配的资源</strong>
                  换个关键词，或把状态筛选放宽一点
                </td>
              </tr>
            )}
            {!loading &&
              items.map((row) => {
                const badge = STATUS[row.status] ?? STATUS.draft;
                return (
                  <tr key={row.id} onClick={() => void openDetail(row.id)} className="table-row">
                    <td>
                      <div className="cell-title">{row.title}</div>
                      <div className="cell-sub">{row.slug}</div>
                    </td>
                    <td>{row.kind === "mod" ? "Mod" : "地图"}</td>
                    <td>
                      <span className={badge.cls}>{badge.text}</span>
                    </td>
                    <td className="cell-num">{row.version ? `v${row.version}` : "—"}</td>
                    <td className="cell-num">{formatSize(row.size)}</td>
                    <td className="cell-num">{row.downloads}</td>
                    <td className="cell-sub">{row.updated}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => void openDetail(row.id)}>
                          详情
                        </button>
                        {(row.status === "takendown" || row.status === "rejected") && (
                          <button
                            className="btn btn-sm"
                            disabled={busy}
                            onClick={() => void act("restore", row)}
                          >
                            恢复
                          </button>
                        )}
                        {row.status === "published" && (
                          <button
                            className="btn btn-sm"
                            onClick={() => {
                              setNote("");
                              setTakedownTarget(row);
                            }}
                          >
                            下架
                          </button>
                        )}
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => setDeleteTarget(row)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button className="btn btn-sm" disabled={page <= 1 || loading} onClick={() => void load(page - 1)}>
          上一页
        </button>
        <span className="pager-info">
          {page} / {pages}
        </span>
        <button
          className="btn btn-sm"
          disabled={page >= pages || loading}
          onClick={() => void load(page + 1)}
        >
          下一页
        </button>
      </div>

      {(detail || detailLoading) && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal modal-wide">
            {detailLoading || !detail ? (
              <div className="panel-empty">加载中…</div>
            ) : (
              <>
                <div className="detail-head">
                  <span className="detail-kind">
                    {detail.kind === "mod" ? "MOD" : "地图"}
                  </span>
                  <h3 className="modal-title" style={{ margin: 0 }}>
                    {detail.title}
                  </h3>
                  <span className={(STATUS[detail.status] ?? STATUS.draft).cls}>
                    {(STATUS[detail.status] ?? STATUS.draft).text}
                  </span>
                </div>

                <p className="modal-desc">{detail.summary || "（没有简介）"}</p>

                <div className="meta-grid">
                  <Meta label="slug" value={detail.slug} />
                  <Meta label="作者" value={detail.author || "—"} />
                  <Meta label="上传者" value={detail.owner ?? "—"} />
                  <Meta label="版本数" value={String(detail.versions.length)} />
                  <Meta label="创建" value={detail.created} />
                  <Meta label="更新" value={detail.updated} />
                </div>

                {detail.reviewNote && (
                  <div className="notice notice-error" style={{ marginTop: 14 }}>
                    最近一次审核意见：{detail.reviewNote}
                  </div>
                )}

                <div className="panel-head" style={{ marginTop: 18, paddingLeft: 0 }}>
                  <span>版本</span>
                  <span className="panel-hint">体积、下载地址与哈希</span>
                </div>
                <div className="table-wrap" style={{ border: "1px solid var(--line)", borderRadius: 10 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>版本</th>
                        <th>状态</th>
                        <th>体积</th>
                        <th>下载</th>
                        <th>sha256</th>
                        <th>创建</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.versions.length === 0 && (
                        <tr>
                          <td colSpan={6} className="table-empty">
                            <strong>还没有上传过版本</strong>
                            作者提交新版本后会出现在这里
                          </td>
                        </tr>
                      )}
                      {detail.versions.map((version) => (
                        <tr key={version.version}>
                          <td>v{version.version}</td>
                          <td>{VERSION_STATUS[version.status] ?? version.status}</td>
                          <td className="cell-num">{formatSize(version.size)}</td>
                          <td className="cell-num">{version.downloads}</td>
                          <td className="cell-mono">
                            {version.sha256 ? `${version.sha256.slice(0, 12)}…` : "—"}
                          </td>
                          <td className="cell-sub">{version.created}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {detail.versions[0]?.urls[0] && (
                  <p className="modal-desc" style={{ marginTop: 12 }}>
                    下载地址：
                    <a className="detail-link" href={detail.versions[0].urls[0]} target="_blank" rel="noreferrer">
                      {detail.versions[0].urls[0]}
                    </a>
                  </p>
                )}

                <div className="modal-actions">
                  {(detail.status === "takendown" || detail.status === "rejected") && (
                    <button className="btn" disabled={busy} onClick={() => void act("restore", detail)}>
                      恢复上架
                    </button>
                  )}
                  {detail.status === "published" && (
                    <button
                      className="btn"
                      onClick={() => {
                        setNote("");
                        setTakedownTarget(detail);
                      }}
                    >
                      下架
                    </button>
                  )}
                  <button className="btn btn-danger" onClick={() => setDeleteTarget(detail)}>
                    删除资源
                  </button>
                  <button className="btn" onClick={() => setDetail(null)}>
                    关闭
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {takedownTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3 className="modal-title">下架《{takedownTarget.title}》</h3>
            <p className="modal-desc">
              资源会立刻从市场消失，已上架版本转为「已驳回」。原因会展示给作者。
            </p>
            <textarea
              value={note}
              placeholder="例如：举报属实，包内含未授权的商业素材"
              onChange={(event) => setNote(event.target.value)}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn" onClick={() => setTakedownTarget(null)}>
                取消
              </button>
              <button
                className="btn btn-danger"
                disabled={busy || !note.trim()}
                onClick={() => void act("takedown", takedownTarget)}
              >
                确认下架
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3 className="modal-title">彻底删除《{deleteTarget.title}》</h3>
            <p className="modal-desc">
              数据库记录和磁盘上的所有包都会删掉，<strong>不可恢复</strong>。
              只想让它从市场消失的话，用「下架」。
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => void act("delete", deleteTarget)}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-cell">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value}</span>
    </div>
  );
}
