import { useEffect, useState } from "react";

import { Modal } from "./Modal";
import { applyUpdate, checkUpdate, restart, type UpdateInfo } from "../lib/updater";

/**
 * 自更新的提示与安装。
 *
 * 默认什么都不显示：查到更新才浮出一块小卡片。
 * 不弹系统级对话框——启动器最烦人的行为就是每次开机拦你一下。
 */
export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 启动后等一会儿再查：别和首屏的数据加载抢带宽
    const timer = window.setTimeout(() => {
      void checkUpdate().then((result) => {
        if (result) setInfo(result);
      });
    }, 4000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!info) return null;

  async function install() {
    setBusy(true);
    setError(null);
    setPercent(0);
    try {
      await applyUpdate(setPercent);
      setReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!dismissed && !open && (
        <div className="update-toast" role="status">
          <div className="update-toast-text">
            <strong>新版本 v{info.version}</strong>
            <span>已就绪，重启后生效</span>
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
            更新
          </button>
          <button
            className="update-toast-close"
            onClick={() => setDismissed(true)}
            aria-label="稍后提醒"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}

      <Modal
        open={open}
        title={`更新到 v${info.version}`}
        description={info.date ? `发布于 ${info.date}` : undefined}
        onClose={() => setOpen(false)}
        dismissable={!busy}
        footer={
          ready ? (
            <button className="btn btn-primary" onClick={() => void restart()}>
              立即重启
            </button>
          ) : (
            <>
              <button className="btn" onClick={() => setOpen(false)} disabled={busy}>
                稍后
              </button>
              <button className="btn btn-primary" onClick={() => void install()} disabled={busy}>
                {busy ? `下载中 ${percent}%` : "下载并安装"}
              </button>
            </>
          )
        }
      >
        {info.notes ? (
          <div className="update-notes">{info.notes}</div>
        ) : (
          <p className="modal-desc" style={{ margin: 0 }}>
            这个版本没有附带更新说明。
          </p>
        )}

        {busy && (
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

        {ready && (
          <div className="notice notice-ok" style={{ marginTop: 14 }}>
            安装完成，重启后就是新版本。
          </div>
        )}
        {error && (
          <div className="notice notice-error" style={{ marginTop: 14 }} role="alert">
            {error}
          </div>
        )}
      </Modal>
    </>
  );
}
