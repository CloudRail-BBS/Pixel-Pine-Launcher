import { useState } from "react";

import { AnnouncementBar } from "../components/AnnouncementBar";
import { PixelCover } from "../components/PixelCover";
import { PineMark, PlayIcon, PlusIcon, RefreshIcon } from "../components/Icons";
import { formatBytes } from "../lib/format";
import type { Instance, Loadout, LocalMod } from "../lib/types";

interface LibraryPageProps {
  instance: Instance | null;
  loadouts: Loadout[];
  activeLoadout: string;
  mods: LocalMod[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onToggle: (id: string) => void;
  onSelectLoadout: (id: string) => void;
  onRefresh: () => void;
  onLaunch: () => void;
  onAddInstance: (root: string) => void;
  onBrowse: () => void;
  /** 打开「获取游戏」弹窗 */
  onAcquire: () => void;
}

export function LibraryPage({
  instance,
  loadouts,
  activeLoadout,
  mods,
  selectedId,
  onSelect,
  onToggle,
  onSelectLoadout,
  onRefresh,
  onLaunch,
  onAddInstance,
  onBrowse,
  onAcquire,
}: LibraryPageProps) {
  const [path, setPath] = useState("");
  const enabledCount = mods.filter((mod) => mod.enabled).length;
  const current = loadouts.find((loadout) => loadout.id === activeLoadout);

  if (!instance) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1 className="page-title">库</h1>
            <p className="page-desc">还没找到《铁锈战争》，下载一份或者指给我你已经装在哪</p>
          </div>
        </header>

        <AnnouncementBar />

        <div className="gate">
          <div className="gate-icon" aria-hidden="true">
            <PineMark />
          </div>
          <h2 className="gate-title">先找到游戏</h2>
          <p className="gate-desc">
            启动器需要知道《铁锈战争》装在哪，才能管理 Mod、地图和扩展。
            已经装过就选目录；没有的话可以现在下载一份。
          </p>
          <div className="gate-actions">
            <button className="btn btn-primary" onClick={onAcquire}>
              获取游戏
            </button>
            <button className="btn" onClick={onBrowse}>
              选择已有目录
            </button>
          </div>
          <p className="gate-hint">
            装到 PPL 自己的目录，不碰 Steam；已有目录只读不改。
          </p>
        </div>

        <details className="path-fallback">
          <summary>手动输入路径</summary>
          <label className="search" style={{ marginTop: 10 }}>
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="D:////Steam////steamapps////common////Rusted Warfare"
              aria-label="游戏根目录"
            />
          </label>
          <button
            className="btn btn-sm"
            style={{ marginTop: 8 }}
            disabled={path.trim().length === 0}
            onClick={() => onAddInstance(path.trim())}
          >
            使用这个路径
          </button>
        </details>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">库</h1>
          <p className="page-desc">
            {current ? `当前预设：${current.name}` : "未选择预设"} · {enabledCount} / {mods.length} 个
            Mod 已启用
          </p>
        </div>
        <div className="head-actions">
          <button className="btn btn-sm btn-ghost" onClick={onAcquire}>
            获取游戏
          </button>
          <button className="btn" onClick={onRefresh}>
            <RefreshIcon className="nav-icon" />
            重新扫描
          </button>
          <button className="btn btn-primary" onClick={onLaunch}>
            <PlayIcon className="nav-icon" />
            启动游戏
          </button>
        </div>
      </header>

      <AnnouncementBar />

      <section className="section">
        <div className="section-title">游戏实例</div>
        <div className="instance-card">
          <div className="instance-icon">
            {/* 用游戏官方图标，玩家一眼能认出这是哪款游戏 */}
            <img src="/game-rw.png" alt="" width={44} height={44} />
          </div>
          <div className="instance-meta">
            <h3>
              {instance.name}
              {instance.version && (
                <span className="badge badge-accent" style={{ marginLeft: 8 }}>
                  {instance.version}
                </span>
              )}
            </h3>
            <p>{instance.root}</p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <span className="badge">
              {instance.source === "steam" ? "Steam" : instance.source === "portable" ? "免安装" : "手动"}
            </span>
            <button className="btn btn-sm" onClick={onBrowse}>
              更换目录
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-title">作战预设</div>
        <div className="loadout-bar">
          {loadouts.map((loadout) => (
            <button
              key={loadout.id}
              className={`chip${loadout.id === activeLoadout ? " active" : ""}`}
              onClick={() => onSelectLoadout(loadout.id)}
            >
              {loadout.name}
            </button>
          ))}
          <button className="chip" aria-label="新建预设" onClick={() => onSelectLoadout("__new__")}>
            <PlusIcon className="nav-icon" />
          </button>
        </div>
      </section>

      <section className="section">
        <div className="section-title">已安装 Mod</div>
        {mods.length === 0 ? (
          <div className="empty">
            <div>这个目录里还没有 Mod</div>
            <div style={{ fontSize: 12 }}>去市场挑几个，或直接把 .rwmod 拖进 mods/units</div>
          </div>
        ) : (
          <div className="mod-list">
            {mods.map((mod) => (
              <div
                key={mod.id}
                role="button"
                tabIndex={0}
                className={[
                  "mod-row",
                  mod.id === selectedId ? "selected" : "",
                  mod.enabled ? "" : "disabled",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelect(mod.id === selectedId ? null : mod.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(mod.id === selectedId ? null : mod.id);
                  }
                }}
              >
                <div className="mod-cover">
                  <PixelCover seed={mod.id} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="mod-title">{mod.title}</div>
                  <div className="mod-sub">
                    <span>{mod.unitCount > 0 ? `${mod.unitCount} 个单位` : "资源包"}</span>
                    <span>{formatBytes(mod.size)}</span>
                    <span>{mod.packaged ? ".rwmod" : "文件夹"}</span>
                  </div>
                </div>
                {mod.conflictWith ? (
                  <span className="badge badge-warn">与「{mod.conflictWith}」冲突</span>
                ) : (
                  <span className="badge">{mod.minVersion ?? "—"}</span>
                )}
                <span
                  className={`switch${mod.enabled ? " on" : ""}`}
                  role="switch"
                  aria-checked={mod.enabled}
                  aria-label={`启用 ${mod.title}`}
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggle(mod.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onToggle(mod.id);
                    }
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
