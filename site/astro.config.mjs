// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

/**
 * GitHub Pages 项目站点的地址是 `https://<用户>.github.io/<仓库>/`。
 *
 * base 必须写上：漏掉的话构建产物里的 `/logo.png`、`/about` 全都指向
 * `https://<用户>.github.io/`，线上表现是整页无样式 + 首页以外的链接 404，
 * 而本地 `astro dev` 一切正常——这是部署到项目站点最常见的坑。
 *
 * 以后换自定义域名时，把 site 改成域名、base 删掉即可。
 */
export default defineConfig({
  site: 'https://cloudrail-bbs.github.io',
  base: '/Pixel-Pine-Launcher',
  output: 'static',

  vite: {
    plugins: [tailwindcss()],
  },

  integrations: [sitemap()],

  // 站内跳转预取：滚动到链接附近就提前取 HTML
  prefetch: {
    prefetchAll: true,
  },

  build: {
    // 内联 CSS 会让每个页面都背一份完整样式（这里约 120KB），跨页导航无法复用。
    // 5 个页面、样式表 gzip 后 10KB 左右，拆成外链更划算。
    inlineStylesheets: 'auto',
  },
});
