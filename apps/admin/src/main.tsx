import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/tokens.css";
import "./styles/admin.css";
import App from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("找不到 #root 节点");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
