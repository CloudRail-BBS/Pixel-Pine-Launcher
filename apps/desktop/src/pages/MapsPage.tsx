import { PixelCover } from "../components/PixelCover";
import { RefreshIcon } from "../components/Icons";
import { formatBytes } from "../lib/format";
import type { GameMap } from "../lib/types";

interface MapsPageProps {
  maps: GameMap[];
  loading: boolean;
  hasInstance: boolean;
  onRefresh: () => void;
}

export function MapsPage({ maps, loading, hasInstance, onRefresh }: MapsPageProps) {
  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">地图</h1>
          <p className="page-desc">
            {hasInstance ? `${maps.length} 张自定义地图 · 来自 mods/maps` : "先添加游戏目录"}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={onRefresh} disabled={!hasInstance || loading}>
            <RefreshIcon className="nav-icon" />
            重新扫描
          </button>
        </div>
      </header>

      {maps.length === 0 ? (
        <div className="empty">
          <div>{loading ? "正在扫描地图…" : "还没有自定义地图"}</div>
          <div style={{ fontSize: 12 }}>
            把 .tmx 和同名预览图 <code>_map.png</code> 放进 <code>mods/maps</code>
          </div>
        </div>
      ) : (
        <div className="grid">
          {maps.map((map) => (
            <article key={map.name} className="pkg-card">
              <div className="pkg-cover">
                <PixelCover seed={map.name} />
                <div className="pkg-cover-badge">
                  <span className="badge">{map.sizeLabel ?? "未知尺寸"}</span>
                </div>
              </div>
              <div className="pkg-body">
                <div className="pkg-title">{map.name}</div>
                <div className="pkg-foot">
                  <div className="pkg-stat">
                    <span>{formatBytes(map.size)}</span>
                    <span>{map.hasPreview ? "有预览图" : "无预览图"}</span>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
