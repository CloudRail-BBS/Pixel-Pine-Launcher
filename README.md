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
| `crates/ppl-core` | ✅ | 实例发现（Steam 库解析）、Mod 扫描、冲突检测、启用/禁用、预设挂载（46 项测试） |
| `apps/desktop` | ✅ | 库 / 市场 / 扩展 / 地图 / 联机 / 发布 / 设置，深浅双主题 |
| `apps/admin` | ✅ | 审核后台：邮箱 + 密码登录，队列、通过/驳回、举报、公告发布 |
| Tauri 壳 | ✅ | 12 个命令已打通，窗口可启动 |
| 市场服务端 | ✅ | 登录 / 上传 / 审核 / 下载闭环，容器化部署；后台密码支持 PBKDF2 哈希 |
| 游戏分发 | ✅ | 清单驱动或本地安装包 → 校验 → 安全解压 → 原子落位 |
| 扩展管理 | 🚧 | 自有规范（`.pplx`）：安装 / 启停 / 依赖 / 加载顺序；运行时未接入 |
| 自更新 | ✅ | Tauri updater，签名校验，静默探测 + 右下角提示 |
| 联机模块 | ✅ | CNKD 房间列表，4 秒轮询，走 Rust 侧代理避开混合内容 |

## 支持平台

| 平台 | 安装包 | 说明 |
|---|---|---|
| Windows x64 | `.exe`（NSIS，装到当前用户目录） | 主力平台，免管理员权限 |
| Linux x64 | `.AppImage` / `.deb` | 在 Ubuntu 22.04 上构建，需要 glibc ≥ 2.35 |
| macOS arm64 | `.dmg` | Apple 芯片原生 |
| macOS x64 | `.dmg` | 交叉编译，Intel Mac |

安装包只在打 `vX.Y.Z` 标签时由 CI 产出，见 [`docs/RELEASE.md`](docs/RELEASE.md)。
macOS 包没有代码签名，首次打开需要右键「打开」绕过 Gatekeeper。

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
├─ docs/RELEASE_NOTES.md # 当前版本的更新说明（发版时同步给 Release 与 latest.json）
├─ site/                # 官网：单页静态站，直接用浏览器打开 index.html 就能看
├─ scripts/             # make-latest-json.mjs：把四平台产物拼成更新清单
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
| `uninstall_market_package` | 从预设卸载资源（先改清单再删文件） |
| `fetch_relay_rooms` | 拉联机房间列表（Rust 侧请求，避开混合内容拦截） |
| `fetch_game_catalog` | 拉游戏版本清单，按平台与版本号排好序 |
| `install_game_from_url` | 下载 → SHA256 校验 → 安全解压 → 原子落位 |
| `games_root` / `open_url` | 默认安装目录 / 用系统浏览器打开链接 |
| `scan_extensions` | 扫描 PPL 扩展并算出加载顺序、缺失依赖、成环 |
| `import_extension` / `remove_extension` | 导入 / 删除扩展包 |
| `set_extension_enabled` | 启停扩展（移入移出 `.disabled/`） |
| `install_game_from_archive` | 从本地 zip 安装游戏本体 |

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

点卡片进详情：大图、简介、当前版本、体积、**版本历史**（含更新说明），
底部有举报入口。举报免登录——门槛越高，坏内容活得越久。

安装链路是「下载到临时文件 → 资源包安全校验 → 进预设目录」，校验不过的文件不会留在磁盘上。
**升级会先删掉旧版本文件**——清单按 id 只留一条，磁盘上不该越积越多；
卸载只影响当前预设，其他预设里的同名资源照旧。
「已安装 / 可更新」由当前预设的清单判定，不是市场自己记的一份状态。

> **关于 http**：`http://ziyuan.pixelpine.org` 会 301 跳 HTTPS。
> 跨域预检遇到 301 直接失败，所以客户端里填 http 会自动升级成 https——
> 不是保守，是 http 在现代浏览器里根本走不通。
> 本地和 10./192.168./172.16-31. 网段保留 http，自建实例调试不受影响。

## 下载游戏本体

「库」页的**获取游戏**入口在任何时候都能打开，里面三条路并列：
在线下载、本地安装包、官方商店。
没找到游戏时首屏也直接给这个入口——不必先猜路径。

下载走清单驱动：

```
GET <下载源>/game/index.json  →  挑当前平台最新版本
    → 流式下载（边下边报进度）→ SHA256 校验
    → 解压到 .ppltmp 暂存目录 → 校验入口 exe → 整体 rename 到位
```

- **代码里没有任何下载地址**。清单由运营方托管，`game-index.json` 格式见
  `docs/DEPLOY.md`；没配清单时界面直接引导到官方商店，不会留一个点了没反应的按钮。
- 装到 `<数据根>/games/Rusted Warfare`，**不碰 Steam 目录**——那是 Steam 的地盘，
  混进去会让「验证文件完整性」和卸载都变得莫名其妙。
- 目标目录已存在且非空时拒绝安装，绝不覆盖你已经在玩的游戏和存档。
- **本地安装包**走同一条解压路径，只是跳过下载与哈希校验
  （文件是用户自己选的，没有期望值可比）。
- 解压前拒收路径穿越、绝对路径、符号链接；解压时按实际写出量计数，防解压炸弹。

## 自更新

启动 4 秒后静默探测一次，有更新才在右下角浮一张小卡片；
没更新或探测失败（断网、端点没配、签名对不上）**什么都不显示**。

- 清单走 Tauri updater 格式，公开在 `<服务端>/v1/launcher/latest.json`
- 安装包用 minisign 签名，公钥编在 `tauri.conf.json` 里，私钥只进 CI secret
- 设置页可以手动「检查更新」，也能改游戏下载源

安装包在 GitHub Actions 上构建并发布，完整流程（签名密钥、清单格式、
游戏分发的授权前提）见 **[docs/RELEASE.md](docs/RELEASE.md)**。

## 扩展

侧栏「扩展」页支持两种格式，**默认 PPL 自有格式**，可切换到 RWML 兼容模式：

| | PPL（默认） | RWML（兼容） |
|---|---|---|
| 目录 | `<游戏>/ppl/extensions/` | `<游戏>/extensions/` |
| 描述符 | `ppl-extension.json` | `META-INF/extension.properties` |
| 包 | `.pplx` | `.jar` |
| 能力 | 依赖解析 + 加载顺序计算 | 只读识别 + 开关 |

两套目录不重叠，可以同时存在。RWML 模式是**互操作层**：只读对方描述符做展示与开关，
不加载、不注入、不含对方任何代码，也不会替你安装它的加载器。

PPL 自有格式的设计如下：

| | 社区方案 | PPL |
|---|---|---|
| 目录 | `<游戏>/extensions/` | `<游戏>/ppl/extensions/` |
| 描述符 | `META-INF/extension.properties` | 包根 `ppl-extension.json` |
| 包后缀 | `.jar` | `.pplx`（zip） |

不复用那套的原因是**许可证不兼容**，以及两边共用一个目录会互相干扰。
规范、加载顺序规则、打包方式见 **[docs/EXTENSIONS.md](docs/EXTENSIONS.md)**。

当前只做到静态部分：安装、启停、依赖检查、加载顺序计算（都有单元测试）。
**真正注入游戏进程的运行时还没写**，界面上也如实标了这一点——
装上的扩展暂时不会生效。RWML 模式的「停用」是移动文件，这一点尚未实测。

## 公告

运营在审核后台的「公告」页写一条，客户端下次启动就会显示在「库」页顶部：

- 级别分普通 / 重要，重要只加一条左侧色带，不做红底——首页大片红会让人以为出事了
- 可置顶、可设有效期（小时），到期自动消失
- 用户关掉后按 id 记住，不会再出现同一条
- 拉取失败静默跳过：公告拉不到不该打断用户

公告跟着市场源走，连哪个市场就看哪个市场的公告。接口：
`GET /v1/announcements`（公开）、`/v1/admin/announcements`（管理员发布与删除）。

## 联机

侧栏「联机」页读 CNKD 中继的公开房间列表：

- 每 4 秒轮询一次，页面切走就停
- 显示房间号、状态（等待中 / 游戏中）、在线人数、房主、地图、是否带 Mod
- 「复制加入链接」把 `www.cnkd.fun/RKCxxx` 复制到剪贴板

**请求必须走 Rust 侧**：中继是明文 HTTP，webview 会以混合内容为由直接拦掉，
连错误信息都拿不到。命令是 `fetch_relay_rooms`，前端只负责解析。

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

举报在后台有单独的页签：忽略 / 标记已处理 / 下架。
**举报本身不会自动下架资源**——「标记已处理」只关掉这条举报，
要让它从市场消失必须点「下架资源」并写原因。两者混在一起会出问题：
运营关掉一条误报，资源却跟着下架了。
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

- **构建上下文是仓库根目录**（compose 已配 `context: .`）：server 依赖
  `../../crates/ppl-package`，只拿 `apps/server` 当上下文会让这个路径在镜像里消失。
  手动构建用 `docker build -f apps/server/Dockerfile .`。
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
