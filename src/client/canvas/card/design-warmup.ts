/**
 * dsh-canvas — 设计引擎的**预热**（打开预览之前就该开始的那一趟冷启动）。
 *
 * 设计预览的首帧要等三件事：CanvasKit 的 8MB WASM 初始化、6MB 的引擎 chunk、四支默认
 * 字面（Inter，约 1.3MB）。这三样在**第一次**打开设计卡时要 1 秒上下（本地 HTTP 也是这个
 * 量级：实测 wasm 初始化 ~145ms、chunk ~180ms、字体 ~140ms），而它们都是**进程级的一次性
 * 开销**——第二张设计卡打开时（`?v=` 与模块缓存都热着）只剩建引擎与首帧渲染。
 *
 * 所以这一趟不该等到用户点开预览才开始。**画布上已经有这张设计卡的缩略图**就是最好的信号：
 * 那张 400×240 的 PNG 是 2D 后端画的（见 `card-shot.ts`），手里已经握着一份解码好的文档
 * ——它出现在画布上，说明这份设计已经被人看见了，多半就要被打开。
 *
 * 三条边界：
 *
 * - **只预热取资源那一段**（wasm / chunk / 字面），不建引擎、不碰任何画布元素：引擎与
 *   卡片、页面绑定，预热期没有「哪一页」这回事。
 * - **一次就够**：两个加载器各自单飞（`loadCanvasKit` / `loadDesignEngine`），这里再加一道
 *   门，免得每张卡都排一次 idle 回调。
 * - **让路**：`requestIdleCallback` 有空才跑（`timeout` 兜住一直没空的情况），没有这个
 *   API 的浏览器（Safari）退成一次延时的 `setTimeout`——预热不值得抢首屏的帧。
 */
import { useEffect } from 'react'
import { loadCanvasKit, prefetchDesignFonts } from '../../artifact/viewers/design/design-canvaskit.ts'
import { loadDesignEngine } from '../../artifact/viewers/design/design-engine-module.ts'

/** 空闲窗口一直不来的兜底时限（毫秒）：超过它就在下一帧开跑，不再等。 */
const WARM_IDLE_TIMEOUT_MS = 2500

/** 没有 `requestIdleCallback` 时的延时（毫秒）。 */
const WARM_FALLBACK_DELAY_MS = 600

let started = false

/** 三趟并行：它们互相不依赖，谁先到都算数（失败一律由各自的加载器收成降级路）。 */
function warm(): void {
  void loadCanvasKit()
  void loadDesignEngine()
  prefetchDesignFonts()
}

/**
 * 引擎预热一次（进程级，幂等）。
 *
 * 失败不重试也不声张：这三个加载器自己会把失败收成 `null`，真正的报错留给打开预览的那一刻
 * ——在画布上先把一句「引擎加载失败」喊出来，是替一次还没发生的操作报错。
 */
export function warmDesignEngine(): void {
  if (started) return
  started = true
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number })
    .requestIdleCallback
  if (typeof idle === 'function') {
    idle(warm, { timeout: WARM_IDLE_TIMEOUT_MS })
    return
  }
  setTimeout(warm, WARM_FALLBACK_DELAY_MS)
}

/**
 * 这张卡是设计卡、而且缩略图已经在画布上时，把引擎的资源先取回来。
 *
 * `ready` 传的是「这张设计卡的缩略图已经画出来了」——不是「这张卡存在」。理由见文件头：
 * 缩略图在，说明这份设计已经被人看见；它还没画出来时抢带宽，反而拖慢那次缩略图本身。
 */
export function useDesignEngineWarmup(ready: boolean): void {
  useEffect(() => {
    if (ready) warmDesignEngine()
  }, [ready])
}
