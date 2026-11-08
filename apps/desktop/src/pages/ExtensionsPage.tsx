import { useCallback, useEffect, useState } from "react";

import { Modal } from "../components/Modal";
import { PuzzleIcon, RefreshIcon } from "../components/Icons";
import { formatBytes } from "../lib/format";
import {
  importExtension,
  pickPackage,
  removeExtension,
  scanExtensions,
  setExtensionEnabled,
} from "../lib/extensions";
import type { ExtensionsView, PplExtension } from "../lib/types";

/**
 * 运行时是否已接入。
 *
 * 现在只有「静态部分」：识别、安装、启停、依赖与顺序。
 * 真正把扩展注入游戏进程的 JVM agent 还没做，所以这里必须如实告诉用户
 * 「扩展装上了但还不会生效」——否则他会以为是扩展本身坏了。
 */
const RUNTIME_READY = false;

interface ExtensionsPageProps {
  /** 游戏目录；没有实例时整页退化成引导 */
  root: string | null;
  notify: (message: string) => void;
}

/**
 * 扩展页。
 *
 * 这里管理的是 **PPL 自己的扩展格式**（`.pplx` + `ppl-extension.json`），
 * 和社区加载器的 `extensions/` 井水不犯河水——两者的包格式不同，
 * 混在一个目录里只会互相干扰。
 */
export function ExtensionsPage({ root, notify }: ExtensionsPageProps) {
  const [view, setView] = useState<ExtensionsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PplExtension | null>(null);

  const load = useCallback(async () => {
    if (!root) {
      setView(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setView(await scanExtensions(root));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [root]);

  useEffect(() => {
    void load();
  }, [load]);

  async function importFromDialog() {
    if (!root) return;
    const picked = await pickPackage();
    if (!picked) return;
    setBusy("import");
    try {
      const imported = await importExtension(root, picked);
      notify(`已导入《${imported.descriptor.name}》`);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function toggle(item: PplExtension) {
    if (!root) return;
    setBusy(item.file);
    try {
      await setExtensionEnabled(root, item.file, !item.enabled);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function drop(item: PplExtension) {
    if (!root) return;
    setBusy(item.file);
    try {
      await removeExtension(root, item.file);
      setRemoveTarget(null);
      notify(`已删除《${item.descriptor.name}》`);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const extensions = view?.extensions ?? [];
  const plan = view?.plan;
  const loadedCount = plan?.order.length ?? 0;

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">扩展</h1>
          <p className="page-desc">
            {root
              ? `${extensions.length} 个已安装 · 本次会加载 ${loadedCount} 个`
              : "先指定游戏目录，才能管理扩展"}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn btn-sm" onClick={() => void load()} disabled={loading || !root}>
            <RefreshIcon className="nav-icon" />
            {loading ? "扫描中…" : "重新扫描"}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void importFromDialog()}
            disabled={busy !== null || !root}
          >
            {busy === "import" ? "导入中…" : "导入扩展"}
          </button>
        </div>
      </header>

      {!root && (
        <div className="gate">
          <div className="gate-icon" aria-hidden="true">
            <PuzzleIcon />
          </div>
          <h2 className="gate-title">还没有游戏目录</h2>
          <p className="gate-desc">
            扩展要装进游戏目录里的 <code>ppl/extensions</code>，
            先在「库」页添加游戏目录或下载一份游戏。
          </p>
        </div>
      )}

      {error && (
        <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      {root && view && (
        <>
          {!RUNTIME_READY && (
            <div className="notice" style={{ marginBottom: 14 }}>
              扩展的运行时还没接入：这里可以安装、启停和查看加载顺序，
              但游戏进程暂时不会应用它们。规范与接入计划见 <code>docs/EXTENSIONS.md</code>。
            </div>
          )}

          <PlanWarnings view={view} />

          {plan && plan.order.length > 0 && (
            <div className="load-order">
              <span className="load-order-label">加载顺序</span>
              <ol className="load-order-list">
                {plan.order.map((id, index) => (
                  <li key={id} title={id}>
                    <span className="load-order-index">{index + 1}</span>
                    {id}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {extensions.length === 0 && !loading ? (
            <div className="empty">
              <div>还没有安装任何扩展</div>
              <div style={{ fontSize: 12 }}>
                扩展包是 <code>.pplx</code>，里面带一份 <code>ppl-extension.json</code>
              </div>
            </div>
          ) : (
            <div className="ext-list">
              {extensions.map((item) => (
                <ExtensionRow
                  key={item.file}
                  item={item}
                  busy={busy === item.file}
                  onToggle={() => void toggle(item)}
                  onRemove={() => setRemoveTarget(item)}
                />
              ))}
            </div>
          )}

          <p className="ext-foot">
            扩展目录：<code>{view.dir}</code>
            {!view.dirExists && "（首次导入时自动创建）"}
          </p>
        </>
      )}

      <Modal
        open={removeTarget !== null}
        title={`删除《${removeTarget?.descriptor.name ?? ""}》`}
        description="只删除扩展包本身，不会动它可能在游戏目录里留下的数据。"
        onClose={() => setRemoveTarget(null)}
        dismissable={busy === null}
        footer={
          <>
            <button className="btn" onClick={() => setRemoveTarget(null)} disabled={busy !== null}>
              取消
            </button>
            <button
              className="btn btn-danger"
              disabled={busy !== null}
              onClick={() => removeTarget && void drop(removeTarget)}
            >
              确认删除
            </button>
          </>
        }
      >
        <p className="modal-desc" style={{ margin: 0 }}>
          删掉之后要重新导入才能再用。如果只是想暂时关掉，用左边的开关更合适。
        </p>
      </Modal>
    </>
  );
}

/** 缺失依赖、成环、API 不兼容——三者都会让扩展静默失效，必须显式说出来。 */
function PlanWarnings({ view }: { view: ExtensionsView }) {
  const { plan } = view;
  const hasIssue =
    plan.missing.length > 0 || plan.cycles.length > 0 || plan.incompatible.length > 0;
  if (!hasIssue) return null;

  return (
    <div className="ext-warnings">
      {plan.cycles.length > 0 && (
        <div className="notice notice-error">
          这些扩展互相依赖成环，整组都不会加载：
          {plan.cycles.map((group) => group.join("、")).join("；")}
        </div>
      )}
      {plan.missing.length > 0 && (
        <div className="notice">
          {plan.missing.map((item) => (
            <div key={`${item.owner}-${item.missing}`}>
              《{item.owner}》依赖 <code>{item.missing}</code>，但没有安装或已被停用
            </div>
          ))}
        </div>
      )}
      {plan.incompatible.length > 0 && (
        <div className="notice notice-error">
          这些扩展要求的运行时版本比当前启动器新，会被跳过：
          {plan.incompatible.join("、")}
        </div>
      )}
    </div>
  );
}

function ExtensionRow({
  item,
  busy,
  onToggle,
  onRemove,
}: {
  item: PplExtension;
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { descriptor } = item;

  return (
    <div className={`ext-row${item.enabled ? "" : " off"}${item.valid ? "" : " broken"}`}>
      <div className="ext-main">
        <div className="ext-title">
          <span>{descriptor.name}</span>
          {descriptor.version && <span className="badge">{descriptor.version}</span>}
          {!item.valid && <span className="badge badge-danger">包已损坏</span>}
          {item.enabled ? null : <span className="badge badge-muted">已停用</span>}
        </div>
        <div className="ext-meta">
          <code>{descriptor.id}</code>
          <span>{formatBytes(item.size)}</span>
          {descriptor.dependsOn.length > 0 && (
            <span>依赖 {descriptor.dependsOn.join("、")}</span>
          )}
        </div>
        {descriptor.description && <p className="ext-desc">{descriptor.description}</p>}
        {item.problem && <p className="ext-problem">{item.problem}</p>}
      </div>

      <div className="ext-actions">
        <button
          className={`switch${item.enabled ? " on" : ""}`}
          role="switch"
          aria-checked={item.enabled}
          aria-label={`${item.enabled ? "停用" : "启用"} ${descriptor.name}`}
          disabled={busy || !item.valid}
          onClick={onToggle}
        />
        <button className="btn btn-sm btn-ghost" onClick={onRemove} disabled={busy}>
          删除
        </button>
      </div>
    </div>
  );
}
