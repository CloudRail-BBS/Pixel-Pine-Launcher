import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "../lib/api";
import type { GameEntry, GameManifest } from "../lib/api";
import { formatSize } from "../lib/format";

interface GameDownloadsProps {
  onError: (message: string | null) => void;
  onToast: (message: string | null) => void;
}

const PLATFORMS = ["windows", "macos", "linux", "android"] as const;
const PLATFORM_LABEL: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
};

function emptyEntry(): GameEntry {
  return {
    version: "",
    channel: "stable",
    platform: "windows",
    size: 0,
    sha256: "",
    urls: [],
    archive: "zip",
    entry: "Rusted Warfare.exe",
    notes: "",
  };
}

/** 游戏本体下载管理：清单条目的增删改 + 直传压缩包。
 *
 * 清单本身是运营侧数据（版权归属决定能不能分发），所以这里只做「编辑与校验」，
 * 不做任何自动抓取。
 */
export function GameDownloads({ onError, onToast }: GameDownloadsProps) {
  const [manifest, setManifest] = useState<GameManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [editing, setEditing] = useState<{ index: number | null; entry: GameEntry } | null>(null);
  const [urlText, setUrlText] = useState("");

  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [uploadVersion, setUploadVersion] = useState("");
  const [lastUpload, setLastUpload] = useState<api.GameUpload | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      setManifest(await api.gameManifest());
      setDirty(false);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  function openEditor(index: number | null, entry?: GameEntry) {
    const next = entry ?? emptyEntry();
    setEditing({ index, entry: { ...next } });
    setUrlText(next.urls.join("\n"));
  }

  function applyEditor() {
    if (!editing || !manifest) return;
    const entry: GameEntry = {
      ...editing.entry,
      version: editing.entry.version.trim(),
      urls: urlText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      notes: editing.entry.notes.trim(),
      entry: editing.entry.entry.trim() || "Rusted Warfare.exe",
      archive: "zip",
    };

    const versions = [...manifest.versions];
    if (editing.index === null) versions.unshift(entry);
    else versions[editing.index] = entry;

    setManifest({ ...manifest, versions });
    setDirty(true);
    setEditing(null);
  }

  function removeEntry(index: number) {
    if (!manifest) return;
    const versions = manifest.versions.filter((_, position) => position !== index);
    setManifest({ ...manifest, versions });
    setDirty(true);
  }

  async function save() {
    if (!manifest) return;
    setBusy(true);
    onError(null);
    try {
      const result = await api.saveGameManifest(manifest);
      setDirty(false);
      onToast(`清单已保存（${result.versions} 个版本）`);
      window.setTimeout(() => onToast(null), 4000);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setUploadPercent(0);
    onError(null);
    try {
      const result = await api.uploadGameArchive(file, uploadVersion, setUploadPercent);
      setLastUpload(result);
      onToast(`已上传 ${result.fileName}（${formatSize(result.size)}）`);
      window.setTimeout(() => onToast(null), 4000);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      window.setTimeout(() => setUploadPercent(null), 600);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /** 把刚才上传的结果直接变成一条清单条目，省得手抄 sha256。 */
  function entryFromUpload() {
    if (!lastUpload) return;
    openEditor(null, {
      ...emptyEntry(),
      version: uploadVersion.trim(),
      size: lastUpload.size,
      sha256: lastUpload.sha256,
      urls: [lastUpload.url],
    });
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">游戏本体下载</h2>
          <p className="page-desc">
            客户端按平台从这份清单里挑版本下载。<strong>没有授权就不要放安装包</strong>，
            留空清单时客户端会引导去官方商店。
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => void load()} disabled={loading || busy}>
            重新读取
          </button>
          <button
            className={`btn ${dirty ? "btn-primary" : ""}`}
            onClick={() => void save()}
            disabled={busy || !dirty || loading}
          >
            {busy ? "保存中…" : dirty ? "保存清单" : "已保存"}
          </button>
        </div>
      </div>

      <section className="card panel">
        <div className="panel-head">
          <span>上传安装包</span>
          <span className="panel-hint">导出地址与 sha256，直接填进条目</span>
        </div>
        <div className="upload-row">
          <input
            className="field"
            placeholder="版本号，例如 1.15（决定文件名）"
            value={uploadVersion}
            onChange={(event) => setUploadVersion(event.target.value)}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            className="field"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          {uploadPercent !== null && (
            <div className="upload-bar" aria-label="上传进度">
              <div className="upload-bar-fill" style={{ width: `${uploadPercent}%` }} />
              <span className="upload-bar-text">{uploadPercent}%</span>
            </div>
          )}
        </div>
        {lastUpload && (
          <div className="upload-result">
            <div>
              <span className="meta-label">文件</span> {lastUpload.fileName}（
              {formatSize(lastUpload.size)}）
            </div>
            <div className="cell-mono">{lastUpload.url}</div>
            <div className="cell-mono">sha256 {lastUpload.sha256}</div>
            <button className="btn btn-sm" onClick={entryFromUpload}>
              用它新建条目
            </button>
          </div>
        )}
      </section>

      <div className="panel-head" style={{ marginTop: 22 }}>
        <span>清单条目</span>
        <button className="btn btn-sm" onClick={() => openEditor(null)}>
          新增条目
        </button>
      </div>

      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>版本</th>
              <th>平台</th>
              <th>通道</th>
              <th>体积</th>
              <th>入口文件</th>
              <th>下载地址</th>
              <th>sha256</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="table-empty">
                  读取中…
                </td>
              </tr>
            )}
            {!loading && (manifest?.versions.length ?? 0) === 0 && (
              <tr>
                <td colSpan={8} className="table-empty">
                  清单是空的 —— 客户端会显示「去官方商店」
                </td>
              </tr>
            )}
            {!loading &&
              manifest?.versions.map((entry, index) => (
                <tr key={`${entry.platform}-${entry.version}-${index}`}>
                  <td>{entry.version}</td>
                  <td>{PLATFORM_LABEL[entry.platform] ?? entry.platform}</td>
                  <td>{entry.channel || "stable"}</td>
                  <td>{formatSize(entry.size)}</td>
                  <td className="cell-sub">{entry.entry}</td>
                  <td className="cell-sub">
                    {entry.urls.length > 0 ? `${entry.urls.length} 个` : "—"}
                  </td>
                  <td className="cell-mono">
                    {entry.sha256 ? `${entry.sha256.slice(0, 10)}…` : "未填"}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-sm" onClick={() => openEditor(index, entry)}>
                        编辑
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => removeEntry(index)}>
                        移除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <p className="page-hint">
        改动只存在这个页面里，点右上角「保存清单」才写入服务器。客户端拿到的是
        <code> /v1/game/index.json</code>，保存后立刻生效（缓存 60 秒）。
      </p>

      {editing && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal modal-wide">
            <h3 className="modal-title">
              {editing.index === null ? "新增条目" : `编辑 v${editing.entry.version}`}
            </h3>

            <div className="form-grid">
              <label className="form-field">
                <span className="meta-label">版本号</span>
                <input
                  className="field"
                  value={editing.entry.version}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      entry: { ...editing.entry, version: event.target.value },
                    })
                  }
                  placeholder="1.15"
                />
              </label>

              <label className="form-field">
                <span className="meta-label">平台</span>
                <select
                  className="field"
                  value={editing.entry.platform}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      entry: { ...editing.entry, platform: event.target.value },
                    })
                  }
                >
                  {PLATFORMS.map((platform) => (
                    <option key={platform} value={platform}>
                      {PLATFORM_LABEL[platform]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span className="meta-label">通道</span>
                <input
                  className="field"
                  value={editing.entry.channel}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      entry: { ...editing.entry, channel: event.target.value },
                    })
                  }
                  placeholder="stable / beta"
                />
              </label>

              <label className="form-field">
                <span className="meta-label">体积（字节）</span>
                <input
                  className="field"
                  type="number"
                  value={editing.entry.size || 0}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      entry: { ...editing.entry, size: Number(event.target.value) || 0 },
                    })
                  }
                />
              </label>

              <label className="form-field">
                <span className="meta-label">入口文件</span>
                <input
                  className="field"
                  value={editing.entry.entry}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      entry: { ...editing.entry, entry: event.target.value },
                    })
                  }
                  placeholder="Rusted Warfare.exe"
                />
              </label>

              <label className="form-field">
                <span className="meta-label">sha256</span>
                <input
                  className="field"
                  value={editing.entry.sha256}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      entry: { ...editing.entry, sha256: event.target.value },
                    })
                  }
                  placeholder="留空则不校验"
                />
              </label>
            </div>

            <label className="form-field" style={{ marginTop: 12 }}>
              <span className="meta-label">下载地址（一行一个，按顺序尝试）</span>
              <textarea
                value={urlText}
                onChange={(event) => setUrlText(event.target.value)}
                placeholder={"https://cdn.example.com/rw-1.15-win.zip\nhttps://mirror.example.com/rw-1.15-win.zip"}
                style={{ minHeight: 92 }}
              />
            </label>

            <label className="form-field" style={{ marginTop: 12 }}>
              <span className="meta-label">更新说明</span>
              <textarea
                value={editing.entry.notes}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    entry: { ...editing.entry, notes: event.target.value },
                  })
                }
                style={{ minHeight: 72 }}
              />
            </label>

            <div className="modal-actions">
              <button className="btn" onClick={() => setEditing(null)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                disabled={!editing.entry.version.trim()}
                onClick={applyEditor}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
