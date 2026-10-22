/**
 * 「夹不动的越界子孙就地烘成图片」的判据（F10.1，v1.68）。
 *
 * 这一组对应真机那句话：「导出 PPT，文字丢失，每一页应该由可编辑元素组成，不是一整张图片」。
 * v1.66 只夹得动**直角矩形叶子**，而真机上让整页退图的往往是**圆角矩**（AI 画稿的卡片几乎都
 * 是它）、椭圆、文本——上游那条 root 闸是**整页**生效的，一个夹不动的越界子孙就够让这一页的
 * 可编辑性全丢。这一组钉住的就是接手它们的那一步（`core/artifact/design/pptx-raster.ts`）。
 *
 * 三件事分开点：
 *
 * 1. **烘出来的框对不对**（`节点 ∩ 裁切祖先交`，不是整个容器）——这一条最初真写错过，第一版
 *    拿整个祖先交当裁切框，图片会带上与本节点无关的一大片区域、还平白多烘十几倍的像素；
 * 2. **换得干不干净**（原节点没了、图片在原来的 z 位、字节进了 `graph.images`）；
 * 3. **不碰的那几条**（遮罩、转过的、画不出来的）——那是「不改 = 老样子，改错 = 画坏」那条线。
 *
 * 最后拿**上游自己会看的那件事**收口：夹完 + 烘完，这一页不再有「越界于裁切祖先的可见节点」，
 * 也就是上游 `clipsOverflowingContent(root)` 不再为真、整页退图解开。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { decodeDesignFile, encodeDesignFile } from '../../../../src/core/artifact/design/document.ts'
import {
  overflowsAncestor,
  preclipOverflowingRects,
  stubbornOverflows,
} from '../../../../src/core/artifact/design/pptx-preclip.ts'
import { rasterizeStubbornOverflows } from '../../../../src/core/artifact/design/pptx-raster.ts'

/** 读源码文本（跨文件接线对账用）。 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

const solid = (r = 0.2, g = 0.3, b = 0.8) => [
  { type: 'SOLID' as const, color: { r, g, b, a: 1 }, opacity: 1, visible: true },
]

/** 一张真的 1×1 PNG——喂给 `draw` 的字节不必被解开，但也不该是随手编的几个数。 */
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

/** 一页 + 一个 400×300、开裁切的容器。 */
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

/** 默认那个顽固的：圆角矩，右、下各越出容器 100。 */
function card(graph: SceneGraph, parentId: string, props: Record<string, unknown> = {}): SceneNode {
  return graph.createNode('ROUNDED_RECTANGLE', parentId, {
    name: '卡片',
    x: 300,
    y: 200,
    width: 200,
    height: 200,
    cornerRadius: 24,
    fills: solid(),
    ...props,
  })
}

/** 一段请求记录：渲染器收到的是**哪个框**（判「烘的是哪一块」用）。 */
interface Ask {
  x: number
  y: number
  width: number
  height: number
  scale: number
}

/** 假的渲染器：记下每次收到的框，给回一份字节。 */
function recorder(graph: SceneGraph, bytes: Uint8Array = PNG) {
  const asks: Ask[] = []
  return {
    asks,
    draw: async (nodeId: string, scale: number): Promise<Uint8Array | null> => {
      const node = graph.getNode(nodeId)
      if (node === undefined) throw new Error(`渲染器收到一个不存在的节点：${nodeId}`)
      asks.push({ x: node.x, y: node.y, width: node.width, height: node.height, scale })
      return bytes
    },
  }
}

/** 换完之后的那个图片节点（名字沿用原来的）。 */
const replaced = (graph: SceneGraph, parentId: string, name = '卡片'): SceneNode | undefined =>
  graph.getChildren(parentId).find((node) => node.name === name)

/** 某个节点下面的所有子孙。 */
function descendants(graph: SceneGraph, id: string): SceneNode[] {
  return graph.getChildren(id).flatMap((child) => [child, ...descendants(graph, child.id)])
}

const boxOf = (node: SceneNode) => ({
  x: node.x,
  y: node.y,
  width: node.width,
  height: node.height,
})

describe('烘：夹不动的越界子孙换成一张裁切过的图片', () => {
  it('圆角矩越界 ⇒ 原节点没了，原位出现一个图片矩形，尺寸就是**可见那块**', async () => {
    const { graph, board } = sheet()
    const node = card(graph, board.id)
    const { draw } = recorder(graph)

    const outcome = await rasterizeStubbornOverflows(graph, draw, 2)

    // 可见那块 = [300,400] × [200,300]（容器右下角那一百见方）。
    const image = replaced(graph, board.id)
    expect(image).toBeDefined()
    expect(image?.type).toBe('RECTANGLE')
    expect(boxOf(image as SceneNode)).toEqual({ x: 300, y: 200, width: 100, height: 100 })
    expect(image?.fills.some((fill) => fill.type === 'IMAGE' && fill.visible)).toBe(true)
    // 原节点（连同它的子树）已经不在这份图里了。
    expect(graph.getNode(node.id)).toBeUndefined()
    expect(outcome).toEqual({ rasterized: 1, hidden: 0, kept: 0 })
  })

  it('烘的范围是「**节点 ∩ 裁切祖先交**」，不是整个容器', async () => {
    const { graph, board } = sheet()
    card(graph, board.id)
    const { draw, asks } = recorder(graph)

    await rasterizeStubbornOverflows(graph, draw, 2)

    expect(asks).toHaveLength(1)
    // 整个祖先交是 400×300；节点 ∩ 交才是 100×100。写错成前者，图片里会带上一大片
    // 与本节点无关的透明区，还平白多烘十几倍的像素——这一条钉的就是它。
    expect(asks[0]).toMatchObject({ x: 300, y: 200, width: 100, height: 100, scale: 2 })
  })

  it('两层裁切祖先 ⇒ 裁切框取**边界交**', async () => {
    const { graph, board } = sheet()
    // 内层自己完全落在外层里（不然它也会是顽固的一员，把这一条的意图搅浑）。
    const inner = graph.createNode('FRAME', board.id, {
      name: '内层',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      clipsContent: true,
      fills: solid(),
    })
    card(graph, inner.id, { x: 150, y: 150, width: 200, height: 200 })
    const { draw, asks } = recorder(graph)

    await rasterizeStubbornOverflows(graph, draw, 2)

    // 卡片世界 [250,450]×[250,450] ∩ (容器[0,400]×[0,300] ∩ 内层[100,300]×[100,300])
    //      = [250,300] × [250,300] → 内层局部 (150,150,50,50)
    expect(asks[0]).toMatchObject({ x: 150, y: 150, width: 50, height: 50 })
  })

  it('整块都在界外 ⇒ 藏起来（画布上它本来就是零可见像素）', async () => {
    const { graph, board } = sheet()
    const node = card(graph, board.id, { x: 500, y: 400 })
    const { draw, asks } = recorder(graph)

    const outcome = await rasterizeStubbornOverflows(graph, draw, 2)

    expect(node.visible).toBe(false)
    expect(outcome).toEqual({ rasterized: 0, hidden: 1, kept: 0 })
    expect(asks).toHaveLength(0)
  })

  it('字节进 `graph.images`，填充的 hash 与它逐字对上', async () => {
    const { graph, board } = sheet()
    card(graph, board.id)
    const { draw } = recorder(graph)

    await rasterizeStubbornOverflows(graph, draw, 2)

    const fill = replaced(graph, board.id)?.fills.find((item) => item.type === 'IMAGE')
    const hash = fill?.imageHash ?? ''
    expect(hash).not.toBe('')
    expect(graph.images.get(hash)).toBe(PNG)
  })

  it('z 序不变：原来在第几层，图片还在第几层', async () => {
    const { graph, board } = sheet()
    graph.createNode('RECTANGLE', board.id, {
      name: '底下那块',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fills: solid(),
    })
    card(graph, board.id)
    graph.createNode('TEXT', board.id, {
      name: '顶上一行字',
      x: 10,
      y: 10,
      width: 100,
      height: 30,
      text: '字',
      fills: solid(),
    })
    const order = () => graph.getChildren(board.id).map((node) => node.name)
    expect(order()).toEqual(['底下那块', '卡片', '顶上一行字'])

    const { draw } = recorder(graph)
    await rasterizeStubbornOverflows(graph, draw, 2)

    expect(order()).toEqual(['底下那块', '卡片', '顶上一行字'])
  })
})

describe('不碰的那几条（不改 = 老样子，改错 = 画坏）', () => {
  it('画不出来（渲染器给 null）⇒ **原样回滚**：坐标、父、z 序、图片表一个都不许动', async () => {
    const { graph, board } = sheet()
    card(graph, board.id)
    const before = graph.getChildren(board.id).map((node) => node.id)

    const outcome = await rasterizeStubbornOverflows(graph, async () => null, 2)

    expect(outcome).toEqual({ rasterized: 0, hidden: 0, kept: 1 })
    expect(graph.getChildren(board.id).map((node) => node.id)).toEqual(before)
    const node = replaced(graph, board.id) as SceneNode
    expect(boxOf(node)).toEqual({ x: 300, y: 200, width: 200, height: 200 })
    expect(node.parentId).toBe(board.id)
    expect(graph.images.size).toBe(0)
  })

  it('空字节也算画不出来（不许拿一张空图顶掉人家的东西）', async () => {
    const { graph, board } = sheet()
    card(graph, board.id)
    const { draw } = recorder(graph, new Uint8Array(0))
    const outcome = await rasterizeStubbornOverflows(graph, draw, 2)
    expect(outcome).toEqual({ rasterized: 0, hidden: 0, kept: 1 })
    expect(graph.images.size).toBe(0)
  })

  it('遮罩不碰：它靠「和兄弟的关系」生效，单独烘成一张图会让兄弟不再被它裁', async () => {
    const { graph, board } = sheet()
    graph.createNode('ROUNDED_RECTANGLE', board.id, {
      name: '遮罩',
      x: 300,
      y: 200,
      width: 200,
      height: 200,
      isMask: true,
      fills: solid(),
    })
    const { draw, asks } = recorder(graph)

    const outcome = await rasterizeStubbornOverflows(graph, draw, 2)

    expect(outcome).toEqual({ rasterized: 0, hidden: 0, kept: 1 })
    expect(asks).toHaveLength(0)
    expect([...graph.getAllNodes()].some((node) => node.name === '遮罩')).toBe(true)
  })

  it('自己被转过 ⇒ 不碰：改 `x`/`y` 动的就不是左上角，那个减法不成立', async () => {
    const { graph, board } = sheet()
    graph.updateNode(board.id, { rotation: 10 })
    card(graph, board.id)
    const { draw, asks } = recorder(graph)

    const outcome = await rasterizeStubbornOverflows(graph, draw, 2)

    expect(outcome).toEqual({ rasterized: 0, hidden: 0, kept: 1 })
    expect(asks).toHaveLength(0)
  })

  it('中间那一级转过 ⇒ 也不碰（按父坐标写回 x/y 同样不成立）', async () => {
    const { graph, board } = sheet()
    const inner = graph.createNode('FRAME', board.id, {
      name: '转过的内层',
      x: 150,
      y: 150,
      width: 100,
      height: 100,
      rotation: 8,
      clipsContent: true,
      fills: solid(),
    })
    card(graph, inner.id)
    const { draw, asks } = recorder(graph)

    const outcome = await rasterizeStubbornOverflows(graph, draw, 2)

    expect(outcome).toEqual({ rasterized: 0, hidden: 0, kept: 1 })
    expect(asks).toHaveLength(0)
  })

  it('本来就不越界的：名单里根本没有它', async () => {
    const { graph, board } = sheet()
    card(graph, board.id, { x: 100, y: 60, width: 120, height: 100 })
    const { draw } = recorder(graph)
    const outcome = await rasterizeStubbornOverflows(graph, draw, 2)
    expect(outcome).toEqual({ rasterized: 0, hidden: 0, kept: 0 })
  })

  it('夹得动的（直角矩形叶子）留在夹那一步，这里不碰', async () => {
    const { graph, board } = sheet()
    graph.createNode('RECTANGLE', board.id, {
      name: '直角',
      x: 340,
      y: 240,
      width: 120,
      height: 120,
      fills: solid(),
    })
    const { draw } = recorder(graph)
    const outcome = await rasterizeStubbornOverflows(graph, draw, 2)
    expect(outcome).toEqual({ rasterized: 0, hidden: 0, kept: 0 })
  })
})

describe('收口：夹 + 烘之后，上游那条「整页退图」的闸解开', () => {
  it('夹不动的都烘掉了、夹得动的都夹过了 ⇒ 名单空、这一页不再有越界子孙', async () => {
    const { graph, board } = sheet()
    card(graph, board.id)
    graph.createNode('ELLIPSE', board.id, {
      name: '圆',
      x: 360,
      y: 260,
      width: 100,
      height: 100,
      fills: solid(),
    })
    graph.createNode('RECTANGLE', board.id, {
      name: '直角装饰',
      x: 340,
      y: 240,
      width: 120,
      height: 120,
      fills: solid(),
    })
    const { draw } = recorder(graph)

    // 与真机同一条顺序：先夹，再烘。
    preclipOverflowingRects(graph)
    await rasterizeStubbornOverflows(graph, draw, 2)

    expect(stubbornOverflows(graph)).toEqual([])
    expect(overflowsAncestor(graph, board, board)).toBe(false)
    for (const child of descendants(graph, board.id)) {
      if (!child.visible) continue
      expect(overflowsAncestor(graph, child, board)).toBe(false)
    }
  })

  it('喂一份解出来的图也照收口（真机路径：文档 JSON → 场景图）', async () => {
    const { graph, board } = sheet()
    card(graph, board.id)
    const revived = decodeDesignFile(encodeDesignFile(graph))
    const { draw, asks } = recorder(revived)

    const outcome = await rasterizeStubbornOverflows(revived, draw, 2)

    expect(outcome).toEqual({ rasterized: 1, hidden: 0, kept: 0 })
    expect(asks[0]).toMatchObject({ x: 300, y: 200, width: 100, height: 100 })
    const image = revived.getChildren(board.id).find((item) => item.name === '卡片')
    expect(boxOf(image as SceneNode)).toEqual({ x: 300, y: 200, width: 100, height: 100 })
  })
})

describe('接线：只有 PPT 那条路烘，且在交出去之前', () => {
  const io = read('../../../../src/client/artifact/viewers/design/design-io.ts')

  it('pptx 分支里调到它', () => {
    const branch = /default: \{[\s\S]*?return await perPage\(/.exec(io)?.[0] ?? ''
    expect(branch).toContain('rasterizeStubbornOverflows(')
  })

  it('夹在前、烘在后、都在 `perPage`（真正导出那一步）之前', () => {
    const preclip = io.indexOf('preclipOverflowingRects(graph)')
    const bake = io.indexOf('rasterizeStubbornOverflows(')
    const perPage = io.indexOf('return await perPage(graph, containers, canvas)')
    expect(preclip).toBeGreaterThanOrEqual(0)
    expect(preclip).toBeLessThan(bake)
    expect(bake).toBeLessThan(perPage)
  })

  it('烘出来的图走引擎自己的图片导出那一条（不是另起一份渲染）', () => {
    const bake = io.indexOf('rasterizeStubbornOverflows(')
    expect(io.slice(bake, bake + 260)).toContain("draw(graph, 'png', nodeTarget(nodeId)")
  })

  it('只在 PPT 那条路：图片 / PDF / fig 三个分支不烘', () => {
    for (const call of [
      'figDocument(graph, canvas)',
      'perContainer(graph, containers',
      'pdfDocument(graph, containers)',
    ]) {
      const at = io.indexOf(call)
      expect(at).toBeGreaterThanOrEqual(0)
      expect(io.slice(Math.max(0, at - 500), at)).not.toContain('rasterizeStubbornOverflows')
    }
  })
})
