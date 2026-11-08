import { useState } from "react";

import { OFFICIAL_BASE, marketBase, setMarketBase } from "../lib/market";
import type { ThemeMode } from "../lib/theme";

interface SettingsPageProps {
  version: string;
  /** 是否运行在演示数据上（浏览器预览） */
  demo: boolean;
  theme: ThemeMode;
  resolvedTheme: "dark" | "light";
  onThemeChange: (mode: ThemeMode) => void;
  /** 服务地址变了要让市场页重新取数 */
  onMarketBaseChange: () => void;
}

const THEMES: { id: ThemeMode; label: string }[] = [
  { id: "dark", label: "深色" },
  { id: "light", label: "浅色" },
  { id: "system", label: "跟随系统" },
];

export function SettingsPage({
  version,
  demo,
  theme,
  resolvedTheme,
  onThemeChange,
  onMarketBaseChange,
}: SettingsPageProps) {
  const [baseInput, setBaseInput] = useState(() => marketBase());
  const [baseHint, setBaseHint] = useState<string | null>(null);

  function saveBase() {
    const saved = setMarketBase(baseInput);
    setBaseInput(saved);
    setBaseHint(saved === OFFICIAL_BASE ? "已恢复官方服务" : `已切换到 ${saved}`);
    onMarketBaseChange();
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">设置</h1>
          <p className="page-desc">外观、下载与关于</p>
        </div>
      </header>

      <section className="section">
        <div className="section-title">外观</div>
        <div className="card">
          <div className="card-row" style={{ justifyContent: "space-between", gap: 20 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14 }}>主题</div>
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                {theme === "system"
                  ? `跟随系统，当前为${resolvedTheme === "dark" ? "深色" : "浅色"}`
                  : "已手动指定，不再跟随系统"}
              </div>
            </div>
            <div className="loadout-bar" role="radiogroup" aria-label="主题">
              {THEMES.map((item) => (
                <button
                  key={item.id}
                  role="radio"
                  aria-checked={theme === item.id}
                  className={`chip${theme === item.id ? " active" : ""}`}
                  onClick={() => onThemeChange(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 10,
            }}
          >
            <Swatch label="画布" color="var(--bg)" />
            <Swatch label="卡片" color="var(--bg-elev)" />
            <Swatch label="主色" color="var(--accent)" />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-title">资源市场</div>
        <div className="card">
          <div style={{ fontSize: 14 }}>服务地址</div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
            线上服务强制 HTTPS，公网地址填 http 会自动升级；自建实例在本机可以用 http
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              className="field"
              value={baseInput}
              onChange={(event) => {
                setBaseInput(event.target.value);
                setBaseHint(null);
              }}
              placeholder={OFFICIAL_BASE}
              spellCheck={false}
              aria-label="市场服务地址"
            />
            <button className="btn btn-sm btn-primary" onClick={saveBase}>
              保存
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                setBaseInput(OFFICIAL_BASE);
                setMarketBase("");
                setBaseHint("已恢复官方服务");
                onMarketBaseChange();
              }}
            >
              默认
            </button>
          </div>
          <div className="field-hint">{baseHint ?? `当前：${marketBase()}`}</div>
        </div>
      </section>

      <section className="section">
        <div className="section-title">下载</div>
        <div className="card">
          <div className="kv">
            <span>并发分片</span>
            <span>3</span>
          </div>
          <div className="kv">
            <span>断点续传</span>
            <span>已开启</span>
          </div>
          <div className="kv">
            <span>安装校验</span>
            <span>SHA256</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-title">关于</div>
        <div className="card">
          <div className="kv">
            <span>版本</span>
            <span>{version}</span>
          </div>
          <div className="kv">
            <span>内核</span>
            <span>ppl-core 0.1.0</span>
          </div>
          <div className="kv">
            <span>数据来源</span>
            <span>{demo ? "演示数据（浏览器预览）" : "本地游戏目录"}</span>
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: "var(--text-3)", lineHeight: 1.75 }}>
            PPL 是非官方第三方工具，与 Corroding Games 及《铁锈战争》开发团队无隶属关系。
            游戏与 Mod 的知识产权归各自权利人所有；市场内容由上传者负责，
            平台在收到有效通知后下架。使用本工具的风险由用户承担。
          </div>
        </div>
      </section>
    </>
  );
}

function Swatch({ label, color }: { label: string; color: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--r-md)",
        overflow: "hidden",
        background: "var(--bg-elev-2)",
      }}
    >
      <div style={{ height: 34, background: color }} />
      <div style={{ padding: "6px 9px", fontSize: 11, color: "var(--text-3)" }}>{label}</div>
    </div>
  );
}
