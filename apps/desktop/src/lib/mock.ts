/** 演示数据。
 *
 * 现在还没有接 Tauri IPC，界面需要真实感的数据来验证排版与动效。
 * 接上 IPC 后这个文件整体删掉，接口形状保持不变即可。 */

import type { Instance, LocalMod, Loadout } from "./types";

export const instance: Instance = {
  id: "rw-3f2a91b0",
  name: "铁锈 · Steam 版",
  root: "D:/Steam/steamapps/common/Rusted Warfare",
  source: "steam",
  version: "1.15",
  activeLoadout: "modern-war",
};

export const loadouts: Loadout[] = [
  { id: "vanilla", name: "原版纯净", packages: [] },
  {
    id: "modern-war",
    name: "现代战争",
    packages: [
      {
        id: "modern-war",
        version: "2.3.1",
        source: "market",
        dir: "modern-war@2.3.1",
        enabled: true,
      },
      {
        id: "ui-pack",
        version: "1.0.4",
        source: "market",
        dir: "ui-pack@1.0.4",
        enabled: true,
      },
    ],
  },
  { id: "sci-fi", name: "星际远征", packages: [] },
];

export const localMods: LocalMod[] = [
  {
    id: "modern-war",
    name: "现代战争",
    title: "现代战争 · Modern Warfare",
    unitCount: 148,
    packaged: true,
    size: 42_000_000,
    enabled: true,
    minVersion: "v1.15",
    conflictWith: null,
  },
  {
    id: "ui-pack",
    name: "界面增强",
    title: "界面增强包",
    unitCount: 0,
    packaged: true,
    size: 3_400_000,
    enabled: true,
    minVersion: "v1.14",
    conflictWith: null,
  },
  {
    id: "steel-tide",
    name: "钢铁洪流",
    title: "钢铁洪流",
    unitCount: 63,
    packaged: true,
    size: 18_600_000,
    enabled: true,
    minVersion: "v1.15",
    conflictWith: "现代战争",
  },
  {
    id: "star-expedition",
    name: "星际远征",
    title: "星际远征",
    unitCount: 97,
    packaged: true,
    size: 31_200_000,
    enabled: false,
    minVersion: "v1.15",
    conflictWith: null,
  },
  {
    id: "ww2",
    name: "二战风云",
    title: "二战风云",
    unitCount: 120,
    packaged: false,
    size: 26_800_000,
    enabled: false,
    minVersion: "v1.13",
    conflictWith: null,
  },
  {
    id: "kingdom",
    name: "王国崛起",
    title: "王国崛起",
    unitCount: 54,
    packaged: true,
    size: 12_100_000,
    enabled: false,
    minVersion: "v1.15",
    conflictWith: null,
  },
];
