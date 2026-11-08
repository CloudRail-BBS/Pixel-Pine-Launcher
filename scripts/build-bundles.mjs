#!/usr/bin/env node
/**
 * 跑 `tauri build`，失败自动重试。
 *
 * 为什么需要它：打包阶段（bundle）会现下 NSIS / linuxdeploy / AppRun 这些工具，
 * 它们挂在 GitHub release 资源上，偶尔整段 504，而 tauri 自己不重试——
 * 一次抖动就要人工重跑整个任务。
 *
 * Rust 产物已经在 target 里，重试只是重打包，几十秒的事，比人肉盯着强。
 *
 * 用法（在 apps/desktop 下）：
 *   node ../../scripts/build-bundles.mjs --target x86_64-unknown-linux-gnu --bundles deb,appimage
 *
 * 环境变量 PPL_BUILD_ATTEMPTS 可以改重试次数，默认 4。
 */

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("::error::没有传参，至少要给 --target 或 --bundles");
  process.exit(1);
}

const attempts = Number(process.env.PPL_BUILD_ATTEMPTS ?? 4);

/** 同步睡眠。脚本是顺序流程，用不上 async，而 spawnSync 之后拿不到事件循环。 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  console.log(`\n[build] 第 ${attempt}/${attempts} 次尝试：tauri build ${args.join(" ")}`);

  const result = spawnSync("npm", ["run", "tauri", "--", "build", ...args], {
    stdio: "inherit",
    // Windows 上 npm 是 npm.cmd，不套 shell 直接 ENOENT
    shell: process.platform === "win32",
    env: process.env,
  });

  if (result.status === 0) {
    console.log(`\n[build] 第 ${attempt} 次成功`);
    process.exit(0);
  }

  if (result.error) {
    console.error(`[build] 启动失败：${result.error.message}`);
  }

  if (attempt < attempts) {
    const wait = attempt * 15_000;
    console.error(`[build] 这次没过（exit ${result.status}），${wait / 1000}s 后重试`);
    sleepSync(wait);
  }
}

console.error("::error::打包连续失败，检查上游资源是否仍然不可用");
process.exit(1);
