/**
 * 加载盖板的阶段判定：**引擎就绪不等于画面出来了**（v1.86）。
 *
 * 这一条判据钉的是一个会静默地错成两个方向的小函数：撤早了那 200–500ms 的整页录制就是
 * 白屏（要修的正是这个观感）；撤晚了画好的画面被人看不见，比白屏更糟。两个方向都不报错，
 * 所以只能靠判据。
 *
 * 真机上的两段实测（`.workbuddy/tmp/perf` 那个探针，Chromium 1400×900，本机 HTTP）：
 *   引擎那一段 400–600ms（wasm 初始化 + 6MB chunk + 四支字面）
 *   绘制那一段 200–500ms（yoga 布局 + 整页 Skia picture，随文档大小）
 */
import { describe, expect, it } from 'vitest'
import { designPhaseOf } from '../../../../../src/client/artifact/viewers/design/design-phase.ts'

describe('designPhaseOf', () => {
  it('资源还在路上时说 engine', () => {
    expect(designPhaseOf({ kind: 'loading' }, false)).toBe('engine')
    // loading 期间 `painted` 只可能是假，但写成真也不能改口：引擎还没有，画不出东西。
    expect(designPhaseOf({ kind: 'loading' }, true)).toBe('engine')
  })

  it('引擎就绪、首帧还没落屏时说 paint', () => {
    expect(designPhaseOf({ kind: 'ready' }, false)).toBe('paint')
  })

  it('首帧画完了就撤下', () => {
    expect(designPhaseOf({ kind: 'ready' }, true)).toBeNull()
  })

  it('出错时撤下——错误自己有一条，盖板压着它只会让人看不见', () => {
    expect(designPhaseOf({ kind: 'error' }, false)).toBeNull()
    expect(designPhaseOf({ kind: 'error' }, true)).toBeNull()
  })
})
