import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/tokens.css";
import "./styles/app.css";
import App from "./App";
import { applyTheme, readThemeMode } from "./lib/theme";

// 先套主题再渲染，避免深色用户看到一帧白屏
applyTheme(readThemeMode());

const container = document.getElementById("root");
if (!container) {
  throw new Error("缺少 #root 挂载点");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
