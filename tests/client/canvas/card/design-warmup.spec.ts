/**
 * 预热只排一次（v1.86）。
 *
 * 这一条钉的是**门的位置**：`started` 是模块级的。若哪天有人把它挪进 hook 或组件（很自然
 * 的下一步「让它跟着卡片走」），画布上十张设计卡就会排十次——第一次把 8MB 的 wasm 与 6MB
 * 的 chunk 各取十遍（浏览器会去重一部分，但十条 idle 回调、十次字体预取都在那儿）。
 *
 * 判据不真的跑那一趟（`warm` 一执行就要 `requestIdleCallback` 真回调、要 document）：注入
 * 一个只记数的 `requestIdleCallback`，看它被排了几次。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const SRC = '../../../../src/client/canvas/card/design-warmup.ts'

afterEach(() => {
  delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback
  vi.useRealTimers()
  vi.resetModules()
})

describe('warmDesignEngine', () => {
  it('连着叫三次只排一次空闲任务', async () => {
    vi.resetModules()
    const { warmDesignEngine } = await import(SRC)
    let queued = 0
    ;(globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = () => {
      queued += 1
      return queued
    }
    warmDesignEngine()
    warmDesignEngine()
    warmDesignEngine()
    expect(queued).toBe(1)
  })

  it('没有 requestIdleCallback 的浏览器退成一次延时，不是一次都不跑', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const { warmDesignEngine } = await import(SRC)
    warmDesignEngine()
    // 什么都没排（没有 idle API 时不该静默地什么都不做）。
    expect(vi.getTimerCount()).toBe(1)
    vi.useRealTimers()
  })
})
