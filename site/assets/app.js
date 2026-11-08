/* 官网的交互只有三件事：
 *   1. 滚动进场（IntersectionObserver，尊重 prefers-reduced-motion）
 *   2. 导航在滚起来之后才上毛玻璃
 *   3. 认出访问者的系统，把下载按钮指到对的那一个
 *
 * 不引框架：这页没有状态要管，手写比装一套运行时更实在。
 */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ── 1. 滚动进场 ─────────────────────────────────────────── */

function setupReveal() {
  const targets = document.querySelectorAll(".reveal");
  if (!targets.length) return;

  // 减弱动效 / 不支持观察器：直接把最终态给出去
  if (reduceMotion || !("IntersectionObserver" in window)) {
    targets.forEach((node) => node.classList.add("is-in"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        // 只放一次：回滚再滚下来不该重新播
        observer.unobserve(entry.target);
      });
    },
    // 元素露出四分之一再触发，太早会让人看不到「进场」这件事
    { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
  );

  targets.forEach((node) => observer.observe(node));
}

/* ── 2. 导航 ─────────────────────────────────────────────── */

function setupNav() {
  const nav = document.querySelector("[data-nav]");
  if (!nav) return;

  const sync = () => nav.classList.toggle("is-stuck", window.scrollY > 8);
  sync();
  window.addEventListener("scroll", sync, { passive: true });
}

/* ── 3. 平台识别 ─────────────────────────────────────────── */

/** 只是「猜」，猜错的最坏后果是默认下载按钮多一次点击。 */
function detectPlatform() {
  const source = `${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${
    navigator.userAgent ?? ""
  }`.toLowerCase();

  if (source.includes("mac")) return "macos";
  if (source.includes("win")) return "windows";
  if (source.includes("linux") || source.includes("x11")) return "linux";
  return null;
}

const PLATFORM_LABEL = {
  windows: "Windows 版",
  macos: "macOS 版",
  linux: "Linux 版",
};

function setupPlatform() {
  const platform = detectPlatform();
  if (!platform) return;

  document.querySelectorAll(`.platform[data-platform="${platform}"]`).forEach((node) => {
    node.classList.add("is-current");
  });

  document.querySelectorAll(`.dl-card[data-dl="${platform}"]`).forEach((node) => {
    node.classList.add("is-current");
  });

  const cta = document.querySelector("[data-primary-cta]");
  if (cta) cta.textContent = `下载 ${PLATFORM_LABEL[platform]}`;

  return platform;
}

/* ── 4. 从 GitHub 拿最新一版，把按钮指到真正的文件 ─────────── */

const REPO = "CloudRail-BBS/Pixel-Pine-Launcher";

/** 文件名 → 平台。只看安装包，签名文件跳过。 */
function platformOfAsset(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith("-setup.exe")) return "windows";
  if (lower.endsWith(".appimage")) return "linux";
  if (lower.endsWith(".dmg")) return "macos";
  return null;
}

async function refreshDownloads(currentPlatform) {
  let release;
  try {
    // 用 releases 列表而不是 /releases/latest：预览版是 pre-release，
    // latest 只会返回正式版，拿到的会是空的或者过期版本
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;
    const list = await response.json();
    release = list.find((item) => !item.draft);
  } catch {
    // 断网、限流、被墙都走这里：保持指向 Release 页面，功能不受影响
    return;
  }
  if (!release) return;

  const line = document.querySelector("[data-version-line]");
  if (line && release.tag_name) {
    const tag = String(release.tag_name).replace(/^v/, "");
    const prefix = release.prerelease ? "预览版" : "正式版";
    line.textContent = `${prefix} v${tag} · Windows / Linux / macOS`;
  }

  /** 每个平台挑一个包：macOS 有两条架构，挑跟当前机器对得上的那条。 */
  const picked = new Map();
  for (const asset of release.assets ?? []) {
    const platform = platformOfAsset(asset.name);
    if (!platform) continue;
    const isArm = /(aarch64|arm64)/i.test(asset.name);
    const isIntel = /(x64|x86_64|amd64)/i.test(asset.name);

    if (platform === "macos") {
      // Apple 芯片的 Mac 现在占多数，没有更强信号时优先给它
      const prefer = currentPlatform === "macos" && isArm ? 2 : isIntel ? 1 : 2;
      const held = picked.get(platform);
      if (!held || prefer > held.prefer) {
        picked.set(platform, { url: asset.browser_download_url, prefer });
      }
      continue;
    }

    if (!picked.has(platform)) {
      picked.set(platform, { url: asset.browser_download_url, prefer: 1 });
    }
  }

  for (const [platform, asset] of picked) {
    document.querySelectorAll(`.dl-card[data-dl="${platform}"] [data-dl-link]`).forEach((link) => {
      link.href = asset.url;
    });
  }

  // 版本号有了，把「全部版本」也指到这一次的 Release
  document.querySelectorAll(".dl-foot a").forEach((link) => {
    if (link.textContent?.trim() === "全部版本") link.href = release.html_url;
  });
}

/* ── 启动 ─────────────────────────────────────────────────── */

setupReveal();
setupNav();
const platform = setupPlatform();
void refreshDownloads(platform);
