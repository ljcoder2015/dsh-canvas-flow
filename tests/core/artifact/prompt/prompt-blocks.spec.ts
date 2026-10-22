/**
 * The prompt-box reference scanner, the atoms it draws, and the edit-prompt
 * splitter — the pure halves of the prompt box's block rendering.
 *
 * Two invariants hold this feature up, and both are pinned here:
 *
 * 1. **Segments joined are the original text again.** The scanner cuts a prompt
 *    into «plain text» and «one mention» pieces; if joining them lost or
 *    reordered a character, the display would no longer be the user's own words.
 * 2. **Atoms joined are the original text again** — and a reference tag
 *    serializes as *the characters it was written with* (`@a.ts`, `@"my brief.md"`,
 *    `@img.png <point>420 380</point>`), never as a path re-assembled from its
 *    parts. The host's mention grammar has three shapes, so re-deriving one from
 *    the path could change the prompt that goes out by a byte. This is what makes
 *    «the tag is only painted on» mechanically true instead of a promise.
 *
 * The splitter's guarantee is the other half of the same promise: cutting a
 * draft into locator block + request and recomposing yields the draft byte for
 * byte, so packing the locator into a block can never change the prompt.
 */
import { describe, expect, it } from 'vitest'
import {
  atomsText,
  markText,
  normalizeCoordinate,
  promptAtoms,
  referenceBadge,
  referenceTypeOf,
  scanFileMentions,
  type PromptReference,
  type ReferenceFacts,
} from '../../../../src/core/artifact/prompt/prompt-blocks.ts'
import { buildEditPrompt, cutEditPrompt, splitEditPrompt, type PickTarget } from '../../../../src/core/artifact/kind/preview-picker.ts'

/** Joined segments are the original text — the scanner's invariant. */
function expectRoundTrip(text: string): void {
  const joined = scanFileMentions(text)
    .map((segment) => (segment.kind === 'text' ? segment.text : segment.token))
    .join('')
  expect(joined).toBe(text)
}

/**
 * Joining the atoms returns the text — **the invariant the whole input surface
 * rests on**. It is checked on the atom level rather than the segment level
 * because a mark merges two segments into one atom: if that merge swallowed or
 * duplicated a character, only this check would see it.
 */
function expectAtomRoundTrip(text: string, facts?: Record<string, ReferenceFacts>): void {
  expect(atomsText(promptAtoms(text, facts))).toBe(text)
}

/** The reference atoms of a prompt — the ones a caller's facts can reach. */
function refsOf(text: string, facts?: Record<string, ReferenceFacts>): PromptReference[] {
  return promptAtoms(text, facts)
    .filter((atom): atom is { kind: 'ref'; reference: PromptReference } => atom.kind === 'ref')
    .map((atom) => atom.reference)
}

/** The single reference atom of a prompt, for the many one-reference cases. */
function onlyRef(text: string, facts?: Record<string, ReferenceFacts>): PromptReference {
  const refs = refsOf(text, facts)
  expect(refs).toHaveLength(1)
  return refs[0]!
}

describe('scanFileMentions', () => {
  it('passes plain text through as one segment', () => {
    expect(scanFileMentions('no mentions here')).toEqual([{ kind: 'text', text: 'no mentions here' }])
  })

  it('cuts a bare mention out of the text', () => {
    const segments = scanFileMentions('see @notes/plan.md for detail')
    expect(segments).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'file', token: '@notes/plan.md', path: 'notes/plan.md', name: 'plan.md', quote: 'none' },
      { kind: 'text', text: ' for detail' },
    ])
  })

  it('recognizes a mention at the very start', () => {
    const segments = scanFileMentions('@brief.md')
    expect(segments).toEqual([
      { kind: 'file', token: '@brief.md', path: 'brief.md', name: 'brief.md', quote: 'none' },
    ])
  })

  it('cuts the quoted form, quotes and all', () => {
    const segments = scanFileMentions('@"my brief.md" plus text')
    expect(segments[0]).toEqual({
      kind: 'file',
      token: '@"my brief.md"',
      path: 'my brief.md',
      name: 'my brief.md',
      quote: 'closed',
    })
  })

  it('reads the open-quote directory form to the end of the line', () => {
    const segments = scanFileMentions('@"my site/\nnext line')
    expect(segments).toEqual([
      { kind: 'file', token: '@"my site/', path: 'my site/', name: 'my site/', quote: 'open' },
      { kind: 'text', text: '\nnext line' },
    ])
  })

  it('keeps a directory mention trailing slash in the display name', () => {
    const segments = scanFileMentions('@site/assets/')
    expect(segments[0]).toEqual({
      kind: 'file',
      token: '@site/assets/',
      path: 'site/assets/',
      name: 'assets/',
      quote: 'none',
    })
  })

  it('ignores an @ that does not start a token', () => {
    // 词中的 @（邮箱、装饰符）不是引用；空 @ 也不是。
    expect(scanFileMentions('mail me at foo@bar.com')).toEqual([
      { kind: 'text', text: 'mail me at foo@bar.com' },
    ])
    expect(scanFileMentions('a @ b')).toEqual([{ kind: 'text', text: 'a @ b' }])
    expectRoundTrip('mail me at foo@bar.com')
  })

  it('renders a token the grammar cannot carry as plain text', () => {
    // 控制字符进不了 @file 语法——这种「记号」宁可不作块。
    expect(scanFileMentions('@bad\u0000path')).toEqual([{ kind: 'text', text: '@bad\u0000path' }])
    expectRoundTrip('@bad\u0000path')
  })

  it('scans several mentions in one prompt', () => {
    const segments = scanFileMentions('@a.md and @"b c.md"')
    expect(segments.filter((segment) => segment.kind === 'file')).toHaveLength(2)
    expectRoundTrip('@a.md and @"b c.md"')
  })
})

describe('referenceTypeOf', () => {
  it('classifies by extension, case-insensitively', () => {
    // 判据只有一份、写在路径里：调用方手上那张卡可能已经离开画布，扩展名却还在。
    expect(referenceTypeOf('hero.png')).toBe('image')
    expect(referenceTypeOf('shots/HERO.PNG')).toBe('image')
    expect(referenceTypeOf('icon.svg')).toBe('image')
    expect(referenceTypeOf('clip.mp4')).toBe('video')
    expect(referenceTypeOf('voice.m4a')).toBe('audio')
  })

  it('calls everything else code — including a path with no extension', () => {
    // 兜底是 `code` 而不是「未知」：六类之外的一切都是「一份文件」，标签照画不误。
    expect(referenceTypeOf('src/core/board.ts')).toBe('code')
    expect(referenceTypeOf('README.md')).toBe('code')
    expect(referenceTypeOf('site/assets/')).toBe('code')
    expect(referenceTypeOf('Makefile')).toBe('code')
  })

  it('reads the last extension, not the first', () => {
    // `archive.tar.gz` 是 `gz`——一个路径只归一类，取最后那一段才是它的类型。
    expect(referenceTypeOf('archive.tar.gz')).toBe('code')
    expect(referenceTypeOf('export.mp4.png')).toBe('image')
  })
})

describe('promptAtoms', () => {
  it('passes plain text through, and cuts a mention out of it', () => {
    expect(promptAtoms('no mentions here')).toEqual([{ kind: 'text', text: 'no mentions here' }])
    expect(promptAtoms('see @notes/plan.md for detail')).toEqual([
      { kind: 'text', text: 'see ' },
      {
        kind: 'ref',
        reference: { id: '@notes/plan.md', type: 'code', label: 'plan.md', filePath: 'notes/plan.md' },
      },
      { kind: 'text', text: ' for detail' },
    ])
  })

  it('carries the token as written — quotes and all — never a path re-derived from parts', () => {
    // 这是整件事的地基：宿主记号有三种形态，从 `filePath` 反推不出用户写的是哪一种。
    const quoted = onlyRef('@"my brief.md"')
    expect(quoted.id).toBe('@"my brief.md"')
    expect(quoted.filePath).toBe('my brief.md')
    expect(quoted.label).toBe('my brief.md')

    const open = onlyRef('@"my site/')
    expect(open.id).toBe('@"my site/')
    expect(open.filePath).toBe('my site/')
    expect(open.label).toBe('my site/')
  })

  it('keeps a directory mention trailing slash in its display name', () => {
    expect(onlyRef('@site/assets/').label).toBe('assets/')
  })

  it('labels by file name, so two same-named files stay tellable apart', () => {
    // 文档那套 `@图片1` 序号属于「图片另走一路」的设计；本插件的锚点就是路径，
    // 所以标签写文件名，两枚同名的靠 id（各自的路径）分辨。
    const refs = refsOf('@a/hero.png @b/hero.png')
    expect(refs.map((reference) => reference.label)).toEqual(['hero.png', 'hero.png'])
    expect(refs.map((reference) => reference.id)).toEqual(['@a/hero.png', '@b/hero.png'])
  })

  it('types by extension without being told', () => {
    expect(onlyRef('@hero.png').type).toBe('image')
    expect(onlyRef('@clip.mp4').type).toBe('video')
    expect(onlyRef('@voice.mp3').type).toBe('audio')
    expect(onlyRef('@board.ts').type).toBe('code')
  })

  it('takes the facts the extension cannot know: type, lines, thumbnail', () => {
    const facts: Record<string, ReferenceFacts> = {
      'board.ts': { startLine: 10, endLine: 25 },
      'marker.dat': { type: 'image', thumbnail: 'data:image/png;base64,AAA' },
      'unused.ts': { startLine: 1 },
    }
    expect(onlyRef('@board.ts', facts)).toMatchObject({ type: 'code', startLine: 10, endLine: 25 })
    expect(onlyRef('@marker.dat', facts)).toMatchObject({
      type: 'image',
      thumbnail: 'data:image/png;base64,AAA',
    })
    // 事实表里多出来的键（这里 `unused.ts`）不动任何一枚标签。
    expect(onlyRef('@board.ts', facts).thumbnail).toBeUndefined()
  })

  it('opens a one-line range into a range when only the first line is known', () => {
    // `startLine` 有、`endLine` 没给：说的是「这一行」，不是「从这里到无穷」。
    expect(onlyRef('@a.ts', { 'a.ts': { startLine: 7 } })).toMatchObject({ startLine: 7, endLine: 7 })
  })

  it('shows no badge at all for a whole-file reference', () => {
    // 今天绝大多数引用就是引整份产物——不挂一枚 `1-∞` 之类的假徽标。
    expect(referenceBadge(onlyRef('@board.ts'))).toBeUndefined()
    expect(referenceBadge(onlyRef('@hero.png'))).toBeUndefined()
  })
})

describe('marks — a point or a box on one image', () => {
  it('writes the coordinate tag the document specifies', () => {
    expect(markText({ target: '@hero.png', point: [420, 380] })).toBe('@hero.png <point>420 380</point>')
    expect(markText({ target: '@hero.png', bbox: [10, 20, 300, 400] })).toBe(
      '@hero.png <bbox>10 20 300 400</bbox>',
    )
    // 一个标记说一件事：又给点又给框时，框更大，听框的。
    expect(markText({ target: '@hero.png', point: [1, 2], bbox: [10, 20, 300, 400] })).toBe(
      '@hero.png <bbox>10 20 300 400</bbox>',
    )
    expect(markText({ target: '@hero.png' })).toBeUndefined()
  })

  it('merges the tag into the mention it follows — one atom, not two', () => {
    // 构造（`markText`）与解析（`promptAtoms`）共用一份语法，这里钉住两者对得上。
    const written = markText({ target: '@hero.png', point: [420, 380] })!
    // 两段（记号 + 坐标标签）合成**一枚**原子——这是它与「一枚引用 + 用户写的一行字」
    // 的区别所在，也是原子删除只需删一个 DOM 节点的原因。
    expect(promptAtoms(written)).toHaveLength(1)
    const reference = onlyRef(written)
    expect(reference.type).toBe('mark')
    expect(reference.id).toBe(written)
    expect(reference.target).toBe('@hero.png')
    expect(reference.filePath).toBe('hero.png')
    expect(reference.label).toBe('hero.png')
    expect(reference.point).toEqual([420, 380])
    expect(referenceBadge(reference)).toBe('420 380')
  })

  it('reads a box as a region', () => {
    const reference = onlyRef('@shot.png <bbox>0 0 999 999</bbox>')
    expect(reference.type).toBe('region')
    expect(reference.bbox).toEqual([0, 0, 999, 999])
    expect(referenceBadge(reference)).toBe('0 0 999 999')
  })

  it('leaves the rest of the line alone', () => {
    const atoms = promptAtoms('@hero.png <point>420 380</point> 改成蓝色')
    expect(atoms.map((atom) => atom.kind)).toEqual(['ref', 'text'])
    expect((atoms[1] as { kind: 'text'; text: string }).text).toBe(' 改成蓝色')
  })

  it('only reads a tag that sits right at the mention', () => {
    // 隔着别的话就不是标记了——那是用户自己在写标签，不该被吞进一枚引用里。
    const text = '@hero.png 然后 <point>1 2</point>'
    expect(promptAtoms(text).map((atom) => atom.kind)).toEqual(['ref', 'text'])
    expect(onlyRef(text).type).toBe('image')
  })

  it('turns down a tag whose numbers do not fit its shape', () => {
    // 一个 `point` 要两个数、一个 `bbox` 要四个；数目不对宁可当普通文字，也不猜。
    expect(promptAtoms('@hero.png <point>420</point>').map((atom) => atom.kind)).toEqual(['ref', 'text'])
    expect(promptAtoms('@hero.png <bbox>1 2 3</bbox>').map((atom) => atom.kind)).toEqual(['ref', 'text'])
    // 数目对、但压根不是数的（`[\d\s.]` 根本放不进 `-`）也进不来。
    expect(promptAtoms('@hero.png <point>4a0 380</point>').map((atom) => atom.kind)).toEqual(['ref', 'text'])
  })
})

describe('normalizeCoordinate', () => {
  it('turns a 0–1 fraction into the 0–999 integer the grammar speaks', () => {
    expect(normalizeCoordinate(0)).toBe(0)
    expect(normalizeCoordinate(0.5)).toBe(500)
    expect(normalizeCoordinate(1)).toBe(999)
  })

  it('clamps anything outside, and gives up on a non-number', () => {
    expect(normalizeCoordinate(-0.2)).toBe(0)
    expect(normalizeCoordinate(1.4)).toBe(999)
    expect(normalizeCoordinate(Number.NaN)).toBe(0)
    expect(normalizeCoordinate(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('atomsText — the invariant: the atoms are the text', () => {
  const TEXTS = [
    '',
    'plain prompt with no reference',
    '@brief.md',
    '@"my brief.md" plus text',
    '@"my site/\nnext line',
    '@site/assets/ 里的图换成新的',
    '@a.md and @"b c.md"',
    'mail me at foo@bar.com',
    'a @ b',
    '@bad\u0000path',
    '@a.png <point>0 0</point>',
    '@hero.png <point>420 380</point> 改成蓝色',
    '@shot.png <bbox>10 20 300 400</bbox>',
    '@hero.png <point>420</point>',
    '@one.ts\n@two.png',
    '@hero.png <point>1 2</point>@next.ts',
  ]

  it('round-trips every shape of token, byte for byte', () => {
    // 一条判据管住整张输入面：标签写出去的永远是它自己那串字符。它要是不成立，
    // 「显示成标签」这件事就可能悄悄改掉用户发出去的提示词。
    for (const text of TEXTS) expectAtomRoundTrip(text)
  })

  it('round-trips just the same when facts are in play', () => {
    // 事实只改**画法**（图标、缩略图、徽标），一个字符都不进值——所以往返照旧成立。
    const facts: Record<string, ReferenceFacts> = {
      'hero.png': { thumbnail: 'data:image/png;base64,AAA', label: '主视觉.png' },
      'one.ts': { startLine: 3, endLine: 9 },
    }
    for (const text of TEXTS) expectAtomRoundTrip(text, facts)
  })

  it('never puts a fact into the value it stands for', () => {
    // 反过来说：给了缩略图与行号之后，值里也不许多出任何东西。
    const facts: Record<string, ReferenceFacts> = { 'one.ts': { startLine: 3, endLine: 9 } }
    expect(atomsText(promptAtoms('@one.ts', facts))).toBe('@one.ts')
  })
})

const TARGET: PickTarget = {
  label: 'section.hero',
  selector: 'body > section.hero',
  html: '<section class="hero"><h1>Hi</h1></section>',
  truncated: false,
  shadow: false,
  rect: { left: 0, top: 0, width: 10, height: 10 },
}

describe('splitEditPrompt', () => {
  it('cuts a built prompt into locator block and request, and recomposes byte for byte', () => {
    const request = '把标题改小一号'
    const text = buildEditPrompt({ file: 'site/index.html', target: TARGET, request })
    const split = splitEditPrompt({ file: 'site/index.html', target: TARGET, text })
    expect(split).toBeDefined()
    expect(split!.request).toBe(request)
    expect(split!.head + split!.request).toBe(text)
  })

  it('ends the head with the request marker itself', () => {
    const text = buildEditPrompt({ file: 'site/index.html', target: TARGET, request: '' })
    const split = splitEditPrompt({ file: 'site/index.html', target: TARGET, text })
    expect(split!.head.endsWith('改动要求：')).toBe(true)
  })

  it('accepts any request text, including one that repeats the marker', () => {
    const request = '先做 A。改动要求：见下一条'
    const text = buildEditPrompt({ file: 'site/index.html', target: TARGET, request })
    const split = splitEditPrompt({ file: 'site/index.html', target: TARGET, text })
    expect(split!.request).toBe(request)
    expect(split!.head + split!.request).toBe(text)
  })

  it('returns undefined for a text the builder did not write', () => {
    expect(splitEditPrompt({ file: 'site/index.html', target: TARGET, text: '随便一句话' })).toBeUndefined()
    const text = buildEditPrompt({ file: 'site/index.html', target: TARGET, request: '' })
    // 前缀被改过（比如有人手工删掉了定位行）——宁可不作块，也不猜。
    expect(splitEditPrompt({ file: 'site/index.html', target: TARGET, text: text.slice(10) })).toBeUndefined()
  })

  it('refuses a draft built for a different file', () => {
    const text = buildEditPrompt({ file: 'other/index.html', target: TARGET, request: 'x' })
    expect(splitEditPrompt({ file: 'site/index.html', target: TARGET, text })).toBeUndefined()
  })
})

describe('cutEditPrompt — 拿草稿自己那段原文来切', () => {
  it('只吃一段 head：切出来的两半拼回去还是原文', () => {
    const head = buildEditPrompt({ file: '应用1/index.html', target: TARGET, request: '' })
    const text = head + '把标题改小一号'
    const split = cutEditPrompt({ head, text })
    expect(split).toEqual({ head, request: '把标题改小一号' })
    expect(split!.head + split!.request).toBe(text)
  })

  it('对不上就不切（有人动过定位原文）', () => {
    const head = buildEditPrompt({ file: '应用1/index.html', target: TARGET, request: '' })
    expect(cutEditPrompt({ head, text: head.slice(3) })).toBeUndefined()
    expect(cutEditPrompt({ head, text: '随便一句话' })).toBeUndefined()
  })

  it('换了 head 就切不动——「卡片 id ≠ 产物路径」踩的正是这一脚', () => {
    // 真机上就是这个样子：草稿按产物路径生成，切分时却递了卡片 id（`qkxwvd`）。前缀永远
    // 对不上，于是标签一次也没画出来过、用户看见的始终是纯文本。换成「谁生成的草稿谁把
    // head 留着、切分时原样递回」，同一个东西就不再有两个来源。
    const text = buildEditPrompt({ file: '应用1/index.html', target: TARGET, request: '改成蓝色' })
    const byCardId = buildEditPrompt({ file: 'qkxwvd', target: TARGET, request: '' })
    expect(cutEditPrompt({ head: byCardId, text })).toBeUndefined()
    const same = buildEditPrompt({ file: '应用1/index.html', target: TARGET, request: '' })
    expect(cutEditPrompt({ head: same, text })!.request).toBe('改成蓝色')
  })
})

/** 一枚元素标签，只给长相：`id` 一律由原文覆盖（下面第一条判据就是它）。 */
const ELEMENT: PromptReference = { id: '', type: 'element', label: 'section.hero' }

/**
 * 折叠（`PromptFold`）：元素选择那条路把「产物 + 节点 + 位置 + 源码」一整段定位写进提示词，
 * 输入面把它折成一枚**元素标签**——多模态引用的第四种长相。这里钉住三件事：
 *
 * 1. 折进去的那一段，序列化时吐回**原文那一段**（往返逐字节），折叠因此与 `@记号` 一样
 *    只是画法，提示词一个字不动；
 * 2. token **取 `text` 上那一段，不取调用方给的 `id`**——这条不变量因此是**结构性**的，
 *    调用方 id 写错也伤不到发出去的提示词；
 * 3. 对不上的折叠（越界、长度非正、两枚重叠）按普通文本画：宁可少一枚标签，也不能把不
 *    相干的字符折进去。
 */
describe('folds — a stretch the caller already knows is a reference', () => {
  it('turns the declared stretch into one element reference, the rest stays text', () => {
    const text = '定位那一段要求改成蓝色'
    const atoms = promptAtoms(text, undefined, [{ at: 0, length: 4, reference: ELEMENT }])
    expect(atoms.map((atom) => atom.kind)).toEqual(['ref', 'text'])
    expect((atoms[0] as { kind: 'ref'; reference: PromptReference }).reference).toMatchObject({
      type: 'element',
      id: '定位那一',
    })
    expect(atomsText(atoms)).toBe(text)
  })

  it('round-trips the real thing: a whole built locator folds into one atom', () => {
    // 元素选择那条路的真实形状——几十行定位（含节点源码、反引号、换行、围栏）折成一枚。
    const text = buildEditPrompt({ file: 'site/index.html', target: TARGET, request: '把标题改小' })
    const head = splitEditPrompt({ file: 'site/index.html', target: TARGET, text })!.head
    const atoms = promptAtoms(text, undefined, [{ at: 0, length: head.length, reference: ELEMENT }])
    expect(atoms).toHaveLength(2)
    expect(atoms[0]!.kind).toBe('ref')
    expect(atoms[1]).toEqual({ kind: 'text', text: '把标题改小' })
    expect(atomsText(atoms)).toBe(text)
  })

  it('takes the token from the text, never from the id the caller passed', () => {
    const folds = [{ at: 0, length: 4, reference: { ...ELEMENT, id: '@wrong.ts' } }]
    const atoms = promptAtoms('定位原文尾巴', undefined, folds)
    expect((atoms[0] as { kind: 'ref'; reference: PromptReference }).reference.id).toBe('定位原文')
    expect(atomsText(atoms)).toBe('定位原文尾巴')
  })

  it('still reads @mentions outside the folded stretch', () => {
    const text = '定位段然后 @a.ts 拿去看'
    const atoms = promptAtoms(text, undefined, [{ at: 0, length: 3, reference: ELEMENT }])
    expect(atoms.map((atom) => atom.kind)).toEqual(['ref', 'text', 'ref', 'text'])
    expect(atomsText(atoms)).toBe(text)
  })

  it('ignores a fold that does not fit the text it is given', () => {
    const text = '短短一句'
    const cases = [
      { what: '长度为零', folds: [{ at: 0, length: 0, reference: ELEMENT }] },
      { what: '越过末尾', folds: [{ at: 0, length: 99, reference: ELEMENT }] },
      { what: '起点为负', folds: [{ at: -1, length: 2, reference: ELEMENT }] },
      {
        what: '两枚重叠',
        folds: [
          { at: 2, length: 2, reference: ELEMENT },
          { at: 3, length: 2, reference: ELEMENT },
        ],
      },
    ]
    for (const one of cases) {
      const atoms = promptAtoms(text, undefined, one.folds)
      expect(atomsText(atoms), one.what).toBe(text)
      // 越界的那些一枚都不折；重叠那一对被先到的那枚吃掉，后面的按文本画。
      expect(atoms.filter((atom) => atom.kind === 'ref').length, one.what).toBeLessThanOrEqual(1)
    }
  })
})
