/**
 * 页面（F2.8）的判据。
 *
 * 这一组**不读源码文本**：`pages.ts` 是纯的（只认一张 `SceneGraph`），所以判据拿一张**真图**
 * 跑——复制的机制（子树照搬、新 id、插在源页后面）全都能验，不是「代码里出现了 cloneTree」
 * 这种形似。多页之后第一件会静默出错的事是**范围**：两页的内容常常坐标完全相同（复制出来
 * 的页就是照搬的），画哪一页、命中哪一页、贴合按哪一页算，一处没圈住就是「看到了别页的东西」
 * 而界面上一片正常。所以范围那几条也在这里钉（`containersIn` 与渲染侧那两个入口）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SceneGraph } from '@open-pencil/scene-graph'
import {
  containersIn,
  containersOf,
  decodeDesignFile,
  encodeDesignFile,
  firstPageId,
  scaffoldDesignDocument,
} from '../../../../src/core/artifact/design/document.ts'
import {
  canRemovePage,
  copyPageName,
  duplicatePageIn,
  newPageName,
  pageLabel,
} from '../../../../src/core/artifact/design/pages.ts'
import {
  type DesignPaintOps,
  documentBounds,
  fitTransform,
  paintDocument,
} from '../../../../src/client/artifact/viewers/design/design-render.ts'

/** 取一个必然存在的节点——判据里建的东西，取不到就是这一条自己写错了。 */
function need<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('判据里少了一个节点')
  return value
}

/** 读一份源码文本（接线那几条读不了模块，只能读字）。 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** 一张图上的所有页面 id，按 `getPages()` 的顺序。 */
const pageIds = (graph: SceneGraph): string[] => graph.getPages().map((page) => page.id)

/** 一页里顶层子节点的名字，z 序——对比「照搬了没有、顺序对不对」用这个。 */
const childNames = (graph: SceneGraph, pageId: string): (string | undefined)[] =>
  graph.getChildren(pageId).map((node) => node.name)

/** 一页子树的全部节点 id（含孙辈）——用来验「复制的是新节点」。 */
function subtreeIds(graph: SceneGraph, pageId: string): string[] {
  const ids: string[] = []
  const walk = (id: string): void => {
    for (const child of graph.getChildren(id)) {
      ids.push(child.id)
      walk(child.id)
    }
  }
  walk(pageId)
  return ids
}

/** 往一页里种一份有深度的内容：容器 → 色块 + 组 → 组里的文字。 */
function seedPage(graph: SceneGraph, pageId: string, label: string): void {
  const board = graph.createNode('FRAME', pageId, { name: `容器 ${label}`, x: 8, y: 12, width: 300, height: 200 })
  graph.createNode('RECTANGLE', board.id, { name: `色块 ${label}`, x: 10, y: 20, width: 80, height: 40 })
  const group = graph.createNode('GROUP', board.id, { name: `组 ${label}` })
  graph.createNode('TEXT', group.id, { name: `文字 ${label}`, text: '深一层' })
}

/** 再加一页：取名走 `newPageName`，与面板那一条路同一个口径。 */
function addPage(graph: SceneGraph): string {
  return graph.addPage(newPageName(graph.getPages().map((page) => page.name))).id
}

/** 复制一页并拿到新页 id——判据里传的都是真页，复制不成就是这一条自己写错了。 */
function copyOf(graph: SceneGraph, pageId: string): string {
  const id = duplicatePageIn(graph, pageId)
  if (id === null) throw new Error('复制没有成')
  return id
}

describe('页面命名', () => {
  it('新建取第一个空位，不撞已有名', () => {
    expect(newPageName([])).toBe('页面 1')
    expect(newPageName(['页面 1'])).toBe('页面 2')
    // 改过名的页不占号：3 是被改掉的那个「页面 2」腾出来的。
    expect(newPageName(['页面 1', '页面 3'])).toBe('页面 2')
    expect(newPageName(['页面 1', '页面 2', '页面 3'])).toBe('页面 4')
  })

  it('复制的名字是「X 副本」，撞了添序号', () => {
    expect(copyPageName('页面 1', ['页面 1'])).toBe('页面 1 副本')
    expect(copyPageName('页面 1', ['页面 1', '页面 1 副本'])).toBe('页面 1 副本 2')
    expect(copyPageName('页面 1', ['页面 1', '页面 1 副本', '页面 1 副本 2'])).toBe('页面 1 副本 3')
    // 复制已改名的页，用的是它现在的名字。
    expect(copyPageName('首页', ['首页'])).toBe('首页 副本')
  })

  it('空名有一行字可显示（老文档才可能有），副本名也不会变成「 副本」', () => {
    expect(pageLabel('')).toBe('未命名页面')
    expect(pageLabel('页面 1')).toBe('页面 1')
    expect(copyPageName('', [''])).toBe('未命名页面 副本')
  })
})

describe('页面的可删性', () => {
  it('只剩一页时不给删：一份文档至少留一页', () => {
    expect(canRemovePage(1)).toBe(false)
    expect(canRemovePage(2)).toBe(true)
    expect(canRemovePage(9)).toBe(true)
  })
})

describe('复制页面', () => {
  it('照搬整棵子树到新页，源页一个字节不动', () => {
    const graph = scaffoldDesignDocument()
    const page = need(pageIds(graph)[0])
    seedPage(graph, page, '甲')
    const before = subtreeIds(graph, page)
    const sourceChildren = graph.getChildren(page)
    const sourceBoard = need(sourceChildren.find((node) => node.name === '容器 甲'))

    const copyId = copyOf(graph, page)

    // 源页原封不动：id 一个不差，容器的爹还是它。
    expect(subtreeIds(graph, page)).toEqual(before)
    expect(graph.getChildren(page).map((node) => node.id)).toEqual(sourceChildren.map((node) => node.id))
    expect(need(graph.getNode(sourceBoard.id)).parentId).toBe(page)
    // 副本是**新**节点：id 全新（拿旧 id 当新页的子节点 = 一个节点两个爹）。
    const copied = subtreeIds(graph, copyId)
    expect(copied).toHaveLength(before.length)
    expect(copied.filter((id) => before.includes(id))).toEqual([])
    // 结构、z 序、名字照搬（scaffold 自带那个容器也一起搬来了，含孙辈：组里的文字也在）。
    expect(childNames(graph, copyId)).toEqual(childNames(graph, page))
    const copyBoard = need(graph.getChildren(copyId).find((node) => node.name === '容器 甲'))
    expect(graph.getChildren(copyId).indexOf(copyBoard)).toBe(sourceChildren.indexOf(sourceBoard))
    expect(graph.getChildren(copyBoard.id).map((node) => node.name)).toEqual(['色块 甲', '组 甲'])
    const copyGroup = need(graph.getChildren(copyBoard.id)[1])
    expect(graph.getChildren(copyGroup.id).map((node) => node.text)).toEqual(['深一层'])
    // 几何也照搬（复制的是「这一页现在的样子」，不是一副空壳）。
    expect(copyBoard.x).toBe(sourceBoard.x)
    expect(copyBoard.width).toBe(sourceBoard.width)
    expect(copyBoard.height).toBe(sourceBoard.height)
    const sourceGroup = need(graph.getChildren(sourceBoard.id)[1])
    expect(copyGroup.x).toBe(sourceGroup.x)
    expect(copyGroup.y).toBe(sourceGroup.y)
  })

  it('副本插在源页**后面**，不是追加到末尾', () => {
    const graph = scaffoldDesignDocument()
    const first = need(pageIds(graph)[0])
    const second = addPage(graph)
    const third = addPage(graph)
    expect(pageIds(graph)).toEqual([first, second, third])

    duplicatePageIn(graph, first)

    // 复制第一页 ⇒ 副本落在第一页右边，而不是排到最后。
    const afterFirst = pageIds(graph)
    expect(afterFirst).toHaveLength(4)
    expect(afterFirst[0]).toBe(first)
    expect(afterFirst[2]).toBe(second)
    expect(afterFirst[3]).toBe(third)
    expect(need(graph.getNode(need(afterFirst[1]))).name).toBe('页面 1 副本')

    // 复制中间那一页同理（此刻列表是 甲 / 甲副本 / 乙 / 丙）。
    duplicatePageIn(graph, second)
    const afterSecond = pageIds(graph)
    expect(afterSecond[2]).toBe(second)
    expect(need(graph.getNode(need(afterSecond[3]))).name).toBe('页面 2 副本')
    expect(afterSecond[4]).toBe(third)
  })

  it('连复制两次拿到两个不同的名字（名单里已经有一个副本了）', () => {
    const graph = scaffoldDesignDocument()
    const page = need(pageIds(graph)[0])
    duplicatePageIn(graph, page)
    duplicatePageIn(graph, page)
    // 第二次的副本插在**源页**右边，所以它排在第一次那个的前面。
    expect(graph.getPages().map((node) => node.name)).toEqual(['页面 1', '页面 1 副本 2', '页面 1 副本'])
  })

  it('传进来的不是一页就什么也不做', () => {
    const graph = scaffoldDesignDocument()
    const page = need(pageIds(graph)[0])
    const board = need(graph.getChildren(page)[0])
    const before = encodeDesignFile(graph)
    expect(duplicatePageIn(graph, board.id)).toBeNull()
    expect(duplicatePageIn(graph, 'not-a-page')).toBeNull()
    expect(encodeDesignFile(graph)).toBe(before)
    expect(pageIds(graph)).toHaveLength(1)
  })

  it('副本里的子树只属于副本（删副本的容器，源页的还在）', () => {
    const graph = scaffoldDesignDocument()
    const page = need(pageIds(graph)[0])
    seedPage(graph, page, '甲')
    const copyId = copyOf(graph, page)
    graph.deleteNode(need(graph.getChildren(copyId).find((node) => node.name === '容器 甲')).id)
    expect(childNames(graph, copyId)).toEqual(['容器 1'])
    expect(childNames(graph, page)).toEqual(['容器 1', '容器 甲'])
  })

  it('复制出来的文档存盘再读回来还是两页（页是图上真有的东西，不是面板的影子）', () => {
    const graph = scaffoldDesignDocument()
    const page = need(pageIds(graph)[0])
    seedPage(graph, page, '甲')
    duplicatePageIn(graph, page)

    const restored = decodeDesignFile(encodeDesignFile(graph))
    const ids = pageIds(restored)

    expect(restored.getPages().map((node) => node.name)).toEqual(['页面 1', '页面 1 副本'])
    expect(childNames(restored, need(ids[1]))).toEqual(['容器 1', '容器 甲'])
  })
})

describe('容器按页取', () => {
  it('containersIn 只给这一页的，containersOf 给整份文档的', () => {
    const graph = scaffoldDesignDocument()
    const first = need(pageIds(graph)[0])
    const second = addPage(graph)
    seedPage(graph, second, '乙')

    expect(containersIn(graph, first).map((node) => node.name)).toEqual(['容器 1'])
    expect(containersIn(graph, second).map((node) => node.name)).toEqual(['容器 乙'])
    expect(containersOf(graph).map((node) => node.name)).toEqual(['容器 1', '容器 乙'])
  })

  it('区域里的容器也算这一页的（与 containersOf 同一套下潜口径）', () => {
    const graph = scaffoldDesignDocument()
    const page = need(pageIds(graph)[0])
    const another = addPage(graph)
    const region = graph.createNode('SECTION', page, { name: '区域' })
    graph.createNode('FRAME', region.id, { name: '区域里的容器' })

    expect(containersIn(graph, page).map((node) => node.name)).toEqual(['容器 1', '区域里的容器'])
    expect(containersIn(graph, another)).toEqual([])
  })

  it('缩略图取第一页（离屏那侧没有「当前页」）', () => {
    const graph = scaffoldDesignDocument()
    const first = firstPageId(graph)
    addPage(graph)
    expect(firstPageId(graph)).toBe(first)
    expect(need(graph.getNode(need(firstPageId(graph)))).name).toBe('页面 1')
  })
})

describe('渲染与贴合只算这一页', () => {
  /** 一枚记流水账的画笔：只记下画了哪些容器，够验「画的是哪一页」。 */
  function recorder(): DesignPaintOps & { boards: { x: number; y: number; width: number }[] } {
    const boards: { x: number; y: number; width: number }[] = []
    return {
      boards,
      opacity: () => {},
      shadowRect: (x, y, width) => boards.push({ x, y, width }),
      rect: () => {},
      ellipse: () => {},
      text: () => {},
      pushClip: () => {},
      popClip: () => {},
    }
  }

  /** 两页各一块容器，第二页那块更远更大——「算错了」在数字上立刻看得出来。 */
  function twoPages(): { graph: SceneGraph; first: string; second: string } {
    const graph = scaffoldDesignDocument()
    const first = need(pageIds(graph)[0])
    const second = addPage(graph)
    graph.createNode('FRAME', second, { name: '容器 乙', x: 1000, y: 1000, width: 400, height: 400 })
    return { graph, first, second }
  }

  it('包围盒只看这一页（不然镜头会去装下所有页）', () => {
    const { graph, first, second } = twoPages()
    expect(documentBounds(graph, first)).toEqual({ x: 0, y: 0, width: 1024, height: 1024 })
    expect(documentBounds(graph, second)).toEqual({ x: 0, y: 0, width: 1400, height: 1400 })
  })

  it('贴合按这一页居中（第二页包围盒更大，缩得就更狠）', () => {
    const { graph, first, second } = twoPages()
    const a = fitTransform(graph, first, 1200, 900)
    const b = fitTransform(graph, second, 1200, 900)
    expect(a.scale).toBeGreaterThan(b.scale)
    // 居中：容器两边留下的空当一样宽。
    expect(a.x).toBeCloseTo((1200 - 1024 * a.scale) / 2)
  })

  it('只画这一页的容器（两页的内容叠着画 —— 那是多页落地前的老毛病）', () => {
    const { graph, first, second } = twoPages()

    const onFirst = recorder()
    paintDocument(graph, onFirst, { x: 0, y: 0, scale: 1 }, first)
    expect(onFirst.boards).toEqual([{ x: 0, y: 0, width: 1024 }])

    const onSecond = recorder()
    paintDocument(graph, onSecond, { x: 0, y: 0, scale: 1 }, second)
    expect(onSecond.boards).toEqual([{ x: 1000, y: 1000, width: 400 }])
  })

  it('页 id 不认识时什么也不画（空白比画错强）', () => {
    const { graph } = twoPages()
    const ops = recorder()
    paintDocument(graph, ops, { x: 0, y: 0, scale: 1 }, 'not-a-page')
    expect(ops.boards).toEqual([])
    expect(documentBounds(graph, 'not-a-page')).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})

/**
 * 接线那几条只能读源码文本：`design-panels.tsx` 一进来就碰宿主 UI 原语（node 下死于
 * `clsx`），`design-engine.ts` 要 CanvasKit 与 DOM。读法按仓库纪律来——断言**锚到代码行**
 * 上（`toContain` 会被文件头的注释命中，注释里恰好写着那个名字的教训已经有过一次），
 * 也不拿「同文件别处恰好还有一行一样的」兜住一条已经坏掉的接线。
 */
describe('页面管理落在面板与引擎上', () => {
  const panelSource = read('../../../../src/client/artifact/viewers/design/design-panels.tsx')
  const engineSource = read('../../../../src/client/artifact/viewers/design/design-engine.ts')

  it('四个操作都在：新建在标题栏，复制/重命名/删除在行尾', () => {
    expect(panelSource).toMatch(/^\s*engine\.addPage\(\)$/m)
    expect(panelSource).toMatch(/^\s*engine\.duplicatePage\(page\.id\)$/m)
    expect(panelSource).toMatch(/^\s*engine\.renamePage\(page\.id, name\)$/m)
    expect(panelSource).toMatch(/^\s*engine\.deletePage\(page\.id\)$/m)
  })

  it('删除是两步：垃圾桶那一下只「挂起确认」，真删发生在确认按钮的回调里', () => {
    // 面板里 `engine.deletePage` 只许出现一次——那一处必须是**确认**按钮。
    expect(panelSource.match(/engine\.deletePage\(page\.id\)/g) ?? []).toHaveLength(1)
    const from = panelSource.indexOf('data-tip="删除页面"')
    const to = panelSource.indexOf('</button>', from)
    expect(from).toBeGreaterThan(0)
    const trashButton = panelSource.slice(from, to)
    expect(trashButton).toContain('setConfirming(page.id)')
    expect(trashButton).not.toContain('deletePage')
    // 确认态那一行：两枚字按钮里的危险色那一枚才真删。
    expect(panelSource).toMatch(/dsh-canvas-design-page-act is-danger[\s\S]{0,240}?engine\.deletePage\(page\.id\)/)
  })

  it('可删性问 pages.ts，面板不许自己数页数', () => {
    expect(panelSource).toMatch(/^\s*const canRemove = canRemovePage\(snapshot\.pages\.length\)$/m)
    expect(panelSource).not.toMatch(/pages\.length\s*>\s*1/)
  })

  it('页名一律过 pageLabel（空名也得有一行字）', () => {
    expect(panelSource).toMatch(/\{pageLabel\(page\.name\)\}/)
    expect(panelSource).toMatch(/title=\{pageLabel\(page\.name\)\}/)
  })

  it('引擎：命中圈在当前页里（不圈的话两页同坐标时选中的是别页那个）', () => {
    expect(engineSource).toMatch(
      /^\s*return graph\.hitTestDeep\(world\.x, world\.y, editor\.state\.currentPageId\)\?\.id \?\? null$/m,
    )
  })

  it('引擎：2D 那一路与贴合都按当前页（`pageId` 是必填的，漏传编译就红）', () => {
    expect(engineSource).toMatch(
      /^\s*paintDocument\(graph, canvas2dBackend\(context\), viewport, editor\.state\.currentPageId\)$/m,
    )
    expect(engineSource).toMatch(/fitTransform\(graph, editor\.state\.currentPageId, width, height\)/)
  })

  it('引擎：新建取中文默认名、复制接纯模块的机制、重命名交回上游那一支', () => {
    expect(engineSource).toMatch(/editor\.addPage\(newPageName\(graph\.getPages\(\)\.map\(\(page\) => page\.name\)\)\)/)
    expect(engineSource).toMatch(/duplicatePageIn\(graph, pageId\)/)
    expect(engineSource).toMatch(/editor\.renamePage\(pageId, name\)/)
    // 上游就有 renamePage，别处再写一遍 `graph.updateNode(…, { name })` 就是第二个写口。
    expect(engineSource).not.toMatch(/graph\.updateNode\(pageId, \{ name \}\)/)
  })
})
