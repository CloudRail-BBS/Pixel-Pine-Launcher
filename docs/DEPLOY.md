# 部署教程

覆盖三种场景：**单机 Docker（推荐）**、**公网部署**、**不用 Docker 的裸机部署**。
文中的命令都在仓库根目录执行。

---

## 0. 前置条件

| 场景 | 需要 |
|---|---|
| Docker 部署 | Docker Engine 20.10+ 与 Compose v2（`docker compose version` 能输出即可） |
| 裸机部署 | Rust 1.88+、PostgreSQL 15+、一个能跑二进制的 Linux 用户 |

Windows / macOS 装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)；
Linux 用官方脚本或发行版源装 `docker-ce` + `docker-compose-plugin`。

验证：

```bash
docker --version
docker compose version
```

---

## 1. 单机部署（最快路径）

### 1.1 取代码

```bash
git clone https://github.com/CloudRail-BBS/Pixel-Pine-Launcher.git
cd Pixel-Pine-Launcher
```

### 1.2 配置

```bash
cp .env.example .env
```

编辑 `.env`，**至少改掉数据库口令**：

```ini
POSTGRES_DB=ppl
POSTGRES_USER=ppl
POSTGRES_PASSWORD=换成你自己的强口令
PPL_PORT=8080
```

> `PPL_PORT` 是宿主机端口，容器内固定 8080，改这个不影响内部通信。

### 1.3 启动

```bash
docker compose up -d --build
```

> 镜像的**构建上下文是仓库根目录**（compose 里已配好 `context: .`）。
> 因为 `apps/server` 依赖 `../../crates/ppl-package`，只把 `apps/server`
> 当上下文会让这个路径在镜像里消失，构建直接报
> `failed to read /crates/ppl-package/Cargo.toml`。
> 手动构建请用 `docker build -f apps/server/Dockerfile .`，别 cd 进 apps/server。

首次构建会拉 `rust:1-slim-bookworm` 并编译依赖，**通常 5–15 分钟**（取决于机器和网络）。
之后的构建会命中依赖缓存，通常 1–2 分钟。

### 1.4 验证

```bash
# 进程活着
curl http://localhost:8080/healthz
# {"ok":true,"service":"ppl-server","version":"0.1.0"}

# 数据库就绪
curl http://localhost:8080/readyz
# {"ok":true,"db":true,"version":"0.1.0"}

# 业务接口（迁移脚本里有 3 条演示数据）
curl "http://localhost:8080/v1/packages?size=3"
```

如果 `/healthz` 是 200 而 `/readyz` 是 503，说明服务起来了但数据库没连上，看第 6 节排障。

---

## 2. 日常操作

```bash
# 看状态
docker compose ps

# 看日志（跟到底）
docker compose logs -f server

# 重启服务端（不重建镜像）
docker compose restart server

# 改了代码后重新构建并滚动
docker compose up -d --build server

# 停掉但保留数据
docker compose stop

# 停掉并删除容器（数据卷保留）
docker compose down

# 连数据库
docker compose exec db psql -U ppl -d ppl
```

数据库迁移是**自动**的：服务端启动时在后台跑 `migrations/` 下未执行的脚本。
新增迁移只要把 `0002_xxx.sql` 放进去、重新构建镜像即可，不需要手工执行。

---

## 3. 上线检查清单

在把端口暴露到公网之前，逐条确认：

- [ ] `.env` 里的 `POSTGRES_PASSWORD` 已改，不是示例值
- [ ] compose 里 `db` 服务的 `ports` 已删除（那行是给本地连库调试用的）
- [ ] 前面挂了反向代理并启用 TLS（见第 4 节）
- [ ] 防火墙只放行 80/443，8080 不直接对外
- [ ] 已配置定时备份（见第 5 节）
- [ ] 日志轮转已生效（compose 里已配 10MB × 3，需要更长保留自行调整）

---

## 4. 公网部署（反代 + TLS）

### 4.1 用 Caddy（最省事，自动签证书）

`/etc/caddy/Caddyfile`：

```caddyfile
market.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo systemctl reload caddy
```

### 4.2 用 Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name market.example.com;

    ssl_certificate     /etc/letsencrypt/live/market.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/market.example.com/privkey.pem;

    client_max_body_size 200m;   # 与资源包上传上限保持一致

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name market.example.com;
    return 301 https://$host$request_uri;
}
```

> `client_max_body_size` 必须放开。默认 1MB，上传 `.rwmod` 会直接被 Nginx 挡掉，
> 而且报错信息是 413，容易被误判成服务端问题。

### 4.3 反代后的健康检查

把负载均衡/监控指向 `/readyz`，它会如实反映数据库状态；容器自身的 `HEALTHCHECK`
仍然用 `/healthz`，避免数据库短暂抖动导致容器被重启。

---

## 5. 备份与恢复

### 5.1 备份

```bash
docker compose exec -T db pg_dump -U ppl -d ppl -Fc > "ppl-$(date +%F).dump"
```

`-Fc` 是自定义格式，体积小、支持并行恢复。

### 5.2 恢复

```bash
cat ppl-2026-11-08.dump | docker compose exec -T db pg_restore -U ppl -d ppl --clean --if-exists
```

### 5.3 定时备份（crontab）

```cron
# 每天 03:30 备份，保留 14 天
30 3 * * * cd /opt/Pixel-Pine-Launcher && docker compose exec -T db pg_dump -U ppl -d ppl -Fc > /backup/ppl-$(date +\%F).dump && find /backup -name 'ppl-*.dump' -mtime +14 -delete
```

> 只备份数据库不够。资源包本体在对象存储/CDN 上，也要单独做版本与生命周期策略。

---

## 6. 排障

| 现象 | 原因 | 处理 |
|---|---|---|
| `docker compose up` 报端口占用 | 8080 / 5432 被别的服务占了 | 改 `.env` 的 `PPL_PORT` / `PPL_DB_PORT` |
| `/readyz` 一直 503 | 数据库没起来或口令不对 | `docker compose logs db`；核对 `.env` 与 `DATABASE_URL` 是否一致 |
| 日志有「数据库迁移失败」 | 数据库未就绪或迁移脚本报错 | 看完整 error；方言错误按提示改脚本后重建 |
| 构建卡在 `cargo build` | 首次编译 + 网络慢 | 属正常；可配国内 crates 镜像加速 |
| 容器反复重启 | 一般是启动即 panic | `docker compose logs server`；`/healthz` 异常才可能触发重启策略 |
| 上传大文件 413 | 反代默认体积限制 | 见 4.2 的 `client_max_body_size` |
| 日志爆盘 | 未限制日志大小 | compose 已配 `max-size: 10m` / `max-file: 3`，可按需调整 |

---

## 7. 不用 Docker 的裸机部署

适合已经有 PostgreSQL、或不想装 Docker 的机器。

### 7.1 建库

```bash
sudo -u postgres psql <<'SQL'
CREATE USER ppl WITH PASSWORD '换成强口令';
CREATE DATABASE ppl OWNER ppl;
SQL
```

### 7.2 编译

```bash
cd apps/server
cargo build --release
# 产物：target/release/ppl-server
```

### 7.3 安装

```bash
sudo install -m 0755 target/release/ppl-server /usr/local/bin/ppl-server
sudo useradd --system --create-home ppl
sudo install -d -o ppl -g ppl /etc/ppl
```

`/etc/ppl/env`：

```ini
DATABASE_URL=postgres://ppl:口令@127.0.0.1:5432/ppl
PPL_HOST=127.0.0.1
PPL_PORT=8080
RUST_LOG=info,tower_http=warn
```

> `PPL_HOST=127.0.0.1` 表示只监听本机，由反代对外。直接对外就写 `0.0.0.0`。

### 7.4 systemd

`/etc/systemd/system/ppl-server.service`：

```ini
[Unit]
Description=Pixel-Pine-Launcher Market Server
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=ppl
Group=ppl
EnvironmentFile=/etc/ppl/env
ExecStart=/usr/local/bin/ppl-server
Restart=on-failure
RestartSec=3
# 优雅关闭：容器里发 SIGTERM，systemd 这里同理
KillSignal=SIGTERM
TimeoutStopSec=20

# 基础加固
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ppl-server
sudo systemctl status ppl-server
curl http://127.0.0.1:8080/healthz
```

---

## 8. 升级流程

```bash
cd /opt/Pixel-Pine-Launcher
git pull
docker compose up -d --build server
docker compose ps
curl -fsS http://localhost:8080/readyz
```

迁移会在新容器启动时自动执行。**回滚前先想清楚迁移是否可逆**——
数据库结构改动一般没有自动回滚，回滚镜像不等于回滚数据。

---

## 9. 资源建议

| 规模 | 配置 | 说明 |
|---|---|---|
| 内测（<100 人） | 1 核 1G | 单机 compose 够用，注意 `PPL_DB_MAX_CONN` 别开太大 |
| 小规模（<2000 人） | 2 核 2G | 资源文件务必走对象存储 + CDN，不要放在服务器本地 |
| 再往上 | 托管数据库 + 多副本 | 服务端本身无状态，可直接水平扩容，前面挂负载均衡 |

服务端是**无状态**的（会话与数据都在数据库里），所以横向扩容不需要改代码。
