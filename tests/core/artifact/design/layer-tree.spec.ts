/**
 * 图层树展开状态的判据（F2.9，v1.67）：**默认折叠**。
 *
 * 用户原话：「参考 Figma 添加 page 管理，分上下两栏，上面是 page，下面是图层，**图层默认
 * 折叠不展开**」。这一条只管最后半句——`layer-tree.ts` 是纯的（只认 `{ id, children }`），
 * 所以这里拿真数据把四条路逐条点名：初次挂载、快照刷新、点箭头、画布点选让开祖先。
 *
 * 最要紧的两条性质：
 *
 * - **新出现的默认折叠**（含深层的、含新建的容器）；
 * - **动过的不再自动改**——画布每落一次盘就换一份快照，若每次都重算「可展开 ⇒ 折叠」，
 *   用户刚点开的容器会自己折上。`seen` 挡的就是这个。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  emptyCollapse,
  expandNodes,
  toggleCollapse,
  withNewNodesCollapsed,
  type LayerCollapseState,
  type LayerTreeNode,
} from '../../../../src/core/artifact/design/layer-tree.ts'

/** 读源码文本（JSX 那几条只能这么判：`design-panels.tsx` 一进来就碰宿主 UI 原语）。 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

const node = (id: string, children: LayerTreeNode[] = []): LayerTreeNode => ({ id, children })

/** 「画板 → 分组 → 两个叶子」这种常见形状。 */
const board = (): LayerTreeNode[] => [
  node('board', [node('group', [node('leaf-a'), node('leaf-b')]), node('solo')]),
  node('board-2', [node('leaf-c')]),
]

describe('初次挂载：全折叠', () => {
  it('带子节点的全进折叠集合，叶子不进', () => {
    const state = withNewNodesCollapsed(board(), emptyCollapse())
    expect([...state.collapsed].sort()).toEqual(['board', 'board-2', 'group'])
  })

  it('深层的可展开节点也算（不是只看顶层）', () => {
    const state = withNewNodesCollapsed([node('a', [node('b', [node('c')])])], emptyCollapse())
    expect(state.collapsed.has('b')).toBe(true)
  })

  it('空图：什么都不折，也不崩', () => {
    const state = withNewNodesCollapsed([], emptyCollapse())
    expect(state.collapsed.size).toBe(0)
    expect(state.seen.size).toBe(0)
  })
})

describe('快照刷新：新出现的默认折叠，动过的不再自动改', () => {
  it('没有新节点就**原样返回入参**（引用相等，省一次重渲染）', () => {
    const first = withNewNodesCollapsed(board(), emptyCollapse())
    expect(withNewNodesCollapsed(board(), first)).toBe(first)
  })

  it('新画的容器下一次快照进来是折叠的', () => {
    const first = withNewNodesCollapsed(board(), emptyCollapse())
    const grown = [...board(), node('board-3', [node('leaf-d')])]
    const next = withNewNodesCollapsed(grown, first)
    expect(next.collapsed.has('board-3')).toBe(true)
    // 老的那些原样（引用也没白换）。
    expect([...next.collapsed].sort()).toEqual(['board', 'board-2', 'board-3', 'group'])
  })

  it('用户点开过的容器，刷新时**不会自己折回去**', () => {
    const opened = toggleCollapse(withNewNodesCollapsed(board(), emptyCollapse()), 'board')
    expect(opened.collapsed.has('board')).toBe(false)
    // 换一份快照（同样的树）——`seen` 里已经有 board，不该再折叠。
    const refreshed = withNewNodesCollapsed(board(), opened)
    expect(refreshed.collapsed.has('board')).toBe(false)
  })

  it('用户折上的，刷新也不动它', () => {
    const state = withNewNodesCollapsed(board(), emptyCollapse())
    expect(withNewNodesCollapsed(board(), state).collapsed.has('group')).toBe(true)
  })
})

describe('点箭头：两向都对，且两向都算「动过」', () => {
  it('折着的展开、开着的折上', () => {
    const state = withNewNodesCollapsed(board(), emptyCollapse())
    const opened = toggleCollapse(state, 'board')
    expect(opened.collapsed.has('board')).toBe(false)
    const closed = toggleCollapse(opened, 'board')
    expect(closed.collapsed.has('board')).toBe(true)
  })

  it('展开也算「动过」：之后刷新不会被重新折叠', () => {
    const opened = toggleCollapse(withNewNodesCollapsed(board(), emptyCollapse()), 'group')
    const refreshed = withNewNodesCollapsed(board(), opened)
    expect(refreshed.collapsed.has('group')).toBe(false)
  })
})

describe('画布点选：把选中项的祖先让开（并在之后保持让开）', () => {
  it('展开祖先，其余照旧折着', () => {
    const state = withNewNodesCollapsed(board(), emptyCollapse())
    const next = expandNodes(state, ['board', 'group'])
    expect(next.collapsed.has('board')).toBe(false)
    expect(next.collapsed.has('group')).toBe(false)
    expect(next.collapsed.has('board-2')).toBe(true)
  })

  it('对一份还没经过「默认折叠」的状态也能展开，并把它记进 `seen`（兜底那一档）', () => {
    // 常规路径上 `seen` 早就含所有可展开节点（初次折叠时加的），所以这一条**绕开那次折叠**
    // 直接给一份"生"的状态——`expandNodes` 里那句 `seen.add` 只有在这时才真正起作用，
    // 它保的是「刚被展开、却还没被默认折叠处理过」的祖先不会被下一次快照折回去。
    const raw: LayerCollapseState = { collapsed: new Set(['group']), seen: new Set<string>() }
    const next = expandNodes(raw, ['group'])
    expect(next.collapsed.has('group')).toBe(false)
    expect(next.seen.has('group')).toBe(true)
    expect(withNewNodesCollapsed(board(), next).collapsed.has('group')).toBe(false)
  })

  it('已经展开着 ⇒ 原样返回入参（引用相等）', () => {
    const opened = expandNodes(withNewNodesCollapsed(board(), emptyCollapse()), ['board'])
    expect(expandNodes(opened, ['board'])).toBe(opened)
  })
})

describe('不改入参（面板把它们塞在 setState 里，旧状态得留着）', () => {
  it('三个函数都不动传进来的那一份', () => {
    const state = withNewNodesCollapsed(board(), emptyCollapse())
    const before = [...state.collapsed].sort()
    toggleCollapse(state, 'board')
    expandNodes(state, ['group'])
    withNewNodesCollapsed([...board(), node('new', [node('x')])], state)
    expect([...state.collapsed].sort()).toEqual(before)
    expect(state.collapsed.has('board')).toBe(true)
  })
})

/**
 * 接线那几条只能读源码文本：`design-panels.tsx` 一进来就碰宿主 UI 原语（node 下死于
 * `clsx`）。读法按仓库纪律来——断言**锚到代码行**上（`toContain` 会被文件头的注释命中），
 * 也不拿「同文件别处恰好还有一行一样的」兜住一条已经坏掉的接线。
 */
describe('接线：默认折叠真的接在面板上', () => {
  const panel = read('../../../../src/client/artifact/viewers/design/design-panels.tsx')

  it('初始状态是「新节点全折叠」，不是空集合（空集合 = 全展开）', () => {
    expect(panel).toMatch(/^\s*withNewNodesCollapsed\(snapshot\.layers, emptyCollapse\(\)\),$/m)
    expect(panel).not.toContain('useState<Set<string>>(new Set())')
  })

  it('快照刷新走同一条（新节点折叠、动过的不动）', () => {
    expect(panel).toMatch(
      /^\s*setCollapse\(\(previous\) => withNewNodesCollapsed\(snapshot\.layers, previous\)\)$/m,
    )
  })

  it('箭头两向、选中祖先让开，都走纯模块', () => {
    expect(panel).toMatch(/^\s*setCollapse\(\(previous\) => toggleCollapse\(previous, node\.id\)\)$/m)
    expect(panel).toMatch(/^\s*setCollapse\(\(previous\) => expandNodes\(previous, ancestors\)\)$/m)
  })

  it('渲染判定读的是新状态（没有新旧两套混用）', () => {
    expect(panel).toMatch(/^\s*const isCollapsed = collapse\.collapsed\.has\(node\.id\)$/m)
    expect(panel).not.toMatch(/^\s*const isCollapsed = collapsed\.has\(node\.id\)$/m)
  })

  it('状态来自本模块（面板自己不再手搓 Set）', () => {
    expect(panel).toMatch(/from '(?:\.\.\/)+core\/artifact\/design\/layer-tree\.ts'/)
    expect(panel).not.toMatch(/new Set\(previous\)/)
  })
})
