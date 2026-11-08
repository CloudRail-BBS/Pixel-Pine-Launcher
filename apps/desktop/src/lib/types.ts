/** 与内核（Rust）保持同构的领域类型。字段名不改成驼峰，
 * 这样 IPC 边界上不需要再做一层映射，序列化开销和出错点都更少。 */

export type PackageSource = "market" | "local";

export interface Loadout {
  id: string;
  name: string;
  packages: LoadoutPackage[];
}

export interface LoadoutPackage {
  id: string;
  version: string;
  source: PackageSource;
  dir: string;
  enabled: boolean;
}

export interface Instance {
  id: string;
  name: string;
  root: string;
  source: "steam" | "portable" | "manual";
  version: string | null;
  activeLoadout: string | null;
}

/** 本地扫描到的 Mod（对应 ppl_core::LocalMod）。 */
export interface LocalMod {
  id: string;
  name: string;
  title: string;
  unitCount: number;
  packaged: boolean;
  size: number;
  enabled: boolean;
  minVersion: string | null;
  /** 与其他 Mod 存在同名单位目录 */
  conflictWith: string | null;
}

export type MarketState = "available" | "installed" | "update";

export interface ImportedPackage {
  id: string;
  title: string;
  file: string;
  size: number;
  unitCount: number;
  /** 导入后是否已把预设挂到游戏目录 */
  attached: boolean;
}

export interface GameMap {
  name: string;
  sizeLabel: string | null;
  size: number;
  hasPreview: boolean;
}

export interface MarketPackage {
  id: string;
  title: string;
  author: string;
  version: string;
  kind: "mod" | "map";
  tag: string;
  size: number;
  downloads: number;
  rating: number;
  isMod: boolean;
  state: MarketState;
}
