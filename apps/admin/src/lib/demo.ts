/** 后台演示数据。
 *
 * 打开 `/admin/?demo=1` 时，接口层直接返回这里的假数据：
 * 不用部署服务端也能看界面长什么样，改版时很省事。
 *
 * 只读：所有写操作都返回失败，避免有人在演示模式里误以为改动了真实数据。
 */

const now = "2026-11-11 10:20";

const PACKAGES = [
  {
    id: "1f0c2a52-0000-4000-8000-000000000001",
    slug: "modern-war",
    kind: "mod",
    title: "现代战争",
    summary: "陆海空三军体系，148 个新单位与 40 种建筑。",
    author: "赤色黎明",
    status: "published",
    reviewNote: "",
    updated: now,
    version: "2.3.1",
    size: 4_823_449,
    downloads: 12480,
    versionCount: 6,
  },
  {
    id: "1f0c2a52-0000-4000-8000-000000000002",
    slug: "star-expedition",
    kind: "mod",
    title: "星际远征",
    summary: "轨道空降与轨道炮，带专属科技树。",
    author: "Orbit Studio",
    status: "pending",
    reviewNote: "",
    updated: "2026-11-10 21:04",
    version: "1.7.0",
    size: 2_204_016,
    downloads: 3310,
    versionCount: 3,
  },
  {
    id: "1f0c2a52-0000-4000-8000-000000000003",
    slug: "big-island",
    kind: "map",
    title: "大岛群战图",
    summary: "8 人混战，资源点分布均衡。",
    author: "地图工坊",
    status: "takendown",
    reviewNote: "地图内嵌了未授权的商业素材，请替换后重新提交。",
    updated: "2026-11-09 15:32",
    version: "1.2.0",
    size: 892_311,
    downloads: 640,
    versionCount: 2,
  },
];

export const DEMO_STATS = {
  packages: { published: 12, pending: 3, draft: 2, rejected: 1, takendown: 1 },
  pendingVersions: 4,
  openReports: 2,
  announcements: 2,
  downloads: 28541,
  users: 76,
  recent: [
    { action: "approve", target: "modern-war", payload: {}, created: "11-11 09:52", actor: "admin@example.com" },
    { action: "game_manifest_update", target: "game/index.json", payload: { versions: 3 }, created: "11-11 09:20", actor: "admin@example.com" },
    { action: "takedown", target: "big-island", payload: { note: "素材未授权" }, created: "11-09 15:32", actor: "admin@example.com" },
    { action: "admin_login", target: "admin@example.com", payload: {}, created: "11-09 15:01", actor: "admin@example.com" },
    { action: "launcher_publish", target: "0.1.2", payload: { platforms: 4 }, created: "11-08 10:03", actor: null },
  ],
};

export const DEMO_QUEUE = {
  items: PACKAGES.filter((item) => item.status === "pending").map((item) => ({
    id: item.id,
    slug: item.slug,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    author: item.author,
    status: item.status,
    version: item.version,
    size: item.size,
    submitted: item.updated,
  })),
};

export const DEMO_REPORTS = {
  items: [
    {
      id: 1,
      reason: "这个包里带的单位立绘和某商业游戏几乎一样，怀疑侵权。",
      contact: "player@example.com",
      created: "2026-11-09 12:10",
      packageId: PACKAGES[2].id,
      slug: "big-island",
      title: "大岛群战图",
      kind: "map",
      packageStatus: "takendown",
    },
  ],
};

export const DEMO_ANNOUNCEMENTS = {
  items: [
    {
      id: "a1",
      title: "0.1.2 已发布：三平台安装包",
      body: "Windows / Linux / macOS 都有安装包了，自动更新同步开启。",
      level: "important",
      pinned: true,
      published: "2026-11-08 18:00",
    },
    {
      id: "a2",
      title: "资源市场审核时间调整",
      body: "工作日 24 小时内处理，周末可能慢一些。",
      level: "info",
      pinned: false,
      published: "2026-11-06 10:00",
    },
  ],
};

export const DEMO_GAME = {
  schema: 1,
  generated: "2026-11-11T02:20:00Z",
  versions: [
    {
      version: "1.15",
      channel: "stable",
      platform: "windows",
      size: 148_233_011,
      sha256: "9f2c5e1d7a4b8c0e3f6a9d2b5c8e1f4a7d0b3c6e9f2a5d8b1c4e7f0a3d6b9c2e",
      urls: ["https://cdn.example.com/rw-1.15-win.zip"],
      archive: "zip",
      entry: "Rusted Warfare.exe",
      notes: "官方 1.15 版本",
    },
    {
      version: "1.15",
      channel: "stable",
      platform: "linux",
      size: 151_002_883,
      sha256: "",
      urls: ["https://cdn.example.com/rw-1.15-linux.zip", "https://mirror.example.com/rw-1.15-linux.zip"],
      archive: "zip",
      entry: "Rusted Warfare",
      notes: "",
    },
  ],
};

export const DEMO_LAUNCHER = {
  version: "0.1.2",
  notes: "三平台安装包 + 后台密码登录",
  pub_date: "2026-11-08T09:58:02Z",
  platforms: {
    "windows-x86_64": {
      signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK",
      url: "https://github.com/CloudRail-BBS/Pixel-Pine-Launcher/releases/download/v0.1.2/Pixel-Pine-Launcher_0.1.2_x64-setup.exe",
    },
    "linux-x86_64": {
      signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK",
      url: "https://github.com/CloudRail-BBS/Pixel-Pine-Launcher/releases/download/v0.1.2/Pixel-Pine-Launcher_0.1.2_amd64.AppImage",
    },
    "darwin-aarch64": {
      signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK",
      url: "https://github.com/CloudRail-BBS/Pixel-Pine-Launcher/releases/download/v0.1.2/Pixel-Pine-Launcher_aarch64.app.tar.gz",
    },
    "darwin-x86_64": {
      signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK",
      url: "https://github.com/CloudRail-BBS/Pixel-Pine-Launcher/releases/download/v0.1.2/Pixel-Pine-Launcher_x64.app.tar.gz",
    },
  },
};

const DEMO_PACKAGE_DETAIL = {
  ...PACKAGES[0],
  cover: null,
  owner: "author@example.com",
  created: "2026-10-02 09:12",
  versions: [
    {
      version: "2.3.1",
      status: "approved",
      size: 4_823_449,
      downloads: 8420,
      sha256: "3f7a9c1e5b8d2f4a6c0e9b7d5f3a1c8e6b4d2f0a9c7e5b3d1f8a6c4e2b0d9f7a",
      fileName: "modern-war@2.3.1.rwmod",
      urls: ["https://ziyuan.pixelpine.org/files/modern-war/2.3.1.rwmod"],
      changelog: "新增 12 个单位，修掉海军工厂卡建造的问题。",
      created: "2026-11-11 09:52",
    },
    {
      version: "2.3.0",
      status: "approved",
      size: 4_710_002,
      downloads: 4060,
      sha256: "",
      fileName: "modern-war@2.3.0.rwmod",
      urls: [],
      changelog: "平衡性调整。",
      created: "2026-10-21 14:03",
    },
  ],
};

/** 演示模式下按路径返回假数据；写操作一律拒绝。 */
export function demoResponse(path: string, method: string): unknown {
  if (method !== "GET") {
    throw new Error("演示模式只读，改不了真实数据（去掉 URL 里的 ?demo=1 才是真的后台）");
  }

  if (path.startsWith("/v1/me")) {
    return { id: "demo", email: "admin@example.com", role: "admin" };
  }
  if (path.startsWith("/v1/admin/stats")) return DEMO_STATS;
  if (path.startsWith("/v1/admin/audit")) return { items: DEMO_STATS.recent };
  if (path.startsWith("/v1/admin/queue")) return DEMO_QUEUE;
  if (path.startsWith("/v1/admin/reports")) return DEMO_REPORTS;
  if (path.startsWith("/v1/admin/announcements")) return DEMO_ANNOUNCEMENTS;
  if (path.startsWith("/v1/admin/game")) return DEMO_GAME;
  if (path.startsWith("/v1/launcher/latest.json")) return DEMO_LAUNCHER;
  if (path.startsWith("/v1/admin/packages/")) return DEMO_PACKAGE_DETAIL;
  if (path.startsWith("/v1/admin/packages")) {
    return { items: PACKAGES, page: 1, pageSize: 20, total: PACKAGES.length };
  }
  return undefined;
}
