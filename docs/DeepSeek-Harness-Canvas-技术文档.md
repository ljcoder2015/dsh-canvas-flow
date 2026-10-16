# DeepSeek Harness 通用创作画布插件 · 技术文档

**版本**：v1.67  
**最近更新**：2026-09-30  
**状态**：技术架构已按 [`dsh-plugin-template`](https://github.com/bugmaker2/dsh-plugin-template) 与 DeepSeek Harness 子系统文档（`docs/cookbook/*`、`docs/subsystems/*`）校准，并在真机跑通  
**产品文档**：[`DeepSeek-Harness-Canvas-产品文档.md`](./DeepSeek-Harness-Canvas-产品文档.md)——功能点清单（F1.1–F10.4）、MVP 范围、设计决策记录、修订记录都在那边  
**定位**：这个双端插件的完整技术设计。底座的形态约束、源码分层、跨端契约、Host 与 Client 两侧的职责边界、数据落点、构建与安装，各占一章

## 阅读约定

- 本文档章节号是**中文数字**（一～十二）。文中出现的 `§<数字>.<数字>`（如 `§3.6`）与 `F<数字>.<数字>`（如 `F5.2`）**一律指产品文档**里的章节与功能点编号，本文档内互引则写作 `§<中文数字>`（如 `§11`）。
- **§11 集中列出与初版技术设想不一致之处及其影响，建议优先阅读。**
- 修订历史、功能口径与产品边界不在这里，见产品文档。

## 一、技术底座：双端插件

本插件是一个**双端插件**：Host 半跑在 Node（Cordis 插件），Client 半跑在浏览器（Web harness 模块）。

| 项         | 结论                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------- |
| Host 入口   | `src/index.ts`，导出 `name` / `inject` / `Config`（schemastery 校验 + 默认值）/ `apply(ctx, config)`              |
| Client 入口 | `src/client/index.tsx`，导出 `inject`（`slots` / `remote` / `locale`）/ `apply(ctx: ClientContext)`          |
| 双端通信      | Typert Remote：Host 侧 `TypertRemoteService` + `@Remote` 方法，浏览器侧经 `ctx.remote.<namespace>` 调用             |
| 浏览器加载     | 打包为 `lib/client.js`，由 `window.__ModuleLoader__.load` 注册，Web harness 的模块加载器按 `dsh.client` 扫描结果加载         |
| 依赖要求      | Node `^22.19 \|\| >=24`，pnpm `>=9`（模板用 10），`dsh >=0.1.0-rc.6`                                           |
| 插件清单      | Harness 唯一必需的是 `package.json`；`dsh.plugin.json` 面向 dsh.so 注册表，`cordis.patch.yml` 负责把 Host 插件行挂进 profile |


## 二、插件目录结构

```
dsh-canvas/
├── package.json              # 唯一 Harness 清单：dsh.bundle.patch + dsh.client
├── cordis.patch.yml          # 把 Host 插件行挂进 profile（可覆盖 Config 默认值）
├── dsh.plugin.json           # dsh.so 注册表清单：id / engines / contributes
├── build.mjs                 # esbuild 双端打包 + 引擎 chunk + fig worker + 资产拷贝（§10）
├── eslint.config.js
├── tsconfig.json             # typecheck：src
├── tsconfig.build.json       # 只产声明 → lib/types
├── tsconfig.tests.json
├── vitest.config.ts
├── src/
│   ├── index.ts              # Host 入口：Config schema + apply
│   ├── contract.ts           # 双端共享的严格 wire 契约（唯一真源）
│   ├── types.ts              # 双端共享类型
│   ├── domain.ts             # 画布持久化领域声明（defineDomain）
│   ├── typert.ts             # Host Typert manifest
│   ├── capabilities.ts       # 部署能力探测（可选席位按能力降级）
│   ├── host/                 # 宿主运行时：装配 + 两个 Remote 服务
│   │   ├── canvas-runtime.ts     # CanvasRuntime：画布/引用链/排布（Remote 服务）
│   │   ├── card-runtime.ts       # CardRuntime：卡片产物读写/注入/导出/发布
│   │   ├── tools.ts              # canvas_* 工具注册（defineTool × 16）
│   │   ├── prompt.ts             # 卡片会话的 prompt 注入段落
│   │   └── board-file.ts         # 板面投影的读写（接 ctx.fs + 从域的表组装）
│   ├── core/                 # 纯逻辑层，不依赖 Cordis
│   │   ├── canvas/               # 画布模型
│   │   │   ├── ids.ts                # 存储键的定宽转义 + 路径摘要身份
│   │   │   ├── board.ts              # 排布策略
│   │   │   ├── board-file.ts         # 板面文件：格式/编解码 + 身份与导入决策（纯）
│   │   │   ├── card-name.ts          # 卡片名与产物路径的对齐：默认名 / 建卡铸名 / 改名几何 / 撞名递补（纯）
│   │   │   ├── source-store.ts       # 引用边存储
│   │   │   └── workspace.ts          # 画布即工作区（登记与挂账）
│   │   ├── artifact/             # 产物：认定 / 读写 / 页面 / 引用
│   │   │   ├── kind-registry.ts      # 形态注册表（HTML_KINDS 的唯一出处）
│   │   │   ├── artifact-io.ts        # 文件读写唯一出口（沙箱策略在此定夺）
│   │   │   ├── webapp.ts             # 应用脚手架 + 预览链接闸门
│   │   │   ├── preview-picker.ts     # 预览元素探针（注入页面的脚本 + 纯函数）
│   │   │   ├── file-reference.ts     # 连线底层：宿主 @file 语法的逐字节复刻
│   │   │   └── design/               # 设计稿的纯部分：信封编解码 / 导出该用的字体名 / 属性面板判据表 / 页面操作 / PDF 端 SVG 修整（v1.64）
│   │   └── session/              # 卡片会话：绑定 / 日志 / 模型 / 工具
│   │       ├── session-manager.ts    # 卡片会话生命周期与归属
│   │       ├── session-log.ts        # 读会话事件日志（冷会话照读）
│   │       ├── model-routing.ts      # 卡片会话的模型来源
│   │       └── agent-preset.ts       # 卡片会话的工具来源
│   └── client/
│       ├── index.tsx             # Client 入口：mount Remote + 注册席位
│       ├── wire/                 # 通道层（bridge 与 model-memory 互引，必须同目录）
│       │   ├── bridge.ts             # Remote 调用的类型化适配层
│       │   ├── remote.ts             # Client Remote 贡献 + 类型化 namespace
│       │   ├── address.ts            # 读宿主的资源地址语法
│       │   ├── model-memory.ts       # 按节点类型记住用户上次选的模型
│       │   └── session-read.ts       # 从会话域推卡片的脸（订阅，不镜像）
│       ├── canvas/               # 画布面
│       │   ├── canvas-view.tsx       # 无限画布正文
│       │   ├── source-edges.tsx      # 引用线几何
│       │   ├── reference-options.ts  # @ 引用候选：路径 / 卡片名 / 座位 id 三件事各是各的（纯）
│       │   ├── card-tile.tsx         # 卡片（含流光层）
│       │   ├── card-face.tsx         # 卡面描述（画布 tab 与形态 tab 共用）
│       │   ├── card-shot.ts          # 卡面那两张「截图」素材（设计/应用活在渲染之后）
│       │   ├── card-overlay.tsx      # 选中态控制带（右下角把手：拖动改尺寸）
│       │   ├── composer-size.ts      # 把手的算术（纯）：上下限与 zoom 换算
│       │   ├── export-plan.ts        # 这张卡点〔导出〕给什么：一击 / 菜单 / 什么都没有（纯，v1.59）
│       │   ├── text-export.ts        # 文本节点本地排版 md / txt / docx（v1.57）
│       │   ├── text-pdf.ts           # 文本排成 PDF 字节（矢量、文字可搜，v1.57）
│       │   ├── bundle-export.ts      # 应用节点：整份产物装成一个 zip（v1.58）
│       │   ├── design-export.ts      # 设计节点：四样产物的命名 / 装包 / 收场（纯，v1.59）
│       │   ├── download.ts           # 那一次「保存到本机」（对象 URL + a[download]）
│       │   ├── notice.ts             # 画布左上角那条提示：说什么 + 哪一档（纯）
│       │   ├── wheel-owner.ts        # 滚轮归谁：画布 / 自己会滚的盒子 / ⌘ 缩放（纯）
│       │   ├── canvas-nav.tsx        # 左栏画布包裹（Portal）
│       │   ├── canvas-menu.tsx       # 画布行的操作菜单与删除确认
│       │   ├── row-actions.ts        # 那一行该给出哪几个动作（纯策略）
│       │   ├── open-folder.ts        # 交给文件管理器打开画布目录
│       │   ├── project-catalog.ts    # 活动画布清单（不轮询）
│       │   ├── canvas-panels.tsx     # 主面板 / 侧栏席位
│       │   ├── canvas-tab.ts         # 右栏 tab 类型（工作台页 + 每形态认领）
│       │   ├── folder-picker.tsx     # 新建画布时挑目录
│       │   └── material-notice.ts    # 引用提交后那句话（纯策略）
│       ├── artifact/             # 产物面
│       │   ├── registry.ts           # 预览注册表：kind → 预览器（只剩认领，没有能力）
│       │   ├── artifact-view.tsx     # 全屏弹窗外壳（读产物 / 分派 / 骨架 / Esc 与关闭裁决）
│       │   ├── chrome.tsx            # 交给预览器的壳：三个插槽 + 两条登记通道
│       │   ├── chrome-stack.ts       # 「这一下谁收」的顺位（纯）
│       │   ├── use-artifact-payload.ts   # 打开时读一次产物（payload 整窗共享）
│       │   ├── viewers/              # 每种形态一个子文件，注册项与组件同处
│       │   │   ├── types.ts              # 公共契约：ViewerId / ViewerProps / 注册项
│       │   │   ├── markdown.ts           # 渲染（纯）
│       │   │   ├── markdown-viewer.tsx
│       │   │   ├── media-viewer.tsx      # 图片 / 视频
│       │   │   ├── deck-viewer.tsx       # 沙箱 iframe + 链接闸门 + 元素选择（自己那套）
│       │   │   ├── delimited.ts          # 切行状态机（纯）
│       │   │   ├── data-viewer.tsx
│       │   │   ├── text-viewer.tsx       # 兜底
│       │   │   ├── design-canvaskit.ts   # CanvasKit 加载（可选资产，失败即降级，绝不抛）
│       │   │   ├── design-skia.ts        # Skia 后端；**导出用的那台渲染器也出自这一份**（v1.59）
│       │   │   ├── design-render.ts      # 渲染器选择与取景（纯）
│       │   │   ├── design-viewer.tsx     # 设计卡预览：画布 + 编辑闭环 + 面板
│       │   │   ├── design-panels.tsx     # 图层 / 属性 / 历史三块面板（React 自持）
│       │   │   ├── design-engine-types.ts    # 引擎 chunk 两端共享的形状（只有类型）
│       │   │   ├── design-engine-module.ts   # chunk 加载器（**只此一份**，失败即 null）
│       │   │   ├── design-engine.ts          # chunk 入口：渲染与导出两个出口
│       │   │   ├── design-pdf.ts             # PDF 那条：自己建文档 + 嵌中文字面（v1.61）
│       │   │   └── design-io.ts              # 四样出路：fig / png / pdf / pptx（v1.59–v1.61）
│       │   ├── editing/              # markdown / 纯文本的编辑面
│       │   │   ├── use-text-editing.ts       # 状态机（hook）：草稿 / 自动保存 / 写被拒
│       │   │   ├── editable-text.tsx         # 头部控件 + 条带 + 编辑框（两个文本预览器共用）
│       │   │   ├── writable.ts               # 这份 payload 能不能整篇写回（纯）
│       │   │   ├── seed-blank.ts             # 「手动输入」落到空座位：先落一份空文件再回读（纯，假 wire 可跑）
│       │   │   ├── mode.ts                   # 预览↔编辑的方向键（纯）
│       │   │   └── autosave.ts               # 节律 / 退避 / 写被拒的形状（纯）
│       │   ├── element-pick/         # 元素选择 F3.14：开关 / 选中圈 / 提示词框 / 交给会话 / 跨关闭的那一笔
│       │   │   ├── element-pick.tsx          # 状态机（hook）：挑 → 写 → 等，含回读产物
│       │   │   └── pending.ts                # 这一笔跨关闭的记忆（纯；按卡记，不落盘）
│       │   ├── artifact-tab.tsx      # 形态 tab：认领地址后画卡面
│       │   └── tool-view.tsx         # canvas_* 的实时工具卡片（代码直播框）
│       └── ui/                   # 底座：文案 / 样式 / 席位 / 键位
│           ├── locales.ts
│           ├── styles.ts
│           ├── seats.ts              # 借用别包的席位（运行时只要一个字符串键）
│           └── shortcuts.ts          # 键位真源 + 说明表
└── tests/                    # 51 个 spec，镜像 src 分层
    ├── contract.spec.ts          # 协议基座（镜像 src/ 根）
    ├── core/                     # core.spec.ts 跨三域，另有 canvas/ artifact/ session/
    ├── host/                     # prompt · tools
    └── client/                   # wire/ canvas/ artifact/ ui/
```

**尚未落地的申报与不一致**（发布前需处理）：

- `dsh.plugin.json` 的 `contributes.skills` 申报了 `canvas-operations`，`package.json` 的 `files` 也收了 `skills/`，但**该技能包与 `skills/` 目录当前都不存在**；要么补上，要么从两处申报里撤掉。
- **CI 未落地**：仓库里没有 `.github/workflows/`，`check` 目前靠本地跑（见 §10）。
- `package.json` 声明 `packageManager: pnpm@10.17.0`，但仓库里跟踪的是 `package-lock.json`（npm）、没有 `pnpm-lock.yaml`——本地按 npm 跑、发布路径按 pnpm，需择一。

**拆分的判据**：`src/` 根只留**入口与协议基座**（零依赖、只被依赖），其余四层**依赖方向单向向下**——`host/` 依赖 `core/` 与协议，`core/` 谁都不依赖（它 import 到 `host/` 就是环），`client/` 自成一棵树。两个**构建入口路径刻意不动**，所以 `build.mjs`、`package.json` 的 `exports`、`dsh.plugin.json`、`cordis.patch.yml` 都不随目录调整而改动。

**产物面的判据**（`src/client/artifact/`）：`registry.ts` 是 kind → 预览器的**唯一分派点**——一行一个预览器，每行只说它**认领哪些 kind**（`claims`）与谁兜底（`fallback`，标出来而不靠排在最后——顺序是看不见的约定，重排一次就会静默截走所有 kind）。**表里没有能力**（v1.42）：弹窗给三个**插槽**（头部右侧、头部下方那一条、遮罩层）与两条登记通道（Esc 与关闭的顺位），按钮、提示条、选中圈由各预览器自己挂进去，连同它们的判断与状态——所以**加一种形态 = 加一个文件（注册项与组件同处）+ 在注册表 import 一行**，调用方一行都不用改。外壳因此完全不知道有哪些按钮。「产物是不是它自己的文字」也挪出了注册表，回到 kind 表上的事实（`isDirectTextKind`），由控制带与文本预览器各读一次同一份。此前这条纪律是散的——「谁能编辑」是 `artifact-view.tsx` 里另一个函数里的另一个 `if`，「谁有页面帧」是弹窗硬编码的 `viewerIdFor(kind) === 'deck'`，而 HTML 家族的 kind 清单在宿主与视图层各抄了一份。

与初版设想的差别：UI 不放在独立 `ui/` 目录，而是 `src/client/`（浏览器半，其内部再分 `wire` / `canvas` / `artifact` / `ui` 四层）；Host 能力的落点不是 `tools/*.ts` 里的裸函数，而是**两个 Remote 服务类 + 一个工具注册模块**（今天在 `src/host/`）。

## 三、清单三件套与命名一致性

Harness 只认 `package.json`。两个关键字段把它变成插件：

```json
{
  "name": "dsh-canvas-flow",
  "version": "1.0.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-primitives",
        "@deepseek-ai/dsh-client-resources"
      ]
    }
  },
  "files": ["lib", "cordis.patch.yml", "dsh.plugin.json", "README.md", "LICENSE"],
  "engines": { "node": "^22.19 || >=24", "dsh": ">=0.1.0-rc.6" }
}
```

`cordis.patch.yml` 负责把 Host 插件挂进 profile，并可在此覆盖 `Config` 默认值：

```yaml
- insert:
    - id: 'dsh-canvas-flow'
      name: 'dsh-canvas-flow'
      # 可选：覆盖 src/index.ts 的 Config 默认值
      # config:
      #   workspaceRoot: ./canvas
```

`dsh.plugin.json` 是 dsh.so 注册表清单，也是工具/技能贡献的申报处：

```json
{
  "id": "dsh-canvas-flow",
  "version": "1.0.0",
  "main": "lib/index.js",
  "engines": { "dsh": ">=0.1.0-rc.6" },
  "contributes": { "tools": ["canvas_read_card", "canvas_read_sources", "..."], "skills": ["canvas-operations"] }
}
```

> `contributes` 字段本身在模板中存在（模板填的是空数组），其**条目格式**尚未核对注册表文档——发布前需确认这里是工具名清单还是完整贡献对象。

**改名时必须同步的位置**（v1.50 按实际落刀校准）：模板那份一张表列到底，实测要分两类——**包身份**必须逐字等于 npm 包名（模型层按它归因两侧贡献、profile 按它定位模块），**命名空间键**则是本插件内部的注册键，与包名没有解析关系。

**一、包身份**（`tests/contract.spec.ts` 钉死前缀，漏一处即模型层归因对不上）：

| 位置                          | 字段                                                                     | 为什么                                                     |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| `package.json`              | `name`                                                                 | 唯一真源；profile 的依赖键与 `dsh.profile.bundles` 都按它            |
| `cordis.patch.yml`          | `name`、`id`                                                            | `name` 是 profile 里的模块定位符，`id` 是 patch 层要覆盖的实例 id        |
| `dsh.plugin.json`           | `id`                                                                   | 注册表清单                                                   |
| `build.mjs`                 | `__ModuleLoader__.load` 的 `id`                                         | 客户端 bundle 的装载键                                         |
| `src/index.ts`              | `name`                                                                 | 取 `PACKAGE_NAME`（cordis 视角的插件名）                         |
| `src/typert.ts`             | `package`                                                              | 取 `PACKAGE_NAME`                                        |
| `src/client/wire/remote.ts` | `package`                                                              | 取 `PACKAGE_NAME`——**最容易漏的一处**：两端各写一次，没有它就只有 Host 那半边归对包 |
| `src/contract.ts`           | descriptor `id`（`<package>#<service>/<method>`，40 处）＋ typeSymbol（53 处） | 契约身份                                                    |

后面四处都由一行常量兜住：`src/contract.ts` 的 **`PACKAGE_NAME`** 是包身份的唯一真源，`index.ts` / `typert.ts` / `remote.ts` 从它读，contract spec 另有一条断言钉「两侧贡献归同一个包」。

**二、命名空间键**（不随包名走，刻意留在短词上）：

| 位置                                | 值                                                      | 说明                                                  |
| --------------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| `src/host/prompt.ts`              | `PLUGIN_ID = 'dsh-canvas'`                             | 日志与 effect 标签、注入消息来源、提示词小节名前缀（`dsh-canvas:tools` 等） |
| `src/client/ui/locales.ts`        | `NS = 'dsh-canvas'`                                    | locale 命名空间（两端同一个常量，自洽）                             |
| `src/client/canvas/canvas-tab.ts` | `'dsh-canvas:workbench'` / `'dsh-canvas:kind:'`        | tab 类型 id                                           |
| `src/host/assets.ts`              | `ASSET_ROUTE = '/dsh-canvas/assets'`                   | 资产**路由**（URL，不是包名）                                  |
| `src/capabilities.ts`             | `CAPABILITIES_SERVICE_KEY = 'dsh-canvas.capabilities'` | **部署侧**实现者按这个名字注册，改它等于改跨包契约                         |
| `src/client/wire/model-memory.ts` | `'dsh-canvas:model-by-kind:v1'`                        | 浏览器本地存储键（改了会丢用户已选的模型）                               |
| 画布目录 / 样式                         | `.dsh-canvas/board.json` / `.dsh-canvas-*`             | 目录约定与 CSS 类前缀                                       |

> 包名现为 **scoped 的 `dsh-canvas-flow`**（v1.50 起走 scope；v1.69 由 `@ljcoder2015/dsh-canvas` 改为 `dsh-canvas-flow`）：裸名 `dsh-canvas` 在 npm 上被他人占位（2026-08-19 发布的 0.0.1），发布只能走 scope。**GitHub 账号名（`github.com/ljcoder2015/…`）与 npm scope 是两件事**，改名只动包身份，仓库地址、`LICENSE` / `README` 署名照旧。服务键 `canvas` 的十六进制命名空间名仍是 `TypertRemoteNamespace$63616e766173`、`card` 是 `$63617264`——它由**服务键**决定，与包名无关。

## 四、契约层：一份 descriptors，三处引用

双端不漂移的机制是**单一真源**：一份 wire 契约同时被 Host manifest 与 Client 贡献引用。

```typescript
// src/contract.ts —— 双端共享的严格 wire 契约（唯一真源）
import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

export const cardIdSchema = z.string().trim().min(1).max(400)
export const cardSummarySchema = z.object({
  cardId: cardIdSchema, kind: z.string(), path: z.string(),
  summary: z.string(), outline: z.array(z.string()),
  bytes: z.number(), updatedAt: z.number(),
}).readonly()

export const DSH_CANVAS_INVOCATIONS: readonly InvocationDescriptor[] = [
  {
    id: 'dsh-canvas-flow#card/read_sources', service: 'card', namespace: 'card', method: 'readSources',
    invocation: { kind: 'direct' }, parameters: [], cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: 'dsh-canvas-flow#CardSummaryList', schema: z.array(cardSummarySchema) },
  },
  // …其余 canvas.* / card.* 方法同理，一个方法一条 descriptor
]
```

```typescript
// src/typert.ts —— Host manifest：告诉模型层这个插件提供了什么
import { DSH_CANVAS_INVOCATIONS } from './contract.ts'

export const TYPERT_MANIFEST: TypertContribution = {
  package: TYPERT_PACKAGE, face: 'host', schemas: [],
  model: {
    services: [
      { key: 'canvas', exportName: 'CanvasRuntime', description: '画布座次与引用链。', tags: [], members: [ /* 每个方法一条 */ ], types: [] },
      { key: 'card', exportName: 'CardRuntime', description: '卡片产物读写与引用。', tags: [], members: [ /* … */ ], types: [] },
    ], events: [], objects: [],
  },
  invocations: DSH_CANVAS_INVOCATIONS,
}
```

```typescript
// src/client/wire/remote.ts —— Client 贡献：与 Host manifest 指向同一个数组
import { DSH_CANVAS_INVOCATIONS } from '../contract.ts'

export const DSH_CANVAS_REMOTE: TypertRemoteContribution = {
  package: PACKAGE_NAME, descriptors: DSH_CANVAS_INVOCATIONS,
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$63617264 {
    readSources: (signal?: AbortSignal) => Promise<RemoteResult<CardSummary[]>>
    // …
  }
  interface TypertRemoteMap { 'card/read_sources': TypertRemoteNamespace$63617264['readSources'] }
  interface TypertRemoteNamespaceMap { card: TypertRemoteNamespace$63617264 }
}
```

**失败面只有一个类**：不建域异常家族，域码经 declaration merging 进 `RemoteErrorDetailsMap`，抛出点直接 `throw new RemoteError('<域>/<理由>', message, details)`；与端点无关的异常不预归类，由 Gateway 兜成 `gateway/internal`。Client 侧调用返回 `RemoteResult<T>`，`if (!result.ok)` 分支判 `code`（不要判 `instanceof`），本地缺陷继续上抛。

契约一致性可直接测死（模板同款断言）：

```typescript
it('host 与 client 共用同一份 descriptor 列表', () => {
  expect(TYPERT_MANIFEST.invocations).toBe(DSH_CANVAS_INVOCATIONS)
  expect(DSH_CANVAS_REMOTE.descriptors).toBe(DSH_CANVAS_INVOCATIONS)
})
```


## 五、Host 侧：服务划分与核心模块

| 模块                                  | 职责                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 归属                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `CanvasRuntime`（namespace `canvas`） | 画布座次、引用边增删查、上游链排布、归纳收纳、便签创建、**当前画布记账**（v1.31：`setActiveProject` 写领域全局 `activeProjectId`，画布级工具据此取项目）、**绑定目录时的身份判定与板面导入**（v1.47：`createProject` 先读目录里的板面文件决定「这是哪张画布」，再按 `planSeats/planEdges/planNotes` 补齐板面；每个改动板面的方法末尾写回投影）                                                                                                                                                                                                                          | `src/host/canvas-runtime.ts`          |
| `CardRuntime`（namespace `card`）     | 卡片产物摘要读取、上游（引用来源）读取、跨卡片注入、导出、发布、生图、**上游产物的文件引用提交**（v1.37：`referenceFiles`）、**上下卡与批量清理**（v1.47：`removeCard` / `removeMissingCards` 共用一条 `unseat` 级联——先释放会话、再删它的边、最后删座位，顺序反了会留下删不掉的悬空线。批量清理只清**证明得了不存在**的卡：`presenceOf` 三态里 `unknown` 一律留下，`seatedEmpty` 的空座位留下，项目根自己探不到时整体拒绝——那时「所有卡都缺」既可能是真的、也可能是探针坏了，这里分辨不出，清空画布该走 `removeProject`）、**卡片改名**（v1.53：`renameCard` —— 名字与磁盘上那一项一起改，几何全在 `core/canvas/card-name.ts`，这里是唯一一处直调 `node:fs` 的地方，理由与三道闸见 §九） | `src/host/card-runtime.ts`            |
| `board-file`（纯）                     | 板面文件的格式、编解码与两个决策：`planIdentity`（新画布 / 复用 / 搬家 / 复制四态）、`planSeats/planEdges/planNotes`（打开目录时该补哪些卡片、边、便利贴）。全部对普通数据的纯函数，于是每条规则都能在容器外测                                                                                                                                                                                                                                                                                                                   | `src/core/canvas/board-file.ts`       |
| `board-file`（宿主）                    | 把上面那份格式接到 `ctx.fs` seam（沙箱策略与写前 waterfall 照旧生效），并从 `projects/cards/sources/notes` 表组装投影；**内容未变则跳过写**，**读不懂的文件绝不覆盖**，写失败只记日志                                                                                                                                                                                                                                                                                                                          | `src/host/board-file.ts`              |
| `kind-registry`                     | 文件证据 → 形态认定（纯函数：扩展名 + 内容嗅探）                                                                                                                                                                                                                                                                                                                                                                                                                          | `src/core/artifact/kind-registry.ts`  |
| `source-store`                      | 引用边的增删查与自动对账，落在存储领域之上                                                                                                                                                                                                                                                                                                                                                                                                                                | `src/core/canvas/source-store.ts`     |
| `file-reference`                    | **连线的底层**（v1.37）：Harness 自己的 `@file` mention 语法的逐字节复刻——`formatFileMention`（普通路径 / 带空白加引号 / 目录尾斜杠 / 引号不闭合 / 控制字符与双引号拒绝）、`nameFileReferences`（保序、去重、把写不出来的路径报进 `skipped`）、`nameWithoutProbe`（不探测 I/O 时一律文件形态——`site`/`webapp` 卡是**文件**不是目录）与引用块渲染；零依赖、不 import harness 包                                                                                                                                                                               | `src/core/artifact/file-reference.ts` |
| `session-manager`                   | `cardId → sessionId` 绑定、会话状态（空闲/运行中/有通知）                                                                                                                                                                                                                                                                                                                                                                                                             | `src/core/session/session-manager.ts` |
| `model-routing`                     | 卡片会话的模型来源：新会话用部署默认 `agentOptions`，已记录的会话选择在开卡时交回控制器                                                                                                                                                                                                                                                                                                                                                                                                  | `src/core/session/model-routing.ts`   |
| `agent-preset`                      | 卡片会话的**工具来源**：从部署的 agent preset 组装，否则该会话没有任何文件写入工具（见 §5「卡片会话的工具从哪里来」）                                                                                                                                                                                                                                                                                                                                                                                | `src/core/session/agent-preset.ts`    |
| `session-log`                       | 输入框回填的取数侧：从会话事件日志读用户最近一条**自己发出的**消息（`source.kind === 'user'` 才算），冷会话经部署的 `ctx.sessionQuery.readSession` 读持久化（见 §3.3 F3.9）                                                                                                                                                                                                                                                                                                                            | `src/core/session/session-log.ts`     |
| `workspace`                         | 画布即工作区（F1.6）：经部署的 `ctx.workspaceRegistry` 把画布根目录登记为工作区（`create(root, title)` 幂等）并把卡片会话挂账（`attachSession`，要求会话头 cwd 规范化后等于工作区路径）；无名册部署整体空操作，失败只记日志                                                                                                                                                                                                                                                                                                    | `src/core/canvas/workspace.ts`        |

```typescript
// src/host/canvas-runtime.ts —— Host Remote 服务
export class CanvasRuntime extends TypertRemoteService {
  constructor(ctx: Context, private readonly deps: CanvasRuntimeDeps) { super(ctx, 'canvas') }

  /** 记录用户当前打开的画布——画布级 agent 工具按它取项目（v1.31）。 */
  @Remote
  async setActiveProject(projectId: ProjectId, signal?: AbortSignal): Promise<Project> { /* … */ }

  /** 读取画布当前座次与引用边。 */
  @Remote
  async readBoard(projectId: ProjectId, signal?: AbortSignal): Promise<BoardSnapshot> { /* … */ }

  /** 按引用链分层摆位。 */
  @Remote
  async arrange(projectId: ProjectId, strategy: ArrangeStrategy, signal?: AbortSignal): Promise<BoardSnapshot> { /* … */ }
}
```

**Agent 工具注册**用的是 Harness 的工具流水线，而不是裸函数（`inject: ['tools']`）：

```typescript
// src/host/tools.ts
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = PACKAGE_NAME
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'canvas_read_sources',
    description: '读取当前卡片引用来源（直接上游产物）的摘要。',
    parameters: {},                                    // 无参数：引用只取上一级，层数不是调用方可选的东西（v1.46 撤掉形同虚设的 depth）
    output: {
      schema: { type: 'array' },                       // 规范 JSON 值
      render: (_args, value) => [{ type: 'text', text: renderSummaries(value) }],
    },
    async execute(_args, exec) {
      // exec 携带调用身份与 signal；args 已按 schema 校验
      return await readUpstreamSources(ctx, exec.agent)
    },
  }))
}
```

三条硬约束（来自工具参考文档）：

1. **参数已为你校验**，`execute` 内的 args 就是类型化结果；但非空字符串、正数、跨字段规则要自己查。
2. **`execute` 只返回规范 JSON 值**，不要返回内容块；人类可读解释放进 `output.render`。抛异常或返回非法值即 `isError`。
3. **必须遵守 `exec.signal`**，长任务走 `ctx.jobs.start(...)`（后台任务运行时）。

**按卡片收敛可见工具集**（会话隔离的落地手段）：工具注册表是分层的——`ctx.tools.register()` 可在调用方作用域内注册（作用域内工具遮蔽全局同名工具），`ctx.tools.restrict({ allow, deny })` 可为某个 agent 作用域裁剪全局工具，`ctx.tools.get(name, scope)` / `schemas(scope?)` 按作用域解析。因此「卡片 A 的会话拿不到卡片 B 的产物」不是靠 prompt 约定，而是靠**注册作用域 + 可见性过滤**。

**卡片会话的创建路径**（重要约束）：`ctx.sessions.create()` 由**调用方 fiber 拥有**，fiber 销毁即会话下架；而会话日志的持久化写入器由 **agent 生命周期**在发布时挂上——**脱离 agent 生命周期创建的会话不落盘**。所以卡片会话必须经 agent 工厂（`prepare` + `enter` + `announce` 事务）创建，插件只负责记录 `cardId → sessionId` 与生命周期编排。

**卡片会话的模型从哪里来**（本条是上一条的代价，落地于 `src/core/session/model-routing.ts`）：普通会话由 `dsh-api-session-controller` 组装，组装内容除 agent 本身还有两样——`AgentOptions.provider/model`（取自 `agentDefaultModel.currentSelection()`）与"本会话的模型选择"（控制器在 agent 作用域上装一个选择引用）。卡片会话由插件自己经工厂创建，**这两样都得自己补**：

1. **`agentOptions` 必须给**：agent loop 用 `AgentOptions.provider/model` 构建每一次请求，缺失时直接报 `agent "<id>" has no provider/model`；同时部署的提示词段落（persona prefix）用 `{{provider}}`/`{{model}}` 取同一个字段，缺了连**系统提示词装配都过不去**（`prompt variable "{{model}}" has no value for this assembly`）。所以创建与恢复卡片 agent 时都带上部署默认模型。
2. **本会话已记录的选择要装回去**：选择活在会话日志里（`modelSelection` 投影的 `pending`／`lastUsed`），而 agent 每次重开都是新的。控制器装选择的那个内部方法不是公开 API，但**触发它的调用是公开的**——`sessionController.selectModel`，与宿主输入框模型席位同一条 wire 调用。插件的做法：agent 一发布就把会话自己的选择交给这次调用（每个 agent 一次），于是"上次选的模型"跨插件重载仍然生效，而策略本身始终归控制器所有。
3. **顺序即优先级**：全新会话用部署默认 → 有记录的选择覆盖它 → 会话存活期间的模型切换（输入框选的那次）覆盖以上两者（控制器的选择引用在装配与请求两处都生效）。

**卡片会话的工具从哪里来**（与前一条同源，落地于 `src/core/session/agent-preset.ts`）：模型面向的**文件工具不在 Host 组装里**。`dsh-web-app` 的 patch 把基座的 `tool-fs`／`tool-bash`／`tool-pwsh`／`tool-jobs`／`tool-fs-search`／`skill-filesystem`／`tool-skill`／`tool-goal`／`plan-mode`／`tool-subagent*` 全部 disable，改由每个会话**挂载一个 agent preset** 来组装——这是 Web 面的既定分工，不是配置疏漏。

卡片会话既然是普通会话，就必须同样走 preset，而它的产物**只能靠普通文件工具写出来**（它自己的提示词段落就是这么告诉它的）。不加入 preset 的后果是：会话只继承宿主组装，即本插件全局注册的 `canvas_*`，而模型被要求用 `write`／`edit` 编辑产物文件，每一次调用都返回 `unknown tool`，产物停在 absent，整个回合以"解释自己为什么交不出文件"收尾——从模型视角看这个失败极其莫名，因为它并不知道自己的工具表是怎么组装的。

因此：

1. **加入 preset 是卡片会话的成立条件，不是优化**。preset 在常驻作用域下组装一次，agent"加入"的方式是让它的作用域键 parent 到那个挂载点；**唯一受支持的调用点是 agent 工厂的 `setup(agentCtx)` 回调**——只有在那里组装尚未发布，preset 组装失败才能让整次创建回滚，而不是发布一个半组装的 agent。创建与恢复两条路径共用同一个 setup。
2. **preset 在任何 agent 创建之前解析并预校验**（`resolve()` 取部署默认，它返回的 `broken` 就是组装诊断——非空即这条 preset 装不起来）。失败**故意不被吞掉**：一个 preset 坏掉的部署同样给不了卡片会话写盘能力，诚实的答复是"那条配置坏了"，而不是开出一条默默干不了活的会话。
3. **这个面只许调用上游真发布过的成员**：`ctx.get('agentPresets')` 是**结构式**读取——类型系统看不见它，而判据里的假对象又常常是照猜出来的样子捏的，于是一个猜错的成员没有任何一层会拦，一路走到机器上变成 `face.X is not a function`。v1.0.3 就是这么栽的：预检里调用了一个**从未发布过**的 `standingKeyFor`，**所有部署上的全部卡片会话**都开不出来（issue #1）。纪律两条：① 每个成员都要能在上游自己的声明里逐字指出来（`@deepseek-ai/dsh-agent-preset-registry`，`lib/types/index.d.ts`），不从调用点「想要什么」倒推；② **判据里的假 roster 只能有真机有的成员**——比真机宽松的假对象，正是让这条错误在 20 条绿判据下活着的原因（顺带记一笔：`resolve()` 已经是 `mount()` 跑的那次审计，因此「这条 preset 能不能组装」不必另找一个调用去证明）。
4. **无 roster 的部署是 no-op 而非失败**：裸 harness、单测这类环境没有 `agentPresets` 服务，此时模型面向的工具行本来就留在宿主组装里、全局层人人可见，没有可加入的东西。服务按名结构读取（`ctx.get('agentPresets')`），同一份 bundle 同时跑在有 roster 与无 roster 两种部署下。

**卡片元信息注入系统提示词**：用 `ctx.systemPrompt.section()` / `.context()` / `.variable()` 在卡片会话的作用域内注册段落与动态上下文（路径、形态、项目风格档案、上游引用来源摘要、**改动归属**——一次改动落到本卡产物而不是另起一张卡，F3.17），作用域内条目遮蔽全局同名条目；一次性提醒走 `agent.inject({ content, source: { kind: 'plugin', plugin: 'dsh-canvas' } })`——它追加的是持久化上下文，下一次模型请求即可见，但**不会唤醒空闲 agent**。

**连线的底层 = 文件引用**（v1.37，替换掉 v1.35 的会话引用这一版）：一条引用边的两端确实都是会话（每张卡片一个，§2.3），但**边指向的东西是文件**，而这份文件**不一定是任何会话的产出**：节点可以**手动新建**（从来没有哪次会话生成过它），也可以是**对某次会话产物的二次编辑**（内容早已不等于那次会话的记录）。把「会话」当作「产物」的代理，等于预设「这份产物 = 某次会话的输出、且此后没人动过」——这个预设一破，模型拿到的就是**另一样东西**（过程记录、或者旧版本），而边明明指着那个文件。**文件引用把这个代理环节整个去掉**：名字直接指向磁盘上那一份，谁写的、怎么来的都不影响它指得对。所以插件交给新会话的是**名字**，不是内容，也不是快照。这份名字的语法**属于 Harness**：`@` token ＋ 工作区相对路径，带空白就 `@"…"`，目录带尾斜杠，`@deepseek-ai/dsh-file-reference-local` 在这条会话有 `read` 工具时装上这份引导（每张卡片会话都有 `read`，见上「卡片会话的工具从哪里来」）。插件**自造一套新词汇只会更差**：模型得为一个插件多学一种写法，而宿主 UI 与其它插件的 `@` 提示又各说各话。所以 `src/core/artifact/file-reference.ts` 把宿主那套语法**逐字节复刻**（零依赖、**不 import harness 包**——同一份 bundle 要跑在从未组合 file-reference 包的部署上），执行落在 Host 的 `CardRuntime.referenceFiles`：走这条卡的**直接**上游（上一级，**不做穿透引用**）→ 逐个 `probe`（只为判「是文件还是目录」与「写没写盘」）→ `nameFileReferences` 保序去重并分出 `skipped` → `referenceMessage` 以 `source.kind:'plugin'` 注入（**绝不是 `kind:'user'`**：是画布在给文件命名，不是在替用户说话）→ 返回 `{ cardId, files[], skipped[] }`。**名字必须真的解析得到**：卡片 id 就是工作区相对路径（产物落在 `<画布根>/<cardId>`，正好是会话 cwd）——这条既有事实是整个通道成立的前提，也是 §3.5 F5.4 那条「卡片是文件不是目录」的来处。**每轮提示里的引用块同源但更克制**：它**同步组装、不许 I/O**，所以走 `nameWithoutProbe()`（一律文件形态、不带由 kind 推出来的尾斜杠），只报**有哪些材料**，正文一个字都不带——从缓存里端出来的摘要没人负责失效，而上游随时可以被一次普通的文件编辑改写。**摘要通道照旧并存**（`canvas_read_sources` / `canvas_inject_card` / F5.7 `pull`）：它要的是「立刻把材料摆到眼前」，这件事引用做不到。

**引用深度分两种问法，答法不同**（v1.46）：`transitiveUpstreams`（`src/core/canvas/source-store.ts`）回答的是**图**的问题——「这张卡在谁的下游」，用于看形状的两处（F4.7 引用链面板 / `canvas_get_sources`、F4.6 按链排布），停在一级就是谎报画布的形状；`materialUpstreams`（同文件）回答的是**上下文**的问题——「这条会话可以读什么」，答案恒为**一级**。三条通道（每轮提示里的引用块、`canvas_read_sources` 的摘要、`canvas_reference_files` 的名字）全部走后者，**不做穿透引用**。理由是链要**折**不要**摊**：产物应当已经把上游材料消化进自己那一份，把祖父的产物塞进孙子的提示词，花的是上下文、拆的是画布自己画出来的那条流水线——而且「本产物建立在它之上」这句话，隔一层就不成立了。真要看更远的，`canvas_get_sources` 报全链、`canvas_read_card` 读其中任一份，属于**明确去取**，不是默认送到。配置项 `sourceDepth` 自此只作用于图的那一侧。

## 六、数据模型与持久化

「引用数据独立于产物文件」的落点是 Harness 的存储领域（domain），不是自建 JSON 文件。

```typescript
// src/domain.ts
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const point = z.object({ x: z.number(), y: z.number() })   // 记录 schema 用 zod 写，消费方类型由 z.infer 得到
const projectRecord = z.object({                          // 一张画布：名字、根目录、**它自己的**视图与风格
  name: z.string(),
  root: z.string(),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }),
  style: z.object({ palette: z.array(z.string()), font: z.string(), tone: z.string() }),
  createdAt: z.number(),
})
const cardRecord = z.object({                             // 一张卡片：座次 + 形态 + 绑定的会话
  project: z.string(),                                    // 记录自带 project，键与记录都要说得清自己属于谁
  kind: z.string(),
  position: point,
  sessionId: z.string(),
  updatedAt: z.number(),
  seatedEmpty: z.boolean().optional(),                    // v1.47：这个座位**生来就没有产物**（F1.11）
  file: z.string().optional(),                            // v1.49：产物路径。**可选**＝老记录读作「路径就是 id」，零迁移；新记录一律带
  name: z.string().optional(),                            // v1.53：卡片自己的名字（F1.12）。同样可选＝老记录读作「按产物起名」；**与推导默认相同就不写**
})
const sourceRecord = z.object({                           // 一条引用边：下游 ← 上游
  project: z.string(),
  downstream: z.string(),                                 // 引用方 cardId
  upstream: z.string(),                                   // 被引用方 cardId
  origin: z.enum(['manual', 'reconciled']),               // 手动连线 or 自动对账生成
})
const noteRecord = z.object({ project: z.string(), text: z.string(), author: z.string(), position: point, createdAt: z.number() })

export const CANVAS_DOMAIN = defineDomain({
  name: 'dsh_canvas',                                // 单元名只允许 [a-z][a-z0-9_]*，故用下划线而非包名的连字符
  version: 1,
  layout: 'per-record',                              // 卡片/引用边记录大而稀疏，逐条成文档、逐条校验版本
  global: {                                          // 画布单例：**只有「用户在看哪张画布」**
    schema: z.object({ activeProjectId: z.string(), viewport: z.object({ /* … */ }), style: z.object({ /* … */ }) }),
    initial: DEFAULT_CANVAS_GLOBAL,
  },
  tables: {
    projects: domainTable<string, z.infer<typeof projectRecord>>(projectRecord), // projectId → 名字/根目录/视图/风格
    cards: domainTable<string, z.infer<typeof cardRecord>>(cardRecord),          // projectId-cardId → 座次/形态/会话
    sources: domainTable<string, z.infer<typeof sourceRecord>>(sourceRecord),    // 引用边
    notes: domainTable<string, z.infer<typeof noteRecord>>(noteRecord),          // 共享便利贴
    intents: domainTable<string, z.infer<typeof intentRecord>>(intentRecord),    // 排队中的结构化编辑意图
  },
})
```

> 一处与初版的差别值得点明：视图与风格是**逐项目**的（表里那份 `projectRecord`），全局单例只留「当前打开的是哪张画布」——初版只设了单画布，而板上要并排摆好几张。

| 特性    | 结论                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------ |
| 打开方式  | `await ctx.storageDomain.open(CANVAS_DOMAIN)`，调用方拥有句柄并负责 `close()`（通常放进 `ctx.effect` 的 disposer） |
| 读取    | 同步、来自权威内存态：`table.get/entries/keys/size`；写入先落盘、再更新内存、最后发事件——**读取永不偏离介质**                         |
| 写入    | `put` / `update`（原子读-改-写）/ `delete`，同一领域内按写链串行                                                   |
| 变更通知  | 每次持久写入后发 `domain/changed`（`put` 携带新快照，`deleted` 是墓碑），UI 与自动对账据此刷新                                |
| 记录所有权 | 返回的是存储对象本身，**不得就地修改**，一律经 `put`/`update` 整体替换                                                    |
| 后端    | 由部署侧路由决定（`json` 后端整文件重发布、`sqlite` 后端逐行存储），产品包不触碰后端                                               |

文件侧的数据模型相应简化（引用不再随卡片走，而是随**板面投影**走，见下一小节）：

```typescript
interface Card {
  id: string                 // 即相对工作区根的路径（如 decks/intro.html）
  kind: string               // 由 kind-registry 认定
  position: { x: number; y: number }
  sessionId: string          // 绑定的 Agent 会话
}

interface Source {
  id: string
  upstream: string           // 被引用的 cardId
  downstream: string         // 引用方的 cardId
  origin: 'manual' | 'reconciled'
}

interface KindEntry {
  id: string                             // 如 'html-deck' / 'site'
  detect: (path: string, probe: FsProbe) => Promise<boolean>
  addressPatterns: string[]              // 认领用的地址 glob
  exportFormats: ExportFormat[]
  publishable: boolean
}
```

### 板面文件：随目录走的投影（F1.9 / F1.10，v1.47）

存储域让「本机怎么读写」这件事一个字节都不用操心，但它把画布放在了**部署里**而不是**目录里**，于是「画布＝这个文件夹」这句话有两个反例：目录改名即换一张画布（身份是路径摘要），换台机器即空板。补的那一半不取代存储域，而是给它加一份**投影**：

```
<root>/.dsh-canvas/board.json           # 点前缀目录，scanProject 跳过 ⇒ 永远不会被当成产物
{ "format": "dsh-canvas-board", "version": 1,
  "id": "dsh-flow-1wjec4f",             # 这张画布是谁：改名/搬家/换机器都靠它认回来
  "name": "dsh-flow", "style": { … },
  "cards":   [ { "id": "app/index.html", "position": { "x": 48, "y": 170 } },
               { "id": "untitled.md", "position": { "x": 336, "y": 170 }, "empty": true } ],  # empty：座位生来没有产物（F1.11）
  "sources": [ { "downstream": "deck.html", "upstream": "brief.md", "origin": "manual" } ],
  "notes":   [ { "id": "note-…", "text": "…", "position": { … }, "createdAt": 1 } ] }
```

| 问题     | 结论                                                                                                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 谁是真源   | 存储域。读取、命中测试、排序都走它；投影可以慢一拍，也可以整体失败（目录只读、沙箱拦下、盘满）。**写投影失败不让用户的拖拽失败**，只记一行日志                                                                                                                                                                              |
| 什么时候写  | 改动板面的每个方法末尾（`moveCard`/`arrange`/`linkSource`/`unlinkSource`/`reconcile`/`createNote`/`removeNote`/`setStyle`/`createCard`/`removeCard`…）。组装文本与上次写过的逐字节比对，**没变就不写**——拖回原位、排布没改动的不惊动文件监视器，也不留空 diff                                                     |
| 什么时候读  | 只在绑定目录时（`createProject`）。读不懂（JSON 坏了、`format` 不对、版本不认识）就当**没有**，并且**再也不覆盖它**——手改到一半的文件或更新格式写的文件，被旧投影盖掉就是数据丢失                                                                                                                                           |
| 身份怎么判  | `planIdentity` 四态：文件里有 id ⇒ 用它；没有 ⇒ 退回 `projectIdOf(root)`（老画布因此零迁移）。记录存在且根目录就是这里 ⇒ **reuse**；记录指的旧路径已不存在 ⇒ **move**（改名/搬家，记录就地把 root 改过来）；旧路径还在 ⇒ **copy**（拷出来的一份），铸一个新 id 并改写它的板面文件，否则两个文件夹共用一个板面                                                    |
| 板面怎么导入 | `planSeats`：**已落座的卡片保留存储域里的座位**（那是本机更新的状态，陈旧的投影不能把它拖回去），缺的卡片按文件里的座位补，文件没提过的文件按「最右一张右边一步」落座。`planEdges` 把每条边过一遍 `validateEdge`（自环/重复/成环/端点不在板上丢掉），`planNotes` 按 id 去重。卡片条目上的 `empty: true`（只在为真时写）随座位交回 `createProject`，于是「这个座位生来没有产物」这条豁免（F1.11）也过得去机器 |
| 什么不跟着走 | `sessionId`（换台机器就是另一个会话，带过去只会假装有对话）、视图状态、排队中的意图。划线处是**属性归谁**：作品的关系与布局走，本机态留下                                                                                                                                                                           |
| 删除画布呢  | 只删本机记录，**不碰目录里的板面文件**：重新绑定即从文件恢复。忘记与恢复互为逆操作                                                                                                                                                                                                            |
| 已知边界   | 快照是**整份覆盖**，没有逐条合并，所以同一份目录不该被两个部署同时编辑（产品文档 §六 已把实时协作划在界外）。拷贝出去的那一份**只继承布局与关系**，不继承会话                                                                                                                                                                   |

### 探针三态：什么时候才可以说一张卡「失效」（F1.11，v1.47）

板上「缺产物」看起来是一件事，实际是三件，而**批量操作只许碰其中一件**。`probe` 返回布尔，把所有失败都折进 `present: false`——画板面够用（说不清就先别下结论），但拿它去决定「把这张卡从板上拿掉」就是把「读不到」当成了「不存在」。于是另有 `ArtifactIo.presenceOf()`：

| 态         | 怎么来的                                                                                                            | 能做什么                  |
| --------- | --------------------------------------------------------------------------------------------------------------- | --------------------- |
| `present` | 目标解析成功、`stat` 有结果（目录也算）                                                                                         | 什么都不用做                |
| `absent`  | 目标解析成功、`stat` 明确返回 `undefined`（协议原文：`undefined` 即不存在）                                                           | **唯一可以据此清卡的态**        |
| `unknown` | `ctx.fs.resolve` 抛错（路径不可表示、沙箱把它映射到别处），或 `stat` 抛错（`FS_PERMISSION_DENIED` / `FS_SANDBOX_DENIED` / `FS_IO_ERROR`） | **一律留下**，写一行日志说跳过了哪几张 |

再叠两条：

- **空座位不是幽灵。** 座位允许先于产物存在（客户端 `spawnFromSpec` 是先落座再写种子、位图要等一次生成、`canvas_create_on_board` 可以由 Agent 给一个还没写的路径落座）。这类卡记 `seatedEmpty: true`，`missingOf(presence, seatedEmpty)` 于是把它们排除在外；**观察者是 `readBoard`**——因为产物也可能是模型用自己的文件工具写出来的，只有探针能看见填写这件事。这也顺手让 `readBoard` 从「每张卡都读一段正文」变成纯 `stat`。
- **根自己探不到就整体拒绝。** 那时每张卡都像缺了，而「目录真没了」与「路径解析坏了」在这里分辨不出；一次点击清空整块画板不是可以从一个失败的探针里推出的结论，所以抛 `canvas/root-unavailable`，请用户改用「移除画布」。

落点：判据抽成纯模块 `core/canvas/cleanup.ts` 的 `planCleanup(cards)`（`{ remove, unknown }`，容器内可测），host 只负责采集事实与执行级联删除。**变淡（F3.5）、计数、清理三者共用 `BoardCard.missing` 这一个判据**——按钮上的数字与点下去真正会少掉的卡必须是同一个集合，否则用户只会在「说 3 张、走了 2 张」里失去信任。

## 七、形态注册表落在哪个席位

初版把形态注册表设想成一个自造 registry。校准后的结论是：**形态的两半分别落在已有机制上**。

| 半            | 机制                                                 | 说明                                          |
| ------------ | -------------------------------------------------- | ------------------------------------------- |
| Host 认定      | `src/core/artifact/kind-registry.ts` + `ctx.fs`    | 由扩展名与内容证据判定 `kind`，结果写进 domain 的 `cards` 记录 |
| Client 认领与预览 | **右栏 tab 类型注册表** `ctx.sidebarRightTabs.register()` | 按资源地址 glob 认领，用 `priority` 分档压过内置查看器        |

```typescript
// src/client/canvas/canvas-tab.ts —— 一种形态 = 一个 tab 类型
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: 'dsh-canvas',
    kind: 'canvas-deck',                        // 打开该类型的判别名
    patterns: ['dsh-resource://file/**/*.html', '*.md'],   // 认领哪些地址
    priority: 'extension',                      // 压过内置 text/files 查看器
    canOpen: address => kindRegistry.claims(address),      // 同步否决
    title: address => cardTitleOf(address),
    guide: { order: 10, title: () => '画布' },  // 右栏引导页入口
  }), 'dsh-canvas: tab type')
}
```

配套的地址与资源体系（不要自造文件引用语法）：

- 资源地址：`dsh-resource://<protocol>/…`，文件协议为 `dsh-resource://file/session/<sessionId>/<相对路径>` 或 `dsh-resource://file/absolute/<绝对路径>`；构造/解析用宿主提供的 `fileAddressFor` / `parseFileAddress`。
- 页面地址：`sidebar://<kind>`，由 Sidebar 在 `openTab(kind)` 时自行写入，调用方从不拼。
- tab 身份是 `(kind, address)` 二元组；同一地址被两个类型打开就是两个 tab。
- 内置 kind 为 `guide` / `text` / `files`；`priority: 'extension'` 让插件认领先于内置查看器生效，插件注销后内置实现自动恢复。
- 产物预览数据走 `ctx.resources` + `useResource`（`file` 协议由 `workspaceFiles` 服务供数），不要自己起一套拉取。

## 八、Client 侧：席位、props 与实时呈现

画布不是「主区域」——Web Client 的 `main` 席位属于对话。可用的承载席位是：

| 需求             | 席位                                            | 说明                                        |
| -------------- | --------------------------------------------- | ----------------------------------------- |
| 停靠式画布（与对话同屏）   | `rightbar.session` → `sidebar.right.pane.tab` | 每个会话一份的停靠面，可打开/分栏/浮出/关闭；最贴近「画布工作台」的形态     |
| 全屏画布覆盖层        | `shell.overlay`                               | root 作用域覆盖层，适合沉浸式编辑与演示                    |
| canvas.* 的实时卡片 | `tool.call.toolview`                          | `keyed` 槽位，按 wire 工具名接管渲染，即 F7.2 的「代码直播框」 |

> 注：`conversation.view`（会话视图环）**不再注册**——v1.8 起对话页面只保留宿主内置的「对话 / 轨迹」标签；卡片内容的展示走双击全屏预览（F3.8）与右栏产物 tab，`card-panel.tsx` 模块随之删除。

注册范式（模板同款，注意先 `inject` 再 `register`）：

```tsx
ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab',
  id: 'dsh-canvas',
  order: 20,
  label: () => t('canvas.label'),
  inject: () => ({ actions, t, hooks: { board: boardSource } }),
}, (props: CanvasSlotProps) => <CanvasView {...props} />))
```

组件侧规则：

- 组件**拿不到 `ctx`**。数据从三条路进来：owner props、注册项的 `inject` 工厂（在 `apply` 世界里闭包捕获 Cordis service，只投影出数据与 callback）、以及声明的 slot store（仅承载共享的视图状态）。
- 框架标准 props 按作用域自动注入：`useSessions` / `useWorkspaces` / `usePanelInfo` 全域可用，`session` 作用域另有 `sessionId` / `useSession` / `useProjection` / `useConversation` / `useInput` / `inputActions`。画布对「卡片会话正在干什么」的实时呈现直接订阅 `useSession`，不需要自建轮询。
- 私有 observable 以裸 `getSnapshot` / `subscribe` 放进 `inject` 返回的 `hooks`，渲染层会转成 `useXxx(selector)` 并按其身份缓存绑定；**组件不直接调 `useSyncExternalStore`**。
- 样式**两套配色**：亮色是默认块，暗色由 `body[data-ds-dark-theme]` 覆盖（宿主在首帧前由预置引导写属性、之后由 ThemePresenter 维护，**亮色＝属性缺席**，插件不管理状态）。中性色骑宿主 `--dsw-alias-*` 真令牌（名字必须真存在——`tests/theme-tokens.spec.ts` 有白名单），画布专属面给两套显式值；样式表注入一次、类名加包前缀（v1.38）。
- 文案走 `ctx.locale.register(NS, { zh, en })` + `LocaleNamespaceMap` 声明合并，两个字典键必须齐全。
- 别的功能插件只以 `import type` 引入声明，**绝不导入其运行时值或组件**。

### 画布上的滚轮归谁（F1.7，v1.52）

整块画布表面都是手势面，于是「这一滚归谁」必须自己判——浏览器本来有一条规矩（内层还有余量就内层滚），在这儿不成立：React 的 wheel 监听挂在根容器上，画布这一层收到的永远是那一下，内层的滚动条根本没有先吃的机会。判据收在 `client/canvas/wheel-owner.ts`（纯模块、零依赖，node 单测直接读它）：

- **`wheelOwner`**：`ctrl` / `⌘` 压过一切 → `zoom`；否则问指针底下是不是**自己会滚的地方** → `self`（画布一个像素都不动、原样放行给浏览器去滚那个盒子），其余 → `board`（平移取景框）。认那三处用的是**类名**（`SELF_SCROLLING`：提示词正文、`@` 候选、模型菜单），**不量溢出量**——量 `scrollHeight` 会把同步布局逼出来，而平移恰恰最受不了这一下；何况输入框本来就**按设计**会滚，它当下滚不滚得动与「这一滚该不该归它」是两件事。
- **`wheelSwallowed`**：`zoom` 与 `board` 两档都要拦下（`preventDefault` + `stopPropagation`），`self` 那一滚**一个字都不碰**（滚动正是那个盒子的默认动作）。缩放这一档绕不过去：`ctrl` / `⌘` + 滚轮在浏览器里本来就是**页面缩放**，Chromium 里触控板捏合合成的也正是这样一条带 `ctrlKey` 的 wheel——不拦就是「画布放大一档，宿主整页也跟着放大一档」。

**拦默认动作必须用主动监听，这是这一条的全部要点**：react-dom 18.3.1 的 `addTrappedEventListener` 把 `wheel` / `touchstart` / `touchmove` 三兄弟一律注册成 `passive`（挂在根容器上，是它当年模拟浏览器对 document 上这三兄弟的默认被动化）。被动监听里 `preventDefault()` 不只是「没效果」——Chromium 认定没人拦得住，事件**到达时 `cancelable` 就是假**，浏览器连问都不问一声就把自己的事办了（实测控制台另记一句 `Unable to preventDefault inside passive event listener`）。所以这条监听挂在表面上、显式 `{ passive: false }`（与 `artifact/viewers/design-viewer.tsx` 同一手法），并且 `canvas-view.tsx` 里**不再挂** React 的 `onWheel`：留着也只是让同一滚被算两遍（`stopPropagation` 之后它本来也收不到）。

判据分两层。纯函数与**源码级三句**在 `tests/client/canvas/wheel-owner.spec.ts`（node 环境里没有 DOM，「挂法」只能看源码：必须挂原生且 `passive: false`、不许再出现 React 的 `onWheel`、拦的那两下都在——这三句在修复前逐条验过、全红）。端到端在 `.workbuddy/repro/wheel-zoom/`：`gen.cjs` 生成三张**只差一行**的页面（不挂监听 / 被动挂法 / 主动挂法），`check.cjs` 用真浏览器推滚轮判 11 项——对照组页面**确实被滚走**（这是后面全部判据的成立前提）、被动那张**照样被滚走**且控制台记那句 `Unable to preventDefault`、主动那张**页面一动不动**且窗口冒泡那条根本没被叫到，外加 `ctrl` 滚轮在两种挂法下的 `cancelable` 对照。⚠️ **无头模式里「页面缩放」这个默认动作本身量不到**（对照组的 `devicePixelRatio` 与 `innerWidth` 一样不动），所以判据落在同一条 DOM 语义（`cancelable` + 默认动作有没有被拦）上；真机复核只需把画布打开、按住 `⌘` / `Ctrl` 滚滚轮，看宿主那一栏有没有跟着变大。

### 控制带的尺寸（F3.11 右下角那颗把手）

控制带（`card-overlay.tsx`）能拖大，尺寸落在两处：整条带的宽写在内联 `width` 上、输入框的高写在输入框自己的根上（v1.48 起正文是 `contenteditable`、不再是 `textarea`，见下一节）。**带子的高从来不自己定**——它是「材料行 + 输入框 + 底栏」三行自然长出来的，所以放大能改的只有「输入框多占多少」；字号、行高、内边距、圆角一个都不动——放大态（⤢）走的是同一个 `ComposerBody` 与同一个输入框，变的只是外壳给它的余地（`data-fullscreen` 那两条 flex 规则），没有另一套更大的字。于是「放大之后还是同一副样子」是结构给的，不是靠人守的。

算术全在 `composer-size.ts`（纯模块、不碰宿主原语，单测直接读它）：起笔时按 `getBoundingClientRect` 量一次当下多大，那就是**起点**（所以第一下不跳）；之后每一个指针位移都先除 `zoom`——带子坐在 `scale(zoom)` 的层里，不除的话把画布放到 200% 再拖就是鼠标的两倍快。上下限在那里收口，下限是「装得下自己」而不是「刚才多大」，所以拖大过还拖得回默认。

**锚在卡片中心**（`translateX(-50%)`；卡片宽 200 ⇒ 与 `position.x + 100` 是同一条竖线）：放大时左右两侧对称地长，输入区始终在节点正下方。代价落在右沿——同一个鼠标位移只有一半落在它上面、另一半去了左沿，于是宽要按**两倍**吃位移（`CENTERED_WIDTH_GAIN`），右下角那颗把手才跟得住光标。**锚点与这个倍数是一对，改一个必须改另一个**：若换回左上锚（钉住左沿），倍数就得回到 1，否则要么把手跟不上鼠标、要么宽走过一倍。高的方向没有这一层，锚在上沿，一寸就是一寸。

拖动期间是组件内的本地 state（同 `card-tile.tsx` 的卡片拖动），**放手才落进画布的记忆**；按一下不移动＝一次误触，什么都不改。尺寸按「画布 / 卡片」记在 `CanvasBoard` 的内存里（卡片 id 是路径，跨画布会撞名），**不落盘、刷新回默认**——它是一时的偏好，不是产物的属性。把手的按下要 `stopPropagation`：画布把空白处的一按读成「取消选择」。

**放大态（右上角那颗 ⤢）不是另一副界面，是同一条控制带换了个壳**：那三行由同一个 `ComposerBody`（`card-overlay.tsx` 导出）画出来，卡片下方那条带子与放大后的弹窗都只是它的外壳——所以「放大之后布局与缩小态一致」不是靠两处对齐出来的，而是**根本没有第二套布局**。连输入框的高矮之别也走 `data-fullscreen` 这个属性而不是另一个类：三行的 class 序列在两种尺寸下逐字相同，真机探针直接比它（探针里那条「class 序列与行内一字不差」）。

**两处按钮各管各的壳**，所以各站各的地盘：行内带子右上角那颗是〔放大〕（⤢，`canvas.composer.enlarge`，`corner` prop 可选——**只有行内传**），弹窗**头部右上角**那颗是〔缩小〕（⤡，`canvas.composer.shrink`）。底层的〔缩小〕因此站到 `.dsh-canvas-dialog-head` 里去（`.dsh-canvas-promptmodal-shrink`：`margin-left:auto` 推右沿、`flex:none` 防被长标题挤扁、上下 `-4px` 把 26px 的胶囊塞进头部那一行，头部高度因此不变），而不是混进那三行——**材料行与行内逐项相同，一颗多余的按钮都没有**，探针里「放大态那三行里不再有那颗 ⤢」和「缩小那颗整颗落在头部里、在内容区之上」两条判据盯着这件事。弹窗底部那枚重复的「收起」也已删掉：退出去走头部那颗、Esc 或点遮罩。前一个版本里放大态另有一套 13px/21px 的字号（`.is-modal`），那正是「放大之后不像同一个东西」的根源，已撤。

### 页面：复制自己接，**范围一律按页圈**（F2.6，v1.63）

一份设计文档由若干**页**组成（`SceneGraph` 的 `getPages()`，页是根的 `CANVAS` 子节点），左栏最上面那一段管它。上游 `@open-pencil/core/editor` 的 page actions 给了**四件里的三件**——切页 `switchPage`、新建 `addPage`、删除 `deletePage`、重命名 `renamePage`（还有 `movePage` / `setPageColor`），**没有复制**。

复制于是自己接，机制收在纯模块 `core/artifact/design/pages.ts`：

1. 建一张新页（`graph.addPage(name)`，名字走 `copyPageName`：「X 副本」「X 副本 2」）；
2. 把源页**整棵子树**深拷过去（逐个顶层子节点 `graph.cloneTree`——它自己递归到孙辈，且会清掉副本的 `source.id`，所以副本是**新 id**、源页一个字节不动）；
3. `graph.insertChildAt(copy, rootId, at + 1)` 把副本放到**源页右边**（`addPage` 只会追加到末尾，而复制出来的页该贴在原件旁边）；
4. 切到副本（`switchPage`，这步是编辑器的事，留在引擎里）。

同一模块里还住着另外三条判据：`newPageName`（「页面 N」取第一个空位——上游默认名是西文的 `Page ${n}`，而 scaffold 建的第一页叫「页面 1」，同一份文档里两套命名法并列是看得见的）、`pageLabel`（空名兜底，只有模型手写的文档才可能）、`canRemovePage`（只剩一页拒删，面板的按钮可见性**只问这一句**，不自己数页数）。

**多页之后最要紧的是范围**：两页的内容常常坐标完全相同（复制出来的页就是照搬的），所以「画哪一页 / 命中哪一页 / 贴合按哪一页算」有一个没圈住，表现都是「看到了别页的东西」而界面上一片正常。三处逐个收口，判据都钉在 `containersIn(graph, pageId)`（单页；`containersOf` 保留「整份文档」的口径给导出与摘要）：

| 位置                                        | 过去                                         | 现在                                        |
| ----------------------------------------- | ------------------------------------------ | ----------------------------------------- |
| 2D 回退的绘制（`paintDocument`）                 | `containersOf`：**每一页的容器叠着画**               | `containersIn(graph, pageId)`，`pageId` 必填 |
| 包围盒与贴合（`documentBounds` / `fitTransform`） | 按整份文档算 ⇒ 镜头去装下所有页                          | 按当前页算（引擎现取 `editor.state.currentPageId`）  |
| 命中（`editing.pick`）                        | `hitTestDeep(x, y)` 不给范围 ⇒ 从**文档根**一路走到每一页 | 传 `scopeId = currentPageId`               |
| 卡片缩略图（`card-shot.ts`）与 fig 缩略图            | 两处各写一遍「第一页」                                | 共用 `firstPageId(graph)`                   |

**删除要二次确认，因为上游的删除不进撤销栈**：`deletePage` 是直接 `graph.deleteNode`（新建与重命名同样不进 undo，只有图上的改动进）。这一点写进了契约（`design-engine-types.ts` 的 `deletePage` 那一格），面板据此把那一行染上警示色并把行尾换成「删除 / 取消」两枚字按钮——**不做弹窗**，那一行就是这句话的主语，页名留在原地所以「删的是哪一页」不必再问。

判据（`tests/core/artifact/design/pages.spec.ts`，24 项）绝大多数**不读源码文本**：这一层是纯的，所以拿**真图**跑——子树照搬含孙辈、副本是新 id、源页 id 一个不差、副本插在源页后面（连复制两次的落位也验）、删副本的容器源页还在、存盘读回还是两页。只有面板与引擎的接线那几条读文本（四个操作都在、垃圾桶那一下只挂起确认、可删性只问纯模块、2D 与贴合带着当前页）——jsx 与引擎都在 node 下 import 不了。七条验红逐条做过，其中「2D 画的范围」那条**第一次没注进去**：同一片段在文件里出现两次，脚本按「命中数不是 1 就停手」的纪律没写盘，那一轮是**假绿**；换唯一的锚点重跑才红。这是那条纪律第一次在真场上拦下一次误判。

### 图层树：默认全折叠，**动过的不再自动改**（F2.6，v1.67）

用户原话「参考 Figma…上面是 page，下面是图层，**图层默认折叠不展开**」（附 Figma 左侧栏截图）。左栏「上页面、下图层」两栏与页面管理是 v1.63 就有的；这一版补的是**展开状态**——此前 `LayersPanel` 的 `collapsed` 初始为空集合（= 全展开），一进来第一屏全被第一个画板的子节点占满。机制收在纯模块 `core/artifact/design/layer-tree.ts`（只认 `{ id, children }` 这个形状，`DesignLayerNode` 结构上就兼容）：

- **两个集合各管一件事**：`collapsed` 是「现在折着」（渲染只看它）；`seen` 是「已经被默认折叠处理过」。后者挡的是**刷新把用户展开过的收回去**——画布每落一次盘就换一份快照（`snapshot.layers` 每次都是新数组），若每次重算「可展开 ⇒ 折叠」，用户刚点开的容器会自己折上。
- `withNewNodesCollapsed(layers, state)`：把**新出现的**可展开节点收进折叠集合；没有新节点就**原样返回入参**（引用相等 ⇒ React 直接 bail out，省一次重渲染）。初次挂载用它加一份空状态，于是「默认折叠」与「新节点默认折叠」是同一条路。
- `toggleCollapse` / `expandNodes`：箭头两向、画布点选让开选中项的祖先；**两向都记 `seen`**。`expandNodes` 里那句记 `seen` 是**兜底**（常规路径上初始折叠已经把可展开节点全记进去了）——判据为它专门构造一份「未经默认折叠」的状态才验得出来；第一版判据在常规路径上测它，验红时是**假绿**。

接线：`design-panels.tsx` 的 `LayersPanel` 四条路全走纯模块（初始 state、快照刷新 effect、箭头、让开祖先），渲染判定读 `collapse.collapsed.has(node.id)`。判据 18 项：纯模块 13 + 接线 5（读源码文本、锚到代码行——JSX 一进来就碰宿主 UI 原语，node 下跑不了）。

### 设计属性面板：一张判据表说了算（F2.6，v1.62）

属性面板（`client/artifact/viewers/design-panels.tsx` 的 `DesignPropertiesTab`）要回答的问题其实是三类：**这个类型该露哪几格**、**下拉里有什么可选**、**值怎么夹**。三类都收进一个零依赖纯模块 `core/artifact/design/node-props.ts`，jsx 只把答案画成控件——面板里因此**没有一个** `read.type === 'polygon'` 这样的分叉（连「角数 / 边数」这个小名字也由 `shapeTraitsOf(type)` 给）。理由与仓库别处一致：同一个判断有两个来源，迟早各说各话。

三处必须与**真源**对齐，而漂移的后果全是静默失败：

- **混合模式 / 文本对齐 / 尺寸行为**的取值集合与 `@open-pencil/scene-graph` 的类型声明同集。多列一个场景图不认的模式，写下去是无声无息地不生效。
- **可选字体只列真注册进 `fontManager` 的那几支字面**（`design-skia.ts` 的 `CORE_FONTS` 与 `CJK_TEXT_FAMILY`）。列一支没装上的，表现不是「回落成别的字体」而是**文字画成空白、什么也不报**。族名从 `node-props.ts` 的 `LATIN_TEXT_FAMILY` 读，`design-skia.ts` 的字体表也从它读，两处不会再各写一份 `'Inter'`。
- 与此配套，**换字体族时字重一起落到新字面真有的那一档**（`settleWeight`：Inter 四档、中文只有 Regular）：两格在同一次提交里写完，因此不会留下「取不到字面的中间态」。

引擎侧（`design-engine.ts` 的 `updateProps`）有两条各自的讲究：**边数与内径要被夹**（3–60 的整数、0–1 的比值——面板给的是自由输入，半个角、越界的比值都画不出来）；**弧是对象字段、整组替换**（场景图的 `arcData`），所以逐字段比过再写，没真变就不进 undo。排版那几项能走与几何同一套标量节律，是因为场景图的 `TEXT_PICTURE_KEYS` 把 `fontFamily` / `fontWeight` / `lineHeight` / `letterSpacing` / `textAlignHorizontal` 都算作文本缓存失效的触发键；`textAutoResize` 不在其中，它只改布局约束（下一次布局读它）。

判据（`tests/core/artifact/design/node-props.spec.ts`，16 项）分三层：纯判据本身；**与真源对账**（读 scene-graph 的 `types.d.ts` 抠出 `BlendMode` / `TextAutoResize` / `textAlignHorizontal` 三个联合，读 `design-skia.ts` 数真注册的字面份数）；面板与引擎的接线（读源码文本，锚到代码行——注释里恰好写着那个名字的老教训已经有过一次）。四条接线判据逐条**验红**过：`1 failed | 15 passed`，红在且只红在打算抓的那条。

### 画布左上角那一条：**颜色说口气，字说事情**（F10.1，v1.58）

`.dsh-canvas-notice`（动作回执）与 `.dsh-canvas-error`（错误条）同占一个位置、共用一副骨架，过去也共用**同一种长相**：`--dsh-card` 底 + 发丝描边，只有字色差一点。于是同一个位置上，「导出成了」「这次没导成」「打包出错」看不出区别——用户得把一行字读完才知道刚才发生了什么（v1.58 收到的一条明确反馈：不明显，而且赖着不走）。

现在一条提示带上 `tone`，**口气与文案一起定**、一起放在 `client/canvas/notice.ts`（纯模块，`t` 注入，所以能在 node 里穷举）：`NoticeTone = info | ok | warn | error`，每个收场该是哪一档由 `bundleNotice` / `bundleFailedNotice` / `textExportNotice` / `pruneNotice` / `referenceNotice` 各自答，jsx 只负责把 tone 画出来（`data-tone`）。两条界线值得写下来：**被拒不是出错**（产物还没写、目录里没有可打包的东西、文件多到一包装不下——都是「这次没导成，以及为什么」⇒ `warn`），**只有客户端自己动手那一步抛了异常才是 `error`**（装包、PDF 排版）；而「这张卡还没有引用任何材料」是中性事实 ⇒ `info`，给它涂成功色等于替用户下结论。

颜色**不新开主题令牌**：每一档只声明一枚**家族色**（`--dsh-notice`，条内局部变量，不是调色板成员），底、描边、字由那条共用骨架规则用 `color-mix` 在画布调色板上算出来——两套主题各算各的，于是也没有「亮色值忘了加」那类静默事故。家族色一律取**文字色**那一档（`--dsh-sunset`，不是实心底的 `--dsh-sunset-solid`）：亮色下底取淡调、字取原色，两边都读得出；拿实心底那档当字色，亮色下就是黄字压黄底。判据读源码文本（`tests/client/ui/notice-tone.spec.ts`）：四档家族色互不相同、每一枚都在调色板里真存在（拼错的令牌名不会报错，只会永远走兜底），以及两条提示条**各带一枚 ×**。口气映射本身在 `tests/client/canvas/notice.spec.ts` 里逐条穷举（「三种拒绝都不是 error」也在那儿）。

两条都能自己关掉——与元素选择那条回话同一分寸：**一句已经说完的话不该赖在画布上**，等下一次动作来替它收场。错误条与卡片面里那条错误共用 `.dsh-canvas-error`，所以卡片面里的错误也一并换了色（那里没有 ×，它属于卡片自己）。

### 提示词输入面：contenteditable 与原子引用标签（F3.18，v1.48）

正文（`client/ui/prompt-input.tsx`）是 `contenteditable`，`@文件` 记号画成 `contenteditable="false"` 的原子标签。三件东西分三层放：**纯解析**在 `core/artifact/prompt-blocks.ts`（零依赖、node 单测直接覆盖——类型表、坐标语法、原子切分都在这儿）；**DOM 层**在 `client/ui/prompt-dom.ts`（只碰 DOM、不碰 React、不做任何决定）；**决定**在组件里（删哪一段、插什么字，都按值算出新值再连同光标一起写回）。DOM 层只在有 DOM 的地方成立，node 单测够不到，判据在 `.workbuddy/repro/prompt-refs/`（真组件 + 真样式 + 真浏览器：21 项 + 两条反证，`gen.cjs` 生成、`check.cjs` 判，退出码非 0 即红）。

上一版是「透明 textarea + 同度量镜像层」：显示改得到、值改不到，但**画不出一枚真正的标签**——镜像只能重绘同一串字符，插不进图标、显不了缩略图，而一件事只有真做成原子节点才谈得上原子。换成 contenteditable 的代价是一条要自己守的边界：**内容就是值**。守在三处：

| 组  | 函数                                       | 规矩                                                                                                                                                                                                                           |
| -- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 写  | `writeAtoms`                             | 值 → 内容。**唯一的写入口**（别处一律不许碰它的 childNodes），且只在外面的值或事实真变了时才写——判据是组件里的 `markRef`（值 + 事实的键，键比**内容**不比对象身份：调用方每次渲染都新造一个对象，按身份比就会每渲染重画一遍、打字打到一半光标被拽走）。用户自己敲的字 DOM 已经是对的，重写一次就把光标与输入法一起打断；这也是它在中文输入法下安全的原因——合成期间 `change` 照发、DOM 一动不动 |
| 读  | `serializeHost`                          | 内容 → 值。标签吐回**它自己那串字符**（`@a.ts` / `@"my brief.md"` / `@img.png <point>420 380</point>`），**不是从路径重新拼的一份**——宿主记号有三种形态，从 `filePath` 反推不出用户写的是哪一种，重新拼一次就可能把发出去的提示词改掉一个字节。这条「拼回去逐字节等于原文」由单测（纯函数）与复现页（真 DOM，十六种记号形态）两头钉住             |
| 坐标 | `caretFlat` / `domPosition` / `setCaret` | 光标是「在第几个字符」，不是 DOM 的位置：**一枚标签占的字符数＝它 token 的长度**，与序列化逐字对齐——「界面上的位置」与「值里的位置」因此从一开始就是同一个坐标。删除、粘贴、落光标全部先换算成扁平偏移、改完再换回 DOM 位置；换算的规则只有一份（`lengthOf` 与 `flatten` 必须说同一句话，两处对不齐光标就从字底下错开）                                           |

四条交互判据从这里长出来：**标签整体删除**（Backspace / Delete 在标签边界上删的是一枚引用——按值算完 `preventDefault`，不赌浏览器在 `contenteditable=false` 边界上的默认行为；标签正后方的下一次删除走浏览器默认、只少一个字，这条对照也在判据里）、**标签内部不可编辑**（非可编辑节点里没有光标）、**复制 / 剪切按原文**（标签在剪贴板里还原成 `@路径`——按画出来的样子复制，粘回去就少一截）、**粘贴只取纯文本**（富文本带进来的那棵 DOM 正是这条边界最容易被撕开的地方；拖放同理）。

**多模态的类型按扩展名定**（`referenceTypeOf`，判据只有一份、写在路径里——调用方手上的卡片可能已经离开画布，扩展名却还在，两处也就不会各说各话）：`code` / `image` / `video` / `audio` 指一份**文件**；`mark` / `region` 指一张图上的**一个点或一个框**，坐标归一化到 0–999（`markText` 是构造那一半、`promptAtoms` 是解析那一半，两边共用同一份语法）。紧跟在文件记号后面的 `<point>` / `<bbox>` 并进**同一枚**标签——「这张图上的这个点」是一件事，不是两件；并完它照样只剩一个字符区间，所以原子删除、复制、序列化三条路一个字都不用改。**标签写文件名，不写序号**：本插件的锚点就是路径（模型照 `read` 自己去取那一份），视觉内容不走第二条通道——参考文档里「图片另走一路、文本里留 `@图片1`」属于另一家的接线方式，不取。缩略图**只在真取得到时**才画：控制带分批读产物 data URL（一批 4 枚、只取图片——视频的整段片子拿来当一枚小图是拿几十 MB 换几十个像素），取不到退回类型图标，**缩略图是锦上添花，不是引用的前提**。

**折叠是第四种引用，也是唯一一种「原文由调用方生成」的**（v1.56）：`element` 指的不是文件、也不是图上的坐标，而是「产物里的这个节点」——元素选择（F3.14）把「产物 + 节点 + 位置 + 几十行源码」一整段定位写进提示词，那段话没有任何 `@` 记号语法能表达。`@文件` 是输入面**自己认出来**的（语法写在字符里），折叠则反过来：调用方**知道**那一段的确切位置与长度（它就是自己刚用 `buildEditPrompt` 写进去的），于是由 `PromptFold` 声明「值里第 `at` 个字符起 `length` 个是一枚引用」，`promptAtoms` 照着折。**`reference.id` 在这条路上不作数**——输入面一律拿值里那一段原文当自己的 token，于是「标签写出去的是它自己那串字符」在折叠这条路上是**结构性**成立的，不靠调用方守规矩。折的只是画法：元素标签 `◫ section.hero` 后面接的那句话，就是发出去的提示词末尾那一句。切不出来时（草稿被人动过）调用方不给 folds，整段按普通文本编辑——展示让路，值一个字不动。

**切哪一段＝草稿自己那段原文，不是照 `file`/`target` 再拼一份**（这一条是踩出来的）。原先那副长相是 `splitEditPrompt({file, target, text})`：切分时要把「这是哪个产物、哪个节点」**再交代一遍**，而那份交代与生成草稿那份是两个来源——元素选择当场拿 `view.file`（产物路径）生成草稿，切分却递了 `cardId`（卡片的 6 位 id，`artifact-view.tsx` 自己写着 `(view?.file ?? cardId)`，两者本就不是一回事），于是前缀永远对不上、**标签在真机上一次也没画出来过**，用户看见的始终是纯文本。改法不是把那一个词换对，而是**把「再交代一遍」这件事去掉**：谁生成的草稿，谁就把那段 head 留着（`HeldPick.head`，`buildEditPrompt` 空要求那一次的返回值），切分走 `cutEditPrompt({head, text})`——两份值在结构上就是同一份，这个坑从此没有地方可长。`splitEditPrompt` 留给「手上只有 file 与 target」的调用方，参数注释里写明**不是卡片 id**（单测里那条 `qkxwvd` 就是这一脚）。

**两处真问题，都是判据抓的**（修复前对照留档 `prompt-refs-before.log`）：

- **事实变富时光标会被端走**（实测 `16 → 0`）。缩略图回来那一刻 `refs` 变了、值没变，`writeAtoms` 仍要重画一次——而它换的是整棵子树，选区连着它那个容器节点一起没了，浏览器只好把光标扔回开头。修法是**先量后画**：只换事实的那一路，先把选区量下来，画完原样还回去——还的是**一整个选区**，不只是折叠的光标（用户可能正选着半句话）；值也变了的那一路（回填、切卡、清空）不还，光标照旧放到末尾。
- **20px 的缩略图会压掉标签的发丝边**。标签那一行是 18px（内边距 2+2、行高 14），20px 的图在 14px 的内容盒里上下各探出 1px，而那圈发丝边是画在盒子**外面**的 `box-shadow`——探出来的 1px 正好把它压掉一段（「标签的边缺了个口」，后代盖住祖先描边那一族）。缩略图因此与标签**同高**（18px），上下 `-2px` 的外边距把高差吃进内容盒（flex 容器的自动高按**外尺寸**取最大，负外边距于是真能把高差吃掉）。判据里有一条反证专门把 20px 那次注回去、看上下各 1px 的越界重现——这条尺子才有牙。

**行高是判据**：一枚标签（含缩略图）不许把正文那一行撑开，否则插进一句话中间就把整段的行距改了。量法是 `scrollHeight`，而且要先把皮肤类上的 `min-height` 按下去——不按的话读数被钉在 54px 上，两条当然相等，判据成了摆设；以「图标那一枚」与「缩略图那一枚」互为对照，各配一条反证。两处落点（控制带与元素选择的提示词框）是同一个组件，判据里两处都量。

### 预览帧与元素选择探针

HTML 家族的预览是一个 `sandbox="allow-scripts"`、**不给** `allow-same-origin` 的 iframe：页面跑在不透明源里，父子互相看不见 DOM，`postMessage` 是唯一通道。元素选择（F3.14）因此被切成三块——**一份脚本源码 + 一段注入 + 一组纯决策**，与链接闸门同源同构（`core/artifact/preview-picker.ts`）：

- host 侧把探针脚本追加进预览文本（`injectPreviewPicker`，幂等，与 `injectPreviewLinkGuard` 同一套做法）；
- 客户端只发**目标态**（`pickOrder(pickMode(...))`：`enable` / `hold` / `disable`），帧回话一律按**不可信内容**逐字段校验并重建（`readsPick`、`isPickEscape`）；
- 探针默认是死的：不接到第一个目标态之前一个像素都不画、一条消息都不发。

**三个态**，`pickMode` 是它们唯一的命名处——框开着压过正在挑，两者都没有就是收起：

| 态      | 什么时候             | 帧里（探针）                              | 帧外（弹窗）              |
| ------ | ---------------- | ----------------------------------- | ------------------- |
| `aim`  | 按下工具按钮之后         | 只读；跟随鼠标画高亮；**滚轮留给页面**；十字光标          | 一条浮在帧上的说明条          |
| `hold` | 一笔选定、提示词框开着      | 只读**且冻住**：不再跟随、十字收回、滚轮拦下、**滚动位置钉住** | 选中圈（改动在跑时亮流光）+ 提示词框 |
| `off`  | × / Esc / 再按一次工具 | 探针收起，页面原样还回来                        | 什么都没有               |

**开模式 = 页面只读**。参照物是浏览器调试工具的元素选择：指向哪儿圈哪儿，页面一动不动。这件事**逐层兑现，缺一层就漏**：

| 层     | 做什么                                                                                                                         | 少这一层会漏掉什么                                                         |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 只读层   | 一块盖满视口的透明层：`position:fixed`、`z-index:2147483647`、`pointer-events:auto`——自己这几层浮层里**只有它接鼠标**；光标由它出示（`aim` 时十字，`hold` 时收回平常样子） | 页面元素继续收到悬停：`:hover` 照样亮、元素自己声明的 `cursor` 与 `title` 照样生效           |
| 捕获期拦截 | 在 `window` 捕获阶段拦下指针族、鼠标族（`contextmenu`、`dragstart`、`selectstart` 在内）**以及 `mousemove`**                                      | 元素级处理器是收不到了，但页面挂在 `document` / `window` 上的**委托**处理器仍会收到从只读层冒上来的事件 |
| 焦点闸   | 进模式时请走页面已有的焦点；此后 `focusin` 一律请出去                                                                                            | Tab 键能把焦点落到输入框上，键盘输入就进了页面                                         |
| 滚动冻结  | 只在 `hold`：`wheel` 拦下并吞掉，同时把 `pageXOffset/pageYOffset` 钉在进这一态那一刻                                                             | 用户在框里写着要求，页面在底下滑走——圈住的位置不再是他说的那个元素                                |

四处实现要点，都是踩过才知道的：

- **命中测试必须把自己筛掉**：只读层就在鼠标底下，`document.elementsFromPoint` 自上而下取第一个**不带** `data-dsh-canvas-picker` 记号的元素（`PREVIEW_PICKER_MARK`）；没有 `elementsFromPoint` 的老浏览器把只读层临时让开一次再问，**问完必须放回去**。少了这一步，「鼠标底下是谁」的答案永远是只读层自己。
- **指针那一族只挡不吞**：对一个 `pointerdown` 调 `preventDefault` 会连带压掉后续的兼容鼠标事件，而选择正靠 `click`。所以 `pointer*` 只 `stopPropagation`，`mouse*` 那一族才挡下并吞掉默认动作（焦点、选区、拖放、右键菜单都从那儿断）。**`mousemove` 跟着一起吞**：跟随是高亮的事、只在 `aim` 里做，但拦不拦是只读的事、三个态都要做。
- **滚轮分两档**：`aim` 时留给页面（不放行则下半页的元素根本够不着），`hold` 时拦下。写这一条必须显式 `{ passive: false }`——浏览器对 `window` 上的 `wheel` 监听**默认是 passive 的**，不写就等于 `preventDefault` 空转、页面照样滚。
- **位置也要钉**：拖滚动条与键盘滚动**不给页面任何可拦的事件**，只有位置能作准——进 `hold` 时记下滚动位置，`scroll` 事件里把它拨回去。滚轮那条管得住事件，这条管得住剩下的一切。

**这一笔的寿命**（`client/artifact/element-pick/`）：挑 → 写 → 等。发送之后框**不收**——圈上亮起与卡片**同一道**流光（同一个 `.dsh-canvas-shimmer`、同一趟 keyframes；动作只有一套语义：光在动 = 正在产出，卡片说的是「这张卡在生成」，这里说的是页面上那一段在改），框留在元素旁边等产物真的变（`revision` 每动一次回读一次，读到文本与发出时不同即落地）。落地后框自己收起，**除非**用户在这期间又写了下一句（`draft !== sent`）——那句还没发出去，不能替他丢掉。

而这一笔**跨得过去一次关闭**：弹窗是按卡挂载的，关掉就整棵卸掉，所以这一笔按 `projectId/cardId` 记在模块级的表里（`pending.ts`，**不落盘、不跨页刷新**，只是比组件活得久）。重开时圈、框与草稿摆回原样；**用户明确放手（框上的 × / Esc）或这一笔已经落地，记录就丢掉**——否则下次打开会弹出一个早办完的框。

**帧的矩形是这一笔的锚，而它是活的量，不是快照**。圈与提示词框写的是**视口坐标**，坐标在这一笔出生那一刻量好；而帧所在的那一栏是弹窗的最后一个可伸缩行——**任何**排到它上方的东西（我们的回话、截断提示、窗口被缩放、画布被拉动）都会把它整个挪走或压扁，覆盖层自己不会知道。所以拿着 iframe 的那一方在握着一笔时持续报告帧的矩形（`PickChannel.onMoved`）：每次提交量一遍（我们自己的界面变了就是这一次提交）、`ResizeObserver` 盯帧自己的大小、`window` 的 `resize` 盯视口；来了就换掉这一笔的锚——`frameMoved` 用半像素容差挡住亚像素抖动，否则每次排版都要白渲染一次。量在 `useLayoutEffect` 里做：量到新位置到重渲染之间不能让浏览器画一帧，不然圈会先错开一下再跳回去。

同一条判据管着提示条**自己**：元素选择那两条（`aim` 的「正在选元素」与发送之后的回话）都**浮在帧上、不占排版位**（`.dsh-canvas-frame-notestack`）。这两条说的都是**我们**正在做的这件事，而且都出现在圈已经画好之后——排进流里就会在出现或消失的那一瞬把帧顶走一整条（实测 43px），圈与框整个错开。链接闸门那条仍排在流里：它说的是页面自己的事，且页面可交互时才会出现（那时手里没有锚）。回话带一个可点的 ×，所以只有那一条自己把指针开回来——代价是它盖住帧顶上那一条，与它从前排在流里占掉的高度相当，随 × 收起。

**已知取舍**：只读层盖住整块视口，所以**页面自己的内层滚动容器在 `aim` 里滚不动**（滚轮到达的是只读层，默认动作只滚文档本身）；文档级滚动在 `aim` 里不受影响，在 `hold` 里连它也没有。验收判据在 `.workbuddy/e2e/element-pick.js`：所有「页面有没有动」都取自**页面自己的痕迹**（它自己的 `:hover` 计算色、它自己与委托两级的处理器计数器、`document.activeElement`、选区、滚动位置），并在开模式之前先跑一遍对照（证明这一页本来是活的）；判据一律判**增量**，不判「绝对值为零」。而「圈有没有被挪动」判的是**两个现量的差**：高亮框的视口矩形 vs 帧此刻的矩形加上元素此刻在帧里的位置（`framePoint` 一次量齐），再加一条「帧矩形一寸没变」；E2E 里 ⑦.2 那一组还会从外面往条带插槽里**塞一条 40px 的横条**再撤走——验的是「帧一旦挪窝，圈与框都跟着」这条**不变量**，而不是某一条特定提示。（修复前对照：这三条全红，帧 `top 51 → 94`。）

## 九、文件读写与编辑回流

一切文件访问走宿主的文件系统 seam `ctx.fs`（远程/沙箱工作区同样适用），不直接用 `node:fs`：

| 能力    | 接口                                                               | 用途             |
| ----- | ---------------------------------------------------------------- | -------------- |
| 定位与探测 | `resolve(path, { cwd })`、`stat`、`lstat`、`listDir`                | 卡片 ↔ 文件的对应与存在性 |
| 读取    | `readText`、`streamText`、`readBytes`、`readByteRange`              | 摘要提取、预览、缩略图    |
| 写入    | `writeText(target, content, expected?, signal?, sandboxPolicy?)` | F8.1 双击改字写回源文件 |
| 编辑    | `editText(target, edit, { version })`                            | 结构化就地编辑        |
| 地址    | `contains`、`fileUrl`、`processPath`                               | 路径越界与 URL 生成   |

**唯一的例外：改名（v1.53，F1.12）**。seam 只有「读 / 写 / 就地编辑」，没有 rename 动词，而改卡片名必须真的把产物在盘上换个名字（F5.3 的文件引用是按路径交出去的，路径不跟着变就等于引用失效）。所以 `ArtifactIo.renameEntry(root, from, to)` 直调 `node:fs/promises.rename`，但**把 seam 原本给的三样保证在本地复刻**，一道都不省：

1. 源与目标都过 `fs.contains(boundary)`，越界一律 `FS_PERMISSION_DENIED`；
2. 目标处的沙箱策略是 `read-only` 就直接拒（`FS_SANDBOX_DENIED`）——不改只读工作区；
3. `processPathOf` 证明「宿主路径 → 进程路径 → 宿主路径」回到**同一个 `targetKey`**才动手，证明不了就 `FS_NOT_OBSERVED`（同名不同物、符号链接、大小写折叠这类情况一律不动手）。

判据在 `tests/core/artifact/artifact-io.spec.ts`：真临时目录上移文件、移目录（入口页跟着走）、路径证不出是同一个文件时拒、越出工作区时拒、只读沙箱拒、源不存在时报 `FS_NOT_FOUND`。**这里不是「沙箱/远程用不上」——是 seam 缺这个动词**；将来 seam 补上 rename，这一处就该收回。

三个策略事件正好承接「用户操作回流」：

- `fs/write-intent`（waterfall）：写入前的单槽决策，首个返回意图的监听者接管，可实现「画布内编辑落进 pending buffer 而不是直接落盘」。
- `fs/edit-intent`（waterfall）：编辑意图的拦截与改写，F8.4「意图回流」的天然挂点。
- `fs/observed`（emit）：权威的读写观测记录，用于把「谁改了这个文件」同步给下游卡片与引用对账（F4.5）。

写入带**版本守卫**（`expected: FsWriteIntent` / `{ version }`），因此「Agent 刚改完、用户同时手改」不会静默互相覆盖。写入还需携带沙箱执行策略参数，卡片编辑要遵守部署的权限预设。

### 交给 IO 层的永远是**路径**（v1.49 的欠账，v1.57 补齐）

IO 层（`core/artifact/artifact-io.ts`）的入参是**项目根 + 项目内的相对路径**——`tests/core/artifact/artifact-io.spec.ts` 里的调用形态就是这句契约的判据（`io.write('/proj', 'a.md', …)`、`io.view('/root', 'site/index.html')`）。而卡片记录上的那条路径得经 `cardFileOf(record, id)` 翻出来：v1.49 之前卡片 id 就是路径，两者随便混；解耦之后混一处就是一次静默失败——喂进去的 id 被当成相对路径，于是要么写到一个以座位 id 命名的游离子文件上（`<root>/qkxwvd`），要么对着一个不存在的文件说「没有这份产物」。两种都不报错。

落刀的现场与受影响的方法见上表「卡片身份」那一行。**判据读源码**（`tests/host/card-paths.spec.ts`：凡是喂给 `io.*` 的实参里出现裸 `cardId` 的，必须同时出现 `fileOf(`），而不是跑一遍：这一层要跑起来得有整套宿主装配，而漏改的表现恰恰是「装配好了也照跑不误」。

### 读一整个**目录**：`read_bundle` 与它的预算（F10.1，v1.58）

应用节点的产物是一个文件夹，而「导出」的意思是**把这份东西完整地交出去**——不是把它渲染成别的格式，是连它的每一个文件一起走。于是需要一条别的读通道：`card/read_bundle`（`ArtifactIo.bundle`），把产物**整个目录**递归读成一个可打包的清单。

分工与文本导出完全一样，理由也一样：**能读的那一侧读，能下载的那一侧打包**。目录只有 Host 走得动（`ctx.fs`），而 zip 在客户端生成（`client/canvas/bundle-export.ts`），因为下载发生在那儿。这条分工带来一个结果：**它不依赖部署的导出能力**——没有 `dsh-canvas.capabilities` 的部署上，应用卡片的导出照常工作。

#### 「产物是哪一项」要路径与磁盘一起看（`bundleTarget`，v1.58）

这一条曾静默地发过半份包，所以单独记一笔。**卡片记的是入口页，不是那个文件夹**：scaffold 的约定是目录应用的入口页固定叫 `index.html`，于是 app 卡的 `file` 是 `应用/index.html`——磁盘上问「这是文件还是目录」，答案永远是「文件」。照着这个答案打包，包里就只有那个 `index.html`：同目录的 `styles.css` 与 `app.js` 一个都不在。用户拿到一个解得开、打得开、**但一打开没有样式也没有交互**的包，而导出按钮说「已导出」。

所以「产物是一个目录」有**两条各自充分**的证据，取或（`core/artifact/bundle.ts` 的 `bundleTarget(file, directory)`）：

| 证据                  | 谁给的                      | 覆盖的座法                                 |
| ------------------- | ------------------------ | ------------------------------------- |
| 磁盘上它就是目录            | Host `probe`             | `folder` 形态的产物（`file` 直接是目录，没有入口页这回事） |
| 路径是一条入口页            | `isEntryPage(file)`      | 目录应用的入口页座法（`应用/index.html`）           |
| —— 例外：入口页落在**画布根**上 | `dirnameOf(file) === ''` | 退回文件形态——那一层是全部卡片的公共场地，不是这一份产物的配套资源    |

入口页这条判据**不是新知识，是复用的**：改名（`planRename`：入口页改目录、其余改文件）、预览（`inlinePageAssets` 按入口页所在目录解析 `styles.css`）、扫描项目（`scanProject` 认目录里的入口页）用的是同一条。四份各写一遍就是四份会各自漂移的知识，而它们漂移起来是**静默**的——改名的判据错了是改错文件，打包的判据错了是**少装几个文件**。根上入口页的例外也不是新规矩：`planRename` 把它判成 `root-entry` 拒改，`cardNameOf` 说它「没有文件夹可以借名字」，同源。

> **踩过的地方（这一条是怎么漏过 43 条判据的）**：判据的**调用形态与真机不一致**。`bundle` 原有 7 条判据全部用目录路径调用（`bundle('应用1')`），而宿主传进来的永远是卡片的 `file`（`应用/index.html`）——一个从没被调用过的形态，自然从没被验过。补上的判据要点只有一个：**按真机传什么就调什么**。

这一条也是全插件唯一**形状无界**的读（读的是一棵树，不是一个文件），所以界设在别处，一道都不省：

| 界       | 判据                                                                             | 理由                                                                 |
| ------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 哪些条目不进包 | `bundleSkipped(name)`（`node_modules` / `.git` / `.dsh-canvas` / `.DS_Store` …） | 依赖缓存与工具内部结构不是这份应用；`dist`、`build` **不在此列**——那是用户可能确实要交付的东西，该不该带由他决定 |
| 单个文件    | `BUNDLE_ENTRY_BYTES_LIMIT`（4 MB，`readBytes` 的硬上限）                              | 一个巨大的文件在这里就被 seam 拒掉，不会先读进内存再发现装不下                                 |
| 总量与条数   | `BUNDLE_BYTES_LIMIT`（8 MB）/ `BUNDLE_FILE_LIMIT`（300）                           | 「一次导出能可靠搬运」与「一个应用有多大」之间的那根线                                        |
| 递归深度    | `BUNDLE_DEPTH_LIMIT`（12）                                                       | 不是防环（一个条目只有一个父目录），是防**病态的深**：层的名字要拼进 zip 的条目路径，而条目名有长度上限           |

装不下的东西**绝不悄悄丢掉**：它记在 `skipped` 里、`truncated` 立起来，客户端据此**拒绝导出**并说一句话——与文本导出读到半份就不导是同一条规矩。条目按名字排序、路径一律用 `/` 连，于是同一份目录永远读到同一份清单（可断言，而不是只能看）。

文本与二进制的分野也在这一条通道里定：**一个文件先按字节读回来（seam 自带硬上限），再试着按 UTF-8 解码**——解得开就是文本（HTML / CSS / JS，应用目录里绝大多数），解不开就是二进制，原样 base64。分两条路读（`readText` 兜底 `readBytes`）会多读一次，而且 `readText` 没有上限。

打包那一侧只有**一份 ZIP 写入器**（`core/artifact/zip.ts`）：`.docx`（一个 OOXML 包，本来就是 ZIP）与应用节点的 `.zip` 共用它——两份实现迟早会在同一个包上给出不同答案。压缩走方法 8，压缩器由调用方注入（客户端是平台的 `CompressionStream('deflate-raw')`，没有它就按 stored 落包）；`.docx` 走存储（方法 0），保持同步与逐字节确定。

> **踩过的地方（判据是从这里长出来的）**：条目的 **CRC 属于未压缩内容，不属于 payload**。写入器最初对 payload 算校验和——`stored` 那条路 payload 恰好就是原文，所以一直是对的；压缩一旦启用，包会**带着坏校验**发出去：解压器能列出文件名、能解开 stored 的条目，只在压缩的那些上报 `bad CRC`。抓出它的是把包交给**别人的解压器**那两条判据（`/usr/bin/ditto -x -k` 解出中文目录名、`/usr/bin/unzip -t` 逐条校验），不是回读自己的写器——两个自己的实现会一起错。


### 设计稿的四条出路：fig / 图片 / PDF / PPT 全在浏览器里画（F10.1，v1.59–v1.61）

设计节点的产物是一份场景图快照，而它要交出去的四样东西**一件都不在部署上**：`.fig` 要 Figma 自己的 kiwi schema，图片与 PPT 要一个真渲染器，PDF 要 DOM（上游那条实现靠 `DOMParser` + `svg2pdf`）。这些全在用户这台浏览器里——而设计稿本来就是浏览器里的场景图。于是这一档继续走「能本地做的在本地做」，与前两档（文本排版 v1.57、应用打包 v1.58）是同一条分工，只是这次落点更远：**四样都自己画**。

| 产物           | 粒度                                     | 依赖                                    |
| ------------ | -------------------------------------- | ------------------------------------- |
| `.fig`       | **整份文档一个文件**                           | `@open-pencil/fig`（kiwi 编解码 + fflate） |
| 图片（`.png`）   | 一容器一张，**2 倍像素**；多张打成一层同名文件夹的 zip       | CanvasKit 的渲染器                        |
| PDF          | **整份文档一个文件**：一容器一页，页写在文档里面（页面尺寸逐页跟着容器） | `jspdf` + `svg2pdf.js` + `DOMParser`  |
| PPT（`.pptx`） | **一页器一份**幻灯片序列；多页就是多个包                 | CanvasKit（降级栅格化）                      |

**分工的界线落在两个模块之间**：`client/canvas/design-export.ts` 管「产物该叫什么、怎么装、怎么说」（纯逻辑，node 里跑得动，判据穷举），画的那一步在引擎 chunk 里（`client/artifact/viewers/design-io.ts` 的 `designExport`，只吐「一件件字节」）。这样切是因为两件事的可测性正好相反：命名与装包要判据，画图非浏览器不可。

#### 为什么绕不开自己的渲染器

上游有一条「headless」的路（`headlessRenderNodes`），它在 node/bun 里靠 `import.meta.resolve('canvaskit-wasm/full')` 找 wasm——**浏览器里 `import.meta.resolve` 根本不存在**。所以图片与 PPT 的降级栅格化必须拿到我们自己的渲染器，经 `context: { canvasKit, renderer }` 递进去（`design-skia.ts` 的 `createExportRenderer`）。它比预览那台多一步：**先等 CJK 字体就位**再声明回落族——中文在没有回落族时渲染成空白，而导出是「一次成品的交付」，不能等到画完才发现字没了。

门面这条：`fig` / `svg` / `raster` 三条子路径在包的 exports map 里，而 **`pdf` 与 `pptx` 不在**（只有 `BUILTIN_IO_FORMATS` 里那两个 adapter 认得它们）。所以 fig / 图片 / PPT 三条走 `IORegistry.exportContent`（上游自己给外部用的那一面），**PDF 那条绕过它自己建文档**——理由见下面「PDF 那条为什么要自己建文档」。

#### fig 的压缩 worker：一个必须按依赖点名的名字

`.fig` 是一份 zip，打包那一步在上游的实现里会**开一个 module worker**去压缩，URL 写的是它自己旁边那个文件：`new URL('./export-worker.ts', import.meta.url)`。这句进不了打包器的相对解析簿记——`import.meta.url` 到运行时才落地，取到的就是我们那份 chunk 的地址（`/dsh-canvas/assets/design-engine.js`），于是它去要 `/dsh-canvas/assets/export-worker.ts`。那个文件不在的话 worker 拉不起来，`onerror` 一响**整趟 fig 导出失败**——而 Figma 文件正是用户点名要的四样之一。

所以 `build.mjs` 就按它点名的名字产出：**内容是一份普通 ESM 打包结果（含 `@open-pencil/fig`），名字却是 `.ts`**（上游 dist 里只有 `export-worker.js`，逐字拼的却是 `.ts`；改写依赖里的字符串是个会悄悄失效的补丁，不做）。名字骗人的代价由资产路由承担——`host/assets.ts` 的 `CONTENT_TYPES` 里多一格 `.ts → text/javascript`，module worker 对 MIME 有硬要求。（同一份 chunk 里还有第二处 `new URL('./worker.ts', …)`，那是上游 **读** `.fig` 用的会话 worker；我们从不读 `.fig`，而且它自带「worker 起不来就退回主线程」的兜底，不需要跟着产出。）

> **踩过的地方（一条真浏览器判据抓出来的）**：**`writeDocument` 那条路必须点名缩略图用哪一页**。`renderFigThumbnail` 拿不到页 id 时**直接交那张 1×1 的占位图**，而 `writeDocument`（整份文档，没有选区可提取）不会替你猜——上游的兜底只认一个叫 `cover` 的页（Figma 的封面页约定），我们的文档没有这个约定。症状是「导出成功」而 Figma 里的缩略图一片空白，**两处都不报错**。现在显式传第一页（`thumbnailPageId`），探针把它钉住：缩略图 512×213，正是第一页上两个容器的并集比例。

#### 交出去的图里的字体名：三条路各换各的（v1.60–v1.61）

四条出路里**三条把字体名交出去**，而三条栽的姿势各不相同；第四条（图片）的字是我们自己画的——那个名字在那边是「拿去 `fontManager` 找字面」用的，换掉反而画不出字。而那个名字是**我们自己这边的东西**：会话预设从不提字体（`host/prompt.ts` 里没有这一项），文字节点全落在 core 的 `DEFAULT_FONT_FAMILY`（`Inter`）上，汉字靠仓库 vendored 的 `Noto Sans SC` 回落——两者都只活在本插件的资产路由里，**对方的机器上没有**。

| 出路     | 那个名字交给谁                                                            | 写 `Inter` 的后果                                          |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------ |
| PPT    | 对方的 PowerPoint（原生可编辑文本的 `typeface`）                                | 找不到这支字体，而它又没有汉字字形 ⇒ 中文**整段丢**                          |
| `.fig` | fig 写器，拿它去 `fontManager` 取**字形轮廓**烘进 `derivedTextData`（**不做任何回落**） | 九个汉字全落 `.notdef`：**同一个 738 字节的轮廓写九遍**，Figma 打开是一串同一个形状 |
| PDF    | `svg2pdf`，拿它去 `pdf.getFontList()` 找字面；找不到**一律回落 `times`**          | Type1 标准字体没有汉字字形，中文被当单字节写进内容流（`(N;ÆÉÿO`Y}ÿ¾\`）         |
| 图片     | ——                                                                 | （不换）                                                   |

PPT 那条的现场：标题与正文是**原生可编辑文本**——上游 `addEditableText` 把文字交给 `pptxgenjs`，名字走 `fontFace: s.fontFamily ?? node.fontFamily`，最后落成 run 上那三行：

```xml
<a:latin typeface="…"/><a:ea typeface="…"/><a:cs typeface="…"/>
```

（`pptxgenjs` 那段的写法是 `if (opts.fontFace)`——**名字为空就整段不写**，那时 PowerPoint 用主题默认：`minorFont` 的 `ea` 是空的，由打开它的机器自己定。）这个 `typeface` 会在**对方机器上**解析，于是中文整段丢。用户原话「导出 PPT，第一页的字体丢失」，**而「只有第一页」正是它的指纹**：封面那种纯文字页全走原生文本，后面几页的文字落进了图片回退（渐变 / 遮罩 / 矢量子树），那部分是我们自己画的所以正常。

**三条路换名，一张表说了算**：`core/artifact/design/export-font.ts` 的 `EXPORT_TEXT_RETARGET`（`pptx → Microsoft YaHei`、`fig → Noto Sans SC`、`pdf → NotoSansSC`），`retargetTextFonts(graph, retarget)` **逐段 `styleRuns` 一起换**——run 上那个 `fontFamily` 会盖过节点那一个，漏掉它等于漏掉被单独设过字体的那几段。调用点挡在 `design-io.ts` 创建渲染器**之前**：fig 那边写器就是按这个字段去取字形轮廓的，晚了取的就是旧名字。表单独做成一张而不是埋在 `if` 里，是为了让「只有这三条要换、各换成什么」本身被判据点名测到。

选名各有各的道理：

- **PPT → `Microsoft YaHei`**（写英文名：OpenXML 的 `typeface` 按字族的英文名解析，各语言版本都认）。中文 Windows 与 WPS 必然有它，Mac 上替换成系统黑体，而它是黑体、与设计稿那套「Inter + 思源黑体」最接近。
- **fig → `Noto Sans SC`**。这必须是**我们在 `fontManager` 里注册的那个名字**：fig 写器按它去取字形轮廓，注册名与消费名不是同一个字符串，就是「导出成功而所有字长得一样」这种什么都不报的失败。所以两端共用一个常量 `CJK_TEXT_FAMILY`（`design-skia.ts` 的 `markLoaded` 与 fig 都用它）。
- **PDF → `NotoSansSC`**。不叫 `Noto Sans SC` 是因为 `svg2pdf` 拿 `font-family` 整串去 `getFontList()` 里**逐字**找键：名字必须与注册时那个 id 一模一样，多一个空格都对不上。

#### PDF 那条为什么要自己建文档（v1.61）

上游有一条现成的 `renderNodesToPDF`，做的正是这里做的事（选区 → SVG → `new jsPDF(…)` → `svg2pdf`）。但**字体必须注册在「正要写的那一份文档」上**——svg2pdf 是按 `pdf.getFontList()` 找字面的。而那个函数不在包的 exports map 里（`renderNodesToPDF` 没从 `@open-pencil/core/io` 顶层露出来），从门面走进去就够不着它内部那句 `new jsPDF(…)`。

试过「先随便建一份注册、指望 jsPDF 的全局事件把它带给后面新建的实例」——`jsPDF.API.events` 那条队列**不会**把字体带过去（真测过：新实例的 `getFontList()` 里没有）。所以只能自己建：`client/artifact/viewers/design-pdf.ts` 直接 `new jsPDF(…)`。零件都露着（矢量图是 `renderNodesToSVG`、量尺是 `computeContentBounds`），`jspdf` / `svg2pdf.js` 本来就在引擎 chunk 里（上游那条路也在用它们）。

三件事定在那里：

- **嵌进去的是子集**：`putOnlyUsedFonts: true` 必须**显式**开着。jsPDF 默认 `false`，会把**注册过的每一支字面整个嵌进产物**——四个样式就是四份 17.7MB。这也是个静默失败：开着关着都「导出成功」。实测三页中文稿 **51KB**，`/Type0` + `/Identity-H` + `/FontFile2` + `/ToUnicode` 都在（文字可选中、可搜索）、矢量。
- **字体名与 SVG 里写的是同一个常量**：注册走 `doc.addFont(PDF_FONT_FILE, PDF_TEXT_FAMILY, style)`，而 `font-family` 由上面那张表换成 `PDF_TEXT_FAMILY`。
- **PDF 还要顺手收字重**（`snapWeight: true`，三条路里只有它为真）。两个理由叠在一起：我们手里只有一支 `NotoSansSC-Regular`，任何字重画出来都是它；而 svg2pdf 对第三档字重会算出一个**谁也不认的样式名**（jsPDF 4 那条分支是 `(fontWeight + '') + fontStyle`，500 出来就是 `'500normal'`），那一格没注册就**回落 `times`**——又变回这次要修的病。收成 400/700 之后样式名只可能是 normal / bold / italic / bolditalic，正好是 `pdfTextStyles(graph)` 会注册的那几个（它读同一份换过名字的图，永远含 `normal`；只注册用得上的那几个，免得为一篇没粗没斜的稿子把 18MB 字面多解析三遍）。

粒度也随之简化：**PDF 与 `.fig` 一样是整份文档一个文件**（页写在文档里面，一容器一页、页尺寸逐页跟着容器），客户端那边不再有合并这一步——`client/canvas/pdf-merge.ts` 与它带来的 pdf-lib 依赖一起删掉了。

> **踩过的两个地方**：①**判断「字体嵌没嵌」不能用裸 grep**。jsPDF 开着 `compress`，字形程序与 CMap 都压过，`/BaseFont` 一个都 grep 不到——最初因此误以为「没嵌」，改用 pdf-lib 摊开对象才看见真相：**42 个 `/Type1`**（jsPDF 的 14 支标准字体 × 3 份），每页只有一个 `Tj`，参数是中文原始字节。②**「一个字符一个字节」的编码不能多走一趟**：`addFont` 那条二进制口子要的是 `String.fromCharCode` 拼出来的字符串（一个字符 = 一个字节），拿 UTF-8 编过一遍字体表整张就烂；而 17.7MB 一次铺开 `String.fromCharCode(...bytes)` 会**爆栈**，所以按 16KB 分块（`binaryStringOf`）。

#### 判据分两层，验证交给别人的工具（v1.61 补字体）

- **浏览器里**（`.workbuddy/repro/design-export/`）：起一个最小的静态服务复刻资产路由，真 Chrome 打开一页，动态 import 真的 chunk、真跑四次 `designExport`，把四份产物的**字节**带出来。信封不是手抄的——`gen-doc.mjs` 用产品自己那条编码路（`encodeDesignFile`）生成，手抄一份快照结构就等于在探针里养第二个「信封长什么样」。
- **node 里**：`unzip -t` 逐条校 CRC、自己解 PNG 的 IHDR 验 2 倍、解 `.pptx` 逐张看 `typeface` 与中文还在不在、看 `canvas.fig` 的 `fig-kiwi` 签名。**回读自己的写器两个实现会一起错**（v1.58 的 CRC 就是这么抓出来的），所以这一层一律交给别人的解压器与别人的库：
  - **PDF**：pdf-lib 摊开对象数页数、页尺寸与字体（`/Type0` + `/Identity-H` + `/FontFile2` + `/ToUnicode`，且**一支 `/Type1` 都不在用**），再用 `node:zlib` 把 `ToUnicode` 的 CMap 自己解开、看汉字的码位（`4f60` 你 / `597d` 好）真的在表里——**CMap 说的是「这个字形是哪个字」，它对了就意味着字与码位没有错位**，而那正是「同一个字形写九遍」这类错误会留下的痕迹。
  - **`.fig`**：用**上游自己的读器**（`parseFigFile`）把产物解回场景图，逐字形比 `commandsBlob`：**不同轮廓数 === 不同的字数**。修之前这一条是 `1 / 17`（全是同一个 `.notdef`），现在是 `17 / 17`。
  - 两条还能互相印证：**fig 写器烘了几个不同的轮廓，jsPDF 就写了几条字形↔码位映射**（探针里比 `pdf=17 fig=17`）——两个独立实现对同一份稿子说同一件事。

### PDF 交出去之前，先把那张 SVG 修三处（F10.1，v1.64）

PDF 是四条出路里唯一「把矢量图交给**别人的排版器**」的一条：`renderNodesToSVG` 画出来，`svg2pdf` 逐元素转写成内容流。忠实是它的本分——所以**上游那张 SVG 与画布不一致的地方，会一模一样地被画出来**。真机报的「导出 PDF，文本换行，和圆角矩形渲染不正确」就是三处这样的地方：

| 处  | 上游那张 SVG                                                  | 画布（CanvasKit / skia）    | 真机看到的样子                                            |
| -- | --------------------------------------------------------- | ----------------------- | -------------------------------------------------- |
| 文本 | 整段塞进**一个** `<text>`，`y` 只有第一行的基线                          | 按节点宽度折行（skia 段落排版）      | 画布三行、PDF 一行，一路冲出容器右边界（实测 701pt / 容器 720pt）         |
| 裁剪 | `clipsContent` 的容器套一层 `<clipPath><rect>`——**直角**，没有 rx/ry | 按圆角裁（`clipRRect`）       | 圆角容器里铺满的子块把四角**填平**：画布露白底、PDF 是直角矩形                |
| 圆角 | `rx` 夹到 `w/2`、`ry` 夹到 `h/2`，**各自**夹                       | `RRect` 把超限圆角**整体按比例缩** | 200×140 给半径 100：画布是超椭圆（最上一行实心 84pt），PDF 是正椭圆（34pt） |

修在「SVG 生成之后、交给 `svg2pdf` 之前」这一层：`design-pdf.ts` 里那道 `repairPdfSvg`。**判据与算法在 `core/artifact/design/pdf-svg.ts`（零依赖纯模块），DOM 操作留在 `design-pdf.ts`**——分界点就是「要不要 DOM」。三件事必须**按这个次序**：先补裁剪的圆角（那是新写进去的值），再统一夹一次圆角（新值本身也可能超半轴），最后折行。

**一、怎么把无名的元素配回它的节点。** SVG 里没有「我是谁」：`<clipPath>` 只有 `clip0` / `clip1` 这样的编号，`<text>` 连编号都没有。靠的是**复刻上游那条先序**（`clipOrder` / `textOrder`：顶层是容器，逐层下潜，`!visible` 整棵跳过，裁剪还要求 `clipsContent && 子节点数 > 0`——**子节点不可见也算「有子」**，因为 clipPath 早进了 defs，用不用得上是另一回事），再叠一道**可校验的事实**：裁剪比 `w/h`（与节点 `round` 后相同）、文本比内容（元素文本 === `node.text`），两道都过才动。**任何一步对不上就不动**——不改的结果是「还是导出成老样子」，改错的结果是**把人家的稿子画坏**，而后者用户看不出来。

**二、折行的尺子必须是最终那支字面。** 折行边界决定「几行、在哪断」，那必须与真画出来的字一致——PDF 这条路上所有样式都注册在同一支中文字面上（`PDF_TEXT_FAMILY`），所以尺子用 jsPDF 自己的字表：`getStringUnitWidth(slice) * fontSize + letterSpacing * (len - 1)`（`letter-spacing` 是 svg2pdf 自己加的 charSpace，jsPDF 的字表里没有这一格，得自己叠）。断行规矩与浏览器 `word-break: normal` 同一路：**中日韩逐字**、**西文按词**、行内不留尾随空白（空白留给下一行行首，否则画出来尾上多一截）、`\n` 是硬换行、一个词本身超宽就硬断。`TRUNCATE` 那个尺寸行为靠 `maxLines` 落地（放不下的行干脆不生成——画布上也是裁掉，不画省略号）；`WIDTH_AND_HEIGHT` 不折（宽度是文字自己撑出来的，没有可折的边界）。

> **踩过的地方（一个真死循环）**：第一版的断点函数在「落在一段空白的开头」时**返回了自己**，于是游标不前进、折行原地打转——整趟导出卡在页面里，最后以 Puppeteer 的 `Runtime.callFunctionOn timed out` 现身（看上去像「网络慢」或者「渲染慢」，其实是死循环）。**「按断点回退」这类循环，游标的严格前进要当成硬条件写**（空白那一支要**走过整段空白**再报位置），另加一道「一行连一个字都放不下就硬断」的兜底。

**三、折出来的每一行是一个新的 `<text>`**：复制原元素全部属性、只改 `y`（`baseY + row * lineHeight`，行高取 `node.lineHeight`，没写按字号 ×1.2），行内的 `styleRuns` 片段各自成 `<tspan>`。**没有赌 `svg2pdf` 的 tspan 支持**——每个 `<text>` 都有自己的 x/y，那是它最成熟的一条路径，而且 `text-anchor` 跟着属性一起复制，居中/右对齐天然还对。

**判据两层**：折行与夹取都是**注入测量器**的纯函数（判据给一把「一字 10pt」的假尺子，就能把断行边界、回退、硬断、截断、行尾空白逐条点名验），另加四组**与上游源码对账**——我们复刻的那句遍历条件、那个直角裁剪矩形、那句「一个 `<text>` 放整段」、还有「裁剪是先序生成的」，上游一改这里就红；端到端那一层在 `.workbuddy/repro/design-export/`：`wrap-doc.mjs` 造一份「长文本 + 圆角容器 + 超半轴圆角」的稿子，`wrap-probe.cjs` 真浏览器导出，`wrap-check.py` 用 **MuPDF 摊开产物**数行数、量每行右边界、采样圆角容器四角的像素、数超半轴圆角最上一行的实心宽度。七条**逐条验红**（四条纯判据 + 三条端到端：不折行、不补裁剪圆角、不夹圆角各自精确命中）。

**已知项（未做）**：**独立圆角**（`independentCorners`）的容器这一轮没补裁剪圆角——`<rect>` 只有一对 rx/ry，四个角各不相同就得写成 `<path>`（`clipPath` 支持 `<path>`，上游的 `roundedRectPath` 也能复用）。

### `.fig` 交出去之前，把节点改写成写器烘得对的那一种形状（F10.1，v1.65）

PDF 那条还能在**中间产物**（SVG）上修；`.fig` **没有中间层**——它是终产物，错的那一步（烘字形）就在写器里，而写器在依赖里、我们不碰。于是这条路的修法只剩一个方向：**改输入**，让每个文本节点都长成它烘得对的那一种形状。

烘字形那一步（上游 `@open-pencil/fig` 的 `buildDerivedTextData`）**只对「单行 + 左上对齐」成立**：

| 处    | 写器烘出来                                                                  | 画布（CanvasKit 段落） |
| ---- | ---------------------------------------------------------------------- | ---------------- |
| 行    | `baselines` 恒一条 `[0…text.length-1]`，所有字形的 `y` 恒为 `lineHeight`          | 按节点宽度折行，每行一条基线   |
| 横向   | `position.x = glyph.x \|\| index * glyphAdvance`——第一个字恒为 0，**从节点原点起算** | 居中 / 右对齐那段偏移     |
| 纵向   | `position.y = lineHeight`，等于把垂直对齐当 `TOP`                               | 居中 / 靠底那段偏移      |
| `\n` | 照样进 `forEachGlyph`，cmap 里没有码位 ⇒ `.notdef`                              | 换行符是分隔符，不是一个字    |

真机两轮报的四句话全在这个表里：不折行（`baselines` 只有一条）、错位（第 2 行起叠在第一行的基线上）、一个方块（`\n` 的轮廓照烘）、居中变居左（那段偏移烘不进去）。

**改写做两件事**（都在 `design-io.ts` 的 `figDocument`，且都在 `IO.writeDocument` 之前）：

1. **把中文字面按稿子用到的每个样式名登记一遍**（`registerFigFontStyles`）。写器取字形轮廓与 `fontDigest` 都按「字族 + 样式名」去 `fontManager.loadedData` 找，查不到就给 `null`——**字形数组空、摘要也空**，在 Figma 里就是「这段字不见了」（真机报的「部分文字不渲染」）。稿子里写着 700 的字问的是 `Noto Sans SC | Bold`，而我们手里只有一支 Regular；把同一份字节按每个用到的样式名 `markLoaded` 一次，字在、摘要也在（轮廓仍是常规粗细，本来就只有这一支）。**必须挡在量折行之前**——量行用的就是同一支字面。
2. **把「写器会烘歪」的文本改写成一行一个节点**（`splitFigLines` → `replaceWithLines`），位置取**画布自己那份段落**的逐行量：`renderer.buildParagraph(node, undefined, { halfLeading: true })`（与 `renderText` 画的时候同一个选项）→ `paragraph.getLineMetrics()`。折行位置与对齐偏移因此不可能与画布不一致——**同一份排放，只是一次换成 N 个节点**。

**值不值得改写，判据不是行数**（`core/artifact/design/fig-text.ts` 的 `worthRewriting`，零依赖纯模块）：多行会歪，对齐偏移非零也会歪，两条都不占的（单行 + 左上对齐）一个字段都不碰。这是第一轮与第二轮的差别——第一轮按「行数 ≥ 2」放行，于是**单行居中**这条最干净的用例根本没被碰到。

替换出来的节点被收成「写器烘得对的那一种形状」：`textAutoResize: 'WIDTH_AND_HEIGHT'`、`textAlignHorizontal: 'LEFT'`、`textAlignVertical: 'TOP'`，并把 `textPathData` / `textPathBox` / `textPicture` / `derivedTextGlyphs` 全清成 `null`（那几张表是**原来那一段**的排法与烘焙，留着写器会按路径再烘一遍）。位置两条：

- `x = node.x + line.left`——**行左边缘已经含对齐偏移**（`LineMetrics.left` 是行左边缘：居中那一组实测 804.1 / 806 / 938）
- `y = node.y + figVerticalOffset(node, contentHeight) + line.baseline - figLineHeight(node)`——写器把基线烘在节点内 `lineHeight` 处，所以要让出这一格；`lineHeight` **必须与原节点字段一致**（拆行不改它，写器用的就是这个数）。`figVerticalOffset` 逐字复刻画布那条 `textVerticalOffset`（`scene.ts`）。

于是**不管对方是按我们烘的字形画、还是自己照字符重排，落点都是画布上那一个**：框贴住了这一行，对齐字段已经没有可做的事。这一点是真的两可——`.fig` 里 `nc.textAlignHorizontal` 确实写出去了（`serialize.ts` 那句），而字形坐标是按左上烘的，谁听谁的由 Figma 定。改写成「贴住内容、左上对齐」让**两种解释都对**，不必赌。

**两处保守**：自动布局的父容器下**不拆**（拆出来的 N 个兄弟会参与流式排布、叠起来还把父框撑开，而它们本来只是一段文字里的几行）；带旋转 / 翻转 / 大小写转换 / 路径文字 / 自带烘焙，或行区间对不上原文的节点一律**返回 `null`**——不改是「还是老样子」（用户看得见），改错是把人家的稿子画坏（用户看不出来）。

**顺带修掉的一个真缺陷**（做这条时撞上的）：`decodeDesignFile` 出来的图**不能复制**——`instanceOverrides` 里那两个 `Map` 被 `JSON.stringify` 写成 `{}`，而 `cloneTree` 第一句就是 `[...state.self]` ⇒ `state.self is not iterable`。**「复制页面」在每一份真文档上都是这个死法**，而 `pages.spec.ts` 全绿是因为那些判据都在内存图上跑、从没喂过一份解出来的图。现在 `document.ts` 解包时把表按上游那套反序列化复活（不是数组就当空表），判据钉在「**解出来的图**」上。

**判据三层**：`fig-text.ts` 是纯的（真节点 + 手写的 `LineMetrics`，24 项）；接线读源码文本（`design-io.spec.ts`，锚到**代码行**——这几个字面在注释里也出现过）；端到端在 `.workbuddy/repro/design-export/`——`fig-doc.mjs` 造 10 个容器（含**圆角矩 + 单行居中**那条真机用例），`fig-probe.cjs` 真浏览器导出，`fig-dump.mjs` **摊开原始 kiwi 载荷**逐字段看（**不走我们自己的读器**：写器写了什么、读器怎么理解，是两件事）。四处逐条**验红**。黑盒回归：修复前后两份产物的 `diff` 只有那两个标签的 18 行（其余 24 个文本节点一个字节没动）。

**已知项（未做）**：**两端对齐**（`JUSTIFIED`）的多行文字在 `.fig` 里按左对齐烘——段间那点拉伸是**排版器**算出来的，而写器的 `position.x` 只认字形自己的进距。要让它在 Figma 里也拉开，得自己造 `derivedTextGlyphs`（逐字带坐标），而那份几何 blob 只有 `@open-pencil/fig` 内部能编码。第一轮起就如此，不是这一版引入的。

### PPT 那条：把越界的子块预夹掉，保住每页的可编辑性（F10.1，v1.66）

上游 pptx 导出器**本来就是「可编辑混合导出」**（`io/formats/pptx/export.ts`）：文本 / 矩形 / 椭圆 / 直线转成原生 PowerPoint 元素，矢量 / 渐变 / 遮罩 / 混合子树才退成 PNG。但它在 **root 一层**有一条极保守的闸（`rootContentFallbackReason`）：root 容器**开着裁切、且任一可见子孙越界**（`clipsOverflowingContent`，容差 `CLIP_EPSILON_PX = 0.5`）⇒ **整页放弃逐元素转换、栅格成一张图**。它这么写是有理由的：PowerPoint 没有「容器裁切」这种原生概念，逐元素转换会让越界的子块**露出到容器外**——只是这个理由在我们这儿不成立：**我们的容器默认就开裁切**（`ops.ts`、`document.ts`，Figma 的 frame 语义），越界那部分在画布上**本来就被裁掉、不可见**；AI 画稿时装饰子块贴边又几乎是常态，于是真机上每一页都命中，用户看到的是「每页一张图片」。

修法与 `.fig` 那条同源——**改输入**，而且只碰那份一次性导出副本（`core/artifact/design/pptx-preclip.ts`，接在 `design-io.ts` 的 pptx 分支、`perPage` 之前）：

- **夹的目标 = 它所有裁切祖先边界的交**（不只最近一层）——于是上游那两条闸（root 整页退图、中间容器退子树）一起解开，夹完对每一层都不越界。
- **合法夹的前提是数学上可证明的视觉等价**：矩形 ∩ 矩形 = 矩形，所以只有**直角矩形叶子**能夹，且要求纯色填充（≤1 个可见 `SOLID`）、无可见描边 / 效果、无子树、不当遮罩；几何上还要求**自己到每个裁切祖先的世界矩阵都是平移 + 正缩放**（`axisAligned`：`m[1]`/`m[3]` 近零、`m[0]`/`m[4]` 为正）——旋转 / 翻转由这一条统一挡，不在 `clippable` 里重复判（写了只是会飘的副本）。
- **夹不动的交给下一步**（见下）：圆角矩 / 椭圆（弧总在节点四角，夹小之后弧跟着挪位；椭圆连平直段都没有）、文本（夹宽度会重排）、矢量与带子树的容器——`stubborn` 计数如实记着，而**一个就够让整页退图**，所以这一半必须有下一步。
- **整块落在界外的**（画布上零可见像素）置 `visible = false`，上游 `walkNode` 直接跳过——也是等价。
- 越界判定**逐字复刻上游**（`TransformMatrix.invert` + `multiply(toNodeSpace, getWorldMatrix(child))` + 角点比 `[-0.5, w+0.5]`）：**夹的尺子与闸的尺子必须是同一把**，差一点就会出现「夹了还是退图」或「没越界也白夹」。判据里拿上游源码对账那几句字面，一改就红。

**判据**：`tests/core/artifact/design/pptx-preclip.spec.ts` 27 项——夹的几何、容差边界、两层祖先取交、每一档「夹不动」、不可见链、喂一份**解出来的图**，加上上游源码对账与接线（只有 pptx 那条路夹、且在 `perPage` 之前）。四处逐条**验红**（两处暴露出假绿：`rotation` 判据冗余、两层用例构型区分不出「取交」与「取最近一层」，都改掉了）。端到端在真浏览器导出后**解 OpenXML** 看每一页：修复前越界那页 `pic=1 sp=0`、`ppt/media/` 多一张 PNG；修复后 `pic=0 sp=3`、`ppt/media/` 为空。既有 41 项四路导出回归一条不差。

**已知项（未做）**：圆角矩 / 椭圆 / 文本 / 矢量**越界**时，那一页（或那棵子树）仍会退成图——要保它们的可编辑性，得让 PPT 能表达「容器的裁切」，而 OpenXML 里没有那个东西（图片有 `<a:srcRect>`，形状没有）。

### PPT 那条的另一半：夹不动的就地烘成一张图（F10.1，v1.68）

v1.66 上线的当天就撞回一句同族的真机反馈：「设计卡片导出 PPT，文字丢失，每一页应该是可编辑元素组成，不是一整张图片」。**先复现，再动手**：在 node 里直接调上游 `renderNodesToPPTX`（`options.rasterize` 换成 stub，这一趟只关心「谁是可编辑的」），拿一份「AI 画风」的稿子（容器 + 中文标题 + 一块贴边直角 + 一张贴边圆角卡片）跑一遍，读它自己记的 `stats`：

```
不夹：    editable=0  fallback=1  fallbackReasons={"clipped content":1}   ← 整页一张图，一个字都没转换
夹 + 烘： editable=3  fallback=0  fallbackReasons={}                      ← 文本 / 直角 / 卡片各自落地
```

`editable=0` 那句就是用户的「文字丢失」；`"clipped content"` 就是 v1.66 修了一半的那条闸——**它是 root 一层生效的，代价是整页**，所以「只夹得动直角矩形叶子」等于没修：真机上让整页退图的恰恰是圆角矩（AI 画稿的卡片几乎都是它）。

**做法**（`core/artifact/design/pptx-raster.ts`，接在 `preclipOverflowingRects` 之后、`perPage` 之前）：对每个「越界且夹不动」的节点，**建一个同尺寸的裁切 FRAME（`clipsContent: true`、无填充），把原节点挪进去（保持世界位置），连同裁切渲染成一张 PNG，再删掉这一框、在原 z 位放一个图片填充的矩形**。

等价性是可以证的，而且只在两个前提上：**一、栅格化画的就是画布上那块**——裁切框自己开裁切、原节点原封不动留在里面，输出的位图逐像素就是画布上被裁剩的部分（`renderNodesToImage` 的框取 `computeContentBounds([C.id])`，而它是**从 C 自己开始**算的：C 的框 ∪ 被 C 裁过的子 ⇒ 恰好是 C 的框，四周不会多出透明边）；**二、图片是矩形**——收进裁切框之后四边都是直角，裁剪一张位图与在画布上裁掉同一块**完全一样**（这正是圆角矩不能直接夹、却能烘的原因）。

四条边界，都是有意的：

- **范围 = 节点自己的世界框 ∩ 所有裁切祖先边界的交**，不是整个祖先交。写错成后者（**第一版真写错了**）图片会带上与本节点无关的一大片透明区、还平白多烘十几倍的像素——判据里那两条「烘的范围」就是钉它的。
- **只碰全链轴对齐的**（自己到页面每级都是平移 + 正缩放）。坐标换算因此只是「减去框的偏移」，不必去猜旋转中心在哪（节点转过的世界里，改 `x`/`y` 动的是旋转轴，不是左上角）；遮罩（`isMask`）也不碰——它靠「和兄弟的关系」生效，单独烘成一张图会让兄弟不再被它裁，那是**真画错**，不是保真度取舍。这两条与 v1.66 同一句话：不改 = 还是老样子（用户看得见），改错 = 把人家的稿子画坏（用户看不出来）。
- **画不出来就回滚**：`draw` 给 `null`（或空字节）时把坐标、父、z 序全部还原、拆掉裁切框——半改半不改比这坏。
- **名单只有一份**：`pptx-preclip.ts` 的 `overflowingNodes` 回答「谁越界了、该收进哪个框、夹不夹得动」，夹与烘两处共用；`stubbornOverflows` 就是「夹不夹得动」那一列的过滤。各写一遍迟早一个改了、另一个没跟上，而症状正是「修了还是退图」。

**判据**：`tests/core/artifact/design/pptx-raster.spec.ts` 19 项——烘的框（含**取交**那条与「不是整个容器」那条）、原来那一块没了 / 图片在原来的 z 位 / 字节进了 `graph.images`、四条「不碰」（画不出来回滚、空字节、遮罩、转过）、与 `preclip` 合起来收口（名单空 + 每个可见子孙对它每个裁切祖先都不再越界），外加喂一份**解出来的图**与接线（先夹后烘、都在 `perPage` 之前、只有 pptx 那条路走）。端到端另起一支真浏览器探针（`pptx-bake-check.cjs` + `gen-doc-ai.mjs` 那份「AI 画风」稿）：解 OpenXML 数 `<p:sp>` / `<p:pic>` / `ppt/media`，再把媒体里那张 PNG **送回浏览器采样**——**只夹不烘时每页 `sp=0 pic=1`、一张 2880×1800 的整页图、中文一个字都不在原生文本里**；夹 + 烘之后 `sp=2 pic=1`、媒体里只有一张 480×600（240×300 的 2×），左上角透明（圆角之外）、中心与右下角是卡片色 ⇒ 烘的正是画布上那块，不是整张卡片、也不是被夹成方的。四处逐条**验红**（裁切框取整个祖先交 ⇒ `4 failed | 15 passed`；去掉回滚 ⇒ 恰好红那一条）。

**已知项**：转过 / 翻转的越界子块仍会退图（坐标换算在旋转的那条链上不成立，要做得先把 `applyWorldTransform` 那套分解搬过来，或改用「按世界矩阵重挂」的路子）。

### 「手动输入」落到空座位：先落一份空文件（F3.13，v1.57）

座位可以先于它的产物存在（F1.11 的 `seatedEmpty`），而这枚按钮的含义是「我要写字」。所以 `ArtifactModal` 在**以编辑面打开**、产物不在、且形态是「产物就是它自己的文字」时，**先落一份空文件再回读**，把读回来的那一份灌进 payload——编辑面因此被画出来，而不是先给一句「产物不存在」。

两步收成一个可单测的模块 `editing/seed-blank.ts`（`seedBlankText(wire, projectId, cardId)`，`wire` 只要 `writeText` / `readArtifact` 两个动作）。判据拿一个**假 wire** 真跑一遍，钉住次序与内容：**先写后读**（读在写之前拿到的只会是「没有」）、写进去的必须是**空**字符串、回读回来的那一份才是答案；写被拒时把错误原样抛给调用方（弹窗把它当读失败一样说人话，不退回「产物不存在」）。

要不要落空白的判据是一个纯函数 `needsBlankText(view, openInEditor)`（`editing/writable.ts`，与「这份 payload 能不能整篇写回」的 `writablePayload` 相邻）：**在编辑面打开** + **产物确实不在** + **形态就是它自己的文字**，三条同时成立才落——看预览不写盘、空文件（是**在**的）不补、别的形态不碰。

控制带上那枚按钮的可见性另有一半：`isDirectTextKind(summary?.kind ?? card.kind)`。摘要读不到（产物还没写过、或者已经丢了，两种都没有可摘要的东西）时回落问**卡片自己**记着的形态——少了这半句，这枚按钮会恰好在「还没有东西可写」的时候隐身，而它要开的那条路本来就是从无到有地写第一行字。

## 十、构建、质量与安装

`build.mjs` 用 esbuild 出**四个产物**（两个 bundle + 一份引擎 chunk + 一份 worker），另有资产拷贝（CanvasKit 的 wasm 脚本、OpenPencil 的 Inter 与随仓库走的 Noto Sans SC）：

```javascript
// 整个 @deepseek-ai/* 都由宿主提供，不只是 dsh-*：cordis 与 schemastery 也一样。
// 逐个枚举会把 schemastery 打进 Host 半，让插件在宿主的 Schema 类之外多出一个身份。
const dshExternal = ['@deepseek-ai/*']

// Host：ESM，Node 22
await build({ entryPoints: ['src/index.ts'], outfile: 'lib/index.js', bundle: true,
  format: 'esm', platform: 'node', target: ['node22'], sourcemap: true, external: dshExternal })

// Client：CJS，浏览器；react 等由宿主提供，用模块加载器外壳包住
await build({ entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', bundle: true,
  format: 'cjs', platform: 'browser', target: ['es2022'], sourcemap: true, jsx: 'automatic',
  external: [...dshExternal, 'react', 'react-dom', 'react-dom/client',
             'react/jsx-runtime', 'react/jsx-dev-runtime', 'scheduler'],
  banner: { js: "window.__ModuleLoader__.load({ id: 'dsh-canvas-flow', factory: (require) => { var module = { exports: {} }; var exports = module.exports;" },
  footer: { js: 'return module.exports; } });' } })
```

前两个是 Host 半（`lib/index.js`）与 Client 半（`lib/client.js`）。

**第三步：设计引擎 chunk**（`lib/assets/design-engine.js`）。场景图 + OpenPencil 渲染器 + yoga 布局整体打成一份独立 ESM，经资产路由出：yoga 的入口带顶层 await，而 `client.js` 是 CJS，装不下；更要紧的是**场景图的类身份必须全页唯一**，graph 在这份 chunk 里创建、也只能由这里的渲染器画。它按 URL 动态 import（`import()` 语法在 CJS 输出里必须原样保留，否则会被改写成 `require`）。node 专有的动态 import（本地字体访问等）标 external——浏览器里永远执行不到。

**第四步：fig 的压缩 worker**（`lib/assets/export-worker.ts`，v1.59）。逐字是 `.ts` 不是写错：上游的 fig 写器在浏览器里用 `new URL('./export-worker.ts', import.meta.url)` 找自己的 worker，打进我们那份 chunk 之后这个名字就定死在 `/dsh-canvas/assets/export-worker.ts` 上了（详见 §九「设计稿的四条出路」）。内容是一份普通 ESM 打包结果，`.ts` 由资产路由认成 JavaScript。

#### 资产路由的缓存：名字跨构建不变，缓存头就必须每次回验（v1.59 修）

`/dsh-canvas/assets/*` 这条路由从前的响应头是 `public, max-age=31536000, immutable`，理由写在当时的注释里：「名字是内容稳定的构建产物，重建就换一份插件包」。前半句对，后半句错得恰到好处——**重建换的是包，不是这里的 URL**：`design-engine.js`、`canvaskit.wasm`、那几份字体，名字跨构建一字不变，而内容每一版都在改。于是升级之后浏览器里的旧 chunk 还能用满一年：同一页里既跑着新的 `client.js`，又加载着旧的引擎 chunk，新的那侧去调 `designExport`，而旧的那份里根本没有这个函数——用户拿到 `n.designExport is not a function`（真机反馈），这句话对用户没有任何下一步。

现在的策略是**每次问一句**：`no-cache` + ETag（只用长度与 mtime 两个数，`entityTagOf`）＋ `If-None-Match` 命中回 304（`isNotModified`）。没变就是几十字节，变了立刻拿到新的；那 28MB 资产不因此变慢——它们只在设计预览器打开时取，日常都是 304。

但**缓存头改了管不到已经存进去的那一份**：旧策略发出去的响应在浏览器里可以「一年内不再问」，它永远不会回来看一眼新头。所以客户端那一侧还有两道：

- **取资产一律走 `assetUrl()`**（`design-canvaskit.ts`），URL 上挂着固定的一格 `?v=2`。它**不是版本号**，是**换一格缓存键**——旧条目的键与新 URL 不同，于是这台机器按新策略重新取一次，之后日常 304。判据钉住两件事：那格字面量在，以及**没有第二处手拼 `${ASSET_BASE}/…`**（手拼一处，那一份就又回到旧条目上，事故原样复现且不报错）。
- **引擎 chunk 取回来要核对形状**（`design-engine-module.ts` 的 `designEngineOf`：`createDesignEngine` 与 `designExport` 都在才算「这一份」）。形状不对就换一个带 `&t=<时间戳>` 的全新 URL 再取一次，仍不对才照实降级成「这次没导成」——**第二道防线**，为的是「谁少写一个 `assetUrl`、策略以后再改」这类再犯，收场是一条降级路而不是一句 `is not a function`。

唯一带不上这一格的是 fig 的压缩 worker：它的 URL 由上游逐字拼出（`new URL('./export-worker.ts', import.meta.url)`，基 URL 上的 query 在相对解析时会掉），而缓存头这一层对它依然成立——从新策略生效起再存进去的那一份会回验。

判据落在**真磁盘上的真文件**上（`registerAssetRoute` 的 `from` 参数就是为它开的）：`tests/host/assets.spec.ts` 判 200 带 ETag、命中回 304 且不带正文、换了内容就不再命中、`.ts` 按 JavaScript 发；`tests/client/artifact/viewers/design-engine-module.spec.ts` 判那一格缓存键在、没有第二处拼 URL、旧 chunk 会被认出来、会绕一次、且只绕一次。

声明文件由 `tsc -p tsconfig.build.json` 单独产出到 `lib/types`（`emitDeclarationOnly`）。

| 脚本                   | 内容                                                        |
| -------------------- | --------------------------------------------------------- |
| `pnpm run build`     | `node build.mjs && tsc -p tsconfig.build.json`            |
| `pnpm run typecheck` | 对 `src` 与 `tests` 两个 program 各跑一次 `tsc --noEmit`（双端类型都要过） |
| `pnpm run lint`      | eslint（flat config）                                       |
| `pnpm run test`      | vitest                                                    |
| `pnpm run check`     | typecheck → lint → test → build（CI 跑的就是它）                 |

CI：**尚未落地**——仓库里还没有 `.github/workflows/`，`check` 目前靠本地跑。既定方案是 GitHub Actions + corepack + Node 22，`pnpm install --frozen-lockfile` 后执行 `pnpm run check`。

安装与调试：

```sh
pnpm install && pnpm run build
dsh plugin --profile web add .              # 本地目录安装
dsh plugin --profile web add https://github.com/ljcoder2015/dsh-canvas-flow   # 从 Git 安装（会跑 prepare 构建）
dsh plugin --profile web remove dsh-canvas-flow
```

Git 安装时 pnpm ≥10 会拦截 `prepare` 构建，需按 `dsh` 的提示在该 profile 的 `pnpm-workspace.yaml` 里加 `allowBuilds: { 'dsh-canvas-flow': true }`——**该授权允许包在安装时执行代码，只对可信来源开放并锁定 commit**。开发期把包加进工作区软链后，`dsh-client-hmr` 会轮询客户端 bundle 变化并热重载（仅 sourcemap 变化不触发），Host 侧改动需重启 Web Harness。

## 十一、与初版技术设想的差异（必读）

| 项        | 初版设想                                                                      | 校准后机制                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 影响                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 插件清单     | `.deepseek-plugin/plugin.json` 声明 `inject: [tools, storage, ui, session]` | Harness 只认 `package.json` 的 `dsh.bundle` / `dsh.client`；`cordis.patch.yml` 挂载；`dsh.plugin.json` 面向注册表；依赖注入用 Cordis 的 `export const inject`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 清单写法重写，**无「ui」这类注入项**                                                                                                                                                                                                                                                        |
| Host 工具  | `ctx.tools.register('canvas_read_card', {...})`                           | `ctx.tools.register(defineTool({ name, description, parameters, output, execute }))`，需要 `inject: ['tools']`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 工具定义补 `output.schema` + `render`；名字须落在 `^[a-zA-Z0-9_-]+$`（§3.6）                                                                                                                                                                                                              |
| 跨卡片调用    | Agent 直接持有 `canvas.getCard()`                                             | 双端一律经 Typert Remote：契约 → Host manifest → Client 贡献                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 每个方法一条 descriptor，三处引用同一数组                                                                                                                                                                                                                                                   |
| 页面/预览    | 自造 `preview(path) => Component`                                           | 右栏 tab 类型注册表 + 资源地址认领                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 形态注册表一半落到宿主已有席位                                                                                                                                                                                                                                                              |
| 引用存储     | 自建「画布元数据文件」                                                               | `defineDomain` + `ctx.storageDomain.open()`，`domain/changed` 通知                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 不需要自造持久化与变更广播。**v1.47 把「自建元数据文件」以另一种身份请了回来**：目录里那份 `.dsh-canvas/board.json` 是**投影不是真源**（见 §6），它存在的理由是跨机器/跨目录的可迁移性，而不是想自己管持久化——写链、校验、变更通知仍全在存储域那边                                                                                                                             |
| 画布身份     | 「项目」由路径决定（隐含：目录不会动）                                                       | 身份写在**目录自己身上**（板面文件里的 `id`），绑定目录时先读它再决定是哪张画布（`planIdentity` 四态）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 改名不再等于新建一张画布，老画布零迁移（没有文件就退回路径摘要），复制出去的那份自动获得新身份                                                                                                                                                                                                                              |
| 卡片身份     | 卡片 id＝产物文件的相对路径（隐含：id 与文件名互为因果）                                           | **id 与文件解耦（2026-09-23）**：新卡的 id 由 host 铸成**6 位随机小写字母**（`core/canvas/ids.ts` 的 `mintCardId`），产物路径改记在卡记录的 `file` 字段（域 schema 可选，老记录 `undefined` 时回落读 id＝旧行为，**零迁移**）。所有文件读写走 `fileOf(record, id)`；板面投影只在 `file ≠ id` 时写 `file` 字段；扫描落座按 **file 对账**（`planSeats` 收 `mint` 回调铸新 id）；产物引用对账（F4.5）先由 file 映射回卡 id。**2026-09-24 补课**：解耦当时漏改了 Host 侧**八处**（`readSummary` / `writeText` / `editText` / `readDesign` / `editDesign` / 导出 / 下游通知），它们仍把座位 id 喂给 IO 层——而 IO 层收到的是**路径**，于是建卡那行种子文字落进了以 id 命名的游离子文件（现场：项目根上躺着 `lzyoke`，内容是 `# 文本`，对应卡的产物 `文本.md` 从未出现），产物摘要也永远读不到；两处都不报错、只是「没出现」。现已全部走 `fileOf`，并加一道**读源码**的守卫（`tests/host/card-paths.spec.ts`：喂给 `io.*` 的实参里出现裸 `cardId` 的，必须同时出现 `fileOf(`）——这一层跑起来要一整套宿主装配，而漏改的表现恰恰是「装配好了也照跑不误」 | 文件名不再进入身份，**文件可改名**而不动座位；旧板面/旧记录/旧投影全部原样可读；客户端展示：卡片名走 `name`、预览标题与 `@mention` 走 `file`，id 只作座位身份流转                                                                                                                                                                           |
| 卡片名      | 卡片没有名字，列表与预览都拿产物文件路径当标题                                                   | **显示名与产物路径分开（v1.53，F1.12）**：卡记录带可选 `name`，**只在用户给的名字与推导默认不同时才写**（＝零迁移）；显示名一律走 `core/canvas/card-name.ts` 的 `cardNameOf({file, kind, name})`（目录类形态取文件夹名，其余取去扩展名的基名）；改名在同一模块里纯判——`planRename` 定「改哪一个条目、后缀留不留」，`settleRename` 收 `taken(candidate)` 回调做撞名递补，`renameStep` 定「真去移动还是只把记录重指」，host 只把结果落到盘与记录。**新建的卡在铸座位的同时铸名（v1.54）**：类型名 + 序号（`autoNameOf`，`文本1`、`应用1`），并且**直接当产物文件名用**——`cardNameOf` 推出来的正是它，记录里一个 `name` 都不用多写（这是「派生默认 + 只存差异」的极限形态：默认值连落库都省了）；序号的判据在调用方（建卡那侧看得到板上已占的文件），与撞名 `-2` 同一个分工                                                                                                                                                                                                                                   | 文件名彻底退出用户视野（既不是身份也不是显示名）；改名不动座位 id、不动会话；**引用是路径 ⇒ 改名不回改别人的历史与 `@mention`**，旧投影 / 旧记录照旧可读。反过来，**显示引用时也不能再拿 id 当路径**（v1.54 修掉 v1.49 的漏网缺陷）：`@` 候选插的是 `@产物路径`、显示的是卡片名、缩略图走卡片 id——三个字段各是各的（`client/canvas/reference-options.ts`，纯）                                               |
| 会话创建     | 「创建卡片时自动创建独立会话」                                                           | `ctx.sessions.create()` 归调用方 fiber；**不落盘**，必须经 agent 生命周期事务                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | P0 的会话绑定需先打通 agent 工厂，工作量重估                                                                                                                                                                                                                                                  |
| 会话隔离     | 靠 system prompt 约定                                                        | 工具注册作用域 + `restrict` / `schemas(scope)` 的可见性过滤                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 隔离可被结构性保证，不必靠提示词                                                                                                                                                                                                                                                             |
| 引用注入     | `agent.inject()` 抽象调用                                                     | `agent.inject({ content, source: { kind: 'plugin', plugin } })`，追加持久化上下文但**不唤醒空闲 agent**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 响应策略（F5.7）需自行决定用 `inject` 还是直接发起轮次                                                                                                                                                                                                                                           |
| 连线底层     | 「读上游产物摘要」                                                                 | **改用 Harness 自己的 `@file` 文件引入**（v1.37）：边的一端是产物文件、另一端是会话，插件把上游产物**以工作区相对路径命名**（`@brief.md` / `@"my brief.md"` / 目录 `@site/`，逐字节复刻宿主语法），模型按需 `read`；产物摘要**并列保留**（不是回落）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 引用不复制内容 ⇒ 不会失效、不占预算、不被截断、无缓存失效时机；摘要仍负责「立刻把材料摆到眼前」（`read_sources` / `inject_card` / F5.7 `pull`）                                                                                                                                                                              |
| 文件访问     | 直接 `fs.read`                                                              | `ctx.fs.*`（统一 seam，带版本守卫、沙箱策略、写前 waterfall）；**v1.53 起有唯一一处例外——「改名」**：seam 只有 `writeText` / `editText`，没有 rename 动词，于是改名走 `ArtifactIo.renameEntry` 直调 `node:fs/promises.rename`，同时把 seam 原本提供的保证**在本地复刻**成三道闸：源与目标都过 `fs.contains(boundary)`；目标沙箱策略是 `read-only` 直接拒（`FS_SANDBOX_DENIED`）；`processPathOf` 证明两端的宿主路径来回映射回**同一个** `targetKey` 才动手（证明不了就 `FS_NOT_OBSERVED`）                                                                                                                                                                                                                                                                                                                                                              | 编辑回流与冲突处理有现成挂点；越过 seam 的只有改名一处，且守卫不减——缺的是动词，不是沙箱/远程场景用不上                                                                                                                                                                                                                     |
| 设计稿的容器尺寸 | 预设只给「一屏」的规格（手机屏 375×812、**官网首屏** 1440×900、海报……），模型于是按屏产稿                  | **v1.55 起：宽度取菜单、高度随内容**（`DESIGN_PRESET`，`src/host/prompt.ts`）——菜单给**宽度**（手机 375 / 平板 834 / 桌面 1440）与「固定规格、整块给出」的那几项（海报 1242×1660、社交方图 1080×1080、幻灯片 1920×1080、横幅 1920×600），并明说网页与应用是**一个容器一整页**：多屏才看得完的内容在同一个容器里连续排下去，**禁止**拆成「首屏 / 第二屏 / 第三屏」，要多容器只在用户点名多屏并排（多屏对比 / 流程走查）或交付物本身是序列（幻灯片的每一页、海报系列）时                                                                                                                                                                                                                                                                                                                                                                                                                                   | **分屏是产出侧的规矩，不是渲染器的行为**：画布与预览本来就把全部容器摆在同一条可平移的画布上（`design-render.ts` 的 `fitTransform` 按 `documentBounds` 取景、可平移可缩放），所以这条只在预设里校准，客户端一行不用改                                                                                                                                      |
| 目录结构     | `ui/` + `tools/` 平铺                                                       | `src/` 根＝入口 + 协议基座；`src/host/`（装配与 Remote 服务）、`src/core/{canvas,artifact,session}/`（纯逻辑）、`src/client/{wire,canvas,artifact,ui}/`（浏览器半），其中 `client/artifact/` 再分 `registry.ts` + `chrome.tsx`（插槽与两条登记通道）+ `viewers/` + `editing/` + `element-pick/`（v1.40 分层，v1.41 细化产物面，v1.42 把能力从注册表挪进各预览器）；`tests/` 镜像之                                                                                                                                                                                                                                                                                                                                                                                                                            | 依赖层落成目录，非法依赖（`core/` → `host/`）看得见；两个构建入口路径不动，打包与清单不受影响。产物面按「一行一个预览器，能力长在预览器自己身上」再分，加一种形态不必回头改弹窗                                                                                                                                                                             |
| 导出落在哪一侧  | 「多格式导出」统一交部署能力（`dsh-canvas.capabilities.export`）产出                        | **能本地做的在本地做**，到 v1.59 一共三档：文本节点的 md / txt / docx / pdf 由客户端排版并下载（v1.57），应用节点的 zip 由客户端打包（v1.58：`card/read_bundle` 读出整份产物 → `core/artifact/zip.ts` 装包 → 下载），设计节点的 fig / png / pdf / pptx 由客户端**画出来**（v1.59：引擎 chunk 里的导出管线，见 §九「设计稿的四条出路」）；`exportFormats` 里剩下的 html / png 那类才留给部署渲染（要一个真的光栅化后端）。判据一句话：**没有 `dsh-canvas.capabilities` 的部署上，这三条路照常工作**。**「这张卡给菜单还是一击、走哪条通道」收成一个纯函数**（`client/canvas/export-plan.ts`，v1.59）——此前一半判在那枚胶囊里、一半判在画布那侧，加进第三条通道时就会打架                                                                                                                                                                                                                                                                          | 一条「导出」因此有了四处实现，但分工的界线是「谁做得了谁做」——排版、打包、渲染都是客户端做得了的事，与发布会话不是一类。三档共同的规矩不变：**画不出来 / 装不下就如实说不导**，不给半份。顺带修掉两个**静默失败**：`exportCard` 返回的 `ok:false` 是一份**答案**、不是异常，画布那条 `run()` 只接异常，于是应用卡片点导出原本什么都不发生（v1.58）；那枚按钮的可见性原本是「kind 不是 folder」⇒ **视频卡片上有一枚点了什么都不发生的按钮**（v1.59 改为按「能不能导」判） |

## 十二、开放项（含已关闭项）

> 这一章是动手前必须钉死的点。**已关闭的保留在原位并划掉**，便于回溯当时为什么这样定；仍未关闭的按顺序编号。

1. ~~**工具名是否允许 `.`**~~ **已关闭（2026-09-17）**：实测把 `canvas.read_card` 这类名字发给模型供应商，请求被 400 拒绝——`Invalid 'tools[0].name': string does not match pattern. Expected a string that matches the pattern '^[a-zA-Z0-9_-]+$'`。宿主不对工具名做校验或改写，原样透传，所以字符集必须由插件自己守住。已全面改用 `canvas_read_card` 形式（§3.6 工具清单、`contract.ts` 的 `TOOL_NAMES`、`dsh.plugin.json` 的 `contributes.tools`、客户端 `tool.call.toolview` 的 keys 同步），并在 `tests/contract.spec.ts` 里用 `TOOL_NAME_PATTERN` 钉死。
2. **多卡片会话的并发与归属**：每张卡片一个 agent 是否可行（数量上限、并发轮次、资源占用），以及画布面板切换会话时的 fiber 生命周期。
3. **形态认定与 tab 认领的一致性**：Host 侧 `kind-registry` 的判定结果与 Client 侧 `patterns` / `canOpen` 必须给出一致答案，否则会出现「卡片显示为 A 形态、点开却是内置查看器」。
4. **PPTX 一秒级导出**（F10.2）的落地者：这取决于宿主是否已有 PPTX 生成能力，插件不应自带重型渲染引擎。——**v1.58 后范围收窄**：同一族的另外两条已定案在客户端（文本的 md / txt / docx / pdf、应用节点的 zip，见 §九「读一整个目录」），它们要的只是排版与打包，浏览器里就有。**v1.59 再收窄一格**：设计节点的 PPTX 与 PDF 也已落在客户端（`@open-pencil/core/io` 的导出器，浏览器里现画，见 §九「设计稿的四条出路」），所以「PPTX 要一个真的排版引擎」这句对**设计稿**不成立——它要的是一个渲染器，而那个渲染器本来就随设计预览装在包里。真正还留在部署那一侧的只剩「把 HTML 页面 / 数据图表渲染成图片或 PDF」那一类（要一个无头浏览器级的后端），以及 F10.2 那个**一秒级**指标本身（现在设计稿的 PPT 是一页器一份、按容器现画，毫秒到几十毫秒，但没有按「大文档」量过），这一条照旧未关闭。
5. **发布**（F10.3）与子域名/回收的归属：需确认走宿主既有发布能力还是插件自建，避免与 Harness 的生命周期冲突。
6. **引用注入的上下文预算**（§3.5 F5.2）：摘要在域记录里缓存，还是每次注入现算；缓存则需定义失效时机。——**v1.37 基本关闭**：**默认通道不再有预算问题**——文件引用一个字的材料都不进上下文，模型按需 `read`，读哪一段也由它决定。产物摘要这一路仍是**每次现算、域记录里不缓存**，因为上游文件随时可被改写，缓存就得再定义失效时机，而现算的代价只是一次文件读；`summaryBudget` 只作用在这一路。这段历史里 v1.35 曾把预算交给宿主的 session-reference 服务现算，v1.37 撤销该通道后此路不复存在——问题的形状从「预算归谁算」变成了「根本不必预置材料」。
7. **为了"页面别动"，探针与页面本身抢方向盘**（v1.44）：`hold` 态把滚动位置钉住（`scroll` 里拨回进入这一态时的位置），于是**页面自己用 JS 滚动会被按回去**（`scrollIntoView`、轮播、锚点跳转都算）——这是有意的（用户正指着某一处写要求，画面就不该自己走），代价是这类页面在框开着时看起来「卡住」。同一支上还有 `aim` 态那条：**页面自己的内层滚动容器滚不动**（只读层整块盖住视口，滚轮只落到文档本身；选不到的元素得先退出模式滚过去）。两条都写进了 §8 的取舍，目前没有更好的做法——真要让内层容器也滚，就得放弃"整块盖住"的只读方案，而那会漏掉悬停那一族。
8. **改名之后，已有的路径引用不会跟着改**（v1.53，F1.12）：引用边在底层是**按路径交出去的文件引入**（**§五**里的「连线的底层 = 文件引用」，F5.3）——`@brief.md` 这个字符串一旦进了某张卡片的历史、或写进了别的产物正文，它就是一个死掉的路径，产物改名不会回头把它们重写。这是「引用不复制内容」换来的固有代价（同一枚硬币的背面：不复制 ⇒ 便宜、不过期，但也 ⇒ 名字一改就断）。当前的处理是**只保证新发生的引用用新路径**，旧的留着、点了报 `FS_NOT_FOUND` 而不是静默给错内容。真要做，得有一个「按 file 映射回卡 id、再重写各处路径」的对账 pass（F4.5 的引用对账已经有 file→id 的映射能力，缺的是**跨会话历史与产物正文的回写**，后者的成本不只是改字符串——用户写在正文里的路径是用户的内容）。在那之前，这条限制不出现在界面上（改名不弹「会影响 N 处引用」），因为卡片自己并不知道谁引用过它。
9. **v1.49 漏改期间写歪的游离子文件不会自己回家**（v1.57 记录）：八处 id 当路径的调用修好之后，此前落到 `<root>/<座位 id>` 上的内容仍躺在项目根里（现场是 `lzyoke`、`bajgne` 两个文件，内容是建卡时那行种子文字：`# 文本`、`# 未命名`），而它们对应的卡至今没有产物。插件**不自动清理**：那是用户目录里的东西，而且「这个文件是垃圾」这件事只有人能确认。当前靠 F3.13 那张卡自己的路补上——「手动输入」在**正确路径**上重新落一份空文件，板面照旧（座位在、产物补上）。将来若要收，只能是一次**列清清单、由用户确认**的清理，判据是「文件名恰好是某个座位 id，且不在板面投影的 file 集合里」；在此之前，它们也不会被认回某张卡——扫描落座对的是 **file**，座位 id 不是路径（这正是这次踩到的那条线）。
10. **导出那条路的几个边角**（v1.68 / v1.66 / v1.65 / v1.64 记录，F10.1）：①**两端对齐**（`JUSTIFIED`）的多行文字在 `.fig` 里按左对齐烘——写器的 `position.x` 只认字形自己的进距，而段间那点拉伸是**排版器**算出来的；要在 Figma 里也拉开，得自己造 `derivedTextGlyphs`（逐字带坐标），而那份几何 blob 只有 `@open-pencil/fig` 内部能编码（`encodePathCommandsBlob` 没从包的 exports 露出来）。②**独立圆角**（`independentCorners`）的容器在 PDF 那条没补裁剪圆角——`<rect>` 只有一对 rx/ry，四个角各不相同就得写成 `<path>`（`clipPath` 支持 `<path>`，上游的 `roundedRectPath` 也能复用）。③~~**圆角矩 / 椭圆 / 文本 / 矢量越界**时，PPT 那条仍会让那一页（或那棵子树）退成图~~ **已关闭（v1.68）**：夹不动的那些改走「套一个同尺寸的裁切框 → 连裁切一起烘成一张 PNG → 用图片顶掉」——图片是矩形，收进框之后「裁剪」与画布上「裁掉」是同一件事（§九「PPT 那条的另一半」）。**剩下的边角**：转过 / 翻转的越界子块仍会退图，因为那条链上「按父坐标写回 `x`/`y`」不成立——要做得先把 `applyWorldTransform` 那套分解搬过来，或者改成按世界矩阵整棵重挂。三条都只影响「画得对不对」或「能不能再编辑」的一个边角，不改产物结构，也都不会静默——画出来（或改起来）就是能看见的样子。
