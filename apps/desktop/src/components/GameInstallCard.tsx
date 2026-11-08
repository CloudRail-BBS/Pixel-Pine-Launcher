import { useCallback, useEffect, useRef, useState } from "react";

import { DownloadIcon } from "./Icons";
import {
  STORE_URL,
  fetchCatalog,
  formatSize,
  installGame,
  onGameProgress,
  openExternal,
  suggestedTarget,
  type GameCatalog,
  type GameVersion,
} from "../lib/game";

interface GameInstallCardProps {
  /** 装好之后把路径交回上层，由上层登记成实例 */
  onInstalled: (root: string) => void;
  /** 手动指定已有目录的入口 */
  onBrowse: () => void;
}

/**
 * 「没有游戏」时的主操作区。
 *
 * 两条路并列摆出来，而不是只给一个下载按钮：
 * 大部分人电脑里其实已经装了游戏，只是 PPL 没找到目录。
 * 把「我有」放在前面，比默认假设「你没有」礼貌。
 */
export function GameInstallCard({ onInstalled, onBrowse }: GameInstallCardProps) {
  const [catalog, setCatalog] = useState<GameCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCatalog();
      if (alive.current) setCatalog(result);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 清单按版本号从新到旧排，但 beta 可能比 stable 更新——
  // 首屏主推稳定版，beta 留给用户自己选。
  const latest: GameVersion | undefined =
    catalog?.versions.find((item) => item.channel === "stable") ?? catalog?.versions[0];

  async function start() {
    if (!latest) return;
    setBusy(true);
    setPercent(0);
    setError(null);
    setNote("正在准备下载…");

    const unsubscribe = await onGameProgress((progress) => {
      if (!alive.current) return;
      if (progress.total > 0) {
        setPercent(Math.min(99, Math.round((progress.downloaded / progress.total) * 100)));
      }
    });

    try {
      const target = await suggestedTarget();
      setNote("正在下载…");
      const result = await installGame(latest, target, (message) => {
        if (alive.current) setNote(message);
      });
      if (!alive.current) return;
      setPercent(100);
      setDone(true);
      setNote(`已安装 ${result.files} 个文件，共 ${formatSize(result.bytes)}`);
      onInstalled(result.root);
    } catch (cause) {
      if (alive.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setNote(null);
      }
    } finally {
      unsubscribe();
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="setup-grid">
      <section className="setup-card">
        <div className="setup-head">
          <div className="setup-icon" aria-hidden="true">
            <DownloadIcon />
          </div>
          <div>
            <h2 className="setup-title">下载游戏本体</h2>
            <p className="setup-desc">装到 PPL 的目录里，不碰你的 Steam 版本。</p>
          </div>
        </div>

        {loading && <div className="setup-line skeleton-line" />}

        {!loading && error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}

        {!loading && !error && !latest && (
          <div className="setup-empty">
            <p>当前清单里没有可下载的版本。</p>
            <p className="setup-hint">
              《铁锈战争》是买断制游戏，PPL 只在获得分发授权时才提供直装；
              没有授权时请走官方渠道购买。
            </p>
            <button className="btn btn-sm" onClick={() => void openExternal(STORE_URL)}>
              打开官方商店
            </button>
          </div>
        )}

        {latest && (
          <>
            <dl className="setup-meta">
              <div>
                <dt>版本</dt>
                <dd>v{latest.version}</dd>
              </div>
              <div>
                <dt>通道</dt>
                <dd>{latest.channel === "stable" ? "稳定版" : latest.channel}</dd>
              </div>
              <div>
                <dt>体积</dt>
                <dd>{formatSize(latest.size)}</dd>
              </div>
            </dl>

            {latest.notes && <p className="setup-notes">{latest.notes}</p>}

            {busy && (
              <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              </div>
            )}

            {note && !error && <div className="setup-hint">{note}</div>}

            <button
              className="btn btn-primary"
              onClick={() => void start()}
              disabled={busy || done}
            >
              {done ? "已安装" : busy ? `下载中 ${percent}%` : "下载并安装"}
            </button>
          </>
        )}

        {catalog && catalog.versions.length > 0 && (
          <button className="setup-refresh" onClick={() => void load()} disabled={busy}>
            刷新版本清单
          </button>
        )}
      </section>

      <section className="setup-card setup-card-quiet">
        <div className="setup-head">
          <div className="setup-icon setup-icon-quiet" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </div>
          <div>
            <h2 className="setup-title">我已经装了</h2>
            <p className="setup-desc">选一下游戏目录，PPL 只读它，不改动文件。</p>
          </div>
        </div>
        <p className="setup-hint">
          目录里应该有 <code>Rusted Warfare.exe</code>，下面带一个 <code>mods</code> 文件夹。
        </p>
        <button className="btn" onClick={onBrowse}>
          选择游戏目录
        </button>
      </section>
    </div>
  );
}
