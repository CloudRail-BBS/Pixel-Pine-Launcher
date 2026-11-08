import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AlertIcon, RefreshIcon } from "../components/Icons";
import * as api from "../lib/api";
import type { RelaySnapshot } from "../lib/types";

/** CNKD 中继的房间列表。
 *
 * 数据 4 秒轮询一次——房间状态变化很快，慢了就没意义。
 * 页面切走时停掉，别在后台空转。 */
const RELAY_URL = "http://101.43.41.22:46784/relay/rooms";
const POLL_MS = 4000;

export function NetPage() {
  const [snapshot, setSnapshot] = useState<RelaySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = await api.fetchRelayRooms(RELAY_URL);
      if (!alive.current) return;
      setSnapshot(next);
      setError(null);
      setUpdatedAt(
        new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      );
    } catch (cause) {
      if (!alive.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (alive.current && !quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();

    const timer = window.setInterval(() => {
      // 页面不可见时不轮询，省流量也省对方的服务
      if (document.visibilityState === "visible") void load(true);
    }, POLL_MS);

    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [load]);

  const rooms = useMemo(() => snapshot?.rooms ?? [], [snapshot]);

  async function copyLink(link: string) {
    const url = link.startsWith("http") ? link : `https://${link}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(link);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("复制这个链接加入房间", url);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">联机</h1>
          <p className="page-desc">
            {snapshot ? `${snapshot.nodeName} · ${snapshot.roomCount} 个房间` : "正在连接中继…"}
            {updatedAt && ` · 更新于 ${updatedAt}`}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
            <RefreshIcon className="nav-icon" />
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="market-error" role="alert">
          <div className="market-error-head">
            <AlertIcon className="nav-icon" />
            <span>拿不到房间列表</span>
          </div>
          <p className="market-error-body">{error}</p>
          <button className="btn btn-sm" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : rooms.length === 0 ? (
        <div className="empty">
          <div>{loading ? "正在读取房间…" : "现在没有开着的房间"}</div>
          <div style={{ fontSize: 12 }}>有人建房后会出现在这里，每 4 秒自动刷新</div>
        </div>
      ) : (
        <div className="room-list">
          {rooms.map((room) => {
            const inGame = room.status === "ingame";
            const full = room.activeConnectionSize >= room.playerSize;
            return (
              <article key={room.displayId} className="room-row">
                <div className="room-id">{room.displayId}</div>

                <div className="room-main">
                  <div className="room-head">
                    <span className={`badge ${inGame ? "badge-warn" : "badge-ok"}`}>
                      {inGame ? "游戏中" : "等待中"}
                    </span>
                    {room.isMod && <span className="badge">Mod</span>}
                    <span className="room-people">
                      {room.activeConnectionSize} / {room.playerSize}
                      {full && !inGame && " · 已满"}
                    </span>
                  </div>
                  <div className="room-meta">
                    <span>{room.hostName}</span>
                    <span>·</span>
                    <span className="room-map" title={room.mapName}>
                      {prettyMap(room.mapName)}
                    </span>
                  </div>
                </div>

                <button
                  className="btn btn-sm"
                  onClick={() => void copyLink(room.joinLink)}
                  disabled={inGame}
                  title={inGame ? "已经开局，等这局结束" : "复制加入链接"}
                >
                  {copied === room.joinLink ? "已复制" : "复制加入链接"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

/** 中继给的是 `NEW_PATH|maps2/12p大两岸.tmx`，取文件名就够看了。 */
function prettyMap(raw: string): string {
  const withoutPrefix = raw.includes("|") ? raw.split("|").pop() ?? raw : raw;
  const name = withoutPrefix.split("/").pop() ?? withoutPrefix;
  return name.replace(/\.tmx$/i, "") || "未知地图";
}
