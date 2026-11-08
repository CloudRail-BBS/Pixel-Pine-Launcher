import type { ReactElement } from "react";

interface PlaceholderProps {
  title: string;
  description: string;
  icon?: ReactElement;
}

/** 尚未实现的页面。宁可明确写「还在做」，也不要放假界面。 */
export function PlaceholderPage({ title, description }: PlaceholderProps) {
  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-desc">{description}</p>
        </div>
      </header>
      <div className="empty">
        <div style={{ fontSize: 15, color: "var(--text-2)" }}>这块还在施工</div>
        <div style={{ fontSize: 12 }}>已排进里程碑，接口先按方案 §4 的约定推进</div>
      </div>
    </>
  );
}
