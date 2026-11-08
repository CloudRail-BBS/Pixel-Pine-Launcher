# 发布与分发

三份清单、一条流水线。安装包只在 CI 构建，密钥只在 CI 里，谁都能复现同一份产物。

---

## 1. 发布一个版本

```bash
# 1. 改版本号（两处必须一致）
#    apps/desktop/package.json          "version"
#    apps/desktop/src-tauri/tauri.conf.json  "version"

# 2. 提交后打 tag，必须是 vX.Y.Z（与上面两处版本号完全一致）
git tag v0.1.0
git push origin v0.1.0
```

推 tag 会触发 `.github/workflows/release.yml`，一条矩阵出四个平台的包：

```
verify  ── 校验标签 / 版本号 / 说明文件
   │
   ├─ Windows x64   windows-latest   nsis
   │    Pixel-Pine-Launcher_0.1.2_x64-setup.exe (+ .sig)
   ├─ Linux x64     ubuntu-22.04     deb, appimage
   │    pixel-pine-launcher_0.1.2_amd64.deb
   │    Pixel-Pine-Launcher_0.1.2_amd64.AppImage (+ .AppImage.tar.gz + .sig)
   ├─ macOS arm64   macos-latest     app, dmg（原生 arm64）
   │    Pixel-Pine-Launcher_0.1.2_aarch64.dmg
   │    Pixel-Pine-Launcher_0.1.2_aarch64.app.tar.gz (+ .sig)
   └─ macOS x64     macos-latest     app, dmg（交叉编译 x86_64）
        Pixel-Pine-Launcher_0.1.2_x64.dmg
        Pixel-Pine-Launcher_0.1.2_x64.app.tar.gz (+ .sig)
   │
publish ── 汇总产物 → 生成 latest.json → 创建 Release（prerelease=true）
```

几个刻意的选择：

- **`verify` 单独一个任务**：四个构建任务各自跑十分钟才因标签写错失败，太浪费。
- **`fail-fast: false`**：Linux 少个 webkit 依赖不该让 Windows 的包也发不出去。
  但 `publish` 依赖整个矩阵，任一平台失败就不发——半个平台齐的版本比不发更糟。
- **发版集中在一个 `publish` 任务**：四个平台各自动手 `gh release create` 会互相
  覆盖，尤其是 `latest.json` 被后完成的那个整份重写，结果某个平台永远收不到更新，
  而且不报错。所以各平台只上传 artifact，最后一个任务统一拼。
- **Linux 固定 `ubuntu-22.04`**：glibc 版本由构建机决定，24.04 上打的包在 22.04
  及更老的发行版直接报 `GLIBC_2.39 not found`。
- **两个 macOS 都在 arm64 机器上跑**：`macos-13` 是最后一批 Intel 镜像，迟早下线，
  交叉编译到 `x86_64-apple-darwin` 更稳。
- **打包命令包了一层重试**（`scripts/build-bundles.mjs`）：bundle 阶段会现下
  NSIS / linuxdeploy / AppRun，这些挂在 GitHub release 资源上，2026-11 真的遇到过
  整段 504，而 tauri 自己不重试。Rust 产物已就绪，重试只是重打包，几十秒。

### 产物对照

| 平台 | 给用户下载 | 更新用（latest.json 里引用） |
|---|---|---|
| Windows | `*-setup.exe` | `*-setup.exe` |
| Linux | `.AppImage` / `.deb` | `.AppImage.tar.gz` |
| macOS | `.dmg` | `.app.tar.gz` |

`.sig` 是 minisign 签名，只有客户端更新时会校验，别删。

**只有打版本标签才会打包**：普通提交只跑 CI（fmt / clippy / test），
不产物、不发 Release——避免每推一次代码就多一个「看起来能用」的安装包。

`verify` 任务会校验四件事，任一不符直接失败：

- 标签形如 `vX.Y.Z`
- `v` 后面的部分等于 `tauri.conf.json` 的 `version`
- `tauri.conf.json` 与 `package.json` 的 `version` 一致
- `docs/RELEASE_NOTES.md` 存在（Release 说明和 `latest.json` 的 `notes` 都从它取）

这条校验不是为了规范，而是护栏：自动更新按版本号比大小，
发错版本号的安装包会让用户永远收不到后续更新。

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

`latest.json` 由 `scripts/make-latest-json.mjs` 从产物文件名 + `.sig` 拼出来，
不需要手写：

```json
{
  "version": "0.1.2",
  "notes": "更新说明（取自 docs/RELEASE_NOTES.md）",
  "pub_date": "2026-11-08T05:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "……",
      "url": "https://github.com/…/Pixel-Pine-Launcher_0.1.2_x64-setup.exe"
    },
    "linux-x86_64": {
      "signature": "……",
      "url": "https://github.com/…/Pixel-Pine-Launcher_0.1.2_amd64.AppImage.tar.gz"
    },
    "darwin-aarch64": {
      "signature": "……",
      "url": "https://github.com/…/Pixel-Pine-Launcher_0.1.2_aarch64.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "……",
      "url": "https://github.com/…/Pixel-Pine-Launcher_0.1.2_x64.app.tar.gz"
    }
  }
}
```

平台键必须和 Tauri updater 的命名对齐：`windows-x86_64` / `linux-x86_64` /
`darwin-aarch64` / `darwin-x86_64`。脚本里少任何一个平台都会直接报错退出——
静默漏一个平台，等于那个平台的用户永远停在旧版本，而且没人会发现。

本地可以拿假产物验证脚本（不联网）：

```bash
mkdir -p /tmp/dist && cd /tmp/dist
touch Pixel-Pine-Launcher_0.1.2_x64-setup.exe{,.sig}       Pixel-Pine-Launcher_0.1.2_amd64.AppImage.tar.gz{,.sig}       Pixel-Pine-Launcher_0.1.2_aarch64.app.tar.gz{,.sig}       Pixel-Pine-Launcher_0.1.2_x64.app.tar.gz{,.sig}
printf sig > Pixel-Pine-Launcher_0.1.2_x64-setup.exe.sig   # 四个 .sig 都写点内容
cd - && node scripts/make-latest-json.mjs --dir /tmp/dist \
  --version 0.1.2 --tag v0.1.2 --repo CloudRail-BBS/Pixel-Pine-Launcher --out /tmp/dist/latest.json
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
