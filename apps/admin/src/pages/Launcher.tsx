import { useCallback, useEffect, useState } from "react";

import * as api from "../lib/api";

interface LauncherProps {
  onError: (message: string | null) => void;
  onToast: (message: string | null) => void;
}

interface PlatformEntry {
  signature?: string;
  url?: string;
}

interface Manifest {
  version?: string;
  notes?: string;
  pub_date?: string;
  platforms?: Record<string, PlatformEntry>;
}

/** 启动器更新：看当前清单、必要时手工推一份。
 *
 * 正常情况下不需要来这里 —— 发版流水线会把 latest.json 自动推上来。
 * 这个页面的用处是：发版失败时补推、或者临时改一条下载地址。
 */
export function Launcher({ onError, onToast }: LauncherProps) {
  const [current, setCurrent] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      const value = (await api.launcherManifest()) as Manifest | null;
      setCurrent(value);
    } catch (cause) {
      // 404/204 都表示「还没有清单」，不算错误
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!message.includes("204") && !message.includes("404")) onError(message);
      setCurrent(null);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function push() {
    setBusy(true);
    onError(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("这段文本不是合法 JSON");
      }
      const result = await api.pushLauncherManifest(parsed);
      onToast(`清单已推送：v${result.version}`);
      window.setTimeout(() => onToast(null), 4000);
      await load();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const platforms = Object.entries(current?.platforms ?? {});

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">启动器更新</h2>
          <p className="page-desc">
            客户端启动时会读这份清单判断要不要更新。发版流水线会自动推送；
            这里用于补推或临时改地址。
          </p>
        </div>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? "读取中…" : "重新读取"}
        </button>
      </div>

      <div className="cards cards-3">
        <div className="card metric" style={{ cursor: "default" }}>
          <span className="metric-num">{current?.version ?? "—"}</span>
          <span className="metric-label">当前版本</span>
          <span className="metric-hint">
            {current?.pub_date ? new Date(current.pub_date).toLocaleString("zh-CN") : "未推送过清单"}
          </span>
        </div>
        <div className="card metric" style={{ cursor: "default" }}>
          <span className="metric-num">{platforms.length}</span>
          <span className="metric-label">平台条目</span>
          <span className="metric-hint">少一个平台 = 那个平台收不到更新</span>
        </div>
        <div className="card metric" style={{ cursor: "default" }}>
          <span className="metric-num">{current ? "OK" : "空"}</span>
          <span className="metric-label">清单状态</span>
          <span className="metric-hint">
            {current ? "客户端能读到" : "返回 204，客户端当作「暂无更新」"}
          </span>
        </div>
      </div>

      {platforms.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>平台</th>
                <th>更新包地址</th>
                <th>签名</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map(([platform, entry]) => (
                <tr key={platform}>
                  <td>{platform}</td>
                  <td className="cell-mono cell-break">{entry.url ?? "—"}</td>
                  <td className="cell-sub">{entry.signature ? "已签名" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="card panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <span>手工推送</span>
          <button
            className="btn btn-sm"
            onClick={() => setText(JSON.stringify(current ?? { version: "", platforms: {} }, null, 2))}
            disabled={!current}
          >
            填入当前清单
          </button>
        </div>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder='把 Release 里的 latest.json 内容粘进来，例如 {"version":"0.1.3","platforms":{...}}'
          style={{ minHeight: 220, marginTop: 10 }}
        />
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <span className="panel-hint">
            服务端会校验 version 与 platforms，通过后原子写入
          </span>
          <button className="btn btn-primary" onClick={() => void push()} disabled={busy || !text.trim()}>
            {busy ? "推送中…" : "推送清单"}
          </button>
        </div>
      </section>

      <p className="page-hint">
        客户端拿的是 <code>/v1/launcher/latest.json</code>，推送后立刻生效（缓存 60 秒）。
        发版时这一步由 GitHub Actions 完成，需要仓库里配好
        <code> PPL_ADMIN_EMAIL</code> 与 <code>PPL_ADMIN_PASSWORD</code>。
      </p>
    </div>
  );
}
