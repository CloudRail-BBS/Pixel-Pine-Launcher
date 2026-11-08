-- 资源市场初始表结构
-- 只建「读」需要的东西；上传、审核、举报等随里程碑补迁移。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS packages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL CHECK (kind IN ('mod', 'map')),
    title       TEXT NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    author      TEXT NOT NULL DEFAULT '',
    cover       TEXT,
    status      TEXT NOT NULL DEFAULT 'published'
                CHECK (status IN ('draft', 'pending', 'published', 'rejected', 'takendown')),
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS versions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id   UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    version      TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    size         BIGINT NOT NULL DEFAULT 0,
    urls         TEXT[] NOT NULL DEFAULT '{}',
    changelog    TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (package_id, version)
);

CREATE INDEX IF NOT EXISTS idx_versions_package ON versions (package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_packages_status ON packages (status, published_at DESC);

-- 演示数据：没有内容的市场是没法验证分页与空态的
INSERT INTO packages (slug, kind, title, summary, author, status)
VALUES
    ('modern-war', 'mod', '现代战争', '大规模现代军事模组，含 148 个单位', '赤色黎明', 'published'),
    ('star-expedition', 'mod', '星际远征', '科幻向单位与建筑，含专属科技树', 'Orbit Studio', 'published'),
    ('map-big-island', 'map', '大岛群战图', '8 人混战，资源点分布均衡', '地图工坊', 'published')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO versions (package_id, version, content_hash, size, urls, changelog)
SELECT p.id, '2.3.1', 'sha256:demo-modern-war', 42000000,
       ARRAY['https://example.invalid/modern-war-2.3.1.rwmod'], '首个公开版本'
FROM packages p WHERE p.slug = 'modern-war'
ON CONFLICT (package_id, version) DO NOTHING;

INSERT INTO versions (package_id, version, content_hash, size, urls, changelog)
SELECT p.id, '1.8.0', 'sha256:demo-star-expedition', 31200000,
       ARRAY['https://example.invalid/star-expedition-1.8.0.rwmod'], '修正单位贴图'
FROM packages p WHERE p.slug = 'star-expedition'
ON CONFLICT (package_id, version) DO NOTHING;

INSERT INTO versions (package_id, version, content_hash, size, urls, changelog)
SELECT p.id, '1.1', 'sha256:demo-map-big-island', 1240000,
       ARRAY['https://example.invalid/big-island-1.1.rwmod'], ''
FROM packages p WHERE p.slug = 'map-big-island'
ON CONFLICT (package_id, version) DO NOTHING;
