/**
 * OpenPencil 底座冒烟（P0）：改道判据的三根钉子。
 *
 * 设计节点底座从自研 Kiwi schema 换成 `@open-pencil/scene-graph`（方案 A，格式
 * 破坏性切 v2）。这一步赌的是三件事，全部钉死在这一个文件里：
 *
 * - **node 环境 import 不炸**：scene-graph 是纯数据层（无 UI、无 DOM），esbuild
 *   与 vitest 都要能吃下它——这是后续所有 P 阶段的前提。
 * - **场景图是 plain 数据**：`SceneNode` 无方法、可 structuredClone（上游
 *   checkpoint.ts 自己就这么用），所以 `.design` v2 的 payload 可以是场景图的
 *   JSON 快照——文本信封（header + JSON）直接成立，不需要二进制。
 * - **快照 round-trip 保真**：存出去再读回来，图层树与属性一字不差——这是
 *   `readDesign` / `editDesign` 与 M2 编辑闭环的数据面地基。
 */
import { describe, expect, it } from 'vitest'
import { SceneGraph } from '@open-pencil/scene-graph'

/** One JSON snapshot of a graph — the format v2 payload shape under test. */
interface GraphSnapshot {
  rootId: string
  nodes: unknown[]
}

const snapshotOf = (graph: SceneGraph): GraphSnapshot => ({
  rootId: graph.rootId,
  nodes: [...graph.nodes.values()],
})

const hydrate = (snapshot: GraphSnapshot): SceneGraph => {
  const graph = new SceneGraph()
  graph.nodes.clear()
  graph.rootId = snapshot.rootId
  for (const node of snapshot.nodes) {
    graph.nodes.set((node as { id: string }).id, node as never)
  }
  return graph
}

describe('open-pencil scene-graph baseline', () => {
  it('imports in node, creates a page and a frame, and mutates it', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    expect(page?.type).toBe('CANVAS')

    const board = graph.createNode('FRAME', page.id, { name: '容器 1', x: 0, y: 0, width: 1024, height: 1024 })
    expect(graph.getNode(board.id)?.width).toBe(1024)
    expect(graph.getChildren(page.id).map((n) => n.id)).toContain(board.id)

    board.cornerRadius = 12
    expect(graph.getNode(board.id)?.cornerRadius).toBe(12)
  })

  it('round-trips a JSON snapshot with the tree and props intact', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const board = graph.createNode('FRAME', page.id, { name: '容器 1', width: 1024, height: 1024 })
    graph.createNode('RECTANGLE', board.id, { name: '卡片', x: 40, y: 60, width: 320, height: 200 })
    graph.createNode('TEXT', board.id, { name: '标题', x: 40, y: 280, width: 320, height: 48, text: '设计' })

    const restored = hydrate(JSON.parse(JSON.stringify(snapshotOf(graph))) as GraphSnapshot)
    const restoredPage = restored.getPages()[0]
    const restoredBoard = restored.getChildren(restoredPage.id)[0]
    expect(restoredBoard?.name).toBe('容器 1')
    expect(restoredBoard?.width).toBe(1024)
    expect(restored.getChildren(restoredBoard.id).map((n) => n.name)).toEqual(['卡片', '标题'])
    const title = restored.getChildren(restoredBoard.id)[1]
    expect(title?.text).toBe('设计')
  })
})
