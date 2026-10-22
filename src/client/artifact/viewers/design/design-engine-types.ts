/**
 * dsh-canvas — 设计预览引擎的共享类型（零依赖，浏览器/宿主两侧都可见）。
 *
 * 设计预览的渲染引擎整体打进独立 ESM chunk（`lib/assets/design-engine.js`，
 * build.mjs 第三步）：场景图 + OpenPencil 渲染器 + yoga 布局都住那边，
 * client.js 只经动态 `import()` 取这里声明的能力面。类型放独立模块，
 * 双方 `import type` 引用—— erased，不把 scene-graph 拖进任何一侧。
 */

/**
 * 属性面板两个「有固定取值集合」的字段（混合模式、文本尺寸行为）的联合类型，从判据表
 * （`core/artifact/design/node-props.ts`）取——**只引类型**（erased），类型模块仍是零依赖，
 * 而面板、引擎、判据三处对同一组取值只有一份声明。
 */
import type { BlendModeId, TextAlignId, TextAutoResizeId } from '../../../../core/artifact/design/node-props.ts'

/** The UMD `canvaskit.js` runtime's slice the engine touches. */
export interface CanvasKitRuntime {
  MakeWebGLCanvasSurface?: (element: HTMLCanvasElement) => SurfaceLike | null
  MakeCanvasSurface?: (element: HTMLCanvasElement) => SurfaceLike | null
}

export interface SurfaceLike {
  getCanvas(): unknown
  flush(): void
  delete(): void
  width(): number
  height(): number
}

/** The viewer's pan/zoom camera: screen = world·scale + offset. */
export interface DesignViewport {
  x: number
  y: number
  scale: number
}

/**
 * 撤销/重做的可用态——HUD 上那两枚按钮的禁用判据。
 *
 * core 的 UndoManager 有 canUndo/canRedo，但没从 `createEditor` 的能力面里露出来，所以引擎
 * 自己记一份（记法见 design-engine.ts 的 recordHistory：以 history:changed 有没有响为准，
 * 不是「调了几次提交就算几笔」——commitNodeUpdate 在没真变时是不进栈的）。
 */
export interface DesignHistoryState {
  /** 还有一步可退。 */
  undo: boolean
  /** 还有一步可进（退过之后才有）。 */
  redo: boolean
}

/**
 * 一次几何变换（缩放/旋转）要写下去的几何——节点在**父级坐标系**下的原始字段。
 *
 * 与 {@link DesignNodeProps} 那几个字段同源，单独一个名字是因为变换是**整份覆盖**：
 * 四个字段一起写，缺一个都会把节点弹回旧值。
 */
export interface DesignGeometry {
  x: number
  y: number
  width: number
  height: number
  /** 相对父级的旋转角（度）。 */
  rotation: number
}

/**
 * 单节点在**世界坐标**下的变换框（含祖先位移与旋转）。
 *
 * `rotation` 是**总**角度（祖先 + 自己）：视图层拿它转那一圈手柄用的就是这一个；
 * `parentRotation` 是祖先那部分，节点自己的 `rotation` 字段是相对父级的，两者相减才是
 * 「拖出来的角度该写多少」。
 */
export interface DesignNodeFrame {
  /** 世界坐标下的中心（旋转绕着它）。 */
  centerX: number
  centerY: number
  /** 未旋转的宽高（世界单位）。 */
  width: number
  height: number
  rotation: number
  parentRotation: number
}

/** One rendering backend (the Skia engine implements it; 2D lives inline). */
export interface DesignBackend {
  /** Paint one frame at CSS size `width×height` (device pixels from `dpr`). */
  paint(
    viewport: DesignViewport,
    width: number,
    height: number,
    dpr: number,
    selectedIds: ReadonlySet<string>,
    sceneVersion: number,
    currentPageId: string,
    hoveredId: string | null,
  ): void
  /** Release engine resources (GL contexts, fonts, caches). */
  dispose(): void
}

/** What the viewer drives the engine with: one paint, one fit, one release. */
export interface DesignEngine {
  /** Paint one frame at CSS size `width×height` (device pixels derived from `dpr`). */
  render(viewport: DesignViewport, width: number, height: number, dpr: number): void
  /** The zoom-to-fit camera for a viewport of the given CSS size. */
  fit(width: number, height: number): DesignViewport
  /** Release engine resources (GL contexts, fonts, caches). */
  dispose(): void

  // —— 编辑闭环（P4）。所有坐标都是**世界坐标**（屏幕 = 世界·scale + 视口偏移，
  //    屏→世界由引擎换算），改稿全部走 headless editor：选中/undo/布局都长在那边。
  /** 命中测试：屏幕点 → 最上层节点 id（没打中返回 null）。 */
  pick(sx: number, sy: number, viewport: DesignViewport): string | null
  /** 悬停高亮（编辑模式指针跟随）：null = 清除。id 变化才重画。 */
  hover(id: string | null): void
  /** 当前选中的节点 id。 */
  selection(): string[]
  /** 设置选中；`additive` = shift 多选切换。 */
  select(ids: readonly string[], additive: boolean): void
  /** 一个节点当前的可见属性（属性条的数据源）。 */
  nodeProps(id: string): DesignNodeRead | null
  /** 开始拖移：对当前选中拍位置快照（拖移中的每次 {@link nudgeSelection} 都直接落图）。 */
  beginMove(): void
  /** 拖移中：把选中整体平移 `dx`/`dy` 世界单位（相对拖移起点，可负）。 */
  nudgeSelection(dx: number, dy: number): void
  /** 结束拖移：提交一条 Move undo。 */
  endMove(): void
  /** 改一个节点的属性（css 颜色等），返回是否真的变了。每项都进 undo。 */
  updateProps(id: string, props: DesignNodeProps): boolean
  /** 删除当前选中（带 undo）。 */
  deleteSelection(): void
  undo(): void
  redo(): void
  /** 撤销/重做还有没有一步可走（HUD 那两枚按钮的禁用判据）。 */
  history(): DesignHistoryState
  /**
   * 起手一次缩放/旋转：对当前选中那**一个**节点拍几何快照（多选不支持变换，快照留空）。
   */
  beginTransform(): void
  /** 变换中：把几何直接落到图上（不压 undo；收手时一并提交一条）。 */
  applyTransform(geometry: DesignGeometry): void
  /** 结束变换：与起手时有差就提交一条 undo（没动就什么也不记）。 */
  endTransform(): void
  /**
   * 一个节点在**世界坐标**下的变换框（含祖先位移与旋转）。
   *
   * 选中框与八枚手柄的画法、命中都靠它：手柄长在节点的**自身坐标系**里，只有拿到
   * 中心与总旋转角，视图层才画得出贴合旋转后的那一圈。
   */
  nodeFrame(id: string): DesignNodeFrame | null
  /** 面板数据快照：页面列表、当前页图层树、选中。每次渲染时现取，图小不贵。 */
  snapshot(): DesignSnapshot
  /** 切换当前页（异步：core 会做字体/layout 准备），完成后引擎自会请求重画。 */
  setPage(pageId: string): void
  /** 新建页面并切过去（默认名「页面 N」，取第一个空位）。 */
  addPage(): void
  /**
   * 复制一页：新页带上源页整棵子树，插在源页**后面**，并切到副本上。
   *
   * 上游的 page actions 只有「新建/删除/重命名/切页」四件，复制这一件是我们自己接的
   * （机制在 `core/artifact/design/pages.ts` 的 `duplicatePageIn`，纯的）。传进来的不是
   * 一页就什么也不做。
   */
  duplicatePage(pageId: string): void
  /** 重命名页面（空名与同名都不放行）。 */
  renamePage(pageId: string, name: string): void
  /**
   * 删除页面（最后一页拒删；删当前页 core 会自动切到相邻页）。
   *
   * **不进撤销栈**：上游这一支是直接 `graph.deleteNode`，不走 undo（新建与重命名同样不进）。
   * 所以「删掉一页」在真机上是一去不回的——面板那一层的二次确认不是装饰。
   */
  deletePage(pageId: string): void
  /** 把当前图序列化回 `.design` 信封文本（写盘用）。 */
  serialize(): string
  /** 图变了（undo/redo/命令提交）→ 该写盘了。注册返回解绑函数。 */
  onDirty(cb: () => void): () => void
}

/**
 * 描边作用边（属性面板「边框」一格）：ALL = 四边统一描边；其余为单边描边——
 * 场景图把单边宽度存在节点级（independentStrokeWeights + borderXxxWeight），
 * 面板按「每格一条边」的语义读写（见引擎的换算）。
 */
export type DesignStrokeSide = 'ALL' | 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT'

/**
 * 边框一格的读写面：css 颜色 + 场景图 Stroke 的语义子集（虚线折叠成布尔，
 * 作用边独立成字段）。整组数组提交时整体替换节点 strokes。
 */
export interface DesignStrokeItem {
  color: string
  weight: number
  align: 'INSIDE' | 'CENTER' | 'OUTSIDE'
  dashed: boolean
  side: DesignStrokeSide
}

/**
 * 效果一格的读写面（阴影/模糊）。模糊用 radius，忽略 x/y/spread；
 * 面板按 type 分桶展示（阴影/内阴影/模糊），提交时合并回一个数组。
 */
export interface DesignEffectItem {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR'
  color: string
  x: number
  y: number
  radius: number
  spread: number
}

/** 属性面板可编辑项：几何/外观/文本/边框/效果，外加图层管理字段（名称/显隐/锁定）。 */
export interface DesignNodeProps {
  name?: string
  visible?: boolean
  locked?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  /** 旋转角（度，绕节点中心；场景图的原生字段，正数顺时针）。 */
  rotation?: number
  fill?: string
  opacity?: number
  /** 统一圆角：写入时联动四角并关掉 independentCorners（与 ops.setProps 同语义）。 */
  cornerRadius?: number
  /** 四角独立圆角；写任一角都会把 independentCorners 打开。 */
  topLeftRadius?: number
  topRightRadius?: number
  bottomRightRadius?: number
  bottomLeftRadius?: number
  independentCorners?: boolean
  /** frame 裁切溢出内容的开关（Figma 语义）。 */
  clipsContent?: boolean
  /** 图层混合模式（F2.6）。 */
  blendMode?: BlendModeId
  /** 多边形/星形的边数或角数（整数，引擎侧夹到 3–60）。 */
  pointCount?: number
  /** 星形内径比例（0–1，引擎侧夹取）。 */
  starInnerRadius?: number
  /** 椭圆的弧；`null` = 完整椭圆。整组替换（面板按「起点 + 扫过角」算好了给）。 */
  arc?: DesignArc | null
  /** 边框数组：整组替换（含作用边 → 节点级独立边宽的换算）。 */
  strokes?: DesignStrokeItem[]
  /** 效果数组：整组替换（面板负责分桶合并）。 */
  effects?: DesignEffectItem[]
  text?: string
  fontSize?: number
  /** 字体族。**只能是 `fontManager` 真注册过的名字**（见 `node-props.ts` 的 TEXT_FAMILIES）。 */
  fontFamily?: string
  fontWeight?: number
  /** 行高（px）；`null` = 自动（跟随字面）。 */
  lineHeight?: number | null
  /** 字间距（px，可负）。 */
  letterSpacing?: number
  textAlignHorizontal?: TextAlignId
  /** 文本尺寸行为（自动宽高/自动高度/固定/截断）。 */
  textAutoResize?: TextAutoResizeId
}

/**
 * 椭圆的弧（与场景图 `ArcData` 同形）。
 *
 * 三个都是**原生单位**：角度是度、`innerRadius` 是 0–1 的比值（Figma 的 `arcData` 也是这个
 * 口径）。面板把「起点 + 扫过角」换算成这里的起点/终点角（`node-props.ts` 的 `arcAngles`）。
 */
export interface DesignArc {
  startingAngle: number
  endingAngle: number
  innerRadius: number
}

/** {@link DesignEngine.nodeProps} 的读面（全部必填，调用方按 type 取用）。 */
export interface DesignNodeRead {
  id: string
  type: string
  name: string
  visible: boolean
  locked: boolean
  x: number
  y: number
  width: number
  height: number
  rotation: number
  fill: string | null
  opacity: number
  cornerRadius: number
  topLeftRadius: number
  topRightRadius: number
  bottomRightRadius: number
  bottomLeftRadius: number
  independentCorners: boolean
  clipsContent: boolean
  blendMode: BlendModeId
  pointCount: number
  starInnerRadius: number
  arc: DesignArc | null
  strokes: DesignStrokeItem[]
  effects: DesignEffectItem[]
  text: string
  fontSize: number
  fontFamily: string
  fontWeight: number
  lineHeight: number | null
  letterSpacing: number
  textAlignHorizontal: TextAlignId
  textAutoResize: TextAutoResizeId
}

/** 页面列表项（页面面板）。 */
export interface DesignPageInfo {
  id: string
  name: string
}

/** 图层树节点（图层面板）：递归 children，展开状态由面板自持。 */
export interface DesignLayerNode {
  id: string
  name: string
  type: string
  visible: boolean
  locked: boolean
  children: DesignLayerNode[]
}

/** {@link DesignEngine.snapshot} 的返回：面板一次渲染要用的全部图状态。 */
export interface DesignSnapshot {
  pages: DesignPageInfo[]
  currentPageId: string
  /** 当前页的子节点树（不是整棵文档树——跨页树没有意义）。 */
  layers: DesignLayerNode[]
  selection: string[]
}

/** Engine creation outcome: an honest error line, or a live engine. */
/**
 * 引擎起不来的收场：`message` 是诊断原文（core 的中文或上游异常），`code` 给客户端
 * 出**界面文案**用（`canvas.design.*`），按码映射、没码就原样显示消息。
 */
export type DesignEngineErrorCode = 'engine-init' | 'not-design' | 'legacy' | 'future' | 'bad-json' | 'bad-snapshot' | 'bad-node'

export type EngineOutcome =
  | { kind: 'error'; message: string; code?: DesignEngineErrorCode; detail?: string }
  | { kind: 'ready'; engine: DesignEngine }

export interface CreateDesignEngineArgs {
  /** The 2D-fallback canvas (also the pre-Skia picture while fonts settle). */
  twoD: HTMLCanvasElement
  /** The GL canvas for the Skia engine; stays invisible until it paints. */
  gl: HTMLCanvasElement
  /** The loaded CanvasKit runtime, or `null` when the WASM assets failed. */
  runtime: CanvasKitRuntime | null
  /** The raw `.design` envelope text (header line + JSON snapshot). */
  envelope: string
  /** Called when async work (font settling) needs one more frame. */
  onRepaint: () => void
}

// ── 导出（F10.1，v1.59） ────────────────────────────────────────────────────

/**
 * 设计稿能导成哪几样。
 *
 * 与 `client/canvas/design-export.ts` 的 `DESIGN_EXPORT_FORMATS` 是**同一张表的两半**：
 * 这里只声明字符串字面量（类型模块必须零依赖），那边拿着它排菜单，判据钉住两者一致。
 * 之所以不放类型表（`core/artifact/kind-registry.ts`）的 `exportFormats`：那一格是给
 * **部署能力**那条线看的，而设计稿的四样出路一个都不在部署上（见 `DESIGN_KINDS`）。
 */
export type DesignExportFormat = 'fig' | 'png' | 'pdf' | 'pptx'

/** 一份产物被导出成的一件东西：文件名 + 字节。 */
export interface DesignExportUnit {
  /**
   * 这一件叫什么（不带扩展名）。图片是**容器名**（`容器 1`）——一张图一个容器，名字由
   * 文档给，不是引擎编的；fig / pptx / 多页 PDF 是一个整体，这里给空串。
   */
  name: string
  bytes: Uint8Array
}

/** 没导成的三种原因。与 `client/canvas/design-export.ts` 的 `DesignRefusal` 是同一份。 */
export type DesignExportRefusal =
  /** `.design` 解不开：v1 旧信封、或内容损坏（见 `decodeDesignFile` 的三条报错）。 */
  | 'broken'
  /** 文档里一个容器都没有——没有可画的东西。 */
  | 'empty'
  /** 取不到渲染引擎（CanvasKit 的资产没到），而这一样出路非要它不可（图片 / PPT）。 */
  | 'no-engine'

/**
 * 一次导出的收场。
 *
 * 与全仓别的收场同一条规矩：**被拒是答案，不是异常**。「文档还没写」「没有容器」这些不是
 * 出错——它们各自有各自的下一步，所以分开说；`error` 只留给引擎真抛了异常。
 *
 * `error` 分支带**码**（`design-failure.ts` 那个类抛出来的四种「画不出来」）：文案由
 * 客户端按码出（`canvas.export.design*`），`unit` 是那个画不出来的容器/页面名；没码的
 * （上游 open-pencil 抛的）`message` 原样透传。
 */
export type DesignExportFailureCode = 'unrenderable' | 'no-pages' | 'svg-unreadable' | 'cjk-font-missing'

export type DesignExportOutcome =
  | { kind: 'done'; units: DesignExportUnit[] }
  | { kind: 'refused'; reason: DesignExportRefusal }
  | { kind: 'error'; message: string; code?: DesignExportFailureCode; unit?: string }

export interface DesignExportRequest {
  /** 原始的 `.design` 信封文本（头一行 + JSON 快照）。 */
  envelope: string
  format: DesignExportFormat
  /** 位图的倍率（逻辑像素 → 像素）。默认 2。 */
  scale?: number
  /** 给 PDF 用的文档标题（元信息里那一个）。 */
  title?: string
}
