import { useState } from "react";

import {
  OFFICIAL_BASE,
  activeSource,
  addSource,
  listSources,
  removeSource,
  setActiveSource,
  testSource,
  type MarketFormat,
  type MarketSource,
} from "../lib/market";
import type { ThemeMode } from "../lib/theme";

interface SettingsPageProps {
  version: string;
  /** 是否运行在演示数据上（浏览器预览） */
  demo: boolean;
  theme: ThemeMode;
  resolvedTheme: "dark" | "light";
  onThemeChange: (mode: ThemeMode) => void;
  /** 市场源变了要让市场页重新取数 */
  onMarketChange: () => void;
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
  onMarketChange,
}: SettingsPageProps) {
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
        <MarketSources onChange={onMarketChange} />
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

/** 市场源管理：默认官方，也可以接任何返回 JSON 列表的第三方市场。 */
function MarketSources({ onChange }: { onChange: () => void }) {
  const [sources, setSources] = useState<MarketSource[]>(() => listSources());
  const [current, setCurrent] = useState<MarketSource>(() => activeSource());
  const [adding, setAdding] = useState(false);

  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [format, setFormat] = useState<MarketFormat>("generic");
  const [probe, setProbe] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    const next = listSources();
    setSources(next);
    setCurrent(activeSource());
    onChange();
  }

  function pick(id: string) {
    setActiveSource(id);
    refresh();
  }

  function drop(id: string) {
    removeSource(id);
    refresh();
  }

  async function runProbe() {
    if (!base.trim()) {
      setProbe("先填地址");
      return;
    }
    setBusy(true);
    setProbe("正在连接…");
    const result = await testSource(base, format);
    setProbe(result.message);
    setBusy(false);
  }

  function submit() {
    if (!base.trim()) {
      setProbe("先填地址");
      return;
    }
    const created = addSource({ name, base, format });
    setActiveSource(created.id);
    setName("");
    setBase("");
    setProbe(null);
    setAdding(false);
    refresh();
  }

  return (
    <div className="card">
      <div style={{ fontSize: 14 }}>市场源</div>
      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
        默认使用官方市场（HTTPS）。第三方市场需要返回 JSON 列表，字段名会自动识别。
      </div>

      <div className="source-list" role="radiogroup" aria-label="市场源">
        {sources.map((source) => (
          <label
            key={source.id}
            className={`source-row${source.id === current.id ? " active" : ""}`}
          >
            <input
              type="radio"
              name="market-source"
              checked={source.id === current.id}
              onChange={() => pick(source.id)}
            />
            <div className="source-main">
              <div className="source-name">
                {source.name}
                {source.format === "generic" && <span className="badge">通用</span>}
              </div>
              <div className="source-url">{source.base}</div>
            </div>
            {!source.builtin && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={(event) => {
                  event.preventDefault();
                  drop(source.id);
                }}
              >
                删除
              </button>
            )}
          </label>
        ))}
      </div>

      {adding ? (
        <div className="source-form">
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="名称，例如：社区市场"
            aria-label="市场名称"
          />
          <input
            className="field"
            value={base}
            onChange={(event) => {
              setBase(event.target.value);
              setProbe(null);
            }}
            placeholder={OFFICIAL_BASE}
            spellCheck={false}
            aria-label="市场地址"
          />
          <div className="source-form-row">
            <select
              className="field"
              value={format}
              onChange={(event) => setFormat(event.target.value as MarketFormat)}
              aria-label="接口格式"
            >
              <option value="ppl">PPL 协议（/v1/packages）</option>
              <option value="generic">通用 JSON 列表</option>
            </select>
            <button className="btn btn-sm" onClick={() => void runProbe()} disabled={busy}>
              {busy ? "测试中…" : "测试"}
            </button>
            <button className="btn btn-sm btn-primary" onClick={submit}>
              添加并切换
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setAdding(false);
                setProbe(null);
              }}
            >
              取消
            </button>
          </div>
          {probe && <div className="field-hint">{probe}</div>}
          <div className="field-hint">
            通用格式：接口直接返回数组，或 <code>{"{ items: [...] }"}</code>。
            识别字段 title/name、author/uploader、version、size、urls/downloadUrl。
          </div>
        </div>
      ) : (
        <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
          添加市场源
        </button>
      )}
    </div>
  );
}
