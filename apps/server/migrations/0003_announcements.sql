-- 公告：运营侧发，客户端首屏展示。
-- 单独一张表而不是塞进配置：过期与置顶需要按时间筛选，
-- 写成 JSON 文件的话每次改一条都得重新部署。

CREATE TABLE IF NOT EXISTS announcements (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title        TEXT NOT NULL,
    body         TEXT NOT NULL,
    -- info 普通提示；important 需要用户主动关掉
    level        TEXT NOT NULL DEFAULT 'info',
    pinned       BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 为空表示长期有效
    expires_at   TIMESTAMPTZ,
    created_by   TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS announcements_published_idx
    ON announcements (published_at DESC);
