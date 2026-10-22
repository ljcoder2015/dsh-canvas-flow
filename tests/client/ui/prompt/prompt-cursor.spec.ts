/**
 * 提示词输入框的指针判据（用户报的另一半：鼠标移进去没变成输入框的样式）。
 *
 * 这道判据存在的理由是一处**继承**：画布表面钉着 `cursor:default`（整块表面都是选择
 * 箭头，见 `styles.ts` 的 surface 那一段），而 `cursor` 是继承属性——于是它压掉了浏览器
 * 给「可编辑」内容自动出的 I 型光标。宿主那套 UA 样式只管 `input` / `textarea`，而此处
 * 是本插件里唯一一处 `contenteditable`（`prompt-input.tsx`），所以要自己说出来。
 *
 * 顺带把三件相邻的事钉住：这条前提本身（表面是箭头）、画上去的引用标签**故意**保持箭头
 * （它不是可编辑的文字，是一枚原子），以及按住空格时让开（那时整块表面都是抓手）。
 */
import { describe, expect, it } from 'vitest'
import { css } from '../../../../src/client/ui/styles.ts'

/**
 * 样式表里**整整一条**规则（选择器行首独占、到它的 `}`）。
 *
 * 必须卡行首：同一个类名会在别处再出现（本文件里就有 `.dsh-canvas-surface.is-space
 * .dsh-canvas-promptbox-field` 那条覆盖），而这里要看的是**这条类自己的规则**。
 */
function ruleOf(selector: string): string {
  const at = css.indexOf(`\n${selector}{`)
  expect(at, `样式表里应有 ${selector} 这条规则（行首、独占选择器）`).toBeGreaterThan(-1)
  const start = at + 1
  return css.slice(start, css.indexOf('}', start))
}

describe('提示词输入框的光标', () => {
  it('表面是选择箭头——这正是 I 型光标会被继承值压掉的前提', () => {
    expect(ruleOf('.dsh-canvas-surface')).toMatch(/cursor:\s*default/u)
  })

  it('输入框正文自己说要 I 型光标', () => {
    expect(ruleOf('.dsh-canvas-promptbox-field')).toMatch(/cursor:\s*text/u)
  })

  it('按住空格时让开：那时整块表面都是抓手，指到框上说的也是「拖的是取景框」', () => {
    const overriding = '.dsh-canvas-surface.is-space .dsh-canvas-promptbox-field'
    expect(ruleOf(overriding)).toMatch(/cursor:\s*grab/u)
  })

  it('引用标签仍是一枚原子：悬停在它上面不出 I 型光标（里面没有光标可落）', () => {
    expect(ruleOf('.dsh-canvas-ref-chip')).toMatch(/cursor:\s*default/u)
  })
})
