import { useEffect, useState } from "react";

import { dismiss, fetchAnnouncements, isDismissed, type Announcement } from "../lib/announcements";

/**
 * 公告条。
 *
 * 放在首页顶部，不做弹窗——启动器每次开机弹一个窗是最招人烦的设计。
 * `important` 只影响样式，不强制阻断操作；关掉后按 id 记住，不再出现。
 */
export function AnnouncementBar() {
  const [items, setItems] = useState<Announcement[]>([]);

  useEffect(() => {
    let alive = true;
    void fetchAnnouncements().then((list) => {
      if (!alive) return;
      // 置顶的排前面，其余的按时间，最多展示 3 条，避免首页被公告淹没
      setItems(list.filter((item) => !isDismissed(item.id)).slice(0, 3));
    });
    return () => {
      alive = false;
    };
  }, []);

  if (items.length === 0) return null;

  function close(id: string) {
    dismiss(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <section className="announce" aria-label="公告">
      {items.map((item) => (
        <article
          key={item.id}
          className={`announce-item${item.level === "important" ? " important" : ""}`}
        >
          <div className="announce-head">
            <span className="announce-tag">
              {item.pinned ? "置顶" : item.level === "important" ? "重要" : "公告"}
            </span>
            <h3 className="announce-title">{item.title}</h3>
            {item.published && <span className="announce-date">{item.published}</span>}
            <button
              className="announce-close"
              onClick={() => close(item.id)}
              aria-label={`关闭公告：${item.title}`}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {item.body && <p className="announce-body">{item.body}</p>}
        </article>
      ))}
    </section>
  );
}
