/**
 * 拖动控制带右下角那颗把手时，尺寸走成什么样。
 *
 * 这条判据的要点三条，都在这张表里：**锚在卡片中心**（宽走两倍——右沿只吃半个位移，
 * 想让把手跟住鼠标就得补上另一半；高走一倍——锚在上沿），**拖多少涨多少**（第一下不
 * 跳、缩放层里按 zoom 换算），以及**收得回来**（下限不是「刚才多大」，而是那条带装得
 * 下自己所需的最小尺寸——否则拖大一次就再也回不到默认了）。
 */
import { describe, expect, it } from 'vitest'
import {
  COMPOSER_MAX_INPUT_HEIGHT,
  COMPOSER_MAX_WIDTH,
  COMPOSER_MIN_INPUT_HEIGHT,
  COMPOSER_MIN_WIDTH,
  composerSizeOf,
  resizedComposerSize,
  type ComposerSize,
} from '../../../../src/client/canvas/card/composer-size.ts'

/** 起笔时那条带的自然尺寸：默认宽 380、输入框 54（CSS 里的 min-height）。 */
const START: ComposerSize = { width: 380, inputHeight: 54 }

describe('composerSizeOf', () => {
  it('画布没缩放时量到多少就是多少', () => {
    expect(composerSizeOf(380, 54, 1)).toEqual({ width: 380, inputHeight: 54 })
  })

  it('量到的是屏幕像素，缩放层里的值要除回去', () => {
    // 画布放到 200%：屏幕上量到 760，画布单位里仍是 380。
    expect(composerSizeOf(760, 108, 2)).toEqual({ width: 380, inputHeight: 54 })
  })

  it('缩放不成样子时退回 1，而不是算出 Infinity', () => {
    expect(composerSizeOf(380, 54, 0)).toEqual({ width: 380, inputHeight: 54 })
    expect(composerSizeOf(380, 54, Number.NaN)).toEqual({ width: 380, inputHeight: 54 })
  })
})

describe('resizedComposerSize', () => {
  it('居中锚：鼠标右移 140，宽涨 280（左沿与右沿各长 140，把手正着跟住光标）', () => {
    // 这就是那条不变量：锚在卡片中心 ⇒ 右沿只走半个位移 ⇒ 宽要按两倍吃。刻意与「高」
    // 摆在一起量——同一笔里宽走两倍、高走一倍，两个数不一样，这正是最容易被写错的地方。
    expect(resizedComposerSize(START, { dx: 120, dy: 80 }, 1)).toEqual({ width: 620, inputHeight: 134 })
  })

  it('只走一个轴时，另一个轴一动不动', () => {
    expect(resizedComposerSize(START, { dx: 0, dy: 60 }, 1)).toEqual({ width: 380, inputHeight: 114 })
    expect(resizedComposerSize(START, { dx: 60, dy: 0 }, 1)).toEqual({ width: 500, inputHeight: 54 })
  })

  it('画布缩放到 200% 时，屏幕上的 200px 只该涨 100——而宽仍是它的两倍', () => {
    // 这一条是把手能不能跟住鼠标的关键：不除 zoom，拖起来会是鼠标的两倍快；除完之后
    // 宽还要再乘回那个「居中锚」的两倍，两件事各归各的。
    expect(resizedComposerSize(START, { dx: 200, dy: 100 }, 2)).toEqual({ width: 580, inputHeight: 104 })
  })

  it('往回拖得回默认大小，不会卡在放大值上', () => {
    const big = resizedComposerSize(START, { dx: 150, dy: 200 }, 1)
    expect(big).toEqual({ width: 680, inputHeight: 254 })
    expect(resizedComposerSize(big, { dx: -150, dy: -200 }, 1)).toEqual(START)
  })

  it('再往回拖也不越过下限（那里是「装得下自己」的最小尺寸）', () => {
    expect(resizedComposerSize(START, { dx: -400, dy: -400 }, 1)).toEqual({
      width: COMPOSER_MIN_WIDTH,
      inputHeight: COMPOSER_MIN_INPUT_HEIGHT,
    })
  })

  it('也越不过上限', () => {
    expect(resizedComposerSize(START, { dx: 4000, dy: 4000 }, 1)).toEqual({
      width: COMPOSER_MAX_WIDTH,
      inputHeight: COMPOSER_MAX_INPUT_HEIGHT,
    })
  })

  it('坏的指针事件当没动，不把尺寸算成 NaN', () => {
    expect(resizedComposerSize(START, { dx: Number.NaN, dy: Number.POSITIVE_INFINITY }, 1)).toEqual(START)
  })

  it('尺寸取整到整像素（半像素的宽会让每一帧都白渲染一次）', () => {
    const next = resizedComposerSize({ width: 380.4, inputHeight: 54.2 }, { dx: 10.3, dy: 10.3 }, 1)
    expect(next).toEqual({ width: 401, inputHeight: 65 })
  })
})
