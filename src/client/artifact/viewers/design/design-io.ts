/**
 * dsh-canvas — 设计稿的四条出路（F10.1，v1.59）。
 *
 * 四样：**Figma 文件**（`.fig`）、**图片**（PNG）、**PDF**、**PPT**。它们全都跑在浏览器里，
 * 也全都由 open-pencil 的 io 层画出来——这一层只负责「翻译」：把一份场景图快照，按用户的
 * 选择交给哪一个导出器、按什么粒度切、以及切不出来时怎么如实说。
 *
 * 三件事值得写在这里，因为它们都不是显而易见的：
 *
 * **一、一律走 `IOContext`，绝不走 headless。** open-pencil 有条「headless」的路
 * （`headlessRenderNodes`），它在 node/bun 里靠 `import.meta.resolve('canvaskit-wasm/full')`
 * 找 wasm——浏览器里 `import.meta.resolve` 根本不存在，一调就炸。所以图片、PPT 的降级栅格
 * 化都必须拿到**我们自己的**渲染器（`createExportRenderer`），走 `context` 递进去。
 *
 * **二、粒度是「一样东西一份」。** 图片一容器一张、PPT 一页面一份幻灯片序列——而 `.fig` 与
 * PDF 是**整份文档一个文件**（PDF 一容器一页，页在文档里面）。这不是美学：open-pencil 的
 * 导出器按**选区**取节点，而选区不许跨页面（跨页它会直接抛）。所以「按容器切」既是产物该有
 * 的样子（海报系列、幻灯片每一页各是一张），也正好落在导出器能接受的形状里；PDF 那些页再
 * 一起写进同一份文档（见 `design-pdf.ts`）。
 *
 * **三、切不动就说，不交半份。** 任何一个可见容器画不出来，整趟就当没导成（`kind: 'error'`，
 * 名字报出来）。悄悄少一张图比导不出来坏得多——这条规矩与 v1.57 的文本导出、v1.58 的应用
 * 打包是同一条。
 *
 * **四、交出去之前要换字体名——PPT、fig、PDF 三条都要。** 三者的理由不同但同源：那个名字
 * 是**我们自己这边的东西**（拉丁 `Inter`、汉字靠 vendored 的 Noto Sans SC 回落），而这三条
 * 交出去的产物会被别人的软件解析——PowerPoint 拿它排原生文本、Figma 拿它取字形轮廓、jsPDF
 * 拿它在自己的字体表里查。只有图片那条不换：字是我们自己画的，那个名字在那边就是「拿去
 * `fontManager` 找字面」用的。理由、选名与「PDF 还要顺手收字重」见
 * `core/artifact/design/export-font.ts`。
 *
 * **五、fig 那条还要多做两件事，都是在**同一份一次性图**上做的**（v1.65，理由与症状见
 * `core/artifact/design/fig-text.ts`）：
 *
 * 1. **把中文字面按稿子用到的每个样式名登记一遍**。写器取字形轮廓与字体摘要都按
 *    「字族 + 样式名」去 `fontManager` 找，而手里只有一支 Regular——写着 700 的字于是取到
 *    `null`：字形数组空、摘要空，在 Figma 里就是「这段字不见了」。
 * 2. **把「写器会烘歪」的文本改写成一行一个节点**。写器的烘字形那一步只对「单行 + 左上对齐」
 *    成立：它把整段按同一行摆（`baselines` 只写一条、`\n` 还会落到 `.notdef` 变成一个方块），
 *    坐标又恒从**节点原点**起算（水平居中/右对齐那段偏移、垂直居中/靠底那段偏移都烘不进去）。
 *    改写用的是**画布自己那份段落**的逐行量，所以折行位置与对齐偏移都必然与画布一致——我们只是
 *    把「一次画 N 行 / 画在框中间」换成「N 个节点、每个贴住自己那一行」。
 *
 * 两件事都**只碰「不修就会烘歪」的那些节点**：字体那一半只碰缺字面的样式；改写那一半只碰
 * **多行、或对齐偏移非零**的文本（判据在 `fig-text.ts` 的 `worthRewriting`——单行 + 左上对齐
 * 是写器唯一烘得对的那种形状，一个字段都不碰）。于是这一版的炸面就停在「画布上一眼能看出
 * 会被烘歪」的那些文字上。
 *
 * **六、PPT 那条要改两次输入：把越界的子块预夹掉，夹不动的就地烘成图片**（v1.66 / v1.68，
 * 理由与症状见 `core/artifact/design/pptx-preclip.ts` 与 `pptx-raster.ts`）。上游 pptx 导出器
 * 本来是「可编辑混合导出」，但 root 容器只要**开着裁切又有子孙越界**（>0.5px），它就放弃逐元素
 * 转换、**把整页栅格成一张图**——而我们的容器默认就开裁切、AI 画稿时装饰子块贴边又是常态，
 * 于是真机上每页都是一张图片、所有文字跟着落进那张图。两步都抵着同一句话：**越界的那部分在
 * 画布上本来就被裁掉、不可见**，所以
 *
 * 1. **直角矩形叶子**：夹进所有裁切祖先边界的**交**（矩形 ∩ 矩形 = 矩形，逐像素等价）；
 * 2. **夹不动的**（圆角矩 / 椭圆 / 文本 / 矢量 / 带子树的容器）：套一个同尺寸的裁切框、连
 *    裁切一起画成 PNG，再用它顶掉（图片是矩形，夹过之后裁剪与画布上裁掉同一块完全一样）。
 *
 * 第二步**要渲染器**，所以它排在渲染器起好之后；画不出来就回滚成原样（照旧退图，但画布外观
 * 一字未改）。两步都只碰那份一次性图，且**只有 PPT 这条路**走它们。
 *
 * 这个模块**只住在引擎 chunk 里**（`lib/assets/design-engine.js`）：它 import 的是
 * `@open-pencil/core/io`，而场景图的类身份必须全页唯一（见 `design-engine.ts` 开头的两条
 * 理由）。client.js 那边只看 `design-engine-types.ts` 里声明的形状。
 */
import {
  BUILTIN_IO_FORMATS,
  IORegistry,
  computeContentBounds,
  renderNodesToSVG,
} from '@open-pencil/core/io'
import type { ExportTarget, IOContext } from '@open-pencil/core/io'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { fontManager } from '@open-pencil/core/text'
import { containersOf, decodeDesignFile, firstPageId, pageOf } from '../../../../core/artifact/design/document.ts'
import {
  CJK_TEXT_FAMILY,
  exportTextRetarget,
  pdfTextStyles,
  retargetTextFonts,
} from '../../../../core/artifact/design/export-font.ts'
import {
  figLineNodes,
  figTextStyles,
  type FigLineNode,
  type FigTextLine,
} from '../../../../core/artifact/design/fig-text.ts'
import { preclipOverflowingRects } from '../../../../core/artifact/design/pptx-preclip.ts'
import { rasterizeStubbornOverflows } from '../../../../core/artifact/design/pptx-raster.ts'
import type { SkiaRenderer } from '@open-pencil/core/canvas'
import { createExportRenderer, ensureCJKFont, type ExportRenderer } from './design-skia.ts'
import { renderPdfDocument, type PdfPageSource } from './design-pdf.ts'
import { DesignExportFailure } from './design-failure.ts'
import type { DesignExportOutcome, DesignExportRequest, DesignExportUnit } from './design-engine-types.ts'

/**
 * 导出器登记表。
 *
 * 用 open-pencil 自己的那个门面（`IORegistry` + 内置格式表）而不是逐个 import 各家
 * `exportXxx`：`fig` / `svg` / `raster` 三条子路径在包的 exports map 里，而 **pdf 与 pptx
 * 不在**（`renderNodesToPDF`、`renderNodesToPPTX` 都没从 `@open-pencil/core/io` 的顶层露
 * 出来，只有格式表里那两个 adapter 认得它们）。门面是唯一处处露着的那一面，也是这个包
 * 自己给外部用的那一面。
 */
const IO = new IORegistry(BUILTIN_IO_FORMATS)

/** 位图倍率：设计稿是 1× 逻辑像素，2× 是清晰度与体量的平衡点（v1.59 定，用户拍的）。 */
export const DESIGN_EXPORT_SCALE = 2

/** 一次导出：把信封解成图，按格式画出来。被拒是答案，不是异常。 */
export async function exportDesignDocument(request: DesignExportRequest): Promise<DesignExportOutcome> {
  let graph: SceneGraph
  try {
    graph = decodeDesignFile(request.envelope)
  } catch {
    // 三条报错各有各的说法（旧 v1 信封 / JSON 坏 / 快照结构不对），但用户的下一步
    // 只有一件事：让模型重新生成这份设计。所以合成一个理由。
    return { kind: 'refused', reason: 'broken' }
  }

  const containers = containersOf(graph).filter((node) => node.visible)
  if (containers.length === 0) return { kind: 'refused', reason: 'empty' }

  // 交出去之前把字体名换掉（三条路各有各的理由，见 `core/artifact/design/export-font.ts`）。
  // **必须在这一步之前**——fig 那边写器就是按这个字段去取字形轮廓的，晚了就取的是旧名字。
  const retarget = exportTextRetarget(request.format)
  if (retarget !== null) retargetTextFonts(graph, retarget)

  // 渲染器**先起**：fig 用它画缩略图（没有也照导，只是缩略图退成 1×1），图片与 PPT 则
  // 非要它不可。一条路起一次，四种格式共用同一个判断。
  const canvas = await createExportRenderer()
  if (canvas === null && (request.format === 'png' || request.format === 'pptx')) {
    return { kind: 'refused', reason: 'no-engine' }
  }

  try {
    switch (request.format) {
      case 'fig':
        return await figDocument(graph, canvas)
      case 'png':
        return await perContainer(graph, containers, { scale: request.scale ?? DESIGN_EXPORT_SCALE }, canvas)
      case 'pdf':
        return await pdfDocument(graph, containers)
      default: {
        // PPT 那条多两步，都是在交出去之前、只碰这份一次性图：
        //
        // 1. **夹**：把越界的直角矩形叶子收进裁切边界（矩形 ∩ 矩形 = 矩形，逐像素等价）。
        // 2. **烘**：夹不动的那些（圆角矩 / 椭圆 / 文本 / 矢量 / 带子树的容器）连同裁切一起
        //    画成一张 PNG，再用它顶掉——因为上游那条拱门是**整页**退图，一个夹不动的越界
        //    子孙就够让这一页的可编辑性全丢、所有文字落进图片。理由与边界见
        //    `core/artifact/design/pptx-preclip.ts` 与 `pptx-raster.ts`。
        //
        // **只有这条路夹与烘**：图片 / PDF / fig 各有各的保真手段。
        preclipOverflowingRects(graph)
        await rasterizeStubbornOverflows(
          graph,
          async (nodeId, scale) =>
            (await draw(graph, 'png', nodeTarget(nodeId), { scale }, canvas)) ?? null,
          DESIGN_EXPORT_SCALE,
        )
        return await perPage(graph, containers, canvas)
      }
    }
  } catch (error) {
    // 带码的那四种「画不出来」把码与名字一起交回去，文案让客户端按码出（双语的真源在
    // `locales.ts`，这个 chunk 不知道界面语言）；别的异常原样透传消息。
    if (error instanceof DesignExportFailure) {
      return {
        kind: 'error',
        message: error.message,
        code: error.code,
        ...(error.unit === '' ? {} : { unit: error.unit }),
      }
    }
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  } finally {
    canvas?.dispose()
  }
}

/** 整份文档 → 一个 `.fig`。 */
async function figDocument(graph: SceneGraph, canvas: ExportRenderer | null): Promise<DesignExportOutcome> {
  // 交出去之前把这份一次性图改写成写器**画得对**的形状（两件事，见文件头第五条）。
  await registerFigFontStyles(graph)
  if (canvas !== null) splitFigLines(graph, canvas.renderer)

  const result = await IO.writeDocument(
    'fig',
    graph,
    {
      // 有渲染器就画一张真的缩略图（Figma 的文件列表上就是它），没有就让 open-pencil 放
      // 它自己那张 1×1 的占位图——这不是失败，是「这台机器上没取到 CanvasKit」。
      renderThumbnail: canvas !== null,
      // **页必须点名**：`writeDocument` 那条路（整份文档，没有选区可提取）不会替我们猜是
      // 哪一页，而 fig 写器在拿不到页 id 时**直接交那张 1×1 的占位图**——于是「导出成功」
      // 而 Figma 里的缩略图是一片空白，两处都不报错。取哪一页的口径在 `firstPageId` 里。
      thumbnailPageId: firstPageId(graph),
    },
    contextOf(canvas),
  )
  return { kind: 'done', units: [{ name: '', bytes: bytesOf(result.data) }] }
}

/**
 * 把手上那一支中文字面，按**这份稿子用到的每个样式名**登记一遍。
 *
 * 名字必须是换过之后的那个（`retargetTextFonts` 已经跑过），因为写器就是按 `node.fontFamily`
 * 去查的。查不到时它给的是 `null`——字形数组空、`fontDigest` 也空，静默地在 Figma 里少一段字。
 *
 * **同一份字节登记到多个样式名下**是有意的：我们手里只有一支 Regular（仓库 vendored 的
 * Noto Sans SC），而稿子里的 700 号字问的是 `Bold`。登记之后烘出来的轮廓是常规粗细（本来就
 * 只有这一支），但**字在、摘要也在**；对方若自己解决得出真正的 Bold，文件名里那个 `Bold` 也
 * 还留着。取不到字面就照实照旧导——那是「资产没装上」，与这里的登记无关。
 */
async function registerFigFontStyles(graph: SceneGraph): Promise<void> {
  const missing = figTextStyles(graph).filter(
    (style) => fontManager.loadedData(CJK_TEXT_FAMILY, style) === null,
  )
  if (missing.length === 0) return
  const font = await ensureCJKFont()
  if (font === null) return
  for (const style of missing) fontManager.markLoaded(CJK_TEXT_FAMILY, style, font)
}

/**
 * 「写器会烘歪」的文本 → 一行一个节点（每个都贴住画布上那一行）。
 *
 * 逐行量取的是**画布自己那份段落**（`buildParagraph` 用 `halfLeading: true`——与 `renderText`
 * 画的时候同一个选项），所以折行位置、对齐偏移、基线高度都是画布上那一份，不是我们另算的。
 * 排不出来（字面没就位之类）就跳过这个节点：留给上游照旧烘，比切错强。
 */
function splitFigLines(graph: SceneGraph, renderer: SkiaRenderer): void {
  // 先收名单再改图：改的过程中会在同一个父下插节点、删节点。
  const targets = [...graph.getAllNodes()].filter(
    (node) => node.type === 'TEXT' && node.visible && node.text.length > 0,
  )
  for (const node of targets) {
    // 自动布局的父容器里不能拆：拆出来的 N 个兄弟会**参与流式排布**（叠起来、把父框撑开），
    // 而它们本来就是一段文字里的几行。留着不拆，结果是老样子（合成一行），不会画坏。
    const parent = node.parentId === null ? undefined : graph.getNode(node.parentId)
    if (parent !== undefined && parent.layoutMode !== 'NONE' && parent.layoutMode !== 'GRID') continue

    let lines: FigTextLine[]
    let contentHeight: number
    try {
      const paragraph = renderer.buildParagraph(node, undefined, { halfLeading: true })
      try {
        lines = paragraph.getLineMetrics().map((line) => ({
          start: line.startIndex,
          end: line.endIndex,
          left: line.left,
          width: line.width,
          baseline: line.baseline,
        }))
        contentHeight = paragraph.getHeight()
      } finally {
        paragraph.delete()
      }
    } catch {
      continue
    }

    const plans = figLineNodes(node, lines, contentHeight)
    if (plans === null) continue
    replaceWithLines(graph, node, plans)
  }
}

/** 原位换掉：N 个单行节点占住原来的 z 序位置，原节点删掉（只在这份一次性图上做）。 */
function replaceWithLines(graph: SceneGraph, node: SceneNode, plans: readonly FigLineNode[]): void {
  const parentId = node.parentId
  if (parentId === null) return
  const index = graph.getChildren(parentId).findIndex((child) => child.id === node.id)
  if (index < 0) return

  plans.forEach((plan, offset) => {
    // 用上游的 `cloneTree` 而不是手抄一份字段名单：节点的可变字段有二十来个（paint、几何、
    // 绑定、样式段…），抄一遍就是「同一个东西两个来源」，上游加字段时这里会静默少一个。
    const line = graph.cloneTree(node.id, parentId, {
      text: plan.text,
      x: plan.x,
      y: plan.y,
      width: plan.width,
      height: plan.height,
      styleRuns: plan.styleRuns,
      // 「贴住内容、左对齐、单行」——写器烘得对的那一种形状（理由见 `fig-text.ts`）。
      textAutoResize: 'WIDTH_AND_HEIGHT',
      textAlignHorizontal: 'LEFT',
      textAlignVertical: 'TOP',
      // 路径文字那几张表跟着原节点走没有意义（排版我们已经替它做完了），清掉免得写器又按
      // 路径烘一遍；`derivedTextGlyphs` / `textPicture` 同理——那是**原来那一段**的烘焙。
      textPathData: null,
      textPathBox: null,
      textPicture: null,
      derivedTextGlyphs: null,
    })
    if (line !== null) graph.insertChildAt(line.id, parentId, index + offset)
  })
  graph.deleteNode(node.id)
}

/** 图片的粒度：一张一个容器。 */
async function perContainer(
  graph: SceneGraph,
  containers: readonly SceneNode[],
  options: Record<string, unknown>,
  canvas: ExportRenderer | null,
): Promise<DesignExportOutcome> {
  const units: DesignExportUnit[] = []
  for (const container of containers) {
    const data = await draw(graph, 'png', nodeTarget(container.id), options, canvas)
    if (data === undefined) throw new DesignExportFailure('unrenderable', container.name)
    units.push({ name: container.name, bytes: data })
  }
  return { kind: 'done', units }
}

/**
 * PDF 的粒度：**一容器一页，全在一份文档里**。
 *
 * 与图片那条分开写，是因为这一条根本没走 `IORegistry`——上游那个 `renderNodesToPDF` 不在包
 * 的 exports map 里，而它内部那句 `new jsPDF(...)` 又够不着（字体必须注册在正要写的那一份
 * 文档上），于是我们自己建（`design-pdf.ts`）。好在零件都露着：矢量图是
 * `renderNodesToSVG`、量尺是 `computeContentBounds`。
 *
 * 一份文档而不是一页一份再拼：少一次 18MB 字面的解析，产物里也少几份重复的字体子集。
 * 于是这一条交回**一件**字节——客户端那边按「一件就是一件」直接给他，不必合并。
 */
async function pdfDocument(
  graph: SceneGraph,
  containers: readonly SceneNode[],
): Promise<DesignExportOutcome> {
  const pages: PdfPageSource[] = []
  for (const container of containers) {
    // SVG 里根元素就写着 width/height/viewBox（上游照选区算好的），页面按这个尺寸建。
    const svg = renderNodesToSVG(graph, pageOf(graph, container.id) ?? '', [container.id], {
      xmlDeclaration: false,
    })
    const bounds = computeContentBounds(graph, [container.id])
    // 量不到内容就是 0×0，落到下面那句「画不出来」上——别写成 `=== undefined`（它给的是
    // `null`，那样会直接走进 `bounds.maxX` 而抛一个谁也读不懂的 TypeError）。
    const width = bounds === null ? 0 : bounds.maxX - bounds.minX
    const height = bounds === null ? 0 : bounds.maxY - bounds.minY
    if (svg === null || width <= 0 || height <= 0) {
      throw new DesignExportFailure('unrenderable', container.name)
    }
    // 容器 id 一起带上：交出去之前要在 SVG 上修三处（折行 / 裁剪的圆角 / 圆角的夹法），
    // 而 SVG 里没有「我是谁」——配对靠的就是「从哪个容器开始遍历」（见 `design-pdf.ts`）。
    pages.push({ svg, width, height, containerId: container.id })
  }

  // 字体是这一条的命门：不嵌它，svg2pdf 会回落 `times`，中文变成内容流里的乱码（见
  // `design-pdf.ts`）。取不到就照实说，不交一份没有字的产物。
  const font = await ensureCJKFont()
  if (font === null) throw new DesignExportFailure('cjk-font-missing')

  const bytes = await renderPdfDocument(graph, pages, pdfTextStyles(graph), font)
  return { kind: 'done', units: [{ name: '', bytes }] }
}

/**
 * PPT 的粒度是**页面**：一页的容器就是这一段幻灯片的每一张。
 *
 * 为什么按页面切而不是把所有容器一次交出去：导出器的选区不许跨页面（跨了直接抛），而页面
 * 正是「一叠幻灯片」这件事的天然单位。多页文档于是就得到多份 pptx——按全仓同一条规矩，
 * 多份打成包（见 `client/canvas/design-export.ts`），不丢也不合并。
 */
async function perPage(
  graph: SceneGraph,
  containers: readonly SceneNode[],
  canvas: ExportRenderer | null,
): Promise<DesignExportOutcome> {
  const units: DesignExportUnit[] = []
  for (const page of graph.getPages()) {
    const ids = containers.filter((node) => pageOf(graph, node.id) === page.id).map((node) => node.id)
    if (ids.length === 0) continue
    const data = await draw(graph, 'pptx', { scope: 'selection', nodeIds: ids }, {}, canvas)
    if (data === undefined) throw new DesignExportFailure('unrenderable', page.name)
    units.push({ name: page.name, bytes: data })
  }
  if (units.length === 0) return { kind: 'refused', reason: 'empty' }
  return { kind: 'done', units }
}

/** 交给门面画一次，把结果统一成字节。 */
async function draw(
  graph: SceneGraph,
  format: string,
  target: ExportTarget,
  options: Record<string, unknown>,
  canvas: ExportRenderer | null,
): Promise<Uint8Array | undefined> {
  const result = await IO.exportContent(format, { graph, target }, options, contextOf(canvas))
  const data = result.data
  if (typeof data === 'string') return new TextEncoder().encode(data)
  return data.byteLength === 0 ? undefined : data
}

/** 一个节点就是一份选区（导出器四种 target 里最小的那一种）。 */
function nodeTarget(nodeId: string): ExportTarget {
  return { scope: 'node', nodeId }
}

/** 有渲染器就把它作为 context 递进去；没有就交 `undefined`（让格式自己决定能不能画）。 */
function contextOf(canvas: ExportRenderer | null): IOContext | undefined {
  return canvas === null ? undefined : { canvasKit: canvas.ck, renderer: canvas.renderer }
}

/** `ExportResult.data` 是字节或文本二选一；这几条路都是字节。 */
function bytesOf(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? new TextEncoder().encode(data) : data
}
