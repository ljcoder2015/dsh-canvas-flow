/**
 * dsh-canvas — PDF 那条出路：**自己建文档**（F10.1，v1.61；v1.64 补矢量图修整）。
 *
 * 上游有一条现成的 `renderNodesToPDF`（`@open-pencil/core/io/formats/pdf`），它做的正是这
 * 里做的事：把选区画成 SVG → `new jsPDF(...)` → `svg2pdf`。但那个函数**不在包的 exports
 * map 里**（从 `@open-pencil/core/io` 露出来的只有 `renderNodesToSVG` / `computeContentBounds`
 * 这些零件），于是我们只能从门面 `IORegistry.exportContent('pdf', …)` 走进去——而那样就够
 * 不着它内部那句 `new jsPDF(...)` 了。
 *
 * 为什么非够着不可：**JS 的字体必须注册在「正要写的那一份文档」上**。svg2pdf 是按
 * `pdf.getFontList()` 找字面的，找不到就回落 `times`（Type1 标准字体，没有汉字字形），
 * 中文于是被当单字节写进内容流——这就是 v1.61 真机报的「导出 PDF…文字渲染不正确」。
 * 我们试过「先随便建一份注册、指望 jsPDF 的全局事件把它带给后面新建的实例」：
 * `jsPDF.API.events` 那条队列**不会**把字体带过去（真测过，新实例的 `getFontList()` 里没有）。
 * 所以这一条只能自己建文档——好在零件都露着（`renderNodesToSVG`、`computeContentBounds`），
 * 而 `jspdf` / `svg2pdf.js` 本来就在引擎 chunk 里（上游那条路也在用它们）。
 *
 * **四件事定在这里**（前三件是 v1.64 补的，起因是真机报的「导出 PDF，文本换行，和圆角矩形
 * 渲染不正确」）：
 *
 * - **嵌进去的是子集**（`putOnlyUsedFonts: true`）。jsPDF 默认会把**注册过的每一支字面整个
 *   嵌进产物**——四个样式就是四份 17.7MB。打开这一格之后，只有真用上的那几支进去，而每支
 *   再按用到的字形子集化：一份三页的中文稿实测 **51KB**，文字可选中、可搜索（`/ToUnicode`
 *   在）、矢量。
 * - **一容器一页**，全在一份文档里（不是一页一份再拼）。少一次字体解析、少一份重复子集，
 *   客户端那边也不必再合并——粒度归调用方，这里只保证「给多少页写多少页」。
 * - **量尺来自 SVG 自己**：上游画 SVG 时根元素就写着 `width`/`height`/`viewBox`，页面就按它
 *   建；调用方把这个尺寸一起递进来（它本来就要算，见 `design-io.ts`）。
 * - **交给 svg2pdf 之前先修 SVG**（{@link repairPdfSvg}）：上游那张矢量图有三处与画布不
 *   一致（不折行、裁剪丢圆角、超半轴圆角夹法不同），而 `svg2pdf` 只是**逐元素转写**——
 *   它忠实，所以错的东西也忠实。三处的来龙去脉与算法在 `core/artifact/design/pdf-svg.ts`，
 *   这一层只负责「怎么落到 DOM 上」：谁对谁、写哪些属性。
 *
 * 这个模块**只住在引擎 chunk 里**（`lib/assets/design-engine.js`）：`jspdf` 与 `svg2pdf.js`
 * 都是重家伙，且要 `DOMParser`。所以 import 一律是**动态的**、放在函数里——文件顶层保持
 * 纯净，判据才能在 node 里把纯函数拿出来单测。
 */
import type { SceneGraph } from '@open-pencil/scene-graph'
import { PDF_TEXT_FAMILY } from '../../../../core/artifact/design/export-font.ts'
import { DesignExportFailure } from './design-failure.ts'
import {
  clampRadius,
  clipOrder,
  lineHeightOf,
  textOrder,
  wrapTextLines,
  type MeasureText,
} from '../../../../core/artifact/design/pdf-svg.ts'

/**
 * 交给 jsPDF 虚拟文件系统的那个名字。
 *
 * 它只是本模块内部的握手（`addFileToVFS` 与 `addFont` 之间），不写进产物——产物里的
 * `/BaseFont` 来自字体自己的 PostScript 名（被加上子集前缀）。取个和字体对得上的名字，
 * 出问题时好认。
 */
export const PDF_FONT_FILE = 'NotoSansSC-Regular.ttf'

/** 一页的素材：上游画好的矢量图、它有多大（pt）、以及画的是哪个容器。 */
export interface PdfPageSource {
  svg: string
  width: number
  height: number
  /**
   * 这一页画的是哪个容器。
   *
   * 修 SVG 要用它：`clipPath` 与 `<text>` 在 SVG 里都不带「我是谁」，接线只能按**上游那条
   * 先序**把元素与节点对上（见 `pdf-svg.ts` 的 `clipOrder` / `textOrder`）——而那条遍历的
   * 起点就是这个容器。
   */
  containerId: string
}

/**
 * `ArrayBuffer` → jsPDF 要的那个「二进制字符串」（每个字符一个字节）。
 *
 * 走这一条而不是它的 base64 那条：jsPDF 两个都收（`addFont` 看头四个字节是不是
 * `00 01 00 00` 来决定要不要 `atob`），而 base64 要多一趟 24MB 的编码与一次解码、内存是
 * 这里的近两倍。**分块**是因为 `String.fromCharCode` 的参数个数有上限（整份 17.7MB 一次
 * 铺开会直接爆栈），一次 16KB 是安全又够快的粒度。
 */
export function binaryStringOf(bytes: Uint8Array): string {
  const CHUNK = 0x4000
  let out = ''
  for (let index = 0; index < bytes.length; index += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return out
}

/** jsPDF 上这一层用到的那几格（省得引它的类型，动态 import 也拿不到）。 */
interface PdfTextDocument {
  setFont(family: string, style: string): void
  getStringUnitWidth(text: string): number
}

/**
 * 把若干页画进一份 PDF，交回字节。
 *
 * `styles` 是要注册的字面样式名（`pdfTextStyles` 给的），`font` 是那支中文字面的字节——
 * 每一项都注册一次同一个文件，是因为 jsPDF 按「字体 id + 样式名」两维查表：只注册
 * `normal` 的话，一份带粗体的稿子会让 svg2pdf 找不到 `bold` 而回落 `times`。
 */
export async function renderPdfDocument(
  graph: SceneGraph,
  pages: readonly PdfPageSource[],
  styles: readonly string[],
  font: ArrayBuffer,
): Promise<Uint8Array> {
  const first = pages[0]
  if (first === undefined) throw new DesignExportFailure('no-pages')

  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
  const doc = new jsPDF({
    orientation: orientationOf(first),
    unit: 'pt',
    format: [first.width, first.height],
    compress: true,
    // 只有真用上的字面进产物（见文件头）。默认 false 会连没用过的样式一起整个嵌进去。
    putOnlyUsedFonts: true,
  })

  doc.addFileToVFS(PDF_FONT_FILE, binaryStringOf(new Uint8Array(font)))
  for (const style of styles) doc.addFont(PDF_FONT_FILE, PDF_TEXT_FAMILY, style)

  for (const [index, page] of pages.entries()) {
    if (index > 0) doc.addPage([page.width, page.height], orientationOf(page))
    const parsed = new DOMParser().parseFromString(page.svg, 'image/svg+xml')
    if (parsed.querySelector('parsererror') !== null) {
      throw new DesignExportFailure('svg-unreadable')
    }
    repairPdfSvg(parsed.documentElement, graph, page.containerId, doc)
    await svg2pdf(parsed.documentElement, doc, {
      x: 0,
      y: 0,
      width: page.width,
      height: page.height,
    })
  }
  return new Uint8Array(doc.output('arraybuffer'))
}

/** 页面的朝向跟着容器走（与上游那条路同一条判据）。 */
function orientationOf(page: { width: number; height: number }): 'portrait' | 'landscape' {
  return page.width > page.height ? 'landscape' : 'portrait'
}

// —— 矢量图修整 ————————————————————————————————————————————————————————

/**
 * 把上游那张 SVG 修成「画布上的样子」。
 *
 * 三件事**必须按这个次序**：先补裁剪的圆角（那是新写进去的值），再统一夹一次圆角（新值
 * 本身也可能超半轴），最后折行（它读 `y`，与前面两件事无关，放最后只是为了别让折行插进去
 * 的新元素干扰收集）。
 *
 * 三件事都有一条共同的纪律：**对不上就不动**。SVG 里没有「我是谁」，元素与节点靠上游的
 * 遍历顺序 + 一个可校验的事实（尺寸、文本内容）配对；任何一步对不上就原地留着——不改的
 * 结果是「还是导出成老样子」，改错的结果是**把人家的稿子画坏**。前者用户看得见，后者看不出来。
 */
function repairPdfSvg(
  root: Element,
  graph: SceneGraph,
  containerId: string,
  doc: PdfTextDocument,
): void {
  restoreClipRadii(root, graph, containerId)
  clampRectRadii(root)
  wrapTextElements(root, graph, containerId, doc)
}

/** 文档序（先序）地收集满足条件的元素——不走 `querySelectorAll`（XML 文档里的命名空间匹配不牢靠）。 */
function collectElements(root: Element, test: (element: Element) => boolean): Element[] {
  const found: Element[] = []
  const step = (element: Element): void => {
    if (test(element)) found.push(element)
    for (const child of Array.from(element.children)) step(child)
  }
  step(root)
  return found
}

/** 节点的数字属性；没有或不是数就给 `null`（不要拿 `NaN` 去比大小）。 */
function numberAttr(element: Element, name: string): number | null {
  const raw = element.getAttribute(name)
  if (raw === null) return null
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * 把 `<clipPath>` 的直角 `<rect>` 补上容器自己的圆角。
 *
 * 这是「圆角容器导出后变直角」那一条的正解：上游 `buildGroupAttrs` 生成的裁剪矩形只有
 * width/height，容器里铺满的子块于是把四个圆角填平——画布上露白底、PDF 里是直角。
 *
 * 配对的**两道证据**：先是上游那条先序（`clipOrder`，条数也要对得上），再比尺寸
 * （clipPath 的 w/h 必须等于节点的 w/h）。顺序漂了就被尺寸拦下，那一条不补——宁可留着
 * 老样子，也不把别的节点的圆角写到它头上。
 *
 * **独立圆角（`independentCorners`）的容器这里不补**：`<rect>` 只有一对 rx/ry，四个角各不
 * 相同就得写成 `<path>`。已知项，见产品文档。
 */
function restoreClipRadii(root: Element, graph: SceneGraph, containerId: string): void {
  const clips = collectElements(root, (element) => element.tagName === 'clipPath')
  if (clips.length === 0) return
  const ids = clipOrder(graph, [containerId])
  if (ids.length !== clips.length) return

  clips.forEach((clip, index) => {
    const node = graph.getNode(ids[index] ?? '')
    const rect = clip.children[0]
    if (node === undefined || rect === undefined || rect.tagName !== 'rect') return
    if (numberAttr(rect, 'width') !== Math.round(node.width)) return
    if (numberAttr(rect, 'height') !== Math.round(node.height)) return
    if (node.independentCorners) return
    const radius = node.cornerRadius
    if (radius <= 0) return
    rect.setAttribute('rx', String(radius))
    rect.setAttribute('ry', String(radius))
  })
}

/**
 * 把每个圆角的 `rx`/`ry` 夹到画布那个值。
 *
 * SVG 的 `rx` 夹到 `w/2`、`ry` 夹到 `h/2`，画布（skia 的 `RRect`）却是**整体按比例缩**：
 * 200×140 给半径 100，画布是超椭圆、SVG 是正椭圆。把夹好的值写回去，两边的夹取就都不起作用。
 */
function clampRectRadii(root: Element): void {
  for (const rect of collectElements(root, (element) => element.tagName === 'rect')) {
    const rx = numberAttr(rect, 'rx') ?? 0
    const ry = numberAttr(rect, 'ry') ?? 0
    if (rx <= 0 && ry <= 0) continue
    const width = numberAttr(rect, 'width') ?? 0
    const height = numberAttr(rect, 'height') ?? 0
    // 统一圆角时 rx === ry；真碰上不一致的（别处手写过），取大的那个一起夹。
    const radius = clampRadius(Math.max(rx, ry), width, height)
    rect.setAttribute('rx', String(radius))
    rect.setAttribute('ry', String(radius))
  }
}

/**
 * 按节点宽度把每个 `<text>` 折成多行。
 *
 * 上游那张 SVG 里整段文字是**一个** `<text>`（`y` 只有第一行的基线），而画布按宽度折行——
 * 于是画布三行、PDF 一行冲出边界。这里把折行补回来：每一行是一个新的 `<text>`（复制原来
 * 全部属性，只改 `y`），行内的 `styleRuns` 片段各自成 `<tspan>`。
 *
 * 测量用 **jsPDF 自己的字表**（`getStringUnitWidth` × 字号 + 字距）：折行的边界必须与**最终
 * 画出来的那一支字面**一致，而我们手里只有这一支（所有样式都注册在 `PDF_TEXT_FAMILY` 上）。
 */
function wrapTextElements(
  root: Element,
  graph: SceneGraph,
  containerId: string,
  doc: PdfTextDocument,
): void {
  const texts = collectElements(root, (element) => element.tagName === 'text')
  if (texts.length === 0) return
  const ids = textOrder(graph, [containerId])
  if (ids.length !== texts.length) return

  texts.forEach((element, index) => {
    const node = graph.getNode(ids[index] ?? '')
    if (node === undefined || node.type !== 'TEXT') return
    // 第二道证据：元素内容就是节点原文。对不上说明顺序漂了。
    if ((element.textContent ?? '') !== node.text) return
    // 自动宽高 = 不折行（宽度是文字自己撑出来的，没有可折的边界）。
    if (node.textAutoResize === 'WIDTH_AND_HEIGHT') return
    if (node.width <= 0) return

    const fontSize = numberAttr(element, 'font-size') ?? node.fontSize
    const weight = numberAttr(element, 'font-weight') ?? node.fontWeight
    const spacing = numberAttr(element, 'letter-spacing') ?? 0
    const measure = measureWith(doc, fontSize, weight, spacing)
    const lineHeight = lineHeightOf(node)
    const maxLines =
      node.textAutoResize === 'TRUNCATE'
        ? Math.max(1, Math.floor(node.height / lineHeight))
        : undefined

    const lines = wrapTextLines(node.text, node.width, measure, { maxLines })
    if (lines.length <= 1) return

    const parent = element.parentNode
    if (parent === null) return
    const baseY = numberAttr(element, 'y') ?? fontSize
    const pieces = splitTextChildren(element)

    lines.forEach((line, row) => {
      const copy = element.cloneNode(false) as Element
      copy.setAttribute('y', String(baseY + row * lineHeight))
      copy.replaceChildren(...contentOf(element.ownerDocument, pieces, line.start, line.end))
      parent.insertBefore(copy, element)
    })
    parent.removeChild(element)
  })
}

/** 让 jsPDF 按「那一支字面 + 那个字重」报宽度。 */
function measureWith(
  doc: PdfTextDocument,
  fontSize: number,
  weight: number,
  spacing: number,
): MeasureText {
  // svg2pdf 找字面用的就是「id + 样式名」这两维，样式名由字重推——这里必须同一套。
  // 切一次就够：一个元素只有一个字重，而 `setFont` 每次都要过一遍字体表。
  doc.setFont(PDF_TEXT_FAMILY, weight >= 700 ? 'bold' : 'normal')
  return (slice) => {
    // `getStringUnitWidth` 给的是 em 单位宽度（不含字号），乘字号得 pt；字距是我们自己叠加的
    // （jsPDF 的字表里没有 `letter-spacing` 这一格）。
    return doc.getStringUnitWidth(slice) * fontSize + spacing * Math.max(0, slice.length - 1)
  }
}

/** `<text>` 的内容摊成一段段「字符区间 + 样式来源」：没有 `styleRuns` 时就是唯一那一段。 */
interface TextPiece {
  start: number
  end: number
  text: string
  /** 这一段的样式元素（`<tspan>`）；裸文本是 `null`。 */
  style: Element | null
}

function splitTextChildren(element: Element): TextPiece[] {
  const pieces: TextPiece[] = []
  let at = 0
  for (const child of Array.from(element.childNodes)) {
    const text = child.textContent ?? ''
    if (text === '') continue
    const style = child.nodeType === 1 ? (child as Element) : null
    pieces.push({ start: at, end: at + text.length, text, style })
    at += text.length
  }
  return pieces
}

/** 取 `[start, end)` 这一行对应的节点：样式片段各自成 `<tspan>`，裸文本直接给文本节点。 */
function contentOf(
  document: Document,
  pieces: readonly TextPiece[],
  start: number,
  end: number,
): Node[] {
  const nodes: Node[] = []
  for (const piece of pieces) {
    const from = Math.max(piece.start, start)
    const to = Math.min(piece.end, end)
    if (from >= to) continue
    const text = piece.text.slice(from - piece.start, to - piece.start)
    if (piece.style === null) {
      nodes.push(document.createTextNode(text))
      continue
    }
    const span = piece.style.cloneNode(false) as Element
    span.textContent = text
    nodes.push(span)
  }
  return nodes
}
