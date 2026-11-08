# Pixel-Pine-Launcher

《铁锈战争》的作战终端：把**游戏下载、实例、Mod 组合、资源市场、地图库、联机**收敛到一个窗口里。

> 状态：M0 骨架进行中。内核与界面已跑通，尚未接入 Tauri 壳与服务端。

## 这个项目解决什么

铁锈战争好玩，但装起来很碎：游戏只有一个 `mods/units` 目录，所有 Mod 混在一起，
换个玩法就得手动搬文件；Mod 之间同名单位会互相覆盖，出了问题只能靠肉眼排查。

PPL 的核心不是「装游戏」，而是**组合管理**——把每一套玩法做成一个 **Loadout（作战预设）**：

```
<游戏根目录>/mods/units        ← 指向当前预设（NTFS junction / symlink）
<存储根>/loadouts/
   ├─ vanilla/   ├─ modern-war/   └─ sci-fi/
```

切换预设 = 重建一次链接，**零拷贝、毫秒级**，而且不污染游戏目录、不动玩家已有数据。

## 当前进度

| 模块 | 状态 | 说明 |
|---|---|---|
| `crates/ppl-package` | ✅ | `.rwmod` 扫描、元数据解析、内容指纹、安全校验（19 项测试） |
| `crates/ppl-core` | ✅ | 实例发现（Steam 库解析）、Mod 扫描、冲突检测、启用/禁用、预设挂载（11 项测试） |
| `apps/desktop` | ✅ | 库 / 市场 / 地图 / 发布 / 设置，深浅双主题，支持多市场源 |
| `apps/admin` | ✅ | 审核后台：登录、队列、通过、驳回 |
| Tauri 壳 | ✅ | 12 个命令已打通，窗口可启动 |
| 市场服务端 | ✅ | 登录 / 上传 / 审核 / 下载闭环，容器化部署 |
| 联机模块 | ⏳ | M4，接口已实测（CNKD / RW-HPS） |

## 目录结构

```
.
├─ apps/desktop/        # 客户端：React 19 + TypeScript + Vite + Tauri
├─ apps/admin/          # 审核后台：React 19 + Vite（与客户端共用 design token）
├─ apps/server/         # 市场服务端：axum + sqlx + PostgreSQL
├─ crates/
│  ├─ ppl-package/      # 资源包解析与安全校验（客户端与服务端共用）
│  └─ ppl-core/         # 实例、资源库、预设挂载
├─ docs/PLAN.md         # 技术方案 v1.3
├─ scripts/             # 构建辅助脚本
└─ .github/workflows/   # CI
```

## 开发

前端需要 **Node 24+**（仓库带 `.nvmrc`，`nvm use` 会自动切到对应版本）。
内核需要 Rust 1.88+，桌面壳还需要系统 WebView2。

```bash
# 内核
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

# 界面（浏览器里跑，自动使用演示数据）
cd apps/desktop
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # 类型检查 + 产物构建

# 桌面应用（真实数据）
npm run desktop:dev     # 启动窗口，读本地游戏目录
npm run desktop:build   # 出 NSIS 安装包
```

> Windows 上 Vite 默认只监听 `[::1]`，`vite.config.ts` 已固定 `host: 127.0.0.1`，
> 否则用 IPv4 访问会拿到 502。

## 已打通的内核命令

| 命令 | 作用 |
|---|---|
| `discover_instances` | 扫描 Steam 库与常见路径 |
| `list_instances` / `add_instance` | 读取已登记实例 / 手动添加目录 |
| `probe_directory` | 探测目录是否可玩、是否可写 |
| `scan_mods` | 扫描 `mods/units`，含禁用项与冲突 |
| `scan_maps` | 扫描 `mods/maps`，解析 TMX 尺寸与预览图 |
| `import_package` | 校验本地 `.rwmod` 后导入指定预设（拖拽即可） |
| `install_from_url` | 从市场下载 → 校验 → 安装到预设（Rust 侧下载，带体积上限） |
| `set_mod_enabled` | 启用/禁用（移入移出 `.disabled/`，可逆） |
| `list_loadouts` / `create_loadout` | 预设列表与新建 |
| `attach_loadout` / `link_status` | 挂载预设 / 查询当前接管状态 |
| `launch_game` | 以游戏目录为工作目录启动 |

## 导入 Mod

把 `.rwmod` 或 `.zip` 直接拖进窗口即可：

```
拖入 → ppl-package 安全校验（路径穿越 / 可执行文件 / 体积 / 压缩比）
     → 复制到 <存储根>/loadouts/<预设>/<名字>.rwmod
     → 写入该预设的 manifest
```

校验不通过的文件不会落盘。落盘的包归预设所有，切预设时互不干扰；
卸载只是改 manifest，禁用是移入 `.disabled/`，都能原样还原。

## 资源市场

官方实例：**https://ziyuan.pixelpine.org**（强制 HTTPS）。

客户端支持**多个市场源**，默认官方实例，可在设置页切换或添加第三方市场：

| 格式 | 说明 |
|---|---|
| PPL 协议 | 走 `/v1/packages`，返回 `{ items, page, pageSize, total }` |
| 通用 JSON | 接口直接返回数组，或 `{ items: [...] }` 之类包一层 |

通用格式会按常见字段名归一化（`title`/`name`、`author`/`uploader`、`version`、
`size`、`urls`/`downloadUrl`），认不出标题的条目直接丢弃，不会把脏数据塞进界面。
添加前可以点「测试」先探一次，能读到几条会如实告诉你。

安装链路是「下载到临时文件 → 资源包安全校验 → 进预设目录」，校验不过的文件不会留在磁盘上。
「已安装 / 可更新」由当前预设的清单判定，不是市场自己记的一份状态。

> **关于 http**：`http://ziyuan.pixelpine.org` 会 301 跳 HTTPS。
> 跨域预检遇到 301 直接失败，所以客户端里填 http 会自动升级成 https——
> 不是保守，是 http 在现代浏览器里根本走不通。
> 本地和 10./192.168./172.16-31. 网段保留 http，自建实例调试不受影响。

## 发布资源

客户端侧栏的「发布」页可以完成整个流程，不需要手动 curl：

```
邮箱验证码登录 → 填标题/版本 → 选 .rwmod → 上传并提交审核
```

- 登录与审核后台是同一套接口，账号通用
- 上传后立刻按客户端同一套规则校验，不通过不落盘
- 提交后状态是「待审核」，通过后才出现在市场
- 被驳回会显示审核意见，改完重新上传即可

## 审核后台

`apps/admin` 是独立的网页后台，审核员在这里处理队列。

```bash
cd apps/admin
npm install
npm run dev        # http://127.0.0.1:5174
```

- 登录用邮箱验证码，和客户端同一套接口；管理员由 `PPL_ADMIN_EMAIL` 指定
- 左侧队列、右侧详情，详情里带**下载地址**——先自己装一遍再决定放不放行
- 驳回必须写原因，原因会原样展示给作者
- 启用 Geetest 的实例会按需加载极验 SDK，没启用的实例一行脚本都不拉

## 市场服务端

`apps/server` 是一个独立 workspace（Rust + axum + PostgreSQL），已支持容器部署。
线上实例已部署在 `ziyuan.pixelpine.org`，`/healthz` 与 `/readyz` 可直接用于探活。
完整步骤（含公网反代、备份恢复、裸机 systemd、排障）见 **[docs/DEPLOY.md](docs/DEPLOY.md)**。

### 端点

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/healthz` | — | 进程存活，编排用它决定是否重启 |
| GET | `/readyz` | — | 依赖就绪（含数据库），负载均衡用它摘流量 |
| GET | `/v1/packages` | — | 分页列表，只返回过审版本 |
| GET | `/v1/packages/{id}` | — | 详情，`id` 可以是 uuid 或 slug |
| POST | `/v1/packages/{id}/report` | — | 举报 |
| POST | `/v1/auth/email/request` | — | 申请验证码（含人机校验） |
| POST | `/v1/auth/email/verify` | — | 校验验证码，返回 JWT |
| GET | `/v1/me` | 用户 | 当前登录信息 |
| GET/POST | `/v1/me/packages` | 用户 | 我的资源 / 新建草稿 |
| POST | `/v1/packages/{id}/versions` | 用户 | 上传版本（multipart） |
| POST | `/v1/packages/{id}/submit` | 用户 | 提交审核 |
| GET | `/v1/admin/queue` | 管理员 | 待审队列 |
| POST | `/v1/admin/packages/{id}/approve` | 管理员 | 通过 |
| POST | `/v1/admin/packages/{id}/reject` | 管理员 | 驳回（必须写原因） |
| GET | `/files/{slug}/{version}.rwmod` | — | 资源包下载 |

完整协议、请求体与 curl 示例见 **[docs/API.md](docs/API.md)**。

健康检查分成两档是刻意的：混成一个，数据库抖一下就会把好好的进程杀掉重来。

### 上传与审核

```
建草稿 → 上传 .rwmod → 服务端用同一份规则校验 → 提交审核 → 通过 / 驳回
```

服务端直接依赖 `crates/ppl-package`，与客户端**共用同一套校验规则**：
路径穿越、可执行文件、压缩炸弹、体积上限。分两份实现迟早会漂移——
要么客户端误杀正常包，要么服务端放过恶意包。

审核动作全部写入 `audit_log`；驳回必须填原因，否则作者不知道改什么。
`PPL_ADMIN_EMAIL` 指定的邮箱登录即自动获得审核权限。

### 本地运行

```bash
cd apps/server
DATABASE_URL=postgres://ppl:ppl@localhost:5432/ppl cargo run
```

没有数据库时服务也能起来：`/healthz` 返回 200，`/readyz` 与业务接口返回 503。
启动时迁移在**后台**执行，失败只告警——否则数据库晚几秒就绪会导致容器反复重启。

### 容器部署

```bash
cp .env.example .env          # 改掉默认口令
docker compose up -d --build
curl http://localhost:8080/healthz
docker compose logs -f server
```

- 数据库数据存在 `ppl-db` 卷里；`docker compose down -v` 会连数据一起删掉。
- 容器内端口固定 `8080`，宿主机端口由 `.env` 的 `PPL_PORT` 决定。
- 生产环境请删掉 compose 里 `db` 的 `ports`（那是给本地连库调试用的），
  并在前面挂一层反代做 TLS。

## 界面与主题

- **双主题**：深色 / 浅色 / 跟随系统，切换只改 `<html data-theme>`，组件里没有一处判断主题。
- **毛玻璃只用在功能层**：侧栏、吸顶页头、检查器抽屉、任务坞。内容卡片保持不透明，保证可读性。
- **吸顶玻璃页头**：内容从标题下方滚过去，模糊才有东西可折射；页头自己带内边距，不靠外层 padding 撑。

## 设计原则

- **内核不依赖 UI**：`ppl-core` 可以单独测试、单独编成 CLI，Tauri 只是它的一层壳。
- **规则只写一遍**：资源包校验只有一份实现，客户端与服务端共用，避免两套标准打架。
- **不动用户数据**：发现 `mods/units` 是真实目录时直接报错，不擅自接管。
- **错误说人话**：面向玩家的报错是中文短句 + 具体原因，而不是 `io::Error` 原文。

## 免责声明

本项目为非官方第三方工具，与 Corroding Games 及《铁锈战争》开发团队无隶属关系。
游戏与 Mod 的知识产权归各自权利人所有。完整条款见 [docs/DISCLAIMER.md](docs/DISCLAIMER.md)。

## 许可

MIT，详见 [LICENSE](LICENSE)。
