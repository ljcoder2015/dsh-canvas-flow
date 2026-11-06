/**
 * 标签旁边的**一处分隔**：紧贴着标签打进来的字，不许被拼进那枚记号的路径。
 *
 * 用户原话：「在 @ 选中文件后面输入文本，删除时，会直接删除文件及以后的文本，而不是一个一个
 * 文字删除，只是 @ 的文件块需要整体看成一个文本删除」。
 *
 * 那一下「整块没了」不是删除那一步的错，是**打字那一步**的错：值是一串字符，`@hero.png`
 * 后面紧贴写 `abc` 拼出来是 `@hero.pngabc`——宿主会把它读成**另一份文件**的记号，输入面
 * 这边则读成**一整枚**引用原子，于是 Backspace 一次就把「引用 + 后面的字」全删了。
 *
 * 所以这条边界要补在**读回值的时候**（`prompt-dom.ts` 的 `separatedSpans`）：界面上那枚
 * 标签冻着的那串字符（`data-ref-id`）不会因为旁边多了几个字就变长，两者一对比就知道
 * 该在哪儿补一个空格。补完之后：文字逐字删，标签整枚删。
 *
 * 判据分两半：**算术**（纯，node 里真跑）与**接线**（`readBack` 真调了它、删除那一步真做了
 * 对账）。DOM 那一半（`chipSpans` 数得对不对）在 `.workbuddy/repro/prompt-refs/` 的真浏览器
 * 判据里（G20/G21）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { separatedSpans, type ChipSpan } from '../../../../src/client/ui/prompt/prompt-dom.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
const INPUT = '../../../../src/client/ui/prompt/prompt-input.tsx'

/** 一枚标签：值里 `看看 @hero.png` 的那一枚（名字 9 个字符）。 */
const hero: ChipSpan = { at: 3, token: '@hero.png' }

describe('separatedSpans：紧贴着标签的字补一处分隔', () => {
  it('标签右边紧贴写字：补在它后面，光标跟着挪一格', () => {
    const fixed = separatedSpans('看看 @hero.pngabc', [hero], 16)
    expect(fixed).toEqual({ text: '看看 @hero.png abc', caret: 17 })
  })

  it('标签左边紧贴写字：补在它前面（`@` 在词首才算引用）', () => {
    const fixed = separatedSpans('看看X@hero.png', [{ at: 3, token: '@hero.png' }], 4)
    expect(fixed).toEqual({ text: '看看X @hero.png', caret: 5 })
  })

  it('两边都紧贴：两处都补', () => {
    const fixed = separatedSpans('看看X@hero.pngY', [{ at: 3, token: '@hero.png' }], 13)
    expect(fixed).toEqual({ text: '看看X @hero.png Y', caret: 15 })
  })

  it('本来就有空白：一个字都不动（返回 `null` 才是幂等）', () => {
    expect(separatedSpans('看看 @hero.png abc', [hero], 17)).toBeNull()
    expect(separatedSpans('看看 @hero.png', [hero], 12)).toBeNull()
  })

  it('打一个引号也要隔开：路径被读成非法时整段会退回普通文字，标签就凭空消失了', () => {
    expect(separatedSpans('看看 @hero.png"', [hero], 13)).toEqual({ text: '看看 @hero.png "', caret: 14 })
  })

  it('标记类（token 里带坐标标签）同样按它自己那串字符算边界', () => {
    const mark: ChipSpan = { at: 0, token: '@a.png <point>420 380</point>' }
    const fixed = separatedSpans('@a.png <point>420 380</point>x', [mark], 33)
    expect(fixed).toEqual({ text: '@a.png <point>420 380</point> x', caret: 34 })
  })

  it('两枚标签各补各的，偏移与光标一起算对', () => {
    const spans: ChipSpan[] = [
      { at: 0, token: '@a.ts' },
      { at: 5, token: '@b.ts' },
    ]
    const fixed = separatedSpans('@a.ts@b.tsx', spans, 12)
    expect(fixed).toEqual({ text: '@a.ts @b.ts x', caret: 14 })
  })

  it('界面与值对不上（那个位置不是这串字符）就不猜，留给下一次重画', () => {
    expect(separatedSpans('完全不同的值', [hero], 3)).toBeNull()
  })

  it('补过之后再跑一次不再补（幂等，绝不越补越长）', () => {
    const once = separatedSpans('看看 @hero.pngabc', [hero], 16)
    expect(once).not.toBeNull()
    expect(separatedSpans(once!.text, [{ at: 3, token: '@hero.png' }], once!.caret)).toBeNull()
  })
})

describe('接线：读回值那一步补分隔，删除那一步对账', () => {
  it('`onInput` 与合成结束都走同一个读回（补分隔只有一条路）', () => {
    const input = read(INPUT)
    expect(input).toContain('onInput={readBack}')
    expect(input).toMatch(/onCompositionEnd=\{\(\) => \{[\s\S]{0,220}?readBack\(\)/)
  })

  it('读回值里真调了 `separatedSpans`（而不是只在别处导入了它）', () => {
    const input = read(INPUT)
    const from = input.indexOf('const readBack = useCallback(')
    expect(from, '输入面应有 readBack').toBeGreaterThan(-1)
    const body = input.slice(from, input.indexOf('}, [apply, report])', from))
    expect(body).toContain('separatedSpans(')
    // 合成期间不许动 DOM：那一支必须由 `composing` 挡着。
    expect(body).toContain('composing.current')
  })

  it('删整枚之前，值里那枚记号要与界面上这枚标签是同一串字符', () => {
    const input = read(INPUT)
    const from = input.indexOf('const deleteNeighbourChip = useCallback(')
    const body = input.slice(from, input.indexOf('[apply],', from))
    expect(body).toContain('chipSpans(host)')
    expect(body).toMatch(/chip\.token === atom\.reference\.id/)
  })
})
