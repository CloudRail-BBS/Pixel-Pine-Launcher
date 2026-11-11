// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

/**
 * 站点挂在自定义域名 `ppl.pixelpine.org` 的根路径上，所以 **不设 base**。
 *
 * 反过来要注意：如果哪天改回 GitHub Pages 的项目路径
 * （`https://<用户>.github.io/<仓库>/`），必须补上 `base: '/<仓库>'`，
 * 否则资源会指向域名根、整页无样式，而 `astro dev` 一切正常——
 * 这是项目站点最常见的坑。站内链接统一走 `lib/site.ts` 的 `url()`，
 * 换托管方式时只需要改这里。
 */
export default defineConfig({
  site: 'https://ppl.pixelpine.org',
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
