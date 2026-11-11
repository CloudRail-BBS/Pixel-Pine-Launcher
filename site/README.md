# PPL 官网

项目官网，基于 [astro-seo-theme](https://github.com/druedaro/astro-seo-theme)（MIT）改造：
保留它的布局组件、SEO 基础设施与 Tailwind 体系，内容与配色换成 PPL 自己的。

线上地址：<https://cloudrail-bbs.github.io/Pixel-Pine-Launcher/>

## 本地开发

```bash
npm install
npm run dev      # http://localhost:4321/Pixel-Pine-Launcher/
npm run build    # 产物在 dist/
npm run preview  # 按构建结果预览（会带上 base 前缀）
```

Node 22+。构建产物是纯静态文件，任何静态托管都能放。

## 改内容

| 想改什么 | 去哪里 |
|---|---|
| 产品名、描述、GitHub 链接、版本号 | `src/lib/site.ts` |
| 首页文案、特性卡、FAQ | `src/pages/index.astro` |
| 下载三平台卡片 | `src/lib/site.ts` 的 `PLATFORMS` |
| 关于 / 隐私 / 条款 | `src/pages/*.astro` |
| 文档（含 .pplx 规范） | `src/pages/docs/*.astro`，布局在 `src/layouts/DocsLayout.astro` |
| 配色、玻璃、渐变 | `src/styles/global.css` 顶部的 `@theme` 与 CSS 变量 |
| 站点图标 / OG 图 | `public/favicon.png`、`public/apple-touch-icon.png`、`public/og.png` |
| 界面截图 | `public/screenshots/*.webp`（1440×900，约 30KB） |

## 部署

推 `main` 且改动落在 `site/**` 时，`.github/workflows/site.yml` 会构建并发布到
GitHub Pages（Source 需为 **GitHub Actions**）。也可以手动触发该工作流。

### 项目站点的 base 前缀

Pages 项目站点挂在 `https://<用户>.github.io/<仓库>/` 下，所以：

- `astro.config.mjs` 里的 `base: '/Pixel-Pine-Launcher'` 不能删，删了后果是
  整页无样式、首页以外的链接全部 404，而本地 `astro dev` 完全正常；
- 站内链接与静态资源一律走 `src/lib/site.ts` 的 `url()`，不要写死 `/about`；
- 换成自定义域名时，把 `site` 改成域名、`base` 去掉即可。

## 与模板的差异

- 删掉博客、案例、定价、登录/注册、联系页与 en/es 双语言，只留产品落地页 +
  关于 / 隐私 / 条款 / 404；
- 去掉 React 与 MDX 集成：主题开关改成零依赖的 Astro 组件，
  客户端 JS 从约 220KB 降到 2.4KB；
- 配色换成客户端的近黑 + 蓝，补 CJK 字体回退；
- 补玻璃材质、整体渐变、加载进度条与图片骨架；
- 补 `@custom-variant dark`：模板切的是 `.dark` class，但没声明变体，
  手动切浅色时 `dark:` 工具类不会跟着变。

模板的 MIT 许可证保留在 `LICENSE` 与 `public/LICENSE`。
