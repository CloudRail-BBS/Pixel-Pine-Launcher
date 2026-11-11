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
import type {
  ExtensionsView,
  LoadPlan,
  PplExtension,
  RwmlExtension,
  RwmlView,
} from "../lib/types";

/**
 * 扩展页。
 *
 * 两种格式并存，用户自己选，**默认是 PPL 自有的一套**：
 *
 * - `ppl`：`<游戏>/ppl/extensions`，`.pplx` + `ppl-extension.json`
 * - `rwml`：`<游戏>/extensions`，`.jar` + `META-INF/extension.properties`（兼容层）
 *
 * 两套目录互不重叠，所以可以同时存在，不会互相覆盖。
 *
 * 信息层级按「装了什么 → 有没有问题 → 细节」排：读数在最上面，
 * 问题次之（只在有问题时出现），列表最后；每张卡片的描述符细节
 * 收进 <details>，不占默认视野。
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

  const issues = ppl
    ? ppl.plan.missing.length + ppl.plan.cycles.length + ppl.plan.incompatible.length
    : 0;
  const rwmlIssues = rwml
    ? rwml.plan.duplicateIds.length + rwml.plan.missing.length + rwml.plan.sameName.length
    : 0;
  const broken = rows.filter((item) => !item.valid).length;
  const attention = (format === "ppl" ? issues : rwmlIssues) + broken;

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">扩展</h1>
          <p className="page-desc">
            {root
              ? `${rows.length} 个已安装 · ${enabledCount} 个已启用${
                  attention > 0 ? ` · ${attention} 项需要处理` : ""
                }`
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
            启动游戏时会把加载顺序写到 <code>ppl/runtime/plan.json</code>；
            注入（JVM agent）仍未实现，游戏内暂时不会应用它们。
          </div>

          <div className="ext-metrics">
            <div className="ext-metric">
              <span className="ext-metric-num">{rows.length}</span>
              <span className="ext-metric-label">已安装</span>
              <span className="ext-metric-hint">
                {broken > 0 ? `${broken} 个包读不出来` : "全部可读"}
              </span>
            </div>
            <div className="ext-metric">
              <span className="ext-metric-num">{enabledCount}</span>
              <span className="ext-metric-label">已启用</span>
              <span className="ext-metric-hint">
                {ppl.plan.order.length > 0
                  ? `按顺序加载 ${ppl.plan.order.length} 个`
                  : "还没有可加载的扩展"}
              </span>
            </div>
            <div className={`ext-metric${attention > 0 ? " has-issue" : ""}`}>
              <span className="ext-metric-num">{attention}</span>
              <span className="ext-metric-label">需要处理</span>
              <span className="ext-metric-hint">
                {attention > 0 ? "缺依赖、成环或不兼容" : "没有阻塞项"}
              </span>
            </div>
          </div>

          <PlanWarnings view={ppl} />

          <section className="ext-section">
            <div className="ext-section-head">
              <h2>已安装</h2>
              <span className="ext-section-hint">
                停用会把包移到 <code>.disabled/</code>，可随时移回来
              </span>
            </div>

            {rows.length === 0 && !loading ? (
              <div className="empty ext-empty">
                <div className="ext-empty-mark" aria-hidden="true">
                  <PuzzleIcon />
                </div>
                <div className="ext-empty-title">还没有安装扩展</div>
                <p className="ext-empty-desc">
                  PPL 扩展是一个 <code>.pplx</code> 压缩包，里面带一份{" "}
                  <code>ppl-extension.json</code>。开发规范见仓库的{" "}
                  <code>docs/EXTENSIONS.md</code> 与官网文档。
                </p>
                <button className="btn btn-primary btn-sm" onClick={() => void importFromDialog()}>
                  选择 .pplx 文件
                </button>
              </div>
            ) : (
              <div className="ext-cards">
                {rows.map((item) => (
                  <PplCard
                    key={item.file}
                    item={item as PplExtension}
                    plan={ppl.plan}
                    busy={busy === item.file}
                    onToggle={() => void toggle(item)}
                    onRemove={() => setRemoveTarget(item)}
                  />
                ))}
              </div>
            )}
          </section>

          {ppl.plan.order.length > 0 && <LoadOrder view={ppl} />}

          <p className="ext-foot">
            扩展目录：<code>{ppl.dir}</code>
            {!ppl.dirExists && "（还没创建，导入第一个扩展时会自动建）"}
          </p>
        </>
      )}

      {root && format === "rwml" && rwml && (
        <>
          <div className="ext-metrics">
            <div className="ext-metric">
              <span className="ext-metric-num">{rows.length}</span>
              <span className="ext-metric-label">已安装</span>
              <span className="ext-metric-hint">
                {broken > 0 ? `${broken} 个包读不出来` : "全部可读"}
              </span>
            </div>
            <div className="ext-metric">
              <span className="ext-metric-num">{enabledCount}</span>
              <span className="ext-metric-label">已启用</span>
              <span className="ext-metric-hint">
                {rwml.loader.installed ? "加载器已检测到" : "未检测到 RWML 加载器"}
              </span>
            </div>
            <div className={`ext-metric${attention > 0 ? " has-issue" : ""}`}>
              <span className="ext-metric-num">{attention}</span>
              <span className="ext-metric-label">需要处理</span>
              <span className="ext-metric-hint">
                {attention > 0 ? "重复 id、缺依赖或坏包" : "没有阻塞项"}
              </span>
            </div>
          </div>

          <RwmlNotice view={rwml} />

          <section className="ext-section">
            <div className="ext-section-head">
              <h2>已安装</h2>
              <span className="ext-section-hint">兼容模式只做文件管理，加载由 RWML 负责</span>
            </div>

            {rows.length === 0 && !loading ? (
              <div className="empty ext-empty">
                <div className="ext-empty-mark" aria-hidden="true">
                  <PuzzleIcon />
                </div>
                <div className="ext-empty-title">还没有安装 RWML 扩展</div>
                <p className="ext-empty-desc">
                  RWML 扩展是 <code>.jar</code>，描述符在校验 <code>META-INF/extension.properties</code>。
                  建议优先用 PPL 格式；兼容模式只是让已有的 jar 也能在这里管理。
                </p>
                <button className="btn btn-primary btn-sm" onClick={() => void importFromDialog()}>
                  选择 .jar 文件
                </button>
              </div>
            ) : (
              <div className="ext-cards">
                {rows.map((item) => (
                  <RwmlCard
                    key={item.file}
                    item={item as RwmlExtension}
                    view={rwml}
                    busy={busy === item.file}
                    onToggle={() => void toggle(item)}
                    onRemove={() => setRemoveTarget(item)}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {format === "rwml" && dir && (
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

/** PPL 扩展卡片：默认只给一眼能扫的信息，描述符细节收进 <details>。 */
function PplCard({
  item,
  plan,
  busy,
  onToggle,
  onRemove,
}: {
  item: PplExtension;
  plan: LoadPlan;
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { descriptor } = item;
  const issues: string[] = [];
  if (!item.valid) issues.push(item.problem ?? "描述符读不出来");
  if (descriptor.apiVersion > 1) issues.push(`需要运行时 API ${descriptor.apiVersion}`);

  // 把加载计划里的问题归到具体扩展头上：列表里就能看出是哪几个坏了，
  // 不用再去读顶部那段汇总。
  const inCycle = plan.cycles.some((group) => group.includes(descriptor.id));
  const missingDeps = plan.missing
    .filter((entry) => entry.owner === descriptor.id)
    .map((entry) => entry.missing);
  const incompatible = plan.incompatible.includes(descriptor.id);

  const orderHint = [
    descriptor.loadAfter.length > 0 && `在 ${descriptor.loadAfter.join("、")} 之后`,
    descriptor.loadBefore.length > 0 && `在 ${descriptor.loadBefore.join("、")} 之前`,
  ]
    .filter(Boolean)
    .join("；");

  return (
    <article className={`ext-card${item.enabled ? "" : " off"}${item.valid ? "" : " broken"}`}>
      <div className="ext-card-main">
        <div className="ext-card-icon" aria-hidden="true">
          <PuzzleIcon />
        </div>

        <div className="ext-card-body">
          <div className="ext-card-title">
            <span className="ext-name">{descriptor.name || descriptor.id}</span>
            {descriptor.version && <span className="badge">{descriptor.version}</span>}
            {!item.enabled && <span className="badge badge-muted">已停用</span>}
            {!item.valid && <span className="badge badge-danger">包已损坏</span>}
            {inCycle && <span className="badge badge-danger">循环依赖</span>}
            {missingDeps.length > 0 && <span className="badge badge-warn">缺依赖</span>}
            {incompatible && <span className="badge badge-warn">API 过高</span>}
          </div>

          {descriptor.description && <p className="ext-card-desc">{descriptor.description}</p>}

          <div className="ext-chips">
            <code>{descriptor.id}</code>
            <span>{formatBytes(item.size)}</span>
            {descriptor.author && <span>{descriptor.author}</span>}
            {descriptor.dependsOn.length > 0 && (
              <span>依赖 {descriptor.dependsOn.join("、")}</span>
            )}
          </div>

          {issues.map((issue) => (
            <p className="ext-problem" key={issue}>
              {issue}
            </p>
          ))}

          {inCycle && (
            <p className="ext-problem">它和其它扩展互相依赖成环，整组都不会加载。</p>
          )}
          {missingDeps.length > 0 && (
            <p className="ext-problem">
              缺少依赖 {missingDeps.join("、")}，这个扩展会被跳过。
            </p>
          )}

          <details className="ext-details">
            <summary>描述符细节</summary>
            <dl className="ext-detail-grid">
              <dt>文件</dt>
              <dd>
                <code>{item.file}</code>
              </dd>
              <dt>API 版本</dt>
              <dd>{descriptor.apiVersion}</dd>
              <dt>入口类</dt>
              <dd>{descriptor.mainClass ?? "—"}</dd>
              <dt>Mixin</dt>
              <dd>{descriptor.mixins.length > 0 ? descriptor.mixins.join("、") : "—"}</dd>
              <dt>顺序偏好</dt>
              <dd>{orderHint || "—"}</dd>
              <dt>最低游戏版本</dt>
              <dd>{descriptor.minGame ?? "未声明"}</dd>
            </dl>
          </details>
        </div>

        <div className="ext-card-actions">
          <button
            className={`switch${item.enabled ? " on" : ""}`}
            role="switch"
            aria-checked={item.enabled}
            aria-label={`${item.enabled ? "停用" : "启用"} ${descriptor.name || descriptor.id}`}
            disabled={busy || !item.valid}
            onClick={onToggle}
          />
          <button className="btn btn-sm btn-ghost" onClick={onRemove} disabled={busy}>
            删除
          </button>
        </div>
      </div>
    </article>
  );
}

/** 加载顺序：默认折叠，展开后按序号列出，并说明排序依据。 */
function LoadOrder({ view }: { view: ExtensionsView }) {
  return (
    <details className="ext-order">
      <summary>
        <span>加载顺序</span>
        <span className="ext-order-count">{view.plan.order.length} 个</span>
      </summary>
      <ol className="ext-order-list">
        {view.plan.order.map((id, index) => (
          <li key={id} title={id}>
            <span className="ext-order-index">{index + 1}</span>
            <code>{id}</code>
          </li>
        ))}
      </ol>
      <p className="ext-order-note">
        先满足 <code>dependsOn</code> 的硬依赖，再叠加 <code>loadAfter</code> /{" "}
        <code>loadBefore</code>，同层按 id 字典序，保证两台机器上的顺序一致。
      </p>
    </details>
  );
}

/** RWML 模式的提示：装没装加载器、停用方式未验证。 */
function RwmlNotice({ view }: { view: RwmlView }) {
  const { plan } = view;

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

      {plan.duplicateIds.map((entry) => (
        <div className="notice notice-error" key={entry.id}>
          <code>{entry.id}</code> 被 {entry.files.length} 个包同时声明（{entry.files.join("、")}）。
          加载器谁先谁后没有保证，建议只留一个。
        </div>
      ))}

      {plan.missing.length > 0 && (
        <div className="notice">
          {plan.missing.map((entry) => (
            <div key={`${entry.owner}-${entry.missing}`}>
              《{entry.owner}》依赖 <code>{entry.missing}</code>，但目录里没有启用中的同名扩展
            </div>
          ))}
        </div>
      )}

      {plan.sameName.length > 0 && (
        <div className="notice notice-error">
          这些文件同时存在于启用与停用目录，状态不一致：{plan.sameName.join("、")}。
          删掉停用目录里的那一份即可。
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

/** RWML 扩展卡片：字段比 PPL 少，但同样把问题标在卡片上。 */
function RwmlCard({
  item,
  view,
  busy,
  onToggle,
  onRemove,
}: {
  item: RwmlExtension;
  view: RwmlView;
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const duplicate = view.plan.duplicateIds.find(
    (entry) => entry.id === item.id && entry.files.includes(item.file),
  );
  const missingDeps = view.plan.missing
    .filter((entry) => entry.owner === item.id)
    .map((entry) => entry.missing);
  const sameName = view.plan.sameName.includes(item.file);

  return (
    <article className={`ext-card${item.enabled ? "" : " off"}${item.valid ? "" : " broken"}`}>
      <div className="ext-card-main">
        <div className="ext-card-icon" aria-hidden="true">
          <PuzzleIcon />
        </div>

        <div className="ext-card-body">
          <div className="ext-card-title">
            <span className="ext-name">{item.id}</span>
            {item.uiFramework && <span className="badge">{item.uiFramework}</span>}
            {!item.enabled && <span className="badge badge-muted">已停用</span>}
            {!item.valid && <span className="badge badge-danger">包已损坏</span>}
            {duplicate && <span className="badge badge-danger">id 重复</span>}
            {missingDeps.length > 0 && <span className="badge badge-warn">缺依赖</span>}
            {sameName && <span className="badge badge-warn">状态冲突</span>}
          </div>

          <div className="ext-chips">
            <code>{item.file}</code>
            <span>{formatBytes(item.size)}</span>
            {item.mainClass && <span>入口 {item.mainClass}</span>}
            {item.dependsOn.length > 0 && <span>依赖 {item.dependsOn.join("、")}</span>}
          </div>

          {item.problem && <p className="ext-problem">{item.problem}</p>}
          {duplicate && (
            <p className="ext-problem">
              同一个 id 还被 {duplicate.files.filter((file) => file !== item.file).join("、")} 声明。
            </p>
          )}
          {missingDeps.length > 0 && (
            <p className="ext-problem">缺少依赖 {missingDeps.join("、")}。</p>
          )}
          {sameName && <p className="ext-problem">同名文件同时存在于启用与停用目录。</p>}

          <details className="ext-details">
            <summary>描述符细节</summary>
            <dl className="ext-detail-grid">
              <dt>文件</dt>
              <dd>
                <code>{item.file}</code>
              </dd>
              <dt>扩展 id</dt>
              <dd>
                <code>{item.id}</code>
              </dd>
              <dt>入口类</dt>
              <dd>{item.mainClass ?? "—"}</dd>
              <dt>UI 框架</dt>
              <dd>{item.uiFramework ?? "—"}</dd>
              <dt>依赖</dt>
              <dd>{item.dependsOn.length > 0 ? item.dependsOn.join("、") : "—"}</dd>
            </dl>
          </details>
        </div>

        <div className="ext-card-actions">
          <button
            className={`switch${item.enabled ? " on" : ""}`}
            role="switch"
            aria-checked={item.enabled}
            aria-label={`${item.enabled ? "停用" : "启用"} ${item.id}`}
            disabled={busy || !item.valid}
            onClick={onToggle}
          />
          <button className="btn btn-sm btn-ghost" onClick={onRemove} disabled={busy}>
            删除
          </button>
        </div>
      </div>
    </article>
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

