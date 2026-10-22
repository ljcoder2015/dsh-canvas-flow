/**
 * dsh-canvas — 文本节点的 PDF 生成（矢量、文字可选中可搜索）。
 *
 * 不再是「打印 → 另存为 PDF」那一套（隐藏 iframe + `window.print()`）：这里直接排出
 * PDF 字节，交给 `downloadBytes` 落盘。排版自己做而不借 pdf-lib 的 `maxWidth`——它只按
 * 空格断行，中文整段不会折。
 *
 * 字体是仓库里 vendored 的 Noto Sans SC（`assets/fonts/`，OFL），经宿主的
 * `/dsh-canvas/assets` 路由取回，以**子集**嵌入：二十来字的文本只带走用到的那些字形，
 * 产物几 KB 而不是十几 MB。粗体与斜体是仿的（同一位置重描一遍 / `xSkew` 斜切）——仓库里
 * 只有这一个字重的 CJK 字体，没有真粗体可嵌。
 *
 * 一半是纯函数（切原子、折行、块样式），node 环境可测；`loadPdfFontBytes` 碰 fetch 与宿主
 * 路由，只在浏览器里跑。
 */
import * as fontkitNS from '@pdf-lib/fontkit'
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import { ASSET_BASE } from '../../artifact/viewers/design/design-canvaskit.ts'
import type { InlineRun, TextBlock } from './text-export.ts'

// ── 版面常量（A4 纵向，单位 pt） ────────────────────────────────────────────
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 54
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
/** 正文字号与行距；标题按级数放大；代码块另用一组小一点的数。 */
const BODY_SIZE = 10.5
const BODY_LEADING = BODY_SIZE * 1.72
const HEADING_SIZES = [19, 16, 14, 12.5, 11.5, 11]
const CODE_SIZE = 9
const CODE_LEADING = CODE_SIZE * 1.6
const CODE_PAD = 8
/** 列表每层缩进、引用块左缩进、列表符号与正文之间的间隔。 */
const LIST_STEP = 14
const QUOTE_INDENT = 12
const MARKER_GAP = 13

const INK: RGB = rgb(0.09, 0.1, 0.12)
const MUTED: RGB = rgb(0.42, 0.44, 0.47)
const RULE: RGB = rgb(0.78, 0.8, 0.83)
const CODE_BG: RGB = rgb(0.955, 0.96, 0.97)
const CODE_INK: RGB = rgb(0.24, 0.26, 0.3)

/** CJK：汉字、假名、全角形式、中日韩标点——这些逐字可断，两侧也不留空格。 */
const CJK_RE = /[\u2E80-\u9FFF\u3000-\u303F\uFE30-\uFE4F\uFF00-\uFFEF]/
/** 空白：断行的首选位置。 */
const SPACE_RE = /^\s$/

/** 一段字在版面上的形态：用什么字体、什么颜色、要不要仿粗仿斜。 */
export interface Piece {
  font: PDFFont
  color: RGB
  bold: boolean
  skew: boolean
  text: string
}

/** 排版原子：一截不断开的字，带着它的宽度与「之后能否断行」。 */
export interface Cell {
  text: string
  width: number
  /** 这个原子的**后面**可以断行（空格、CJK 逐字、硬拆出来的块）。 */
  breakable: boolean
  /** 回指它属于哪个 `Piece`（决定用什么字体与颜色画）。 */
  piece: number
}

/** 折好的一行：行内的原子，以及画它们要用的那组 `Piece`。 */
interface Row {
  cells: Cell[]
  pieces: readonly Piece[]
}

/** 段落的版式：字号、行距、前后留白、左缩进、颜色、是否整体加粗。 */
interface Style {
  size: number
  leading: number
  before: number
  after: number
  indent: number
  color: RGB
  bold: boolean
}

function styleOf(block: TextBlock): Style {
  switch (block.kind) {
    case 'heading': {
      const level = Math.min(Math.max(block.level, 1), HEADING_SIZES.length)
      const size = HEADING_SIZES[level - 1] ?? BODY_SIZE
      return { size, leading: size * 1.4, before: size * 0.95, after: size * 0.5, indent: 0, color: INK, bold: true }
    }
    case 'quote':
      return {
        size: BODY_SIZE,
        leading: BODY_LEADING,
        before: 4,
        after: 6,
        indent: QUOTE_INDENT,
        color: MUTED,
        bold: false,
      }
    case 'bullet':
    case 'ordered':
      return {
        size: BODY_SIZE,
        leading: BODY_LEADING,
        before: 1,
        after: 1,
        indent: QUOTE_INDENT + block.depth * LIST_STEP + MARKER_GAP,
        color: INK,
        bold: false,
      }
    case 'code':
      return { size: CODE_SIZE, leading: CODE_LEADING, before: 6, after: 8, indent: 0, color: INK, bold: false }
    default:
      return { size: BODY_SIZE, leading: BODY_LEADING, before: 3, after: 5, indent: 0, color: INK, bold: false }
  }
}

/** 纯 ASCII 才敢交给 Courier：标准 14 号字只有 WinAnsi 编码，中文进去直接抛错。 */
function isAscii(text: string): boolean {
  return /^[\u0020-\u007E]*$/.test(text)
}

/** 把一行行内 run 变成一段段可绘制的字。 */
function piecesOf(runs: readonly InlineRun[], body: PDFFont, mono: PDFFont, style: Style): Piece[] {
  const pieces: Piece[] = []
  for (const run of runs) {
    if (run.text === '') continue
    const code = run.code === true
    pieces.push({
      font: code && isAscii(run.text) ? mono : body,
      color: code ? CODE_INK : style.color,
      bold: style.bold || run.bold === true,
      skew: run.italic === true,
      text: run.text,
    })
  }
  return pieces
}

/**
 * 切出排版原子。
 *
 * 断点规则只有两条：空格与 CJK 之后可以断，拉丁词内部不能断。**拉丁词里再塞断点**是常见的
 * 偷懒做法，但那样 `dsh-canvas` 会断成 `dsh-` / `canvas`，读起来像两个词。整词放不下时退回
 * 按字符硬拆（见下），所以超长 URL 也不会顶出页面。
 */
export function cellsOf(pieces: readonly Piece[], size: number, maxWidth: number): Cell[] {
  const cells: Cell[] = []
  pieces.forEach((piece, index) => {
    const measure = (text: string): number => piece.font.widthOfTextAtSize(text, size)
    let word = ''

    /** 收掉攒着的拉丁词：放得下就整词成一个原子，放不下就按字符硬拆。 */
    const flush = (): void => {
      if (word === '') return
      if (measure(word) <= maxWidth) {
        cells.push({ text: word, width: measure(word), breakable: false, piece: index })
      } else {
        let chunk = ''
        for (const char of word) {
          if (chunk !== '' && measure(chunk + char) > maxWidth) {
            cells.push({ text: chunk, width: measure(chunk), breakable: true, piece: index })
            chunk = ''
          }
          chunk += char
        }
        if (chunk !== '') cells.push({ text: chunk, width: measure(chunk), breakable: false, piece: index })
      }
      word = ''
    }

    for (const char of piece.text) {
      if (CJK_RE.test(char) || SPACE_RE.test(char)) {
        flush()
        cells.push({ text: char, width: measure(char), breakable: true, piece: index })
      } else {
        word += char
      }
    }
    flush()
  })
  return cells
}

/**
 * 贪婪折行。
 *
 * 放不下时看行尾能不能断：能断就地收行；不能断（断在拉丁词中间）就把那一截未完成的词整个挪
 * 到下一行——不退这一步，`inside` 会被切成 `insi` / `de`。
 */
export function wrapCells(cells: readonly Cell[], maxWidth: number): Cell[][] {
  const lines: Cell[][] = []
  let line: Cell[] = []
  let width = 0

  for (const cell of cells) {
    // 挪到下一行之后可能仍然放不下（挪下来的是一整串断不开的字），所以一直退到放得下为止。
    while (line.length > 0 && width + cell.width > maxWidth) {
      let cut = line.length
      while (cut > 0 && line[cut - 1]?.breakable !== true) cut -= 1
      const tail = cut > 0 ? line.splice(cut) : []
      lines.push(line)
      line = tail
      width = tail.reduce((sum, item) => sum + item.width, 0)
    }
    line.push(cell)
    width += cell.width
  }
  if (line.length > 0) lines.push(line)
  return lines
}

/**
 * 取到真正的 fontkit 对象。
 *
 * 这个包有两条入口，形状不一样：`main` 的 `fontkit.umd.js` 是 CJS，成员摊在顶层；
 * `module` 的 `fontkit.es.js` **只有一个 `export default fontkit`**。esbuild 打浏览器包走
 * 后者，`import * as` 拿到的命名空间里于是只有一个 `default` —— 摊平之后 `create` 是空的，
 * 一按就报 `base.create is not a function`；而 vitest 走前者，命名空间本来就是摊平的，单测
 * 全绿。两条入口都得认，所以这里认一次形状：扁的直接用，只有 `default` 的摊开一层。
 */
export function unwrapFontkit(namespace: typeof fontkitNS): typeof fontkitNS {
  const wrapped = namespace as typeof fontkitNS & { default?: typeof fontkitNS }
  return typeof wrapped.create === 'function' ? wrapped : (wrapped.default ?? wrapped)
}

const fontkit = unwrapFontkit(fontkitNS)

/**
 * 给 fontkit 的子集补一处 `loca` 修正。
 *
 * fontkit 1.x 的 `loca.preEncode`（`node_modules/@pdf-lib/fontkit/dist/fontkit.umd.js`）在把
 * 偏移写进**短格式** loca 之前会做一次 `>>= 1`——短格式按「偏移 ÷ 2」存，前提是偏移都是
 * 偶数。而 Noto Sans SC 的字形长度常常是奇数（它的 `head.indexToLocFormat` 本就是 1，长格式，
 * 允许奇数）。奇数偏移被砍掉最低位之后，**从那里往后的每个字形都错位一个字节**，渲染器读到
 * 的是一截截断的轮廓：文字提取仍然正常（`ToUnicode` 是对的）、字体结构看着也正常，但画面上
 * 只剩下那几个恰好落在偶数边界的字形。
 *
 * 后门就在 `preEncode` 的第一行：`version` 已经有值时它直接返回。`TTFSubset.encode` 随后又把
 * `head.indexToLocFormat` 写成 `loca.version`，所以只要在编码之前把 `version` 预置成 1，偏移
 * 就按 uint32 原样写出、一个字节不丢。`subset.loca` 是 `encode()` 每次重新赋值的普通属性，
 * 因此拦在**赋值**上而不是某个属性值上。
 */
function fontkitWithLocaFix(base: typeof fontkit): typeof fontkit {
  return {
    ...base,
    create(buffer: Uint8Array, postscriptName?: string) {
      const font = base.create(buffer, postscriptName)
      const createSubset = font.createSubset.bind(font)
      font.createSubset = () => {
        const subset = createSubset()
        let store: { offsets: number[]; version?: number } | undefined
        Object.defineProperty(subset, 'loca', {
          configurable: true,
          get: () => store,
          set: (value: { offsets: number[]; version?: number }) => {
            value.version = 1
            store = value
          },
        })
        return subset
      }
      return font
    },
  }
}

async function fetchPdfFontBytes(): Promise<Uint8Array> {
  const response = await fetch(`${ASSET_BASE}/NotoSansSC-Regular.ttf`)
  if (!response.ok) throw new Error(`pdf font unavailable: ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

let fontBytesInflight: Promise<Uint8Array> | undefined

/** 取回内嵌字体。与渲染器共用宿主的资产路由，那条路由带 immutable 缓存，且这里只取一次。 */
export async function loadPdfFontBytes(): Promise<Uint8Array> {
  fontBytesInflight ??= fetchPdfFontBytes().catch((error: unknown) => {
    // 失败不缓存：下一次导出还值得再试一遍（资产可能刚补上）。
    fontBytesInflight = undefined
    throw error
  })
  return fontBytesInflight
}

/** 逐行往下铺的游标：`y` 是下一行的基线，见底就换页。 */
class Sheet {
  private page: PDFPage
  private y = PAGE_HEIGHT - MARGIN

  constructor(private readonly doc: PDFDocument) {
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  }

  /** 预留一段高度；这一页装不下就换一页。 */
  reserve(height: number): void {
    if (this.y - height >= MARGIN) return
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.y = PAGE_HEIGHT - MARGIN
  }

  /** 在给定基线上画一段字（不动游标）——折行与行首符号共用这段。 */
  paint(cells: readonly Cell[], pieces: readonly Piece[], size: number, left: number, baseline: number): void {
    let x = left
    for (const cell of cells) {
      const piece = pieces[cell.piece]
      if (piece === undefined) continue
      this.page.drawText(cell.text, {
        x,
        y: baseline,
        size,
        font: piece.font,
        color: piece.color,
        ...(piece.skew ? { xSkew: degrees(12) } : {}),
      })
      // 仿粗体：向右错开一丝重描一遍（只叠同一位置的话只会更黑，看不出粗）。
      if (piece.bold) {
        this.page.drawText(cell.text, {
          x: x + size * 0.03,
          y: baseline,
          size,
          font: piece.font,
          color: piece.color,
        })
      }
      x += cell.width
    }
  }

  /** 画一行并下移一行；返回这一行的基线（贴行的装饰要用）。 */
  line(row: Row, size: number, leading: number, left: number): number {
    this.reserve(leading)
    const baseline = this.y - size
    this.paint(row.cells, row.pieces, size, left, baseline)
    this.y -= leading
    return baseline
  }

  /** 画一块灰底（代码块用）；`top` 是它的上边缘。 */
  panel(left: number, width: number, top: number, height: number): void {
    this.page.drawRectangle({ x: left, y: top - height, width, height, color: CODE_BG })
  }

  /** 画一段竖条（引用块的行首装饰）。 */
  bar(x: number, top: number, height: number): void {
    this.page.drawRectangle({ x, y: top - height, width: 1.6, height, color: RULE })
  }

  get cursor(): number {
    return this.y
  }

  set cursor(value: number) {
    this.y = value
  }
}

/** 把一个块折成若干行。代码块逐行折（每行自己一组字体），其余块整体折。 */
function rowsOf(block: TextBlock, style: Style, body: PDFFont, mono: PDFFont): Row[] {
  const width = CONTENT_WIDTH - style.indent

  if (block.kind === 'code') {
    const inner = width - CODE_PAD * 2
    const rows: Row[] = []
    for (const line of block.lines) {
      const pieces = piecesOf([{ text: line }], body, mono, style)
      for (const cells of wrapCells(cellsOf(pieces, style.size, inner), inner)) rows.push({ cells, pieces })
    }
    return rows.length > 0 ? rows : [{ cells: [], pieces: [] }]
  }

  const pieces = piecesOf(block.runs, body, mono, style)
  const lines = wrapCells(cellsOf(pieces, style.size, width), width)
  return lines.map((cells): Row => ({ cells, pieces }))
}

/**
 * 排出一份 PDF。
 *
 * 分页是「一行一行往下铺、铺不下就换页」——不做整段搬迁，所以长段落可以自然地跨页，代码块的
 * 灰底与引用块的竖条也各自跟着自己的行走。
 */
export async function pdfBytes({
  title,
  blocks,
  fontBytes,
}: {
  title: string
  blocks: readonly TextBlock[]
  fontBytes: Uint8Array
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkitWithLocaFix(fontkit))
  if (title !== '') doc.setTitle(title)
  const body = await doc.embedFont(fontBytes, { subset: true })
  const mono = await doc.embedFont(StandardFonts.Courier)
  const sheet = new Sheet(doc)
  /** 有序表的当前号，按层存；穿插别的块就清空（与 txt 导出的语义一致）。 */
  const ordered: number[] = []

  for (const block of blocks) {
    const style = styleOf(block)

    let marker = ''
    if (block.kind === 'ordered') {
      ordered.length = block.depth + 1
      ordered[block.depth] = (ordered[block.depth] ?? 0) + 1
      marker = `${ordered[block.depth]}.`
    } else {
      if (block.kind === 'bullet') marker = '•'
      ordered.length = 0
    }

    const rows = rowsOf(block, style, body, mono)
    const left = MARGIN + style.indent
    sheet.cursor -= style.before

    if (block.kind === 'code') {
      const height = rows.length * style.leading + CODE_PAD * 2
      // 比一整页还高的代码块无从分页，只能让它溢出去——总比无限换页好。
      if (height <= PAGE_HEIGHT - MARGIN * 2) sheet.reserve(height)
      const top = sheet.cursor
      sheet.panel(MARGIN, CONTENT_WIDTH, top, height)
      sheet.cursor = top - CODE_PAD
      for (const row of rows) sheet.line(row, style.size, style.leading, MARGIN + CODE_PAD)
      sheet.cursor = top - height
    } else {
      rows.forEach((row, index) => {
        const baseline = sheet.line(row, style.size, style.leading, left)
        if (block.kind === 'quote') sheet.bar(MARGIN + 3, baseline + style.size * 0.86, style.leading)
        // 列表符号只挂在第一行。
        if (index === 0 && marker !== '') {
          sheet.paint(
            [{ text: marker, width: 0, breakable: false, piece: 0 }],
            [{ font: body, color: style.color, bold: false, skew: false, text: marker }],
            style.size,
            left - MARKER_GAP,
            baseline,
          )
        }
      })
    }

    sheet.cursor -= style.after
  }

  return doc.save()
}