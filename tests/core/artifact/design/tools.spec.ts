/**
 * 绘图工具（v1.99 工具 dock 的引擎半）。
 *
 * 钉四件事：**落形**（拖画笔 → 节点，带 undo；非落形笔诚实拒单）、**文本落字**
 * （占位内容跟节点一起落）、**钢笔账本**（点针、收笔落矢量、弃笔清账）、
 * **换笔的收尾**（离开钢笔不留在途的预览线）。
 */
import { describe, expect, it } from 'vitest'
import { encodeDesignFile, scaffoldDesignDocument } from '../../../../src/core/artifact/design/document.ts'

async function boot() {
  const { createDesignEngine } = await import('../../../../src/client/artifact/viewers/design/design-engine.ts')
  const outcome = await createDesignEngine({
    twoD: {} as never,
    gl: {} as never,
    runtime: null,
    envelope: encodeDesignFile(scaffoldDesignDocument()),
    onRepaint: () => {},
  })
  if (outcome.kind !== 'ready') throw new Error(`engine did not come up: ${outcome.message}`)
  return outcome.engine
}

describe('shape tools', () => {
  it('creates a rectangle from a drag rect (and undo removes it)', async () => {
    const engine = await boot()
    const pageId = engine.snapshot().currentPageId
    const id = engine.createShape('rectangle', { x: 10, y: 20, width: 120, height: 80 })
    expect(id).not.toBeNull()
    const read = engine.nodeProps(id as string)
    expect(read).toMatchObject({ type: 'rectangle', x: 10, y: 20, width: 120, height: 80 })
    // 落形进 undo：退一步，节点没了（选中归 viewer，引擎不代劳）。
    engine.undo()
    const layers = engine.snapshot().layers.flatMap((node) => [node.id, ...node.children.map((child) => child.id)])
    expect(layers).not.toContain(id)
    expect(engine.snapshot().currentPageId).toBe(pageId)
    engine.dispose()
  })

  it('normalizes non-positive sizes honestly (line keeps height 0, others clamp to 1)', async () => {
    const engine = await boot()
    const line = engine.createShape('line', { x: 0, y: 0, width: 100, height: 0 })
    expect(engine.nodeProps(line as string)).toMatchObject({ width: 100, height: 0 })
    const rect = engine.createShape('rectangle', { x: 0, y: 0, width: 0, height: 0 })
    expect(engine.nodeProps(rect as string)).toMatchObject({ width: 1, height: 1 })
    engine.dispose()
  })

  it('refuses non-drawing tools (move is not a pen)', async () => {
    const engine = await boot()
    expect(engine.createShape('move', { x: 0, y: 0, width: 10, height: 10 })).toBeNull()
    expect(engine.createShape('pen', { x: 0, y: 0, width: 10, height: 10 })).toBeNull()
    engine.dispose()
  })

  it('creates section via the section pen', async () => {
    const engine = await boot()
    const id = engine.createShape('section', { x: 0, y: 0, width: 300, height: 200 })
    expect(engine.nodeProps(id as string)).toMatchObject({ type: 'section' })
    engine.dispose()
  })
})

describe('text tool', () => {
  it('drops a text node with placeholder content; one undo removes the whole thing', async () => {
    const engine = await boot()
    const id = engine.createTextAt(5, 6)
    expect(engine.nodeProps(id)).toMatchObject({ type: 'text', x: 5, y: 6, text: '文本' })
    // 占位内容写在创建快照里（同一条 undo 条目）：一步退干净，redo 也把文本带回来。
    engine.undo()
    expect(engine.nodeProps(id)).toBeNull()
    engine.redo()
    expect(engine.nodeProps(id)).toMatchObject({ text: '文本' })
    engine.dispose()
  })
})

describe('pen tool', () => {
  it('accumulates vertices, commits to a vector node, and resets to move', async () => {
    const engine = await boot()
    engine.setTool('pen')
    expect(engine.tool()).toBe('pen')
    expect(engine.penDown(0, 0)).toBe('vertex')
    expect(engine.penDown(100, 0)).toBe('vertex')
    // 收笔：账本里有两条顶点 → 落成矢量节点，笔交回移动。
    engine.penFinish()
    expect(engine.tool()).toBe('move')
    const layers = engine.snapshot().layers
    const vector = layers.find((node) => node.type === 'vector')
    expect(vector).toBeDefined()
    // 矢量节点的顶点是世界坐标归一化后的：宽 100 那条线是真的。
    const read = engine.nodeProps(vector?.id as string)
    expect(read).toMatchObject({ width: 100 })
    engine.dispose()
  })

  it('abort discards the ledger without dropping a node', async () => {
    const engine = await boot()
    engine.setTool('pen')
    engine.penDown(0, 0)
    engine.penDown(50, 50)
    engine.penAbort()
    expect(engine.tool()).toBe('move')
    expect(engine.snapshot().layers.every((node) => node.type !== 'vector')).toBe(true)
    engine.dispose()
  })

  it('leaving the pen via setTool cancels the in-flight ledger', async () => {
    const engine = await boot()
    engine.setTool('pen')
    engine.penDown(0, 0)
    engine.setTool('rectangle')
    // 没收笔就换笔：账本清空、不落节点（孤儿预览线不许留）。
    expect(engine.snapshot().layers.every((node) => node.type !== 'vector')).toBe(true)
    const id = engine.createShape('rectangle', { x: 0, y: 0, width: 10, height: 10 })
    expect(id).not.toBeNull()
    engine.dispose()
  })
})

describe('marquee pick (pickRect)', () => {
  it('returns top-level nodes whose box intersects the rect; skips hidden and locked', async () => {
    const engine = await boot()
    const a = engine.createShape('rectangle', { x: 0, y: 0, width: 50, height: 50 })
    const b = engine.createShape('rectangle', { x: 100, y: 100, width: 50, height: 50 })
    const hidden = engine.createShape('rectangle', { x: 200, y: 0, width: 50, height: 50 })
    const locked = engine.createShape('rectangle', { x: 300, y: 0, width: 50, height: 50 })
    expect([a, b, hidden, locked].every((id) => id !== null)).toBe(true)
    // 藏起来 / 锁上：都不是框选的对象（直接改节点属性，判据只认引擎语义）。
    engine.updateProps(hidden as string, { visible: false })
    engine.updateProps(locked as string, { locked: true })
    // 交到两个的框：a 全含、b 相交；藏/锁的两枚不出场。
    const hits = engine.pickRect({ x: 40, y: 40, width: 120, height: 120 })
    expect(hits).toEqual(expect.arrayContaining([a, b]))
    expect(hits).not.toContain(hidden)
    expect(hits).not.toContain(locked)
    // 交到谁的框都不碰：脚手架自带的底盘容器可能大到哪儿都交得到，判据只钉
    // 「我建的四枚一个都不来」。
    const far = engine.pickRect({ x: 1000, y: 1000, width: 10, height: 10 })
    for (const id of [a, b, hidden, locked]) expect(far).not.toContain(id)
    engine.dispose()
  })
})

describe('live-node shape flow (begin/update/end)', () => {
  it('keeps the live node honest through the drag and undoes the FINAL geometry, not a 1×1 stub', async () => {
    const engine = await boot()
    // 起手：真节点已经在图里（预览就是它），1×1 兜底。
    const id = engine.beginShape('polygon', { x: 10, y: 10 })
    expect(id).not.toBeNull()
    expect(engine.nodeProps(id as string)).toMatchObject({ type: 'polygon', x: 10, y: 10 })
    // 拖动中：几何每帧直写。
    engine.updateShapeRect(id as string, { x: 10, y: 10, width: 120, height: 90 })
    expect(engine.nodeProps(id as string)).toMatchObject({ width: 120, height: 90, pointCount: 3 })
    // 收手：一条 undo 提交 + 选中。
    expect(engine.endShape()).toBe(id)
    expect(engine.selection()).toEqual([id])
    // undo 退干净；redo 回来的是**最终几何**——不是起手那枚 1×1 小块。
    engine.undo()
    expect(engine.nodeProps(id as string)).toBeNull()
    engine.redo()
    expect(engine.nodeProps(id as string)).toMatchObject({ x: 10, y: 10, width: 120, height: 90 })
    // 再起一笔没收手就又起（异常序）：引擎自己把上一笔结掉，不留无账孤儿。
    const orphan = engine.beginShape('rectangle', { x: 0, y: 0 })
    expect(orphan).not.toBeNull()
    expect(engine.endShape()).toBe(orphan)
    engine.dispose()
  })
})
