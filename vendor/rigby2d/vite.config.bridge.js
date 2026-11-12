// SPDX-License-Identifier: MIT OR Apache-2.0
// dsh-canvas fork 构建配置（fork 差异面，见 FORK.md）：与上游 vite.config.js 的差异只有——
//   1. 去 pyodideAssets 插件（Python 插件沙箱不随嵌入包分发）；
//   2. @demo-sources 指向空桩（demo 素材不在仓库也不需要）；
//   3. @huggingface/transformers 指向桩（口型同步不启用，构建能过）；
//   4. 只打 index.html 一个入口（splash/panel 是桌面壳的窗口）；
//   5. base: './'（相对路径——静态包挂在宿主的 /dsh-canvas/rigby2d-editor/ 下也能跑）；
//   6. outDir: dist-embed（不与上游 dist 混）。
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;

export default defineConfig({
  clearScreen: false,
  base: './',
  define: { __RIGBY_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      '@demo-sources': path.resolve('src/editor/demo-sources-embed.js'),
      '@huggingface/transformers': path.resolve('src/editor/transformers-stub.js'),
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2021',
    outDir: 'dist-embed',
    emptyOutDir: true,
    rollupOptions: { input: { main: 'index.html' } },
  },
});
