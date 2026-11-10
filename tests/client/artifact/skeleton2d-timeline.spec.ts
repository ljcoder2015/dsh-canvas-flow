/**
 * dsh-canvas — skeleton2d 编辑器时间线模式的判据。
 *
 * 布局与坐标换算是时间线全部的算术：轨道等高不重叠、时间/取值与像素来回换算不失真、
 * 键的命中半径内抓得住。曲线形状本身不在判据里——它与渲染器共用 `motionValueAt`
 * （rig.spec 钉过），画出来的必然是算出来的那条线。
 */
import { describe, expect, it } from 'vitest'
import type { Skeleton2dKeyframe } from '../../../src/core/skeleton2d/model.ts'
import {
  RULER_HEIGHT,
  nearestKey,
  timeToX,
  trackAt,
  trackRects,
  valueToY,
  xToTime,
  yToValue,
} from '../../../src/client/artifact/viewers/skeleton2d/skeleton2d-timeline.ts'

describe('轨道布局', () => {
  const rects = trackRects(3, 150)

  it('轨道从标尺下面开始，等高平分，互不重叠', () => {
    expect(rects).toHaveLength(3)
    for (const rect of rects) {
      expect(rect.top).toBeGreaterThanOrEqual(RULER_HEIGHT)
      expect(rect.height).toBeGreaterThan(0)
    }
    for (let index = 1; index < rects.length; index += 1) {
      const previous = rects[index - 1]!
      const current = rects[index]!
      expect(current.top).toBeGreaterThanOrEqual(previous.top + previous.height)
    }
  })

  it('三条轨道加上标尺不超出时间线高度', () => {
    const last = rects[2]!
    expect(last.top + last.height).toBeLessThanOrEqual(150)
  })
})

describe('坐标换算', () => {
  it('时间 ↔ 像素来回不失真，越界夹进 0–1', () => {
    expect(xToTime(timeToX(0.37, 600), 600)).toBeCloseTo(0.37, 12)
    expect(timeToX(0, 600)).toBe(0)
    expect(timeToX(1, 600)).toBe(600)
    expect(timeToX(-0.5, 600)).toBe(0)
    expect(timeToX(1.5, 600)).toBe(600)
    expect(xToTime(-20, 600)).toBe(0)
    expect(xToTime(9999, 600)).toBe(1)
  })

  it('取值 ↔ 像素来回不失真：中线是零、顶端是 1、底端是 -1', () => {
    const rect = { top: 20, height: 40 }
    expect(valueToY(0, rect)).toBeCloseTo(rect.top + rect.height / 2, 12)
    expect(valueToY(1, rect)).toBeCloseTo(rect.top, 12)
    expect(valueToY(-1, rect)).toBeCloseTo(rect.top + rect.height, 12)
    expect(yToValue(valueToY(0.42, rect), rect)).toBeCloseTo(0.42, 12)
    expect(yToValue(rect.top + rect.height * 2, rect)).toBe(-1)
  })
})

describe('键的命中测试', () => {
  const rect = { top: 0, height: 40 }
  const keys: Skeleton2dKeyframe[] = [
    { t: 0.2, v: 0.5 },
    { t: 0.8, v: -0.5 },
  ]

  it('点在键上抓得到（按序号），点远了抓不到', () => {
    expect(nearestKey(timeToX(0.2, 500), valueToY(0.5, rect), keys, rect, 500)).toBe(0)
    expect(nearestKey(timeToX(0.8, 500), valueToY(-0.5, rect), keys, rect, 500)).toBe(1)
    expect(nearestKey(timeToX(0.5, 500), valueToY(0, rect), keys, rect, 500)).toBeUndefined()
  })

  it('两枚键都够不着时返回 undefined——空白处一击是「加键」，不是「误抓」', () => {
    expect(nearestKey(timeToX(0.2, 500), valueToY(-1, rect), keys, rect, 500)).toBeUndefined()
  })
})

describe('轨道归属', () => {
  const rects = trackRects(3, 150)

  it('纵向落点报出轨道序号；落在标尺与缝隙里报 undefined', () => {
    expect(trackAt(rects[1]!.top + rects[1]!.height / 2, rects)).toBe(1)
    expect(trackAt(RULER_HEIGHT / 2, rects)).toBeUndefined()
    expect(trackAt(149.9, rects)).toBeUndefined()
  })
})
