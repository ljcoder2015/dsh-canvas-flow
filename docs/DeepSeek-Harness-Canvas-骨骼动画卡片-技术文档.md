# 骨骼动画卡片 · 技术文档

**版本**：v2.0（方案评审稿，未动代码；v2.0 改道：编辑器 vendor Rigby2D，推翻 v1.0 自研扩展路线）
**日期**：2026-11-11
**需求侧**：[`DeepSeek-Harness-Canvas-骨骼动画卡片-需求文档.md`](./DeepSeek-Harness-Canvas-骨骼动画卡片-需求文档.md)（RI1–RI6、复用清单、不做清单、里程碑）
**上游**：[Rigby2D](https://github.com/jaisurya-dev-art/rigby2d) v0.5.1（MIT OR Apache-2.0；`private: true` **未发 npm**，无 library 入口——集成的唯一路是 vendor fork）

## 〇、一句话结论

编辑器整只换 Rigby2D：上游以 vendor 目录进仓、裁掉桌面壳与重型依赖、它自己的 vite 产出静态包，宿主 assets 路由分发（设计预览器的 CanvasKit WASM 先例），iframe 挂进现有全屏预览器的编辑档。**fork 差异只写在一层桥（bridge）里**——打开/保存/贴图三向接我们的工作区与保存纪律；产物升 v3（外壳 + 内嵌其原生项目）；卡面播放换它的 JS runtime；生成侧保留并落 v3。自研 skeleton2d-lite 六模块退役为「旧格式迁移读取」。**不许改上游核心逻辑**——改核心 = 永远追不动上游。

## 一、上游形态与集成面（2026-11-11 摸底）

| 事实 | 对集成的影响 |
|------|------|
| `private: true`、无 `main`/`exports` library 入口 | 不能 npm 引；vendor 目录 + 自己维护构建 |
| 编辑器 web 版可独立构建（`vite build --base=/editor/`，部署形态 rigby2d.com/editor） | 静态包路线成立；Tauri 只是桌面壳，web 构建不依赖它 |
| `src/core` 纯 JS ESM 零框架（model/animation/constraints/meshgen/autorig/pose/retarget/atlas/interop…），`node --test` 直测 | core 可以被我们的生成侧**当库调**（autorig）；判据思路可对照 |
| `src/editor` vanilla JS + i18n（简中完整）+ `index.html` | 无 React——iframe 嵌入是唯一现实路（React 包壳 vanilla 全屏应用得不偿失） |
| 依赖：tauri 全家桶、pyodide、@huggingface/transformers、ag-psd；pixi 仅 devDeps（runtime 用） | 裁剪清单明确：tauri 插件 / pyodide / transformers 全剥；ag-psd 保留（PSD 导入是复用功能） |
| runtime 独立构建（`runtimes/`：phaser/pixi/cocos，另有 JS runtime） | 卡面播放器用它的 JS runtime，独立小包，与编辑器包分开 |
| 自带 MCP server（`bin: rigby2d-mcp`，inspect/rig/animate） | 我们是会话引擎原生——生成走自家工具链（RI5）；它的 MCP 不引入（见 §七） |

## 二、目录与构建

```text
vendor/rigby2d/            # 上游 subtree（git subtree add --prefix=vendor/rigby2d …），记上游 commit
  └── （原样，不改动核心文件）
tools/rigby2d-build.mjs    # 裁剪构建：调上游 vite（build 目录指点到 dist/rigby2d-editor/），
                           # 剥 tauri/pyodide/transformers（alias 置空桩 + 特性开关），产静态包
src/client/artifact/
  viewers/skeleton2d/      # 现有 stage/viewer 保留（旧格式卡面 + 迁移读取）
  skeleton2d-editor-host.tsx   # 新：React chrome 侧 iframe 宿主（挂载、桥协议、生命周期）
src/host/
  assets.ts                # 扩一条静态路由：/dsh-canvas/rigby2d-editor/* → dist 静态包（只读，
                           # 照 workspace-assets 的穿越/normalize 安全纪律；单段路径放行）
```

- `build.mjs` 增一步：`tools/rigby2d-build.mjs` 产物 copy 进 `lib/assets/rigby2d-editor/`（与 CanvasKit WASM 同一条 assets 分发路）。
- **懒加载**：编辑器包只在用户切到「编辑」档时由 iframe 拉取——不在 client.js 首屏 bundle 里，体积红线（< 8MB，实测后钉值）由构建判据把关。
- Node ≥ 20 上游要求；本仓构建环境满足。

## 三、桥（fork 里的唯一差异面）

fork 内新增 `src/bridge/`（上游代码不碰），iframe 内外两层 + `postMessage` 协议：

```text
宿主（React chrome）                    iframe（Rigby2D 编辑器 + bridge）
  │ open: 读产物 v3 → 外壳校验 → rigby 段 + 贴图 URL（工作区路由） ──▶ 载入项目
  │ save: ◀── 编辑器保存事件（防抖 600ms，同我们现有纪律）
  │         校验 rigby 段 ──▶ 外壳回填（format/version/引用） ──▶ writeText 落盘
  │ dirty: ◀── 脏标记（关档前拦截未保存改动——沿用编辑器浮层的老规矩）
  └ unload: 冲刷在途保存（「卸载冲刷」纪律）
```

- **贴图映射**：Rigby2D 项目内部的贴图引用在打开时由桥改写成工作区路由 URL、保存时映射回相对路径——引用即数据不破（贴图照旧是普通图片文件，删了模型才坏，坏法与 markdown 坏图一致）。
- **保存四步纪律照搬**：防抖写 + 卸载冲刷 + 写后 invalidate 缓存 + 回读 adopt（live2d 编辑器「保存不生效」的教训是同一条链）。
- **加载失败诚实**：桥握手超时/协议不匹配 → 编辑档显示明确错误态，不静默白屏。

## 四、产物格式 v3（`.skeleton2d.json`）

```jsonc
{
  "format": "dsh-skeleton2d",
  "version": 3,
  "texture": "art.png",          // 相对路径引用（外壳字段，桥负责映射进编辑器）
  "rigby": { /* Rigby2D 原生项目数据，整段透传，本仓不解读内部结构 */ }
}
```

- **外壳是本仓的**（format/version/texture），`rigby` 段**原样透传**——上游改内部 schema 我们零成本跟随；kind 检测（`.skeleton2d.json` 双扩展名）、`ARTIFACT_FOLDERS` 分目录、引用扫描全部不变。
- **v1/v2 → v3 迁移**：编辑器打开旧格式时一次性转换——v2 参数化动作（正弦三组 + 逐层关键帧）**烘成关键帧**（12fps，正弦整周期数学保证循环处闭合）；迁移有损（参数滑杆没了），桥先弹提示、用户确认才落盘。`layerize.ts` 的分层结果直接映射为 rigby 的层结构。
- 归一纪律：v3 的归一只管外壳字段；`rigby` 段不归一、不解读、只透传校验（是对象即过）。

## 五、卡面轻播放

- **v3 产物** → vendor 上游的 JS runtime（独立构建，MIT）打包进 client，卡面循环播放；体积远小于编辑器包，且与编辑器**两份独立产物**（卡面不拖编辑器的重量）。
- **旧格式** → 现有 `skeleton2d-stage`（WebGL1 CPU 位移）继续伺候，直到该卡迁移。
- 播放头纪律：卡面按卡片生命周期节流（不可见暂停——现有 live2d/viewer 的挂载纪律直接复用）。
- 判据：同一 v3 产物，卡面播放画面与编辑器预览画面一致（同一份数据、两套渲染器，**接线断言**钉住关键帧采样路径）。

## 六、生成侧（保留并改造）

- `canvas_generate_skeleton2d` 工具保留；`layerize.ts`（确定性剪影分层）保留——它是「一张图 → 分层贴图」的预切，产出直接喂 vendored `core/autorig.js`（MIT，当库调）出初始 rig。
- 落点改 v3：生成 = 外壳 + rigby 段（初始 rig + 默认待机动画）——**用户在编辑器里直接可调，不用先手动装配**。
- AI 深改（改参数、加动作）：第一期靠编辑器（人操作）；上游 MCP server（`rigby2d-mcp`，inspect/rig/animate）是现成的 AI 通道，第二期评估作为宿主侧工具接进卡会话——**本期不做**（会话工具面与 MCP 桥是两套进程模型，先跑通编辑器主链）。

## 七、裁剪清单（为什么这些剥掉）

| 上游能力 | 裁决 | 理由 |
|------|------|------|
| Tauri 壳 + 全部 plugin-* | 剥 | 桌面特性，宿主是浏览器插件 |
| pyodide（Python 插件沙箱） | 剥 | 十几 MB WASM，编辑器功能不依赖它 |
| @huggingface/transformers（Whisper 口型） | 剥 | 本地 ML 推理，卡场景不需要；将来要口型走会话侧 |
| ag-psd（PSD 导入） | **留** | AutoRig 分层 PSD 是复用功能的一部分 |
| film 工作区 / 场景合成 | 代码留、入口藏 | 裁代码动静大且有回归风险；藏入口零成本，评审后再定去留 |
| Spine `.skel` 二进制导出 | 入口关闭 | 许可自担路径；JSON 导出够用 |

## 八、fork 升级策略

- vendor 上游 pinned 到 tag（如 `v0.5.1`），`vendor/rigby2d/FORK.md` 记：基准 commit、差异文件清单（应当只有 `src/bridge/*` 与构建配置）、升级步骤（subtree pull → 桥协议对齐 → 判据全跑）。
- **判据防线**：桥协议消息形态、外壳字段归一、保存链四步、卡面/编辑器一致性——这些判据在每次升级时全量重跑；上游核心行为变化由「反算比对」类判据兜住。
- 上游活跃（近期日更）；升级节奏手动、按需，不自动追。

## 九、许可与合规

- 双许可（MIT OR Apache-2.0）按上游文件随附；本仓 THIRD_PARTY 清单登记 vendor 目录。
- 界面标注「编辑器基于 Rigby2D（开源许可）」；**不使用 Rigby2D 商标做我们的功能宣称**。
- 不触碰其 clean-room 的 Spine 二进制实现出口（§七）； DragonBones 路线与上游同源，无新增许可负担。

## 十、判据清单（M1–M4 出口的可验收定义）

| 里程碑 | 判据 |
|------|------|
| M1 | 一条命令产出含静态包的 lib；裁剪后编辑器在宿主路由上可独立打开；体积 < 红线 |
| M2 | 桥打开/保存/贴图三向判据；v3 外壳归一判据；v1/v2 迁移有损提示判据；保存链四步（防抖/冲刷/invalidate/adopt） |
| M3 | 编辑档换 iframe 接线断言；卡面 runtime 播放 + 卡面/编辑器一致断言；生成落 v3；门禁六道绿 |
| M4 | 旧格式只读迁移路径；THIRD_PARTY 登记；FORK.md 差异清单核对（差异只在桥与配置） |

## 十一、风险

- **体积**：编辑器全量包可能数 MB——懒加载 + 裁剪（pyodide/transformers 是大头）；实测超红线再谈功能开关。
- **上游追不动**：最大风险。防线＝差异只许在桥、pinned tag、判据全量重跑；若上游破坏性重构（协议/数据形状），冻结旧版本维护（fork 自持）比追新更便宜——届时再评审。
- **迁移有损**：v2 参数化动作烘帧后失去滑杆微调能力——提示 + 保留旧文件不改写原产物（迁移另存新卡）可回退。
- **React 外包 vanilla 应用**：iframe 隔离了 CSS/事件冲突，桥协议要处理时序（iframe load 后握手），握手失败明确报错不白屏。
- **打包器冲突**：上游 vite 8、本仓 esbuild——**两套构建互不介入**（编辑器包由上游 vite 出、本仓只 copy），不许把上游源码喂进 esbuild bundle。
