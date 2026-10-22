/**
 * 画布上的滚轮归谁（`wheel-owner.ts`）。
 *
 * 用户报的第一条正是这里：**在提示词框里滚轮，走的是画布**。修法的判据只有一句——
 * 指针底下是一处自己会滚的地方（输入框正文、`@` 候选、模型菜单），那一滚就归它；
 * 而**缩放不看这条线**（`ctrl` / `⌘` + 滚轮是画布的手势，指针落在哪儿都一样，触控板
 * 捏合也走它）。
 *
 * 用户报的第二条是这一滚的另一端：**鼠标缩放画布的时候，宿主页面跟着一起放大**。
 * 滚轮归了画布，浏览器自己那一手就不算数——`preventDefault` 加 `stopPropagation`
 * 两下都要做，而这两下只有在**主动**监听里才算数（`wheelSwallowed` 与末尾那条源码
 * 判据一起盯住这件事）。
 *
 * 另外一条是**漂移**：那串类名长在 JS 里，而几个盒子长在 `styles.ts` 里——写错一个
 * 字母不会有任何报错，只会静默地退回「滚轮又滚画布」，所以拿样式表对一遍：每一处都
 * 得真是一条会滚的盒子。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SELF_SCROLLING, wheelOwner, wheelSwallowed } from '../../../../src/client/canvas/board/wheel-owner.ts'
import { css } from '../../../../src/client/ui/styles.ts'

/**
 * 样式表里**整整一条**规则（选择器行首独占、到它的 `}`）。
 *
 * 必须卡行首：同一个类名会在别处再出现（`.dsh-canvas-surface.is-space .dsh-canvas-promptbox-field`
 * 那条覆盖就是这么写的），而这里要看的是**这条类自己的规则**。
 */
function ruleOf(selector: string): string {
  const at = css.indexOf(`\n${selector}{`)
  expect(at, `样式表里应有 ${selector} 这条规则（行首、独占选择器）`).toBeGreaterThan(-1)
  const start = at + 1
  return css.slice(start, css.indexOf('}', start))
}

describe('wheelOwner', () => {
  it('缩放是画布的手势：指针落在哪儿都一样', () => {
    expect(wheelOwner({ zoom: true, selfScrolling: false })).toBe('zoom')
    // 甚至落在输入框里也算画布的——`ctrl` / `⌘` + 滚轮不是「滚这一段文字」。
    expect(wheelOwner({ zoom: true, selfScrolling: true })).toBe('zoom')
  })

  it('plain 滚轮先让给指针底下自己会滚的地方', () => {
    expect(wheelOwner({ zoom: false, selfScrolling: true })).toBe('self')
  })

  it('别处才是画布的平移', () => {
    expect(wheelOwner({ zoom: false, selfScrolling: false })).toBe('board')
  })
})

describe('SELF_SCROLLING', () => {
  it('认三处：提示词正文、@ 候选菜单、模型菜单', () => {
    expect(SELF_SCROLLING.split(',')).toEqual([
      '.dsh-canvas-promptbox-field',
      '.dsh-canvas-refmenu',
      '.dsh-canvas-modelmenu',
    ])
  })

  it('每一处在样式表里都真是一条会滚的盒子', () => {
    // 少了 overflow:auto，那个盒子就滚不动——那时轮子归它等于**什么也不发生**，而画布
    // 也不再接管，用户会觉得滚动失灵。这条把「让开」与「真能滚」绑在一起。
    for (const selector of SELF_SCROLLING.split(',')) {
      expect(ruleOf(selector), `${selector} 应当是 overflow:auto 的滚动盒子`).toMatch(/overflow:\s*(auto|scroll)/u)
    }
  })
})

describe('wheelSwallowed', () => {
  it('归画布的两滚都拦下：浏览器自己那一手不算数', () => {
    expect(wheelSwallowed('zoom')).toBe(true)
    expect(wheelSwallowed('board')).toBe(true)
  })

  it('归内层滚动盒子的那一滚一个字都不碰', () => {
    // 滚动正是那个盒子的默认动作，拦下就等于它再也滚不动。
    expect(wheelSwallowed('self')).toBe(false)
  })
})

/**
 * 挂监听的那几句只能看源码：node 环境里没有 DOM，`addEventListener` 的第三个参数
 * 是这次修复的全部要点，却没有一处能在单测里「跑」出来。
 *
 * 这一条拦的是**回到 React 的 `onWheel`**（用户报的正是它）。react-dom 18.3.1 的
 * `addTrappedEventListener` 把 `wheel` / `touchstart` / `touchmove` 三兄弟一律注册成
 * `passive`——挂在根容器上、且不许拦默认动作，于是 `ctrl` / `⌘` + 滚轮既缩放画布，
 * 又让浏览器把**整个宿主页面**也放大一档。想拦下默认动作，就必须自己挂一条主动监听。
 */
describe('画布上的滚轮监听（源码判据）', () => {
  const source = readFileSync(new URL('../../../../src/client/canvas/board/canvas-view.tsx', import.meta.url), 'utf8')
  /** 那一整段原生监听：从处理函数起笔，到挂上表面为止。 */
  const at = source.indexOf('const onWheel = (event: WheelEvent)')
  const body = at === -1 ? '' : source.slice(at, source.indexOf('surface.addEventListener', at))

  it('是挂在表面上的原生监听，且显式 passive: false', () => {
    expect(source).toMatch(/surface\.addEventListener\(\s*'wheel',\s*onWheel,\s*\{\s*passive:\s*false\s*\}\s*\)/u)
    expect(source).toMatch(/surface\.removeEventListener\(\s*'wheel',\s*onWheel\s*\)/u)
  })

  it('不再挂 React 的 onWheel', () => {
    expect(source).not.toMatch(/onWheel=/u)
  })

  it('拦下的是两下：默认动作与继续冒泡', () => {
    expect(body).not.toBe('')
    expect(body).toContain('if (!wheelSwallowed(owner)) return')
    expect(body).toContain('event.preventDefault()')
    expect(body).toContain('event.stopPropagation()')
  })
})
