/** 自更新。
 *
 * 桌面端才有；浏览器预览里所有函数都是空操作。
 *
 * 检查是静默的：启动后过几秒探一次，**失败不弹任何东西**。
 * 用户没要求更新的时候，网络抖动不该变成一条错误提示。
 */

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import { isTauri } from "./api";

export interface UpdateInfo {
  version: string;
  notes: string;
  date: string;
}

let pending: Update | null = null;

/** 检查更新。没有更新或检查失败都返回 null。 */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null;

  try {
    const update = await check();
    if (!update) {
      pending = null;
      return null;
    }
    pending = update;
    return {
      version: update.version,
      notes: update.body ?? "",
      date: update.date ?? "",
    };
  } catch (error) {
    // 端点没配好、断网、签名公钥对不上——界面上按「没有更新」处理，
    // 但要留在控制台里：不然「更新检查不了」永远只有一句「已是最新版本」。
    console.warn("[ppl] 检查更新失败：", error);
    return null;
  }
}

/** 下载并安装。装完不会自动重启，交给用户决定什么时候切。 */
export async function applyUpdate(onProgress: (percent: number) => void): Promise<void> {
  if (!isTauri()) throw new Error("浏览器预览里不能更新");
  if (!pending) throw new Error("没有待安装的更新，请先检查");

  let downloaded = 0;
  let total = 0;

  await pending.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        onProgress(0);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        // 总长度未知时别硬算百分比，给个 0 让界面显示「下载中」
        onProgress(total > 0 ? Math.min(99, Math.round((downloaded / total) * 100)) : 0);
        break;
      case "Finished":
        onProgress(100);
        break;
    }
  });
}

/** 重启到新版本。 */
export async function restart(): Promise<void> {
  if (!isTauri()) return;
  await relaunch();
}
