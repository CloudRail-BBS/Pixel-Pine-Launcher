import { useCallback, useEffect, useRef, useState } from "react";

import { Modal } from "./Modal";
import {
  STORE_URL,
  fetchCatalog,
  formatSize,
  installFromArchive,
  installGame,
  onGameProgress,
  openExternal,
  pickArchive,
  suggestedTarget,
  type GameCatalog,
  type GameVersion,
} from "../lib/game";

type Mode = "online" | "local";

interface GameAcquireDialogProps {
  open: boolean;
  /** 已选中的版本号，用来提示「这个版本已经装了」 */
  installedVersion?: string | null;
  onClose: () => void;
  onInstalled: (root: string) => void;
}

/**
 * 获取游戏本体的弹窗。
 *
 * 三条路并列：在线下载、本地安装包、官方商店。
 * 之所以做成本地也能装：清单往往拿不到分发授权（法律问题），
 * 但用户自己手上有安装包时，凭什么不让他用启动器装。
 */
export function GameAcquireDialog({
  open,
  installedVersion,
  onClose,
  onInstalled,
}: GameAcquireDialogProps) {
  const [mode, setMode] = useState<Mode>("online");
  const [catalog, setCatalog] = useState<GameCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [localPath, setLocalPath] = useState<string | null>(null);

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
    if (!open) return;
    setError(null);
    setNote(null);
    setPercent(0);
    setBusy(false);
    void load();
  }, [open, load]);

  const latest: GameVersion | undefined =
    catalog?.versions.find((item) => item.channel === "stable") ?? catalog?.versions[0];

  async function startOnline() {
    if (!latest) return;
    setBusy(true);
    setPercent(0);
    setError(null);
    setNote("正在准备下载…");

    const stop = await onGameProgress((progress) => {
      if (alive.current && progress.total > 0) {
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
      onInstalled(result.root);
      onClose();
    } catch (cause) {
      if (alive.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setNote(null);
      }
    } finally {
      stop();
      if (alive.current) setBusy(false);
    }
  }

  async function startLocal() {
    if (!localPath) return;
    setBusy(true);
    setError(null);
    setNote("正在解压…");
    try {
      const target = await suggestedTarget();
      const result = await installFromArchive(localPath, target);
      if (!alive.current) return;
      onInstalled(result.root);
      onClose();
    } catch (cause) {
      if (alive.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setNote(null);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="获取《铁锈战争》"
      description="装到 PPL 自己的目录里，不会动你的 Steam 版本。"
      onClose={onClose}
      dismissable={!busy}
      width={520}
      footer={
        <>
          <button className="btn" onClick={() => void openExternal(STORE_URL)} disabled={busy}>
            官方商店
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void (mode === "online" ? startOnline() : startLocal())}
            disabled={busy || (mode === "online" ? !latest : !localPath)}
          >
            {busy
              ? mode === "online"
                ? `下载中 ${percent}%`
                : "安装中…"
              : mode === "online"
                ? "下载并安装"
                : "从安装包安装"}
          </button>
        </>
      }
    >
      <div className="tabs mode-tabs" role="tablist" aria-label="获取方式">
        <button
          role="tab"
          aria-selected={mode === "online"}
          className={`tab${mode === "online" ? " active" : ""}`}
          onClick={() => setMode("online")}
          disabled={busy}
        >
          在线下载
        </button>
        <button
          role="tab"
          aria-selected={mode === "local"}
          className={`tab${mode === "local" ? " active" : ""}`}
          onClick={() => setMode("local")}
          disabled={busy}
        >
          本地安装包
        </button>
      </div>

      {mode === "online" ? (
        <div className="acquire-body">
          {loading && <div className="setup-line skeleton-line" />}

          {!loading && !error && !latest && (
            <div className="setup-empty">
              <p>当前清单里没有可下载的版本。</p>
              <p className="setup-hint">
                《铁锈战争》是买断制游戏，只有拿到分发授权才会提供直装。
                没有授权时请走官方商店，或者用右边「本地安装包」装你已有的包。
              </p>
            </div>
          )}

          {latest && (
            <dl className="setup-meta">
              <div>
                <dt>版本</dt>
                <dd>
                  v{latest.version}
                  {installedVersion === latest.version && (
                    <span className="badge" style={{ marginLeft: 8 }}>
                      已安装
                    </span>
                  )}
                </dd>
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
          )}

          {latest?.notes && <p className="setup-notes">{latest.notes}</p>}
        </div>
      ) : (
        <div className="acquire-body">
          <p className="modal-desc" style={{ margin: "0 0 10px" }}>
            选一个含游戏可执行文件的 zip（Windows 是 <code>Rusted Warfare.exe</code>，
            macOS / Linux 是同名可执行文件或 <code>.app</code> 包）。
            解压前会检查路径穿越与符号链接。
          </p>
          <div className="acquire-pick">
            <button
              className="btn btn-sm"
              onClick={() => void pickArchive().then((path) => path && setLocalPath(path))}
              disabled={busy}
            >
              选择文件…
            </button>
            <span className="acquire-path">
              {localPath ? localPath.split(/[\\/]/).pop() : "还没有选择文件"}
            </span>
          </div>
          <p className="setup-hint">
            安装到 PPL 的数据目录，目标目录已有文件时会拒绝覆盖——不会动你正在玩的存档。
          </p>
        </div>
      )}

      {busy && mode === "online" && (
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{ marginTop: 14 }}
        >
          <div className="progress-fill" style={{ width: `${percent}%` }} />
        </div>
      )}

      {note && !error && <div className="setup-hint" style={{ marginTop: 10 }}>{note}</div>}
      {error && (
        <div className="notice notice-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
