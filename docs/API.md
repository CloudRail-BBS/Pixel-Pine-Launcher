# 市场服务端 API

线上实例：`https://ziyuan.pixelpine.org`

所有请求与响应都是 JSON（上传除外，用 `multipart/form-data`）。
错误统一返回：

```json
{ "error": "给用户看的中文短句", "code": "machine_readable_code" }
```

| 状态码 | 含义 |
|---|---|
| 400 | 参数不对 / 校验未通过 |
| 401 | 没登录或 token 过期 |
| 403 | 登录了但没权限（不是你的资源、不是审核员） |
| 404 | 资源不存在 |
| 409 | 冲突（slug 被占用） |
| 429 | 请求太频繁 |
| 503 | 依赖不可用（数据库、邮件、人机验证） |

---

## 一、登录

没有密码，也没有第三方登录，只认邮箱验证码。邮箱不存在会自动注册。

### 0. 认证配置（公开）

```
GET /v1/auth/config
```

```json
{ "geetestId": "…", "devMode": false }
```

前端据此决定要不要加载极验 SDK。`geetestId` 本来就是公开的，
私钥 `PPL_GEETEST_KEY` 永远不出服务端。

### 1. 申请验证码

```
POST /v1/auth/email/request
Content-Type: application/json
```

```json
{
  "email": "you@example.com",
  "geetest": {
    "lot_number": "…",
    "captcha_output": "…",
    "pass_token": "…",
    "gen_time": "…"
  }
}
```

服务端配置了 Geetest 时 `geetest` 必填，并且会**回源校验**——前端判断等于没验证。
没配置时该字段可省略。

```json
{ "ok": true, "delivery": "email" }
```

`PPL_DEV_MODE=1` 且没配 SMTP 时返回 `{ "ok": true, "delivery": "dev", "devCode": "123456" }`。

频率限制：同邮箱 60 秒一条、每天 5 条。

### 2. 校验验证码

```
POST /v1/auth/email/verify
```

```json
{ "email": "you@example.com", "code": "123456" }
```

```json
{
  "token": "eyJhbGciOi…",
  "user": { "id": "uuid", "email": "you@example.com", "name": "you", "role": "user" }
}
```

验证码 10 分钟有效，错 5 次作废。之后所有需要身份的请求都带：

```
Authorization: Bearer <token>
```

### 3. 当前用户

```
GET /v1/me
```

---

## 二、浏览（免登录）

```
GET /v1/packages?q=关键词&page=1&size=20
GET /v1/packages/{id}          # id 可以是 uuid 或 slug
```

**只返回已过审的版本**。版本历史也只列 `approved` 的。

```json
{
  "items": [
    {
      "id": "374add05-…",
      "slug": "modern-war",
      "kind": "mod",
      "title": "现代战争",
      "summary": "…",
      "author": "赤色黎明",
      "cover": null,
      "version": "2.3.1",
      "size": 42000000,
      "contentHash": "…",
      "urls": ["https://ziyuan.pixelpine.org/files/modern-war/2.3.1.rwmod"]
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 3
}
```

### 举报

```
POST /v1/packages/{id}/report
```

```json
{ "reason": "实际是换皮的付费 Mod，原作者并未授权", "contact": "可选" }
```

免登录——举报门槛越高，坏内容活得越久。

---

## 三、发布

### 1. 建草稿

```
POST /v1/me/packages
Authorization: Bearer <token>
```

```json
{
  "kind": "mod",
  "title": "现代战争",
  "summary": "大规模现代军事模组",
  "slug": "modern-war"
}
```

`slug` 可省略，省略时自动生成。返回 `{ "id": "...", "slug": "...", "status": "draft" }`。

### 2. 上传版本

```
POST /v1/packages/{id}/versions
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

| 字段 | 说明 |
|---|---|
| `file` | `.rwmod` / `.zip`，≤ 200MB |
| `version` | 版本号，≤ 32 字符 |
| `changelog` | 更新说明，可选 |

```bash
curl -X POST "https://ziyuan.pixelpine.org/v1/packages/$ID/versions" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@modern-war-2.3.1.rwmod" \
  -F "version=2.3.1" \
  -F "changelog=修正单位贴图"
```

上传后会**立即用与客户端同一份规则校验**：路径穿越、可执行文件、压缩炸弹、体积上限。
不通过直接拒收，不会落盘。校验通过才写进存储，状态为 `pending`。

### 3. 提交审核

```
POST /v1/packages/{id}/submit
```

至少要有一个 `pending` 版本，否则返回 400。

### 4. 我的资源

```
GET /v1/me/packages
```

返回每条资源的最新状态、审核意见、更新时间。

状态流转：

```
draft ──submit──▶ pending ──approve──▶ published
                     └────reject───▶ rejected（带原因，改完可再提交）
```

---

## 四、审核

需要 `role = admin` 的 token。**后台不走验证码，走密码**：

```
POST /v1/admin/login   { "email": "you@example.com", "password": "……" }
→ 200 { "token": "…", "user": { "id", "email", "name", "role": "admin" } }
→ 401 账号或密码不对
→ 429 密码错误次数过多，N 秒后再试（同一来源连续 5 次失败锁 15 分钟）
→ 503 服务端未配置后台密码（PPL_ADMIN_PASSWORD）
```

`email` 留空时用服务端配置的 `PPL_ADMIN_EMAIL`；配了 `PPL_ADMIN_EMAIL` 就必须与它一致。
拿到的是和普通用户同一种 JWT，权限靠 `role` 区分。

> 一旦配置了 `PPL_ADMIN_PASSWORD`，**邮箱验证码登录不再带管理员角色**，
> 数据库里的管理员账号仍是 `admin`，但用验证码登录发出的 token 只有 `user` 权限。
> 否则「能收到那个邮箱的信」就等于绕过密码。

密码两种存法，都写在 `PPL_ADMIN_PASSWORD` 里：

| 形式 | 说明 |
|---|---|
| `pbkdf2-sha256:<迭代>:<salt hex>:<hash hex>` | 推荐，配置泄露不等于密码泄露 |
| 明文 | 图省事的小部署；建议随机 24 位以上 |

生成哈希（Node 一行，仓库本来就依赖 Node）：

```bash
# 分隔符是冒号不是 $：这个值要过 .env / compose / shell 三层，$ 会被当变量展开
node -e 'const c=require("crypto"),p=process.argv[1],s=c.randomBytes(16),i=120000;console.log("pbkdf2-sha256:"+i+":"+s.toString("hex")+":"+c.pbkdf2Sync(p,s,i,32,"sha256").toString("hex"))' '你的密码'
```

```
GET  /v1/admin/queue
POST /v1/admin/packages/{id}/approve
POST /v1/admin/packages/{id}/reject     { "note": "必须写原因" }
```

通过时：该资源所有 `pending` 版本转 `approved`，资源 `published`。
驳回时：版本转 `rejected`，原因写入 `review_note`。

### 管理控制台

后台的运营视图，全部要求 `role = admin`：

```
GET    /v1/admin/stats                 # 概览读数 + 最近 10 条审计
GET    /v1/admin/audit?limit=60        # 审计流水
GET    /v1/admin/packages              # 全量资源（状态/类型/关键词/分页）
GET    /v1/admin/packages/{id}         # 详情 + 全部版本（含未过审）
POST   /v1/admin/packages/{id}/restore # 恢复上架（下架/驳回 → 已上架，版本一并还原）
DELETE /v1/admin/packages/{id}         # 彻底删除（含磁盘文件，不可恢复）
```

`GET /v1/admin/packages` 的查询参数：`status` / `kind` / `q` / `page` / `size`，
返回 `{ items, page, pageSize, total }`。

**下架和删除是两件事**：下架只是状态转 `takendown`，可恢复；删除会连
`storage/<slug>/` 里的包一起清掉，之后无法找回。

### 游戏本体清单（后台）

```
GET  /v1/admin/game          # 读清单；文件不存在时返回 {"schema":1,"versions":[]}
PUT  /v1/admin/game          # 覆盖写入（先校验再落盘，原子替换）
POST /v1/admin/game/upload   # multipart 上传 zip，返回 url / sha256 / size
```

`PUT` 会校验：`versions` 是数组、`platform` 属于 windows/macos/linux/android、
下载地址必须 `http(s)://`、`sha256` 要么留空要么 64 位十六进制、同平台同版本不重复。
校验失败返回 400 并指出第几条——写进去一份客户端读不懂的清单，界面只会显示
「没有可下载版本」，很难反查。

上传接口落盘到 `<storage>/game/<name>.zip`，通过 `/files/game/…` 对外；
返回的 `sha256` 直接填进清单条目，省掉手工算哈希。

### 启动器更新清单

```
POST /v1/admin/launcher   # 推送 latest.json（校验 version / platforms 后原子写入）
```

发版流水线在创建 Release 后自动调用它，正常情况下不需要手工操作。

### 公告

```
GET    /v1/announcements                    # 公开，只返回未过期的
GET    /v1/admin/announcements              # 管理员，含过期
POST   /v1/admin/announcements              # { title, body, level, pinned, hours }
DELETE /v1/admin/announcements/{id}
```

`level` 为 `info` / `important`；`hours` 为 0 表示长期有效。
客户端只在启动时拉一次，关掉的公告按 id 记在本地，不会再显示。

### 举报处理

```
GET  /v1/admin/reports?status=open
POST /v1/admin/reports/{id}/handle        { "action": "handled" | "dismissed", "note": "可选" }
POST /v1/admin/packages/{id}/takedown     { "note": "必须写" }
```

举报只记录不自动下架：`handled` / `dismissed` 关闭这条举报，
真正让资源消失要用 `takedown`——它把资源状态转 `takendown`，
已过审版本一并转 `rejected`，公开列表立刻查不到。

下架必须写原因，作者申诉时这是唯一依据。

每个审核动作都写 `audit_log`——谁、什么时候、对哪条、做了什么。

---

## 五、下载

```
GET /files/{slug}/{version}.rwmod
```

本地磁盘静态服务。换成对象存储时只改 `storage` 模块，客户端拿到的 URL 形状不变。

---

## 部署相关环境变量

完整清单见 `.env.example`。几个必须理解的：

| 变量 | 不配的后果 |
|---|---|
| `PPL_JWT_SECRET` | 每次启动随机生成，重启后所有人掉线 |
| `PPL_PUBLIC_BASE` | 反代后下载链接仍是内网地址，客户端下不动 |
| `PPL_SMTP_*` | 验证码发不出去，注册直接失败（除非开 dev 模式） |
| `PPL_GEETEST_*` | 注册不校验人机，可被脚本刷验证码 |
| `PPL_ADMIN_EMAIL` | 没有管理员账号，后台登不进去 |
| `PPL_ADMIN_PASSWORD` | 后台密码登录整个停用（`/v1/admin/login` 返回 503）；邮箱验证码可以提权，但那是弱得多的门槛 |
| `PPL_DEV_MODE=1` | **生产事故**：任何人都能拿到验证码登录任意邮箱 |
