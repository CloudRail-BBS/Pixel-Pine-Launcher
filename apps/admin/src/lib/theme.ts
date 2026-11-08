/** 主题：跟随系统 / 强制浅色 / 强制深色。
 *
 * 只做一件事——把 `data-theme` 写到 <html> 上，其余全交给 CSS 变量。
 * 组件里没有任何一处判断主题，换肤才不会漏。 */

export type ThemeMode = "system" | "dark" | "light";

const STORAGE_KEY = "ppl.theme";

export function readThemeMode(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略
  }
  return "system";
}

function resolve(mode: ThemeMode): "dark" | "light" {
  if (mode !== "system") return mode;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

/** 应用主题。启动时先调一次，避免首帧闪白。 */
export function applyTheme(mode: ThemeMode): "dark" | "light" {
  const resolved = resolve(mode);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

export function saveThemeMode(mode: ThemeMode): "dark" | "light" {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // 存不下就算了，本次会话仍然生效
  }
  return applyTheme(mode);
}

/** 系统主题变化时回调，仅在 mode === "system" 时有用。 */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
