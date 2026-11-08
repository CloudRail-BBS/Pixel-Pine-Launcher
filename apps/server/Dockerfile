# syntax=docker/dockerfile:1

# ---------- 构建 ----------
FROM rust:1-slim-bookworm AS builder

WORKDIR /build

# 先只拷贝清单并建一个空壳，让依赖编译结果能命中缓存。
# 改业务代码时不会重编 axum / sqlx 这一大坨。
COPY Cargo.toml Cargo.lock ./
RUN mkdir -p src \
    && echo 'fn main() {}' > src/main.rs \
    && cargo build --release \
    && rm -rf src

COPY src ./src
COPY migrations ./migrations
# 空壳的 mtime 比源码新，touch 一下强制重编本 crate
RUN touch src/main.rs && cargo build --release

# ---------- 运行 ----------
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 ppl

COPY --from=builder /build/target/release/ppl-server /usr/local/bin/ppl-server

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
