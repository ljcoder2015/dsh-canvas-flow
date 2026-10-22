/**
 * dsh-canvas — 提示词输入面的 **DOM 层**：把「值」画成带原子标签的内容，再把用户改过的
 * 内容读回「值」。
 *
 * 输入面是 `contenteditable`（`prompt-input.tsx`），它只有一条规矩：**这棵子树就是值**。
 * 于是这里只有两组函数，而两组之间那条不变量是整件事的地基——
 *
 * | 组 | 函数 | 干什么 |
 * |---|---|---|
 * | 写 | {@link writeAtoms} | 值 → 内容：文字照抄，换行落成一枚 `<br>`，引用落成一枚标签 |
 * | 读 | {@link serializeHost} | 内容 → 值：标签吐回**它自己那串字符**（`@path`），一个字节不改 |
 *
 * 标签是 `contenteditable="false"` 的原子节点，所以「删一枚标签」= 删一个 DOM 节点，
 * 而「删掉半个标签」在浏览器里根本无从发生。但**光标是一串字符的位置**，不是 DOM 的位置：
 * 用户的每一次按键都带着一个「在这串文本里排第几」的意思，所以删除、粘贴、复制、落光标
 * 全部要先把它换算成扁平偏移（{@link caretFlat} / {@link selection}），改完再换回 DOM
 * 位置（{@link setCaret}）。换算的规则只有一条：**一枚标签占的字符数 = 它那串 token 的
 * 长度**，与 {@link serializeHost} 吐出来的东西逐字对齐——所以「界面上的位置」与「值里的
 * 位置」从一开始就是同一个坐标。
 *
 * 这一层只碰 DOM、不碰 React，也不做任何决定：删哪一段、插什么字，由组件那侧按值算出新
 * 值，这里只负责把它画出来并把光标摆到说好的地方。
 */
import { referenceBadge } from '../../../core/artifact/prompt/prompt-blocks.ts'
import type { PromptAtom, PromptReference, ReferenceType } from '../../../core/artifact/prompt/prompt-blocks.ts'

/** 引用标签的类名与它身上那几个属性——写、读、判三处共用这一份。 */
export const CHIP_CLASS = 'dsh-canvas-ref-chip'

/**
 * 标签那串字符（`@path` / `@"my brief.md"` / `@img.png <point>420 380</point>`）挂在哪个属性上。
 *
 * 存**原文**而不是路径：宿主记号有三种形态，从路径反推不出用户写的是哪一种，重新拼一次
 * 就可能把发出去的提示词改掉一个字节。见 `core/artifact/prompt-blocks.ts` 的 `PromptReference`。
 */
export const CHIP_TOKEN_ATTR = 'data-ref-id'

/** 引用类型（`code` / `image` / `video` / `audio` / `mark` / `region`）——长相按它选。 */
export const CHIP_TYPE_ATTR = 'data-ref-type'

/** 标记里那份路径（去掉引号的那份）：给 tooltip 用。 */
export const CHIP_PATH_ATTR = 'data-ref-path'

/** 徽标：代码类是行号（`10-25`），标记类是坐标（`420 380`）——两种读数共用一格。 */
export const CHIP_BADGE_ATTR = 'data-ref-badge'

/** 未知的块级元素（浏览器自己塞进来的那种）自己还占一个换行——见 {@link lengthOf}。 */
const BLOCK_TAGS = new Set([
  'DIV', 'P', 'LI', 'UL', 'OL', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'PRE',
])

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 标签是不是引用标签。 */
export function isChip(node: Node): node is HTMLElement {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    (node as Element).classList.contains(CHIP_CLASS)
  )
}

/** 标签那串字符。 */
function tokenOf(chip: Element): string {
  return chip.getAttribute(CHIP_TOKEN_ATTR) ?? ''
}

/**
 * 一个（父节点，子下标）位置在扁平文本里排第几。
 *
 * @param parent - the node the offset belongs to.
 * @param count - how many of its children come before the position.
 */
function prefixOf(parent: Node, count: number): number {
  let total = 0
  let index = 0
  for (const child of parent.childNodes) {
    if (index >= count) break
    total += lengthOf(child, index === 0)
    index += 1
  }
  return total
}

/**
 * 一个节点占的字符数。`first` 是它是否为父节点的第一个子节点。
 *
 * 这个函数与 {@link flatten} 必须说同一句话——两处对不齐，光标就会从字底下错开。
 * 文本按字符数、`<br>` 与标签各占 1 与 token 长、未知元素按子节点求和；至于浏览器自己
 * 塞进来的块级元素，它多占的那一个换行也算在内（它确实换了一行），除非它就在开头
 * ——开头那个换行浏览器本来也不渲染。
 */
function lengthOf(node: Node, first: boolean): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? '').length
  if (node.nodeType !== Node.ELEMENT_NODE) return 0
  if (node.nodeName === 'BR') return 1
  if (isChip(node)) return tokenOf(node).length
  let total = 0
  let index = 0
  for (const child of node.childNodes) {
    total += lengthOf(child, index === 0)
    index += 1
  }
  return total + (BLOCK_TAGS.has(node.nodeName) && !first ? 1 : 0)
}

/** 内容 → 值。标签吐回它自己那串字符，`<br>` 与块级元素的换行吐回 `\n`。 */
function flatten(node: Node, first: boolean, into: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    into.push(node.nodeValue ?? '')
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  if (node.nodeName === 'BR') {
    into.push('\n')
    return
  }
  if (isChip(node)) {
    into.push(tokenOf(node))
    return
  }
  if (BLOCK_TAGS.has(node.nodeName) && !first) into.push('\n')
  let index = 0
  for (const child of node.childNodes) {
    flatten(child, index === 0, into)
    index += 1
  }
}

/** 内容 → 值。标签吐回它自己那串字符，`<br>` 与块级元素的换行吐回 `\n`。 */
export function serializeHost(host: HTMLElement): string {
  const parts: string[] = []
  flatten(host, true, parts)
  return parts.join('')
}

/** 一个节点前面的字符数；它不在宿主里就是 `undefined`。 */
function beforeOf(host: HTMLElement, node: Node): number | undefined {
  let total = 0
  let cursor: Node = node
  while (cursor !== host) {
    const parent = cursor.parentNode
    if (parent === null) return undefined
    let index = 0
    for (const sibling of parent.childNodes) {
      if (sibling === cursor) break
      total += lengthOf(sibling, index === 0)
      index += 1
    }
    cursor = parent
  }
  return total
}

/**
 * A DOM position, as a flat offset — the coordinate the value speaks in.
 *
 * 位置不在宿主里（光标跑到别处去了）返回 `undefined`：调用方该退回它自己记住的那一个，
 * 而不是拿 0 当成「开头」。
 */
export function flatOffsetOf(host: HTMLElement, node: Node, offset: number): number | undefined {
  if (node === host) return prefixOf(host, offset)
  const before = beforeOf(host, node)
  if (before === undefined) return undefined
  if (node.nodeType === Node.TEXT_NODE) {
    return before + Math.min(offset, (node.nodeValue ?? '').length)
  }
  // 原子（标签、<br>）里没有位置：落在它前面或后面，就是 0 或整个长度。
  if (node.nodeName === 'BR' || isChip(node)) return before + (offset > 0 ? lengthOf(node, false) : 0)
  return before + prefixOf(node, offset)
}

/** 段内定位：原子不接收「里面」的位置，返回 `undefined` 让调用方落到它旁边。 */
function seek(node: Node, flat: number, first: boolean): { node: Node; offset: number } | undefined {
  if (node.nodeType === Node.TEXT_NODE) return { node, offset: flat }
  if (node.nodeType !== Node.ELEMENT_NODE) return undefined
  if (node.nodeName === 'BR' || isChip(node)) return undefined
  const lead = BLOCK_TAGS.has(node.nodeName) && !first ? 1 : 0
  if (flat < lead) return undefined
  let rest = flat - lead
  let index = 0
  for (const child of node.childNodes) {
    const length = lengthOf(child, index === 0)
    if (rest < length) return seek(child, rest, index === 0) ?? { node, offset: index }
    if (rest === length) return seek(child, length, index === 0) ?? { node, offset: index + 1 }
    rest -= length
    index += 1
  }
  return { node, offset: node.childNodes.length }
}

/** 一个扁平偏移落在 DOM 的哪儿：永远落在文字里，或者落在标签**旁边**（绝不在它里面）。 */
export function domPosition(host: HTMLElement, flat: number): { node: Node; offset: number } {
  const total = prefixOf(host, host.childNodes.length)
  const at = Math.max(0, Math.min(flat, total))
  return seek(host, at, true) ?? { node: host, offset: host.childNodes.length }
}

/** 现在选中的是哪一段（扁平偏移）；没有选区或选区不在宿主里就是 `undefined`。 */
export function selection(host: HTMLElement): { start: number; end: number } | undefined {
  const selected = host.ownerDocument.getSelection()
  if (selected === null || selected.rangeCount === 0) return undefined
  const range = selected.getRangeAt(0)
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return undefined
  const start = flatOffsetOf(host, range.startContainer, range.startOffset)
  const end = flatOffsetOf(host, range.endContainer, range.endOffset)
  if (start === undefined || end === undefined) return undefined
  return { start: Math.min(start, end), end: Math.max(start, end) }
}

/** 折叠光标落在第几个字符；没有光标就是 `undefined`。 */
export function caretFlat(host: HTMLElement): number | undefined {
  const range = selection(host)
  return range === undefined ? undefined : range.end
}

/**
 * 把光标（或一段选区）摆到指定的字符位置，并把那一行**滚进可视区**。
 *
 * 滚动这一下是必须的：用户是接着末尾往下写的，而框里的正文常常比框高——焦
 * 点与 `setSelectionRange` 都不会把那一行滚出来，用户看到的是一个停在中间、
 * 要写的那一行在折叠线以下的框。
 */
export function setCaret(host: HTMLElement, flat: number, end?: number): void {
  const document = host.ownerDocument
  const start = domPosition(host, flat)
  const range = document.createRange()
  if (end === undefined) {
    range.setStart(start.node, start.offset)
    range.collapse(true)
  } else {
    const last = domPosition(host, end)
    range.setStart(start.node, start.offset)
    range.setEnd(last.node, last.offset)
  }
  const selected = document.getSelection()
  if (selected === null) return
  selected.removeAllRanges()
  selected.addRange(range)
  scrollCaretIntoView(host, range)
}

/** 光标那一行看不见就把它挪进来（框自己滚，不动外面的页面）。 */
function scrollCaretIntoView(host: HTMLElement, range: Range): void {
  const caret = range.getBoundingClientRect()
  const box = host.getBoundingClientRect()
  if (caret.width === 0 && caret.height === 0) return
  if (caret.bottom > box.bottom) host.scrollTop += caret.bottom - box.bottom + 4
  else if (caret.top < box.top) host.scrollTop -= box.top - caret.top + 4
}

/** 一笔描边的路径：图标都是 16 格里的一两根线，颜色跟着字走（`currentColor`）。 */
function stroke(document: Document, drawn: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', drawn)
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.1')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  return path
}

/**
 * 标签左端那枚小图标，按引用类型选。
 *
 * 媒体类**只在没有缩略图时**才用它（有图就上图，见 {@link chipElement}）：一枚 20px 的
 * 图标告诉人「这是图片」，一张 20px 的缩略图告诉人「这是**哪张**图片」——后者才是人挑
 * 引用时真正要的那个信息。
 */
function glyphFor(document: Document, type: ReferenceType): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', `${CHIP_CLASS}-icon`)
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  if (type === 'video') {
    svg.append(stroke(document, 'M2.6 4.2h10.8v7.6H2.6z'), stroke(document, 'M6.6 6.2 10 8l-3.4 1.8z'))
  } else if (type === 'audio') {
    svg.append(stroke(document, 'M4 9.4V6.6M8 11.4V4.6M12 9.4V6'), stroke(document, 'M2.6 8h1M12.4 8h1'))
  } else if (type === 'mark') {
    svg.append(
      document.createElementNS(SVG_NS, 'circle'),
      stroke(document, 'M8 1.6v2.4M8 12v2.4M1.6 8h2.4M12 8h2.4'),
    )
    const ring = svg.firstChild as SVGCircleElement
    ring.setAttribute('cx', '8')
    ring.setAttribute('cy', '8')
    ring.setAttribute('r', '2.6')
    ring.setAttribute('fill', 'none')
    ring.setAttribute('stroke', 'currentColor')
    ring.setAttribute('stroke-width', '1.1')
  } else if (type === 'region') {
    svg.append(
      stroke(
        document,
        'M2.8 6V2.8H6M10 2.8h3.2V6M13.2 10v3.2H10M6 13.2H2.8V10',
      ),
    )
  } else if (type === 'element') {
    // 元素是「产物里的一个节点」：一枚实心方框加它自己的那条横线（像个块），与
    // region 那圈四角括号分得开——那说的是「图上框出来的区域」，不是 DOM 里的节点。
    svg.append(stroke(document, 'M2.8 3.2h10.4v9.6H2.8z'), stroke(document, 'M2.8 6h10.4'))
  } else {
    svg.append(stroke(document, 'M4.2 1.8h4.9L12.8 5.5V14a.6.6 0 0 1-.6.6H4.2a.6.6 0 0 1-.6-.6V2.4a.6.6 0 0 1 .6-.6Z'), stroke(document, 'M9 1.9v3.7h3.7'))
  }
  return svg
}

/** 媒体标签上的那枚缩略图。 */
function thumb(document: Document, reference: PromptReference): HTMLImageElement {
  const image = document.createElement('img')
  image.className = `${CHIP_CLASS}-thumb`
  image.src = reference.thumbnail ?? ''
  // 已经在图片本身上标了原点/区域时，标签里这张小图也会被圈一下——人一眼看得出是哪一处。
  image.alt = ''
  image.draggable = false
  return image
}

/** 这一段文字里有没有坐标/行号可挂（标记类必有其一，其余看调用方知不知道）。 */
function badgeOf(reference: PromptReference): string | undefined {
  return referenceBadge(reference)
}

/**
 * 一枚标签：图标（或缩略图）+ 名字 + 可选徽标，整体不可分隔。
 *
 * 名字只取最后一段（`hero/index.html` → `index.html`），与画布上引用 chips 的写法一致；
 * 整条路径挂在 `title` 上——两枚同名文件靠悬停分辨，而标签本身始终只有一枚的可读宽度。
 * 名字写的是**文件名而不是序号**：本插件的锚点就是路径，两枚同名图片因此在提示词里也还
 * 分得清谁是谁（文档那套 `@图片1` 编号属于「图片另走一路」的设计，见 `PromptReference`）。
 */
function chipElement(document: Document, reference: PromptReference): HTMLElement {
  const chip = document.createElement('span')
  chip.className = CHIP_CLASS
  chip.setAttribute('contenteditable', 'false')
  chip.setAttribute(CHIP_TOKEN_ATTR, reference.id)
  chip.setAttribute(CHIP_TYPE_ATTR, reference.type)
  chip.title = reference.detail ?? reference.filePath ?? reference.target ?? reference.label
  if (reference.filePath !== undefined) chip.setAttribute(CHIP_PATH_ATTR, reference.filePath)
  chip.append(
    reference.type === 'image' && reference.thumbnail !== undefined
      ? thumb(document, reference)
      : glyphFor(document, reference.type),
  )
  const label = document.createElement('span')
  label.className = `${CHIP_CLASS}-label`
  label.textContent = reference.label
  chip.append(label)
  const badge = badgeOf(reference)
  if (badge !== undefined) {
    chip.setAttribute(CHIP_BADGE_ATTR, badge)
    const span = document.createElement('span')
    span.className = `${CHIP_CLASS}-badge`
    span.textContent = badge
    chip.append(span)
  }
  return chip
}

/**
 * 值 → 内容。**这是这棵子树唯一的写入口**：别处一律不许碰它的 childNodes。
 *
 * 换行落成一枚 `<br>` 而不是文字里的 `\n`：`<br>` 在**任何位置**都实实在在换一行
 * （含开头与结尾），而写法上是 `<br>` 还是 `\n` 由这里定死，{@link flatten} 就照着读
 * 回来——两边是同一句话，中间没有留给浏览器的余地。
 */
export function writeAtoms(host: HTMLElement, atoms: readonly PromptAtom[]): void {
  const document = host.ownerDocument
  const next = document.createDocumentFragment()
  for (const atom of atoms) {
    if (atom.kind === 'ref') {
      next.append(chipElement(document, atom.reference))
      continue
    }
    atom.text.split('\n').forEach((line, index) => {
      if (index > 0) next.append(document.createElement('br'))
      if (line !== '') next.append(document.createTextNode(line))
    })
  }
  host.replaceChildren(next)
}
