/**
 * 合帧闸：**同一帧只画一次，画完还能再排**（v1.86）。
 *
 * 来处是一个实测数：中文字面（17.7MB）注册进 CanvasKit 的那一刻，core 的 `settleFontDemand`
 * 逐节点结算，一口气叫了 88–153 次 `onRepaint`。以前每次都当场跑一遍 `draw`——同一帧里把
 * 整页重录上百遍。
 *
 * 这里不 import 浏览器：`requestAnimationFrame` 的替身把回调收进队列，测试自己决定什么时候
 * 「下一帧」。三条判据各钉一条真会踩的边界：
 *   1. 同帧内的第二、第三次请求被合并；
 *   2. 画完之后必须能再排（否则这张卡再也不更新）；
 *   3. `draw` 抛错也不能把闸卡死（否则之后所有的重画都被吞掉——一个静默的死锁）。
 */
import { describe, expect, it } from 'vitest'
import { createFrameGate } from '../../../../../src/client/artifact/viewers/design/design-frame-gate.ts'

/** 一台假的帧钟：回调排队，「下一帧」由测试手动放行。 */
function fakeFrames() {
  const queue: { handle: number; callback: () => void }[] = []
  let next = 1
  return {
    queue,
    request: (callback: () => void): number => {
      const handle = next
      next += 1
      queue.push({ handle, callback })
      return handle
    },
    cancel: (handle: number): void => {
      const at = queue.findIndex((entry) => entry.handle === handle)
      if (at !== -1) queue.splice(at, 1)
    },
    /** 放行这一帧：把当前排队的回调全跑掉（模拟 rAF 回调的时机）。 */
    flush(): void {
      const due = queue.splice(0, queue.length)
      for (const entry of due) entry.callback()
    },
  }
}

describe('createFrameGate', () => {
  it('同一帧里的多次请求只画一次', () => {
    const frames = fakeFrames()
    let draws = 0
    const gate = createFrameGate(() => { draws += 1 }, frames.request, frames.cancel)

    gate.schedule()
    gate.schedule()
    gate.schedule()
    expect(frames.queue).toHaveLength(1)
    expect(draws).toBe(0)

    frames.flush()
    expect(draws).toBe(1)
  })

  it('画完之后能再排——下一帧照常进来', () => {
    const frames = fakeFrames()
    let draws = 0
    const gate = createFrameGate(() => { draws += 1 }, frames.request, frames.cancel)

    gate.schedule()
    frames.flush()
    gate.schedule()
    expect(frames.queue).toHaveLength(1)
    frames.flush()
    expect(draws).toBe(2)
  })

  it('画的过程中再被请求，那一帧要排上而不是被吞掉', () => {
    const frames = fakeFrames()
    let draws = 0
    let gate: ReturnType<typeof createFrameGate> | null = null
    gate = createFrameGate(() => {
      draws += 1
      // 字体连环结算就是这样：画到一半又来了新的请求。
      if (draws === 1) gate?.schedule()
    }, frames.request, frames.cancel)

    gate.schedule()
    frames.flush()
    // 第一次画完之后，那次「画到一半的请求」应当还在队列里。
    expect(frames.queue).toHaveLength(1)
    frames.flush()
    expect(draws).toBe(2)
  })

  it('draw 抛错也不卡死：闸已经放开，下一次照常排', () => {
    const frames = fakeFrames()
    let draws = 0
    const gate = createFrameGate(() => {
      draws += 1
      if (draws === 1) throw new Error('画坏了')
    }, frames.request, frames.cancel)

    gate.schedule()
    expect(() => frames.flush()).toThrow('画坏了')
    // 抛了之后必须还能排上——否则这张卡的每一次重画都被吞掉，而且什么都不报。
    gate.schedule()
    expect(frames.queue).toHaveLength(1)
    frames.flush()
    expect(draws).toBe(2)
  })

  it('stop 撤掉还没跑的那一帧', () => {
    const frames = fakeFrames()
    let draws = 0
    const gate = createFrameGate(() => { draws += 1 }, frames.request, frames.cancel)

    gate.schedule()
    gate.stop()
    expect(frames.queue).toHaveLength(0)
    frames.flush()
    expect(draws).toBe(0)
  })
})
