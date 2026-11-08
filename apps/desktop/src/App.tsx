import { useCallback, useEffect, useMemo, useState } from "react";

import { Sidebar, type PageId } from "./components/Sidebar";
import { PixelCover } from "./components/PixelCover";
import { AlertIcon, BoxIcon } from "./components/Icons";
import { useSpring } from "./hooks/useSpring";
import { formatBytes } from "./lib/format";
import * as api from "./lib/api";
import { marketPackages } from "./lib/mock";
import {
  applyTheme,
  readThemeMode,
  saveThemeMode,
  watchSystemTheme,
  type ThemeMode,
} from "./lib/theme";
import { LibraryPage } from "./pages/LibraryPage";
import { MapsPage } from "./pages/MapsPage";
import { MarketPage } from "./pages/MarketPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { GameMap, Instance, Loadout, LocalMod } from "./lib/types";

const APP_VERSION = "0.1.0";

export default function App() {
  const [page, setPage] = useState<PageId>("library");
  const [demo, setDemo] = useState(false);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [loadouts, setLoadouts] = useState<Loadout[]>([]);
  const [activeLoadout, setActiveLoadout] = useState("vanilla");
  const [mods, setMods] = useState<LocalMod[]>([]);
  const [maps, setMaps] = useState<GameMap[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => readThemeMode());
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">(
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
  );

  useEffect(() => {
    setResolvedTheme(applyTheme(theme));
    if (theme !== "system") return;
    return watchSystemTheme(() => setResolvedTheme(applyTheme("system")));
  }, [theme]);

  const changeTheme = useCallback((mode: ThemeMode) => {
    setTheme(mode);
    setResolvedTheme(saveThemeMode(mode));
  }, []);

  const instance = useMemo(
    () => instances.find((item) => item.id === instanceId) ?? null,
    [instances, instanceId],
  );

  const selectedMod = useMemo(
    () => mods.find((mod) => mod.id === selectedId) ?? null,
    [mods, selectedId],
  );

  const [lastMod, setLastMod] = useState<LocalMod | null>(null);
  useEffect(() => {
    if (selectedMod) setLastMod(selectedMod);
  }, [selectedMod]);

  const progress = useSpring(selectedMod ? 1 : 0, { stiffness: 320, damping: 30 });
  const shownMod = selectedMod ?? lastMod;

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  const reloadMods = useCallback(async (target: Instance) => {
    if (api.isTauri()) {
      const result = await api.scanMods(target.root);
      setMods(result.mods);
    }
  }, []);

  const loadMaps = useCallback(async () => {
    if (!instance) return;
    setLoadingMaps(true);
    try {
      setMaps(await api.scanMaps(instance.root));
    } catch (error) {
      notify(String(error));
    } finally {
      setLoadingMaps(false);
    }
  }, [instance, notify]);

  const importFiles = useCallback(
    async (files: string[]) => {
      if (!instance) return;
      setTask(`正在导入 ${files.length} 个资源…`);
      let ok = 0;
      let detached = false;
      let firstError: string | null = null;
      for (const file of files) {
        try {
          const result = await api.importPackage(instance.root, activeLoadout, file);
          ok += 1;
          if (!result.attached) detached = true;
        } catch (error) {
          firstError ??= String(error);
        }
      }
      try {
        await reloadMods(instance);
      } catch {
        // 扫描失败不影响导入结果本身
      }
      setTask(null);
      if (ok > 0) notify(`已导入 ${ok} 个资源`);
      if (detached) {
        notify("已导入，但 mods/units 是你自己的文件夹，PPL 没有接管；先备份再切预设");
      }
      if (firstError) notify(firstError);
    },
    [instance, activeLoadout, reloadMods, notify],
  );

  // 拖拽导入：拖放事件在 webview 层，浏览器预览里没有
  useEffect(() => {
    if (!api.isTauri()) return;
    let dispose: (() => void) | undefined;
    void (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      dispose = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragging(true);
          return;
        }
        if (payload.type === "drop") {
          setDragging(false);
          const files = payload.paths.filter((path) => /\.(rwmod|zip)$/i.test(path));
          if (files.length === 0) {
            notify("只认识 .rwmod 或 .zip 文件");
            return;
          }
          void importFiles(files);
          return;
        }
        setDragging(false);
      });
    })();
    return () => dispose?.();
  }, [importFiles, notify]);

  // 进入地图页时才扫描：这个目录通常比 Mod 大，没必要开机就全读一遍
  useEffect(() => {
    if (page === "maps" && instance && maps.length === 0) {
      void loadMaps();
    }
  }, [page, instance, maps.length, loadMaps]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setTask("正在读取游戏目录…");
      try {
        const workspace = await api.loadWorkspace();
        if (cancelled) return;
        setDemo(workspace.demo);
        setInstances(workspace.instances);
        setLoadouts(workspace.loadouts);
        setMods(workspace.mods);

        const first = workspace.instances[0];
        if (first) {
          setInstanceId(first.id);
          setActiveLoadout(first.activeLoadout ?? workspace.loadouts[0]?.id ?? "vanilla");
        } else {
          setActiveLoadout(workspace.loadouts[0]?.id ?? "vanilla");
        }
      } catch (error) {
        if (!cancelled) notify(String(error));
      } finally {
        if (!cancelled) setTask(null);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [notify]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function refresh() {
    if (!instance || task) return;
    setTask("正在扫描 Mod 目录…");
    try {
      await reloadMods(instance);
    } catch (error) {
      notify(String(error));
    } finally {
      setTask(null);
    }
  }

  async function toggleMod(id: string) {
    const target = mods.find((mod) => mod.id === id);
    if (!target) return;

    // 先改界面再落盘：开关必须有即时反馈
    setMods((current) =>
      current.map((mod) => (mod.id === id ? { ...mod, enabled: !mod.enabled } : mod)),
    );

    if (!instance || demo) return;
    try {
      await api.setModEnabled(instance.root, target.name, !target.enabled);
    } catch (error) {
      // 失败就回滚，不能让界面骗人
      setMods((current) =>
        current.map((mod) => (mod.id === id ? { ...mod, enabled: target.enabled } : mod)),
      );
      notify(String(error));
    }
  }

  async function switchLoadout(id: string) {
    if (id === "__new__") {
      const name = window.prompt("新预设的名称");
      if (!name) return;
      const nextId = `loadout-${Date.now().toString(36)}`;
      try {
        const created = await api.createLoadout(nextId, name);
        setLoadouts((current) => [...current, created]);
        setActiveLoadout(created.id);
      } catch (error) {
        notify(String(error));
      }
      return;
    }

    setActiveLoadout(id);
    if (!instance || demo) return;
    try {
      await api.attachLoadout(instance.root, id);
      await reloadMods(instance);
    } catch (error) {
      notify(String(error));
    }
  }

  async function launch() {
    if (!instance) return;
    if (demo) {
      notify("演示模式：接上 Tauri 后这里会真的启动游戏");
      return;
    }
    try {
      await api.launchGame(instance.root);
    } catch (error) {
      notify(String(error));
    }
  }

  async function browseForGame() {
    try {
      const picked = await api.pickDirectory();
      if (picked) await addInstance(picked);
    } catch (error) {
      notify(String(error));
    }
  }

  async function addInstance(root: string) {
    try {
      const created = await api.addInstance(root);
      setInstances([created]);
      setInstanceId(created.id);
      setTask("正在扫描 Mod 目录…");
      await reloadMods(created);
    } catch (error) {
      notify(String(error));
    } finally {
      setTask(null);
    }
  }

  return (
    <>
      <div className="ambient" aria-hidden="true" />
      <div className="app">
        <Sidebar
          page={page}
          onNavigate={setPage}
          instance={instance ?? { id: "", name: "未添加游戏", root: "", source: "manual", version: null, activeLoadout: null }}
          modCount={mods.length}
        />

        <main className="main">
          <div className="main-scroll">
            {page === "library" && (
              <LibraryPage
                instance={instance}
                loadouts={loadouts}
                activeLoadout={activeLoadout}
                mods={mods}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onToggle={toggleMod}
                onSelectLoadout={switchLoadout}
                onRefresh={refresh}
                onLaunch={launch}
                onAddInstance={addInstance}
                onBrowse={() => void browseForGame()}
              />
            )}

            {page === "market" && <MarketPage packages={marketPackages} onInstall={() => {}} />}

            {page === "mods" && (
              <PlaceholderPage title="Mod" description="导入、批量管理与冲突排查" />
            )}
            {page === "maps" && (
              <MapsPage
                maps={maps}
                loading={loadingMaps}
                hasInstance={instance !== null}
                onRefresh={() => void loadMaps()}
              />
            )}
            {page === "net" && <PlaceholderPage title="联机" description="CNKD 房间列表与直连地址簿" />}
            {page === "settings" && (
              <SettingsPage
                version={APP_VERSION}
                demo={demo}
                theme={theme}
                resolvedTheme={resolvedTheme}
                onThemeChange={changeTheme}
              />
            )}
          </div>

          {shownMod && progress > 0.004 && (
            <aside
              className="inspector"
              style={{
                transform: `translateX(${(1 - progress) * 100}%)`,
                opacity: progress,
                pointerEvents: progress > 0.6 ? "auto" : "none",
              }}
              aria-hidden={!selectedMod}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="badge">{shownMod.packaged ? ".rwmod" : "文件夹"}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => setSelectedId(null)}>
                  关闭
                </button>
              </div>

              <div style={{ marginTop: 16, height: 150, borderRadius: "var(--r-md)", overflow: "hidden" }}>
                <PixelCover seed={shownMod.id} />
              </div>

              <h3>{shownMod.title}</h3>
              <p style={{ margin: "2px 0 16px", fontSize: 12, color: "var(--text-3)" }}>{shownMod.name}</p>

              <div className="kv">
                <span>单位数量</span>
                <span>{shownMod.unitCount || "—"}</span>
              </div>
              <div className="kv">
                <span>体积</span>
                <span>{formatBytes(shownMod.size)}</span>
              </div>
              <div className="kv">
                <span>最低版本</span>
                <span>{shownMod.minVersion ?? "未声明"}</span>
              </div>
              <div className="kv">
                <span>状态</span>
                <span>{shownMod.enabled ? "已启用" : "已禁用"}</span>
              </div>

              {shownMod.conflictWith && (
                <div
                  style={{
                    marginTop: 18,
                    padding: "10px 12px",
                    borderRadius: "var(--r-md)",
                    background: "var(--warn-soft)",
                    color: "var(--warn)",
                    fontSize: 12,
                    display: "flex",
                    gap: 8,
                    lineHeight: 1.6,
                  }}
                >
                  <AlertIcon className="nav-icon" />
                  <span>与「{shownMod.conflictWith}」存在同名单位目录，后加载的会覆盖先加载的。</span>
                </div>
              )}
            </aside>
          )}

          {task && (
            <div className="task-dock" role="status">
              <i className="spinner" />
              {task}
            </div>
          )}

          {dragging && (
            <div className="drop-overlay" role="status">
              <div className="drop-card">
                <BoxIcon className="drop-icon" />
                <div className="drop-title">松手导入</div>
                <div className="drop-hint">
                  只处理 .rwmod / .zip，落盘前会先做安全校验
                </div>
              </div>
            </div>
          )}

          {toast && (
            <div className="toast" role="alert">
              <AlertIcon className="nav-icon" />
              {toast}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
