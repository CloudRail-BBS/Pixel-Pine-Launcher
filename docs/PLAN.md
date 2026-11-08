# Pixel-Pine-Launcher（PPL）技术方案 v1.3

> 状态：**已确认** · 更新：2026-11-08（v1.1 资源市场；v1.2 定自助形态；v1.3 内置游戏下载 + 邮箱注册 + 免责声明）
> 目标仓库：https://github.com/CloudRail-BBS/Pixel-Pine-Launcher.git

---

## 0. 一句话定位

**PPL 是《铁锈战争》的作战终端：把「游戏下载、实例、Mod 组合、资源市场、地图库、联机、存档」收敛进一个窗口，用 Apple 级的交互质感替代在文件夹里拖文件。**

**决策记录**

| 决策项 | 结论 | 日期 |
|---|---|---|
| 技术栈 | Tauri 2 + React 19 + TypeScript + Rust | 2026-11-08 |
| 平台 | Windows / macOS / Linux / Android（四端） | 2026-11-08 |
| 首版范围 | M1–M4 全量 | 2026-11-08 |
| 联机数据源 | `http://101.43.41.22:46784/relay/rooms`（RW-HPS / CNKDRelay） | 2026-11-08 |
| 资源市场 | **B 自助市场**：客户端 + 服务端 + 审核后台全量自建 | 2026-11-08 |
| 游戏获取 | 内置下载（对接服务端版本清单）；未获授权时降级为「检测 + 跳转商店」 | 2026-11-08 |
| 市场注册 | 邮箱验证码 + Geetest 人机验证，**不采集手机号** | 2026-11-08 |
| 免责声明 | 首启 Onboarding 强制确认 + 关于页常驻 + 仓库 `DISCLAIMER.md` | 2026-11-08 |
| 品牌色 | 深色底 + 松针绿 `#3DDC97` + 像素点缀 | 2026-11-08 |

---

## 1. 设计出发点：铁锈战争的五个硬约束

这些约束决定了架构长什么样，也是所有取舍的依据。

| 约束 | 现状 | 架构后果 |
|---|---|---|
| **无版本管理 API** | 游戏是单体 `Rusted Warfare.exe` / APK，官方不给版本元数据 | 版本来源只能靠自建索引 + 本地扫描 |
| **无加载器** | `.rwmod` 就是 zip，放进 `mods/units` 后由游戏内勾选生效 | 不需要「加载器适配层」，复杂度整体下降一档 |
| **Mod 无版本号** | `mod-info.txt` 只有 `title / description / minVersion`，没有 id、没有 version | 市场的「识别同一资源」「判断更新」必须自建指纹体系 |
| **目录不隔离** | 全局只有一个 `mods/units`，所有 Mod 混在一起 | **必须自己做隔离**，这是本项目的核心难点 |
| **四端且存储模型不同** | Windows 有 reparse point、Unix 有 symlink、Android 是 scoped storage | 隔离方案必须分平台实现 |

**由此得出的核心判断**：本项目的价值不在「装游戏」，而在「**组合管理与内容分发**」。所以第一等公民不是「版本」，而是 **Loadout（作战预设）**。

---

## 2. 技术栈（已定稿）

| 层 | 选型 | 说明 |
|---|---|---|
| 壳 | **Tauri 2** | 桌面三端 + Android/iOS；产物 ~8MB |
| 前端 | React 19 + TypeScript + Vite | 生态成熟，动效库选择多 |
| 样式 | Tailwind CSS 4 + CSS 变量 token | 设计系统单一来源 |
| 动效 | Motion（原 Framer Motion） | 支持可中断弹簧与速度接管 |
| 状态 | Zustand | 轻量，无 Provider 嵌套 |
| 内核 | Rust 2024 edition | 无 UI 依赖，可单测、可做 CLI |
| IPC | Tauri Commands + `specta` | 自动生成 TS 类型，杜绝手写接口漂移 |
| 存储 | rusqlite（索引缓存）+ JSON（用户配置） | |
| 网络 | reqwest（rustls） | 绕开 WebView 混合内容与 CORS 问题 |

**为什么不是 .NET / Avalonia**：设计目标要求液态玻璃、可中断弹簧、手势跟随——这些在 CSS 层是「写样式」，在 Skia / WPF 里是「造轮子」。加上四端（含 Android）要求，Tauri 2 是唯一一套 UI 代码全覆盖的方案。

**代价与对策**

- WebView2 缺失（老 Win10）→ 安装器检测并内置离线包；macOS/Linux 用系统 WebKit。
- 双栈调试 → 前后端只有 typed command 一条通路，禁止裸 `invoke(string)`。
- 内存高于原生 → 最小化时暂停动画，列表虚拟化（`@tanstack/virtual`）。

---

## 3. 分层架构

```
UI 层      React 19 · ppl-ui 设计系统 · 动效与材质
   │ typed IPC (invoke / event)
桥接层     Tauri Commands + 事件总线（参数校验 / 错误归一 / 进度广播）
   │
内核层     ppl-core (Rust，零 UI 依赖)
           instance · game · library · market · loadout · net · index · diagnose · task
   │
数据层     SQLite 索引缓存 + JSON 配置
```

内核层不依赖 Tauri，可 `cargo test`、可编 `ppl-cli`。这是可测试性的地基，也是将来做「无界面服务模式」的前提。

---

## 4. 核心模块设计

### 4.1 游戏分发与实例（instance）

**获取游戏的三条路**

| 方式 | 做法 | 适用 |
|---|---|---|
| Steam 检测 | 读注册表 → `libraryfolders.vdf` → 匹配已安装目录 | 已购用户（PC 主流） |
| 本地扫描 | 常见路径 + 便携版目录扫描 | 免安装版 |
| **启动器内下载** | 从服务端版本清单拉包，校验后解压成新实例 | 无游戏，或想多版本并存 |

**在线下载流程**

```
GET /v1/game/versions          → 版本清单（platform / channel / size / sha256 / urls）
选择版本 + 安装目录
  → 预检（剩余空间 / 目录可写 / 目标是否已存在）
  → 分片下载到 .pplpart（断点续传，多源回退）
  → SHA256 校验
  → 解压到 <target>.ppltmp → 成功后原子 rename 到目标目录
  → 创建实例 → 写入 instance.json
```

四条必须守住的细节：

- **原子性**：先解压到临时目录再 rename，失败不留半成品。用户最恨的是「装到一半失败，还得手动删残留」。
- **空间预检**：解压后体积通常是压缩包的 1.5–2 倍。空间不足要在下载前拦住，不是解压到一半才报错。
- **复用下载引擎**：与市场下载共用同一套分片/续传/换源逻辑，不写第二份。
- **不重复下载**：检测到 Steam 已装同版本，直接建实例，不提供下载入口。

**版本清单协议**

```json
{ "schema": 1,
  "game": [
    { "version": "1.15", "channel": "stable", "platform": "windows-x64",
      "size": 148000000, "sha256": "…",
      "urls": ["https://cdn…/rw-1.15-win.zip"],
      "released": "2026-09-03", "notes": "…" }
  ]}
```

**Android**：下载 APK 后交给系统安装器（`REQUEST_INSTALL_PACKAGES`），不静默安装；同签名可覆盖升级。

**合法性边界（重要）**：《铁锈战争》是买断制商业软件。服务端分发安装包**必须持有分发授权**，或只提供官方原始包。未获授权时，此功能降级为「检测已安装 + 跳转官方商店」，不自行提供下载——这条列在 §9 待验证第 10 项。

**路径发现**（下载完成后与本地扫描共用）

| 平台 | 策略 |
|---|---|
| Windows | 注册表 `HKCU\Software\Valve\Steam\SteamPath` → 解析 `libraryfolders.vdf` → `steamapps/common/Rusted Warfare`；再扫常见路径与便携版 |
| macOS | `~/Library/Application Support/Steam/steamapps/common/Rusted Warfare` |
| Linux | `~/.steam/steam/steamapps/common/`、`~/.local/share/Steam/` |
| Android | 读取用户通过 SAF 授权的目录（`.../rustedWarfare`）；无授权则引导选择 |

**校验**：游戏可执行文件版本号 + `mods/` 存在 + **可写性探测**。写权限不足是启动器第一大坑，必须明确提示而非静默失败。

**启动**：工作目录设为游戏根目录（否则 Mod 相对路径解析异常）。Android 走 Intent 拉起包名 `net.hedgerogamers.rustedwarfare`。命令行参数是否支持见 §9。

### 4.2 Mod 库（library）

`.rwmod` = zip。解析走**中央目录直读**，不完整解压：

```
打开 zip 中央目录
  ├─ mod-info.txt（[mod] 段，key:value）→ title / description / minVersion
  ├─ 第一张顶层 .png → 封面（限 4MB，避免大图拖垮列表）
  ├─ 统计 units/*/ → 单位数量
  └─ 结构校验：mod-info.txt + all-units.template + 至少一个 .ini
```

- **容错优先**：90% 的玩家 Mod 结构不规范。缺 `all-units.template` 只警告不拒绝；大小写不一致必须兼容。
- **`.zip` 智能识别**：zip 魔数但不是 `.rwmod` → 提示「是否重命名导入」。
- **冲突预检**：比对两个 Mod 的 `units/<id>/` 目录名集合。同名即冲突（游戏按目录名识别单位，后者覆盖前者）。纯文件名运算，万级规模毫秒级。
- **启用/禁用**：文件级——禁用即移出 `units/`。不依赖游戏内部的勾选状态格式（该格式见 §9 待验证）。

### 4.3 Loadout（作战预设）— 核心差异化

一套 Loadout = 一个 Mod 组合 + 地图池 + 启动参数。

```
<游戏根目录>/mods/units        ← 指向当前激活预设（链接或交换后目录）
<存储根>/loadouts/
   ├─ vanilla/   ├─ modern-war/   └─ sci-fi/
```

**四端策略（统一接口 `loadout::attach()`，上层无感知）**

| 平台 | 挂载方式 | 权限 | 跨盘 |
|---|---|---|---|
| Windows | NTFS junction（`FSCTL_SET_REPARSE_POINT`） | **无需管理员/开发者模式** | 支持 |
| macOS / Linux | symlink | 无需提权 | 支持 |
| Android | **同分区目录 rename 交换** | 需 SAF 持久化授权 | 存储须同分区 |

- Windows 选 junction 而非符号链接，是因为它不需要管理员权限和开发者模式——这是方案能落地的前提。
- Android 上 symlink 不可靠（scoped storage），改用两次 `rename` 交换目录：元数据操作，同样毫秒级、零拷贝。
- 失败回退链：junction/symlink 失败 → rename 交换 → 逐文件复制（带进度条，慢但可用）。

**风险**：杀软对 junction 敏感；Steam 装在 `Program Files` 时不可写。对策：Loadout 实体存 `%LOCALAPPDATA%\PixelPine`，游戏目录只放链接；首次启动做写权限探测并给出明确引导；设置里提供「兼容模式（纯复制）」。

### 4.4 地图库

扫 `mods/maps/` 下 `.tmx` + 同名 `_map.png` 预览。TMX 是 XML，解析 `<map width height>` 得尺寸；玩家数无法从 TMX 可靠推断（待验证），先按尺寸分档（小/中/大/巨型）。地图名可能带 `NEW_PATH|` 之类服务端前缀，展示前要清洗。

### 4.5 资源市场（客户端）

市场不是「一个下载页」，而是**浏览 → 安装 → 管理**三段闭环。三个动作在同一套数据模型上完成，所以界面可以拆，模型不能拆。

**页面结构**

```
市场
├─ 发现    推荐位 / 本周热门 / 新上架 / 分类（对战·战役·题材·规模）
├─ 搜索    关键词 + 标签 + 兼容版本 + 排序（热度·最新·评分）
├─ 详情    封面、简介、README、截图、版本历史、依赖、冲突提示、评论
└─ 我的    已安装（可更新·已禁用·有冲突）/ 已发布 / 收藏
```

**关键设计：安装目标不是 `mods/units`，而是 Loadout 存储区**

```
下载 → 校验 → 解包到 <存储根>/loadouts/<loadout>/<pkg-id>@<ver>/
     → 写入该 Loadout 的 manifest → 冲突预检 → 提示「已加入『现代战争』预设」
```

好处很直接：同一 Mod 的两个版本可以并存；卸载 = 从 manifest 移除；启用/禁用 = 改一份 JSON，不动文件。这也让市场与 §4.3 的隔离机制天然对齐，不必再写一套「往 units 里塞文件」的逻辑。

**更新识别（本项目最麻烦的一处）**

RW 的 Mod 没有内建版本号，`mod-info.txt` 只有 `title / description / minVersion`。三层兜底：

| 层级 | 机制 | 用途 |
|---|---|---|
| 1 | 索引侧显式 `version`（作者提交时填写） | 最可靠，优先采信 |
| 2 | `contentHash` = 文件清单 + 各文件 sha256 的聚合哈希 | 比对是否换过内容 |
| 3 | `modKey` = 归一化后的 `units/` 目录名集合 + title | 识别「同一个 Mod 的不同版本」，避免装出三份 |

用户自己拖进来的本地 Mod 标为「未收录」，不参与更新检查，也不强行上报。

**兼容与冲突**

- `minGame / maxGame` 与实例版本比对：不匹配给黄色警告，不硬拦截（玩家常忽略，硬拦截只会流失）。
- 依赖 `requires: ["ui-pack@>=1.0"]`：安装时拓扑排序，缺失则提示一键补齐。
- 冲突：复用 §4.2 的 `units/<id>` 目录名交集，在「加入预设」**之前**算，不是下载完再算。

**下载层**：3 线程分片、`.pplpart` 续传、多源回退、SHA256 逐文件校验。市场只下发 `urls`，不代理流量，客户端直连 CDN。

**资源数据协议**（客户端只依赖这份结构；服务端 `/v1/packages` 分页返回同样 schema，早期也可以是静态 JSON）：

```json
{
  "schema": 1,
  "generated": "2026-11-08T10:00:00Z",
  "packages": [
    { "id": "modern-war", "kind": "mod", "title": "现代战争", "author": "…",
      "version": "2.3.1", "minGame": "1.15", "maxGame": null,
      "requires": [], "conflicts": [],
      "contentHash": "sha256:…", "size": 42000000,
      "cover": "https://…/cover.png", "shots": ["…"],
      "tags": ["战役向", "大型"], "downloads": 12043, "rating": 4.7,
      "urls": ["https://cdn…/modern-war-2.3.1.rwmod"] }
  ]
}
```

- 本地 SQLite 缓存 + ETag/If-Modified-Since，离线可浏览已缓存列表。
- **合规红线**：只分发原创或已授权内容；游戏本体走官方/Steam/Google Play 渠道，不做破解分发。

### 4.6 市场服务端（自助市场形态）

**已定：走 B 形态**——自助上传 + 人工审核。客户端与索引协议不变，服务端全量自建。

**三种角色**

| 角色 | 能做什么 |
|---|---|
| 游客 | 浏览、搜索、看详情（免登录也能看，降低门槛） |
| 用户 | 安装、收藏、评分、举报；作者身份还可上传与管理自己发布的资源 |
| 审核员 | 审核队列、驳回、下架、封禁 |

**技术选型**

| 层 | 选型 | 理由 |
|---|---|---|
| API | **Rust + axum** | 与客户端共享 `ppl-package` 校验 crate——上传校验和本地扫描必须同源，两套规则必然漂移 |
| 数据库 | PostgreSQL | 资源/版本/用户/审核记录关系清晰，事务够用 |
| 存储 | S3 兼容（COS/OSS）+ CDN | 签名直传，应用服务器不中转流量 |
| 审核后台 | React + ppl-ui | 复用设计系统，不另做一套界面 |
| 部署 | 单机 Docker Compose 起步 | 这个量级别一上来搞 K8s |

**认证：邮箱验证码 + Geetest 人机验证（不收集手机号）**

```
输入邮箱
  → Geetest 4.0 人机验证（滑块/点选）→ 拿到 captcha token
  → POST /v1/auth/email/codes（带 token）
  → 服务端二次校验 token → 生成 6 位验证码（10 分钟有效）
  → POST /v1/auth/email/verify → 返回 JWT（邮箱不存在则自动注册）
```

四条安全底线：

1. **服务端二次校验 Geetest**。只在前端判断等于没验证，token 必须回源核验。
2. **限流**：同邮箱 60s 一条、每日 5 条；同 IP 每小时 20 条；验证码错 5 次即作废。
3. **验证码只存哈希**，不落明文，一次性使用。
4. **不设密码、不收手机号**，账号即邮箱。

审核员额外强制 TOTP 二次验证；登录态用短期 JWT + refresh token 轮换。

**核心数据表**

```
users(id, email, name, role, email_verified, created_at)
email_codes(id, email, code_hash, expires_at, attempts, ip, created_at)
captcha_log(id, ip, scene, passed, created_at)
packages(id, owner_id, kind, title, slug, summary, cover, status, published_at)
versions(id, package_id, version, content_hash, size, urls, changelog, status)
reviews(id, package_id, user_id, rating, body, status)
reports(id, target_type, target_id, reason, status, handled_by)
audit_log(actor_id, action, target, payload, created_at)
```

**API**

```
GET   /v1/packages?...                      # 公开，免登录
GET   /v1/packages/{id}
GET   /v1/packages/{id}/versions
GET   /v1/game/versions                     # 游戏版本清单
GET   /v1/auth/captcha/config               # 下发 Geetest 配置
POST  /v1/auth/email/codes                  # 带 captcha token 请求验证码
POST  /v1/auth/email/verify                 # 校验验证码，签发 JWT
GET   /v1/me
POST  /v1/packages                          # 创建草稿
POST  /v1/packages/{id}/versions            # 新版本：申请直传票据 → 回调校验
PATCH /v1/packages/{id}                     # 改简介 / 封面 / 标签
POST  /v1/packages/{id}/submit              # 提交审核
POST  /v1/packages/{id}/report
GET   /v1/admin/queue                       # 审核队列
POST  /v1/admin/reviews/{id}/approve | reject
```

**审核状态机**

```
draft ──submit──> pending ──approve──> published ──举报成立──> takendown
                    └──reject──> rejected（附原因码，可改后重提）
```

**上传流程（三段式，应用服务器不碰文件流）**

```
1. 申请直传票据 → 客户端 PUT 到对象存储
2. 上传完成回调 → 服务端拉取对象 → ppl-package 校验 → 写入 versions
3. 校验通过落 pending，人工审核后 published；失败则 rejected + 明确原因码
```

**内容安全（必做，不是可选）**

`.rwmod` 本质是 zip，天然是投毒载体。上传即扫描，任一条不过直接拒收：

| 检查 | 规则 |
|---|---|
| 扩展名白名单 | 仅 `.ini .txt .tmx .png .ogg .wav .json`；出现 `.exe .dll .bat .ps1 .sh .jar` 一律拒绝 |
| zip slip | 解压路径必须落在目标目录内，含 `..` 直接判恶意 |
| zip 炸弹 | 解压后总体积 / 压缩比设阈值 |
| 体积上限 | 单包 ≤ 200MB，单图 ≤ 4MB |
| 其他 | 可选 ClamAV、标题与简介敏感词 |

**合规（门槛在运营，不在技术）**

- 面向国内公开发布 UGC 通常需要 **ICP 备案** 与内容审核机制；
- 本项目**不采集手机号**，注册只需邮箱 + 人机验证；若后续监管明确要求实名，`users` 表预留 `verified` 字段即可扩展，不必推翻结构；
- 审核记录、举报处理记录必须**留存可追溯**；
- 版权：只接受作者本人上传或持有授权的内容，并建立**通知—删除**通道。

缺备案与审核机制，公开上线就是裸奔。建议先**邀请制内测**，把审核流程跑顺再开放注册。

**存储与成本**：资源全走 CDN，回源只到对象存储；索引侧只存元数据与 sha256。单包 200MB 上限，是为了让「一个 Mod 一个文件」的下载模型不至于失控。

### 4.7 联机（已确认数据源）

**接口**：`GET http://101.43.41.22:46784/relay/rooms`
**服务端**：RW-HPS / CNKDRelay 3.0.1；`access-control-allow-origin: *`，`cache-control: no-store`

响应结构（实测）：

```json
{ "ok": true,
  "data": {
    "nodeName": "CNKD 上海服务器", "role": "core", "localNodeCode": "C",
    "roomCount": 2, "roomNoStartSize": 1, "roomPublicSize": 0, "roomPrivateSize": 1,
    "updateTime": "2026-11-08 09:11:51", "updateTimestamp": 1794100311593,
    "rooms": [{
      "roomId": "186", "displayId": "RKC186", "lookupId": "RKC186",
      "playerSize": 2, "activeConnectionSize": 1,
      "status": "battleroom",
      "hostName": "辣条大帝",
      "mapName": "NEW_PATH|maps2/12p大两岸.tmx",
      "customRoom": false, "publicPriority": 0, "publicRoom": false,
      "closeRoom": false, "isMod": true,
      "roomCreateTime": 1794100119, "publicTopTime": 1794100119,
      "lastActivityTime": 1794100311,
      "joinLink": "www.cnkd.fun/RKC186"
    }]
  }}
```

**实现要点**

1. **走 Rust 侧代理请求**，不从前端直连。明文 HTTP 在部分 WebView 环境会触发混合内容拦截；Rust 侧还能统一超时、重试、UA。
2. **轮询 4s**（`no-store`，无长连接）。列表用 diff 更新，避免整表重绘。
3. **字段映射**：`status` → 房间状态徽标（`battleroom` 准备中 / `ingame` 游戏中）；`activeConnectionSize / playerSize` → 人数；`isMod` → 「含模组」标签；`mapName` 去掉 `NEW_PATH|` 前缀与扩展名。
4. **加入房间**：`joinLink` 补 `https://` 打开外链（当前由网页承接跳转）。若能确认 RW 支持 `rw://` 或直连参数，改为应用内一键进服（见 §9）。
5. **多节点**：接口返 `nodeName` / `localNodeCode`，索引里维护节点列表，做多节点聚合与延迟排序。
6. **降级**：接口不可达时展示本地地址簿（手填 `IP:端口`，默认 5123），不让联机页白屏。

### 4.8 诊断与崩溃分析

日志解析 → 规则包（JSON，热更新，不必发版）：

```json
{ "id": "mod-conflict",
  "match": "Failed to load unit|duplicate unit id",
  "level": "error",
  "advice": "两个 Mod 存在同名单位，可能是 A 与 B 冲突，是否禁用其一？",
  "action": "openLoadoutEditor" }
```

价值在于**上线后还能持续修**，不用等下一个版本——启动器的错误库本质上是一份长期维护的运维资产。

### 4.9 自更新

`tauri-plugin-updater` + minisign 签名，预留 Android 侧 APK 更新路径。v1 整包更新，差分留 v2。**绝不静默更新**，一律用户确认 + 更新日志。

### 4.10 统一任务系统

所有耗时操作（扫描、导入、下载、切换 Loadout）产出同一结构：

```rust
struct TaskNode { id, parent, title, state, progress, message, children }
```

前端只有一个 `<TaskDock>` 消费它：底部悬浮「3 个任务进行中」，点开是任务树 + 实时日志。进度必须来自真实字节数，不做假进度条。

---

## 5. 数据模型

`instance.json`

```json
{ "schema": 1, "id": "rw-steam-01", "name": "铁锈 · Steam 版",
  "root": "D:/Steam/steamapps/common/Rusted Warfare",
  "source": "steam", "version": "1.15",
  "activeLoadout": "modern-war",
  "loadouts": ["vanilla", "modern-war", "sci-fi"],
  "lastPlayed": "2026-11-07T21:12:00Z", "playSeconds": 18420 }
```

`loadout.json`（市场与本地导入统一用 `packages` 记录，`source` 区分来源）

```json
{ "id": "modern-war", "name": "现代战争",
  "packages": [
    { "id": "modern-war", "version": "2.3.1", "source": "market",
      "dir": "modern-war@2.3.1", "enabled": true },
    { "id": "local-7f3a91", "version": "0.0.0", "source": "local",
      "dir": "local-7f3a91", "enabled": false }
  ],
  "maps": ["crossroads.tmx"], "args": [], "icon": "…" }
```

---

## 6. UI/UX 设计规范（Apple 设计原则落地）

### 6.1 窗口结构

```
┌───────┬──────────────────────────────┬────────────┐
│ 侧栏   │  内容区（列表 / 详情）          │ 检查器      │
│ 玻璃   │  稳定内容层（非玻璃）           │ 抽屉       │
└───────┴──────────────────────────────┴────────────┘
```

- **侧栏是第一等功能层**，用 `regular` 玻璃材质；内容区、卡片保持稳定不透明层——**不做无差别玻璃化**，这是最容易踩的坑。
- 无边框窗口 + 自绘标题栏，`rounded 12px`，顶部留 34px 拖拽区。
- 右侧检查器为可收纳抽屉，选中 Mod/地图时滑出，不打断列表浏览。
- **Android**：三段式折叠为「顶部栏 + 内容 + 底部 4 项导航」，抽屉改为全屏 sheet + 下滑关闭手势。

### 6.2 材质参数（起点值，需实测微调）

```css
.panel-glass {
  background: rgb(22 24 28 / .62);
  backdrop-filter: blur(28px) saturate(160%);
  border: 1px solid rgb(255 255 255 / .08);   /* 内高光，不是外边框 */
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .10), 0 12px 40px rgb(0 0 0 / .35);
}
```

明确边界：这是「半透明玻璃近似」。真正的边缘折射（`feDisplacementMap`）只在侧栏边缘做一次，不全站铺——CSS 滤镜语法支持不代表光学结果正确。

### 6.3 动效

| 场景 | 行为 | 参数起点 |
|---|---|---|
| 按钮按下 | 立即缩放反馈 | 0.97 / 90ms |
| 页面转场 | 位移 + 淡入，方向跟导航深度 | 220ms，cubic-bezier(.22,1,.36,1) |
| 抽屉 / Sheet | 弹簧，可中断、可接管速度 | stiffness 320 / damping 30 |
| 列表重排 | FLIP，保留滚动锚点 | 200ms |
| 任务进度 | 连续不确定性动画 | 1.6s 循环 |

必须尊重 `prefers-reduced-motion`（去弹性、保留直接反馈）、`prefers-reduced-transparency`（提高不透明度）、`prefers-contrast`。Android 上额外响应系统「移除动画」。

### 6.4 排版与视觉

- 字体：`SF Pro Display` / `Inter` / `思源黑体` 三级回退；标题字距 -0.02em。
- 字号阶梯 28 / 20 / 15 / 13 / 11，正文 15–16px（启动器场景比网页略大）。
- 深色为主：底 `#0E1013`，卡 `#16181C`，分隔线 `rgb(255 255 255 / .06)`，主色松针绿 `#3DDC97`。
- 像素点缀：RW 是像素游戏，图标与空状态插图用 8-bit 像素绘制，与圆角毛玻璃形成对比张力——这是 PPL 的视觉记忆点。
- 触摸目标 ≥ 44px（Android 强制）。

### 6.5 键盘与无障碍

`Ctrl/⌘+K` 命令面板、`Ctrl/⌘+1..5` 切页、`Esc` 逐层返回、Tab 焦点环可见（`outline-offset: 2px`，不被圆角裁掉）。

### 6.6 市场页的视觉规则

市场是内容密度最高的页面，最容易做「对但不好看」。四条硬规则：

1. **卡片用内容说话**：封面图占卡片 60% 以上，标题单行截断，副标题只放「作者 · 版本 · 大小」，标签最多 2 个（多的收进「+N」）。
2. **安装态是独立状态**，不是按钮文案变化：未安装 / 安装中（环形进度） / 已安装 / 有更新（角标）/ 冲突（黄色角标）。同一位置，四种视觉。
3. **列表虚拟化 + 骨架屏**：首屏 20 张卡，滚动懒加载；不要一次性渲染 500 张。
4. **详情页用视差封面**：滚动时封面轻微缩放（1 → 1.08），是唯一允许的「装饰性动效」，且必须在 `prefers-reduced-motion` 下关闭。

市场首页不做轮播 banner——自动播放的横幅既干扰阅读，也让「推荐位」变成没人看的装饰。

### 6.7 首次启动与同意流程

```
启动 → 检测 consent.json 版本
     ├─ 未同意 / 版本过期 → Onboarding（欢迎 + 选择游戏目录 + 免责声明勾选）
     └─ 已同意 → 直接进主界面
```

- Onboarding 是三步而不是一页：**欢迎 → 定位或下载游戏 → 条款确认**。把长文塞进第一屏，用户只会闭眼点同意。
- 条款确认用真实勾选框（默认不勾），按钮在此之前保持禁用——不做「默认已勾」，那等于没征得同意。
- 市场下载按钮下方常驻一行小字提示，不弹窗打断。

---

## 7. 工程结构

```
Pixel-Pine-Launcher/
├─ apps/desktop/                 # Tauri 应用
│  ├─ src/                       # React 前端
│  │  ├─ pages/                  # home / library / market / mods / maps / net / settings
│  │  ├─ components/             # TaskDock / InstanceCard / ModRow / GlassPanel
│  │  ├─ styles/                 # tokens.css / glass.css / motion.css
│  │  └─ lib/ipc.ts              # 由 specta 生成的类型安全调用层
│  └─ src-tauri/
├─ apps/server/                  # 市场 API（Rust + axum）
├─ apps/admin/                   # 审核后台（React，复用 ppl-ui）
├─ crates/
│  ├─ ppl-core/                  # 客户端内核（无 UI 依赖）
│  │  └─ instance/ game/ library/ market/ loadout/ net/ index/ diagnose/ task/
│  ├─ ppl-package/               # zip 校验 / 指纹 / 元数据解析（客户端与服务端共享）
│  └─ ppl-cli/                   # 内核的 CLI 外壳（测试 / 自动化）
├─ docs/                         # 方案 / 协议 / 设计规范
├─ scripts/
└─ .github/workflows/            # build + release（四端构建矩阵）
```

---

## 8. 里程碑（M1–M5 全量）

| 阶段 | 交付物 | 验收标准 |
|---|---|---|
| **M0 骨架** | 仓库初始化、CI（四端构建矩阵）、Tauri 跑通、设计 token、`ppl-core` 骨架 | 空窗口四端可启动；`cargo test` + `vitest` 通过 |
| **M0.5 技术验证** | 10 个 spike（§9） | 每个 spike 有结论文档，锁定后续方案 |
| **M1 实例与 Mod** | 实例发现、Mod 扫描/封面/元数据、导入、启停、Loadout 切换 | 20+ 真实 Mod 环境跑通，切换 < 500ms |
| **M1.5 Android 适配** | SAF 授权、rename 交换、Intent 启动、移动端布局 | 真机（Android 11+）完成 Mod 导入与启动 |
| **M2 游戏分发** | 版本清单、在线下载、断点续传、校验解压、自动建实例 | 干净机器从零装到可启动；失败不留残留目录 |
| **M2.5 资源市场（客户端）** | 市场页、搜索筛选、详情、一键安装到 Loadout、更新检查、我的资源 | 20+ 资源跑通；安装 / 更新 / 卸载闭环无残留 |
| **M3 市场服务端** | 邮箱验证码 + Geetest 认证、资源/版本 CRUD、直传票据、`ppl-package` 校验、审核状态机 | 绕过人机验证的尝试被拒；上传→审核→上架闭环 |
| **M3.5 审核后台与运营** | 审核队列、驳回原因码、举报处理、下架、评分、审计日志 | 单条资源审核 < 5 分钟；每个动作可追溯 |
| **M4 联机与诊断** | 房间列表、地址簿、端口诊断、日志诊断规则包 | 房间列表 4s 刷新无闪烁；三类典型故障可识别 |
| **M5 打磨发布** | 自更新、安装器、多语言、免责声明接入、文档、首个 Release | 干净机器安装到启动 < 3 分钟 |

四端并行的代价：M1 与 M1.5 之间必然有一段「桌面能跑、手机还不行」的窗口期。建议对外只发桌面预览版，Android 作为 v1.0 的并列目标而非阻塞项。

---

## 9. 必须先验证的 10 件事（M0.5）

| # | 待验证 | 为什么关键 | 验证方式 |
|---|---|---|---|
| 1 | RW 是否支持命令行参数（窗口化/分辨率/直连） | 决定「启动参数」与「应用内一键进服」能否做 | `--help`、Process Monitor、官方文档/社区 |
| 2 | 游戏内 Mod 启用状态的存储位置与格式 | 决定能否「PPL 勾选 = 游戏内生效」 | 勾选前后 diff 文件树（三平台各一次） |
| 3 | Android 下 `mods/units` 的可达路径与 SAF 授权边界 | rename 交换方案的地基 | 真机 Android 11/13/14 各测一次 |
| 4 | 中继是否提供「房间详情 / 直连地址」接口 | 决定是外链跳转还是应用内进服 | 抓包 cnkd.fun 跳转页、问服务方 |
| 5 | 日志与设置文件实际路径（Win/Mac/Linux/Android） | 诊断模块与存档备份的前提 | 四平台各跑一次 |
| 6 | 市场运营归属与预算（服务器、对象存储、CDN、审核人力） | 决定 M2.5 能否按期开工 | 你拍板 |
| 7 | 存量社区资源能否取得转载授权 | 决定市场冷启动有没有内容可上 | 与作者、铁锈盒子/贴吧站长沟通 |
| 8 | 服务端合规路径：备案主体与 UGC 审核责任 | 决定能否公开开放注册，还是长期邀请制 | 咨询备案服务商 / 法务，先用邀请制跑流程 |
| 9 | Geetest 4.0 在 Tauri WebView（含 Android）中能否正常加载与回调 | 注册流程的地基，跑不起来要换方案 | 三端各跑一次完整注册链路 |
| 10 | 游戏本体分发授权与安装包来源 | 无授权就不能做内置下载 | 联系发行方；拿不到则只做「检测 + 跳转商店」 |

这 10 条没结论前，不写对应模块的生产代码——避免推倒重来。

---

## 10. 风险清单

| 风险 | 影响 | 对策 |
|---|---|---|
| 杀软对 junction / 自更新误报 | 用户装不上 | 代码签名 + 白名单提交 + 「无 junction 兼容模式」 |
| Steam 目录只读 | Loadout 不可用 | 实体存 `%LOCALAPPDATA%`，游戏目录仅放链接 |
| Android 存储权限收紧 | 无法读写 Mod | SAF 持久化 URI；不可用时引导「仅外部存储」设置 |
| Mod 结构千奇百怪 | 扫描崩溃 | 全链路 `Result` + 单文件失败不影响整体 + 错误明细面板 |
| 索引内容版权 | 法律风险 | 仅收录授权/原创内容，提供下架通道 |
| 中继接口变更或宕机 | 联机页不可用 | 走 Rust 代理 + 超时降级到本地地址簿 + 多节点索引 |
| **UGC 内容合规** | 备案不全可被关停；违规内容可致处罚 | 备案 + 邮箱注册与人机验证 + 上传即扫描 + 人工审核 + 举报通道 + 全链路留痕 |
| **审核人力跟不上** | 上架排队、作者流失 | 先邀请制限流；审核清单化 + 预制驳回原因码，单条控制在 5 分钟内 |
| **恶意 .rwmod 投毒** | 用户被感染，信誉崩塌 | 扩展名白名单 + zip slip/炸弹检测 + 哈希公开可校验 |
| **市场冷启动无内容** | 页面空转，用户流失 | 运营侧先人工搬运并取得授权的存量资源，与自助上传并行 |
| **存储与带宽成本** | 长期烧钱 | 只存元数据、资源走 CDN、单包体积上限 |
| **游戏本体分发无授权** | 侵权，可能被下架或追责 | 授权到位前只做「检测 + 跳转官方商店」，不提供下载入口 |
| **Geetest 在 WebView 受限** | 注册链路不可用 | spike 先验；降级为服务端图形验证码 + 邮箱/IP 限流 |
| 四端测试成本 | 里程碑延期 | CI 矩阵 + 桌面优先发布策略 |

---

## 11. 明确不做的事（Non-goals）

- 不做游戏本体破解分发；内置下载仅在取得分发授权后开放，否则只做检测与跳转
- 不做游戏内注入 / 内存修改 / 反作弊绕过
- 不做通用社交账号体系与云同步（启动器本地优先）；市场只引入最小身份（邮箱验证码 / GitHub OAuth），不做关注、私信、动态
- 不做 Mod 制作工具（v1 战线控制）
- 市场不做付费与分成（v1 全免费，避免资金与结算合规）

---

## 12. 免责声明

**三条必须写清楚的边界**

1. PPL 是非官方第三方工具，与 Corroding Games 及《铁锈战争》开发团队无隶属、无合作关系，不代表其立场。
2. 游戏本体、Mod、地图的知识产权归各自权利人。PPL 仅提供本地文件管理与资源索引；市场内容由上传者负责，平台在收到有效通知后下架。
3. 使用风险由用户承担，不对因 Mod 冲突、存档损坏、数据丢失造成的损失负责。

**落地位置（缺一不可）**

| 位置 | 形式 | 要求 |
|---|---|---|
| 首次启动 | 全屏 Onboarding，勾选「我已阅读并同意」才可继续 | 记录同意时间与文本版本；文本更新需重新确认 |
| 关于页 | 常驻入口，随时可查全文 | 与 Onboarding 同一份文本源 |
| 市场 / 游戏下载 | 安装按钮下方一行小字 | 「资源由用户上传，下载即表示你已知晓风险」 |
| 仓库与安装包 | `docs/DISCLAIMER.md` + README 摘要 | 与产品内文本保持一致 |

**实现要点**

- 文本由服务端下发（可热更新），客户端本地缓存，避免每次启动拉网络。
- 同意记录写本地 `consent.json`（文本版本 + 时间戳 + 语种），不上传。
- 不做「关不掉的弹窗」——那是骚扰，不是告知。

---

## 13. 下一步

1. 初始化仓库骨架（`apps/` + `crates/` + CI），提交本方案与 README
2. 推送到 `CloudRail-BBS/Pixel-Pine-Launcher`
3. 开 M0.5 七个 spike，逐条落结论到 `docs/spikes/`
4. 按结论进入 M1
