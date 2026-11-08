import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import pkg from "./package.json";

// 版本号只有一个来源：package.json。界面里再写死一遍迟早对不上
// （之前的侧栏就一直显示 0.1.0），所以构建时把它注入成常量。
const { version } = pkg;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
