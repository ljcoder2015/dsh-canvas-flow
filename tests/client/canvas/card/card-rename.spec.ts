/**
 * 卡片名的就地改名（F1.12，`client/canvas/card-tile.tsx`）。
 *
 * 判据（哪一项该改、撞名怎么办）在 `core/canvas/card-name.ts`，那边是真跑的单测。
 * 这里钉的是**浏览器这半那几条一改就静默坏掉的接线**——它们都在 jsx 里，跑不进
 * node 环境的单测（这个仓库的测试环境没有 DOM），错一处的后果却都不是报错，而是
 * 「点了没反应」或「卡片拖不动了」：
 *
 * 1. **卡上显示的是 `card.name`**，不是从 `card.file` 现推的。退回现推的那一刻，
 *    整条功能会静默失效：名字改了、卡片上却还写着文件名。
 * 2. **触发是「在名字上按下即抬手」**，判据落在既有的 `moved` 上——不是 `onClick`。
 *    卡片拖拽用指针捕获起手，随后的 click 会被重定向到卡片本身；而「按下名字挪两下」
 *    本来就是拖卡片。少了 `moved` 这一条，整条上沿就不再是拖拽的把柄。
 * 3. **输入框要拦住指针与按键**：卡片会拖、双击会开全屏、画布的键位会平移取景，
 *    而这里正在写字。
 * 4. **样式表里那两条**：卡片整体 `user-select:none`，输入框必须把它要回来；输入框
 *    与名字同高（16px），否则切进编辑态时卡片上的东西会跳一下。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { css } from '../../../../src/client/ui/styles.ts'

const TILE = readFileSync(new URL('../../../../src/client/canvas/card/card-tile.tsx', import.meta.url), 'utf8')

/** 样式表里整整一条规则（选择器行首独占、到它的 `}`）。 */
function ruleOf(selector: string): string {
  const at = css.indexOf(`\n${selector}{`)
  expect(at, `样式表里应有 ${selector} 这条规则（行首、独占选择器）`).toBeGreaterThan(-1)
  const start = at + 1
  return css.slice(start, css.indexOf('}', start))
}

/** 抓一段源码（从 `from` 到 `to`），用来把断言钉在某个分支里面而不是全文件。 */
function slice(from: string, to: string): string {
  const start = TILE.indexOf(from)
  expect(start, `卡片里应有 ${from}`).toBeGreaterThan(-1)
  const end = TILE.indexOf(to, start)
  expect(end, `${from} 之后应有 ${to}`).toBeGreaterThan(-1)
  return TILE.slice(start, end)
}

describe('卡片名显示', () => {
  it('显示的是 card.name，不再从路径现推', () => {
    expect(slice('<div className="dsh-canvas-card-name"', '</div>')).toContain('{card.name}')
    // 退回「文件名 = 卡片名」正是这条功能要修的那件事。
    expect(TILE).not.toContain("card.file.split('/')")
  })

  it('产物路径仍然报得出来（悬停即见）', () => {
    expect(TILE).toMatch(/title=\{`\$\{card\.name\} · \$\{card\.file\}`\}/)
  })
})

describe('怎么切进输入框', () => {
  it('命中判据是「按下时指针落在名字上」', () => {
    expect(slice('const pointerDown', 'setPointerCapture')).toMatch(/name:\s*nameRef\.current !== null[\s\S]*contains\(event\.target\)/)
  })

  it('抬手且没拖过才算「点」', () => {
    const up = slice('const pointerUp', 'onDragMove(card.id, undefined)')
    // 两个条件缺一不可：没动过（不是拖）、且按在名字上（不是卡片别处）。
    expect(up).toMatch(/if \(started === undefined \|\| !started\.moved\)/)
    expect(up).toMatch(/started\?\.name === true/)
    expect(up.indexOf('!started.moved')).toBeLessThan(up.indexOf('started?.name === true'))
  })

  it('拖动仍然是拖卡片：名字那一条也是把柄', () => {
    // 名字上**不**拦指针事件——拦了整条上沿就拖不动卡片了。
    const name = slice('<div className="dsh-canvas-card-name"', '</div>')
    expect(name).not.toContain('onPointerDown')
  })

  it('每次切进输入框都先把上一轮的撤回记录清掉', () => {
    // 输入框是按卸载收场的，浏览器不会为它补一次 blur：Esc 留下的那枚标记若不在
    // 开口处清掉，下一次改名会在提交那一刻被自己的上一轮静默吞掉（点了没反应）。
    const up = slice('const pointerUp', 'onDragMove(card.id, undefined)')
    const open = up.slice(up.indexOf('started?.name === true'))
    expect(open).toContain('cancelled.current = false')
    expect(open.indexOf('cancelled.current = false')).toBeLessThan(open.indexOf('setRenaming(true)'))
  })
})

describe('输入框把指针与按键留给自己', () => {
  const field = slice('{renaming ? (', ') : (')

  it('指针与双击不再传给卡片', () => {
    expect(field).toContain('onPointerDown={(event) => event.stopPropagation()}')
    expect(field).toContain('onDoubleClick={(event) => event.stopPropagation()}')
  })

  it('回车提交、Esc 撤回、失焦提交，且按键不外冒', () => {
    expect(field).toContain('event.stopPropagation()')
    expect(field).toMatch(/event\.key === 'Enter'[\s\S]*commitRename\(event\.currentTarget\.value\)/)
    expect(field).toMatch(/event\.key === 'Escape'[\s\S]*cancelled\.current = true/)
    expect(field).toContain('onBlur={(event) => commitRename(event.currentTarget.value)}')
  })

  it('提交时有两条不成立就不发请求：没改、或改空了', () => {
    const commit = slice('const commitRename', 'const position =')
    expect(commit).toMatch(/wanted === '' \|\| wanted === card\.name/)
    expect(commit).toContain('onRename(card.id, wanted)')
    // Esc 之后紧接着的那次 blur 不许再提交一次。
    expect(commit).toMatch(/if \(cancelled\.current\)[\s\S]*return/)
  })
})

describe('样式表', () => {
  it('输入框把选中能力从卡片手里要回来', () => {
    expect(ruleOf('.dsh-canvas-card')).toContain('user-select:none')
    expect(ruleOf('.dsh-canvas-card-namefield')).toContain('user-select:text')
  })

  it('输入框与名字同高同字，切进编辑态不跳', () => {
    const field = ruleOf('.dsh-canvas-card-namefield')
    expect(field).toContain('height:16px')
    expect(field).toContain('12px')
    expect(ruleOf('.dsh-canvas-card-name')).toContain('12px/16px')
  })

  it('名条紧贴卡片上沿', () => {
    // 上内边距小于下内边距的一半那种「贴边」不必强求，但这两条得在同一量级：
    // 名条是卡片的第一行，不能变成居中偏下的一条。
    expect(ruleOf('.dsh-canvas-card-head')).toMatch(/padding:5px 10px/)
  })
})
