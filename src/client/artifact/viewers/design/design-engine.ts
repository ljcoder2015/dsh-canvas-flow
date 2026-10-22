/**
 * dsh-canvas — 设计预览引擎入口（独立 ESM chunk，`lib/assets/design-engine.js`）。
 *
 * 这个文件是 build.mjs 的第三步入口：场景图（`@open-pencil/scene-graph`）、
 * OpenPencil 渲染器（`@open-pencil/core/canvas`）、**headless editor**
 * （`@open-pencil/core/editor`，P4 编辑闭环的底座：选中/undo/命中）、yoga 布局、
 * 2D 回退 painter 全部打进一个 ESM chunk，经宿主的资产路由出。client.js 只用
 * 动态 `import()` 取 `createDesignEngine` —— 打成两半是被迫的清醒：
 *
 * 1. client.js 是 CJS（宿主 ModuleLoader 合同），而 yoga-layout 的入口带
 *    顶层 await，CJS 输出装不下；ESM chunk 原生支持。
 * 2. 场景图类身份必须唯一：graph 在引擎 chunk 里创建、也在那里渲染；
 *    client.js 不 import 任何 scene-graph 代码，杜绝双拷贝互不认识。
 *
 * 失败语义：CanvasKit WASM 加载失败 → 2D 后端顶上（同一个引擎对象，内部
 * 换腿）；引擎 chunk 本身加载失败 → viewer 报错（2D painter 也住在里面，
 * 没有更深的降级了）。
 */
import { createEditor } from '@open-pencil/core/editor'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { colorFromCss, colorToCss, decodeDesignFile, encodeDesignFile, DesignDocumentError } from '../../../../core/artifact/design/document.ts'
import { clampPointCount, clampRatio } from '../../../../core/artifact/design/node-props.ts'
import { duplicatePageIn, newPageName } from '../../../../core/artifact/design/pages.ts'
import { canvas2dBackend, fitTransform, paintDocument } from './design-render.ts'
import { createSkiaBackend } from './design-skia.ts'
import type {
  CreateDesignEngineArgs,
  DesignArc,
  DesignBackend,
  DesignEngine,
  DesignEffectItem,
  DesignGeometry,
  DesignHistoryState,
  DesignLayerNode,
  DesignNodeFrame,
  DesignNodeProps,
  DesignNodeRead,
  DesignStrokeItem,
  DesignViewport,
  EngineOutcome,
} from './design-engine-types.ts'

/** The engine is the module's whole surface — the viewer imports nothing else. */
export function createDesignEngine(args: CreateDesignEngineArgs): Promise<EngineOutcome> {
  return buildEngine(args).catch((error: unknown) => ({
    kind: 'error',
    message: error instanceof Error ? error.message : '设计预览引擎初始化失败。',
    // 解不开文档的照实带码（客户端按码出文案）；别的异常统一算引擎初始化失败。
    ...(error instanceof DesignDocumentError
      ? { code: error.code, ...(error.detail === '' ? {} : { detail: error.detail }) }
      : { code: 'engine-init' as const }),
  }))
}

/**
 * 导出（F10.1，v1.59）：这一份 chunk 的**第二个出口**，与 `createDesignEngine` 并列。
 *
 * 与引擎分成两个出口而不是一个，是因为导出**不该先要一台引擎**：胶囊上的导出钮在画布上
 * 就能点，卡片可能从没被打开过（没有画布元素、没有视口、也没有编辑器）。导出要的只是
 * 「把这串信封文本画成某一种格式」，于是它自己解码、自己起一台离屏渲染器、画完即弃。
 *
 * 它必须住在这个 chunk 里，理由与引擎完全一样：场景图的**类身份**得全页唯一——graph 在
 * 这里创建，也只能由这里的渲染器画。实现见 `design-io.ts`。
 */
export { exportDesignDocument as designExport } from './design-io.ts'

async function buildEngine({ twoD, gl, runtime, envelope, onRepaint }: CreateDesignEngineArgs): Promise<EngineOutcome> {
  let graph: SceneGraph
  try {
    graph = decodeDesignFile(envelope)
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : '设计文档无法解码。',
      ...(error instanceof DesignDocumentError
        ? { code: error.code, ...(error.detail === '' ? {} : { detail: error.detail }) }
        : { code: 'engine-init' as const }),
    }
  }

  // The headless editor owns selection, undo and the scene-version counter —
  // its graph subscription turns every mutation into a render request, which
  // is exactly the "did the picture go stale" signal the paint loop needs.
  const editor = createEditor({ graph })

  // Fidelity first: the Skia engine takes the GL canvas when the WASM runtime
  // is present. Failure here (no WebGL2, no CPU surface, fonts blow up) is a
  // downgrade, not an error.
  let skia: DesignBackend | null = null
  if (runtime !== null) {
    try {
      skia = await createSkiaBackend(gl, runtime, graph, onRepaint)
    } catch {
      skia = null
    }
    if (skia !== null) gl.style.visibility = 'visible'
  }

  // 切页是异步的（字体/layout 准备），完成后补一帧；addPage/deletePage 内部
  // 也走 switchPage，这一个订阅把页面面板的所有重画都收口了。
  editor.onEditorEvent('page:changed', () => onRepaint())

  // —— 历史计数（HUD 撤销/重做两枚按钮的禁用判据）。
  //
  // core 的 UndoManager 有 canUndo/canRedo，却没从 createEditor 的能力面里露出来；我们只
  // 能自己记。记法是**以事实为准**：UndoManager 每次进栈/退栈都同步响一次
  // `history:changed`，所以每个动作前后各取一次事件数，响了才动计数——比「调一次提交就当
  // 一笔」诚实（commitNodeUpdate 在没真变时是直接早退的，不进栈）。唯一的偏差来源是 core
  // 那个 200 笔的容量上限（超了会裁掉最旧的），那时计数会偏大——按钮多亮一格，点下去是空
  // 操作，不伤人。
  let historyEvents = 0
  editor.onEditorEvent('history:changed', () => {
    historyEvents += 1
  })
  let undoSteps = 0
  let redoSteps = 0
  /** 一次新提交：退的栈多一笔，进的栈作废（历史分叉了）。 */
  const recordHistory = (before: number): void => {
    if (historyEvents === before) return
    undoSteps += 1
    redoSteps = 0
  }
  /** 一次撤销/重做：两栈之间挪一笔。 */
  const stepHistory = (before: number, forward: boolean): void => {
    if (historyEvents === before) return
    if (forward) {
      redoSteps -= 1
      undoSteps += 1
    } else {
      undoSteps -= 1
      redoSteps += 1
    }
  }

  // 贴合按**当前页**算（`editor.state.currentPageId` 现取）：多页之后「整份文档的包围盒」
  // 会把镜头拉到一屏装下所有页，而画布一次只画一页。
  const fit = (width: number, height: number): DesignViewport =>
    fitTransform(graph, editor.state.currentPageId, width, height)

  /** The screen→world step every pointer coordinate takes before a hit test. */
  const toWorld = (sx: number, sy: number, viewport: DesignViewport): { x: number; y: number } => ({
    x: (sx - viewport.x) / viewport.scale,
    y: (sy - viewport.y) / viewport.scale,
  })

  // Move-drag state: positions captured at pointer-down, replayed per frame.
  let moveOriginals: Map<string, { x: number; y: number }> | null = null
  // 缩放/旋转同一副节律：起手拍几何、拖的时候直接落图、收手提交一条 undo。
  let transformOriginals: { id: string; before: DesignGeometry } | null = null
  // 悬停高亮：编辑模式指针下的「将被选中」节点。渲染器按帧画 overlay，
  // 不进场景 picture——变更只触发重画，不 bump sceneVersion。
  let hoverId: string | null = null

  const readNode = (id: string): DesignNodeRead | null => {
    const node = graph.getNode(id)
    if (node === undefined) return null
    return {
      id: node.id,
      type: node.type.toLowerCase(),
      name: node.name,
      visible: node.visible,
      locked: node.locked,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
      fill: firstSolidCss(node),
      opacity: node.opacity,
      cornerRadius: node.cornerRadius,
      topLeftRadius: node.topLeftRadius,
      topRightRadius: node.topRightRadius,
      bottomRightRadius: node.bottomRightRadius,
      bottomLeftRadius: node.bottomLeftRadius,
      independentCorners: node.independentCorners,
      clipsContent: node.clipsContent,
      blendMode: node.blendMode,
      pointCount: node.pointCount,
      starInnerRadius: node.starInnerRadius,
      arc: readArc(node),
      strokes: readStrokes(node),
      effects: readEffects(node),
      text: node.text,
      fontSize: node.fontSize,
      fontFamily: node.fontFamily,
      fontWeight: node.fontWeight,
      lineHeight: node.lineHeight,
      letterSpacing: node.letterSpacing,
      textAlignHorizontal: node.textAlignHorizontal,
      textAutoResize: node.textAutoResize,
    }
  }

  /** 工具面：两种渲染后端共用同一套编辑语义。 */
  const editing = {
    pick(sx: number, sy: number, viewport: DesignViewport): string | null {
      const world = toWorld(sx, sy, viewport)
      // 命中**圈在当前页里**（`hitTestDeep` 不给范围就是整棵文档树，一路走到底下每一页）：
      // 多页之后两页的内容常常坐标完全相同（复制出来的页就是照搬的），不圈的话点在第二页
      // 上选中的是第一页那个——画面上还看不出错，只是选错了人。
      return graph.hitTestDeep(world.x, world.y, editor.state.currentPageId)?.id ?? null
    },
    hover: (id: string | null): void => {
      if (hoverId === id) return
      hoverId = id
      onRepaint()
    },
    selection: (): string[] => [...editor.state.selectedIds],
    select(ids: readonly string[], additive: boolean): void {
      editor.select([...ids], additive)
    },
    nodeProps: readNode,
    beginMove(): void {
      moveOriginals = new Map()
      for (const id of editor.state.selectedIds) {
        const node = graph.getNode(id)
        if (node !== undefined) moveOriginals.set(id, { x: node.x, y: node.y })
      }
    },
    nudgeSelection(dx: number, dy: number): void {
      if (moveOriginals === null) return
      for (const [id, origin] of moveOriginals) {
        graph.updateNode(id, { x: origin.x + dx, y: origin.y + dy })
      }
    },
    endMove(): void {
      if (moveOriginals === null) return
      // 原地点击（没有真拖动）不压 undo——core 的 commitMove 不做等值检查。
      let moved = false
      for (const [id, origin] of moveOriginals) {
        const node = graph.getNode(id)
        if (node === undefined) continue
        if (node.x !== origin.x || node.y !== origin.y) {
          moved = true
          break
        }
      }
      if (moved) {
        // `commitMove` captures the *current* positions as the forward side and
        // replays the originals as the inverse.
        const before = historyEvents
        editor.commitMove(moveOriginals)
        recordHistory(before)
      }
      moveOriginals = null
    },
    beginTransform(): void {
      const selected = [...editor.state.selectedIds]
      // 缩放/旋转只对**单个**节点开：两者都以节点中心为支点，多选没有那一枚共同的中心。
      const id = selected.length === 1 ? selected[0] : undefined
      const node = id === undefined ? undefined : graph.getNode(id)
      if (node === undefined) {
        transformOriginals = null
        return
      }
      transformOriginals = { id: node.id, before: { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation } }
    },
    applyTransform(geometry: DesignGeometry): void {
      const origin = transformOriginals
      if (origin === null) return
      // 宽高只防被拖成负尺寸（场景图没有「负宽」这回事）；角度任意，整圈与负角都合法。
      graph.updateNode(origin.id, {
        x: geometry.x,
        y: geometry.y,
        width: Math.max(geometry.width, 1),
        height: Math.max(geometry.height, 1),
        rotation: geometry.rotation,
      })
    },
    endTransform(): void {
      const origin = transformOriginals
      if (origin === null) return
      transformOriginals = null
      const node = graph.getNode(origin.id)
      if (node === undefined) return
      const { before } = origin
      // 起手又收手（位置、宽高、角度一个没动）就不压 undo——与 endMove 同一条规矩。
      if (node.x === before.x && node.y === before.y && node.width === before.width && node.height === before.height && node.rotation === before.rotation) {
        return
      }
      const beforeEvents = historyEvents
      editor.commitNodeUpdate(origin.id, before, '变换图层')
      recordHistory(beforeEvents)
    },
    nodeFrame(id: string): DesignNodeFrame | null {
      const target = graph.getNode(id)
      if (target === undefined) return null
      // 先自下而上收到祖先链，再从上往下合成（最顶那一级 → 目标节点）。
      const chain: SceneNode[] = [target]
      let parentId: string | null = target.parentId
      while (parentId !== null && parentId !== graph.rootId) {
        const parent = graph.getNode(parentId)
        if (parent === undefined) break
        chain.unshift(parent)
        parentId = parent.parentId
      }
      // 每层的局部变换都是「平移 (x,y) 再**绕自身中心**转 rotation」——与 core 的画法同源
      // （highlight-rect / shadows 都是 rotate(θ, w/2, h/2)），所以一份「总角度 + 平移」就
      // 够表达整条链：世界点 = R(总角度)·局部点 + 平移。
      let angle = 0
      let tx = 0
      let ty = 0
      let parentRotation = 0
      for (const node of chain) {
        // 走到目标节点时，累计角里装的正是**祖先那部分**——节点自己的 rotation 是相对父级的。
        if (node.id === target.id) parentRotation = angle
        const rad = (node.rotation * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        const cx = node.width / 2
        const cy = node.height / 2
        // 本层：p → R(θ)(p − c) + c + (x, y)，写成「R(θ)p + 平移」后平移是这个。
        const localTx = node.x + cx - (cos * cx - sin * cy)
        const localTy = node.y + cy - (sin * cx + cos * cy)
        const outer = (angle * Math.PI) / 180
        const outerCos = Math.cos(outer)
        const outerSin = Math.sin(outer)
        tx += outerCos * localTx - outerSin * localTy
        ty += outerSin * localTx + outerCos * localTy
        angle += node.rotation
      }
      const rad = (angle * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const cx = target.width / 2
      const cy = target.height / 2
      return {
        centerX: cos * cx - sin * cy + tx,
        centerY: sin * cx + cos * cy + ty,
        width: target.width,
        height: target.height,
        rotation: angle,
        parentRotation,
      }
    },
    updateProps(id: string, props: DesignNodeProps): boolean {
      const node = graph.getNode(id)
      if (node === undefined) return false
      const changes: Record<string, unknown> = {}
      const previous: Record<string, unknown> = {}
      // 直接落在节点标量字段上的项（几何/显隐/命名/排版）——同一套「先记旧值、
      // 后提交 undo」的节律。
      //
      // 排版这几项（fontFamily/fontWeight/lineHeight/letterSpacing/textAlignHorizontal）能这么写，
      // 是因为场景图的 `TEXT_PICTURE_KEYS` 把它们都算作**文本缓存失效**的触发键（幅面/字面都会
      // 因此重画）；`textAutoResize` 不在其中——它只改布局约束，下一次布局pass自会读它。
      for (const key of [
        'name',
        'visible',
        'locked',
        'x',
        'y',
        'width',
        'height',
        'rotation',
        'clipsContent',
        'independentCorners',
        'blendMode',
        'fontFamily',
        'fontWeight',
        'lineHeight',
        'letterSpacing',
        'textAlignHorizontal',
        'textAutoResize',
      ] as const) {
        const next = props[key]
        if (next === undefined || node[key] === next) continue
        changes[key] = next
        previous[key] = node[key]
      }
      // 形状特有：边数/内径**都要夹**——面板给的是自由输入，半个角、越界的比值都画不出来。
      if (props.pointCount !== undefined) {
        const next = clampPointCount(props.pointCount)
        if (node.pointCount !== next) {
          changes.pointCount = next
          previous.pointCount = node.pointCount
        }
      }
      if (props.starInnerRadius !== undefined) {
        const next = clampRatio(props.starInnerRadius)
        if (node.starInnerRadius !== next) {
          changes.starInnerRadius = next
          previous.starInnerRadius = node.starInnerRadius
        }
      }
      // 弧是**对象**字段（场景图里整组替换，`null` = 完整椭圆）：先逐字段比过再写，
      // 没变就什么都不记——不然「点一下别的格」也会留一笔假 undo。
      if (props.arc !== undefined) {
        const next = props.arc
        const current = readArc(node)
        const unchanged =
          next === null
            ? current === null
            : current !== null &&
              current.startingAngle === next.startingAngle &&
              current.endingAngle === next.endingAngle &&
              current.innerRadius === next.innerRadius
        if (!unchanged) {
          changes.arcData =
            next === null
              ? null
              : { startingAngle: next.startingAngle, endingAngle: next.endingAngle, innerRadius: clampRatio(next.innerRadius) }
          previous.arcData = current === null ? null : { ...current }
        }
      }
      if (props.fill !== undefined) {
        const color = colorFromCss(props.fill)
        if (color !== undefined) {
          changes.fills = [{ type: 'SOLID', visible: true, color }]
          previous.fills = structuredClone(node.fills)
        }
      }
      if (props.opacity !== undefined && node.opacity !== props.opacity) {
        changes.opacity = props.opacity
        previous.opacity = node.opacity
      }
      // 统一圆角联动四角并关掉独立开关（与 ops.setProps 的生成语义一致）；
      // 独立角写任一个都把开关打开——两个入口不会互相打架。
      if (props.cornerRadius !== undefined && node.cornerRadius !== props.cornerRadius) {
        changes.cornerRadius = props.cornerRadius
        changes.topLeftRadius = props.cornerRadius
        changes.topRightRadius = props.cornerRadius
        changes.bottomRightRadius = props.cornerRadius
        changes.bottomLeftRadius = props.cornerRadius
        changes.independentCorners = false
        previous.cornerRadius = node.cornerRadius
        previous.topLeftRadius = node.topLeftRadius
        previous.topRightRadius = node.topRightRadius
        previous.bottomRightRadius = node.bottomRightRadius
        previous.bottomLeftRadius = node.bottomLeftRadius
        previous.independentCorners = node.independentCorners
      }
      for (const key of ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'] as const) {
        const next = props[key]
        if (next === undefined || node[key] === next) continue
        changes[key] = next
        previous[key] = node[key]
        changes.independentCorners = true
        previous.independentCorners = node.independentCorners
      }
      // 边框与效果：面板给的是整组数组的语义面，这里换算成场景图的 plain 数据。
      if (props.strokes !== undefined) {
        changes.strokes = props.strokes.map(strokeToPlain)
        previous.strokes = structuredClone(node.strokes)
        const sideChanges = strokeSideChanges(node, props.strokes)
        Object.assign(changes, sideChanges.changes)
        Object.assign(previous, sideChanges.previous)
      }
      if (props.effects !== undefined) {
        changes.effects = props.effects.map(effectToPlain)
        previous.effects = structuredClone(node.effects)
      }
      if (props.text !== undefined && node.text !== props.text) {
        changes.text = props.text
        previous.text = node.text
      }
      if (props.fontSize !== undefined && node.fontSize !== props.fontSize) {
        changes.fontSize = props.fontSize
        previous.fontSize = node.fontSize
      }
      if (Object.keys(changes).length === 0) return false
      graph.updateNode(id, changes)
      // The editor's own commit snapshots the post-write values for the
      // forward side and derives "did anything actually change" itself.
      const before = historyEvents
      editor.commitNodeUpdate(id, previous, '编辑属性')
      recordHistory(before)
      return true
    },
    deleteSelection(): void {
      if (editor.state.selectedIds.size === 0) return
      const before = historyEvents
      editor.deleteSelected()
      recordHistory(before)
    },
    undo(): void {
      if (undoSteps === 0) return
      const before = historyEvents
      editor.undoAction()
      stepHistory(before, false)
    },
    redo(): void {
      if (redoSteps === 0) return
      const before = historyEvents
      editor.redoAction()
      stepHistory(before, true)
    },
    history: (): DesignHistoryState => ({ undo: undoSteps > 0, redo: redoSteps > 0 }),
    snapshot: () => {
      const build = (parentId: string): DesignLayerNode[] =>
        graph.getChildren(parentId).map((node) => ({
          id: node.id,
          name: node.name,
          type: node.type.toLowerCase(),
          visible: node.visible,
          locked: node.locked,
          children: build(node.id),
        }))
      return {
        pages: graph.getPages().map((page) => ({ id: page.id, name: page.name })),
        currentPageId: editor.state.currentPageId,
        layers: build(editor.state.currentPageId),
        selection: [...editor.state.selectedIds],
      }
    },
    // 切页完成由 page:changed 事件统一收口（switchPage 异步：core 在切页前
    // 做字体/layout 准备），addPage/deletePage 内部也走 switchPage。
    setPage: (pageId: string) => {
      void editor.switchPage(pageId)
    },
    addPage: () => {
      // 名字自己给：上游的默认名是 `Page ${n}`（西文），而 scaffold 建的第一页叫「页面 1」
      // ——同一份文档里两套命名法并列，页面上看得见。取名口径在 `pages.ts`。
      editor.addPage(newPageName(graph.getPages().map((page) => page.name)))
    },
    duplicatePage: (pageId: string) => {
      // 复制（上游没有）：新页 + 照搬整棵子树 + 插在源页后面，机制在 `pages.ts` 里（纯的、
      // 拿真图测得到）；这里只接「切过去」那一步——复制完站在副本上，正是复制这件事的用意。
      const copyId = duplicatePageIn(graph, pageId)
      if (copyId !== null) void editor.switchPage(copyId)
    },
    renamePage: (pageId: string, name: string) => {
      // 空名与同名都不放行：空名会让面板多出一行没有字的行（`pageLabel` 只兜老文档），
      // 同名则是白记一笔。放行之后交回上游那一支（它就是这个字段的写口）。
      const page = graph.getNode(pageId)
      if (page === undefined || page.name === name || name === '') return
      editor.renamePage(pageId, name)
    },
    deletePage: (pageId: string) => {
      editor.deletePage(pageId)
    },
    serialize: (): string => encodeDesignFile(graph),
    onDirty(cb: () => void): () => void {
      // history:changed = 改稿/undo（写盘节律的信号源）；page:changed = 切页
      // 完成（异步 switchPage 的终点，viewer 借它重画并刷新面板）。
      const unbindHistory = editor.onEditorEvent('history:changed', cb)
      const unbindPage = editor.onEditorEvent('page:changed', () => cb())
      return () => {
        unbindHistory()
        unbindPage()
      }
    },
  }

  if (skia !== null) {
    const engine: DesignEngine = {
      render: (viewport, width, height, dpr) =>
        skia?.paint(viewport, width, height, dpr, editor.state.selectedIds, editor.state.sceneVersion, editor.state.currentPageId, hoverId),
      fit,
      dispose: () => {
        gl.style.visibility = 'hidden'
        skia?.dispose()
      },
      ...editing,
    }
    return { kind: 'ready', engine }
  }

  // The 2D path owns its canvas sizing (it re-contexts every frame) and draws
  // the world-aligned dot grid; the Skia path paints its own backdrop instead.
  const engine: DesignEngine = {
    render(viewport, width, height, dpr) {
      if (width === 0 || height === 0) return
      const deviceWidth = Math.round(width * dpr)
      const deviceHeight = Math.round(height * dpr)
      if (twoD.width !== deviceWidth) twoD.width = deviceWidth
      if (twoD.height !== deviceHeight) twoD.height = deviceHeight
      const context = twoD.getContext('2d')
      if (context === null) return
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)
      paintGrid(context, width, height, viewport)
      paintDocument(graph, canvas2dBackend(context), viewport, editor.state.currentPageId)
      paint2DSelection(context, graph, editor.state.selectedIds, viewport)
      if (hoverId !== null) paint2DHover(context, graph, hoverId, viewport)
    },
    fit,
    dispose() {},
    ...editing,
  }
  return { kind: 'ready', engine }
}

/** The first visible solid fill as a css string, or null (gradient/image/none). */
function firstSolidCss(node: SceneNode): string | null {
  const paint = node.fills.find((entry) => entry.visible !== false && entry.type === 'SOLID')
  return paint === undefined ? null : colorToCss(paint.color)
}

/**
 * 椭圆的弧读成面板那一份（`null` = 完整椭圆）。
 *
 * **复制一份再交出去**：场景图那个对象是它自己的字段，面板会把它当草稿摆着（「起点 + 扫过角」
 * 两个输入框共享它），直接引用等于让还没提交的编辑先写回了图上。
 *
 * 类型先放宽再判 `undefined`：老文档解出来的节点可能压根没有这一格，而 TS 在
 * `ArcData | null` 上直接比 `undefined` 会判「不可能」。
 */
function readArc(node: SceneNode): DesignArc | null {
  const arc: SceneNode['arcData'] | undefined = node.arcData
  if (arc === null || arc === undefined) return null
  return { startingAngle: arc.startingAngle, endingAngle: arc.endingAngle, innerRadius: arc.innerRadius }
}

// ── 边框/效果的语义面 ↔ 场景图 plain 数据（属性面板的读写换算） ──────────────

/** 作用边判定：未开独立边宽一律 ALL；开了且只有一条边非零 → 那条边，否则 ALL。 */
function readStrokeSide(node: SceneNode): DesignStrokeItem['side'] {
  if (!node.independentStrokeWeights) return 'ALL'
  const sides: [DesignStrokeItem['side'], number][] = [
    ['TOP', node.borderTopWeight],
    ['RIGHT', node.borderRightWeight],
    ['BOTTOM', node.borderBottomWeight],
    ['LEFT', node.borderLeftWeight],
  ]
  const live = sides.filter(([, weight]) => weight > 0)
  return live.length === 1 ? live[0][0] : 'ALL'
}

/** 节点 strokes → 面板的边框数组（只收可见描边）。 */
function readStrokes(node: SceneNode): DesignStrokeItem[] {
  return node.strokes
    .filter((stroke) => stroke.visible)
    .map((stroke) => ({
      color: colorToCss(stroke.color),
      weight: stroke.weight,
      align: stroke.align,
      dashed: (stroke.dashPattern?.length ?? 0) > 0,
      side: readStrokeSide(node),
    }))
}

/** 面板边框格 → 场景图 Stroke（虚线样式按描边宽度取节距，视觉与 Figma 相当）。 */
function strokeToPlain(item: DesignStrokeItem): SceneNode['strokes'][number] {
  const weight = Math.max(item.weight, 0)
  const color = colorFromCss(item.color) ?? { r: 0.06, g: 0.09, b: 0.16, a: 1 }
  return {
    color,
    weight,
    opacity: 1,
    visible: true,
    align: item.align,
    dashPattern: item.dashed ? [weight * 2, weight * 2] : [],
  }
}

/**
 * 作用边 → 节点级独立边宽的换算：任一格圈了单边就打开 independentStrokeWeights，
 * 每条边的宽度取「作用于它的描边」的最大值（ALL 格作用于全部边）——单描边场景
 * 精确一一对应，多描边混圈单边时按并集退化。
 */
function strokeSideChanges(
  node: SceneNode,
  items: DesignStrokeItem[],
): { changes: Record<string, unknown>; previous: Record<string, unknown> } {
  const changes: Record<string, unknown> = {}
  const previous: Record<string, unknown> = {}
  const weights: Record<Exclude<DesignStrokeItem['side'], 'ALL'>, number> = { TOP: 0, RIGHT: 0, BOTTOM: 0, LEFT: 0 }
  for (const item of items) {
    if (item.side === 'ALL') {
      for (const side of ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] as const) weights[side] = Math.max(weights[side], item.weight)
    } else {
      weights[item.side] = Math.max(weights[item.side], item.weight)
    }
  }
  const anySide = items.some((item) => item.side !== 'ALL')
  if (node.independentStrokeWeights !== anySide) {
    changes.independentStrokeWeights = anySide
    previous.independentStrokeWeights = node.independentStrokeWeights
  }
  for (const [key, weight] of [
    ['borderTopWeight', weights.TOP],
    ['borderRightWeight', weights.RIGHT],
    ['borderBottomWeight', weights.BOTTOM],
    ['borderLeftWeight', weights.LEFT],
  ] as const) {
    if (node[key] === weight) continue
    changes[key] = weight
    previous[key] = node[key]
  }
  return { changes, previous }
}

/** 节点 effects → 面板的效果数组（只收可见效果；前景模糊罕见，不在面板展示）。 */
function readEffects(node: SceneNode): DesignEffectItem[] {
  return node.effects
    .filter((effect) => effect.visible && effect.type !== 'FOREGROUND_BLUR')
    .map((effect) => ({
      type: effect.type as DesignEffectItem['type'],
      color: colorToCss(effect.color),
      x: effect.offset.x,
      y: effect.offset.y,
      radius: effect.radius,
      spread: effect.spread,
    }))
}

/** 面板效果格 → 场景图 Effect（模糊的 offset/spread 归零，保持数据自洽）。 */
function effectToPlain(item: DesignEffectItem): SceneNode['effects'][number] {
  const blur = item.type === 'LAYER_BLUR' || item.type === 'BACKGROUND_BLUR'
  return {
    type: item.type,
    color: colorFromCss(item.color) ?? { r: 0, g: 0, b: 0, a: blur ? 0 : 0.25 },
    offset: blur ? { x: 0, y: 0 } : { x: item.x, y: item.y },
    radius: Math.max(item.radius, 0),
    spread: blur ? 0 : Math.max(item.spread, 0),
    visible: true,
  }
}

/** 2D 后端的选中高亮：给选中节点描一圈强调色（Skia 路径由渲染器原生画）。 */
function paint2DSelection(
  context: CanvasRenderingContext2D,
  graph: SceneGraph,
  selectedIds: ReadonlySet<string>,
  viewport: DesignViewport,
): void {
  if (selectedIds.size === 0) return
  context.strokeStyle = '#2563eb'
  context.lineWidth = 1.5
  for (const id of selectedIds) {
    const node = graph.getNode(id)
    if (node === undefined) continue
    // 节点坐标相对父级；顶层容器（parent 即根）的 x/y 就是世界坐标。P4 只在
    // 顶层图形上画框——进容器内部的精确世界矩形等 P5 的变换合成一起做。
    if (node.parentId !== graph.rootId && !graph.getPages().some((page) => page.id === node.parentId)) continue
    const x = node.x * viewport.scale + viewport.x
    const y = node.y * viewport.scale + viewport.y
    context.strokeRect(x - 1, y - 1, node.width * viewport.scale + 2, node.height * viewport.scale + 2)
  }
}

/** 2D 后端的悬停高亮：比选中框浅一档的同色描边（实线细框，区别于选中）。 */
function paint2DHover(
  context: CanvasRenderingContext2D,
  graph: SceneGraph,
  id: string,
  viewport: DesignViewport,
): void {
  const node = graph.getNode(id)
  if (node === undefined) return
  if (node.parentId !== graph.rootId && !graph.getPages().some((page) => page.id === node.parentId)) return
  context.strokeStyle = '#93b8f9'
  context.lineWidth = 1
  const x = node.x * viewport.scale + viewport.x
  const y = node.y * viewport.scale + viewport.y
  context.strokeRect(x - 1, y - 1, node.width * viewport.scale + 2, node.height * viewport.scale + 2)
}

/**
 * The 2D fallback's background dot grid, aligned to **world** coordinates: the
 * origin sits at the viewport transform, so panning slides the dots and zooming
 * rescales the spacing — the surface reads as infinite rather than as a static
 * wallpaper. Spacing doubles/halves at the clamps so it stays legible at any
 * zoom. (The Skia path paints its own page color; the grid is a 2D luxury.)
 */
function paintGrid(context: CanvasRenderingContext2D, width: number, height: number, viewport: DesignViewport): void {
  let spacing = 24 * viewport.scale
  while (spacing < 12) spacing *= 2
  while (spacing > 96) spacing /= 2
  context.fillStyle = 'rgba(100, 116, 139, 0.30)'
  const offsetX = ((viewport.x % spacing) + spacing) % spacing
  const offsetY = ((viewport.y % spacing) + spacing) % spacing
  for (let x = offsetX; x < width; x += spacing) {
    for (let y = offsetY; y < height; y += spacing) {
      context.fillRect(x, y, 1, 1)
    }
  }
}
