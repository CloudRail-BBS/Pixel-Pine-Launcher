import { useCallback, useEffect, useState } from "react";

import { Modal } from "../components/Modal";
import { PuzzleIcon, RefreshIcon } from "../components/Icons";
import { formatBytes } from "../lib/format";
import {
  importExtension,
  importRwml,
  pickJar,
  pickPackage,
  readFormat,
  removeExtension,
  removeRwml,
  saveFormat,
  scanExtensions,
  scanRwml,
  setExtensionEnabled,
  setRwmlEnabled,
  type ExtensionFormat,
} from "../lib/extensions";
import type { ExtensionsView, PplExtension, RwmlExtension, RwmlView } from "../lib/types";

/**
 * 扩展页。
 *
 * 两种格式并存，用户自己选，**默认是 PPL 自有的一套**：
 *
 * - `ppl`：`<游戏>/ppl/extensions`，`.pplx` + `ppl-extension.json`
 * - `rwml`：`<游戏>/extensions`，`.jar` + `META-INF/extension.properties`（兼容层）
 *
 * 两套目录互不重叠，所以可以同时存在，不会互相覆盖。
 */
export function ExtensionsPage({
  root,
  notify,
}: {
  root: string | null;
  notify: (message: string) => void;
}) {
  const [format, setFormat] = useState<ExtensionFormat>(() => readFormat());
  const [ppl, setPpl] = useState<ExtensionsView | null>(null);
  const [rwml, setRwml] = useState<RwmlView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PplExtension | RwmlExtension | null>(null);

  const load = useCallback(async () => {
    if (!root) {
      setPpl(null);
      setRwml(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (format === "ppl") setPpl(await scanExtensions(root));
      else setRwml(await scanRwml(root));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [root, format]);

  useEffect(() => {
    void load();
  }, [load]);

  function switchFormat(next: ExtensionFormat) {
    setFormat(next);
    saveFormat(next);
  }

  async function importFromDialog() {
    if (!root) return;
    setBusy("import");
    try {
      if (format === "ppl") {
        const picked = await pickPackage();
        if (!picked) return;
        const imported = await importExtension(root, picked);
        notify(`已导入《${imported.descriptor.name}》`);
      } else {
        const picked = await pickJar();
        if (!picked) return;
        const imported = await importRwml(root, picked);
        notify(`已导入《${imported.name}》`);
      }
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function toggle(item: PplExtension | RwmlExtension) {
    if (!root) return;
    setBusy(item.file);
    try {
      if (format === "ppl") await setExtensionEnabled(root, item.file, !item.enabled);
      else await setRwmlEnabled(root, item.file, !item.enabled);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function drop(item: PplExtension | RwmlExtension) {
    if (!root) return;
    setBusy(item.file);
    try {
      if (format === "ppl") await removeExtension(root, item.file);
      else await removeRwml(root, item.file);
      setRemoveTarget(null);
      notify(`已删除《${displayName(item)}》`);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const rows: (PplExtension | RwmlExtension)[] =
    format === "ppl" ? (ppl?.extensions ?? []) : (rwml?.extensions ?? []);
  const enabledCount = rows.filter((item) => item.enabled).length;
  const dir = format === "ppl" ? ppl?.dir : rwml?.dir;

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">扩展</h1>
          <p className="page-desc">
            {root
              ? `${rows.length} 个已安装 · ${enabledCount} 个已启用`
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

      <div className="tabs ext-mode" role="tablist" aria-label="扩展格式">
        <button
          role="tab"
          aria-selected={format === "ppl"}
          className={`tab${format === "ppl" ? " active" : ""}`}
          onClick={() => switchFormat("ppl")}
        >
          PPL 格式
          <span className="tab-hint">推荐</span>
        </button>
        <button
          role="tab"
          aria-selected={format === "rwml"}
          className={`tab${format === "rwml" ? " active" : ""}`}
          onClick={() => switchFormat("rwml")}
        >
          RWML 兼容
        </button>
      </div>

      {!root && (
        <div className="gate">
          <div className="gate-icon" aria-hidden="true">
            <PuzzleIcon />
          </div>
          <h2 className="gate-title">还没有游戏目录</h2>
          <p className="gate-desc">
            扩展要装进游戏目录，先在「库」页添加游戏目录或下载一份游戏。
          </p>
        </div>
      )}

      {error && (
        <div className="notice notice-error" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      {root && format === "ppl" && ppl && (
        <>
          <div className="notice" style={{ marginBottom: 14 }}>
            扩展的运行时还没接入：这里可以安装、启停和查看加载顺序，
            但游戏进程暂时不会应用它们。
          </div>
          <PlanWarnings view={ppl} />
          {ppl.plan.order.length > 0 && (
            <div className="load-order">
              <span className="load-order-label">加载顺序</span>
              <ol className="load-order-list">
                {ppl.plan.order.map((id, index) => (
                  <li key={id} title={id}>
                    <span className="load-order-index">{index + 1}</span>
                    {id}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}

      {root && format === "rwml" && rwml && <RwmlNotice view={rwml} />}

      {root &&
        (rows.length === 0 && !loading ? (
          <div className="empty">
            <div>还没有安装任何扩展</div>
            <div style={{ fontSize: 12 }}>
              {format === "ppl" ? (
                <>
                  PPL 扩展是 <code>.pplx</code>，里面带一份 <code>ppl-extension.json</code>
                </>
              ) : (
                <>
                  RWML 扩展是 <code>.jar</code>，里面带 <code>META-INF/extension.properties</code>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="ext-list">
            {rows.map((item) => (
              <ExtensionRow
                key={item.file}
                item={item}
                busy={busy === item.file}
                onToggle={() => void toggle(item)}
                onRemove={() => setRemoveTarget(item)}
              />
            ))}
          </div>
        ))}

      {dir && (
        <p className="ext-foot">
          扩展目录：<code>{dir}</code>
        </p>
      )}

      <Modal
        open={removeTarget !== null}
        title={`删除《${removeTarget ? displayName(removeTarget) : ""}》`}
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
          删掉之后要重新导入才能再用。如果只是想暂时关掉，用右边的开关更合适。
        </p>
      </Modal>
    </>
  );
}

function displayName(item: PplExtension | RwmlExtension): string {
  return "descriptor" in item ? item.descriptor.name : item.name;
}

function itemId(item: PplExtension | RwmlExtension): string {
  return "descriptor" in item ? item.descriptor.id : item.id;
}

function itemDeps(item: PplExtension | RwmlExtension): string[] {
  return "descriptor" in item ? item.descriptor.dependsOn : item.dependsOn;
}

function itemVersion(item: PplExtension | RwmlExtension): string {
  return "descriptor" in item ? item.descriptor.version : "";
}

/** RWML 模式的提示：装没装加载器、停用方式未验证。 */
function RwmlNotice({ view }: { view: RwmlView }) {
  return (
    <div className="ext-warnings">
      {!view.loader.installed && (
        <div className="notice">
          没检测到 RWML 加载器（<code>game-lib.jar.original</code> 或 <code>rwml-runtime</code>）。
          这里可以先把扩展放进目录，但需要你自行安装加载器后才会生效——启动器不会去改写游戏文件。
        </div>
      )}
      {view.loader.installed && !view.loader.runtime && (
        <div className="notice">
          加载器已安装，但没看到 <code>rwml-runtime</code>；首次启动可能需要联网下载运行时。
        </div>
      )}
      <div className="notice">
        兼容模式只做文件管理：读取对方描述符展示，开关是移动文件。
        「停用」把 jar 移进 <code>extensions/.disabled/</code>，这一点尚未实测，
        若发现停用不生效请告诉我。
      </div>
    </div>
  );
}

/** PPL 模式的问题提示：缺依赖、成环、API 不兼容。 */
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
  item: PplExtension | RwmlExtension;
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const version = itemVersion(item);
  const deps = itemDeps(item);
  const description = "descriptor" in item ? item.descriptor.description : "";

  return (
    <div className={`ext-row${item.enabled ? "" : " off"}${item.valid ? "" : " broken"}`}>
      <div className="ext-main">
        <div className="ext-title">
          <span>{displayName(item)}</span>
          {version && <span className="badge">{version}</span>}
          {!item.valid && <span className="badge badge-danger">包已损坏</span>}
          {item.enabled ? null : <span className="badge badge-muted">已停用</span>}
        </div>
        <div className="ext-meta">
          <code>{itemId(item)}</code>
          <span>{formatBytes(item.size)}</span>
          {deps.length > 0 && <span>依赖 {deps.join("、")}</span>}
        </div>
        {description && <p className="ext-desc">{description}</p>}
        {item.problem && <p className="ext-problem">{item.problem}</p>}
      </div>

      <div className="ext-actions">
        <button
          className={`switch${item.enabled ? " on" : ""}`}
          role="switch"
          aria-checked={item.enabled}
          aria-label={`${item.enabled ? "停用" : "启用"} ${displayName(item)}`}
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
