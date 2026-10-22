# Changelog

## [1.1.0](compare/v1.0.3...v1.1.0) (2026-10-22)

### Features

* 支持视频与音频生成，按领域重组目录结构 d50f2e8

### Bug Fixes

* 卡片会话的 preset 预检不再调用上游不存在的 standingKeyFor 3ccb100

## [1.0.3](https://github.com/ljcoder2015/dsh-canvas-flow/compare/v1.0.2...v1.0.3) (2026-10-09)

## [1.0.2](https://github.com/ljcoder2015/dsh-canvas/compare/v1.0.1...v1.0.2) (2026-10-08)

### ⚠ BREAKING CHANGES

* 包名改为 dsh-canvas-flow

### Code Refactoring

* 包名改为 dsh-canvas-flow ([aea1b95](https://github.com/ljcoder2015/dsh-canvas/commit/aea1b9557599af82edc2c22bfa2c73b051bb228b))

## 1.0.1 (2026-10-08)

### Features

* 画布交互全面改版（左栏包裹 / 键盘指针 / 锚点拖线 / 流光反馈）+ README 与 LICENSE ([3fa568a](https://github.com/ljcoder2015/dsh-canvas/commit/3fa568a60537689f1c5eb651029ec105fe5d82e7))
* 控制带输入框回归 + 取材 chip 挂右上角删除钮（F3.11 重写 + 新增 F4.9） ([d00ee91](https://github.com/ljcoder2015/dsh-canvas/commit/d00ee918ddbdc945d3ecb746285041a4a8b51367))
* 重写为 Cordis 双端画布插件（文件即产物 / 卡片即会话 / 取材即数据） ([e034864](https://github.com/ljcoder2015/dsh-canvas/commit/e034864f161e81d889943a185bbebbf9b8a11658))
* **canvas:** 卡片预览按 kind 出图，交互细节多轮打磨 ([b6b7cd1](https://github.com/ljcoder2015/dsh-canvas/commit/b6b7cd1f4a857d4cf4836098b51e07fce088b3ae))
* **design:** 设计组织对齐 Figma（区域 / 容器），并入文本导出与模型席位 ([87492c0](https://github.com/ljcoder2015/dsh-canvas/commit/87492c0970bf773fda4e2c5eca3f13736fd9c73a))
* **design:** 属性面板换设计/AI 标签页，边框与效果可编辑；引入 release-it ([7343894](https://github.com/ljcoder2015/dsh-canvas/commit/73438949855136f0a35ce28aa243764e2f6fd902))
* **dsh:** 适配 dsh 0.2.0-rc.2，修桌面端插件启动失败并补 npm 仓库元数据 ([04a5bba](https://github.com/ljcoder2015/dsh-canvas/commit/04a5bbab6084432f8f622ab45c527c23adaa4dc3))

### Bug Fixes

* **assets:** 资产按名缓存一年 → 每次回验，修「新客户端配旧 chunk」 ([9f46b7f](https://github.com/ljcoder2015/dsh-canvas/commit/9f46b7fc4fb629fcdc8fb9158bbda997fbec604d))
* **build:** 补声明 jspdf/svg2pdf.js 幻影依赖并放开 npm 发布 ([ceebaba](https://github.com/ljcoder2015/dsh-canvas/commit/ceebaba1e9aba24671a3c518e4e2d6330154b193))
* **canvas:** 设计预览快捷键不再透传画布；裁切收敛到画板级；滚轮视口落盘 ([d2321f7](https://github.com/ljcoder2015/dsh-canvas/commit/d2321f70695c82435875093b9dd97c4cc65d1090))
* **design:** 预览器挂载即接管键盘，不再等一次点击 ([1ff9020](https://github.com/ljcoder2015/dsh-canvas/commit/1ff9020b6722f007ce90f34f93af79f8843bcbe1))
* **release:** pushRepo 指向实际远端 origin ([dc203b8](https://github.com/ljcoder2015/dsh-canvas/commit/dc203b8e9e5554f0379bf8d738ee131cba660314))
