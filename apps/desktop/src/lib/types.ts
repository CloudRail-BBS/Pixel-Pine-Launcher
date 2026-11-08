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

/** 市场服务端返回的条目，字段与 `GET /v1/packages` 一一对应。
 * 不在这里混入本地状态，避免把两种来源的数据黏成一个类型。 */
export interface RemotePackage {
  id: string;
  slug: string;
  kind: "mod" | "map";
  title: string;
  summary: string;
  author: string;
  cover: string | null;
  version: string;
  size: number;
  contentHash: string | null;
  urls: string[];
}

/** 服务端条目 + 本地算出来的安装状态。 */
export interface MarketPackage extends RemotePackage {
  state: MarketState;
}

export interface MarketPageResult {
  items: RemotePackage[];
  page: number;
  pageSize: number;
  total: number;
}

/** 联机中继的一个房间（CNKD / RW-HPS）。 */
export interface RelayRoom {
  displayId: string;
  /** battleroom = 等待中，ingame = 已开局 */
  status: string;
  /** 房间容量 */
  playerSize: number;
  /** 当前在线人数 */
  activeConnectionSize: number;
  hostName: string;
  mapName: string;
  isMod: boolean;
  joinLink: string;
}

export interface RelaySnapshot {
  nodeName: string;
  roomCount: number;
  rooms: RelayRoom[];
}

/** 一个历史版本。 */
export interface MarketVersion {
  version: string;
  size: number;
  contentHash: string;
  urls: string[];
  changelog: string;
}

/** 详情 = 资源本体 + 全部过审版本。 */
export interface MarketDetail extends RemotePackage {
  versions: MarketVersion[];
}
