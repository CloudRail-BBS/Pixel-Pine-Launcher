import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // 由服务端托管在 /admin 下；独立部署时这个前缀也会跟着走，不用改代码
  base: "/admin/",
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
});
