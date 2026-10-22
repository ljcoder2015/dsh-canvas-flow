/**
 * 引用线的锚点几何（F4.8）。
 *
 * 拖线这件事全在指针上，React 组件本身测不动；能悄悄坏掉、坏了又只有肉眼才看得见
 * 的是那几个换算：线从哪儿起笔、放手点到卡位怎么反推、拖拽中的线往哪边弯。这三件
 * 都是纯函数，钉在这里。卡片尺寸取自 `core/board.ts`——宿主排位与浏览器画图用的
 * 是同一个数，测试也不该另抄一份。
 */
import { describe, expect, it } from 'vitest'
import { CARD_HEIGHT, CARD_WIDTH } from '../../../../src/core/canvas/board/board.ts'
import { sourceIdOf } from '../../../../src/core/canvas/board/source-store.ts'
import { PORT_REACH, pendingPath, portAnchor, seatAtAnchor } from '../../../../src/client/canvas/board/source-edges.tsx'

/** 一张随便摆在哪里的卡片。 */
const CARD = { x: 300, y: 200 }

describe('portAnchor', () => {
  it('起笔在端口圆心上：卡片边框外 PORT_REACH、垂直中点', () => {
    expect(portAnchor(CARD, 'out')).toEqual({ x: CARD.x + CARD_WIDTH + PORT_REACH, y: CARD.y + CARD_HEIGHT / 2 })
    expect(portAnchor(CARD, 'in')).toEqual({ x: CARD.x - PORT_REACH, y: CARD.y + CARD_HEIGHT / 2 })
  })

  it('两个端口关于卡片左右对称，且都比卡边更靠外', () => {
    const out = portAnchor(CARD, 'out').x
    const into = portAnchor(CARD, 'in').x
    expect(out - CARD.x - CARD_WIDTH).toBe(PORT_REACH)
    expect(CARD.x - into).toBe(PORT_REACH)
  })
})

describe('seatAtAnchor', () => {
  it('从 out 端口拖出去，新卡片落在右边，且它的 in 端口正接住放手点', () => {
    const at = { x: 900, y: 480 }
    const seat = seatAtAnchor(at, 'out')
    expect(seat.x).toBeGreaterThan(at.x)
    expect(portAnchor(seat, 'in')).toEqual(at)
  })

  it('从 in 端口拖出去，新卡片落在左边，且它的 out 端口正接住放手点', () => {
    const at = { x: 900, y: 480 }
    const seat = seatAtAnchor(at, 'in')
    expect(seat.x).toBeLessThan(at.x)
    expect(portAnchor(seat, 'out')).toEqual(at)
  })

  it('落位取整：放手点带小数，卡片座标仍是整数', () => {
    const seat = seatAtAnchor({ x: 640.5, y: 311.4 }, 'out')
    expect(Number.isInteger(seat.x)).toBe(true)
    expect(Number.isInteger(seat.y)).toBe(true)
  })

  it('反推与起笔互逆——放手点就是新卡片的端口', () => {
    for (const side of ['in', 'out'] as const) {
      const at = { x: 512, y: 384 }
      const back = side === 'out' ? portAnchor(seatAtAnchor(at, side), 'in') : portAnchor(seatAtAnchor(at, side), 'out')
      expect(back).toEqual(at)
    }
  })
})

describe('pendingPath', () => {
  const from = { x: 100, y: 200 }

  it('起点是锚点、终点就是指针本身：不放箭头，也不按卡片尺寸挪开', () => {
    const to = { x: 460, y: 300 }
    const path = pendingPath(from, to, 'out')
    expect(path.startsWith(`M ${from.x} ${from.y}`)).toBe(true)
    expect(path.endsWith(`${to.x} ${to.y}`)).toBe(true)
  })

  it('从 out 端口拖出：第一个控制点在起点右侧', () => {
    const path = pendingPath(from, { x: 400, y: 260 }, 'out')
    const first = path.match(/C ([\d.-]+) /)
    expect(Number(first?.[1])).toBeGreaterThan(from.x)
  })

  it('从 in 端口拖出（线往左走）：把手跟着转向，不绕过卡片回头', () => {
    const path = pendingPath(from, { x: -300, y: 260 }, 'in')
    const first = path.match(/C ([\d.-]+) /)
    expect(Number(first?.[1])).toBeLessThan(from.x)
  })

  it('竖直方向分离时改用上下把手，不至于从卡片中间穿过去', () => {
    const path = pendingPath(from, { x: from.x + 10, y: from.y + 400 }, 'out')
    expect(path).toContain(`C ${from.x} ${from.y + 180}`)
  })
})

describe('sourceIdOf', () => {
  it('存得下：卡片 id 是路径（带点带杠），键必须落在介质的路径安全字母表里', () => {
    // 介质的 per-record 布局以键作路径段，^[a-zA-Z0-9_-]+$ 之外一律拒绝——
    // 这里钉的就是那次实测翻车（untitled-2.md<-untitled.md 被写盘拒绝）。
    const safe = /^[a-zA-Z0-9_-]+$/
    expect(safe.test(sourceIdOf('untitled-2.md', 'untitled.md'))).toBe(true)
    expect(safe.test(sourceIdOf('站点/index.html', '素材/图片_01.png'))).toBe(true)
    expect(sourceIdOf('a.md', 'b.md')).not.toContain('.')
  })

  it('有向且幂等：调换两端换一条边，同一条边永远是同一个键', () => {
    expect(sourceIdOf('deck.html', 'brief.md')).toBe(sourceIdOf('deck.html', 'brief.md'))
    expect(sourceIdOf('deck.html', 'brief.md')).not.toBe(sourceIdOf('brief.md', 'deck.html'))
  })

  it('分隔符不会撞上转义：卡片 id 里的下划线一律被转义掉', () => {
    expect(sourceIdOf('a_1.md', 'b.md')).toBe('a_005f1_002emd__b_002emd')
  })
})
