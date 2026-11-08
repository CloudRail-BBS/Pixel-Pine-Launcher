# syntax=docker/dockerfile:1

# ⚠️ 构建上下文必须是**仓库根目录**，不是 apps/server。
#
# `apps/server/Cargo.toml` 里有 `ppl-package = { path = "../../crates/ppl-package" }`，
# 只把 apps/server 当上下文时，这个路径在镜像里根本不存在，
# 依赖解析会直接失败（failed to read /crates/ppl-package/Cargo.toml）。
#
#   docker build -f apps/server/Dockerfile .
#
# compose 已经配好 context: .，正常用 `docker compose up -d --build` 即可。

FROM rust:1-slim-bookworm AS builder

WORKDIR /build

# ---------- 1. 只放清单和空壳源码，先把依赖编译结果缓存下来 ----------
# 改业务代码时不会重编 axum / sqlx 这一大坨。
#
# ppl-core 的清单也要放：根 Cargo.toml 把它列为 workspace 成员，
# 少了它的 manifest，cargo 解析 workspace 时会报成员缺失。
COPY Cargo.toml Cargo.lock ./
COPY crates/ppl-package/Cargo.toml crates/ppl-package/Cargo.toml
COPY crates/ppl-core/Cargo.toml crates/ppl-core/Cargo.toml
COPY apps/server/Cargo.toml apps/server/Cargo.lock apps/server/

RUN mkdir -p apps/server/src crates/ppl-package/src crates/ppl-core/src \
    && echo 'fn main() {}' > apps/server/src/main.rs \
    && : > crates/ppl-package/src/lib.rs \
    && : > crates/ppl-core/src/lib.rs \
    && cd apps/server && cargo build --release \
    && cd /build && rm -rf apps/server/src crates/ppl-package/src crates/ppl-core/src

# ---------- 2. 换成真实源码再编一次 ----------
COPY crates/ppl-package/src crates/ppl-package/src
COPY apps/server/src apps/server/src
COPY apps/server/migrations apps/server/migrations

# COPY 会保留源文件 mtime，可能比空壳还旧；不 touch 的话
# cargo 会认为缓存是最新的，直接把空壳产物当成最终二进制。
RUN touch crates/ppl-package/src/lib.rs apps/server/src/main.rs \
    && cd apps/server && cargo build --release

# ---------- 审核后台 ----------
# 后台和 API 合并成一个镜像：一个容器、一个端口，不用再配跨域。
FROM node:24-slim AS admin

WORKDIR /build/apps/admin
COPY apps/admin/package.json apps/admin/package-lock.json ./
RUN npm ci
COPY apps/admin/ ./
RUN npm run build

# ---------- 运行 ----------
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 ppl

# apps/server 是独立 workspace，target 在它自己下面
COPY --from=builder /build/apps/server/target/release/ppl-server /usr/local/bin/ppl-server

# 后台产物落在 PPL_ADMIN_DIR（默认 ./admin，工作目录 /app）
COPY --chown=ppl:ppl --from=admin /build/apps/admin/dist /app/admin

USER ppl
WORKDIR /app

ENV PPL_HOST=0.0.0.0 \
    PPL_PORT=8080 \
    RUST_LOG=info,tower_http=warn

EXPOSE 8080

# 用 /healthz 而不是 /readyz：数据库短暂抖动不该导致容器被重启
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["ppl-server"]
