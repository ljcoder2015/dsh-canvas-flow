/**
 * `@` 引用弹窗：**任意位置敲 `@` 都激活**，弹窗**贴着那一枚 `@`**。
 *
 * 用户原话：「提示词输入 @ 改成可以在提示中间任意位置 @ 就激活引用弹窗列表，弹窗列表是
 * 上下文菜单，位置根据 @ 符号定位」。三条判据各管一件事，而三件事以前分别是：
 *
 * 1. **什么时候冒出来**——从前只认**词首**那个 `@`（`foo@bar` 里那个不是引用），于是想
 *    引用一张卡得先把光标挪到词首。现在只看光标前那截有没有空白。这条改的是**手势**，
 *    不是记号语法：`scanFileMentions` 与宿主的记号语法一字未动（`foo@bar` 仍然不是引用），
 *    所以这一组里有一条**跨模块**的接线判据——句中插进去的记号，扫描器得真认得出来。
 * 2. **摆在哪**——落点算术是纯函数（翻上翻下、横向夹进视口），这里把三种处境都真算一遍。
 * 3. **挂在哪儿**——浮层必须 portal 到画布根：画布是 `scale()` 出来的，长在缩放层里的
 *    `position:fixed` 会认那个 transform 当包含块，量出来的视口坐标写进去就全错。这一条
 *    读源码（`ref-popup-view.tsx` 是组件，node 环境起不来），但读的是**接线**而不是措辞。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  POPUP_GAP,
  POPUP_MARGIN,
  keptPick,
  mentionInsertion,
  placePopup,
  queryAt,
  queryStart,
} from '../../../../src/client/ui/prompt/ref-popup.ts'
import { scanFileMentions } from '../../../../src/core/artifact/prompt/prompt-blocks.ts'
import { css } from '../../../../src/client/ui/styles.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
const VIEW = '../../../../src/client/ui/prompt/ref-popup-view.tsx'
const INPUT = '../../../../src/client/ui/prompt/prompt-input.tsx'
const OVERLAY = '../../../../src/client/canvas/card/card-overlay.tsx'

/** 样式表里**整整一条**规则（选择器行首独占、到它的 `}`）。 */
function ruleOf(selector: string): string {
  const at = css.indexOf(`\n${selector}{`)
  expect(at, `样式表里应有 ${selector} 这条规则（行首、独占选择器）`).toBeGreaterThan(-1)
  const start = at + 1
  return css.slice(start, css.indexOf('}', start))
}

describe('queryAt：句子中间任意位置都算', () => {
  it('串首、句中、行尾都认（从前只认词首）', () => {
    expect(queryAt('@bri', 4)).toBe('bri')
    expect(queryAt('看看@bri', 6)).toBe('bri')
    expect(queryAt('看看 @bri', 7)).toBe('bri')
    expect(queryAt('第一行\n第二行@a', 10)).toBe('a')
  })

  it('查询里一有空白就不算——`see @ 2pm` 不会把菜单留在屏幕上', () => {
    expect(queryAt('see @ 2pm', 9)).toBeNull()
    expect(queryAt('see @ 2pm', 5)).toBe('')
  })

  it('光标在 `@` 前面时不算（那枚 `@` 还在后面没写出来）', () => {
    expect(queryAt('看看@bri', 2)).toBeNull()
  })

  it('邮箱里的 `@` 也会闪一下弹窗——这是「任意位置」的直接代价，写在这里当已知行为', () => {
    expect(queryAt('mail me@foo', 11)).toBe('foo')
    // 而记号语法没变：那一串在展示层仍是一段普通文字（宿主也不认它是引用）。
    expect(scanFileMentions('mail me@foo')).toEqual([{ kind: 'text', text: 'mail me@foo' }])
  })

  it('起点就是那一枚 `@` 的偏移', () => {
    expect(queryStart('看看@bri', 6)).toBe(2)
    expect(queryStart('没有引用', 4)).toBe(4)
  })
})

describe('mentionInsertion：插进去的记号仍落在词首', () => {
  it('句子中间那个 `@` 前面补一个空格——否则它只是一个长单词', () => {
    const next = mentionInsertion('看看@bri', { start: 2, end: 6 }, '@docs/brief.md')
    expect(next.text).toBe('看看 @docs/brief.md')
    expect(next.caret).toBe('看看 @docs/brief.md'.length)
    // 跨模块：宿主/展示同一条记号语法，扫描器得真把这枚记号认出来（认不出就画不成标签）。
    expect(scanFileMentions(next.text)).toEqual([
      { kind: 'text', text: '看看 ' },
      {
        kind: 'file',
        token: '@docs/brief.md',
        path: 'docs/brief.md',
        name: 'brief.md',
        quote: 'none',
      },
    ])
  })

  it('词首那个 `@`（串首或前面已是空白）不再添空格', () => {
    expect(mentionInsertion('@bri', { start: 0, end: 4 }, '@docs/brief.md').text).toBe('@docs/brief.md')
    expect(mentionInsertion('看 @bri', { start: 2, end: 6 }, '@docs/brief.md').text).toBe('看 @docs/brief.md')
  })

  it('后面紧跟的是字就补一个空格，本来就是空白/行尾则不添', () => {
    expect(mentionInsertion('@bri后面', { start: 0, end: 4 }, '@a.md').text).toBe('@a.md 后面')
    expect(mentionInsertion('@bri 后面', { start: 0, end: 4 }, '@a.md').text).toBe('@a.md 后面')
  })
})

describe('placePopup：贴着 `@`，放不下就翻上去', () => {
  const anchor = { left: 200, right: 208, top: 300, bottom: 318 }
  const menu = { width: 240, height: 200 }
  const viewport = { width: 1200, height: 800 }

  it('默认落在 `@` 下面，左沿与 `@` 对齐', () => {
    expect(placePopup(anchor, menu, viewport)).toEqual({ left: 200, top: 318 + POPUP_GAP, flipped: false })
  })

  it('下面放不下就翻到上面（卡片贴着窗口底边时的唯一退路）', () => {
    const low = { left: 200, right: 208, top: 700, bottom: 718 }
    const placed = placePopup(low, menu, viewport)
    expect(placed.flipped).toBe(true)
    expect(placed.top).toBe(700 - POPUP_GAP - 200)
  })

  it('上下都放不下就夹在视口里——总比被裁掉一半强', () => {
    const tall = { width: 240, height: 2000 }
    const placed = placePopup({ ...anchor, top: 0, bottom: 18 }, tall, viewport)
    expect(placed.top).toBe(POPUP_MARGIN)
  })

  it('横向夹进视口：右边溢出与左边为负都收回来', () => {
    expect(placePopup({ ...anchor, left: 1100, right: 1108 }, menu, viewport).left).toBe(
      viewport.width - POPUP_MARGIN - menu.width,
    )
    expect(placePopup({ ...anchor, left: 0, right: 8 }, menu, viewport).left).toBe(POPUP_MARGIN)
  })

  it('菜单比视口还宽时左沿留边，不把它推到负坐标去', () => {
    const wide = { width: 4000, height: 100 }
    expect(placePopup(anchor, wide, viewport).left).toBe(POPUP_MARGIN)
  })
})

describe('keptPick：重报一次查询不该端走高亮', () => {
  it('同一次查询的重报（松键、聚焦、滚动、点选）保持不动', () => {
    expect(keptPick('bri', 'bri', 2)).toBe(2)
    expect(keptPick('', '', 3)).toBe(3)
    expect(keptPick(null, null, 0)).toBe(0)
  })

  it('查询真变了才回到第一枚（多打一个字、删一个字、菜单关掉再开）', () => {
    expect(keptPick('bri', 'brif', 2)).toBe(0)
    expect(keptPick('brif', 'bri', 2)).toBe(0)
    expect(keptPick('bri', null, 2)).toBe(0)
    expect(keptPick(null, '', 3)).toBe(0)
  })

  it('按一下 ↓ 再松键，高亮不许弹回第一枚——用户报的就是这一下', () => {
    // 真机顺序：keydown 把高亮挪一格 → keyup 顺手重报了同一个查询。
    let picked = 0
    picked = 1
    picked = keptPick('bri', 'bri', picked)
    expect(picked).toBe(1)
    picked = 2
    picked = keptPick('bri', 'bri', picked)
    expect(picked).toBe(2)
  })

  it('接线：控制带上报时走这条判断，不是无条件的复位', () => {
    const overlay = read(OVERLAY)
    const from = overlay.indexOf('onQueryChange={(next, at) => {')
    expect(from, '控制带应把查询报上来').toBeGreaterThan(-1)
    const body = overlay.slice(from, overlay.indexOf('\n        }}', from))
    expect(body).toContain('keptPick(lastQuery.current, next, now)')
    // 从前的写法（每报一次就 setPicked(0)）正是这枚 bug：挪一格就被下一毫秒的重报摁回去。
    expect(body).not.toContain('setPicked(0)')
  })
})

describe('接线：浮层挂在画布根上，位置由那一枚 `@` 说话', () => {
  it('弹窗只在 `ref-popup-view.tsx` 里画——调用方不再自己造一个 .dsh-canvas-refmenu', () => {
    expect(read(VIEW)).toContain('dsh-canvas-menu dsh-canvas-refmenu')
    // 控制带那侧只剩「把 anchor 交进去」：多画一个盒子就等于多一条绕过定位的路。
    expect(read(OVERLAY)).toContain('<RefPopup')
    expect(read(OVERLAY)).not.toContain('dsh-canvas-refmenu')
  })

  it('真的 portal 到画布根（缩放层里的 fixed 会跟着缩放走，坐标就全错了）', () => {
    const view = read(VIEW)
    expect(view).toContain('createPortal(')
    expect(view).toContain("'.dsh-canvas-root'")
  })

  it('位置从输入面量出来（`charRect`），不是从输入框框量出来', () => {
    const input = read(INPUT)
    expect(input).toContain('charRect')
    // 从前那半枚查询只报一个字符串；现在连位置一起报，调用方不必自己再换算一遍偏移。
    expect(input).toMatch(/onQueryChange\?\.\(\s*\n?\s*query,/)
    // 本地不许再留一份 `@` 的判定（那是 `ref-popup.ts` 的第二来源）。
    expect(input).not.toContain("lastIndexOf('@')")
  })

  it('样式里它是一条 `position:fixed` 的滚动盒子', () => {
    const rule = ruleOf('.dsh-canvas-refmenu')
    // 少了 fixed，内联的 left/top 什么也不做，弹窗会落回材料行的流里。
    expect(rule).toMatch(/position:\s*fixed/u)
    // 仍然是「自己会滚的地方」（`wheel-owner.ts` 的 SELF_SCROLLING 当它是滚动盒子）。
    expect(rule).toMatch(/overflow:\s*(auto|scroll)/u)
  })
})
