/**
 * PPT 端「越界预夹」的判据（F10.1，v1.66）。
 *
 * 这一组对应真机报的那句话：「导出 PPT，每页都要能再次编辑，而不是为一张图片」。上游 pptx
 * 导出器本来是**可编辑混合导出**（文本 / 矩形 / 椭圆 / 直线转原生元素），但它在 root 一层
 * 有一条极保守的闸：**容器开着裁切、又有子孙越界（>0.5px）⇒ 整页栅格成一张图**
 * （`rootContentFallbackReason` → `clipsOverflowingContent`）。而我们的容器**默认开裁切**、
 * AI 画稿时装饰子块贴边又是常态 ⇒ 真机上每页都是一张图片。
 *
 * 修法是交出去之前把越界**预夹进所有裁切祖先边界的交**（`core/artifact/design/pptx-preclip.ts`）。
 * 越界判定**逐字复刻上游**那套（角点映进祖先局部、比 `[-0.5, w+0.5]`），所以这里另外拿
 * **上游源码**对一次账：那几句字面一改，配对与容差就全错，而这里静悄悄。
 *
 * 「夹得动」的判据是**数学上可证明的视觉等价**（矩形 ∩ 矩形 = 矩形；纯色、直角、全链平移 +
 * 正缩放），所以这一组把每一条前提都单独点名验一遍——放下任何一条，夹出来的就不再是画布上
 * 那块了。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { decodeDesignFile, encodeDesignFile } from '../../../../src/core/artifact/design/document.ts'
import {
  overflowsAncestor,
  preclipOverflowingRects,
} from '../../../../src/core/artifact/design/pptx-preclip.ts'

/** 读源码文本（跨文件对账用）。 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

const solid = (r = 0.2, g = 0.3, b = 0.8) => [
  { type: 'SOLID' as const, color: { r, g, b, a: 1 }, opacity: 1, visible: true },
]

/** 一页 + 一个 400×300、开裁切的容器。返回建节点的口子。 */
function sheet(): { graph: SceneGraph; page: string; board: SceneNode } {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (page === undefined) throw new Error('场景图里没有页面')
  const board = graph.createNode('FRAME', page.id, {
    name: '容器',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    clipsContent: true,
    fills: solid(),
  })
  return { graph, page: page.id, board }
}

/** 容器里放一个直角矩形（默认是「越界」那一档：340+120 > 400）。 */
function block(graph: SceneGraph, parentId: string, props: Record<string, unknown> = {}): SceneNode {
  return graph.createNode('RECTANGLE', parentId, {
    name: '装饰',
    x: 340,
    y: 240,
    width: 120,
    height: 120,
    fills: solid(),
    ...props,
  })
}

const boxOf = (node: SceneNode) => ({
  x: node.x,
  y: node.y,
  width: node.width,
  height: node.height,
})

describe('夹：越界的直角矩形收进裁切边界', () => {
  it('右侧与下方各越 60px ⇒ 夹成 60×60（交出来的那块）', () => {
    const { graph, board } = sheet()
    const node = block(graph, board.id)
    const outcome = preclipOverflowingRects(graph)
    expect(boxOf(node)).toEqual({ x: 340, y: 240, width: 60, height: 60 })
    expect(outcome).toEqual({ clipped: 1, hidden: 0, stubborn: 0 })
  })

  it('夹完相对每个裁切祖先都不再越界（用的是与上游同一把尺子复核）', () => {
    const { graph, board } = sheet()
    const node = block(graph, board.id)
    expect(overflowsAncestor(graph, node, board)).toBe(true)
    preclipOverflowingRects(graph)
    expect(overflowsAncestor(graph, node, board)).toBe(false)
  })

  it('不越界的原样不动（一个字段都不碰）', () => {
    const { graph, board } = sheet()
    const node = block(graph, board.id, { x: 300, y: 200, width: 80, height: 80 })
    expect(preclipOverflowingRects(graph)).toEqual({ clipped: 0, hidden: 0, stubborn: 0 })
    expect(boxOf(node)).toEqual({ x: 300, y: 200, width: 80, height: 80 })
  })

  it('容差与上游一致：右边界恰 `w + 0.5` 不算越界', () => {
    const { graph, board } = sheet()
    const node = block(graph, board.id, { x: 340, y: 100, width: 60.5, height: 50 })
    expect(preclipOverflowingRects(graph)).toEqual({ clipped: 0, hidden: 0, stubborn: 0 })
    expect(node.width).toBe(60.5)
  })

  it('整块都在界外 ⇒ 藏起来（画布上它本来就是零可见像素）', () => {
    const { graph, board } = sheet()
    const node = block(graph, board.id, { x: 500, y: 400 })
    expect(preclipOverflowingRects(graph)).toEqual({ clipped: 0, hidden: 1, stubborn: 0 })
    expect(node.visible).toBe(false)
  })

  it('两层裁切祖先 ⇒ 夹到**边界交**：内层自己越出外层时，交比内层还小', () => {
    const { graph, board } = sheet()
    // 内层自己就伸出外层（右、下都越界），于是「交」= 外层 ∩ 内层 < 内层——
    // 只取最近一层（内层）会夹成 300 宽，取交才是 100 宽，这一条区分的就是它。
    const inner = graph.createNode('FRAME', board.id, {
      name: '内层',
      x: 300,
      y: 200,
      width: 300,
      height: 200,
      clipsContent: true,
      fills: solid(),
    })
    const node = graph.createNode('RECTANGLE', inner.id, {
      name: '横条',
      x: 0,
      y: 0,
      width: 400,
      height: 50,
      fills: solid(),
    })
    // 块被夹；内层容器自己越界、夹不动（容器不夹），如实记一笔。
    expect(preclipOverflowingRects(graph)).toEqual({ clipped: 1, hidden: 0, stubborn: 1 })
    // 外层 [0,400]×[0,300] ∩ 内层 [300,600]×[200,400] = [300,400]×[200,300]
    // 块世界 [300,700]×[200,250] ∩ 交 = [300,400]×[200,250] → 内层局部 (0,0,100,50)
    expect(boxOf(node)).toEqual({ x: 0, y: 0, width: 100, height: 50 })
    expect(overflowsAncestor(graph, node, inner)).toBe(false)
    expect(overflowsAncestor(graph, node, board)).toBe(false)
  })

  it('不解包：非裁切的容器（或页面）下，越界是**画布上看得见**的，不能夹', () => {
    const { graph, board } = sheet()
    graph.updateNode(board.id, { clipsContent: false })
    const node = block(graph, board.id)
    expect(preclipOverflowingRects(graph)).toEqual({ clipped: 0, hidden: 0, stubborn: 0 })
    expect(boxOf(node)).toEqual({ x: 340, y: 240, width: 120, height: 120 })
  })

  it('不可见的子孙不算越界（上游那句 `if (!child?.visible) continue` 连自己一起跳）', () => {
    const { graph, board } = sheet()
    const node = block(graph, board.id, { visible: false })
    expect(preclipOverflowingRects(graph)).toEqual({ clipped: 0, hidden: 0, stubborn: 0 })
    expect(boxOf(node)).toEqual({ x: 340, y: 240, width: 120, height: 120 })
  })

  it('祖先不可见 ⇒ 整棵不在上游的遍历里', () => {
    const { graph, board } = sheet()
    const inner = graph.createNode('FRAME', board.id, {
      name: '藏起来的容器',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      clipsContent: true,
      visible: false,
      fills: solid(),
    })
    const node = graph.createNode('RECTANGLE', inner.id, {
      name: '块',
      x: 40,
      y: 40,
      width: 200,
      height: 200,
      fills: solid(),
    })
    expect(preclipOverflowingRects(graph)).toEqual({ clipped: 0, hidden: 0, stubborn: 0 })
    expect(node.width).toBe(200)
  })
})

describe('夹不动的一律原样留着（`stubborn`）', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['圆角矩：弧在四角，夹小之后弧会挪位', { type: 'ROUNDED_RECTANGLE', cornerRadius: 24 }],
    ['椭圆：连平直段都没有', { type: 'ELLIPSE' }],
    ['文本：夹宽度会重排', { type: 'TEXT', text: '一段字' }],
    ['矢量：不归这条路管', { type: 'VECTOR' }],
    ['自己转过的：AABB 不再是它本身', { rotation: 15 }],
    ['带可见描边的：描边会跟着新边界走', { strokes: [{ visible: true, color: { r: 0, g: 0, b: 0, a: 1 }, weight: 2 }] }],
    ['带可见效果的：影子投在裁切边上的位置会变', { effects: [{ visible: true, type: 'DROP_SHADOW' }] }],
  ]

  it.each(cases)('%s', (_why, props) => {
    const { graph, board } = sheet()
    const type = (props.type as string | undefined) ?? 'RECTANGLE'
    const rest = { ...props }
    delete rest.type
    const node = graph.createNode(type as SceneNode['type'], board.id, {
      name: '越界的那个',
      x: 340,
      y: 240,
      width: 120,
      height: 120,
      fills: solid(),
      ...rest,
    })
    expect(preclipOverflowingRects(graph)).toEqual({ clipped: 0, hidden: 0, stubborn: 1 })
    expect(node.visible).toBe(true)
    expect(boxOf(node)).toEqual({ x: 340, y: 240, width: 120, height: 120 })
  })

  it('渐变的那个：换成真的渐变填充也照样不夹', () => {
    const { graph, board } = sheet()
    const node = block(graph, board.id, {
      fills: [{ type: 'GRADIENT_LINEAR', opacity: 1, visible: true }],
    })
    expect(preclipOverflowingRects(graph)).toEqual({ clipped: 0, hidden: 0, stubborn: 1 })
    expect(node.width).toBe(120)
  })

  it('祖先带旋转 ⇒ 局部空间那一套算不了，不动', () => {
    const { graph, board } = sheet()
    graph.updateNode(board.id, { rotation: 10 })
    const node = block(graph, board.id)
    expect(preclipOverflowingRects(graph)).toEqual({ clipped: 0, hidden: 0, stubborn: 1 })
    expect(node.width).toBe(120)
  })

  it('同一个容器里可夹的夹、夹不动的计数留下（这页因此仍会退图，如实记着）', () => {
    const { graph, board } = sheet()
    const leaf = block(graph, board.id)
    graph.createNode('ELLIPSE', board.id, {
      name: '圆',
      x: 380,
      y: 280,
      width: 100,
      height: 100,
      fills: solid(),
    })
    expect(preclipOverflowingRects(graph)).toEqual({ clipped: 1, hidden: 0, stubborn: 1 })
    expect(boxOf(leaf)).toEqual({ x: 340, y: 240, width: 60, height: 60 })
  })
})

describe('喂一份**解出来的**图（真机路径：文档 JSON → 场景图）', () => {
  it('`decodeDesignFile` 出来的图照样能夹', () => {
    const { graph, board } = sheet()
    const node = block(graph, board.id)
    const revived = decodeDesignFile(encodeDesignFile(graph))
    const revivedBoard = revived.getNode(board.id)
    const revivedNode = revived.getNode(node.id)
    if (revivedBoard === undefined || revivedNode === undefined) throw new Error('解出来的图里缺节点')
    expect(preclipOverflowingRects(revived)).toEqual({ clipped: 1, hidden: 0, stubborn: 0 })
    expect(boxOf(revivedNode)).toEqual({ x: 340, y: 240, width: 60, height: 60 })
    expect(overflowsAncestor(revived, revivedNode, revivedBoard)).toBe(false)
  })
})

describe('与上游对账：越界判定是复刻来的', () => {
  const upstream = read('../../../../node_modules/@open-pencil/core/dist/io/formats/pptx/export.js')

  it('容差就是 0.5px 那一档（`CLIP_EPSILON_PX = .5`）', () => {
    expect(upstream).toContain('const CLIP_EPSILON_PX = .5;')
  })

  it('越界的判法就是角点映进容器局部、比 `[-0.5, w+0.5]`', () => {
    expect(upstream).toContain('corners[i] < -.5 || corners[i] > node.width + CLIP_EPSILON_PX')
    expect(upstream).toContain('corners[i + 1] < -.5 || corners[i + 1] > node.height + CLIP_EPSILON_PX')
  })

  it('它的闸只在「开裁切 + 会裁的容器」上生效（我们夹的也正是这一档）', () => {
    expect(upstream).toContain('if (!node.clipsContent || !CONTAINER_TYPES.has(node.type)) return false;')
  })

  it('root 那条闸整页退图、节点那条退子树——正是我们要解掉的', () => {
    expect(upstream).toContain('if (clipsOverflowingContent(ctx.graph, root)) return "clipped content";')
    expect(upstream).toContain('if (clipsOverflowingContent(graph, node)) return "clipped content";')
  })
})

describe('接线：只有 PPT 那条路夹，且在交出去之前', () => {
  const io = read('../../../../src/client/artifact/viewers/design/design-io.ts')

  it('pptx 分支里调到它', () => {
    const branch = /default: \{[\s\S]*?return await perPage\(/.exec(io)?.[0] ?? ''
    expect(branch).toContain('preclipOverflowingRects(graph)')
  })

  it('在 `perPage`（真正导出那一步）**之前**', () => {
    const preclip = io.indexOf('preclipOverflowingRects(graph)')
    const perPage = io.indexOf('return await perPage(graph, containers, canvas)')
    expect(preclip).toBeGreaterThanOrEqual(0)
    expect(preclip).toBeLessThan(perPage)
  })

  it('只在 PPT 那条路：图片 / PDF / fig 三个分支不夹', () => {
    for (const call of ['figDocument(graph, canvas)', 'perContainer(graph, containers', 'pdfDocument(graph, containers)']) {
      const at = io.indexOf(call)
      expect(at).toBeGreaterThanOrEqual(0)
      expect(io.slice(Math.max(0, at - 400), at)).not.toContain('preclipOverflowingRects')
    }
  })
})
