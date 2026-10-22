/**
 * `@` 引用候选与卡片名（F3.18 / F5.3 / F1.12，v1.54）。
 *
 * 两半判据：
 *
 * - **`reference-options.ts` 是纯的，这里真跑它**——它在 v1.54 之前活在 jsx 里，判据只能
 *   读源码；搬出来之后，「插入提示词的是 `@产物路径`、显示的是卡片名、缩略图走卡片 id」
 *   这三条终于各有各的真测试。它们重要，因为 v1.49 把卡片 id 与产物路径分家之后，旧实现
 *   拿 id 当路径插进提示词——那是一个**不存在的文件**，模型按它 `read` 必然落空。
 * - **jsx 里的接线**照旧用源码判据钉（这个仓库的测试环境没有 DOM）：材料行 chips 与 ⊕
 *   菜单显示卡片名、标签的显示名由 facts 覆盖。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { referenceOptions, REFERENCE_LIMIT } from '../../../../src/client/canvas/asset/reference-options.ts'
import type { ReferenceCandidate } from '../../../../src/client/canvas/asset/reference-options.ts'

const OVERLAY = readFileSync(new URL('../../../../src/client/canvas/card/card-overlay.tsx', import.meta.url), 'utf8')

/** 造一枚候选：id 是 6 位随机字母那一路（v1.49），file 是产物路径，name 是卡片名。 */
function candidate(id: string, file: string, name: string): ReferenceCandidate {
  return { id, file, name }
}

describe('候选的三个字段各是各的', () => {
  const owned = [candidate('qkxwvd', '应用1/index.html', '应用1')]
  const others = [
    candidate('mkzbtf', '文本1.md', '文本1'),
    candidate('phwgnc', '市场分析.md', '市场分析'),
  ]

  it('插入提示词的是 @产物路径，不是 @卡片 id', () => {
    const options = referenceOptions(owned, others, '')
    expect(options.map((option) => option.mention)).toEqual([
      '@应用1/index.html',
      '@文本1.md',
      '@市场分析.md',
    ])
    // id 是随机字母 ⇒ 这条断言同时在钉「id 没有混进 mention」。
    for (const option of options) expect(option.mention).not.toBe(`@${option.cardId}`)
  })

  it('显示的是卡片名——应用卡是「应用1」而不是「index.html」', () => {
    const options = referenceOptions(owned, others, '')
    expect(options.map((option) => option.label)).toEqual(['应用1', '文本1', '市场分析'])
  })

  it('缩略图那条通道拿到的是卡片 id', () => {
    const options = referenceOptions(owned, others, '')
    expect(options.map((option) => option.cardId)).toEqual(['qkxwvd', 'mkzbtf', 'phwgnc'])
  })

  it('类型按产物路径的扩展名定，不按卡片名', () => {
    const options = referenceOptions([], [candidate('abcdef', 'diagrams/图-1.svg', '图-1')], '')
    expect(options[0]?.type).toBe('image')
  })
})

describe('候选的来源与过滤', () => {
  it('已有引用来源在前、画布其余卡片在后；同一路径去重时留在前面的那一份', () => {
    const owned = [candidate('zzzzzz', 'shared.md', '共用稿')]
    const others = [
      candidate('aaaaaa', 'shared.md', '另一张卡眼里的它'),
      candidate('bbbbbb', 'next.md', '下一份'),
    ]
    const options = referenceOptions(owned, others, '')
    expect(options).toHaveLength(2)
    expect(options[0]?.fromMaterial).toBe(true)
    expect(options[0]?.cardId).toBe('zzzzzz')
    expect(options[1]?.fromMaterial).toBe(false)
  })

  it('按 mention 过滤（用户打的是那串记号），并截到上限', () => {
    const others: ReferenceCandidate[] = []
    for (let n = 1; n <= REFERENCE_LIMIT + 3; n += 1) {
      others.push(candidate(`id${String(n).padStart(6, 'x')}`, `文本${String(n)}.md`, `文本${String(n)}`))
    }
    expect(referenceOptions([], others, '')).toHaveLength(REFERENCE_LIMIT)
    const hit = referenceOptions([], others, '文本3')
    expect(hit).toHaveLength(1)
    expect(hit[0]?.path).toBe('文本3.md')
  })

  it('写不成 @ 记号的路径宁可不出现', () => {
    // 控制字符是宿主记号语法明确拒绝的那一族（`formatFileMention` 返回 undefined）。
    const options = referenceOptions([], [candidate('abcdef', 'bad\u0000name.md', '坏名字')], '')
    expect(options).toHaveLength(0)
  })
})

describe('jsx 侧的接线（源码判据）', () => {
  it('候选由「三件事」组装：材料行捎来名字与路径，画布其余卡片自带', () => {
    expect(OVERLAY).toContain('{ id: entry.cardId, file: entry.file, name: entry.name }')
    expect(OVERLAY).toContain('{ id: other.id, file: other.file, name: other.name }')
  })

  it('标签的显示名由 facts 覆盖（应用卡的产物不是 index.html 而是「应用1」）', () => {
    expect(OVERLAY).toMatch(/facts\[candidate\.file\] = \{ \.\.\.known, label: candidate\.name \}/)
  })

  it('缩略图按「路径 → 卡片 id」换算后走读产物通道', () => {
    expect(OVERLAY).toMatch(/readArtifact\(card\.project, cardIdByFile\.get\(path\) \?\? path\)/)
  })

  it('材料行 chips 与 ⊕ 菜单显示卡片名，路径只在悬停里', () => {
    // chips：显示名不是 cardId 切出来的那一段（v1.49 起 id 是 6 位随机字母，不是路径）。
    expect(OVERLAY).toContain("entry.name !== '' ? entry.name : (entry.file.split('/').pop() ?? entry.cardId)")
    expect(OVERLAY).not.toMatch(/entry\.cardId\.split\('\/'\)/)
    // ⊕ 菜单：一行显示的是 other.name，id 只作 key 与落点。
    expect(OVERLAY).toContain("other.name !== '' ? other.name : (other.file.split('/').pop() ?? other.id)")
    expect(OVERLAY).not.toMatch(/other\.id\.split\('\/'\)/)
    // 悬停给的是产物路径。
    expect(OVERLAY).toMatch(/title=\{other\.file\}/)
  })
})
