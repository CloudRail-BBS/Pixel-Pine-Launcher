# 发布与分发

三份清单、一条流水线。安装包只在 CI 构建，密钥只在 CI 里，谁都能复现同一份产物。

---

## 1. 发布一个版本

```bash
# 1. 改版本号（两处必须一致）
#    apps/desktop/package.json          "version"
#    apps/desktop/src-tauri/tauri.conf.json  "version"

# 2. 提交后打 tag，tag 必须带 v 前缀
git tag v0.1.0
git push origin v0.1.0
```

推 tag 会触发 `.github/workflows/release.yml`：

```
windows-latest
  ├─ npm ci
  ├─ tauri build --bundles nsis
  │    ├─ Pixel-Pine-Launcher_0.1.0_x64-setup.exe      安装包
  │    └─ Pixel-Pine-Launcher_0.1.0_x64-setup.exe.sig  更新签名
  └─ 创建 Release（prerelease=true）并上传产物 + latest.json
```

也可以在 Actions 页面手动 `Run workflow`，填 tag 名。

**预览版固定标成 pre-release**：GitHub 的 `releases/latest` 只指向正式版，
预览版不会被误当成稳定版本推给所有用户。等要发正式版时，把 workflow 里的
`prerelease: true` 改成 `false`。

### 需要的仓库 Secret

| Secret | 内容 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `~/.ppl-updater/ppl-updater.key` 的**全文**，不是路径 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成时设了口令才需要；无口令留空或不建 |

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.ppl-updater/ppl-updater.key
```

> 私钥丢了就发不出能被现有客户端接受的更新——现有用户会一直停在旧版本，
> 除非让他们手动重装。**备份这把钥匙，比备份代码重要。**

公钥已经编进 `apps/desktop/src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，
它和私钥是一对，换钥匙要同时改这里并重新发版。

---

## 2. 让客户端能收到更新

客户端按顺序尝试 `plugins.updater.endpoints` 里的地址：

```
https://ziyuan.pixelpine.org/v1/launcher/latest.json          ← 自建服务端
https://github.com/CloudRail-BBS/Pixel-Pine-Launcher/releases/latest/download/latest.json
```

第一个地址由服务端提供：把 CI 产出的 `latest.json` 放到服务器上

```bash
mkdir -p /srv/ppl/launcher
# 从 Release 页面下载 latest.json 后放进去
cp latest.json /srv/ppl/launcher/latest.json
```

容器部署时这个目录就是 `PPL_STORAGE_DIR` 下的 `launcher/`：

```bash
docker compose exec -T server sh -c 'mkdir -p /data/packages/launcher'
docker cp latest.json $(docker compose ps -q server):/data/packages/launcher/latest.json
```

`latest.json` 的格式（tauri-action 自动生成，不需要手写）：

```json
{
  "version": "0.2.0",
  "notes": "更新说明",
  "pub_date": "2026-11-08T05:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "……",
      "url": "https://github.com/…/Pixel-Pine-Launcher_0.2.0_x64-setup.exe"
    }
  }
}
```

**没放文件时服务端返回 204**，客户端把 204 当作「暂无更新」静默跳过，
不会弹错误。这也是为什么自建端点放在第一位是安全的：没配置也只是不更新。

---

## 3. 游戏本体分发清单

放在 `<storage>/game/index.json`，没有则返回 204，客户端引导去官方商店。

```json
{
  "schema": 1,
  "generated": "2026-11-08T00:00:00Z",
  "versions": [
    {
      "version": "1.15",
      "channel": "stable",
      "platform": "windows",
      "size": 148000000,
      "sha256": "压缩包的 sha256，小写十六进制",
      "urls": [
        "https://cdn.example.com/rw-1.15-win.zip",
        "https://mirror.example.com/rw-1.15-win.zip"
      ],
      "archive": "zip",
      "entry": "Rusted Warfare.exe",
      "notes": "更新说明，会显示在下载卡片里"
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `platform` | 是 | `windows` / `macos` / `linux` / `android`，只显示匹配当前平台的 |
| `channel` | 否 | 默认 `stable`；`beta` 之类不会被「稳定版」选中 |
| `sha256` | 强烈建议 | 为空时只计算不比对，等于关掉完整性校验 |
| `urls` | 是 | 按顺序尝试，前一个失败自动换下一个 |
| `entry` | 否 | 用来定位游戏根目录；默认 `Rusted Warfare.exe` |
| `archive` | 否 | 目前只支持 `zip` |

### ⚠️ 法律前提

《铁锈战争》是买断制商业软件。**只有拿到分发授权，才能在清单里放安装包**。
没有授权时的正确做法是清单留空（或干脆不放文件），让界面引导用户去
[官方商店](https://store.steampowered.com/app/647960/) 购买。

代码层面已经做了隔离：内核不内置任何地址，清单是运营侧的数据。
换成「只做检测 + 跳转」不需要改代码，删掉清单文件即可。

### 自建一个测试清单

本地验证下载链路时，随便打个 zip 当游戏包：

```bash
cd /tmp && mkdir -p fake-game && echo "MZ" > "fake-game/Rusted Warfare.exe"
mkdir -p fake-game/mods/units && echo hi > fake-game/mods/units/x.txt
cd fake-game && zip -r ../rw-test.zip . && cd ..

python - <<'PY'
import hashlib, json
data = open("/tmp/rw-test.zip", "rb").read()
print(json.dumps({
    "schema": 1,
    "versions": [{
        "version": "1.15",
        "channel": "stable",
        "platform": "windows",
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "urls": ["http://127.0.0.1:8000/rw-test.zip"],
        "entry": "Rusted Warfare.exe",
        "notes": "本地测试包",
    }],
}, ensure_ascii=False))
PY > /tmp/index.json

# 起个静态服务，把 index.json 与 zip 放在一起
cd /tmp && python -m http.server 8000
```

然后在设置页把「游戏下载源」改成 `http://127.0.0.1:8000/index.json`。

---

## 4. 版本号规则

| 变化 | 例子 | 是否需要发新版 |
|---|---|---|
| 破坏性改动（数据格式、协议） | 0.1.0 → 0.2.0 | 是 |
| 新功能 | 0.1.0 → 0.1.1 | 是 |
| 修 bug | 0.1.0 → 0.1.1 | 是 |

客户端只在**版本号变大**时提示更新，同号重发不会触发。
