/**
 * skeleton2d 编辑器的纯算术（`skeleton2d-editor-layout.ts`）——contain 贴合与锚点换算。
 *
 * 这两段算术有两个使用者：编辑器的锚点标记 / 点击换算，与舞台（`skeleton2d-stage.ts`）
 * 的 GL 贴合——后者判据不在（WebGL 不进单测），所以「两边是同一个公式」这条性质
 * 只能钉在纯的那份上：这里的期望值就是手算的 contain 结果，舞台若改了贴合规则而
 * 这里没跟上，编辑器的标记就会从画面上漂走。
 */
import { describe, expect, it } from 'vitest'
import { anchorFromPoint, containLayout } from '../../../src/client/artifact/viewers/skeleton2d/skeleton2d-editor-layout.ts'

describe('contain 贴合', () => {
  it('画布比贴图宽：画面按高铺满、左右留边', () => {
    const box = containLayout(0.5, 400, 400)
    expect(box.height).toBe(400)
    expect(box.width).toBe(200)
    expect(box.left).toBe(100)
    expect(box.top).toBe(0)
  })

  it('画布比贴图窄：画面按宽铺满、上下留边', () => {
    const box = containLayout(2, 200, 200)
    expect(box.width).toBe(200)
    expect(box.height).toBe(100)
    expect(box.top).toBe(50)
    expect(box.left).toBe(0)
  })

  it('比例一致：画面铺满、零偏移', () => {
    const box = containLayout(16 / 9, 320, 180)
    expect(box.left).toBe(0)
    expect(box.top).toBe(0)
    expect(box.width).toBe(320)
    expect(box.height).toBe(180)
  })

  it('贴图比例离谱（0 或负）按 1:1 收敛，不产 NaN', () => {
    const box = containLayout(0, 300, 150)
    expect(Number.isFinite(box.width)).toBe(true)
    expect(Number.isFinite(box.height)).toBe(true)
    expect(box.width).toBe(150)
    expect(box.height).toBe(150)
  })
})

describe('点击 → 锚点', () => {
  it('点在贴图正中得 (0.5, 0.5)', () => {
    // 400×400 画布装一张 2:1 的贴图：贴合盒左右居中、宽 400 高 200、top 100。
    const anchor = anchorFromPoint(200, 200, 400, 400, 2)
    expect(anchor.x).toBeCloseTo(0.5, 6)
    expect(anchor.y).toBeCloseTo(0.5, 6)
  })

  it('点在贴合盒左上角得 (0, 0)——y 向下与模型 uv 同向', () => {
    const anchor = anchorFromPoint(0, 0, 400, 400, 2)
    expect(anchor.x).toBe(0)
    expect(anchor.y).toBe(0)
  })

  it('点在 letterbox 区夹到贴图边缘——锚点不许跑出贴图', () => {
    const anchor = anchorFromPoint(200, 30, 400, 400, 2) // top 边上方 70px 的空白
    expect(anchor.y).toBe(0)
    expect(anchor.x).toBeCloseTo(0.5, 6)
  })

  it('脚底那一下（贴图底部中央）落在 y=1——呼吸 / 摇摆的默认锚点', () => {
    const anchor = anchorFromPoint(300, 400, 400, 400, 2)
    expect(anchor.x).toBeCloseTo(0.75, 6)
    expect(anchor.y).toBeCloseTo(1, 6)
  })
})
