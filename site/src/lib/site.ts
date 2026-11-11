/**
 * 站点常量与路径工具。
 *
 * GitHub Pages 项目站点挂在 `/<仓库>/` 下，所有站内链接与静态资源都必须带前缀，
 * 所以不要在模板里写死 `/about`、`/logo.png`——统一走 `url()`。
 */

/** 站点根（不含 base）。由 astro.config 的 `site` 注入。 */
export const ORIGIN = (import.meta.env.SITE ?? 'https://cloudrail-bbs.github.io').replace(/\/$/, '');

/** base 前缀，例如 `/Pixel-Pine-Launcher`；配在根域时为空串。 */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** 站内绝对路径：`url('/about')` → `/Pixel-Pine-Launcher/about`。 */
export function url(path = '/'): string {
  return `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

/** 带域名的绝对地址，用于 canonical / OG / 结构化数据。 */
export function absoluteUrl(path = '/'): string {
  return `${ORIGIN}${url(path)}`;
}

export const SITE = {
  name: 'Pixel-Pine-Launcher',
  shortName: 'PPL',
  tagline: '铁锈战争 · 作战终端',
  description:
    '把《铁锈战争》的游戏下载、实例、Mod 预设、地图、联机与资源市场收进一个窗口。第三方开源启动器，支持 Windows、Linux 与 macOS。',
  repo: 'https://github.com/CloudRail-BBS/Pixel-Pine-Launcher',
  releases: 'https://github.com/CloudRail-BBS/Pixel-Pine-Launcher/releases',
  issues: 'https://github.com/CloudRail-BBS/Pixel-Pine-Launcher/issues',
  license: 'https://github.com/CloudRail-BBS/Pixel-Pine-Launcher/blob/main/LICENSE',
  market: 'https://ziyuan.pixelpine.org',
  /** 展示用版本号；发版时同步一次即可，下载按钮始终指向 Release 页。 */
  version: '0.1.4',
} as const;

/** 三个平台的下载卡。链接统一落到 Releases，避免预发布版本被写死。 */
export const PLATFORMS = [
  {
    id: 'windows',
    name: 'Windows',
    arch: 'x64',
    note: 'NSIS 安装包，装到当前用户目录，不需要管理员权限。',
    action: '下载 .exe',
    recommended: true,
  },
  {
    id: 'macos',
    name: 'macOS',
    arch: 'arm64 / x64',
    note: '未做代码签名，首次打开请右键「打开」绕过 Gatekeeper。',
    action: '下载 .dmg',
    recommended: false,
  },
  {
    id: 'linux',
    name: 'Linux',
    arch: 'x64',
    note: 'AppImage 免安装，或选 deb（需要 glibc 2.35 及以上）。',
    action: '下载 AppImage',
    recommended: false,
  },
  {
    id: 'android',
    name: 'Android',
    arch: 'arm64 / armv7',
    note: 'APK 直装，需要允许「安装未知来源」；当前是调试签名，Play 商店暂未上架。',
    action: '下载 .apk',
    recommended: false,
  },
] as const;
