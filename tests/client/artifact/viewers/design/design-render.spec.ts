/**
 * dsh-canvas — design painter（v2 底座）：用录音 ops 钉**结构性绘制契约**。
 *
 * 颜色、字形这些「画得对不对」交给真实 canvas 目测；这里钉的是容器语义的渲染面：
 * 容器默认裁切溢出内容（一页一容器），溢出的东西不露头；frame 按自己的 clipsContent
 * 裁（新建的 frame 默认 true，Figma 语义）；section（区域）不裁——容器可以溢出区域照常
 * 显示；叶子（RECTANGLE 等）自己也不产生裁切。
 *
 * `paintDocument` 第三枚参数是**页**（F2.8）：多页之后画布一次只画一页，而这一组判据
 * 只关心裁切，所以都传第一页。「画的确实是这一页」由 `pages.spec.ts` 那一组钉。
 */
import { describe, expect, it } from 'vitest'
import type { DesignPaintOps } from '../../../../../src/client/artifact/viewers/design/design-render.ts'
import { paintDocument } from '../../../../../src/client/artifact/viewers/design/design-render.ts'
import { scaffoldDesignDocument } from '../../../../../src/core/artifact/design/document.ts'
import { applyDesignOps } from '../../../../../src/core/artifact/design/ops.ts'

type Call = { op: 'clip' | 'endClip' | 'rect'; args?: number[] }

/** 录音 ops：只记 clip / rect 的调用序列，其余原语空转。 */
function recordingOps(): DesignPaintOps & { calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    opacity() {},
    rect(x: number, y: number, width: number, height: number) {
      calls.push({ op: 'rect', args: [x, y, width, height] })
    },
    ellipse() {},
    text() {},
    pushClip(x: number, y: number, width: number, height: number) {
      calls.push({ op: 'clip', args: [x, y, width, height] })
    },
    popClip() {
      calls.push({ op: 'endClip' })
    },
  }
}

/** 容器 1（1024×1024）→ 导航栏（1024×80）→ 一根横向溢出的横幅；容器级再放一个矩形。 */
function fixtureGraph() {
  const graph = scaffoldDesignDocument()
  const page = graph.getPages()[0]
  if (page === undefined) throw new Error('scaffold produced no page')
  const board = graph.getChildren(page.id).find((node) => node.type === 'FRAME')
  if (board === undefined) throw new Error('scaffold produced no container')
  // 导航栏与容器一样是 frame，但**没带 clipsContent**（老文档的形态）：不裁。
  const nav = graph.createNode('FRAME', board.id, { name: '导航栏', x: 0, y: 0, width: 1024, height: 80 })
  graph.createNode('RECTANGLE', nav.id, { name: '溢出的横幅', x: 900, y: 8, width: 400, height: 40 })
  graph.createNode('RECTANGLE', board.id, { name: '容器级元素', x: 40, y: 200, width: 100, height: 60 })
  return { board, graph, nav, pageId: page.id }
}

describe('design painter clipping', () => {
  it('the container clips its overflow; frames without clipsContent do not clip', () => {
    const { graph, nav, pageId } = fixtureGraph()
    const ops = recordingOps()

    paintDocument(graph, ops, { x: 0, y: 0, scale: 1 }, pageId)

    // 裁切严格配对且只有容器一对：导航栏这一枚 frame 没带 clipsContent，不产生自己的裁切
    expect(ops.calls.filter((call) => call.op === 'clip')).toHaveLength(1)
    expect(ops.calls.filter((call) => call.op === 'endClip')).toHaveLength(1)

    // 容器的裁切范围就是容器本身的屏幕矩形（父相对坐标 × scale）
    const boardIndex = ops.calls.findIndex((call) => call.op === 'clip')
    expect(ops.calls[boardIndex]?.args).toEqual([0, 0, 1024, 1024])

    // 溢出导航栏的横幅画在容器 clip 与其 endClip 之间——不出容器就照常显示
    const boardEnd = ops.calls.findIndex((call, index) => index > boardIndex && call.op === 'endClip')
    const bannerIndex = ops.calls.findIndex((call) => call.op === 'rect' && call.args?.[0] === 900)
    expect(bannerIndex).toBeGreaterThan(boardIndex)
    expect(bannerIndex).toBeLessThan(boardEnd)
    // 溢出横幅的矩形原样入画（没有被导航栏的裁切改形——它本来就不裁）
    expect(ops.calls[bannerIndex]?.args).toEqual([900, 8, 400, 40])
    expect(nav.width).toBe(1024)
  })

  it('a rectangle paints but never clips anything itself', () => {
    const { graph, pageId } = fixtureGraph()
    const ops = recordingOps()

    paintDocument(graph, ops, { x: 0, y: 0, scale: 1 }, pageId)

    // 只有容器产生裁切；容器级矩形是叶子，不产生自己的裁切
    expect(ops.calls.filter((call) => call.op === 'clip')).toHaveLength(1)
    expect(ops.calls.some((call) => call.op === 'rect' && call.args?.[0] === 40)).toBe(true)
  })

  it('an op-minted frame clips (clipsContent defaults on); a section never clips', () => {
    const graph = scaffoldDesignDocument()
    const page = graph.getPages()[0]
    if (page === undefined) throw new Error('scaffold produced no page')
    const board = graph.getChildren(page.id).find((node) => node.type === 'FRAME')
    if (board === undefined) throw new Error('scaffold produced no container')

    const result = applyDesignOps(graph, [
      { kind: 'upsert', type: 'frame', parentId: board.id, name: '弹层' },
      // 区域归页面管：塞进容器会被拒（Figma 层级），所以它挂在页面上。
      { kind: 'upsert', type: 'section', parentId: board.id, name: '内容区' },
      { kind: 'upsert', type: 'section', parentId: page.id, name: '区域' },
    ])
    expect(result.errors).toHaveLength(1)
    const minted = new Map(graph.getChildren(board.id).map((node) => [node.name, node]))
    // frame 默认裁切（Figma 语义）；section 是自由层，不裁
    expect(minted.get('弹层')?.clipsContent).toBe(true)
    const region = graph.getChildren(page.id).find((node) => node.type === 'SECTION')
    expect(region?.clipsContent).toBe(false)

    const ops = recordingOps()
    paintDocument(graph, ops, { x: 0, y: 0, scale: 1 }, page.id)
    // 容器 + 弹层各一对；section 不产生裁切
    expect(ops.calls.filter((call) => call.op === 'clip')).toHaveLength(2)
  })
})
