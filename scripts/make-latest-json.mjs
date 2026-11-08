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

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

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

  // 更新用的是 AppImage 的 tar.gz（Tauri 只会替换整个 AppImage 文件），
  // 裸 .AppImage 是给人手动下载的，不进清单
  if (lower.endsWith(".appimage.tar.gz")) {
    return lower.includes("aarch64") ? "linux-aarch64" : "linux-x86_64";
  }

  if (lower.endsWith(".app.tar.gz")) {
    if (lower.includes("universal")) return "darwin-universal";
    return lower.includes("aarch64") ? "darwin-aarch64" : "darwin-x86_64";
  }

  return null;
}

const files = readdirSync(dir);
const entries = new Map();

for (const name of files) {
  const platform = platformOf(name);
  if (!platform) continue;

  const sigName = `${name}.sig`;
  if (!files.includes(sigName)) {
    warn(`${name} 没有配套的 .sig，跳过（装不上也无法校验的包不能进更新清单）`);
    continue;
  }

  const signature = readFileSync(join(dir, sigName), "utf8").trim();
  if (!signature) {
    fail(`${sigName} 是空的`);
  }

  const url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`;
  const entry = { signature, url };

  if (platform === "darwin-universal") {
    // 通用包同时满足两种 Mac
    entries.set("darwin-aarch64", entry);
    entries.set("darwin-x86_64", entry);
  } else if (entries.has(platform)) {
    warn(`平台 ${platform} 出现了多个包，保留 ${basename(entries.get(platform).url)}`);
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
