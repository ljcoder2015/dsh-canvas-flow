/**
 * 文本节点的 PDF 生成（`client/canvas/text-pdf.ts`）。
 *
 * `pdfBytes` 是异步的，但只在内存里排版——不碰 fetch、不碰 DOM——所以 node 环境里跑得动：
 * 字体字节直接从 `assets/fonts/` 读进来喂给它，产出的字节再用 `PDFDocument.load` 读回去。
 * 下载那一半（`loadPdfFontBytes` / `downloadBytes`）只认宿主的资产路由，留到浏览器里验。
 *
 * 这里钉的是**一改就静默坏掉**的几件事：
 *
 * 1. **子集嵌入不是「顺便」而是必须**：整嵌一份 17 MB 的 CJK 字体，会派生出十几 MB 的 PDF。
 *    所以断言内嵌的字体程序真的是一份 sfnt，又比母体小几个数量级。
 * 2. **`loca` 必须是长格式**（`head.indexToLocFormat === 1`）。fontkit 1.x 的子集器在短格式
 *    分支里把偏移 `>>= 1`，碰上 Noto Sans SC 的奇数偏移就会**从那里往后整段错位一个字节**：
 *    文字提取正常（`ToUnicode` 是对的）、字体结构看着也正常，但画面上只剩几个恰好落在偶数
 *    边界的字形。`fontkitWithLocaFix` 把 `loca.version` 预置成 1 绕开了它——这条断言就是那次
 *    修补的回归线，掉了它这次排查的全部结论就白丢了。
 * 3. **断行规则**：CJK 逐字可断、拉丁词整词不可断、放不下的长词按字符硬拆。中文整段不折
 *    （或 `dsh-canvas` 被切成 `dsh-` / `canvas`）都是肉眼才看得出来、不钉就会回来的事。
 * 4. **分页**：长文要铺到第二页。
 * 5. **fontkit 的两条入口形状不一样**：`main` 的 UMD 成员摊在顶层，`module` 的 ESM 只有一个
 *    `default`。vitest 只走前者，浏览器包走后者——不管这条，就只有浏览器会报
 *    `base.create is not a function`。
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { cellsOf, pdfBytes, unwrapFontkit, wrapCells, type Cell, type Piece } from '../../../../src/client/canvas/export/text-pdf.ts'
import { textBlocksOf } from '../../../../src/client/canvas/export/text-export.ts'

/** 桩字体：一个字符 10pt，与字号无关——排版的断点规则不该关心真实度量。 */
function stubFont(): PDFFont {
  return { widthOfTextAtSize: (text: string) => text.length * 10 } as unknown as PDFFont
}

/** 造一个 `Piece`（只关心文字；字体与颜色不参与断点计算）。 */
function piece(text: string): Piece {
  return { font: stubFont(), color: rgb(0, 0, 0), bold: false, skew: false, text }
}

function cell(text: string, width: number, breakable: boolean): Cell {
  return { text, width, breakable, piece: 0 }
}

/** 只看文字：宽度与字体归属另有断言，这里读的是「断成了哪几截」。 */
const texts = (cells: readonly Cell[]): string[] => cells.map((item) => item.text)
const linesOf = (rows: readonly Cell[][]): string[] => rows.map((row) => texts(row).join(''))
const breakables = (cells: readonly Cell[]): boolean[] => cells.map((item) => item.breakable)

describe('切原子', () => {
  it('CJK 逐字成原子，拉丁词整词一个原子', () => {
    const cells = cellsOf([piece('中文abc')], 10, 1000)
    expect(texts(cells)).toEqual(['中', '文', 'abc'])
    // 汉字后面可以断，词里面不能断——否则 `dsh-canvas` 会被切成 `dsh-` / `canvas`。
    expect(breakables(cells)).toEqual([true, true, false])
    expect(cells.every((item) => item.piece === 0)).toBe(true)
  })

  it('空格自己是一个可断原子，两侧的词都不是', () => {
    const cells = cellsOf([piece('a b')], 10, 1000)
    expect(texts(cells)).toEqual(['a', ' ', 'b'])
    expect(breakables(cells)).toEqual([false, true, false])
  })

  it('放不下的长词按字符硬拆，拆出来的每一截后面都能断', () => {
    const cells = cellsOf([piece('abcdefghij')], 10, 30)
    expect(texts(cells)).toEqual(['abc', 'def', 'ghi', 'j'])
    expect(breakables(cells)).toEqual([true, true, true, false])
  })

  it('原子带着自己的宽度，且回指它属于哪一段字', () => {
    const cells = cellsOf([piece('中'), piece('abc')], 10, 1000)
    expect(cells.map((item) => item.width)).toEqual([10, 30])
    expect(cells.map((item) => item.piece)).toEqual([0, 1])
  })
})

describe('折行', () => {
  it('在可断处收行', () => {
    const rows = wrapCells([cell('中', 10, true), cell('文', 10, true), cell('测', 10, true)], 25)
    expect(linesOf(rows)).toEqual(['中文', '测'])
  })

  it('拉丁词不拆，整词挪到下一行', () => {
    const rows = wrapCells([cell('xx', 20, false), cell(' ', 10, true), cell('yy', 20, false)], 35)
    expect(linesOf(rows)).toEqual(['xx ', 'yy'])
  })

  it('挪下来的词仍放不下时继续往后退，直到它独占一行的开头', () => {
    const rows = wrapCells([cell('a', 5, true), cell('bb', 20, false), cell('cc', 20, false)], 30)
    expect(linesOf(rows)).toEqual(['a', 'bb', 'cc'])
  })

  it('一行都放不下的单个原子也不丢：它独占一行', () => {
    const rows = wrapCells([cell('很长很长', 400, false)], 100)
    expect(linesOf(rows)).toEqual(['很长很长'])
  })
})

/**
 * 这个包的两条入口形状不一样，而 vitest 只会走其中一条——所以这里不借解析器，直接把两种形状
 * 喂给那段 unwrap。少了它，浏览器里一按「PDF」就是 `base.create is not a function`：单测照样
 * 全绿，因为 node 解析到的是扁的那条入口。
 */
describe('fontkit 入口', () => {
  type Namespace = Parameters<typeof unwrapFontkit>[0]
  const flat = { create: () => undefined } as unknown as Namespace

  it('命名空间本来就是摊平的（CJS / UMD 入口）：原样用', () => {
    expect(unwrapFontkit(flat)).toBe(flat)
  })

  it('命名空间里只有 default（ESM 入口，esbuild 打浏览器包走的就是它）：摊开一层', () => {
    expect(unwrapFontkit({ default: flat } as unknown as Namespace)).toBe(flat)
  })
})

// ── 真字体：读进来排一份，再读回去验 ──────────────────────────────────────
const FONT_BYTES = new Uint8Array(
  readFileSync(new URL('../../../../assets/fonts/NotoSansSC-Regular.ttf', import.meta.url)),
)

const SFNT_MAGICS = new Set([0x00010000, 0x4f54544f, 0x74727565, 0x74746366])

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function isSfnt(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && SFNT_MAGICS.has(viewOf(bytes).getUint32(0, false))
}

/** 从 sfnt 表目录里取一张表的偏移与长度。 */
function tableOf(sfnt: Uint8Array, tag: string): { offset: number; length: number } {
  const view = viewOf(sfnt)
  const count = view.getUint16(4, false)
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 16
    const name = String.fromCharCode(sfnt[at], sfnt[at + 1], sfnt[at + 2], sfnt[at + 3])
    if (name === tag) {
      return { offset: view.getUint32(at + 8, false), length: view.getUint32(at + 12, false) }
    }
  }
  throw new Error(`sfnt 里没有 ${tag} 表`)
}

/**
 * 把排好的 PDF 读回来，并挖出内嵌的字体程序（`FontFile2` 指向的那条流）。
 *
 * 流是「第一个长得像 sfnt 的东西」：主入口正好是字体程序本身，包在 `PDFRawStream` 里，
 * 未压缩；万一是压缩的（`FlateDecode`）就解开再看。
 */
async function readBack(bytes: Uint8Array): Promise<{ doc: PDFDocument; sfnt: Uint8Array }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const stream = object as unknown as { getContents?: () => Uint8Array }
    if (typeof stream.getContents !== 'function') continue
    const raw = stream.getContents()
    if (isSfnt(raw)) return { doc, sfnt: raw }
    try {
      const inflated = inflateSync(raw)
      if (isSfnt(inflated)) return { doc, sfnt: inflated }
    } catch {
      // 不是压缩流：接着看下一个间接对象。
    }
  }
  throw new Error('PDF 里没找到内嵌的字体程序')
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

async function render(source: string, title = '笔记'): Promise<Uint8Array> {
  return pdfBytes({ title, blocks: textBlocksOf(source, true), fontBytes: FONT_BYTES })
}

describe('pdfBytes', () => {
  it('产出的是一份能被读回来的 PDF，标题落在文档属性里', async () => {
    const bytes = await render('# 标题\n\n正文一句。')
    expect(decode(bytes.subarray(0, 5))).toBe('%PDF-')
    expect(decode(bytes.subarray(-64))).toContain('%%EOF')
    const { doc } = await readBack(bytes)
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getTitle()).toBe('笔记')
  })

  it('字体是子集嵌入，且 loca 走长格式', async () => {
    const bytes = await render('中文标题 ABC 测试，标点。（括号）“引号”。')
    const { sfnt } = await readBack(bytes)
    // 子集：整份 PDF 都比母体字体小两个数量级，更别说里面那一截字体程序。
    expect(sfnt.byteLength).toBeLessThan(FONT_BYTES.byteLength / 100)
    expect(bytes.byteLength).toBeLessThan(FONT_BYTES.byteLength / 100)
    // 这一行是本轮排查的落点：短格式会把奇数偏移砍掉最低位，字形从那里起整段错位。
    expect(viewOf(sfnt).getInt16(tableOf(sfnt, 'head').offset + 50, false)).toBe(1)
    const glyphs = viewOf(sfnt).getUint16(tableOf(sfnt, 'maxp').offset + 4, false)
    expect(glyphs).toBeGreaterThan(0)
    expect(glyphs).toBeLessThan(500)
  })

  it('块级形态各有各的长相，一起排也不互相顶掉', async () => {
    const source = [
      '# 一级标题',
      '',
      '## 二级标题',
      '',
      '正文一句，后面跟一个 `行内码` 与 **粗体**。',
      '',
      '> 引用一句',
      '',
      '- 无序一项',
      '- 无序二项',
      '',
      '1. 有序第一',
      '2. 有序第二',
      '',
      '```ts',
      'const answer = 42',
      '```',
    ].join('\n')
    const bytes = await render(source)
    const { doc } = await readBack(bytes)
    expect(doc.getPageCount()).toBe(1)
  })

  it('长文铺到第二页', async () => {
    const source = Array.from(
      { length: 80 },
      (_, index) => `第 ${index + 1} 段：这一段写长一些，好让版面铺满一页再翻过去。`,
    ).join('\n\n')
    const bytes = await render(source, '长文')
    const { doc } = await readBack(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(1)
  })

  it('没有内容也产出可打开的 PDF（不设标题就真的没有标题）', async () => {
    const bytes = await pdfBytes({ title: '', blocks: [], fontBytes: FONT_BYTES })
    const { doc } = await readBack(bytes)
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getTitle() ?? '').toBe('')
  })
})