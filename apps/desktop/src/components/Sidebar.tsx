import type { ReactElement } from "react";

import type { Instance } from "../lib/types";
import {
  GlobeIcon,
  LibraryIcon,
  MapIcon,
  PuzzleIcon,
  SettingsIcon,
  StoreIcon,
  UploadIcon,
} from "./Icons";

export type PageId =
  | "library"
  | "market"
  | "extensions"
  | "maps"
  | "net"
  | "publish"
  | "settings";

interface NavItem {
  id: PageId;
  label: string;
  icon: (props: { className?: string }) => ReactElement;
}

const PRIMARY_NAV: NavItem[] = [
  { id: "library", label: "库", icon: LibraryIcon },
  { id: "market", label: "市场", icon: StoreIcon },
];

const SECONDARY_NAV: NavItem[] = [
  // Mod 已经在「库」里按预设管理，这一格留给加载器扩展
  { id: "extensions", label: "扩展", icon: PuzzleIcon },
  { id: "maps", label: "地图", icon: MapIcon },
  { id: "net", label: "联机", icon: GlobeIcon },
  { id: "publish", label: "发布", icon: UploadIcon },
];

interface SidebarProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
  instance: Instance;
  extensionCount?: number;
}

export function Sidebar({
  page,
  onNavigate,
  instance,
  extensionCount = 0,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-mark" src="/logo.png" alt="" width={30} height={30} />
        <div>
          <div className="brand-name">Pixel Pine</div>
          <div className="brand-sub">Launcher</div>
        </div>
      </div>

      <nav className="nav" aria-label="主导航">
        <div className="nav-label">PLAY</div>
        {PRIMARY_NAV.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={page === item.id}
            onClick={() => onNavigate(item.id)}
          />
        ))}

        <div className="nav-label">MANAGE</div>
        {SECONDARY_NAV.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={page === item.id}
            onClick={() => onNavigate(item.id)}
            count={item.id === "extensions" && extensionCount > 0 ? extensionCount : undefined}
          />
        ))}
      </nav>

      <div className="sidebar-foot">
        <button
          className={`nav-item${page === "settings" ? " active" : ""}`}
          onClick={() => onNavigate("settings")}
        >
          <SettingsIcon className="nav-icon" />
          <span>设置</span>
        </button>
        <div className="instance-chip" title={instance.root}>
          <i className="dot" />
          <span>
            {instance.name}
            {instance.version ? ` · ${instance.version}` : ""}
          </span>
        </div>
      </div>
    </aside>
  );
}

interface NavButtonProps {
  item: NavItem;
  active: boolean;
  onClick: () => void;
  count?: number;
}

function NavButton({ item, active, onClick, count }: NavButtonProps) {
  const Icon = item.icon;
  return (
    <button
      className={`nav-item${active ? " active" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="nav-icon" />
      <span>{item.label}</span>
      {count !== undefined && <em className="nav-count">{count}</em>}
    </button>
  );
}
