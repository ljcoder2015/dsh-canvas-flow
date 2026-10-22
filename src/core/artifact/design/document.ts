/**
 * dsh-canvas — 设计文档（v2 底座：`@open-pencil/scene-graph`）。
 *
 * v1 是一套自研 Kiwi schema（24 字段 + 自写编解码）；v2 拍板改道 OpenPencil
 * （方案 A，格式破坏性切换，见 `docs/DeepSeek-Harness-Canvas-OpenPencil-接入方案.md`）：
 * 文档模型直接用场景图 `SceneGraph`（plain 数据 + 现成的命中/选择/undo 面），
 * v1 文件**不做转换器**——设计卡是模型生成的，重新生成成本≈0。
 *
 * 文件信封保留 v1 的形态判据：workspace seam 是 text-write-only，`.design`
 * 文件 = 一行头 + 正文。v1 的正文是 base64 的 Kiwi；v2 换成**场景图 JSON 快照**
 * （`SceneNode` 是可 structuredClone 的 plain 数据，JSON 天然无损），可读、
 * 可 diff、isomorphic，二进制（.fig 互通）留给确有刚需的那天。
 *
 * **「JSON 天然无损」有一个例外**，就是 {@link decodeDesignFile} 里那句
 * {@link reviveInstanceOverrides}：实例覆写表里装着两个 `Map`（JSON 写成 `{}`），
 * `Uint8Array` 类的字段（`textPicture`、几何 blob）同样会被写成对象——前者的复活是必须的
 * （上游按 Map 用它），后者到目前为止没有来路（我们的稿子不由 .fig 导进来）。这一层吐出去的
 * 节点必须与 `createNode` 造出来的**一样好用**，否则炸点会出现在很远的地方（复制页面）。
 */
import {
  SceneGraph,
  createInstanceOverrideState,
  deserializeInstanceOverrideState,
  type Color,
  type NodeType,
  type SceneNode,
  type SerializedInstanceOverrideState,
} from '@open-pencil/scene-graph'

/** The envelope header every `.design` file starts with. */
export const DESIGN_FILE_PREFIX = 'dsh-design-'
/** The envelope version this code writes; v1 files are refused, not migrated. */
export const DESIGN_FILE_VERSION = 2

/** The design document model — the OpenPencil scene graph. */
export type DesignGraph = SceneGraph
export type { Color, NodeType, SceneNode }

// ── scaffold ───────────────────────────────────────────────────────────────

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 }

/**
 * A brand-new design document: one blank 1024×1024 container (§四.2 scaffold)
 * on the scene graph's default page. The container is a white FRAME so it reads
 * as a sheet on the canvas grid.
 *
 * `clipsContent` 跟着 Figma 的 frame 语义走：容器默认裁切溢出内容。
 */
export function scaffoldDesignDocument(): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (page !== undefined) page.name = '页面 1'
  graph.createNode('FRAME', page.id, {
    name: '容器 1',
    x: 0,
    y: 0,
    width: 1024,
    height: 1024,
    clipsContent: true,
    fills: [{ type: 'SOLID', color: WHITE, opacity: 1, visible: true }],
  })
  return graph
}

// ── walks ──────────────────────────────────────────────────────────────────

/**
 * 一个节点下的容器，z 序——**沿区域下潜**：区域（SECTION）是归类容器的组织层，它的子容器
 * 同样是画布上的容器。遇到容器就收下且不再下潜：嵌套容器是模块，不是独立的一块。
 */
function containersUnder(graph: SceneGraph, parentId: string): SceneNode[] {
  const containers: SceneNode[] = []
  for (const child of graph.getChildren(parentId)) {
    if (child.type === 'FRAME') containers.push(child)
    else if (child.type === 'SECTION') containers.push(...containersUnder(graph, child.id))
  }
  return containers
}

/**
 * **一页**的容器：那一页的 FRAME（穿区域），z 序。
 *
 * 画布那一侧（渲染、贴合、命中）要的都是这一份——一次只画一页。多页之后
 * 「整份文档的容器」与「这一页的容器」是两件事：前者会把别页的容器也画在同一块画布上，
 * 而两页的内容常常坐标完全相同（复制出来的页就是这样），叠起来看不出错，只看得见怪。
 */
export function containersIn(graph: SceneGraph, pageId: string): SceneNode[] {
  return containersUnder(graph, pageId)
}

/** The containers of a document: the FRAME nodes of its pages (through regions), in z-order. */
export function containersOf(graph: SceneGraph): SceneNode[] {
  return graph.getPages().flatMap((page) => containersIn(graph, page.id))
}

/** The children of one node, in z-order. */
export function childrenOf(graph: SceneGraph, id: string): SceneNode[] {
  return graph.getChildren(id)
}

/**
 * 缩略图用哪一页：**第一页**。
 *
 * 不是「当前页」——缩略图是在离屏那侧画的（fig 写器的 `thumbnailPageId`、卡片截图），
 * 那儿没有「当前」这个概念。也不是「随便一页」：上游的兜底只认一个叫 `cover` 的页
 * （Figma 的封面页约定），我们的文档没有这个约定，而第一页就是整份文档的那一眼。
 * 一份文档至少有一页（`canRemovePage`），真取不到时给 `undefined` 让调用方自己兜。
 */
export function firstPageId(graph: SceneGraph): string | undefined {
  return graph.getPages()[0]?.id
}

/**
 * 一个节点落在哪一页（沿父链上溯，直到某一级的 id 本身就是一个页面）。
 *
 * 导出用得着它：绘图那几条出路都要「一页一份」——一张图一个容器、一页 PDF 一个容器、
 * 一页幻灯片一个容器——而容器可以挂在区域（SECTION）下面，所以它离页面还隔着几级。
 * open-pencil 的 io 里有同样的一件事（`findPageId`），但它没从任何公开子路径露出来，
 * 于是这里自己走一遍；判据（`tests/core/artifact/design.spec.ts`）把它钉在区域嵌套这条
 * 边界上。
 *
 * 上溯到根还没碰到页面就是 `null`（游离节点，画不出来也导不出去）。
 */
export function pageOf(graph: SceneGraph, nodeId: string): string | null {
  const pages = new Set(graph.getPages().map((page) => page.id))
  let cursor: string | null = nodeId
  while (cursor !== null) {
    if (pages.has(cursor)) return cursor
    cursor = graph.getNode(cursor)?.parentId ?? null
  }
  return null
}

// ── digest ─────────────────────────────────────────────────────────────────

/**
 * Bounded digest for the board and card summaries (F5.2): pages, containers
 * and their shape counts — the structure a model needs to decide what to read.
 */
export function designDigest(graph: SceneGraph, budget = 40): { summary: string; outline: string[] } {
  const pages = graph.getPages()
  const lines: string[] = []
  let used = 0
  for (const page of pages) {
    // 区域里的容器也算这一页的容器——与 containersIn 同一套遍历口径。
    const boards = containersIn(graph, page.id)
    lines.push(`页面 ${page.name}：${boards.length} 个容器`)
    used += 1
    for (const board of boards) {
      if (used >= budget) {
        lines.push('…（其余从略）')
        return { summary: lines.join('\n'), outline: lines }
      }
      const shapes = graph.getChildren(board.id)
      lines.push(`  容器 ${board.name}（${Math.round(board.width)}×${Math.round(board.height)}）：${shapes.length} 个图层`)
      used += 1
    }
  }
  return { summary: lines.join('\n'), outline: lines }
}

// ── envelope ───────────────────────────────────────────────────────────────

/** One JSON snapshot of a scene graph — the v2 payload. */
interface DesignSnapshot {
  format: 'dsh-design'
  version: 2
  rootId: string
  nodes: SceneNode[]
}

/** Encode a document into the text envelope: one header line, JSON body. */
export function encodeDesignFile(graph: SceneGraph): string {
  const snapshot: DesignSnapshot = {
    format: 'dsh-design',
    version: 2,
    rootId: graph.rootId,
    nodes: [...graph.nodes.values()],
  }
  return `${DESIGN_FILE_PREFIX}${DESIGN_FILE_VERSION}\n${JSON.stringify(snapshot)}`
}

/**
 * 解码失败的那六种形状，各给一个**码**。
 *
 * 这里的中文消息仍是真源（模型与诊断日志读它），但**用户眼前那一句**由客户端按码出
 * （`client/ui/locales.ts` 的 `canvas.design.*`）——与 `import-plan.ts` 的「宿主报枚举、
 * 客户端出文案」是同一条分工：core 是纯逻辑，不知道界面语言。
 */
export type DesignDecodeCode =
  | 'not-design'
  | 'legacy'
  | 'future'
  | 'bad-json'
  | 'bad-snapshot'
  | 'bad-node'

/** 解码失败：带码的 Error，客户端按码出界面文案，消息原样留给诊断。 */
export class DesignDocumentError extends Error {
  readonly code: DesignDecodeCode
  /** 只在 `future` 下有意义：那个读不出来的文件头。 */
  readonly detail: string

  constructor(code: DesignDecodeCode, message: string, detail = '') {
    super(message)
    this.code = code
    this.detail = detail
  }
}

/** Decode a `.design` file's text into a scene graph. Throws `DesignDocumentError` on any malformed envelope. */
export function decodeDesignFile(text: string): SceneGraph {
  const [header, ...rest] = text.split('\n')
  if (header === undefined || !header.startsWith(DESIGN_FILE_PREFIX)) {
    throw new DesignDocumentError('not-design', '不是一份设计文档（缺少文件头）')
  }
  const version = Number.parseInt(header.slice(DESIGN_FILE_PREFIX.length), 10)
  if (version === 1) {
    throw new DesignDocumentError('legacy', '旧版设计文件（v1），请让模型重新生成这份设计')
  }
  if (!Number.isInteger(version) || version > DESIGN_FILE_VERSION) {
    throw new DesignDocumentError('future', `设计文档版本过新：${header}`, header)
  }
  let snapshot: DesignSnapshot
  try {
    snapshot = JSON.parse(rest.join('\n')) as DesignSnapshot
  } catch {
    throw new DesignDocumentError('bad-json', '设计文档内容损坏（JSON 解不开）')
  }
  if (snapshot?.format !== 'dsh-design' || snapshot?.version !== 2 || !Array.isArray(snapshot?.nodes)) {
    throw new DesignDocumentError('bad-snapshot', '设计文档内容损坏（快照结构不对）')
  }
  const graph = new SceneGraph()
  graph.nodes.clear()
  graph.rootId = snapshot.rootId
  for (const node of snapshot.nodes) {
    if (typeof node?.id !== 'string') {
      throw new DesignDocumentError('bad-node', '设计文档内容损坏（节点缺 id）')
    }
    node.instanceOverrides = reviveInstanceOverrides(node.instanceOverrides)
    graph.nodes.set(node.id, node)
  }
  return graph
}

/**
 * 把**实例覆写表**从 JSON 里那个形状复活成内存里那个形状。
 *
 * 这是「快照是 plain 数据」这话的**例外**：`instanceOverrides` 里装着两个 `Map`
 * （`createInstanceOverrideState()` 的 `{ self, descendants }`），而 `JSON.stringify` 把 Map
 * 写成 `{}`。不解回来，任何按 Map 用它 的上游代码都会炸——`cloneTree` 第一句就是
 * `[...state.self]`，`{}` 不可迭代：**于是「复制页面」在每一份真文档上都直接抛**
 * （v1.65 做 fig 换行时抓到；`pages.spec.ts` 全绿是因为那些判据都在**内存图**上跑，
 * 从来没喂过一份 `decodeDesignFile` 出来的图）。
 *
 * 空表是常态（覆写只从真 Figma 文件来），所以这里只认一件事：**不是数组的就当空表**，
 * 是数组的照上游那套反序列化（值本身还带类型标记，不能自己解）。
 */
function reviveInstanceOverrides(value: unknown): SceneNode['instanceOverrides'] {
  const raw = (value ?? {}) as { self?: unknown; descendants?: unknown }
  if (!Array.isArray(raw.self) && !Array.isArray(raw.descendants)) return createInstanceOverrideState()
  return deserializeInstanceOverrideState({
    self: Array.isArray(raw.self) ? raw.self : [],
    descendants: Array.isArray(raw.descendants) ? raw.descendants : [],
  } as SerializedInstanceOverrideState)
}

// ── model-facing JSON (wire) ───────────────────────────────────────────────

/** The wire's node type names — scene-graph types, lowercased. */
const WIRE_TYPES: Readonly<Record<NodeType, string>> = {
  CANVAS: 'canvas',
  FRAME: 'frame',
  RECTANGLE: 'rect',
  ROUNDED_RECTANGLE: 'rounded-rect',
  ELLIPSE: 'ellipse',
  TEXT: 'text',
  LINE: 'line',
  STAR: 'star',
  POLYGON: 'polygon',
  VECTOR: 'vector',
  BOOLEAN_OPERATION: 'boolean-operation',
  GROUP: 'group',
  SECTION: 'section',
  COMPONENT: 'component',
  COMPONENT_SET: 'component-set',
  INSTANCE: 'instance',
  CONNECTOR: 'connector',
  SHAPE_WITH_TEXT: 'shape-with-text',
}

/** Wire type → scene-graph type, for the ops that mint nodes. */
export const NODE_TYPES_BY_WIRE: Readonly<Record<string, NodeType>> = Object.fromEntries(
  Object.entries(WIRE_TYPES)
    .map(([scene, wire]) => [wire, scene as NodeType])
    .filter(([wire]) => !['canvas', 'component-set', 'boolean-operation', 'connector', 'shape-with-text'].includes(wire)),
) as Readonly<Record<string, NodeType>>

/** First visible solid fill of a node as CSS (`#rrggbb`); `''` when painted by nothing. */
export function fillToCss(node: SceneNode): string {
  const paint = node.fills.find((fill) => fill.visible && fill.type === 'SOLID')
  return paint === undefined ? '' : colorToCss(paint.color)
}

/** First visible stroke of a node as CSS (`#rrggbb`); `''` when unstroked. */
export function strokeToCss(node: SceneNode): string {
  const stroke = node.strokes.find((stroke) => stroke.visible)
  return stroke === undefined ? '' : colorToCss(stroke.color)
}

/** `{r,g,b,a}` (0–1 floats) → `#rrggbb`, alpha folded in only when it matters. */
export function colorToCss(color: Color): string {
  const byte = (channel: number): string => Math.round(Math.min(Math.max(channel, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0')
  const hex = `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`
  return color.a >= 1 ? hex : `${hex}${byte(color.a)}`
}

/** `#rgb` / `#rrggbb` / `#rrggbbaa` → Color, or `undefined` when unparsable. */
export function colorFromCss(text: string): Color | undefined {
  const match = /^#([0-9a-f]{3,8})$/i.exec(text.trim())
  if (match === null) return undefined
  const hex = match[1]
  const expand = (pair: string): number => Number.parseInt(pair, 16) / 255
  if (hex.length === 3) {
    return { r: expand(hex[0] + hex[0]), g: expand(hex[1] + hex[1]), b: expand(hex[2] + hex[2]), a: 1 }
  }
  if (hex.length === 6) {
    return { r: expand(hex.slice(0, 2)), g: expand(hex.slice(2, 4)), b: expand(hex.slice(4, 6)), a: 1 }
  }
  if (hex.length === 8) {
    return { r: expand(hex.slice(0, 2)), g: expand(hex.slice(2, 4)), b: expand(hex.slice(4, 6)), a: expand(hex.slice(6, 8)) }
  }
  return undefined
}

/** One node as the model sees it (F2.6): flat, css colors, lowercase types. */
export function designNodeToJson(node: SceneNode): {
  id: string
  type: string
  parentId: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  cornerRadius: number
  visible: boolean
  fill: string
  stroke: string
  strokeWidth: number
  text: string
  fontSize: number
  fontFamily: string
  align: 'left' | 'center' | 'right' | 'justified'
} {
  return {
    id: node.id,
    type: WIRE_TYPES[node.type],
    // The model never sees the graph's synthetic root — the caller filters it
    // out — so a parent here is always a real, addressable node id.
    parentId: node.parentId ?? '',
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    opacity: node.opacity,
    cornerRadius: node.cornerRadius,
    visible: node.visible,
    fill: fillToCss(node),
    stroke: strokeToCss(node),
    strokeWidth: node.strokes.find((stroke) => stroke.visible)?.weight ?? 0,
    text: node.text,
    fontSize: node.fontSize,
    fontFamily: node.fontFamily,
    align: node.textAlignHorizontal.toLowerCase() as 'left' | 'center' | 'right' | 'justified',
  }
}
