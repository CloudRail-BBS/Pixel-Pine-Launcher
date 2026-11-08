#!/usr/bin/env node
/**
 * 用各平台的产物拼出 `latest.json`（Tauri updater 的更新清单）。
 *
 * 为什么不用 tauri-action 自动生成：它是「各平台自己 create release 顺便写一份
 * latest.json」，四个任务并发写同一个文件，最后完成的那个会把别人的平台条目
 * 整份覆盖掉——表现就是某个平台永远收不到更新，而且没有任何报错。
 * 所以这里改成：各平台只上传产物，最后一个任务统一拼。
 *
 * 用法：
 *   node scripts/make-latest-json.mjs \
 *     --dir dist --version 0.1.2 --tag v0.1.2 \
 *     --repo CloudRail-BBS/Pixel-Pine-Launcher \
 *     --notes-file docs/RELEASE_NOTES.md --out dist/latest.json
 *
 * 更新清单里出现的条目要和 `.github/workflows/release.yml` 的矩阵对得上，
 * 少一个平台就直接报错——静默漏掉一个平台，等于那个平台的用户永远停在旧版本。
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 期望一定要有更新条目的平台。与 release.yml 的构建矩阵一一对应。 */
const REQUIRED = ["windows-x86_64", "linux-x86_64", "darwin-aarch64", "darwin-x86_64"];

const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`参数 --${key} 缺少取值`);
    }
    out[key] = value;
    index += 1;
  }
  return out;
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function warn(message) {
  console.error(`::warning::${message}`);
}

function need(key) {
  const value = args[key];
  if (!value) fail(`缺少参数 --${key}`);
  return value;
}

const dir = need("dir");
const version = need("version");
const tag = need("tag");
const repo = need("repo");
const outPath = args.out ?? join(dir, "latest.json");
const notesPath = args["notes-file"];

let notes = "";
if (notesPath) {
  try {
    notes = readFileSync(notesPath, "utf8").trim();
  } catch {
    warn(`读不到 ${notesPath}，更新说明留空`);
  }
}

/**
 * 判断一个文件名属于哪个更新平台。
 *
 * 只看包名里的架构标记，不看目录名——`download-artifact` 的
 * `merge-multiple` 会把四个平台的产物摊平到同一个目录里。
 */
function platformOf(name) {
  const lower = name.toLowerCase();

  if (lower.endsWith("-setup.exe")) {
    if (lower.includes("arm64")) return "windows-aarch64";
    return "windows-x86_64";
  }

  // Tauri 对 AppImage 的更新产物是打了签名的 .AppImage 本身
  // （某些版本会额外生成 .AppImage.tar.gz，两种都认，优先 tar.gz）
  if (lower.endsWith(".appimage.tar.gz")) {
    return lower.includes("aarch64") ? "linux-aarch64" : "linux-x86_64";
  }

  if (lower.endsWith(".appimage")) {
    return lower.includes("aarch64") ? "linux-aarch64" : "linux-x86_64";
  }

  if (lower.endsWith(".app.tar.gz")) {
    if (lower.includes("universal")) return "darwin-universal";
    if (lower.includes("aarch64")) return "darwin-aarch64";
    // tauri 默认命名成 `<产品名>.app.tar.gz`，不带架构；两个架构会撞名，
    // 所以 workflow 里会补上 `_aarch64` / `_x64`。没补的一律当成 x64 处理会出错，
    // 这里直接跳过并提示，比发一份错位两台的更新清单强。
    if (lower.includes("x64") || lower.includes("x86_64")) return "darwin-x86_64";
    warn(`${name} 没有架构标记（_aarch64 / _x64），跳过`);
    return null;
  }

  return null;
}

/**
 * 递归列出目录里的文件。
 *
 * 不能只看顶层：`upload-artifact` 会保留相对于「公共祖先目录」的路径，
 * 下载回来后是 `dist/nsis/*.exe`、`dist/dmg/*.dmg` 这样的结构。
 * 摊平上传和分层下载都得能跑，所以按 basename 判断，不看层级。
 */
function walk(current) {
  const found = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

const paths = walk(dir);
const names = new Set(paths.map((path) => path.split(/[\\/]/).pop()));
const entries = new Map();

for (const path of paths) {
  const name = path.split(/[\\/]/).pop();
  const platform = platformOf(name);
  if (!platform) continue;

  if (!names.has(`${name}.sig`)) {
    warn(`${name} 没有配套的 .sig，跳过（装不上也无法校验的包不能进更新清单）`);
    continue;
  }

  const sigPath = paths.find((item) => item.split(/[\\/]/).pop() === `${name}.sig`);
  const signature = readFileSync(sigPath, "utf8").trim();
  if (!signature) {
    fail(`${name}.sig 是空的`);
  }

  const url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`;
  const entry = { signature, url };

  if (platform === "darwin-universal") {
    // 通用包同时满足两种 Mac
    entries.set("darwin-aarch64", entry);
    entries.set("darwin-x86_64", entry);
  } else if (entries.has(platform)) {
    warn(`平台 ${platform} 出现了多个包，保留先找到的那一个`);
  } else {
    entries.set(platform, entry);
  }
}

const missing = REQUIRED.filter((platform) => !entries.has(platform));
if (missing.length > 0) {
  fail(`这些平台没有产物：${missing.join(", ")}`);
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: Object.fromEntries([...entries.entries()].sort(([a], [b]) => a.localeCompare(b))),
};

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`已生成 ${outPath}`);
for (const [platform, entry] of Object.entries(manifest.platforms)) {
  console.log(`  ${platform.padEnd(18)} ${decodeURIComponent(entry.url.split("/").pop())}`);
}
