# PPL 扩展规范

> 状态：**静态部分已实现**（识别 / 安装 / 启停 / 依赖 / 加载顺序）；
> **运行时未实现**（还不能真正注入游戏进程）。
> 本文同时说明为什么要自己写一套、以及运行时怎么接。
>
> 在线版本（排版更好读）：https://cloudrail-bbs.github.io/Pixel-Pine-Launcher/docs/pplx/

---

## 1. 为什么不用现成的

社区里已经有一套基于 JVM mixin 的加载器（RWML / RWPP），但：

- **许可证不兼容**。那套项目用的是自定义的团队许可证，不是常见的开源许可，
  抄格式、抄目录、甚至只抄描述符字段都有风险。
- **目录会打架**。它占用 `<游戏目录>/extensions/`。如果 PPL 也用同一目录，
  用户同时装两边时，谁启用了谁、谁覆盖了谁，根本说不清。
- **它不是我们能修的**。依赖别人的加载器意味着对方的崩溃、版本升级、
  兼容性变更都会直接砸在 PPL 用户头上，而我们没有修改权。

所以这里定义一套**完全独立**的规范：自己的目录、自己的描述符、自己的包格式。

| | 社区方案 | PPL |
|---|---|---|
| 目录 | `<游戏>/extensions/` | `<游戏>/ppl/extensions/` |
| 描述符 | `META-INF/extension.properties` | 包根 `ppl-extension.json` |
| 包后缀 | `.jar` | `.pplx`（本质是 zip） |
| 依赖解析 | 加载器自己算 | 启动器算好顺序，运行时只执行 |

---

## 2. 包格式

一个 `.pplx` 就是一个普通 zip，根目录包含：

```
ppl-extension.json        必需，描述符
lib/                      （可选）扩展自己的依赖 jar
com/example/Zoom.class    扩展的类
```

没有目录层级的强制要求，但**描述符必须在包根**——
启动器只读这一个条目，不解压整个包。

### 描述符

```json
{
  "schema": 1,
  "id": "org.example.zoom",
  "name": "缩放控制",
  "version": "1.0.0",
  "apiVersion": 1,
  "mainClass": "org.example.ZoomExtension",
  "mixins": ["org.example.mixin.ZoomMixin"],
  "dependsOn": ["org.example.core@>=1.0"],
  "loadAfter": [],
  "loadBefore": [],
  "author": "someone",
  "description": "把缩放上限放宽到 4 倍",
  "minGame": "1.15"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `schema` | ✅ | 格式版本，目前只接受 `1` |
| `id` | ✅ | 唯一标识。**只允许字母、数字、`.`、`-`、`_`**，会变成文件名 |
| `name` | | 展示名，缺省用 `id` |
| `version` | | 仅展示，不参与依赖求解 |
| `apiVersion` | | 需要的运行时 API 版本；高于启动器支持的值会被跳过 |
| `mainClass` | | 入口类，运行时实例化 |
| `mixins` | | 要注入的类清单 |
| `dependsOn` | | 硬依赖。可带 `@` 版本约束，**启动器只取 id**，不做版本求解 |
| `loadAfter` / `loadBefore` | | 软顺序偏好 |
| `minGame` | | 最低游戏版本，仅提示 |

`id` 的字符限制不是洁癖：它会成为文件名，允许 `/` 就等于允许路径穿越。

---

## 3. 加载顺序

启动器在启动游戏前算出顺序，写进清单交给运行时。规则：

1. `dependsOn` 声明的依赖**必须先加载**（硬边）。
2. 再叠加 `loadAfter` / `loadBefore` 的软边。
3. 同时可用时，按 **id 字典序**取最小——顺序必须是确定的，
   否则同一批扩展在两台机器上加载顺序不同，问题会变得无法复现。
4. 有环 → 整组不加载，界面明确报出来。
5. 缺依赖 → **只跳过缺依赖的那一个**，其余照常加载。
   少一个扩展总比整组罢工好。
6. `apiVersion` 高于运行时 → 跳过并提示。

这几条都有单元测试覆盖（`crates/ppl-core/src/extensions.rs`），
因为顺序错会让游戏直接崩溃，不能靠用户来试。

### 目录布局

```
<游戏目录>/
└─ ppl/
   └─ extensions/
      ├─ org.example.zoom.pplx     启用中
      └─ .disabled/
         └─ org.example.old.pplx   已停用
```

启用 / 停用就是在这两个目录之间移动文件：可逆、不删数据，
用户手动也能还原。和 Mod 的 `.disabled/` 是同一套思路。

---

## 4. 打包

```bash
# 目录结构：
#   my-ext/
#     ppl-extension.json
#     com/example/Zoom.class

cd my-ext && zip -r ../org.example.zoom.pplx . -x '.*'
```

包里必须有描述符，否则启动器会拒收并在界面上标为「包已损坏」——
不会悄悄放行一个永远不会生效的文件。

---

## 5. RWML 兼容模式（可选）

启动器也能管理社区加载器（RWML）的扩展，**默认关闭，用 PPL 格式**。

| | PPL | RWML |
|---|---|---|
| 目录 | `<游戏>/ppl/extensions/` | `<游戏>/extensions/` |
| 描述符 | `ppl-extension.json` | `META-INF/extension.properties` |
| 包 | `.pplx` | `.jar` |

边界说清楚，避免误会：

- **只做互操作**：读取对方描述符里的 `id` / `mainClass` / `dependsOn` 用于展示，
  不加载、不注入、不包含对方任何代码。格式兼容属于互操作，不复用其实现。
- **不替用户装加载器**：RWML 本体由用户自行安装；启动器只检测
  `game-lib.jar.original` 与 `rwml-runtime` 是否存在，不存在就提示。
- **停用方式尚未实测**：把 jar 移进 `extensions/.disabled/` 是基于「按目录扫描」的推测。
  若不生效，改成重命名后缀。

两套目录不重叠，同时安装互不干扰。

## 6. 运行时（尚未实现）

静态部分只负责「装好、排好、告诉运行时」。真正改写游戏类的是
一个 **JVM agent**，计划如下（**目前没有任何代码**，不要当成已实现）：

```
启动器                       运行时（agent）
  │  算出 order                │
  │  写 ppl/runtime/plan.json  │
  ├───────────────────────────▶│  读 plan.json
  │  java -javaagent:...       │  按顺序加载各 .pplx
  │                            │  ClassFileTransformer 注入 mixin
  └────────────────────────────┘
```

需要先解决的前置问题（都属于 spike，没结论前不写生产代码）：

| 问题 | 为什么必须先验证 |
|---|---|
| 游戏的启动入口能否传 JVM 参数 | 有些打包器把参数吃掉了，`-javaagent` 可能根本传不进去 |
| 游戏用的是哪个 JRE、版本多少 | agent 的 class 版本必须不高于运行时 |
| 类名映射从哪来 | 混淆过的 jar，没有映射就写不出可用的 mixin |
| Android 端怎么办 | 那边是 dex，JVM agent 完全不适用，需要另一套 |

在这些问题有答案之前，PPL 的扩展只做到「管理」，
界面上也明确写着运行时未接入——**宁可少一个功能，也不要给一个装完没反应的按钮**。

---

## 7. 给扩展作者的话

- 描述符里的 `id` 一旦发布就别改：依赖关系、文件名都挂在它上面。
- 别在 `dependsOn` 里写版本约束来「锁版本」，启动器不做版本求解，
  写了也只会被忽略。
- 扩展之间要协作就抽一个 `core` 扩展出来，让其他扩展依赖它，
  而不是互相 `loadAfter` 打转。
