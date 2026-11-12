# Rigby2D vendor fork 记录

上游：https://github.com/jaisurya-dev-art/rigby2d（MIT OR Apache-2.0，SPDX 头在各文件）
基准：`develop` @ `fa619fb71faabe6e0e8512813d3f265f4dc88cdc`（2026-11-10，经 gh-proxy.com clone；GitHub 直连被网络策略挡）。
日期：2026-11-11（上游当日仍在日更，追新节奏手动、按需）。

## 取材范围

只取：`src/`、`runtimes/`、`test/`、构建配置与许可文件。**未取**：`branding/`（商标与图标，许可不含）、`site/`、`src-tauri/`（桌面壳）、`docs/`、`examples/`、`.github/`。

## fork 差异清单（必须保持最小；动上游核心 = 永远追不动上游）

| 文件 | 差异 |
|------|------|
| `src/editor/bridge/hostbridge.js` | **新增**。dsh-canvas 桥：iframe 与宿主（React）的 postMessage 协议，`bridgeFs`（可写版 memoryFs），`installHostBridge(app)`。 |
| `src/editor/main.js` | 两行：import 桥 + `installHostBridge(app)`（紧跟 `const app = new App()`）。 |
| `src/editor/demo-sources-embed.js` | **新增**。`@demo-sources` 的空桩（上游该文件是 gitignore 的构建期产物）。 |
| `src/editor/transformers-stub.js` | **新增**。`@huggingface/transformers` 桩（口型同步不启用，whisper.worker 的静态 import 需要它编译过）。 |
| `vite.config.bridge.js` | **新增**。嵌入构建：去 pyodide 资产插件、两个 alias 桩、只打 index.html、`base:'./'`、outDir `dist-embed`。 |
| `package.json` | dependencies 删 `pyodide`、`@huggingface/transformers`（构建已桩掉，体积不可接受）。其余原样。 |

## 升级步骤

1. 拉新上游快照（GitHub 直连被挡时的通道：jsdelivr `data.jsdelivr.com` 文件树 + `cdn.jsdelivr.net` 逐文件；tag 解析失败就用分支名）；
2. 按「fork 差异清单」重放差异（只有两个 stub + 一个新文件 + 两行 main.js + 构建配置，机械操作）;
3. `npm install && npx vite build --config vite.config.bridge.js`；
4. 重跑判据：桥协议形态、v3 外壳归一、保存链四步、门禁六道。

## 不触碰

- Rigby2D 商标（界面只标注「编辑器基于 Rigby2D (MIT OR Apache-2.0)」）；
- 其 clean-room 的 Spine `.skel` 二进制导出路径（能力在、出口不开）；
- 上游核心逻辑——桥解决不了的诉求，先想协议，再想上游提 issue，不许直接改核心。
