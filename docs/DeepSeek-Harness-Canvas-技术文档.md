# DeepSeek Harness 通用创作画布插件 · 技术文档

**版本**：v1.85  
**最近更新**：2026-10-22  
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
│   ├── capabilities.ts       # 部署能力探测 + 三条生成缝的默认实现（v1.70）
│   ├── host/                 # 宿主运行时：装配 + 两个 Remote 服务
│   │   ├── runtime/              # 按画布/卡片装配的那一层（两个 Remote + 板面投影）
│   │   │   ├── canvas-runtime.ts     # CanvasRuntime：画布/引用链/排布（Remote 服务）
│   │   │   ├── card-runtime.ts       # CardRuntime：产物读写/注入/导出/发布/生成
│   │   │   └── board-file.ts         # 板面投影的读写（接 ctx.fs + 从域的表组装）
│   │   ├── media-provider.ts     # 媒体生成：从 DSH 模型配置挑路线 + 解凭证 + 落盘（v1.70）
│   │   ├── tools.ts              # canvas_* 工具注册（defineTool × 18）
│   │   ├── prompt.ts             # 卡片会话的 prompt 注入段落
│   │   └── assets.ts             # 资产路由：lib/assets 的 HTTP 面（缓存键见 §10）
│   ├── core/                 # 纯逻辑层，不依赖 Cordis
│   │   ├── canvas/               # 画布模型
│   │   │   ├── board/                # 板面这一份数据：怎么排、怎么写盘、引用边存哪
│   │   │   │   ├── board.ts              # 排布策略
│   │   │   │   ├── board-file.ts         # 板面文件：格式/编解码 + 身份与导入决策（纯）
│   │   │   │   └── source-store.ts       # 引用边存储
│   │   │   ├── card/                 # 一张卡的三个身份与几何
│   │   │   │   ├── ids.ts                # 存储键的定宽转义 + 路径摘要身份
│   │   │   │   ├── card-name.ts          # 卡片名与产物路径的对齐（纯）
│   │   │   │   ├── card-fields.ts        # 卡片记录上按 kind 才有的字段（纯）
│   │   │   │   └── card-size.ts          # 卡片几何的唯一真源（纯，v1.77–v1.80）
│   │   │   └── project/              # 项目目录里放什么、怎么摆、怎么清
│   │   │       ├── workspace.ts          # 画布即工作区（登记与挂账）
│   │   │       ├── artifact-folders.ts   # 产物按类型分目录：唯一名单 / 路径组合 / 迁移（v1.84）
│   │   │       ├── cleanup.ts            # 失效卡的清理
│   │   │       └── import-plan.ts        # 外来文件落成产物：命名与三种拒绝（纯，v1.81）
│   │   ├── artifact/             # 产物：认定 / 读写 / 打包 / 提示词
│   │   │   ├── io/                   # 字节与目录：唯一出口 + 两种容器
│   │   │   │   ├── artifact-io.ts        # 文件读写唯一出口（沙箱策略在此定夺）
│   │   │   │   ├── bundle.ts             # 一份产物里的文件清单（打包/预览共用）
│   │   │   │   └── zip.ts                # zip 读写（纯，零依赖）
│   │   │   ├── kind/                 # 形态这一件事的三个读法
│   │   │   │   ├── kind-registry.ts      # 形态注册表（HTML_KINDS / MEDIA_KINDS 的唯一出处）
│   │   │   │   ├── webapp.ts             # 应用脚手架 + 预览链接闸门
│   │   │   │   └── preview-picker.ts     # 预览元素探针（注入页面的脚本 + 纯函数）
│   │   │   ├── prompt/               # 交给模型的那些字
│   │   │   │   ├── file-reference.ts     # 连线底层：宿主 @file 语法的逐字节复刻
│   │   │   │   └── prompt-blocks.ts      # 提示词段落（按 kind 组装）
│   │   │   └── design/               # 设计稿的纯部分（信封 / 字体 / 判据表 / 页面 / PDF / PPTX，v1.64）
│   │   ├── media/                # 媒体生成：形态与路线（纯，零依赖，v1.70）
│   │   │   ├── types.ts              # MediaCapability：'image' | 'video' | 'audio'
│   │   │   ├── routes.ts             # 从 DSH 模型配置里挑媒体路线：读不懂的整条丢掉
│   │   │   ├── ark.ts                # Ark（火山方舟）协议：图片同步 / 视频异步 / 语音同步
│   │   │   ├── reference.ts          # 参考图/参考素材的归一
│   │   │   └── mime.ts               # 媒体扩展名 ↔ MIME（纯，客户端也引）
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
│       ├── canvas/               # 画布面：板面 / 左栏与项目管理 / 卡片 / 导出 / 素材进出
│       │   ├── board/                # 板面自己
│       │   │   ├── canvas-view.tsx       # 无限画布正文（平移缩放、拖放、连线）
│       │   │   ├── canvas-tab.ts         # 右栏 tab 类型（工作台页 + 每形态认领）
│       │   │   ├── source-edges.tsx      # 引用线几何
│       │   │   └── wheel-owner.ts        # 滚轮归谁：画布 / 自己会滚的盒子 / ⌘ 缩放（纯）
│       │   ├── project/              # 左栏、画布行、新建与打开目录
│       │   │   ├── canvas-nav.tsx        # 左栏画布包裹（Portal）
│       │   │   ├── canvas-panels.tsx     # 主面板 / 侧栏席位
│       │   │   ├── canvas-menu.tsx       # 画布行的操作菜单与删除确认
│       │   │   ├── row-actions.ts        # 那一行该给出哪几个动作（纯策略）
│       │   │   ├── open-folder.ts        # 交给文件管理器打开画布目录
│       │   │   ├── project-catalog.ts    # 活动画布清单（不轮询）
│       │   │   └── folder-picker.tsx     # 新建画布时挑目录
│       │   ├── card/                 # 卡片本身（画什么、多大、怎么拖）
│       │   │   ├── card-tile.tsx         # 卡片（含流光层）
│       │   │   ├── card-face.tsx         # 卡面描述（画布 tab 与形态 tab 共用）
│       │   │   ├── card-shot.ts          # 卡面那两张「截图」素材（设计/应用活在渲染之后）
│       │   │   ├── card-media.ts         # 卡面第三种素材：媒体产物自己（v1.72）
│       │   │   ├── media-face.ts         # 媒体卡面画什么（纯，v1.72）
│       │   │   ├── card-overlay.tsx      # 选中态控制带（右下角把手：拖动改尺寸）
│       │   │   └── composer-size.ts      # 把手的算术（纯）：上下限与 zoom 换算
│       │   ├── export/               # 这张卡怎么落成一个文件
│       │   │   ├── export-plan.ts        # 点〔导出〕给什么：一击 / 菜单 / 什么都没有（纯，v1.59）
│       │   │   ├── text-export.ts        # 文本节点本地排版 md / txt / docx（v1.57）
│       │   │   ├── text-pdf.ts           # 文本排成 PDF 字节（矢量、文字可搜，v1.57）
│       │   │   ├── bundle-export.ts      # 应用节点：整份产物装成一个 zip（v1.58）
│       │   │   ├── design-export.ts      # 设计节点：四样产物的命名 / 装包 / 收场（纯，v1.59）
│       │   │   ├── media-export.ts       # 媒体节点：原样下载那份产物（纯，v1.83）
│       │   │   └── download.ts           # 那一次「保存到本机」（对象 URL + a[download]）
│       │   └── asset/                # 素材进来、提示回去
│       │       ├── asset-cache.ts        # 卡面素材的取用方式：单飞 + 有界（纯，v1.72）
│       │       ├── import-file.ts        # 本地文件 → 产物（验 / 读 / 送，v1.81）
│       │       ├── reference-options.ts  # @ 引用候选：路径 / 卡片名 / 座位 id 三件事各是各的（纯）
│       │       ├── notice.ts             # 画布左上角那条提示：说什么 + 哪一档（纯）
│       │       └── material-notice.ts    # 引用提交后那句话（纯策略）
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
│       │   │   ├── media-viewer.tsx      # 图片 / 视频 / 音频（音频只做播放与文件名，v1.70）
│       │   │   ├── deck-viewer.tsx       # 沙箱 iframe + 链接闸门 + 元素选择（自己那套）
│       │   │   ├── delimited.ts          # 切行状态机（纯）
│       │   │   ├── data-viewer.tsx
│       │   │   ├── text-viewer.tsx       # 兜底
│       │   │   └── design/               # 设计预览与它的引擎 chunk（v1.85 归拢）
│       │   │       ├── design-canvaskit.ts   # CanvasKit 加载（可选资产，失败即降级，绝不抛）
│       │   │       ├── design-skia.ts        # Skia 后端；**导出用的那台渲染器也出自这一份**
│       │   │       ├── design-render.ts      # 渲染器选择与取景（纯）
│       │   │       ├── design-viewer.tsx     # 设计卡预览：画布 + 编辑闭环 + 面板
│       │   │       ├── design-panels.tsx     # 图层 / 属性 / 历史三块面板（React 自持）
│       │   │       ├── design-engine-types.ts    # 引擎 chunk 两端共享的形状（只有类型）
│       │   │       ├── design-engine-module.ts   # chunk 加载器（**只此一份**，失败即 null）
│       │   │       ├── design-engine.ts          # chunk 入口：渲染与导出两个出口
│       │   │       ├── design-pdf.ts             # PDF 那条：自己建文档 + 嵌中文字面（v1.61）
│       │   │       ├── design-io.ts              # 四样出路：fig / png / pdf / pptx
│       │   │       └── design-failure.ts         # 导出失败的码与文案（纯）
│       │   ├── editing/              # markdown / 纯文本的编辑面
│       │   │   ├── use-text-editing.ts       # 状态机（hook）：草稿 / 自动保存 / 写被拒
│       │   │   ├── editable-text.tsx         # 头部控件 + 条带 + 编辑框（两个文本预览器共用）
│       │   │   ├── writable.ts               # 这份 payload 能不能整篇写回（纯）
│       │   │   ├── seed-blank.ts             # 「手动输入」落到空座位（纯）
│       │   │   ├── mode.ts                   # 预览↔编辑的方向键（纯）
│       │   │   └── autosave.ts               # 节律 / 退避 / 写被拒的形状（纯）
│       │   ├── element-pick/         # 元素选择 F3.14
│       │   │   ├── element-pick.tsx          # 状态机（hook）：挑 → 写 → 等
│       │   │   └── pending.ts                # 这一笔跨关闭的记忆（纯）
│       │   ├── artifact-tab.tsx      # 形态 tab：认领地址后画卡面
│       │   └── tool-view.tsx         # canvas_* 的实时工具卡片（代码直播框）
│       └── ui/                   # 底座：文案 / 样式 / 席位 / 键位 / 提示词面 / 模型席位
│           ├── locales.ts
│           ├── styles.ts
│           ├── seats.ts              # 借用别包的席位（运行时只要一个字符串键）
│           ├── shortcuts.ts          # 键位真源 + 说明表
│           ├── prompt/               # 提示词输入面：contenteditable 与原子引用标签
│           │   ├── prompt-dom.ts         # 光标 / 引用的 DOM 算术（纯）
│           │   └── prompt-input.tsx      # 输入框组件
│           └── model/                # 模型席位：一个控件，两种语义，两个落点（v1.76）
│               ├── model-seat.ts         # 座位算法：候选 / 落点 / 记忆（纯）
│               └── model-picker.tsx      # 下拉框组件
└── tests/                    # 80 个 spec/helper，镜像 src 分层（tests/<层>/<子目录>/<同名>.spec.ts）
    ├── contract.spec.ts          # 协议基座（镜像 src/ 根）
    ├── core/                     # core.spec.ts 跨三域，另有 canvas/{board,card,project}/ artifact/{io,kind,prompt,design}/ media/ session/
    ├── host/                     # runtime/ 下是运行时那批，根上 prompt · tools · assets · media-provider
    └── client/                   # wire/ canvas/{board,project,card,export,asset}/ artifact/(viewers/design)/ ui/{prompt,model}/
```

**尚未落地的申报与不一致**（发布前需处理）：

- `dsh.plugin.json` 的 `contributes.skills` 申报了 `canvas-operations`，`package.json` 的 `files` 也收了 `skills/`，但**该技能包与 `skills/` 目录当前都不存在**；要么补上，要么从两处申报里撤掉。
- **CI 已落地（2026-10-22）**：`.github/workflows/release.yml` 由 tag 触发，跑 `pnpm run check` 后用 `npm stage publish` 把版本送进 npm 的 stage 队列，再由维护者带 2FA 批准上线。见 §10。
- **两个 lockfile 都在库里**：`pnpm-lock.yaml` 与 `package-lock.json` 同时被跟踪。`packageManager` 声明的是 pnpm，CI 也按 pnpm 冷装（`--frozen-lockfile` 已核过同步），npm 那份属历史遗留，清掉更干净。

**拆分的判据**：`src/` 根只留**入口与协议基座**（零依赖、只被依赖），其余四层**依赖方向单向向下**——`host/` 依赖 `core/` 与协议，`core/` 谁都不依赖（它 import 到 `host/` 就是环），`client/` 自成一棵树。两个**构建入口路径刻意不动**，所以 `package.json` 的 `exports`、`dsh.plugin.json`、`cordis.patch.yml` 都不随目录调整而改动。

**层内再细分：按「谁和谁一起变」（v1.85）**。原先 `client/canvas/` 平铺 30 个文件、`client/artifact/viewers/` 19 个、`core/canvas/` 11 个——一层是对的，但一层里读不出边界。细分的口径不是文件类型，而是**改动时被牵动的范围**：`canvas/` 拆成 `board/`（板面自己：表面手势、tab、引用线）、`project/`（左栏、画布行、新建与打开目录）、`card/`（画什么、多大、怎么拖）、`export/`（这张卡怎么落成一个文件）、`asset/`（素材进来、提示回去）；`viewers/` 把设计那一支（11 个文件，连它的引擎 chunk）收进 `design/`；`core/canvas/` 按 `board/` `card/` `project/` 三件事分开；`core/artifact/` 分成 `io/`（字节与容器）、`kind/`（形态的三个读法）、`prompt/`（交给模型的字）+ 原有的 `design/`；`ui/` 拆出 `prompt/` 与 `model/`；`host/` 拆出 `runtime/`（两个 Remote + 板面投影）。**没有一层是因为「文件太多」被切的**——切之前先问「这几个文件是不是总在同一个提交里一起改」，是才放一起。

搬家只动了相对说明符：**118 个文件搬家、395 处路径字面量重算，实质差异 0 行**。判据不是整体哈希（esbuild 会把每个模块的相对路径写成 `// src/…` 注释，搬家必然让哈希变，见 §10），而是**构建产物逐行分类**：四份 chunk 行数全部相同，30 行差异全部落在「整行只有一条模块路径注释」这一类，实质差异 0 行；再加一条**反向换算**——把每个新文件按新→旧的表换算回去，209 份与搬迁前逐字节一致。唯一的配置侧代价是 `build.mjs` 里引擎 chunk 的入口（`src/client/artifact/viewers/design/design-engine.ts` → `…/design/design-engine.ts`）：它不是包入口，跟着模块走。

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
| `src/client/canvas/board/canvas-tab.ts` | `'dsh-canvas:workbench'` / `'dsh-canvas:kind:'`        | tab 类型 id                                           |
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
| `CanvasRuntime`（namespace `canvas`） | 画布座次、引用边增删查、上游链排布、归纳收纳、便签创建、**当前画布记账**（v1.31：`setActiveProject` 写领域全局 `activeProjectId`，画布级工具据此取项目）、**绑定目录时的身份判定与板面导入**（v1.47：`createProject` 先读目录里的板面文件决定「这是哪张画布」，再按 `planSeats/planEdges/planNotes` 补齐板面；每个改动板面的方法末尾写回投影）                                                                                                                                                                                                                          | `src/host/runtime/canvas-runtime.ts`          |
| `CardRuntime`（namespace `card`）     | 卡片产物摘要读取、上游（引用来源）读取、跨卡片注入、导出、发布、**三条生成（v1.70：生图 / 生视频 / 生音频）**、**上游产物的文件引用提交**（v1.37：`referenceFiles`）、**上下卡与批量清理**（v1.47：`removeCard` / `removeMissingCards` 共用一条 `unseat` 级联——先释放会话、再删它的边、最后删座位，顺序反了会留下删不掉的悬空线。批量清理只清**证明得了不存在**的卡：`presenceOf` 三态里 `unknown` 一律留下，`seatedEmpty` 的空座位留下，项目根自己探不到时整体拒绝——那时「所有卡都缺」既可能是真的、也可能是探针坏了，这里分辨不出，清空画布该走 `removeProject`）、**卡片改名**（v1.53：`renameCard` —— 名字与磁盘上那一项一起改，几何全在 `core/canvas/card-name.ts`，这里是唯一一处直调 `node:fs` 的地方，理由与三道闸见 §九） | `src/host/runtime/card-runtime.ts`            |
| `board-file`（纯）                     | 板面文件的格式、编解码与两个决策：`planIdentity`（新画布 / 复用 / 搬家 / 复制四态）、`planSeats/planEdges/planNotes`（打开目录时该补哪些卡片、边、便利贴）。全部对普通数据的纯函数，于是每条规则都能在容器外测                                                                                                                                                                                                                                                                                                                   | `src/core/canvas/board/board-file.ts`       |
| `board-file`（宿主）                    | 把上面那份格式接到 `ctx.fs` seam（沙箱策略与写前 waterfall 照旧生效），并从 `projects/cards/sources/notes` 表组装投影；**内容未变则跳过写**，**读不懂的文件绝不覆盖**，写失败只记日志                                                                                                                                                                                                                                                                                                                          | `src/host/runtime/board-file.ts`              |
| `kind-registry`                     | 文件证据 → 形态认定（纯函数：扩展名 + 内容嗅探）                                                                                                                                                                                                                                                                                                                                                                                                                          | `src/core/artifact/kind/kind-registry.ts`  |
| `source-store`                      | 引用边的增删查与自动对账，落在存储领域之上                                                                                                                                                                                                                                                                                                                                                                                                                                | `src/core/canvas/board/source-store.ts`     |
| `file-reference`                    | **连线的底层**（v1.37）：Harness 自己的 `@file` mention 语法的逐字节复刻——`formatFileMention`（普通路径 / 带空白加引号 / 目录尾斜杠 / 引号不闭合 / 控制字符与双引号拒绝）、`nameFileReferences`（保序、去重、把写不出来的路径报进 `skipped`）、`nameWithoutProbe`（不探测 I/O 时一律文件形态——`site`/`webapp` 卡是**文件**不是目录）与引用块渲染；零依赖、不 import harness 包                                                                                                                                                                               | `src/core/artifact/prompt/file-reference.ts` |
| `session-manager`                   | `cardId → sessionId` 绑定、会话状态（空闲/运行中/有通知）                                                                                                                                                                                                                                                                                                                                                                                                             | `src/core/session/session-manager.ts` |
| `model-routing`                     | 卡片会话的模型来源：新会话用部署默认 `agentOptions`，已记录的会话选择在开卡时交回控制器                                                                                                                                                                                                                                                                                                                                                                                                  | `src/core/session/model-routing.ts`   |
| `agent-preset`                      | 卡片会话的**工具来源**：从部署的 agent preset 组装，否则该会话没有任何文件写入工具（见 §5「卡片会话的工具从哪里来」）                                                                                                                                                                                                                                                                                                                                                                                | `src/core/session/agent-preset.ts`    |
| `session-log`                       | 输入框回填的取数侧：从会话事件日志读用户最近一条**自己发出的**消息（`source.kind === 'user'` 才算），冷会话经部署的 `ctx.sessionQuery.readSession` 读持久化（见 §3.3 F3.9）                                                                                                                                                                                                                                                                                                                            | `src/core/session/session-log.ts`     |
| `workspace`                         | 画布即工作区（F1.6）：经部署的 `ctx.workspaceRegistry` 把画布根目录登记为工作区（`create(root, title)` 幂等）并把卡片会话挂账（`attachSession`，要求会话头 cwd 规范化后等于工作区路径）；无名册部署整体空操作，失败只记日志                                                                                                                                                                                                                                                                                                    | `src/core/canvas/project/workspace.ts`        |

```typescript
// src/host/runtime/canvas-runtime.ts —— Host Remote 服务
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

**连线的底层 = 文件引用**（v1.37，替换掉 v1.35 的会话引用这一版）：一条引用边的两端确实都是会话（每张卡片一个，§2.3），但**边指向的东西是文件**，而这份文件**不一定是任何会话的产出**：节点可以**手动新建**（从来没有哪次会话生成过它），也可以是**对某次会话产物的二次编辑**（内容早已不等于那次会话的记录）。把「会话」当作「产物」的代理，等于预设「这份产物 = 某次会话的输出、且此后没人动过」——这个预设一破，模型拿到的就是**另一样东西**（过程记录、或者旧版本），而边明明指着那个文件。**文件引用把这个代理环节整个去掉**：名字直接指向磁盘上那一份，谁写的、怎么来的都不影响它指得对。所以插件交给新会话的是**名字**，不是内容，也不是快照。这份名字的语法**属于 Harness**：`@` token ＋ 工作区相对路径，带空白就 `@"…"`，目录带尾斜杠，`@deepseek-ai/dsh-file-reference-local` 在这条会话有 `read` 工具时装上这份引导（每张卡片会话都有 `read`，见上「卡片会话的工具从哪里来」）。插件**自造一套新词汇只会更差**：模型得为一个插件多学一种写法，而宿主 UI 与其它插件的 `@` 提示又各说各话。所以 `src/core/artifact/prompt/file-reference.ts` 把宿主那套语法**逐字节复刻**（零依赖、**不 import harness 包**——同一份 bundle 要跑在从未组合 file-reference 包的部署上），执行落在 Host 的 `CardRuntime.referenceFiles`：走这条卡的**直接**上游（上一级，**不做穿透引用**）→ 逐个 `probe`（只为判「是文件还是目录」与「写没写盘」）→ `nameFileReferences` 保序去重并分出 `skipped` → `referenceMessage` 以 `source.kind:'plugin'` 注入（**绝不是 `kind:'user'`**：是画布在给文件命名，不是在替用户说话）→ 返回 `{ cardId, files[], skipped[] }`。**名字必须真的解析得到**：卡片 id 就是工作区相对路径（产物落在 `<画布根>/<cardId>`，正好是会话 cwd）——这条既有事实是整个通道成立的前提，也是 §3.5 F5.4 那条「卡片是文件不是目录」的来处。**每轮提示里的引用块同源但更克制**：它**同步组装、不许 I/O**，所以走 `nameWithoutProbe()`（一律文件形态、不带由 kind 推出来的尾斜杠），只报**有哪些材料**，正文一个字都不带——从缓存里端出来的摘要没人负责失效，而上游随时可以被一次普通的文件编辑改写。**摘要通道照旧并存**（`canvas_read_sources` / `canvas_inject_card` / F5.7 `pull`）：它要的是「立刻把材料摆到眼前」，这件事引用做不到。

**引用深度分两种问法，答法不同**（v1.46）：`transitiveUpstreams`（`src/core/canvas/board/source-store.ts`）回答的是**图**的问题——「这张卡在谁的下游」，用于看形状的两处（F4.7 引用链面板 / `canvas_get_sources`、F4.6 按链排布），停在一级就是谎报画布的形状；`materialUpstreams`（同文件）回答的是**上下文**的问题——「这条会话可以读什么」，答案恒为**一级**。三条通道（每轮提示里的引用块、`canvas_read_sources` 的摘要、`canvas_reference_files` 的名字）全部走后者，**不做穿透引用**。理由是链要**折**不要**摊**：产物应当已经把上游材料消化进自己那一份，把祖父的产物塞进孙子的提示词，花的是上下文、拆的是画布自己画出来的那条流水线——而且「本产物建立在它之上」这句话，隔一层就不成立了。真要看更远的，`canvas_get_sources` 报全链、`canvas_read_card` 读其中任一份，属于**明确去取**，不是默认送到。配置项 `sourceDepth` 自此只作用于图的那一侧。

### 媒体生成：后端从 DSH 自己的模型配置里挑（v1.70，F2.3 / F2.7）

图片、视频、音频三种节点与文本/设计节点同构——**会话驱动**：画布给卡片挂一段提示词预设，模型通过三个 `canvas_generate_*` 工具把活交给宿主。三个工具背后是同一条缝（`src/capabilities.ts`）：`generateImage` / `generateVideo` / `generateAudio`。部署若自己实现了 `dsh-canvas.capabilities` 就覆盖它，否则用插件自带的默认实现 `MediaProvider`（`src/host/media-provider.ts`）——**用户不必为这个插件另备一套 key**。

几条定下来的做法：

1. **能力按成员合并，不展开覆盖**：`mergeCapabilities(deployed, fallback)` 逐成员 `??`。展开合并（`{ ...deployed, ...fallback }`）在「部署给了这个成员但值是 `undefined`」时会**静默把默认实现顶掉**——这是本项目第三次撞同一类「同一个东西两个来源」的失败，所以合并只按成员取。
2. **路线从模型配置里读，不从插件配置里要**：`llm-pi-ai.providers.<route>` → `{ apiKeyEnv, baseURL, api, models: [{ id }] }`。`src/core/media/routes.ts`（纯、零依赖）只做一件事——在候选路线里按**模型族指纹含片段匹配**找出这一种能力该走哪条（`seedream` → image、`seedance` → video；**含片段而非前缀**，为的是覆盖 `dreamina-seedance-…` 这类跨区命名）。`noRouteReason(capability, routes)` 是「找不到时该说的话」：想要什么 + 按什么找 + 现在有哪些路线，一句话能让人动手。**逐字段先验后用，读不懂整条丢掉**——这份配置是用户手写的，一半写歪不该让整张画布跟着失败。插件配置只留 `mediaImageRoute` / `mediaVideoRoute` / `mediaAudioRoute` 三个**指名覆盖**与两个节律参数（`mediaPollMs` / `mediaTimeoutMs`）。
3. **两个宿主面都按名结构式读取**：`settings.describe({ redactSecrets: false })` 拿配置真值，`credentials.resolve(apiKeyEnv)` 拿密钥（**每次现解、不缓存**）。没有这两个面时不是插件加载失败，而是这三条能力照实不可用——理由与「卡片会话的工具从哪里来」第 4 条同源（`ctx.get` + 形状校验，**禁止 `inject:`**）。
4. **Ark（火山方舟）三条线的形态本来就不一样**（`src/core/media/ark.ts`，纯）：
   - **图片**：`POST /images/generations`，**同步**出结果；必须显式要 `response_format: 'url'`——两种返回形态的取用方式是两件事，默认哪种都不该猜。
   - **视频**：`POST /contents/generations/tasks` 起异步任务 → 轮询 `GET /contents/generations/tasks/{id}`；退出条件三条（终态 / 超时 / 取消），而终态里 **`cancelled` / `expired` 与 `failed` 同级**——漏掉它们就会永远轮询下去。成片给的是**签名临时链接（约 24h 过期）⇒ 必须当场把字节拿下来**，只存 URL 等于存了一个明天就断的引用。接回来那一步还要接住两副长相（`content.video_url` 字符串 / `content[0].video_url.url`）。
   - **音频**：**不在方舟**。`doubao-seed-audio-1-0` 挂在方舟的模型广场上，但接口住在豆包语音：`POST {speech}/tts/create`，鉴权 `X-Api-Key`（不是 Bearer），请求体 `{ model, text_prompt, audio_config }`，同步返回 base64（或一个两小时过期的 `url`）。四处与图片 / 视频不同，每一处都有一次把「看起来对」的实现做坏的机会——见下面那节。
5. **二进制落盘绕开文本口**：`ctx.fs` 这条缝只有 `writeText`，没有 `writeBytes`。所以走 `ctx.fs.resolve()` 拿 target → `processPath()` 拿 OS 路径 → Node `writeFile`（`artifact-io.ts` 改名那次已是同一手法）。落点仍是**本卡产物路径**（统一策略：不新建卡、不留 `-v2`），写完回读一次 facts 把 `kind` 落回记录。
6. **「形态」与「字节通道」是两张表，判据不同、刻意不互相读**：`MEDIA_KINDS`（`kind-registry.ts`，形态语义，三方共读）回答「这是不是媒体卡」；`MEDIA_MIME`（`artifact-io.ts`，按扩展名认字节通道）回答「该按什么 MIME 发出去」。音频的 8 种扩展名（mp3 / wav / m4a / aac / ogg / flac / opus / wma）只有后者需要，前者一个 `audio` 就够。
7. **工具名从 `TOOL_NAMES` 取，不手写**：`canvas_generate_image` / `canvas_generate_video` / `canvas_generate_audio` 三处（工具注册、提示词段落、清单申报）都读同一份真源，总数 16 → 18。媒体形态的提示词由 `mediaPreset(kind, tool)` 组装，而**按形态分叉只允许出现在 `artifactGuidance(kind, kindLabel, file)` 这一处**（抽成函数正是为了能进判据）。

8. **模型席位选的不是生成模型**（v1.71 补的界线）：卡片底栏那颗模型席位管的是**这段会话下一次请求用哪个模型**（宿主的 `session.selectModel`，见 `client/ui/model-picker.tsx`）；而「图片该由哪个模型画出来」是上面第 2 条的事——按**能力指纹**从模型配置里挑路线，与会话选了什么无关。两者刻意不相干：让会话跑在一个图片模型上只会把这段对话弄坏（适配器会拒），而生成器该是谁是部署配置的事。所以媒体节点上「告诉它用哪个模型」这句话有两种读法，各归各处：**会话用哪个模型在席位里选，生成走哪条路线在模型配置里配**（指名覆盖是插件配置的 `mediaImageRoute` / `mediaVideoRoute` / `mediaAudioRoute`）。席位本身在**还没有会话**的卡片上照样能选——它先替这张卡开一次会话再写（`client/ui/model-seat.ts`；那是 §十一「会话创建」那行的代价，v1.71 修的）。

> **v1.76 修正本条的一半**：上面说「生成走哪条路线在模型配置里配」，这在 v1.73–v1.75 期间被推成了「媒体卡上根本没有生成模型可选」——那是把两个判断搅在一起的结果（用户原话：「图片和视频模型的选择，只是选择图片模型和视频模型，不是选择对话模型」）。现在的界线是：**同一个控件、两种语义、两个落点**——对话卡的席位写会话选择，媒体卡的席位写卡片记录的 `mediaModel`，谁都不越界。挑路线的默认仍是模型配置里的模型族指纹，席位只是给这张卡**指名覆盖**。详见第 12 条。

9. **媒体生成模型不进席位候选**（v1.73，上一句的另一半）。真机一次 400 逼出来的：`max_completion_tokens … expected a value <= 12288, but got 32768`。那个 32768 是 `dsh-llm-pi-ai` 在模型条目**没声明 `maxTokens`** 时的部署默认（`defaultMaxTokens: source.defaultMaxTokens ?? 32768`，见它 `lib/index.js`），而媒体模型当然没声明——于是这条错误看起来像「参数填大了」。真因在别处：那张视频卡的会话席位被选成了 `doubao-seedance-2-0-mini`（**视频生成模型**），请求打到的是 `POST /chat/completions`，**不是** `/contents/generations/tasks`。所以这场 400 与「出视频」毫无关系，它是「拿视频模型当聊天模型用」。
   - **宿主给的目录是「配了哪些模型」，不是「哪些能当对话模型」**。用户加一条 doubao 路线好让 seedance / seedream 出图出视频 —— 同一批 id 于是原样出现在会话的模型下拉里，选中即崩，而崩在下一次请求上，与用户刚点的那个动作隔着好几分钟。
   - 判据与挑路线**共用同一份模型族指纹**：`mediaCapabilitiesOf` / `isMediaModel`（`core/media/routes.ts`）。两处各写一份名单就是「加一种媒体形态时漏掉一处」的老剧本，而漏掉的那一处不报错、只是不出现。
   - 席位的两个判断收在 `client/ui/model-seat.ts`（纯）：`seatCandidates` 滤掉媒体模型（**只列真正能对话的**），`isMediaSeat` 认出「已经选错的那个」。前者是「别让人点到」；后者是「**已经选错的不静默改**」——那是用户的选择，画布不替他做决定，但要说出来（`data-media-seat` 上色 + 菜单顶部一句可行动的话），因为症状离原因太远。
   - 顺手修的一处**部署配置**（不是代码）：这份 profile 的 `agent-default-model` 曾指向 `doubao/doubao-seedance-2-0-mini`（全局默认 = 视频模型）⇒ 所有没单独选过模型的会话都会 400。已改回 `gw/deepseek-v4-flash`，并在 `cordis.patch.yml` 的 doubao 路线旁写清了「这两个是媒体模型，别当默认」。**配置改了要重启实例才生效**，且已写过选择的会话不会跟着改（选择活在会话里，得在状态里重选一次）。

10. **引用要真的进生成请求**（v1.74，F2.7 / F4.1）。用户原话：「图片视频就是需要通过视频模型进行调用」，并给了两份官方文档（创建视频生成任务 / 图片生成）。照着核对的结论分三类：
   - **对得上的**：端点与方法——`POST {base}/images/generations`、`POST {base}/contents/generations/tasks`、`GET {base}/contents/generations/tasks/{id}`；`content` 数组的形状（`{type:'text',text}` + `{type:'image_url',image_url:{url},role?}`）；`ratio` / `duration` / `resolution` / `generate_audio` / `seed` 的字段名与类型；响应 `{id}` 与 `content.video_url` 的两种长相。
   - **两处偏差**（照文档核出来的，都不是报错型缺陷）：① `watermark` 在图片接口上**默认 `true`** —— 不写就等于「要水印」，每张图右下角一枚「AI 生成」。视频那条一开始就写死了 `false`，图片这条漏了。② `output_format` 默认 `jpeg`，而产物路径可能叫 `图片.png` ⇒ **jpeg 字节写进 png 文件**：不报错、浏览器多半也能显示，但 `MEDIA_MIME` 按扩展名发的 MIME 与字节对不上。现在按产物路径的扩展名对齐（`png` / `jpeg`，别的扩展名不表态）。
   - **一处真正的断路**：`canvas_generate_image` 把第 4 个参数 `referencePath` 写死 `undefined`，`canvas_generate_video` 的 options 里根本没有这一栏 —— **画布上那条引用从来没进过请求**。连线只出现在会话提示词里（「上游是这张图」），模型于是照文字描述去画；用户看到的是「没照我的图来」，而这条路上不会报任何错。这是「引用即数据」在媒体这一侧唯一没兑现的地方。
     1. **挑哪张图**收在 `core/media/reference.ts`（纯）：取**第一条上游里形态是图片的那张**（不是第一条上游——上游可能是配音或另一段视频），点名则压过自动；三种答复 `found` / `none` / `not-image` ── 第三种必须能说出「是哪张卡、什么形态」，否则一次安静的丢弃会被读成「模型没照参考图来」。
     2. **本地文件怎么变成服务端取得到的地址**：Ark 是拿着地址自己去下载的，`/Users/…` 在它那边等于 404。本机唯一现实的路是**内联成 `data:` URL**（两个接口都明确支持，不需要公网、不需要发布能力）：`media-provider.ts` 的 `referenceUrl()` 读字节、按 `mediaMimeOf`（与预览同一条真源）取 MIME、拼 base64；上限按文档写 30 MB，超了在这边就报，别让服务端回一句看不出原因的失败。
     3. **工具参数**：两个生成工具都加了 `referenceCardId`（点名另一张），视频另有 `referenceRole`（`first_frame` 默认 / `last_frame` / `reference_image`）。**不填 role 时不写这个字段**——三种场景在服务端互斥，替它填默认等于替用户选场景。
     4. **提示词里那句反过来写错了**：「参考图需要服务端取得到的地址，本地路径会 404 —— 上游产物要先有可访问的链接」。现在本地路径完全没问题，那句话会让 agent 白做一次发布。已改成「引用进来的图片会自动当参考图，不用你传路径、也不用先发成链接」。
   - **已知项**：`output_format` 只有 Seedream 5.0 pro / flash / lite 认（文档列的），4.0 / 4.5 传了可能换回 `InvalidParameter`（§十二）。

11. **「之前能出图，现在都不行」的两次真机复盘**（v1.75）。用户报「图片模型用 Seedream 5.0 pro、视频用 Seedance 2.5，配置页已经配好，之前图片成功生成过，现在都不可以了」。把那张**成功过**的图片卡（`cv-mvatn658`）与那张视频卡（`cv-mvasjsp1`）的事件流拉出来逐条对时，结论是**生成接口一次都没坏**：
   - 成功那次（09:57）：会话模型 `gw / deepseek-v4-flash`，三轮 `turn/end` 全是 `completed`，产物 2816×1584（正是 Seedream 2K + 16:9 的映射值）。
   - 同一天稍后：**同一张卡**的席位被切成 `doubao / doubao-seedream-5-0-flash-260915`（出图模型）；视频卡的席位先是 `doubao-seedance-2-0-mini`（→ 400 `max_completion_tokens`），再被改成 `deepseek-official / deepseek-flash`（→ 401 `api key ****fcf7 is invalid`）。
   - 两处坏掉的位置都在**会话**上（`model/selection`），`llmMs: 0`、`turn/end` 直接是 error：请求根本没到生成端点。所以「图片、视频都不行」是同一个病：**这张卡用哪个模型来说话**。
   - **新认识的一条**：v1.73 挡住了「媒体模型当对话模型」，但挡不住**部署里存在、密钥却无效的 provider**（这台机器上是 `deepseek-official`）。它比媒体模型更隐蔽——名字最像「官方」，选中时没有任何提示，401 落在下一次请求上。插件读不到宿主的凭证，判断不了「这条路线的 key 好不好用」，所以这一层只能靠**默认值指向验证过的路线** + 出错时把服务端原话带出来（`send()` 已经在做）。
   - **`agent-default-model` 是全局的那个坑**：它一旦指向坏路线，**所有没单独选过模型的会话**都会以同一个方式失败，症状看起来像「插件整体坏了」。本机已改回 `gw / deepseek-v4-flash`（唯一验证过能跑的一条），`cordis.patch.yml` 里 doubao 段上方写明了「这条路线里全是生成模型，不是对话模型」。

   同一轮照 Seedance 2.5 的教程核出来的**两处协议硬约束**（都会直接 400，且原因离现场很远）：
   - **首帧 / 尾帧场景 `ratio` 只能是 `adaptive`**（`InvalidParameter.TaskTypeConstraint`）。从前 agent 给 `ratio: '16:9'` 而参考图是首帧时，请求必失败。现在 `arkVideoBody` 在 role 为 `first_frame` / `last_frame` 时把 `ratio` 归一为 `adaptive`——这不是替用户改参数：首帧已经决定了输出比例，那个 `ratio` 本来就不会生效。`reference_image`（全模态参考）不受这条限制，用户要什么比例就还是什么比例。
   - **有参考图就必须写 `role`**。文档给的 role 取值只有 `first_frame` / `last_frame` / `reference_image`，**没有「空」这一档**；「不给角色会被当成首帧」是我们上一版自己猜的（写进了注释），文档里找不到依据。现在缺省由 `arkVideoBody` 补 `first_frame`，语义是「让这张图动起来」，与画布上「视频引用图片」的默认读法一致。
   - 顺带一条**运维**知识：`pickMediaRoute` 取的是「**第一条**模型族对得上的」，所以 `providers.doubao.models` 的**数组顺序就是优先级**。要图片用 pro、视频用 2.5，就得把 pro 排在 flash 前、2.5 排在 2.0 mini 前（本机已按这个顺序排列）。

12. **媒体卡的席位选的是生成模型，落点是卡片记录**（v1.76，F2.7 / F3.11）。用户原话：「图片和视频模型的选择，只是选择图片模型和视频模型，不是选择对话模型」。这一句是在纠正前面两版**各自都对、合起来错**的一处：v1.73 为了躲 `max_completion_tokens` 那个 400，把生成模型整族从卡片底栏的下拉里删掉了；v1.75 又把媒体卡的席位语义界定成「会话模型」。两条并起来的效果是——**图片卡上再也选不到图片模型**，而用户想做的恰好就是这件事。

   - **概念先分清**：一段会话**用哪个模型说话**，与**这张卡由哪个模型生成**，是两件事。前者活在会话的选择投影里（宿主 `session.selectModel`），后者是这张卡自己的属性。把后者写进前者，就是 v1.73 那场 400；因为前者而把后者删掉，就是 v1.73–v1.75 的空缺。
   - **存储：卡片记录上一个可选字段**（`domain.ts` 的 `mediaModel`）。遵守「派生默认 + 只存差异」：`undefined` 就是「没选过 ⇒ 自动」，老记录与老板面文件**一个字节都不用改**。空串是**合法入参**，意思是「回到自动」——写入时把它 `delete` 掉，而不是存一个空字符串（判据 `tests/host/card-media.spec.ts` 钉这一条：存空串会让「没选过」与「选了空」变成两个来源）。
   - **生成：指名就必用，找不到就报**。`generateImage` / `generateVideo` / `generateAudio` 的请求各加一个 `model?`；`routeFor(capability, model?)` 在 `model` 非空时走新加的 `findModelRoute`（按 id 反查所属路线），**认不回来就抛一个能让人行动的错**（`missingModelReason`：哪个 id、去哪儿改、现在配置里同族还有哪些），**绝不悄悄回退到 `pickMediaRoute`**。回退的后果是「用户在卡片上选了 A，出图的却是 B」，而且不报错——「同一个东西两个来源」的老剧本。
   - **席位：一个控件、两条路**。`client/ui/model-seat.ts` 的 `SeatTarget` 多出第四态 `card`：媒体卡的落点就是卡片记录本身，**与有没有会话无关**（所以它从来不需要 `openSession`，也不会被「新座 sessionId 是空串」绊住）。`mediaCapabilityOf(kind)` 决定这张卡走哪条路——判据必须读**形态注册表**（`resolveKindId` + `MEDIA_CAPABILITIES`），不能拿 `kind` 的字面量比。
   - **两条通路都要按 `media` 语义分岔**：菜单的候选（`mediaSeatCandidates`：媒体卡**只列这一族**）与按类型记忆（`recallModel(kind, catalog, { media: true })`）。只改一处的结果是「这条卡上选过的模型，那张卡上不认」——记忆分裂，用户看到的是随机的。
   - **对话卡那条界线不动**：`seatCandidates` 继续滤掉生成模型（v1.73 的判断仍然正确），`isMediaSeat` 继续提示历史遗留的错选。所以 v1.73 那条 400 不会再回来，而图片卡重新有了图片模型可选。
   - **本地产物跟着目录走**：`mediaModel` 与 `name` 同一纪律，进板面文件（`core/canvas/board-file.ts` 三处：编码、解析、补座），**只在有值时写**（`core/canvas/card-fields.ts` 的 `mediaSlotOf` 是唯一真源，三处构造 `BoardCard` 都经过它）。老板面文件因此逐字节不变。
   - **契约四处同步**：`contract.ts` 的 invocation（`card/set_media_model`）+ `P.mediaModel`、`typert.ts` 的 `CARD_MEMBERS`、`client/wire/remote.ts` 的 `CardFace` 与 `TypertRemoteMap`。**漏一处都不会报错**，只是那条调用在真机上不存在（`tests/contract.spec.ts` 就是钉这个的，这次正是它先响的）。
   - **已知项**：席位只负责「这张卡点名哪个模型」，**不校验这个模型今天还能不能用**（v1.75 那层：部署里有、密钥失效的路线要在生成时才暴露，插件读不到宿主凭证）。校验放在生成时、并在错里带出服务端原话。


### 音频：第三个产地（F2.7，v1.82）

用户原话：「参考视频，音频也是模型生成，模型参考（方舟模型页 `doubao-seed-audio-1-0`）」。这一版之前，音频是三条媒体能力里唯一**没有真实现**的一条：工具在、路线在、`generateAudio` 也在，但它把请求发到 `{route.baseURL}/audio/speech`、按 Bearer 鉴权、再从一个猜出来的 JSON 字段里读 base64。**三件事都是猜的**，而猜错的形状恰好不会在本地报错——它只在真机上换回一个 404，或者一段空字节。

照着接口文档核完，四处差异，每一处都能单独把这个功能做坏：

| | 图片 / 视频 | 音频 | 猜错的后果 |
| --- | --- | --- | --- |
| 主机 | `ark.*.volces.com` | `openspeech.bytedance.com`（海外 `voice.<region>.bytepluses.com`） | 404，而错误里不会说「发错主机」 |
| 端点 | `/images/generations`、`/contents/generations/tasks` | `/api/v3/tts/create` | 404 |
| 鉴权 | `Authorization: Bearer <key>` | `X-Api-Key: <key>` + `X-Api-Request-Id` | 401，而用户手里那把 Ark key 看起来「明明是同一个厂商」 |
| 模型名 | 直接吃市场 id | `doubao-seed-audio-1-0` → **`seed-audio-1.0`** | 「模型不存在」 |

**为什么不让它跟着路线走**（`audioBaseURLOf`）：一条 provider 路线通常是按方舟写的（`baseURL: https://ark.cn-beijing.volces.com/api/v3`），而用户在同一把 key 下再加一个音频模型是**完全自然的配置**——这次的原话就是这么做出来的。可那个地址上没有 `/tts/create`。所以规则写成「主机以 `ark.` 开头就换到语音那条」，区域从主机名带过去（`ark.ap-southeast-1.bytepluses.com` → `voice.ap-southeast-1.bytepluses.com`，不硬编一个 cn）；**其余一律照旧**，自建中转与代理都在这一支。猜一个更「对」的地址，会把一条本来能用的路线改坏。

**模型名为什么要换**（`arkAudioModelOf`）：同一个模型有两副名字——广场上是 `doubao-seed-audio-1-0`，接口只认 `seed-audio-1.0`。用户在 DSH 模型配置里抄的是广场上那个，所以发请求前必须换一次。转换**整串锚定**（`^seed-audio-(\d+)-(\d+)$`），不做「末尾两个数字就是版本号」的替换：`…-1-0-260628` 那种带日期后缀的 id 会被改成 `…-1.0.260628`，一个谁都没见过的名字。图片、视频两族的 id **一个字符都不动**——它们的接口直接吃市场 id。

**格式必须与产物路径对齐**（`arkAudioBody`）：`audio_config.format` 默认 `wav`，而产物叫 `voice.mp3` ⇒ wav 字节写进 mp3 文件。与图片的 `output_format` 是同一个坑、同一条修法：扩展名 → 服务端认的四种（`mp3` / `wav` / `pcm` / `ogg_opus`，`.opus` 与 `.ogg` 都映射到后者）；认不出的扩展名**不表态**，让服务端用自己的默认。`audio_config` 只在真有字段时才挂上去——`{}` 与「不说」在服务端是两件事。

**响应是同步的，但「HTTP 200」不等于成功**（`readAudioResult`）：语音接口可以在 200 里回一个非零 `code` + `message`，而响应体里同时带着一个**空的** `audio` 字段。所以读的顺序是「错误码 → 内联 base64 → 临时地址」；反过来会拿空字符串去解码，落一个 0 字节的文件，而表面上成功。

**入参叫 `prompt`，不叫 `text`**：`seed-audio` 这一族收的是**导演指令**——一条 prompt 里可以有多角色对白、音效、配乐与环境声（「雨夜便利店，两人压低声音争吵，背景有收银机滴滴声」），要念的台词只是其中一种写法。上一版把它叫 `text`、并在提示词里写「要被念出来的字」，会让卡片会话里的模型只按朗读稿来用，等于把这个模型最窄的那一面当成了全部。`voice` 参数一并删掉：这个模型选音色靠 prompt 描述或参考音频，不是传一个音色 id（`mediaCapabilitiesOf('audio')` 与工具描述都已跟上）。

**部署这一侧建议两条路线**（不属于代码，但不说就一定会踩）：语音的 API Key 在**另一个控制台**，与方舟那把不是同一个。所以推荐在 `llm-pi-ai.providers` 里加一条**只放音频模型**的路线：

```yaml
doubao-audio:
  apiKeyEnv: ARK_AUDIO_KEY        # 语音控制台拿到的 API Key
  baseURL: https://openspeech.bytedance.com/api/v3
  models:
    - id: doubao-seed-audio-1-0
```

两条硬注意事项：① **同一个模型 id 只写在一个路线里**——卡片记住的 `mediaModel` 是靠 id 反查路线的（`findModelRoute` 按配置顺序取第一条含它的），两处都写会让音频被那条「方舟」路线认走，于是拿错 key 401；② 只有一条路线时也能跑，前提是那把 key 两边都认；不行就按上面的办法拆开。401 的错误文案会直接点到这一条（`speechFailure`：把「这是另一套密钥、去哪儿改、现在解的是哪个环境变量」写在同一句里），因为只说 401，用户会拿方舟那把 key 反复重试。

**判据**：`tests/core/media/ark.spec.ts` 加三组（请求体 → `text_prompt` 与格式对齐、响应 → 三种出路、模型名 → 两副名字与日期后缀），`tests/core/media/routes.spec.ts` 加一组（`ark.*` 换主机、BytePlus 带区域、别的主机不动、读不懂的地址不动），新增 `tests/host/media-provider.spec.ts` **真的发了一次请求**——把 `fetch` 换成一个记账的假货、产物落到真的临时目录，于是「端点、请求头、请求体、写下去的字节」四件事一起被验到。这一份刻意不读源码文本：音频与图片 / 视频的差别**全是接线**，接线错一处，纯函数那侧照样全绿。

**变异 7 处，逐条验红**：照 baseURL 发 ⇒ 2 红（端点 + 下载那条的地址序列）；用 Bearer ⇒ 1 红；不换模型名 ⇒ 1 红；不带 `format` ⇒ 1 红；无视 `code` ⇒ 4 红；401 不补解释 ⇒ 1 红；`audioBaseURLOf` 不换主机 ⇒ 2 红。

### 媒体卡面：产物本身就是画面（v1.72，F2.7）

用户原话：「音频卡片就直接是音频播放器，图片，视频同理」。真因**不是播放器没接上**——全屏预览那一侧三个预览器从 v1.70 就在了——而是**卡面根本不画产物**：`card-tile.tsx` 的预览按 kind 分派，表里只有 markdown / 设计 / 应用三支，媒体落到最后那条**大纲行**上；而一张 PNG 的 `outline` 是空的（字节不是文本），于是图片卡在画布上只剩「图片」两个字。所以这一版加的就是那第四支。

1. **画哪个元素、谁吃指针，两条判断都在 `client/canvas/media-face.ts`（零依赖纯模块）**。前者是「三种形态各一个元素，没有第四种」；后者是「**有控件的元素自己吃掉 `pointerdown`**」——卡片的指针是拖拽把柄（`setPointerCapture`），播放条不吃的话按一下播放键就会把这张卡从画布上拽走，而手不试一遍看不出来。图片没有控件，于是把指针让给卡片（点＝选中、拖＝拖卡），与别的卡手感一致。**双击那一路谁都不吃**：它留给卡片的「双击开全屏」（F3.8），对媒体卡来说那正是「放大看」。这张表用 `Map` 而不是对象字面量，判据里有一条专门钉它：对象字面量上 `FACES['constructor']` 会顺着原型链返回一个函数（真值），卡面于是会去画一个空元素。
2. **读法与全屏预览是同一条**：`card-media.ts` 的 `useMediaAsset` 走的还是 `readArtifact`——同一份 wire 上限、同一副 `data:…;base64,…` 形状、同一套「产物还没生成」的语义。**卡面不另开一条读法**，否则「卡上能看、点进去看不到」（反过来也一样）这类不一致迟早会出现。上限**不在客户端任何一处**：卡面直接要一次，由 host 用它那个 `truncated` 答（判据会抓抄回客户端的那一份）。
3. **没东西可画时说清楚是哪一种**：`mediaAssetOf` 把 view 翻成四态——`ready`（画）、`absent`（「产物文件还没生成」）、`too-large`（「文件过大，无法在此预览」）、`empty`（**退回大纲行**，不占卡面）。前两种的文案与全屏预览**共用同一批 key**，同一件事不给它两句话。
4. **取用方式抽成了两处共用的一份**：`client/canvas/asset-cache.ts` 的 `cachedFetch`（单飞 + 有界，键是 `项目/卡@bytes`）原先是 `card-shot.ts` 的私有函数，媒体卡面也要用，于是搬家并泛型化——同一件事写两遍，早晚有一遍先被改。媒体那份缓存的容量上限比截图小得多（一条记录可能是一段十几兆的视频）。
5. **顺手收掉三处「手写名单少一种形态」的漏网**。加 `audio` 那一版（v1.70）漏了三处，三处都不报错、都只是**不出现**：① `canvas-tab.ts` 的 `CLAIMABLE`（右栏认领，v1.70 已修）；② `artifact-io.ts` 的 `summarize` 里 `!facts.kind.startsWith('image') && facts.kind !== 'video'`——**mp3 会被当文本读**，读得出来（非致命解码）、读出来是替换字符，而那串字符会顺着 digest 一路进下游卡片的提示词（F5.2）；③ `canvas-runtime.ts` 的 `reconcile`（板面对账）同一句话，白读一遍整份音频字节。两处都换成 `isMediaKind`。**并且把这条规律做成了机械判据**（`media-kinds.spec.ts` 的点 4）：扫 `src/`，任何一处 `kind` 与媒体名字的比较，要么走 `isMediaKind`、要么三种写全（`host/prompt.ts` 的提示词分叉与 `viewers/media-viewer.tsx` 的注册是后者，它们**该**分明说）。判据只认名叫 `kind` 的那一侧——媒体形态的名字与别处撞车（卡面上 `face.element === 'audio'` 说的是元素、引用里 `option.type === 'image'` 说的是参考物类型），这两处是首版误报教出来的边界。

**判据**：`tests/client/canvas/media-face.spec.ts`（7 项：形态表覆盖全部 `MEDIA_KINDS` 且不认领别的形态、怪键不得命中、控件与指针一一对应、载荷四态）、`tests/client/canvas/card-tile.spec.ts`（6 项，读源码文本：媒体那一支是分派链上的真分支、`empty` 退回大纲行、有控件的元素吃掉指针而图片不吃、卡面里不许有第二份形态清单、不许抄字节上限、读法就是 `readArtifact`）、`tests/client/canvas/asset-cache.spec.ts`（4 项：单飞、满员淘汰最老、淘汰不取消已交出去的请求）、`tests/core/artifact/media-kinds.spec.ts` 的点 4（2 项：全仓不许有只写了一两种形态的手写名单 + 这条规则不许空转）、`tests/core/artifact/artifact-io.spec.ts` 新增 4 项（媒体走二进制通道、超上限如实 `truncated`、**摘要从不拿文本口读媒体**、图片那两态照旧）。**十三处变异逐条验红**（抽掉分派那一支 / 去掉 `empty` 判据 / 拿掉 video 的指针拦截 / 在卡面写 `kind === 'image'` / 抄一份 16MB 上限 / 抽掉单飞 / 抽掉淘汰 / 摘要退回手写名单 / 媒体通道不再判上限 / 查表换成对象字面量 / 把「太大」与「空」合并 / 板面对账退回手写名单）。其中**首版一条判据被变异测试证伪**：原先写的是「媒体支要排在回退行之前」，而三支互斥、位置无关，排在哪都是对的——真正会少的是**那一条分支**，判据已按这个结论重写（记在 `card-tile.spec.ts` 的头部）。

**判据**：`tests/core/media/ark.spec.ts`（17 项：图片两副返回形态、视频任务号与终态、成片 URL 两副长相、超时与取消）、`tests/core/media/routes.spec.ts`（10 项：指纹匹配、读不懂整条丢掉、指名覆盖、找不到时那句话）、`tests/core/artifact/media-kinds.spec.ts`（8 项：音频扩展名归 `audio`、`MEDIA_MIME` 与 `detectKind` 认得的媒体扩展名**一一对上**）、`tests/client/artifact/viewers/media-viewer.spec.ts`（6 项：三个媒体预览器都在注册表里、音频那一行的控件）、`tests/client/ui/model-seat.spec.ts`（**24 项**，v1.76 重写：四态落点 + 媒体卡的落点与会话无关 + **形态映射自己决定落点**（两半各自对不算，接起来得对）+ 两种卡各列各的候选 + 按钮的禁用判据不是「有没有会话」、`pick` 里媒体那一支**写完就 return**、对话卡开会话发生在写选择**之前**、不可达时不写记忆）。前面几处**逐条验红**过：抽掉 `canvas_generate_audio` 的申报 ⇒ 清单对账那条红；抽掉 `flac` 的 MIME ⇒ 上面那张「一一对上」的表红；抽掉 `audioViewer` 的注册 ⇒ 注册表条目那条红。席位那三条也逐条验红（见 §五第 8 条的修法）：`disabled` 退回 `sessionId === ''` ⇒ 禁用判据那条红；`pick` 里不再开会话 ⇒ 次序那条红；`seatTarget` 抽掉 `open-first` ⇒ 落点表那条红。

**v1.76 的判据**（媒体卡选生成模型）：`tests/host/card-media.spec.ts`（6 项，读 `card-runtime.ts` 的**函数体**而不是文件里出现过某个词：按记录里的 `mediaModel` 生成、没这个字段就交 `undefined`（那是「自动」不是「用空模型」）、三条生成能力都把模型透传下去、空串删字段、不碰会话、不校验配置里还有没有这个模型）、`tests/core/media/routes.spec.ts` 新增 4 项（`findModelRoute` 按 id 反查、**配置里没有就答 `undefined` 而不是回退**、`missingModelReason` 说得出 id 与改法）、`tests/core/canvas/card-fields.spec.ts`（2 项：`mediaSlotOf` 有值才写、`undefined` 不产生键）、`tests/client/wire/model-memory.spec.ts` 新增 1 项（按类型记忆按 `media` 分岔）。**四处变异逐条验红**：① `produce(file, record?.mediaModel)` 改成 `produce(file, undefined)` ⇒ 「按记录生成」与「没字段就交 undefined」两条红；② `mediaCapabilityOf` 恒返回 `undefined` ⇒ 映射、候选、**以及新增的接线那条**红；③ `findModelRoute` 末尾回退到 `pickMediaRoute` ⇒ 「不回退」那条红；④ `pick` 里媒体支删掉 `return` ⇒ 「写完就 return」那条红。**其中第 ② 条第一次跑时只红了前两条**——「落点是 `card`」那几条照样绿（它们直接传 `media: true`，绕过了映射），于是补了一条**接线判据**（先问形态、再拿答案问落点）。这正是「两个零件各自都对、接起来错」的那类漏洞，只有走真机那条路才抓得到。

### 导入本地文件：字节从浏览器到磁盘（F2.7，v1.81）

用户原话：「卡片操作栏添加导入功能，可以上传本地的图片和视频当做产物」。这一版之前，媒体卡的产物只有一条来路——让模型生成；而用户的素材本来就在自己电脑上，于是第一步永远得先想办法把那张图变成一个画布里的文件。

一件事，两个半边，中间只有一条通道：

| | 客户端（`client/canvas/import-file.ts`） | 宿主（`CardRuntime.importArtifact`） |
| --- | --- | --- |
| 判能不能导 | `importCheckOf` → `importPlanOf`（`taken` 恒假） | 同一个 `importPlanOf`（`taken` 问磁盘） |
| 字节 | `readBase64`（`readAsDataURL`，剥掉 `data:` 前缀） | `decodeBase64` → `ArtifactIo.writeBytes` |
| 记录 | — | `file` / `kind` 重写，`aspect` 与 `seatedEmpty` 删掉 |
| 收场 | `importNotice`（`ok` / `warn`） | `card/import-refused` + 理由 |

**为什么判据写在一处、判两次。** 「这个文件能不能导」两边都要问：客户端要赶在**编码之前**拦掉一个 80MB 的视频（base64 膨胀 4/3，先编码就是先分配 107MB 的字符串），宿主仍是最终那一关（客户端可以被绕过，而磁盘上的真相只有它知道）。两边各写一份，就是「同一个东西两个来源」——这一次的表现会是「界面说能导、导进去报错」，或者反过来。所以两边都调 `core/canvas/import-plan.ts` 那个纯函数，只是注入的 `taken` 不同。

**为什么是 base64 一整趟。** 浏览器手里的 `File` 只有名字与字节，没有路径——本机没有第二条通道能把一个本地文件交给宿主。上限因此必须设在客户端：`IMPORT_MAX_BYTES = 16_000_000`，与全屏预览的 `VIEW_BYTES_CAP` **是两个事实**（一个是「一次搬运多少」，一个是「一次读回多少」），只是恰好取同一个数。合成一个常量的代价是调其中一个会莫名其妙地放开另一个；而它们之间那条**必须成立的关系**（搬得进来的必须看得见）由判据钉住：`IMPORT_MAX_BYTES <= VIEW_BYTES_CAP`。协议层再留一道长度上限（`P.fileData` 的 `.max(21_400_000)`，即 16MB × 4/3 + 余量），同样有一条判据按 `IMPORT_MAX_BYTES` 算一遍来对账。

**字节为什么不能走 `write`。** 缝的写入口是 `writeText`，它把内容当 UTF-8 发布：一张 PNG 从那儿过去**不会报错**，只会写出一个打不开的文件。媒体生成那条路早就踩过这个坑（`host/media-provider.ts` 的开头），导入是同一个结论。于是 `ArtifactIo.writeBytes` 与 `renameEntry` 同一套代价与守卫：路径仍由缝解析（沙箱根、包含性判据都是它的），**能不能落**也仍由缝说（`contains` + `read-only` 拒绝），只有最后那一步 `writeFile` 交给 OS，并且先做一次 `processPath` 回证——另一个执行世界的后端（远端、容器）回不出同一个 target key，那就一个字节都不写。

**路径怎么定（`import-plan.ts`）。**

- **名字**：只取 basename（浏览器的名字可能带一长串相对路径，Windows 的 `\` 也当分隔符），再交给 `fileStemOf`——那是「用户亲手打的名字」那条既有规矩的落点：大小写与非 ASCII 原样保留，只改文件名不能带的字符。扩展名**认大小写、落盘保留原写法**。
- **为什么是这个目录**：沿用卡片**现产物所在的目录**。一张 `decks/slide.md` 的卡导进一张图，图该进 `decks/`，而不是跑到项目根去。
- **撞名**：判在磁盘上（`presenceOf`），从 `-2` 起往下试——与建卡、脚手架、改名同一个规矩。**唯一例外是撞到自己**：新名字与这张卡现在的 `file` 一模一样时算**替换**，不加序号、连磁盘都不问。少了这一条，「再导一次同一张照片」会变成两个文件。
- **三种拒绝各有各的下一步**：`unsupported`（不是媒体扩展名——判据读的是 `core/media/mime.ts` 那张表，与全屏预览的字节通道同一份）、`too-large`、`empty`。合成一句「导入失败」就等于让用户自己猜。

**记录改五处，各有各的理由。**

| 改什么 | 为什么 |
| --- | --- |
| `file` → 新路径 | 产物换了地方；卡片 id 不动（**id ≠ 路径**，座位还是那个座位） |
| `kind` → 按新文件名重判（`detectKind`） | 形态从来由产物决定：图片卡导进一段视频，它就成了视频卡。让旧 kind 挂在记录上，就会与卡面各说各话 |
| `delete aspect` | 旧比例是**上一个产物**的。留着，卡片会先按旧比例坐一次，等浏览器量完再跳一下 |
| `delete seatedEmpty` | 它是「这个座位生来没有产物」，用来区分「还没写」与「写过但丢了」。现在有产物了，这个豁免继续留着会让后续的失效判据读错 |
| `updatedAt` | 与别的 mutation 同一条 |

**旧产物不删。** 导入是「这张卡现在显示这个」，不是「把之前那个文件删了」——文件还在目录里，用户想留就留；需要的话，画布的对账会把它当成一张未落座的文件提出来。

**两个错误码，因为它们的读者不同。** `card/import-refused`（带 `reason`）是**答案**：用户换一个文件、压小一点、或者挑错了；界面按 `reason` 说三种不同的话。`card/import-malformed`（带 `length`）是**调用方写错了**——`readBase64` 只会给出合法的一段，真出现这个码说明有人手写了载荷，一个要改代码、一个要换文件。

**为什么解码前先验格式。** `Buffer.from(x, 'base64')` 是宽容的：不认识的字符被悄悄丢掉，于是「传错了一个字符串」会得到一堆看起来正常的字节和一个打不开的文件。所以先按 base64 的形状验一遍（字符集 + 长度是 4 的倍数），不合法就报 `card/import-malformed`。

**判据三份**：`tests/core/canvas/import-plan.spec.ts`（19 项，纯，穷举：名字清洗 / 三种拒绝与边界 / 同目录 / 撞名 `-2` / 撞自己算替换且**一次不问磁盘** / `IMPORT_MAX_BYTES <= VIEW_BYTES_CAP` / 协议上限容得下最大那一份 / `accept` 从表推出来）、`tests/host/card-import.spec.ts`（10 项，读 `importArtifact` 的函数体：走 `writeBytes` 不走 `write`、**先落盘后写记录**、超限在解码之前、三处记录改动、撞名问磁盘不问板面、不碰会话）、`tests/client/canvas/card-import.spec.ts`（16 项，读源码文本：按钮只在媒体卡上、`accept` 来自表、选完先清 `value`、被拒时连字节都不读、只有导进去才刷新板面、中英文案齐、四处同名）。

**八处变异逐条验红**：删掉「撞自己算替换」⇒ 2 红；上限写成 `>=` ⇒ 边界红；`folder` 不跟随卡片目录 ⇒ 2 红；字节之后又走一次 `io.write` ⇒ 2 红；删 `delete next.aspect` ⇒ 1 红；去掉 `canImport` ⇒ 1 红；不清 `value` + 手写 `accept` ⇒ 2 红；被拒也 `setStamp` ⇒ 1 红。

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
  mediaModel: z.string().optional(),                      // v1.76：这张卡**由哪个模型生成**（F2.7）。可选＝老记录读作「自动」；**与会话模型是两件事**
  aspect: z.number().optional(),                          // v1.80：产物的真实宽高比（宽/高），由**浏览器**量出来写在这里。可选＝没量过＝按默认 16:9；音频永不写
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
  mediaModel?: string        // v1.76：媒体卡选定的生成模型 id；缺省即「按模型族自动挑」
  aspect?: number            // v1.80：产物的真实宽高比（宽/高）；缺省＝没量过＝按默认 16:9 坐
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
               { "id": "untitled.md", "position": { "x": 336, "y": 170 }, "empty": true },  # empty：座位生来没有产物（F1.11）
               { "id": "cover.png", "position": { "x": 624, "y": 170 }, "empty": true,
                 "mediaModel": "doubao-seedream-5-0-pro-260628" } ],   # v1.76：这张卡由哪个模型生成（只在选过时写）
  # v1.80：卡片条目上还可能有 "aspect": 1.5（产物真实宽高比，浏览器量出来才有）
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
| 什么不跟着走 | `sessionId`（换台机器就是另一个会话，带过去只会假装有对话）、视图状态、排队中的意图。划线处是**属性归谁**：作品的关系与布局走，本机态留下。`name` 与 `mediaModel`（v1.76）**跟着走**——它们描述的是这张卡本身（叫什么、由哪个模型生成），不是这台机器。`aspect`（v1.80）同理跟着走：卡多大是**作品的版式**，换台机器就不该重新长一遍（也因为不一样高会让引用线、排版跟着挪） |
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
| Host 认定      | `src/core/artifact/kind/kind-registry.ts` + `ctx.fs`    | 由扩展名与内容证据判定 `kind`，结果写进 domain 的 `cards` 记录。图片 / 视频 / 音频三个媒体 kind（v1.70）同样由**文件证据**认定，不由用户声明——`MEDIA_KINDS` 与 `isMediaKind()` 是三方（kind 表、IO 层、客户端）共读的那一根指针 |
| Client 认领与预览 | **右栏 tab 类型注册表** `ctx.sidebarRightTabs.register()` | 按资源地址 glob 认领，用 `priority` 分档压过内置查看器        |

```typescript
// src/client/canvas/board/canvas-tab.ts —— 一种形态 = 一个 tab 类型
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

### 模型席位：一个控件，两种语义，两个落点（F3.11，v1.76）

底栏那颗下拉框在两种卡上问的**不是同一件事**，而它们共用一个组件（`ui/model-picker.tsx`）——这是刻意的：用户眼里它都叫「这张卡用哪个模型」。共用组件可以，**共用一个落点不行**，v1.73 那场 400 就是这么来的。

| | 对话卡（文本 / 设计 / 应用） | 媒体卡（图片 / 视频 / 音频） |
| --- | --- | --- |
| 它问的是 | 这段会话**下一次请求**用哪个模型 | **这张卡由哪个模型**生成 |
| 落点 | 会话的选择投影（宿主 `session.selectModel`） | 卡片记录的 `mediaModel`（`card/setMediaModel`） |
| 要开会话吗 | 要——落点是会话，而卡片可以先于会话存在 | **不要**，任何时候都不 |
| 菜单里列什么 | 滤掉生成模型（`seatCandidates`） | **只列这一族**（`mediaSeatCandidates`） |
| 没选过时显示 | 会话的选择，或类型记忆 / 部署默认 | 「自动」——生成时按模型族去配置里挑 |
| 按类型记忆 | `recallModel(kind, catalog)` | `recallModel(kind, catalog, { media: true })` |

两条判断收在 `ui/model-seat.ts`（纯、零依赖）：

- `mediaCapabilityOf(kind)` → 这张卡属于哪一族媒体能力。**必须经形态注册表**（`resolveKindId` + `MEDIA_CAPABILITIES`），别名形态拿字面量比会漏。
- `seatTarget({ sessionId, projectId, cardId, media })` → `'session'` / `'open-first'` / `'card'` / `'unreachable'`。`media === true` 时**直接答 `card`**，会话在不在都一样（媒体卡的落点与会话无关，这条是 v1.76 的要害）。

组件的用法只有一句：`media: isMedia`，而 `isMedia = mediaCapabilityOf(kind) !== undefined`。判据里除了分别测这两半，还专门有一条**接线**（先问形态、拿答案问落点）——只测两半各自对是不够的，第一轮变异就证明了这一点：把 `mediaCapabilityOf` 改成恒 `undefined`，「落点是 `card`」那几条照样绿，因为它们直接传 `media: true`。

**媒体卡的菜单顶部有一句说明**（`canvas.composer.modelMediaNote`）：「这里选的是生成这张图 / 这段视频的模型，不是对话模型」。这句话是本版的核心——上一版把这两件事混在一起，用户看到的是「图片卡上选不到图片模型」。

### 卡片尺寸：一档 400×252，产物出来之后按真实比例坐（F2.7 / F3.11，v1.77 → v1.80）

用户原话四轮：「图片卡片和视频卡片，要放大一倍，方便预览」→「调整图片视频尺寸默认为 16:9 的宽高比，现在高度有空白区域」→「其他类型的卡片大小改成和图片和视频一样的默认大小」→「图片视频后续产物生成后，按图片视频的真实宽高比来渲染」。四句话把这件事推到了终点：**一张卡多大，与它是什么形态无关；尺寸只在产物自己说话时才变**。

这件事的关键不是「改个宽度」，而是**尺寸从哪儿读**——它在画布上有六处消费者，任何一处读错都不会报错，只会错位。

| 谁读尺寸 | 从前 | 现在 |
| --- | --- | --- |
| 卡片本身渲染（`card-tile.tsx`） | CSS 里写死 200×140 | 内联样式给 `sizeOfCard(card)` |
| 引用线的锚点（`source-edges.tsx`） | `position.x + 200` | `position.x + sizeOfCard(upstream).width` |
| 连线落点的命中矩形（`canvas-view.tsx` 的 `cardAt`） | 固定 200×140 | `sizeOfCard(card)` |
| 取景 / 缩略图 | 最右 x + 200 | 每张卡的右沿与下沿（各自那个数） |
| 自动排版（`core/canvas/board.ts`） | 固定步长 `CARD_WIDTH + gap` | 逐列取最宽、逐行取最高 |
| 控制带与工具条的锚点（`card-overlay.tsx`） | 写死 `x + 100`、`y + 156` | `x + width / 2`、`y + height + 16` |

**唯一真源是 `core/canvas/card-size.ts`**：`CARD_WIDTH`（400）、`CARD_HEAD_HEIGHT`（26）、`CARD_BORDER`（1）、`MEDIA_CARD_ASPECT`（16/9），以及由它们**算出来**的面板与卡高（`PANEL_WIDTH = 398`、`PANEL_HEIGHT = Math.round(398 / (16/9)) = 224`、`CARD_HEIGHT = 224 + 26 + 2 = 252`）。`board.ts` 里那两个常数从这里再导出——从前客户端还**另抄了一份** `const CARD_W = 200`（`canvas-view.tsx`），两份数字迟早对不上，v1.77 一并收掉。

**三个入口，一条公式**：`cardSizeOf()`（默认 16:9）、`cardSizeFor(aspect)`（按比例反推）、`sizeOfCard(card)`（读卡自己的 `aspect`，六处消费者调的就是它）。三个都在同一个文件里，`cardSizeFor` 是唯一的算式，另两个只是喂不同的值。

**比例从哪儿来：浏览器量，宿主存**（v1.80）

比例在 `client/canvas/card-media.ts`。图片加载完读 `naturalWidth / naturalHeight`，视频读 `videoWidth / videoHeight`；音频没有比例，恒不报。量出来与卡上已记的值差超过 `ASPECT_EPSILON`（0.005）才经 `card/setAspect` 写进卡片记录，四舍五入到 4 位。

为什么不在宿主量：解码 PNG / JPEG / WebP / MP4 容器头要一整套解析器（且 HEIC、AVIF、MOV 各有各的坑），而浏览器**已经解过一次**——`naturalWidth` 就是它算出来的数。为什么不放内存：排位（`arrangeSeats`）与板面文件都在宿主，只有写进记录，六处读的才是同一个数，换台机器打开同一份作品才不跳。

几条约束：

- **没量过就是没量过**：`aspect` 缺席 = 按默认 16:9。产物还没生成、加载失败、浏览器没给出尺寸，一律不写——老记录零迁移，老板面文件逐字节不变（`composeBoardFile` 只在值是好数时才写，`parseBoardFile` 用 `ratio()` 只认有限正数，`'0'` / `'-1.5'` / `'"wide"'` / `'null'` 一律读成「没量过」）。
- **面板有下限**（`MIN_PANEL_HEIGHT = 60`）：20:1 的横幅按比例算出来面板只有 20px 高，连卡头都比不过——那是「卡塌成一条缝」，不是「按比例」。1:1 / 4:3 / 9:16 / 16:9 都碰不到这个下限。
- **只在差别超过 0.5% 时回报**：视频 `loadedmetadata` 之后 `videoWidth` 可能因流切换再变一次，没有这道阈值就会跟着抖。
- **`aspect` 与 `mediaModel` 不合并**（`core/canvas/card-fields.ts` 里 `aspectSlotOf` 与 `mediaSlotOf` 并列）：前者由浏览器测、后者由用户选，默认不同、时刻不同，合成一个 slot 只会让下一次改动要拆两个语义。
- **排位必须按各自的高**：`SeatInput` 带上 `aspect`，`source-chain` 里两张竖卡叠着排，第二张的 `y` 正好是 `上一张.y + 上一张.height + gap`。这条判据是被变异逼出来的（见下）。

几条判断：

- **尺寸不收形态**：`cardSizeOf()` 与 `cardPanelOf()` **没有参数**。这不是省事——「图片大、文本小」这种分岔从此写不出来（传参在类型上就是错的），比「留个 kind 参数但恒返回同一个值」硬得多：后者骗得过编译器，骗不过下一个人。原来那张「哪些形态放大」的名单（`LARGE_CARD_KINDS = MEDIA_KINDS.filter(id => id !== 'audio')`）与 `isLargeCard` / `LARGE_CARD_SCALE` 全部删除，判据另有一条读源码断言它们不再出现。
- **卡高的 252 是算出来的，不是写死的**：卡面**铺满预览面板**（`.dsh-canvas-card-media` 用负边距抵掉预览区的 padding），面板 = 卡宽减两边边框 ／ 卡高减卡头再减两边边框。高度若按「宽度的 70%」给（v1.77 的 280），面板就是 398×252（1.58:1）——一张 16:9 的图按 `contain` 铺进去上下各空 13.5px，这正是用户说的「高度有空白区域」。所以高度由**面板 16:9 反推**：`Math.round(398 / (16/9)) = 224` ⇒ 整卡 252。改 `CARD_WIDTH` 时高度会自动跟。
- **卡头与边框的常数要能对账**：`CARD_HEAD_HEIGHT = 26` 来自 `.dsh-canvas-card-head` 的上下 padding 各 5px + 名字行 16px；`CARD_BORDER = 1` 来自 `.dsh-canvas-card{border:1px}`。这两个数扣错了，图就在卡面下方留一条空带——页面上一句报错都没有。判据因此**从 `styles.ts` 现解析这三个数**（`cssBlock()` 按行首锚定取声明块，绕开 `.dsh-canvas-card.is-absent .dsh-canvas-card-preview` 这类修饰规则），而不是再抄一份常数。
- **卡面「铺满面板」本身也要验**：预览区 `padding:0 10px 8px`，媒体用 `width:calc(100% + 20px)` / `height:calc(100% + 8px)` / `margin:0 -10px -8px` 抵回去。两边必须成对——只改一边，16:9 的算式就与实际渲染差一截。
- **排位按「各自尺寸」写**：所有卡默认一样大时，`arrangeSeats` 的三条策略（grid / source-chain / organize）与 `nextFreeSeat` 的写法其实与固定步长等价；但 v1.80 之后竖卡真的会更高，那套「逐列取最宽、逐行取最高」「用最右那张的右沿」正好接住——**没有任何一处需要改**。这正是当初不写成固定步长的理由。`SeatInput.kind` 保留（它是座位的一条事实），但排位不看它，看 `aspect`。
- **只能改占位，不能改内容**：卡头、名字、预览的内边距与字号一个都不动。可见的变化全部来自面积变大——文本卡预览区从 112px 高变成 224px（多显示两行），应用卡的迷你帧不再被压成半宽，音频卡的播放条在更宽的卡面上居中。
- **CSS 里的宽高退成兜底值**（也同步成 400×252），真值由内联样式给。判据有一条断言样式表里那两个数与 `CARD_WIDTH` / `CARD_HEIGHT` 一致——单独读那份 CSS 时不该看到两个数。

**判据**：`tests/core/canvas/card-size.spec.ts`（20 项）——一档尺寸（400×252）、**签名不收形态**（`cardSizeOf.length === 0` + 源码里不再有 `LARGE_CARD`）、**卡面正好 16:9**（`cardPanelOf()` 的宽高比，精度 2，且必须是 398×224）、卡头与边框对账、卡面铺满面板、样式表兜底值对账、**排位不重叠**（三条策略各验一次矩形不相交）、四处接线读源码文本（含一条「全仓没有一处给 `cardSizeOf` 传 kind」的正则扫描）；v1.80 再加五条：`cardSizeFor` 的映射（1:1 ⇒ 400×426、9:16 ⇒ 400×736）、不可信值一律回落、极端扁比例的下限、`sizeOfCard` 读的是卡自己的 `aspect`、**排位按各自的高**（source-chain 竖排两张竖卡 + 两张矮卡，逐对断言 `下.y - 上.y === 上.height + gap`，不依赖排位顺序）。

**比例那一半另有判据**：`tests/client/canvas/card-aspect.spec.ts`（12 项，全部读源码文本——这一段是 `Image` / `document.createElement('video')` / `useEffect`，node 下跑不起来，而**为它套一层假 DOM 只会让真机上才有的失败过去**）。验四件事：① 量的是浏览器算好的数（`naturalWidth` / `naturalHeight`、`videoWidth` / `videoHeight`，视频必须先 `preload = 'metadata'`）；② 音频不给比例、宽或高为 0 就答「没量到」、解码失败也是（两个 `onerror`）；③ 阈值守卫在写入**之前**（顺序反了等于没守卫）、同一张卡同一份载荷只量一次、写失败安静放着；④ 接线（`card-tile` 传齐六个参数、`bridge → remote → typert → contract` 四处同名同参）。**三处变异逐条验红**：卡面漏传 `card.aspect` ⇒ 接线条红（真机后果是每刷新一次写一次）；删掉阈值守卫 ⇒ 阈值 + 顺序两条红；图片读 `image.width`（CSS 宽）而不是 `naturalWidth` ⇒ 量法条红。

**变异逐条验红**：卡高改回 280 ⇒ 一档 + 比例两条红；`CARD_HEAD_HEIGHT` 差 2px ⇒ 一档 + 对账两条红；`cardSizeOf` 恢复 `kind` 参数 ⇒ 「不收形态」条红；`CARD_WIDTH` 改成 200 ⇒ 一档 + 兜底值两条红。v1.80 的三处也逐条注回：`cardSizeFor` 忽略传入的 `aspect` ⇒ 3 条红；`board.ts` 的 `sizeOf` 忽略 `aspect` ⇒（见下）1 条红；`board-file.ts` 的 `parseBoardFile` 丢掉 `aspect` ⇒ 1 条红。

**「精度 2」是变异教出来的**：比例那条最初写 `toBeCloseTo(ASPECT, 1)`（容差 0.05），把面板宽改成不减边框（高度差 1px、比例差 0.009）时它**照样绿**。改成精度 2（0.005）之后同一变异精确命中——而那 1px 正是用户抱怨的量级。凡「近似相等」的判据，容差要按**用户能看见的最小差**定，不能按好过定。

**「排位按各自的高」那条判据第一版是假绿**（v1.80，比上面更值得记）：初版拿 `grid` + 三张卡验，把 `sizeOf` 改成忽略 `aspect` 注回去，20 项**全绿**——因为网格默认两列，高卡与后一张的 `x` 本来就不同、矩形本就不相交，判据测的是「结果看起来合理」而不是「这条通路真的被走过」。换成 `source-chain`（没有引用时全部 depth 0、同列竖排）+ 两高两矮四张卡，断言写成**逐对差值** `下.y - 上.y === 上.height + gap`（不依赖排位顺序），同一变异精确命中。回滚后必须先确认原始仍绿、再重新注入验红——否则会把自己上一轮的残留当成新红。

**门禁的基线跟着漂**：v1.80 给 wire 加了一个参数（`P.aspect`）与一条 invocation，tsc 因此从 155 涨到 159、tsc-tests 从 158 涨到 162。涨的这 4 条**全是同一句漂移**（本机 `@deepseek-ai/*` 是 0.1.5-rc.2，`TypertCodec` 缺 `schema`；每个 `P` 条目、每次 invocation 各带一条），没有一条提到 `aspect`。判干净的办法是把新增那几行临时删掉再跑：错误**精确回到 155**（那次多出的第 156 条是 `TS2740: Type '{}' …`，手删时留下的空对象，不是真错），且消息类别分布只差这几条。基线是「本机的」不是「仓库的」，改契约条目就会动它。

测试自身还踩过两个坑：`Source` 必须带 `project`（tsc-tests 从 158 涨到 162），以及 `card-overlay.tsx` 里已有一个 `size`（同作用域的 ComposerSize）⇒ 新变量改名 `cardBox`（tsc 155 → 161，逐条比对才定位到）。

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

### 产物按类型分目录：一层壳，四个入口，一份名单（F1.13，v1.84）

产物原先全平铺在项目根上。现在每一种形态有自己的目录：`docs/` `apps/` `designs/` `images/` `videos/` `audio/` `data/` `files/` `folders/`。技术上它只改一件事——卡片记录的 `file` 多了**一层前缀**（`图片.png` → `images/图片.png`），所以 `cardNameOf`、改名、打包、预览、导出这些「按路径推产物是谁」的地方一行都不用动。

**名单只有一份**：`core/canvas/artifact-folders.ts` 的 `ARTIFACT_FOLDERS`（键是**折算后**的 kind id，所以老记录上的 `site`/`webapp` 也落 `apps/`），四个入口都从它取——建卡（客户端 `freeCardName`/`freeFolderName` 挑名字、`artifactPathOf` 拼路径）、脚手架（宿主 `scaffoldWebapp`/`scaffoldDesign`）、迁移（`planFolds`）、扫描（`scanProject` 把类型目录当透明壳）。任何一处自己拼字符串，漏掉的那一类产物就继续平铺在根上，**不报错**。

**目录可能还不存在**：缝的 `writeText` 只负责「把内容发布到这个 target」，父目录不在就是 `ENOENT`——一张新卡的种子文字会当场写不进去。所以 `ArtifactIo.ensureFolder`（与 `writeBytes` 里那行 `mkdir` 同一条守卫：`contains` + 只读 + `processPathOf` 回证）在 `write` 与 `writeScaffold` 之前把目录建出来；另一个执行世界则原样放手。

**老画布的整理是「读板时的一次惰性迁移」**：`readBoard` 先调 `foldArtifacts`、再算卡片，于是这一趟读出来的就是搬完之后的路径。三层都尽力而为——`planFolds` 纯（「哪个根条目搬到哪」）、`applyFoldPlans` 逐条容错（撞名 `-2` 起、一件失败不影响其它）、外层再 catch 一次（只读部署记一行日志，板面照画）。每个进程只跑一次，值存在 `Map<ProjectId, Promise<void>>` 里而不是布尔：两个座位会同时画同一张板，第二次必须**等**第一次搬完，而不是看着半搬的状态去算卡片；失败则从表里删掉，下次画板再试。

**迁移的单位是「根上的一个条目」，不是一张卡**：应用卡的 `file` 是 `dsh-canvas-应用/index.html`，只搬入口页会让 `styles.css` 与 `app.js` 留在原地。所以按 `file` 的第一段分组，整块 `renameEntry`，再把**所有**落在它下面的记录用 `foldedPathOf` 改前缀（按路径段比对，`图片.png.bak` 不跟着 `图片.png` 走）。

四样刻意不搬：根上的 `index.html`（整张画布就是它的产物）、同一根条目下形态不一致（`mixed-kinds`：搬成谁的都会拆散另一个）、没有对应目录的自定义 kind、已经在类型目录里的条目（`already-folded`——迁移因此可以反复跑，也不会越搬越深）。

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

### 媒体卡：〔导出〕就是把那份产物原样交给浏览器（F10.1，v1.83）

用户原话：「实现图片，视频，音频卡片的导出功能」。此前这三种卡**没有一条真能用的导出**：图片卡上那枚〔导出〕走的是部署能力那条线（`bridge.exportCard` → `capabilities.export`），在没有 `dsh-canvas.capabilities` 的部署上点一下得到的是 `{ ok: false, reason: '部署未提供导出能力' }`——一份**答案**，而画布那条 `run()` 只接异常，于是症状就是「点了没反应」；视频与音频的类型表里 `exportFormats` 是空的，连那枚按钮都不出现。

**含义只有一种：原样拿走。** 媒体卡的产物**已经是一个文件**（`file` 指向磁盘上那份 jpg / mp4 / mp3），所以导出不是转换——把 jpg 重编码成 png、把 mp4 再封装一遍，是用一次画质损失换一个用户没要过的东西。于是第五支通道（`export-plan.ts` 的 `media`）只做一件事：把那份字节交给 `download.ts` 那一次 `a[download]`。

**分派位置是有讲究的**：`isMediaKind(kind)` 那一支必须排在「取类型表第一个格式」**之前**。图片的 `exportFormats` 是 `['png', 'svg']`——那是**部署那条线能把它转成什么**（`canvas_export` 工具仍在读这一格），不是这枚按钮该做的事。排在后面，图片卡就会继续落到那个没有实现的部署能力上。

| 环节 | 落在哪 | 为什么 |
| --- | --- | --- |
| 字节 | `readArtifact`（`dataUrl` 是 `data:<mime>;base64,…`） | 与全屏预览、卡面**同一条读法**：能看与能导不会分家（同一个上限、同一副 data URL 形状、「还没生成」同一套语义） |
| 解码 | `media-export.ts` 的 `decodeDataUrl`（`atob` + `charCodeAt`） | 不再 `fetch(dataUrl).then(r => r.blob())` 一趟：那是让同一段字节在浏览器的网络栈里再走一遍 |
| MIME | 从 data URL 头里取，空则退 `application/octet-stream` | 扩展名与真实类型可能不一致（`.m4a` 里装的可能是 aac），头里那个是宿主 `mediaMimeOf` 判过的 |
| 文件名 | `mediaExportNameOf(卡片名, 产物路径)` | **卡片可以改名，产物路径不会跟着改**：把旧文件名原样塞回去，用户会以为改名没生效。词干清洗复用 `fileStemOf`（与控制带改名同一条规矩），扩展名保留磁盘上的大小写 |

**上限只有一处，客户端不抄**：`VIEW_BYTES_CAP` 住在宿主，`ArtifactView.truncated` 是它唯一的出口。`mediaExportPlanOf` 看到旗子就回 `truncated`，**一份字节都不给**——`truncated` 时宿主本来也不给 `dataUrl`，但这一条要挡的正是「举了旗却还有半份字节」：信字节就会导出一个放到一半断掉的 mp4，而提示条那时正写着「已导出」。半份比不导更坏，与文本导出、打包是同一条规矩。超上限的下一步写在文案里（产物就在画布目录里，可以直接取），而不是留一句「失败」。

**没有选择「宿主复制到下载目录」**：IO 层的每一次写都在项目根之内（`contains` 那条守卫），跨出画布根去写用户的 `~/Downloads` 会破坏那个不变量；而浏览器下载本来就是这条通道该做的事，也不必为此新增一条 wire。

四种收场（`mediaExportNotice`）：`ready` 一句「已导出 x」（与文本导出**共用**同一句文案——对用户是同一件事）、`absent` 与 `truncated` 是 `warn`（被拒不是出错）、只有「内容读不出来」（data URL 不是那个形状）配 `error`。

**变异七处，逐条验红**：删掉 `isMediaKind` 那一支 ⇒ 分派 2 条红；只看空 `dataUrl`、不看 `truncated` ⇒ 行为 1 条 + 源码 1 条红；下载名改用产物词干 ⇒ 3 条红；`downloadBytes` 去掉 `ready` 条件 ⇒ 接线 1 条红；`atob` 之后不填字节 ⇒ 字节比对 1 条红；`truncated` 的口气改成 `ok` ⇒ 1 条红；扩展名转小写 ⇒ 1 条红。其中**第二条第一次只红了一条源码判据**——夹具当时把 `truncated: true` 与空 `dataUrl` 写在了一起，两件事互为掩护；把夹具改成「举旗但字节还在」之后同一变异精确命中行为那条。

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

CI：`.github/workflows/release.yml`，**由 tag 触发**（`v*`；另有 `workflow_dispatch` 供重试）。流程是 `pnpm install --frozen-lockfile` → `pnpm run check` → `npm stage publish`，Node 22 + `pnpm/action-setup`（版本读 `packageManager`），并把 npm CLI 显式升到 **≥ 11.15**——Node 22 自带的是 npm 10.x，`stage` 子命令在那里不存在。

发布分两段，这是有意的：**CI 只提交审核，上线要人放行**。`npm stage publish` 把包送进 npm 的 stage 队列（不需要 2FA、任何 token 类型都行），维护者再用 `npm stage approve` 或 npmjs.com 的 Staged Packages 标签页带 2FA 批准，版本才真正可安装。因此 workflow 顺手建的是**草稿** Release——staged 版本此刻用户还装不到，发正式 Release 会指向一个不存在的版本；批准后再把草稿发出去。本地 `pnpm release`（release-it）只做 bump / CHANGELOG / 打 tag / push，`npm.publish` 保持 `false`。

`npm stage` 的两个硬前提：npm CLI ≥ 11.15.0、Node ≥ 22.14，且**包必须已存在于 registry**（全新包走不了 staging，本包已在，无碍）。

安装与调试：

```sh
pnpm install && pnpm run build
dsh plugin --profile web add .              # 本地目录安装
dsh plugin --profile web add https://github.com/ljcoder2015/dsh-canvas-flow   # 从 Git 安装（会跑 prepare 构建）
dsh plugin --profile web remove dsh-canvas-flow
```

Git 安装时 pnpm ≥10 会拦截 `prepare` 构建，需按 `dsh` 的提示在该 profile 的 `pnpm-workspace.yaml` 里加 `allowBuilds: { 'dsh-canvas-flow': true }`——**该授权允许包在安装时执行代码，只对可信来源开放并锁定 commit**。开发期把包加进工作区软链后，`dsh-client-hmr` 会轮询客户端 bundle 变化并热重载（仅 sourcemap 变化不触发），Host 侧改动需重启 Web Harness。

#### 「代码改了但界面没变」的第一站：先问清实例读的是哪一份包

运行中的 Harness 加载的是**它自己 profile 里**的那一份（`~/.dsh/profiles/<名字>/node_modules/dsh-canvas-flow`）。`dsh plugin add` 装进去的是一份**快照**——`pnpm build` 改的是工作区，与那一份毫无关系，而界面上不会有任何提示。本项目自己就撞过一次：三个新节点入口（图片 / 视频 / 音频）在源码里齐全、产物里也齐全，界面上一个都不显示，因为实例读的是半年多前 npm 装下的那份旧快照。两条命令就能问清楚：

```sh
ls -la ~/.dsh/profiles/web/node_modules/dsh-canvas-flow   # 期望 lrwxr-xr-x 指向工作区；实体目录 = 快照
grep -oE 'canvas\.dock\.[a-z]+' ~/.dsh/profiles/web/node_modules/dsh-canvas-flow/lib/client.js | sort -u
```

第二行是**数一数**：把那份产物里的 dock 键与源码里 `DOCK_SPECS` 的项数对上，对不上就是没接上（`canvas.dock.*` 是 ASCII，可以直接 grep；中文串在 esbuild 产物里是 `\uXXXX`，搜不到不代表没有）。开发期的做法是**把 `node_modules` 里那一格换成指向工作区的符号链接**——只动 `node_modules`，不动 profile 的 `package.json`，也不跑 installer（免得把 profile 弄坏）；之后客户端半就吃 HMR 了，**Host 半仍要重启**（新增的工具与 Config 字段不会自己出现）。

> ⚠️ **符号链接只是开发期的临时覆盖，profile 自己那条依赖还在。** `~/.dsh/profiles/web/package.json` 写着 `"dsh-canvas-flow": "^1.0.2"`，而 npm 上最新发布的是 **v1.0.3——它早于 `3ccb100`（这次 `standingKeyFor` 的修复），也就是带着那个 bug 的版本**。任何一次 `dsh plugin add/update` 或 `pnpm install` 都会把符号链接换回一份 npm 副本，界面于是退回旧行为。**修复发布出去（下一个 `1.0.x`）之前，别对这份 profile 跑安装类命令**；要恢复成正式安装，先确认 npm 上那一版已经包含该修复。

#### 按名取上游服务：每个成员都要能在上游声明里逐字指出来

`ctx.get('<名>')` 拿到的是**运行时按名**的面：类型系统看不见它，构建不会红，单测里那份「照猜的样子捏的假对象」还会是绿的。猜一个上游没发布过的成员，只会在真机上抛 `face.<名> is not a function`——本项目为此付过两次账，最近一次是 `standingKeyFor`（issue #1：所有带 preset 花名册的部署上，每一段卡片会话全死，而本地全绿）。

判据因此不是「跑通了」，而是**每个成员都要能在上游自己的声明里逐字指出来，且没有多一个**。这件事现在有一条命令：

```sh
node .workbuddy/verify/face-audit.mjs        # 13 个面 / 22 个成员
```

脚本读部署里**上游真包**的 `lib/types/index.d.ts`（默认 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`，可用 `DSH_UPSTREAM` 覆盖），把我们每个面声明的成员与上游类体对账：上游没有的成员 ⇒ 打印「真机会抛 `face.<名> is not a function`」并以退出码 1 收工。**换 harness 版本后重跑一次**：上游删掉的成员，我们的面必须同一时间删掉。

两个已知的取证坑写在脚本注释里：上游成员声明的缩进是 4 空格；类体里会出现 `Omit<…, 'wire'> & {` 这种**跨行的类型字面量花括号**，「遇 `}` 就收工」会提前掐断（第一版就是这么丢掉 `stateOf` 的，差点当成缺陷报出去）。

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
| 会话创建     | 「创建卡片时自动创建独立会话」                                                           | `ctx.sessions.create()` 归调用方 fiber；**不落盘**，必须经 agent 生命周期事务。**代价要在界面上接住**：卡片可以先于它的会话存在——新座的 `sessionId` 是空串，一直等到有人用它（点「对话」、发一句话、拉一份材料）。所以凡是要往会话上写东西的地方都**不能拿「有没有会话」当启用条件**，否则那个控件在刚建的卡片上永远是死的。模型席位就撞过这一下（v1.71）：它写的是 `disabled={sessionId === ''}`，于是新建的图片 / 视频 / 音频卡片上那颗下拉框按不动；现在这条判断收在 `client/ui/model-seat.ts`——有会话就写进它、没会话而卡片定位得到就**先开再写**、连卡片都定位不到才禁用，是一条能单独验的规则。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | P0 的会话绑定需先打通 agent 工厂，工作量重估                                                                                                                                                                                                                                                  |
| 会话隔离     | 靠 system prompt 约定                                                        | 工具注册作用域 + `restrict` / `schemas(scope)` 的可见性过滤                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 隔离可被结构性保证，不必靠提示词                                                                                                                                                                                                                                                             |
| 引用注入     | `agent.inject()` 抽象调用                                                     | `agent.inject({ content, source: { kind: 'plugin', plugin } })`，追加持久化上下文但**不唤醒空闲 agent**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 响应策略（F5.7）需自行决定用 `inject` 还是直接发起轮次                                                                                                                                                                                                                                           |
| 连线底层     | 「读上游产物摘要」                                                                 | **改用 Harness 自己的 `@file` 文件引入**（v1.37）：边的一端是产物文件、另一端是会话，插件把上游产物**以工作区相对路径命名**（`@brief.md` / `@"my brief.md"` / 目录 `@site/`，逐字节复刻宿主语法），模型按需 `read`；产物摘要**并列保留**（不是回落）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 引用不复制内容 ⇒ 不会失效、不占预算、不被截断、无缓存失效时机；摘要仍负责「立刻把材料摆到眼前」（`read_sources` / `inject_card` / F5.7 `pull`）                                                                                                                                                                              |
| 文件访问     | 直接 `fs.read`                                                              | `ctx.fs.*`（统一 seam，带版本守卫、沙箱策略、写前 waterfall）；**v1.53 起有唯一一处例外——「改名」**：seam 只有 `writeText` / `editText`，没有 rename 动词，于是改名走 `ArtifactIo.renameEntry` 直调 `node:fs/promises.rename`，同时把 seam 原本提供的保证**在本地复刻**成三道闸：源与目标都过 `fs.contains(boundary)`；目标沙箱策略是 `read-only` 直接拒（`FS_SANDBOX_DENIED`）；`processPathOf` 证明两端的宿主路径来回映射回**同一个** `targetKey` 才动手（证明不了就 `FS_NOT_OBSERVED`）                                                                                                                                                                                                                                                                                                                                                              | 编辑回流与冲突处理有现成挂点；越过 seam 的只有改名一处，且守卫不减——缺的是动词，不是沙箱/远程场景用不上                                                                                                                                                                                                                     |
| 设计稿的容器尺寸 | 预设只给「一屏」的规格（手机屏 375×812、**官网首屏** 1440×900、海报……），模型于是按屏产稿                  | **v1.55 起：宽度取菜单、高度随内容**（`DESIGN_PRESET`，`src/host/prompt.ts`）——菜单给**宽度**（手机 375 / 平板 834 / 桌面 1440）与「固定规格、整块给出」的那几项（海报 1242×1660、社交方图 1080×1080、幻灯片 1920×1080、横幅 1920×600），并明说网页与应用是**一个容器一整页**：多屏才看得完的内容在同一个容器里连续排下去，**禁止**拆成「首屏 / 第二屏 / 第三屏」，要多容器只在用户点名多屏并排（多屏对比 / 流程走查）或交付物本身是序列（幻灯片的每一页、海报系列）时                                                                                                                                                                                                                                                                                                                                                                                                                                   | **分屏是产出侧的规矩，不是渲染器的行为**：画布与预览本来就把全部容器摆在同一条可平移的画布上（`design-render.ts` 的 `fitTransform` 按 `documentBounds` 取景、可平移可缩放），所以这条只在预设里校准，客户端一行不用改                                                                                                                                      |
| 目录结构     | `ui/` + `tools/` 平铺                                                       | `src/` 根＝入口 + 协议基座；`src/host/`（装配与 Remote 服务）、`src/core/{canvas,artifact,session}/`（纯逻辑）、`src/client/{wire,canvas,artifact,ui}/`（浏览器半），其中 `client/artifact/` 再分 `registry.ts` + `chrome.tsx`（插槽与两条登记通道）+ `viewers/` + `editing/` + `element-pick/`（v1.40 分层，v1.41 细化产物面，v1.42 把能力从注册表挪进各预览器）；`tests/` 镜像之                                                                                                                                                                                                                                                                                                                                                                                                                            | 依赖层落成目录，非法依赖（`core/` → `host/`）看得见；两个构建入口路径不动，打包与清单不受影响。产物面按「一行一个预览器，能力长在预览器自己身上」再分，加一种形态不必回头改弹窗                                                                                                                                                                             |
| 图片 / 视频 / 音频节点 | 列在「后续」（多模态生成交部署能力统一产出，插件不自带后端）                                                                                       | **v1.70 落地**：三种节点与文本 / 设计节点**同构**（会话驱动 + `canvas_generate_image` / `_video` / `_audio` 三个工具），生成由插件自带的默认实现 `MediaProvider`（`src/host/media-provider.ts`）供给，**路线与凭证从 DSH 自己的模型配置里读**（`llm-pi-ai.providers.<route>`，按模型族指纹挑 `seedream` / `seedance`），部署若实现了 `dsh-canvas.capabilities` 就覆盖它；音频只做节点、预览、引用与素材通路，**生成留缝**（火山语音是另一套鉴权）。详见 §五「媒体生成」                                                                                                             | 「媒体」由此不再是画布上的二等公民：入口（dock 三项）、形态认定（三个 kind）、预览（三个预览器）、引用与素材通路、会话提示词全都到位，**只剩「谁来真的画出来」这一格按部署能力开关**。代价是插件多知道了一点部署的配置形状（模型路线与凭证引用），所以读取一律**先验后用、读不懂整条丢掉**，且没有那两条宿主面时只是这三条能力不可用、不是插件加载失败                                                                                                                              |
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
11. **媒体生成依赖部署的模型路线**（v1.70，F2.7）：三条生成缝的默认实现从 `llm-pi-ai.providers` 里按**模型族指纹**找路线（`seedream` → 图片、`seedance` → 视频），所以**一份没配这两条 provider 的部署上，图片 / 视频节点照旧能建、能预览、能引用、能进会话，只是生成会如实报「没有可用的路线」**（`noRouteReason` 那句话会把「想要什么 / 按什么找 / 现在有哪些路线」一起说清，这是有意写成能让人动手的形状）。本机实测：现有的 `gw` 网关（`api: openai-responses`）对 `/images/generations`、`/contents/generations/tasks` **一律 404**（音频连试都不用试：它从来不走网关那条主机，见 §五「音频：第三个产地」）——这不是配置写法的题，是**后端能力**的题；在模型配置里加一条 `doubao` 走火山方舟（`https://ark.cn-beijing.volces.com/api/v3`）即可真调用 Seedream / Seedance，插件侧一行都不用改。**本机已加（2026-10-16）**：`doubao` 路线（火山方舟 `baseURL` + `apiKeyEnv: DOUBAO_API_KEY`，模型 `doubao-seedream-5-0-flash-260915` / `doubao-seedance-2-0-mini-260615`）——两个指纹都命中，图片与视频这两条已就绪。注意 `routes.ts` **不读 `api` 字段**，所以那条路线上写着 `api: openai-completions` 不构成任何阻挡。音频那一条在**本机配置**里仍没有指纹可命中（没有任何路线声明 `seed-audio` 模型），因此会如实报「没有可用的路线」；但**v1.82 起它有真实现**——加一条带 `doubao-seed-audio-1-0` 的路线即可用，只是主机与鉴权都与方舟不同（§五「音频：第三个产地」）。同一条上还有两处边角：①**媒体预览受 `VIEW_BYTES_CAP`（16MB）限制**（`src/core/artifact/io/artifact-io.ts`）——超了走兜底预览并如实标记 `truncated`，不截断、不静默（**v1.72 起这句话直接写在卡面上**：`media-face.ts` 的 `too-large` 态与全屏预览共用同一批文案，见 §五「媒体卡面」）；视频节点因此对「手边一段大片子」不算好用的预览器（生成出来的短片没这个问题）。②**音频的密钥是另一套**（v1.82 已接上，见 §五「音频：第三个产地」）——同一个厂商的两个控制台，`X-Api-Key` 与方舟的 Bearer 不是一把 key；一条路线上声明了音频模型却没配语音 key 时，401 的文案会直接点出这件事，而不是留一句状态码。
