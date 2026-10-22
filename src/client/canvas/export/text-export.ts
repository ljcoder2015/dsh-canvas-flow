/**
 * dsh-canvas — 文本节点的客户端本地导出（md / txt / docx / PDF）。
 *
 * 文本节点的产物就是它自己的文字（`isDirectTextKind` 那两种 kind），所以导出不必绕宿主
 * 那条部署能力接缝：浏览器里直接生成文件、触发一次下载就完事。wire 契约上的
 * `ExportFormat` 是冻结的（宿主那条接缝只认那几种），所以这里自备一张纯本地的格式表
 * ——**不动契约，只是本地多长出来四种**。
 *
 * 文件里两半分开：上半是纯函数（解块、走行内样式、命名、docx 字节），node 环境可测；
 * 下半只碰 DOM（下载），只在浏览器里跑。PDF 那一档另有一条路：`text-pdf.ts` 用 pdf-lib
 * 把块直接排成 PDF 字节（矢量、文字可选可搜），这里只管把字节交出去下载。
 *
 * docx 那一半是**真的带样式**，不是「把纯文本塞进段落」：markdown 先解成块（标题 / 正文 /
 * 引用 / 无序表 / 有序表 / 代码块），每块的行内再解成 run（粗 / 斜 / 行内代码）。落到
 * OOXML 上，标题一到六级对应 Word 的**内建**标题样式（`w:name="heading N"` + `w:outlineLvl`，
 * 所以导航窗格、目录、快速样式库里都认得出），列表走 `numbering.xml` 的真项目符号与编号，
 * 代码块与行内代码用等宽字体加灰底。详见 `docxBytes`。
 */
import type { CanvasKey } from '../../ui/locales.ts'
import { zipBytes } from '../../../core/artifact/io/zip.ts'

/** 文本节点的本地导出格式。 */
export type TextExportFormat = 'md' | 'txt' | 'docx' | 'pdf'

/** 「导出」菜单里提供的格式，按展示顺序排。 */
export const TEXT_EXPORT_FORMATS: readonly TextExportFormat[] = ['md', 'txt', 'docx', 'pdf']

/**
 * 每种格式在菜单里那行文案的字典键。
 *
 * 写在这张格式表旁边，是因为它是**格式表的一部分**：加一种格式要同时加一行文案，两处
 * 放在一起才看得见这件事。值必须真的在 `ui/locales.ts` 里（两个字典都有），类型由
 * `CanvasKey` 管着。
 */
export const TEXT_EXPORT_LABEL: Record<TextExportFormat, CanvasKey> = {
  md: 'canvas.export.md',
  txt: 'canvas.export.txt',
  docx: 'canvas.export.docx',
  pdf: 'canvas.export.pdf',
}

/** 每种格式落盘时的 MIME。 */
export const TEXT_EXPORT_MIME: Record<TextExportFormat, string> = {
  md: 'text/markdown;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
}

/** 行内的一截字：一段连续的文字，带着它自己的粗 / 斜 / 码。 */
export interface InlineRun {
  text: string
  bold?: boolean
  italic?: boolean
  /** 行内代码（反引号里那一截）。 */
  code?: boolean
}

/**
 * 文本产物解出来的一个块。
 *
 * 块级是**语义**而不只是「一行」：标题知道自己是几级，列表项知道自己是第几层、是有序还是
 * 无序，引用与代码块各有各的长相。docx 的段落样式、编号表、纯文本的缩进与符号，全都由
 * 这个判别联合的各分支推出来——一处解析，两处用，不会各写一套。
 */
export type TextBlock =
  | { kind: 'heading'; level: number; runs: InlineRun[] }
  | { kind: 'paragraph'; runs: InlineRun[] }
  | { kind: 'quote'; runs: InlineRun[] }
  | { kind: 'bullet'; depth: number; runs: InlineRun[] }
  | { kind: 'ordered'; depth: number; runs: InlineRun[] }
  /** 围栏代码：整段是一个块，行间的换行是段落内的 `<w:br/>`，所以灰底是一整片。 */
  | { kind: 'code'; lines: string[] }

const FENCE_RE = /^\s{0,3}(?:```|~~~)/
const RULER_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const QUOTE_RE = /^\s{0,3}>+\s?(.*)$/
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/
const ORDERED_RE = /^(\s*)\d+[.)]\s+(.*)$/
const LINK_RE = /^!?\[([^\]]*)\]\(([^)\s]+)\)$/

/**
 * 行内的形态，按「先长后短」排：图片要在链接之前（`![x](y)` 里的 `[x](y)` 也是一条合法
 * 链接，先让图片那条吃下整个 token），加粗要在斜体之前（`**粗**` 先被 `**` 那一支认走）。
 *
 * 只认 `*` 与 `**` 两副强调记号，**不认 `_` 与 `__`**：下划线在技术笔记里几乎总是
 * `snake_case_name` 的一部分，把它当强调记号剥掉是改坏原文，而换来的收益（少见的
 * 下划线强调）远不值这个价。斜体那支还要求记号后面不跟空白，免得 `2 * 3 * 4` 被读成强调。
 */
const INLINE_RE =
  /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\s\n][^*\n]*)\*/g

/** 把一行解析成一串 run：没被记号圈住的部分各成一段原样的字。 */
function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = []
  const plain = (value: string): void => {
    if (value !== '') runs.push({ text: value })
  }
  let at = 0
  for (const match of text.matchAll(INLINE_RE)) {
    const token = match[0]
    plain(text.slice(at, match.index))
    at = match.index + token.length
    if (token.startsWith('[') || token.startsWith('![')) {
      // 链接与图片都留成「文字 (地址)」：地址是这条链接唯一的凭据，丢了就再也回不去，
      // 但它不是正文，所以只配挂在文字后面的括号里。
      const link = LINK_RE.exec(token)
      if (link !== null) plain(link[1] === '' ? link[2] : `${link[1]} (${link[2]})`)
    } else if (token.startsWith('`')) {
      runs.push({ text: token.slice(1, -1), code: true })
    } else if (token.startsWith('**')) {
      runs.push({ text: token.slice(2, -2), bold: true })
    } else {
      runs.push({ text: token.slice(1, -1), italic: true })
    }
  }
  plain(text.slice(at))
  return runs
}

/** 一个块里的字（不管行内记号，只要文字）。 */
function runText(runs: readonly InlineRun[]): string {
  return runs.map((run) => run.text).join('')
}

/** 列表最多解到第几层（0 起步）。再深的缩进都并到最里面那一层。 */
const MAX_LIST_DEPTH = 2

/**
 * 按缩进算这一项在第几层。
 *
 * 用的是**相对**缩进而不是「几个空格算一层」：markdown 的嵌套两种写法都常见（两空格与
 * 四空格），按绝对数算总有一边读错。这里拿一张缩进栈——比栈顶深就进一层，比栈顶浅就退到
 * 不超过它的那一层，与上一项齐平就留在原地。
 */
function listDepth(stack: number[], indent: number): number {
  while (stack.length > 0 && indent < stack[stack.length - 1]) stack.pop()
  if (stack.length === 0 || indent > stack[stack.length - 1]) stack.push(indent)
  return Math.min(stack.length - 1, MAX_LIST_DEPTH)
}

/** 去掉一段代码块首尾的空行（围栏里前后各空一行是排版习惯，不是代码）。 */
function trimBlankEdges(lines: readonly string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start += 1
  while (end > start && lines[end - 1].trim() === '') end -= 1
  return lines.slice(start, end)
}

/**
 * 把 markdown 解成块。
 *
 * 空行**不成为一个块**：markdown 里它是块与块的分界，间隔由段落样式的段间距去给，落成
 * 一个空段落反而会把间距叠成两倍。围栏代码里的空行另说——那是代码的一部分，一字不动。
 * 分隔线（`---`）也丢掉：它没有任何文字，占一个段落反而在正文里留一道空档。
 */
function markdownBlocks(source: string): TextBlock[] {
  const blocks: TextBlock[] = []
  const indents: number[] = []
  let code: string[] | undefined

  for (const raw of source.split(/\r?\n/)) {
    if (FENCE_RE.test(raw)) {
      if (code === undefined) {
        code = []
      } else {
        blocks.push({ kind: 'code', lines: trimBlankEdges(code) })
        code = undefined
      }
      continue
    }
    if (code !== undefined) {
      code.push(raw)
      continue
    }

    const line = raw.replace(/\s+$/, '')
    if (line.trim() === '' || RULER_RE.test(line)) {
      indents.length = 0
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading !== null) {
      indents.length = 0
      blocks.push({ kind: 'heading', level: heading[1].length, runs: parseInline(heading[2]) })
      continue
    }

    const quote = QUOTE_RE.exec(line)
    if (quote !== null) {
      indents.length = 0
      blocks.push({ kind: 'quote', runs: parseInline(quote[1]) })
      continue
    }

    const bullet = BULLET_RE.exec(line)
    if (bullet !== null) {
      const depth = listDepth(indents, bullet[1].length)
      blocks.push({ kind: 'bullet', depth, runs: parseInline(bullet[2]) })
      continue
    }
    const ordered = ORDERED_RE.exec(line)
    if (ordered !== null) {
      const depth = listDepth(indents, ordered[1].length)
      blocks.push({ kind: 'ordered', depth, runs: parseInline(ordered[2]) })
      continue
    }

    indents.length = 0
    blocks.push({ kind: 'paragraph', runs: parseInline(line.trim()) })
  }

  if (code !== undefined) blocks.push({ kind: 'code', lines: trimBlankEdges(code) })
  return blocks
}

/**
 * 文本产物的块。
 *
 * `markdown` 只在产物真的是 markdown 时为真（`kind === 'markdown'`）。它不是 markdown
 * 时**一个字都不动、一行都不并**：`.txt` 与 `.py` 里的空行、行首的 `#`、`*` 都是内容，
 * 按标记去解就是改坏了原文——所以那种走「一行一个段落」这条最笨也最不会出错的路。
 */
export function textBlocksOf(source: string, markdown: boolean): TextBlock[] {
  if (markdown) return markdownBlocks(source)
  return source.split(/\r?\n/).map((line): TextBlock => ({ kind: 'paragraph', runs: [{ text: line }] }))
}

/** 去掉 markdown 标记后的纯文本（txt 用）。 */
export function markdownToPlainText(source: string): string {
  const chunks: string[] = []
  let previous: TextBlock['kind'] | undefined
  let number = 0

  for (const block of markdownBlocks(source)) {
    if (block.kind === 'bullet' || block.kind === 'ordered') {
      if (block.kind === 'ordered') number = previous === 'ordered' ? number + 1 : 1
      const marker = block.kind === 'ordered' ? `${number}.` : '-'
      const line = `${'  '.repeat(block.depth)}${marker} ${runText(block.runs)}`
      // 同一张表里的项连成相邻的行；表与表之间才空一行。
      if (previous === 'bullet' || previous === 'ordered') chunks[chunks.length - 1] += `\n${line}`
      else chunks.push(line)
    } else {
      chunks.push(block.kind === 'code' ? block.lines.join('\n') : runText(block.runs))
    }
    previous = block.kind
  }

  return chunks.join('\n\n').trim()
}

/**
 * 把文本编成 .docx 的字节（Word OOXML）。
 *
 * 手写一个最小但**带样式**的 DOCX：ZIP（stored 无压缩，打包器在
 * `core/artifact/zip.ts`——同一份实现也是应用节点导出 zip 用的）+ CRC32，七个条目——
 * 内容类型、包关系、正文、正文的关系、样式、编号、文档属性。样式不是「字号加粗」那几笔，
 * 而是 Word 的内建体系：
 *
 * - 标题一到六级用 `w:name="heading N"` 加 `w:outlineLvl`，所以导航窗格、目录、快速样式
 *   库都认得出它们是标题，而不只是长得像标题的粗字；
 * - 无序表与有序表走 `numbering.xml` 的真项目符号与编号（不再是一个 `-` 字符）；
 * - 引用与代码块各有段落样式，行内代码与粗斜体走 run 级 `w:rPr`。
 *
 * 编号表里**一段有序表一张号**（见 `documentParts`）：一张 `w:num` 是一个计数器，两段
 * 不相邻的有序表共用一张号的话，第二段会接着第一段往下数。
 */
export function docxBytes({ title, blocks }: { title: string; blocks: readonly TextBlock[] }): Uint8Array {
  const { body, orderedNums } = documentParts(blocks)
  const documentXml =
    XML_DECL +
    `<w:document ${DOCX_W}><w:body>${body}` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>'

  // 正文要引 styles / numbering 两个部件，这两个关系必须在这里声明——部件光在包里躺着
  // 是不够的，Word 是顺着关系找过去的。（`numbering.xml` 尤其：少了这条关系，列表就没有
  // 编号定义，段落上的 `w:numPr` 会指向一张不存在的表。）
  const documentRelsXml =
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    '</Relationships>'

  const contentTypesXml =
    XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>'

  const relsXml =
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>'

  const coreXml =
    XML_DECL +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    '<dc:creator>dsh-canvas</dc:creator>' +
    '<cp:lastModifiedBy>dsh-canvas</cp:lastModifiedBy>' +
    '</cp:coreProperties>'

  return zipBytes([
    { name: '[Content_Types].xml', data: utf8Bytes(contentTypesXml) },
    { name: '_rels/.rels', data: utf8Bytes(relsXml) },
    { name: 'word/document.xml', data: utf8Bytes(documentXml) },
    { name: 'word/_rels/document.xml.rels', data: utf8Bytes(documentRelsXml) },
    { name: 'word/styles.xml', data: utf8Bytes(stylesXml()) },
    { name: 'word/numbering.xml', data: utf8Bytes(numberingXml(orderedNums)) },
    { name: 'docProps/core.xml', data: utf8Bytes(coreXml) },
  ])
}

/** OOXML 片段共用的 XML 声明。 */
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const DOCX_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

/** 无序表用的 numId（项目符号没有计数器，全文共用一张号就够）。 */
const BULLET_NUM_ID = 1

/** 有序表的第一张号；每段有序表往后各领一张，所以从 2 起。 */
const ORDERED_NUM_ID_START = 2

/** XML 文本转义：写进 `w:t` 的字符不得打开或闭合标签。 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 一串 run 变成 `w:r`：行内代码引字符样式，粗斜体各挂一枚开关。 */
function runsXml(runs: readonly InlineRun[]): string {
  return runs
    .map((run) => {
      const props =
        (run.code === true ? '<w:rStyle w:val="CodeChar"/>' : '') +
        (run.bold === true ? '<w:b/>' : '') +
        (run.italic === true ? '<w:i/>' : '')
      const rPr = props === '' ? '' : `<w:rPr>${props}</w:rPr>`
      return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`
    })
    .join('')
}

/** 代码块的一行：除了第一行，每行前面先来一个段落内的换行（所以灰底连成一片）。 */
function codeRunXml(line: string, index: number): string {
  return `<w:r>${index === 0 ? '' : '<w:br/>'}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`
}

/** 一个段落：段落样式 + 可选的行内小属性（列表的编号就是从这里进去的）+ 内容。 */
function paragraphXml(style: string, body: string, pPr = ''): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${pPr}</w:pPr>${body}</w:p>`
}

/** 列表段落的编号属性：层次 + 引哪张号。 */
function numPrXml(depth: number, numId: number): string {
  return `<w:numPr><w:ilvl w:val="${depth}"/><w:numId w:val="${numId}"/></w:numPr>`
}

/**
 * 一个块落到 OOXML 上的那一个段落（有序表不在其中——它多一个「引哪张号」的参数，单独走
 * `documentParts` 那一支，不然每个块都得揣着一个用不上的号）。
 *
 * 空段落（只有非 markdown 的产物会有，见 `textBlocksOf`）把段前段后收成 0：它就是原文的
 * 一个空行，占一行就够，不该被段间距撑成两行。
 */
function blockXml(block: Exclude<TextBlock, { kind: 'ordered' }>): string {
  switch (block.kind) {
    case 'heading':
      return paragraphXml(`Heading${block.level}`, runsXml(block.runs))
    case 'quote':
      return paragraphXml('Quote', runsXml(block.runs))
    case 'code':
      return paragraphXml('CodeBlock', block.lines.map(codeRunXml).join(''))
    case 'bullet':
      return paragraphXml('ListParagraph', runsXml(block.runs), numPrXml(block.depth, BULLET_NUM_ID))
    case 'paragraph':
      if (runText(block.runs) === '') {
        return '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>'
      }
      return paragraphXml('Normal', runsXml(block.runs))
  }
}

/**
 * 正文段落，顺带把「这段有序表该用哪张号」算出来。
 *
 * 相邻的有序块共用一张号（同一段表，计数器接着走）；中间夹了别的东西，就再领一张新的
 * ——新号即从 1 重新数起。不这么做的话，`1. 甲` 「一段别的」 `1. 乙` 会导出成 1、2。
 */
function documentParts(blocks: readonly TextBlock[]): { body: string; orderedNums: number } {
  const parts: string[] = []
  let nextNumId = ORDERED_NUM_ID_START
  let activeNumId: number | undefined

  for (const block of blocks) {
    if (block.kind === 'ordered') {
      if (activeNumId === undefined) {
        activeNumId = nextNumId
        nextNumId += 1
      }
      parts.push(
        paragraphXml('ListParagraph', runsXml(block.runs), numPrXml(block.depth, activeNumId)),
      )
      continue
    }
    activeNumId = undefined
    parts.push(blockXml(block))
  }

  return { body: parts.join(''), orderedNums: nextNumId - ORDERED_NUM_ID_START }
}

/**
 * 标题一到六级的字号与间距。
 *
 * 字号单位是**半磅**（`w:sz`），间距是 twip。字号一路降下来、间距一路收紧：一级标题
 * 独立成节，六级标题只是比正文重一点的领句。
 */
const HEADING_STEPS = [
  { size: 36, before: 320, after: 160 },
  { size: 32, before: 280, after: 140 },
  { size: 28, before: 240, after: 120 },
  { size: 26, before: 200, after: 100 },
  { size: 24, before: 160, after: 80 },
  { size: 22, before: 120, after: 60 },
] as const

/**
 * `w:style` 的属性顺序是 schema 定死的（name → basedOn → next → qFormat → pPr → rPr），
 * 顺序错了 Word 会直接判文件无效，所以每个样式都照这个次序拼。
 */
function headingStyleXml(level: number): string {
  const step = HEADING_STEPS[level - 1]
  return (
    `<w:style w:type="paragraph" w:styleId="Heading${level}">` +
    // `w:name="heading N"` 是 Word 认内建标题样式的钩子：名字对上，导航窗格与目录才
    // 把它当标题；`w:outlineLvl` 再把层级说明白。
    `<w:name w:val="heading ${level}"/>` +
    '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    `<w:pPr><w:keepNext/><w:spacing w:before="${step.before}" w:after="${step.after}"/>` +
    `<w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${step.size}"/><w:szCs w:val="${step.size}"/></w:rPr>` +
    '</w:style>'
  )
}

/** 样式表：文档默认（字体与行距）+ 正文 + 六级标题 + 列表 / 引用 / 代码块 + 行内代码。 */
function stylesXml(): string {
  const headings = HEADING_STEPS.map((_, index) => headingStyleXml(index + 1)).join('')
  return (
    XML_DECL +
    `<w:styles ${DOCX_W}>` +
    // 字体只交代西文（中文交给 Word 的默认中文字体去配，硬写一个名字反而可能在别人机器上
    // 缺字替换）。行距 1.15、段后 7pt——接近 Word 的默认观感。
    '<w:docDefaults>' +
    '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
    '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    headings +
    // 列表段落本身不管缩进：缩进与符号都由 numbering.xml 那一层给（见 `numberingXml`），
    // 两边都写会打架。这里只声明「同一张表的相邻项之间不再留段间距」。
    '<w:style w:type="paragraph" w:styleId="ListParagraph">' +
    '<w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:contextualSpacing/></w:pPr>' +
    '</w:style>' +
    '<w:style w:type="paragraph" w:styleId="Quote">' +
    '<w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    // `w:pPr` 的子元素顺序同样是 schema 定死的（pBdr → spacing → ind），不能按「先缩进
    // 再说间距」这种顺手的次序写。
    '<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr>' +
    '<w:spacing w:before="120" w:after="120"/><w:ind w:left="480"/></w:pPr>' +
    '<w:rPr><w:color w:val="595959"/></w:rPr>' +
    '</w:style>' +
    '<w:style w:type="paragraph" w:styleId="CodeBlock">' +
    '<w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:keepLines/>' +
    '<w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/>' +
    '<w:spacing w:before="120" w:after="120" w:line="240" w:lineRule="auto"/>' +
    '<w:ind w:left="120"/></w:pPr>' +
    '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' +
    '<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>' +
    '</w:style>' +
    '<w:style w:type="character" w:styleId="CodeChar">' +
    '<w:name w:val="Code Char"/><w:qFormat/>' +
    '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' +
    '<w:sz w:val="20"/><w:szCs w:val="20"/>' +
    '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:rPr>' +
    '</w:style>' +
    '</w:styles>'
  )
}

/** 无序表三层的符号，从外到里。 */
const BULLET_MARKS = ['•', '◦', '▪'] as const

/** 列表每进一层的左缩进（twip），以及符号相对正文悬挂出去的量。 */
const LIST_INDENT_STEP = 720
const LIST_HANGING = 360

/** 编号表里的一层：符号 / 编号长什么样、缩进到哪里。 */
function listLevelXml(index: number, numFmt: string, lvlText: string): string {
  return (
    `<w:lvl w:ilvl="${index}">` +
    '<w:start w:val="1"/>' +
    `<w:numFmt w:val="${numFmt}"/>` +
    `<w:lvlText w:val="${lvlText}"/>` +
    '<w:lvlJc w:val="left"/>' +
    `<w:pPr><w:ind w:left="${LIST_INDENT_STEP * (index + 1)}" w:hanging="${LIST_HANGING}"/></w:pPr>` +
    '</w:lvl>'
  )
}

function abstractNumXml(id: number, numFmt: string, marks: readonly string[]): string {
  const levels = marks.map((mark, index) => listLevelXml(index, numFmt, mark)).join('')
  return (
    `<w:abstractNum w:abstractNumId="${id}">` +
    '<w:multiLevelType w:val="multilevel"/>' +
    `${levels}</w:abstractNum>`
  )
}

/**
 * 编号表：一张无序（项目符号）、一张有序（数字），有序那张按 `nums` 条数复制成多张号。
 *
 * 有序表的编号文字用 `%N.` 而不是写死的 `1.`：那是「取第 N 层的计数」，Word 自己会递推，
 * 也才认得出这是自动编号（改动列表还能重排）。
 */
function numberingXml(orderedNums: number): string {
  const nums = [`<w:num w:numId="${BULLET_NUM_ID}"><w:abstractNumId w:val="0"/></w:num>`]
  for (let index = 0; index < orderedNums; index += 1) {
    nums.push(
      `<w:num w:numId="${ORDERED_NUM_ID_START + index}"><w:abstractNumId w:val="1"/></w:num>`,
    )
  }
  const orderedMarks = BULLET_MARKS.map((_, index) => `%${index + 1}.`)
  return (
    XML_DECL +
    `<w:numbering ${DOCX_W}>` +
    abstractNumXml(0, 'bullet', BULLET_MARKS) +
    abstractNumXml(1, 'decimal', orderedMarks) +
    nums.join('') +
    '</w:numbering>'
  )
}

/** UTF-8 编码（node 与浏览器都有 TextEncoder）。 */
export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** 导出文件名：把产物路径的扩展名换成目标格式的（路径只取最后一段）。 */
export function exportFileName(file: string, format: TextExportFormat): string {
  const base = file.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return `${stem === '' ? 'text' : stem}.${format}`
}

