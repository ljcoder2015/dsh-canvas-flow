/**
 * dsh-canvas — 设计预览器（F2.6；P4 编辑闭环，P4.5 双模式 + 编辑面板）。
 *
 * 右上角「预览 / 编辑」模式切换：
 * - 预览模式：只有视口手势（拖拽平移 / 滚轮缩放 / WASD·QE）与 HUD，无选中
 *   高亮、无面板——交付查看的干净画面。
 * - 编辑模式：左右两栏面板（React 改写自 @open-pencil/vue 的 pages/layers/
 *   properties 三块 UI，见 design-panels.tsx），画布交互（点选/拖移/删除/undo/选中框
 *   缩放旋转）照旧；顶部中间那条 dock 收着撤销/重做（画布之外没有 ⌘Z 可发现的地方）与单选/多选
 *   开关——**两边的点选口径都由它定**，见 `selectLayer`。改稿经 `bridge.writeText`
 *   写回 `.design` 文件。
 *
 * 视口住在 ref 里（拖拽直接改、直接重画，不付 React 渲染）；「用户动过没有」
 * 这一位决定面板尺寸变化后要不要重新 zoom-to-fit。选中、模式与面板数据是
 * React 状态——它们的变更频率是「一次手势」，不是「一帧」。
 *
 * 写回节律沿用 `editing/autosave.ts` 的停手期时钟：改稿序列化成信封文本，
 * 停手 800ms 后落盘；写成功后回读 adopt——**自己写的回声**（view.text ===
 * 刚写入的文本）不再重建引擎，选中与镜头都保得住；别人的改动（模型经
 * `canvas_design_edit`）才会触发重建。
 *
 * AI 标签页发出的那一笔改稿是个例外状态：文档接下来的几分钟归会话，这里的每一笔编辑
 * 都是两个人同时写一份文件。所以起手就把那几个图层圈住（流光扫过被改的那一块）并锁上
 * 编辑——点选、拖移、删除、undo 与面板控件一律不作数，平移缩放照旧（那只是看）。解锁
 * 有两把钥匙：回读到产物真的变了（并把新产物 adopt 进来），或者兜底时限到点。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { ViewerProps, ViewerRegistration } from '../types.ts'
import { useChrome, Slot, useEscapeSink } from '../../chrome.tsx'
import { autosaveDelay, autosaveRetryDelay } from '../../editing/autosave.ts'
import { loadCanvasKit } from './design-canvaskit.ts'
import { loadDesignEngine } from './design-engine-module.ts'
import { DESIGN_SIDE_CLASS, DesignSidePanels, FrameIcon } from './design-panels.tsx'
import type { DesignSelectMode } from './design-panels.tsx'
import type {
  DesignEngine,
  DesignGeometry,
  DesignHistoryState,
  DesignLayerNode,
  DesignSnapshot,
  DesignViewport,
  EngineOutcome,
} from './design-engine-types.ts'
import type { CanvasKey } from '../../../ui/locales.ts'

/** The viewer's honest states: engine loading, failed, live. */
type DesignState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' }

/**
 * 引擎收场里的码 → 界面文案的词典键。
 *
 * 引擎 chunk 不知道界面语言（见 `design-failure.ts`），它只交码；这里按码出这一面用户的
 * 那一句。没在表里的码（或没码的异常）落回引擎给的那条诊断消息。
 */
const ENGINE_ERROR_KEY: Record<string, CanvasKey> = {
  'not-design': 'canvas.design.notDesign',
  legacy: 'canvas.design.legacy',
  future: 'canvas.design.future',
  'bad-json': 'canvas.design.badJson',
  'bad-snapshot': 'canvas.design.badSnapshot',
  'bad-node': 'canvas.design.badNode',
  'engine-init': 'canvas.design.engineInitFailed',
}

/** 引擎的 error 收场 → 眼前那一句：有码按码出（`future` 带上那个文件头），没码透传诊断消息。 */
function engineErrorText(outcome: Extract<EngineOutcome, { kind: 'error' }>, t: (key: CanvasKey, params?: Record<string, string>) => string): string {
  const key = typeof outcome.code === 'string' ? ENGINE_ERROR_KEY[outcome.code] : undefined
  if (key === undefined) return outcome.message
  const detail = typeof outcome.detail === 'string' ? outcome.detail : ''
  return detail === '' ? t(key) : t(key, { detail })
}

/** 右上角的模式开关：预览（纯查看）与编辑（面板 + 画布编辑）。 */
type DesignMode = 'preview' | 'edit'

/** Wheel zoom limits — a zoom-to-fit never needs to leave this band. */
const ZOOM_MIN = 0.05
const ZOOM_MAX = 8

/** 缩放手柄能把节点拖到的下限（世界单位）：零宽高的节点再点不回来，留一线。 */
const MIN_SIZE = 1

/** 改稿落盘前的停手期（复用文本编辑的节律）。 */
const SAVE_SETTLE_MS = 800

/**
 * 一笔改稿最多圈住多久、最多回读几次。
 *
 * 解锁有两把钥匙：改稿真的落地（回读到产物变了），或者跑到头（模型跑完了却没写这个文件）。
 * 两把都要有——只有第一把的话，「没写」的那一笔会把画布锁死在那儿；只有第二把的话，正常
 * 改稿也要等满时限才解锁。
 */
const HOLD_MAX_MS = 3 * 60 * 1000
const HOLD_MAX_READS = 30

/**
 * 一笔改稿圈住的那批图层。
 *
 * `rects` 是**文档坐标**下的绝对矩形（`nodeProps` 给的是相对父级的坐标，起手时沿树累加一
 * 遍祖先偏移）。持有期间文档被锁住不动，所以算一次就够；此后每帧只做「世界→屏幕」那一步，
 * 镜头怎么动都不必重新量。
 */
interface DesignHold {
  ids: string[]
  rects: Map<string, { x: number; y: number; width: number; height: number }>
  /** 起手那一刻的产物文本：回读到与它不同 = 这一笔落地了。 */
  from: string
}

/** 图层树里那几个 id 的绝对矩形（沿树累加祖先偏移；根节点的坐标已经相对页面）。 */
function absoluteRects(
  engine: DesignEngine,
  ids: readonly string[],
): Map<string, { x: number; y: number; width: number; height: number }> {
  const wanted = new Set(ids)
  const rects = new Map<string, { x: number; y: number; width: number; height: number }>()
  const walk = (nodes: readonly DesignLayerNode[], ox: number, oy: number): void => {
    for (const node of nodes) {
      const read = engine.nodeProps(node.id)
      if (read === null) continue
      const x = ox + read.x
      const y = oy + read.y
      if (wanted.has(node.id)) rects.set(node.id, { x, y, width: read.width, height: read.height })
      if (node.children.length > 0) walk(node.children, x, y)
    }
  }
  walk(engine.snapshot().layers, 0, 0)
  return rects
}

/**
 * 图层树摊平成一维——**就是图层面板从上往下读到的那个次序**。
 *
 * 「选中两层之间的图层」这件事需要一个先后，而这个先后只有一处说得清：面板列出来的顺序。
 * 所以这里跟面板的渲染用同一条走法（层序倒序：latter-on-top，顶层在上，见 design-panels 的
 * LayersPanel）。
 *
 * 折叠不参与：折叠状态住在面板内部，两处各算一遍迟早会算出两个答案，而「两层之间」在画布
 * 那条路上本来就无从知道谁被折起来了。于是口径统一为**树本身**——被折起来那一支的子节点
 * 照旧算在里面，画布与面板因此永远给出同一段区间。
 */
function flatLayerIds(nodes: readonly DesignLayerNode[]): string[] {
  const ids: string[] = []
  const walk = (list: readonly DesignLayerNode[]): void => {
    for (const node of [...list].reverse()) {
      ids.push(node.id)
      if (node.children.length > 0) walk(node.children)
    }
  }
  walk(nodes)
  return ids
}

/**
 * 图层树里的容器（画布上要挂名称签的那一批）——沿**区域**下潜，遇到容器就收下。
 *
 * 与渲染器的判据同源（`hasFrameTitle`：父为页面或区域的容器才有标题）：区域是归类容器的
 * 组织层，挂在区域里的容器照样是画布上的一块；而嵌套容器是模块，不挂名字。
 */
function containersUnder(nodes: readonly DesignLayerNode[]): DesignLayerNode[] {
  const containers: DesignLayerNode[] = []
  for (const node of nodes) {
    if (node.type === 'frame') containers.push(node)
    else if (node.type === 'section') containers.push(...containersUnder(node.children))
  }
  return containers
}

/**
 * 设计卡聚焦时**归设计**的键：与背后画布的快捷键（window 级监听）正面相撞的那一批。
 * onKeyDown 里对这些键 stopPropagation——按键已经消化在设计自己的视口手势里，
 * 不许隔着弹窗再把背后的画布推走缩走。
 *
 * Esc 也在这一批里：它退的是这一层的选区（见下面的 onKeyDown），没收住的话背后的画布
 * 也会跟着收一下菜单。**它不再关弹窗**——这一面根本不用 Esc 关窗（`useEscapeSink`）。
 */
const DESIGN_KEYS = new Set([' ', 'w', 'a', 's', 'd', 'q', 'e', 'delete', 'backspace', 'escape'])

/**
 * 选中框上的八枚缩放手柄：位置用手柄在**节点自身坐标系**里的方向表示（两维各取 −1/0/1）。
 *
 * 记方向而不是像素：同一份数据要供两处用——CSS 摆位（`is-nw` 这类类名）与拖动时的锚点
 * （对角那枚 `(−hx, −hy)` 就是不动的那个点）。两处同源，才不会出现「看得见的手柄」和
 * 「算出来的锚点」对不上的情况。
 */
const FRAME_HANDLES: readonly { key: string; hx: number; hy: number }[] = [
  { key: 'nw', hx: -1, hy: -1 },
  { key: 'n', hx: 0, hy: -1 },
  { key: 'ne', hx: 1, hy: -1 },
  { key: 'e', hx: 1, hy: 0 },
  { key: 'se', hx: 1, hy: 1 },
  { key: 's', hx: 0, hy: 1 },
  { key: 'sw', hx: -1, hy: 1 },
  { key: 'w', hx: -1, hy: 0 },
]

/**
 * 一次缩放/旋转拖动**在起手那一刻定下来的全部事实**。
 *
 * 定在起手、拖动中不再重算：支点（中心）与锚点若每帧重算，上一帧刚写进去的新值就会把
 * 它们挪走，于是「越拖越快」这类漂移就会出现。存下来之后，每一帧只做一件事——把指针
 * 位置换算成一份新的几何。
 */
interface TransformGesture {
  kind: 'scale' | 'rotate'
  pointerId: number
  /** 起手时指针在**世界坐标**里的位置。 */
  startX: number
  startY: number
  /** 起手时节点在**父级坐标系**下的几何。 */
  origin: DesignGeometry
  /** 祖先合计旋转（度）——节点自己的 rotation 是相对父级的。 */
  parentRotation: number
  /** 起手时的总旋转角（含祖先，度）。 */
  totalRotation: number
  /** 起手时节点在世界坐标下的中心：旋转的支点，全程不动。 */
  centerX: number
  centerY: number
  /** 缩放：手柄方向（−1/0/1）。 */
  hx: number
  hy: number
  /**
   * 旋转：上一帧指针相对中心的方位角（度）。
   *
   * 存这一帧是为了按「上一帧到这一帧转了多少」逐帧累加，而不是拿当前角减起手角——方位角在
   * ±180° 处会跳一整圈（atan2 的取值域），减出来的差值是 −340° 而不是 +20°，转过去会弹回来。
   */
  lastAngle: number
  /** 旋转：累计转过的度数（逐帧接平之后）。 */
  turned: number
}

/**
 * 撤销 / 重做用的图标：一枚**横向**的回钩箭头（不引图标库，笔画随按钮颜色走 currentColor）。
 *
 * 不用字符 `↶` / `↷`：那两枚是「顶上那半圈」，长相全看字体——落到没有这两码位的字体上就
 * 换一副面孔，还容易被读成竖着的一撇。图形不该看字体脸色，所以画成 SVG；重做就是撤销的
 * 镜像（scaleX(-1)），两枚形状天然配成一对。
 */
function HistoryIcon({ forward }: { forward: boolean }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', transform: forward ? 'scaleX(-1)' : undefined }}
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" />
    </svg>
  )
}

/**
 * 画布顶部中间那条 dock：撤销 / 重做 / 单选 / 多选。
 *
 * 四种按钮的语气**不一样**，这是有意的：
 * - 撤销、重做是**一动就走**的动作（按下去办完事，键面上不留痕迹），所以它们没有持续高亮，
 *   只有按不动的那种灰（没得退/没得进时）。
 * - 单选、多选是**现在在哪一面**，所以走 radio 语义：aria-checked 一直亮着，永远有一枚是
 *   亮的（默认单选）。
 *
 * 撤销/重做在键盘上是同一条路（⌘Z / ⇧⌘Z，见 `stepHistory`）；摆在 dock 上是因为画布之外
 * 没有第二处能让人发现它们。
 */
function DesignDock({
  history,
  canStep,
  selectMode,
  onStep,
  onSelectMode,
}: {
  history: DesignHistoryState
  /** 这一步现在走不走得动（改稿在跑时不作数）。 */
  canStep: boolean
  selectMode: DesignSelectMode
  onStep: (forward: boolean) => void
  onSelectMode: (mode: DesignSelectMode) => void
}): ReactElement {
  return (
    <div className="dsh-canvas-design-dock" role="toolbar" aria-label="编辑工具" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        title="撤销（⌘Z）"
        aria-label="撤销"
        disabled={!canStep || !history.undo}
        onClick={() => onStep(false)}
      >
        <HistoryIcon forward={false} />
      </button>
      <button
        type="button"
        title="重做（⇧⌘Z）"
        aria-label="重做"
        disabled={!canStep || !history.redo}
        onClick={() => onStep(true)}
      >
        <HistoryIcon forward />
      </button>
      <span className="dsh-canvas-design-dock-sep" />
      <div role="radiogroup" aria-label="选择方式" className="dsh-canvas-design-dock-modes">
        <button
          type="button"
          role="radio"
          aria-checked={selectMode === 'single'}
          tabIndex={selectMode === 'single' ? 0 : -1}
          title="单选：点一下换一个图层"
          onClick={() => onSelectMode('single')}
        >
          单选
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={selectMode === 'multi'}
          tabIndex={selectMode === 'multi' ? 0 : -1}
          title="多选：点一下加一个图层；shift 点一下铺满两层之间的图层；AI 框按图层分段记提示词"
          onClick={() => onSelectMode('multi')}
        >
          多选
        </button>
      </div>
    </div>
  )
}

export function DesignViewer({ view }: ViewerProps) {
  const chrome = useChrome()
  const t = chrome.t
  // 设计这一面不用 Esc 关窗（关掉只剩 × 与点遮罩）：垫底收下这一下。
  useEscapeSink()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<DesignState>({ kind: 'loading' })

  // The viewport lives in a ref: pan/zoom mutate it and redraw directly, so a
  // drag never pays a React render per pointer event. `interacted` decides
  // whether a panel resize re-fits or preserves where the user put the camera.
  const viewportRef = useRef<DesignViewport | null>(null)
  const interactedRef = useRef(false)
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  // 节点拖移：与视口平移共用 pointer 流，靠哪个 ref 在场区分。
  const moveRef = useRef<{ pointerId: number; sx: number; sy: number } | null>(null)
  const engineRef = useRef<DesignEngine | null>(null)
  // `draw` re-creates on state change; the engine's repaint callbacks need the
  // latest one without re-subscribing.
  const drawRef = useRef<() => void>(() => {})
  // HUD 缩放百分比走 ref 直写：拖拽/滚轮/快捷键每帧都动视口，不该为改一个
  // 文本付 React 渲染。
  const zoomLabelRef = useRef<HTMLSpanElement | null>(null)
  // 写回：最后同步到盘上的信封文本（识别「自己的回声」）、节流时钟与失败计数。
  const lastSyncedRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const saveFailuresRef = useRef(0)
  const onDirtyRef = useRef<() => void>(() => {})

  // 改稿圈：AI 页把选中的图层交给会话去改，改稿期间那几个图层圈起来、编辑锁上。
  // ref 供手势/键盘即时判断（不付重渲染），state 只驱动那一层方块的挂载。
  const holdRef = useRef<DesignHold | null>(null)
  const [hold, setHold] = useState<DesignHold | null>(null)
  /** 每枚方块按 id 收着，`draw` 里直写位置。 */
  const holdBoxesRef = useRef(new Map<string, HTMLDivElement>())
  const holdTimerRef = useRef<number | null>(null)
  const holdReadsRef = useRef(0)
  const viewTextRef = useRef('')
  viewTextRef.current = view.text

  // 选中、模式与面板版本是 React 状态：变更频率是「一次手势」而非「一帧」。
  const [editVersion, setEditVersion] = useState(0)
  const [mode, setMode] = useState<DesignMode>('preview')
  // 手势/键盘回调里的模式判断走 ref：不必为模式切换重挂监听器。
  const modeRef = useRef<DesignMode>('preview')
  modeRef.current = mode
  // 编辑模式的抓手开关（空格）。ref 供 pointerdown 即时判断，state 只驱动光标。
  const spaceRef = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  // 点选口径（dock 上那对单选/多选）：ref 供 pointerdown 即时判断，state 驱动按钮高亮
  // 与 AI 框那几段标签的写法。
  const [selectMode, setSelectMode] = useState<DesignSelectMode>('single')
  const selectModeRef = useRef<DesignSelectMode>('single')
  selectModeRef.current = selectMode
  // 连续多选的锚点：最后一次**单击**落定的图层。shift 那一路只拿它算区间、不动它，所以连着
  // shift 点几回是在同一个起点的两头伸缩，而不是一段接一段地滚。
  const selectAnchorRef = useRef<string | null>(null)
  // 选中框（缩放/旋转手柄）：面板只决定**有没有**（编辑态 + 单选中），位置每帧由 paintFrame
  // 现取——与改稿圈同一条路（平移/缩放不付 React 渲染，拖动中手柄也照跟）。
  const frameRef = useRef<HTMLDivElement | null>(null)
  const frameIdRef = useRef<string | null>(null)
  // 手上正抓着哪一枚手柄（null = 没抓）。
  const gestureRef = useRef<TransformGesture | null>(null)
  // 容器名称签（Figma 的 frame label）：编辑态每份容器一枚，浮在左上角之外。
  // 方块按 id 收着、位置每帧由 paintLabels 直写（与选中框同一条路）；名字可单击就地改。
  const labelBoxesRef = useRef(new Map<string, HTMLDivElement>())
  const labelIdsRef = useRef<string[]>([])
  const [labelEdit, setLabelEdit] = useState<{ id: string; draft: string } | null>(null)
  // Escape 取消会先卸载 input、再触发一次 blur：用这一位跳过那次提交（否则刚取消就被写回）。
  const labelCancelRef = useRef(false)

  const refreshSelection = useCallback(() => {
    const engine = engineRef.current
    if (engine === null) return
    // 图层面板的高亮跟着选中走——选中变了面板也要重渲染。
    setEditVersion((version) => version + 1)
  }, [])

  /**
   * 收圈：这一笔改稿的事办完了（改完落地、或跑到头没等到），解锁画布、撤下流光。
   *
   * 幂等——`holdRef` 说没有就是没有，所以「落地」与「超时」两把钥匙谁先来都行。
   */
  const endHold = useCallback(() => {
    if (holdRef.current === null) return
    holdRef.current = null
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    holdBoxesRef.current.clear()
    setHold(null)
  }, [])

  /**
   * 起圈：AI 页把一批图层交给会话去改，改稿期间画布只看着。
   *
   * 矩形在这里算一次（文档坐标，见 {@link absoluteRects}）；此后由 `draw` 每帧搬到当前镜头
   * 下——镜头动的时候不该为搬几枚方块付 React 渲染。
   */
  const beginHold = useCallback(
    (ids: readonly string[]) => {
      const engine = engineRef.current
      if (engine === null || ids.length === 0) return
      const rects = absoluteRects(engine, ids)
      if (rects.size === 0) return
      holdRef.current = { ids: [...ids], rects, from: viewTextRef.current }
      holdReadsRef.current = 0
      // 起手先把指针下那一份悬停高亮抹掉：手多半正停在某个图层上，而改稿期间这份高亮
      // 不再更新——留在画面上就是一句过了期的话。
      engine.hover(null)
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null
        endHold()
      }, HOLD_MAX_MS)
      setHold(holdRef.current)
      drawRef.current()
    },
    [endHold],
  )

  /** 模式切换：进预览先清选中（预览画面不带高亮），进编辑交还 React 重渲染。 */
  const switchMode = useCallback(
    (next: DesignMode) => {
      setMode(next)
      // 预览模式没有编辑交互：清悬停、清选中。
      engineRef.current?.hover(null)
      if (next === 'preview') {
        engineRef.current?.select([], false)
        drawRef.current()
      }
      // 焦点交还画布：模式开关长在 header（wrap 之外），点击后焦点留在那个按钮上，
      // 下一按 WASD 既不归设计也不归弹窗正文——把焦点收回 wrap，快捷键立刻归位。
      wrapRef.current?.focus()
    },
    [],
  )

  // (Re)build the engine whenever the payload changes — unless the change is
  // our own write echoed back (见文件头)。 Absent artifacts, truncated
  // envelopes and unloadable chunks are honest error states.
  useEffect(() => {
    if (view.text === lastSyncedRef.current) return
    // 走到这里 = 盘上的文档与我们手上这份不同（自己写的回声在上面那一行就早退了）：这一笔
    // 改稿落地了。收圈——解锁、撤流光，新的引擎接着按新文档重建。
    endHold()
    lastSyncedRef.current = null
    viewportRef.current = null
    interactedRef.current = false
    engineRef.current?.dispose()
    engineRef.current = null
    if (!view.present || view.text === '') {
      setState({
        kind: 'error',
        message: view.present ? t('canvas.design.truncated') : t('canvas.design.empty'),
      })
      return
    }
    setState({ kind: 'loading' })
    let cancelled = false
    void (async () => {
      // Both loads are independent: the WASM runtime and the 2MB engine chunk.
      const [runtime, module] = await Promise.all([loadCanvasKit(), loadDesignEngine()])
      const twoD = canvasRef.current
      const gl = glCanvasRef.current
      const wrap = wrapRef.current
      if (cancelled || module === null || twoD === null || gl === null || wrap === null) {
        if (!cancelled) setState({ kind: 'error', message: t('canvas.design.engineLoadFailed') })
        return
      }
      // Size the GL canvas *before* surface creation — the surface binds to
      // the device-pixel size at birth; the engine re-sizes on later paints.
      const dpr = window.devicePixelRatio || 1
      gl.width = Math.round(wrap.clientWidth * dpr)
      gl.height = Math.round(wrap.clientHeight * dpr)
      const outcome = await module.createDesignEngine({
        twoD,
        gl,
        runtime,
        envelope: view.text,
        onRepaint: () => drawRef.current(),
      })
      if (cancelled) {
        if (outcome.kind === 'ready') outcome.engine.dispose()
        return
      }
      if (outcome.kind === 'error') {
        setState({ kind: 'error', message: engineErrorText(outcome, t) })
        return
      }
      engineRef.current = outcome.engine
      lastSyncedRef.current = view.text
      setState({ kind: 'ready' })
    })()
    return () => {
      cancelled = true
    }
  }, [endHold, view.present, view.text])

  // Release the engine when the viewer goes away.
  useEffect(() => {
    return () => {
      engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [])

  // 挂载即把焦点交给预览画布：键盘的归属由焦点决定（keydown 监听挂在 wrap 上，
  // 焦点不在里面就轮不到它说话，按键会直达 window 被背后的画布收走）。打开预览
  // 就要能直接按 WASD 平移，而不是先点一下画布。preventScroll 避免焦点抢夺
  // 顺手滚动页面。
  useEffect(() => {
    wrapRef.current?.focus({ preventScroll: true })
  }, [])

  /**
   * 把改稿圈的方块搬到当前镜头下的位置（屏幕 = 文档·scale + 视口偏移）。
   *
   * 只在 `draw` 里调：平移/缩放直接改视口、直接重画，不付 React 渲染，所以只有这两个地方
   * 拿得到最新那一份视口。
   */
  const paintHold = useCallback(() => {
    const active = holdRef.current
    const viewport = viewportRef.current
    if (active === null || viewport === null) return
    for (const [id, rect] of active.rects) {
      const box = holdBoxesRef.current.get(id)
      if (box === undefined) continue
      box.style.left = `${rect.x * viewport.scale + viewport.x}px`
      box.style.top = `${rect.y * viewport.scale + viewport.y}px`
      box.style.width = `${rect.width * viewport.scale}px`
      box.style.height = `${rect.height * viewport.scale}px`
    }
  }, [])

  /**
   * 把选中框搬到当前镜头下的位置：框心、尺寸、总旋转角三样都从世界换算到屏幕。
   *
   * 几何**每次现取**（`engine.nodeFrame`）而不是存一份：缩放/旋转拖动中图一直在变，
   * 存下来的那一份只有等 React 重渲染才会更新，手柄就会落在上一帧的位置上。
   *
   * 与 paintHold 一样只在 `draw` 里调：平移/缩放直接改视口、直接重画。
   */
  const paintFrame = useCallback(() => {
    const box = frameRef.current
    const id = frameIdRef.current
    const engine = engineRef.current
    const viewport = viewportRef.current
    if (box === null || id === null || engine === null || viewport === null) return
    const frame = engine.nodeFrame(id)
    if (frame === null) return
    const width = frame.width * viewport.scale
    const height = frame.height * viewport.scale
    box.style.left = `${frame.centerX * viewport.scale + viewport.x - width / 2}px`
    box.style.top = `${frame.centerY * viewport.scale + viewport.y - height / 2}px`
    box.style.width = `${width}px`
    box.style.height = `${height}px`
    // 手柄长在节点自身坐标系里，所以整只盒子跟着总旋转角转——绕的正是它的中心。
    box.style.transform = `rotate(${frame.rotation}deg)`
  }, [])

  /**
   * 选中框的挂载回调：接过 DOM 就补一次位置。
   *
   * 框可能因为「改稿收圈」这类与 editVersion 无关的原因刚出现，那条 effect 不会为它重跑；
   * 引用稳定（依赖只有 paintFrame），所以不会每帧把节点拆了重挂。
   */
  const attachFrame = useCallback(
    (node: HTMLDivElement | null) => {
      frameRef.current = node
      if (node !== null) paintFrame()
    },
    [paintFrame],
  )

  /**
   * 把容器名称签搬到当前镜头下：每份容器取世界变换框，手算**左上角**再换算成屏幕。
   *
   * 左上角 = 框心 + R(θ)·(−半宽, −半高)——容器转了多少度，名字就跟着转到那个角的位。
   * 名字本身在屏幕像素里不随缩放变大（Figma 也这样），所以这里只写 left/top，
   * 「抬到角上方」那条位移交给 CSS（transform: translateY(-100%)）。
   *
   * 与 paintHold / paintFrame 一样只在 `draw` 里调：平移/缩放直接改视口、直接重画。
   */
  const paintLabels = useCallback(() => {
    const engine = engineRef.current
    const viewport = viewportRef.current
    if (engine === null || viewport === null) return
    for (const id of labelIdsRef.current) {
      const box = labelBoxesRef.current.get(id)
      if (box === undefined) continue
      const frame = engine.nodeFrame(id)
      if (frame === null) continue
      const rad = (frame.rotation * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const halfW = frame.width / 2
      const halfH = frame.height / 2
      const left = frame.centerX - cos * halfW + sin * halfH
      const top = frame.centerY - sin * halfW - cos * halfH
      box.style.left = `${left * viewport.scale + viewport.x}px`
      box.style.top = `${top * viewport.scale + viewport.y}px`
    }
  }, [])

  /**
   * 名称签的挂载回调：接过 DOM 就补一次位置（与 attachFrame 同理——签可能因为
   * 「切页 / 收圈」这类与 editVersion 无关的原因刚出现，那条 effect 不会为它重跑）。
   */
  const attachLabel = useCallback(
    (id: string, node: HTMLDivElement | null) => {
      if (node === null) labelBoxesRef.current.delete(id)
      else {
        labelBoxesRef.current.set(id, node)
        paintLabels()
      }
    },
    [paintLabels],
  )

  /** 就地改名：空名或没变就不写，其余走 updateProps（进 undo）再交给落盘时钟。 */
  const renameContainer = useCallback((id: string, name: string) => {
    setLabelEdit(null)
    wrapRef.current?.focus({ preventScroll: true })
    const engine = engineRef.current
    if (engine === null) return
    const trimmed = name.trim()
    if (trimmed === '' || trimmed === engine.nodeProps(id)?.name) return
    engine.updateProps(id, { name: trimmed })
    onDirtyRef.current()
  }, [])

  const draw = useCallback(() => {
    const engine = engineRef.current
    const wrap = wrapRef.current
    if (engine === null || wrap === null) return
    const width = wrap.clientWidth
    const height = wrap.clientHeight
    const dpr = window.devicePixelRatio || 1
    if (width === 0 || height === 0) return
    // Never fitted, or the user has not taken the camera yet (a resize should
    // keep the document framed): zoom-to-fit.
    if (viewportRef.current === null || !interactedRef.current) {
      viewportRef.current = engine.fit(width, height)
    }
    engine.render(viewportRef.current, width, height, dpr)
    paintHold()
    paintFrame()
    paintLabels()
    const label = zoomLabelRef.current
    if (label !== null) label.textContent = `${Math.round(viewportRef.current.scale * 100)}%`
  }, [paintHold, paintFrame, paintLabels])
  drawRef.current = draw

  // 方块是 React 挂的、位置是命令式写的（见 paintHold）：挂载后补一次，第一帧就落在对的地方。
  useEffect(() => {
    paintHold()
  }, [hold, mode, paintHold])

  // 选中框同理：选中变了（bump 版本号）或进出编辑态时，手柄是这一刻才挂上的，补一次位置。
  useEffect(() => {
    paintFrame()
  }, [editVersion, mode, paintFrame])

  const flushSave = useCallback(async (): Promise<void> => {
    const engine = engineRef.current
    if (engine === null) return
    const envelope = engine.serialize()
    try {
      await chrome.bridge.writeText(chrome.projectId, chrome.cardId, envelope)
      saveFailuresRef.current = 0
      const payload = await chrome.bridge.readArtifact(chrome.projectId, chrome.cardId)
      // 回读先于 adopt 记下同步点：adopt 触发的 view.text 更新会命中 build
      // effect 的「自己的回声」早退，引擎与选中都原地保住。
      lastSyncedRef.current = payload.text
      chrome.adopt(payload)
      chrome.saved()
    } catch {
      // 写被拒：按退避重试（复用文本编辑的时钟），失败计数驱动间隔。
      saveFailuresRef.current += 1
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null
        void flushSave()
      }, autosaveRetryDelay(saveFailuresRef.current))
    }
  }, [chrome])

  // 改稿 → 停手期落盘。挂在 ref 上：headless editor 的 history:changed 回调
  // 只注册一次，但永远调到最新一份（draw/flushSave 都是后定义的闭包）。
  onDirtyRef.current = () => {
    if (saveTimerRef.current === null) {
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null
        void flushSave()
      }, autosaveDelay(0, SAVE_SETTLE_MS))
    }
    draw()
    refreshSelection()
    setEditVersion((version) => version + 1)
  }

  // 引擎就绪后订阅 headless editor 的历史变更：undo/redo/命令提交都从这走。
  useEffect(() => {
    const engine = engineRef.current
    if (engine === null || state.kind !== 'ready') return
    return engine.onDirty(() => onDirtyRef.current())
  }, [state])

  /** 视口中心（HUD 按钮、Q/E 快捷键的缩放锚点）。 */
  const viewCenter = useCallback(() => {
    const wrap = wrapRef.current
    return wrap === null ? { x: 0, y: 0 } : { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 }
  }, [])

  /** 把缩放调到 `targetScale`，以 (`cx`,`cy`) 为锚——锚点下的世界坐标保持不动。 */
  const zoomAt = useCallback(
    (cx: number, cy: number, targetScale: number) => {
      const viewport = viewportRef.current
      if (viewport === null) return
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, targetScale))
      const applied = next / viewport.scale
      if (applied === 1) return
      viewport.x = cx - (cx - viewport.x) * applied
      viewport.y = cy - (cy - viewport.y) * applied
      viewport.scale = next
      interactedRef.current = true
      draw()
    },
    [draw],
  )

  /** 快速居中：zoom-to-fit 并把镜头决定权交还用户（此后 resize 不再重置）。 */
  const fitView = useCallback(() => {
    const engine = engineRef.current
    const wrap = wrapRef.current
    if (engine === null || wrap === null) return
    viewportRef.current = engine.fit(wrap.clientWidth, wrap.clientHeight)
    interactedRef.current = true
    draw()
  }, [draw])

  /**
   * 退一步 / 进一步。HUD 那两枚按钮与 ⌘Z / ⇧⌘Z 走**同一条路**——不然「点了有用、按了没用」
   * 这种两副面孔迟早会有一边漏掉重画或刷新。
   *
   * 走完补一帧、刷一次版本号：撤销落的是图，画面与图层面板都要跟着回真值。
   */
  const stepHistory = useCallback(
    (forward: boolean) => {
      const engine = engineRef.current
      if (engine === null || holdRef.current !== null) return
      if (forward) engine.redo()
      else engine.undo()
      draw()
      refreshSelection()
    },
    [draw, refreshSelection],
  )

  /**
   * 点选的**唯一入口**：画布上点图层、图层面板上点行，两条路都走这里。
   *
   * 合到一处是因为「选区」只有一份，而两处的动作必须给出同一个结果——谁点谁亮、谁是锚点、
   * 一次点击是换人还是加上一个，只该由顶栏那个单选/多选开关说了算（以前面板按 shift 加选、
   * 画布按模式加选，同一个键在两处两个意思）。shift 从此只有一个含义：**多选模式下的连续
   * 多选**（从锚点铺到刚点的这一层）。
   *
   * `drag` 是画布那条路独有的：点到的图层**已经在选区里**时不动选区——手接下来要拖，拖的
   * 该是这一整批而不是一个（Figma 语义）。面板没有拖这回事，点了就是要选它，不给这个豁免。
   */
  const selectLayer = useCallback(
    (id: string, range: boolean, drag = false): void => {
      const engine = engineRef.current
      if (engine === null || holdRef.current !== null) return
      if (range && selectModeRef.current === 'multi') {
        const anchor = selectAnchorRef.current
        if (anchor !== null && anchor !== id) {
          const flat = flatLayerIds(engine.snapshot().layers)
          const from = flat.indexOf(anchor)
          const to = flat.indexOf(id)
          // 锚点或目标已经不在树里（被删/换了页）就退回普通点击，区间无从算起。
          if (from !== -1 && to !== -1) {
            const [head, tail] = from <= to ? [from, to] : [to, from]
            engine.select(flat.slice(head, tail + 1), false)
            draw()
            refreshSelection()
            return
          }
        }
      }
      if (selectModeRef.current === 'multi') engine.select([id], true)
      else if (!drag || !engine.selection().includes(id)) engine.select([id], false)
      selectAnchorRef.current = id
      draw()
      refreshSelection()
    },
    [draw, refreshSelection],
  )

  /**
   * 起手一次缩放/旋转：把**后续每一帧都要用的量**在指针按下的这一刻全算好。
   *
   * 存下来的是父级角、总角、世界中心（旋转支点）、手柄方向与起手方位角——拖动中一个都不重算。
   * 支点若每帧重算，上一帧刚写进去的新几何就会把它挪走，于是出现「越拖越偏」的漂移。
   *
   * 手柄自己吃下 pointerdown（stopPropagation），所以画布那一层的「点选/拖移」不会同时启动。
   */
  const beginTransform = useCallback(
    (kind: TransformGesture['kind'], hx: number, hy: number, event: React.PointerEvent<HTMLElement>): void => {
      const engine = engineRef.current
      const wrap = wrapRef.current
      const viewport = viewportRef.current
      if (engine === null || wrap === null || viewport === null || viewport.scale <= 0) return
      const id: string | undefined = engine.selection()[0]
      if (id === undefined) return
      const read = engine.nodeProps(id)
      const frame = engine.nodeFrame(id)
      if (read === null || frame === null) return
      const rect = wrap.getBoundingClientRect()
      // 屏幕 → 世界（与 pick 同一条换算）。
      const wx = (event.clientX - rect.left - viewport.x) / viewport.scale
      const wy = (event.clientY - rect.top - viewport.y) / viewport.scale
      engine.beginTransform()
      const startAngle = (Math.atan2(wy - frame.centerY, wx - frame.centerX) * 180) / Math.PI
      gestureRef.current = {
        kind,
        pointerId: event.pointerId,
        startX: wx,
        startY: wy,
        origin: { x: read.x, y: read.y, width: read.width, height: read.height, rotation: read.rotation },
        parentRotation: frame.parentRotation,
        totalRotation: frame.rotation,
        centerX: frame.centerX,
        centerY: frame.centerY,
        hx,
        hy,
        lastAngle: startAngle,
        turned: 0,
      }
      // 捕获挂在手柄上：手滑到画布外面也不丢这一笔（事件照样冒泡回画布那层收尾）。
      event.currentTarget.setPointerCapture(event.pointerId)
      event.stopPropagation()
    },
    [],
  )

  /**
   * 拖动中：把指针位置换算成一份新几何，直接落图。
   *
   * 旋转只有一条式子：把指针相对支点的方位角逐帧累加（见下面的接平那两行），再加到起手时的总角上。
   *
   * 缩放绕了一圈，全是为了**旋转过的节点**：指针的位移量在世界坐标里，而尺寸长在节点自己的
   * 轴向上。所以先把位移反向转掉祖先旋转（回到父级坐标系），再反向转掉自己的旋转（回到
   * 自身坐标系），这时才能读成宽高的变化；算完新尺寸，再把中心从那枚不动的锚点按同样的
   * 两次旋转搬回手柄那一头。
   *
   * `shift` 在两处各有一个意思，都是各家编辑器里同一枚键的老规矩：旋转时吸附 15°，缩放时
   * 四角等比。
   */
  const dragTransform = useCallback(
    (gesture: TransformGesture, clientX: number, clientY: number, shift: boolean): void => {
      const engine = engineRef.current
      const wrap = wrapRef.current
      const viewport = viewportRef.current
      if (engine === null || wrap === null || viewport === null || viewport.scale <= 0) return
      const rect = wrap.getBoundingClientRect()
      const wx = (clientX - rect.left - viewport.x) / viewport.scale
      const wy = (clientY - rect.top - viewport.y) / viewport.scale
      const { origin } = gesture
      if (gesture.kind === 'rotate') {
        const angle = (Math.atan2(wy - gesture.centerY, wx - gesture.centerX) * 180) / Math.PI
        // 逐帧累加「这一帧转了多少」（并把跨越 ±180° 的那一跳接平），而不是减起手角——
        // 否则转过半圈之后方位角绕回来，差值的符号会让节点弹回去。
        let delta = angle - gesture.lastAngle
        if (delta > 180) delta -= 360
        else if (delta < -180) delta += 360
        gesture.lastAngle = angle
        gesture.turned += delta
        let total = gesture.totalRotation + gesture.turned
        // shift 吸附 15°：90° 这种整角不该靠手感去凑。
        if (shift) total = Math.round(total / 15) * 15
        // 写回去的是**相对父级**的角，所以减掉祖先那一份。
        engine.applyTransform({ ...origin, rotation: total - gesture.parentRotation })
        draw()
        return
      }
      const self = (origin.rotation * Math.PI) / 180
      const outer = (gesture.parentRotation * Math.PI) / 180
      const cosOuter = Math.cos(outer)
      const sinOuter = Math.sin(outer)
      const cosSelf = Math.cos(self)
      const sinSelf = Math.sin(self)
      const dx = wx - gesture.startX
      const dy = wy - gesture.startY
      // 世界位移 → 父级坐标系位移（反向转掉祖先旋转）。
      const pdx = dx * cosOuter + dy * sinOuter
      const pdy = -dx * sinOuter + dy * cosOuter
      const halfW = origin.width / 2
      const halfH = origin.height / 2
      // 起手那一刻手柄落在父级坐标系的哪儿（中心 + R(自身角)·(hx·w/2, hy·h/2)）。
      const handleX = origin.x + halfW + cosSelf * gesture.hx * halfW - sinSelf * gesture.hy * halfH
      const handleY = origin.y + halfH + sinSelf * gesture.hx * halfW + cosSelf * gesture.hy * halfH
      // 不动的锚点：对角那枚手柄起手时的位置（同一个式子，符号反过来）。
      const anchorX = origin.x + halfW - cosSelf * gesture.hx * halfW + sinSelf * gesture.hy * halfH
      const anchorY = origin.y + halfH - sinSelf * gesture.hx * halfW - cosSelf * gesture.hy * halfH
      // 指针（父级坐标系）相对锚点的位移，转进自身坐标系就是宽高的变化。
      const vx = handleX + pdx - anchorX
      const vy = handleY + pdy - anchorY
      const localX = vx * cosSelf + vy * sinSelf
      const localY = -vx * sinSelf + vy * cosSelf
      // 只有纯横向/纵向那两枚保留原尺寸；乘回符号是为了「往手柄那一侧拖才是变大」。
      let width = gesture.hx === 0 ? origin.width : Math.max(localX * gesture.hx, MIN_SIZE)
      let height = gesture.hy === 0 ? origin.height : Math.max(localY * gesture.hy, MIN_SIZE)
      // shift 等比：两轴取变化更大的那一份比例，另一轴按原长宽比跟上。只对四角的手柄成立——
      // 边上的手柄本就只动一轴，等比无从谈起。等比仍绕那枚不动的锚点，所以下面两行不用改。
      if (shift && gesture.hx !== 0 && gesture.hy !== 0 && origin.width > 0 && origin.height > 0) {
        const ratio = Math.max(width / origin.width, height / origin.height)
        width = origin.width * ratio
        height = origin.height * ratio
      }
      // 新中心：从锚点往手柄那一头搬半个新身位（还是那两次旋转）。
      const centerX = anchorX + cosSelf * gesture.hx * (width / 2) - sinSelf * gesture.hy * (height / 2)
      const centerY = anchorY + sinSelf * gesture.hx * (width / 2) + cosSelf * gesture.hy * (height / 2)
      engine.applyTransform({ x: centerX - width / 2, y: centerY - height / 2, width, height, rotation: origin.rotation })
      draw()
    },
    [draw],
  )

  // First frame + redraw on size changes; the wrapper, not the canvas, carries
  // the layout.
  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === undefined || wrap === null) return
    draw()
    const observer = new ResizeObserver(() => draw())
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [state, draw])

  // 指针三态：预览模式按住即平移；编辑模式鼠标默认是「选元素」——按住空格才
  // 变抓手平移（Figma 语义），打空且没按空格 = 取消选中，不拖动画布。两种
  // 手势共用 pointer capture，光标离面板也不丢。
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || engineRef.current === null) return
      const engine = engineRef.current
      const wrap = wrapRef.current
      if (wrap === null) return
      engine.hover(null)
      const rect = wrap.getBoundingClientRect()
      const sx = event.clientX - rect.left
      const sy = event.clientY - rect.top
      const viewport = viewportRef.current
      // 编辑模式 + 空格按住 → 跳过选择逻辑，直接进入平移。
      const panning = modeRef.current === 'preview' || spaceRef.current
      if (!panning && modeRef.current === 'edit' && viewport !== null) {
        // 改稿在跑：画布只看着——不点选、不拖移（平移仍归空格那一路，平移不是编辑）。
        if (holdRef.current !== null) return
        const hit = engine.pick(sx, sy, viewport)
        if (hit !== null) {
          // 点谁、加不加、shift 是不是铺一段——全归 selectLayer 一个口径（与图层面板同一份）。
          selectLayer(hit, event.shiftKey, true)
          engine.beginMove()
          event.currentTarget.setPointerCapture(event.pointerId)
          moveRef.current = { pointerId: event.pointerId, sx, sy }
          event.currentTarget.classList.add('is-panning')
          draw()
          refreshSelection()
          return
        }
        // 打空：清掉选区，锚点一并清——不然下一次 shift 会从一段已经不亮的旧选区上铺开。
        if (!event.shiftKey) {
          selectAnchorRef.current = null
          engine.select([], false)
          draw()
          refreshSelection()
        }
        // 编辑模式打空：只取消选中，不拖画布。
        return
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      event.currentTarget.classList.add('is-panning')
    },
    [draw, refreshSelection, selectLayer],
  )
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current
      if (wrap === null) return
      // 手上抓着缩放手柄：这一条路优先于拖移与悬停（手柄自己捕获了指针）。
      const gesture = gestureRef.current
      if (gesture !== null && gesture.pointerId === event.pointerId) {
        dragTransform(gesture, event.clientX, event.clientY, event.shiftKey)
        return
      }
      const move = moveRef.current
      if (move !== null && move.pointerId === event.pointerId) {
        const engine = engineRef.current
        const viewport = viewportRef.current
        if (engine === null || viewport === null || viewport.scale <= 0) return
        const rect = wrap.getBoundingClientRect()
        // 拖移量换算成世界单位；节点 x/y 相对父级，父级不动时 Δ世界 = Δ相对。
        engine.nudgeSelection(
          (event.clientX - rect.left - move.sx) / viewport.scale,
          (event.clientY - rect.top - move.sy) / viewport.scale,
        )
        draw()
        return
      }
      const drag = dragRef.current
      const viewport = viewportRef.current
      // 编辑模式悬停高亮（无按键按下时）：跟随指针 pick 最深可选中节点
      // （hitTestDeep，含子图层），hover 变化引擎内部自查、只重画一次。
      // 改稿在跑时这份高亮也停：画布既然不接编辑，「将被选中」就成了空头支票。
      if (
        modeRef.current === 'edit' &&
        holdRef.current === null &&
        gestureRef.current === null &&
        moveRef.current === null &&
        dragRef.current === null &&
        !spaceRef.current
      ) {
        const engine = engineRef.current
        if (engine !== null && viewport !== null) {
          const rect = wrap.getBoundingClientRect()
          engine.hover(engine.pick(event.clientX - rect.left, event.clientY - rect.top, viewport))
        }
      }
      if (drag === null || viewport === null || drag.pointerId !== event.pointerId) return
      viewport.x += event.clientX - drag.x
      viewport.y += event.clientY - drag.y
      drag.x = event.clientX
      drag.y = event.clientY
      interactedRef.current = true
      draw()
    },
    [dragTransform, draw],
  )
  const endPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // 收手一次缩放/旋转：有真变化才由引擎压一条 undo（与拖移同一条规矩）。
      const gesture = gestureRef.current
      if (gesture !== null && gesture.pointerId === event.pointerId) {
        gestureRef.current = null
        engineRef.current?.endTransform()
        engineRef.current?.hover(null)
        draw()
        return
      }
      const move = moveRef.current
      if (move !== null && move.pointerId === event.pointerId) {
        moveRef.current = null
        event.currentTarget.classList.remove('is-panning')
        // 原地点击（没真拖动）时 endMove 内部不压 undo。
        engineRef.current?.endMove()
        engineRef.current?.hover(null)
        draw()
        return
      }
      if (dragRef.current?.pointerId !== event.pointerId) return
      dragRef.current = null
      event.currentTarget.classList.remove('is-panning')
    },
    [draw],
  )

  // Wheel zooms around the cursor. Native listener, `passive: false` — React's
  // onWheel cannot preventDefault reliably, and a preview must not scroll the
  // page under the user's fingers.
  //
  // 但滚轮落在左右侧栏上时**原样放过**：图层树与属性表自己就是滚动容器，这一滚
  // 是给那份列表的。放过＝不 preventDefault（默认动作被拦，列表就再也滚不动
  // 了）也不缩放。判断只能做在这一层：原生监听挂在 wrap 上，事件先流经它再走到
  // React 根，面板里 React 的 stopPropagation 拦不住自己上方的原生监听。
  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null) return
    const onWheel = (event: WheelEvent) => {
      const viewport = viewportRef.current
      if (viewport === null || engineRef.current === null) return
      if (event.target instanceof Element && event.target.closest(`.${DESIGN_SIDE_CLASS}`) !== null) return
      event.preventDefault()
      const rect = wrap.getBoundingClientRect()
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, viewport.scale * Math.exp(-event.deltaY * 0.0015))
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // 键盘（跟画布聚焦走，监听挂在画布元素上——画布上可能同时亮着多张设计卡）：
  // WASD 连续平移（rAF 循环）、Q/E 离散缩放、Delete 删除、Esc 取消选中、
  // ⌘/Ctrl+Z（+Shift）撤销/重做。
  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null || state.kind !== 'ready') return
    const held = new Set<string>()
    let raf = 0
    let last = 0
    /** 平移速度：css 像素/秒——按住一秒横穿半个面板的手感。 */
    const PAN_SPEED = 480
    const ZOOM_STEP = 1.25
    const step = (now: number) => {
      const viewport = viewportRef.current
      if (viewport === null || held.size === 0) {
        raf = 0
        return
      }
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      let dx = 0
      let dy = 0
      if (held.has('a')) dx -= 1
      if (held.has('d')) dx += 1
      if (held.has('w')) dy -= 1
      if (held.has('s')) dy += 1
      viewport.x += dx * PAN_SPEED * dt
      viewport.y += dy * PAN_SPEED * dt
      interactedRef.current = true
      draw()
      raf = requestAnimationFrame(step)
    }
    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()
      // 归设计的键拦在冒泡路上：设计卡聚焦时，画布那套 window 级 WASD/QE/空格
      // 监听不能隔着弹窗再收一遍（否则按住 W，背后的画布跟着平移）。Esc 一并收住——
      // 它退的是下面那一下「清选区」，不再往上传（这一面不用 Esc 关弹窗）。
      if (!event.ctrlKey && !event.metaKey && !event.altKey && DESIGN_KEYS.has(key)) {
        event.stopPropagation()
      }
      // 编辑类快捷键（undo/删除/Esc）只在编辑模式生效，而且改稿在跑时一律不作数——
      // 那几笔都要动这个文档，而文档正握在会话手里（视口手势不受影响，那只是看）。
      const editing = modeRef.current === 'edit' && holdRef.current === null
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        if (editing && key === 'z') {
          event.preventDefault()
          stepHistory(event.shiftKey)
        }
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // 空格 = 编辑模式的抓手：按下即把下一笔 pointerdown 判成平移。
      // preventDefault 挡掉长画布滚动的默认行为。
      if (key === ' ') {
        event.preventDefault()
        if (!spaceRef.current) {
          spaceRef.current = true
          setSpaceHeld(true)
        }
        return
      }
      if (key === 'q' || key === 'e') {
        event.preventDefault()
        if (event.repeat) return
        const center = viewCenter()
        zoomAt(center.x, center.y, (viewportRef.current?.scale ?? 1) * (key === 'e' ? ZOOM_STEP : 1 / ZOOM_STEP))
        return
      }
      if (editing && (key === 'delete' || key === 'backspace')) {
        event.preventDefault()
        engineRef.current?.deleteSelection()
        return
      }
      if (editing && key === 'escape') {
        engineRef.current?.select([], false)
        draw()
        refreshSelection()
        return
      }
      if (!'wasd'.includes(key) || key === '') return
      event.preventDefault()
      held.add(key)
      if (raf === 0) {
        last = performance.now()
        raf = requestAnimationFrame(step)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        spaceRef.current = false
        setSpaceHeld(false)
        return
      }
      held.delete(event.key.toLowerCase())
    }
    const onBlur = () => {
      held.clear()
      // 抓手键也得跟着清——不然焦点走后 spaceRef 卡在按住态。
      spaceRef.current = false
      setSpaceHeld(false)
    }
    wrap.addEventListener('keydown', onKeyDown)
    wrap.addEventListener('keyup', onKeyUp)
    wrap.addEventListener('blur', onBlur)
    return () => {
      wrap.removeEventListener('keydown', onKeyDown)
      wrap.removeEventListener('keyup', onKeyUp)
      wrap.removeEventListener('blur', onBlur)
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [state, draw, zoomAt, viewCenter, refreshSelection, stepHistory])

  /**
   * 改稿落地就收圈。
   *
   * 触发源是会话域的变动计数（与元素选择同一条路）：会话每动一步回读一次产物，读到文本与
   * 起手那一刻不同，就说明模型写完了——收圈，并把新产物 adopt 进来（引擎随之重建，画面上
   * 是改完的样子）。上限兜住「跑完了却没写这个文件」：那时再读下去只是白读。
   */
  useEffect(() => {
    if (hold === null || chrome.revision === undefined || holdReadsRef.current >= HOLD_MAX_READS) return
    holdReadsRef.current += 1
    let cancelled = false
    void chrome.bridge
      .readArtifact(chrome.projectId, chrome.cardId)
      .then((payload) => {
        if (cancelled || holdRef.current === null || payload.text === hold.from) return
        endHold()
        chrome.adopt(payload)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [chrome, endHold, hold])

  // 卸载时收掉挂着的落盘时钟与改稿的兜底时钟。
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current)
    }
  }, [])

  const engine = engineRef.current
  // 面板数据是「拉」的：每次 React 渲染时从引擎现取快照（图小，不贵），
  // 变更由 onDirty / refreshSelection 的 editVersion bump 驱动重渲染。
  const snapshot: DesignSnapshot | null =
    state.kind === 'ready' && engine !== null && mode === 'edit' ? engine.snapshot() : null
  // 撤销/重做的可用态走同一条「拉」的路：onDirty 里每次 history:changed 都会 bump，所以
  // 这里现取的那份不会过期。
  const history: DesignHistoryState =
    state.kind === 'ready' && engine !== null ? engine.history() : { undo: false, redo: false }
  // 改稿在跑时编辑一律不作数（见 beginHold）：两枚按钮也就没有一步可走。
  const canStep = hold === null && mode === 'edit'
  // 选中框的归属：编辑态、单选中、且没有改稿在跑。几何不进 React（每帧由 paintFrame 现取），
  // 这里只把「框住谁」写进 ref——换人时那层 DOM 重挂，paintFrame 的 effect 随后补一次位置。
  const frameId: string | null =
    snapshot !== null && hold === null && snapshot.selection.length === 1 ? snapshot.selection[0] : null
  frameIdRef.current = frameId
  // 名称签只认容器：画布上「有名字的那一层」就是容器这一种，区域的名字由渲染器自己
  // 画在左上角（`drawSectionTitles`）。所以这里沿区域下潜把容器挑出来——区域是归类容器
  // 的组织层，挂在区域里的容器照样要有签；遇到容器就收下，嵌套容器（模块）不挂签。
  // id 写进 ref 供 paintLabels 每帧现取；再摊成一个字符串当 effect 的依赖——数组每渲染
  // 都是新引用，写进依赖会每帧重跑。
  const containers: readonly DesignLayerNode[] = snapshot === null ? [] : containersUnder(snapshot.layers)
  labelIdsRef.current = containers.map((board) => board.id)
  const labelKey = labelIdsRef.current.join(',')
  // 签是 React 挂的、位置是命令式写的（见 paintLabels）：切页 / 进出编辑态让这一层重挂后补一次。
  useEffect(() => {
    paintLabels()
  }, [labelKey, mode, paintLabels])

  return (
    <>
      {/* 模式开关长在弹窗 header（× 左侧）。**必须挂在画布 wrap 之外**：Slot 的
          内容沿 React 树冒泡，会吃到 wrap 的 onPointerDown——画布一
          setPointerCapture，click 就落在捕获元素上，按钮永远收不到点击。 */}
      {state.kind === 'ready' ? (
        <Slot at="header">
          {/* 与 markdown 编辑面同一副开关（dsh-canvas-modeswitch）：radio 语义，
              aria-checked 直接说明「现在在哪一面」。 */}
          <div className="dsh-canvas-modeswitch" role="radiogroup" aria-label="设计预览模式">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'preview'}
              tabIndex={mode === 'preview' ? 0 : -1}
              className="dsh-canvas-modeswitch-opt"
              title="预览模式：查看画面，快捷键平移缩放"
              onClick={() => switchMode('preview')}
            >
              预览
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'edit'}
              tabIndex={mode === 'edit' ? 0 : -1}
              className="dsh-canvas-modeswitch-opt"
              title="编辑模式：页面 / 图层 / 属性面板，画布点选拖移"
              onClick={() => switchMode('edit')}
            >
              编辑
            </button>
          </div>
        </Slot>
      ) : null}
      <div
        ref={wrapRef}
        className={`dsh-canvas-design${mode === 'edit' ? ' is-editing' : ''}${mode === 'edit' && spaceHeld ? ' is-space' : ''}`}
        tabIndex={0}
        onPointerDown={(event) => {
          // 键盘快捷键（WASD/QE）跟聚焦走：点一下画布就把焦点拿到手。
          event.currentTarget.focus()
          onPointerDown(event)
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => engineRef.current?.hover(null)}
      >
        <canvas ref={canvasRef} />
        {/* The GL canvas mounts with the doc (the Skia surface needs the element),
            but stays invisible until the engine flips it on after first paint. */}
        <canvas ref={glCanvasRef} style={{ visibility: 'hidden' }} />
        {/* 改稿圈：被改的那几个图层各一枚方块，流光扫的就是它们（位置由 draw 直写）。
            只在编辑态画——预览是交付给外人看的干净画面，不该带运行中的痕迹。 */}
        {hold !== null && mode === 'edit' ? (
          <div className="dsh-canvas-design-hold" aria-hidden="true">
            {hold.ids.map((id) => (
              <div
                key={id}
                className="dsh-canvas-design-hold-box"
                ref={(node) => {
                  if (node === null) holdBoxesRef.current.delete(id)
                  else holdBoxesRef.current.set(id, node)
                }}
              >
                <span className="dsh-canvas-shimmer" />
              </div>
            ))}
          </div>
        ) : null}
        {/* 选中框（编辑态单选中）：八枚缩放手柄 + 顶边正中那枚旋转手柄。框体只定位不吃指针
            （手柄才吃），位置与旋转角由 paintFrame 每帧直写——缩放/旋转拖动中不付 React 渲染。 */}
        {frameId !== null ? (
          <div
            className="dsh-canvas-design-frame"
            aria-hidden="true"
            ref={attachFrame}
          >
            {FRAME_HANDLES.map((handle) => (
              <span
                key={handle.key}
                className={`dsh-canvas-design-handle is-${handle.key}`}
                // 只有四角的手柄有「等比」这回事（边上的只动一轴），提示词也就只在那四枚上提。
                title={handle.hx !== 0 && handle.hy !== 0 ? '拖动缩放（shift 等比）' : '拖动缩放'}
                onPointerDown={(event) => beginTransform('scale', handle.hx, handle.hy, event)}
              />
            ))}
            <span className="dsh-canvas-design-rotate-arm" />
            <span
              className="dsh-canvas-design-rotate"
              title="拖动旋转（shift 吸附 15°）"
              onPointerDown={(event) => beginTransform('rotate', 0, 0, event)}
            />
          </div>
        ) : null}
        {/* 容器名称签（Figma 的 frame label）：每份容器一枚浮在左上角之外，位置由 paintLabels
            直写。改稿在跑时降下存在感且不吃指针——那时文档归会话。 */}
        {containers.length > 0 ? (
          <div className={`dsh-canvas-design-labels${hold !== null ? ' is-locked' : ''}`}>
            {containers.map((container) => {
              const editing = labelEdit !== null && labelEdit.id === container.id
              const active = snapshot !== null && snapshot.selection.includes(container.id)
              return (
                <div
                  key={container.id}
                  className={`dsh-canvas-design-label${active ? ' is-active' : ''}`}
                  ref={(node) => attachLabel(container.id, node)}
                >
                  {editing ? (
                    <input
                      className="dsh-canvas-design-label-input"
                      autoFocus
                      value={labelEdit.draft}
                      // 宽度跟着字数走：名字长短差很多，定宽不是截断就是空一大截。
                      style={{ width: `${Math.min(220, Math.max(64, labelEdit.draft.length * 8 + 20))}px` }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onChange={(event) => setLabelEdit({ id: container.id, draft: event.target.value })}
                      onBlur={(event) => {
                        // Escape 取消时先卸载 input、再补一次 blur：这一位在场就跳过提交。
                        if (labelCancelRef.current) {
                          labelCancelRef.current = false
                          return
                        }
                        renameContainer(container.id, event.target.value)
                      }}
                      onKeyDown={(event) => {
                        // Enter 收敛成「失焦」这一条提交路径；Escape 置标记后直接撤下输入框。
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          event.currentTarget.blur()
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          labelCancelRef.current = true
                          setLabelEdit(null)
                          wrapRef.current?.focus({ preventScroll: true })
                        }
                        event.stopPropagation()
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="dsh-canvas-design-label-name"
                      title="单击修改名称"
                      // 别让这一下漏到 wrap 的 onPointerDown 上（那会顺手清掉选区）。
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => setLabelEdit({ id: container.id, draft: container.name })}
                    >
                      {/* 名称签只有容器一种，图标固定是 frame 的 `#`——不按类型分支。 */}
                      <FrameIcon />
                      <span>{container.name === '' ? '容器' : container.name}</span>
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ) : null}
        {snapshot !== null && engine !== null ? (
        <DesignSidePanels
          snapshot={snapshot}
          engine={engine}
          onAction={onDirtyRef.current}
          revision={editVersion}
          locked={hold !== null}
          onHold={beginHold}
          onSelectLayer={selectLayer}
          selectMode={selectMode}
          dock={<DesignDock
            history={history}
            canStep={canStep}
            selectMode={selectMode}
            onStep={stepHistory}
            onSelectMode={setSelectMode}
          />}
        />
      ) : null}
      {state.kind === 'ready' ? (
        <div className="dsh-canvas-design-hud" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" title="缩小" aria-label="缩小" onClick={() => {
            const center = viewCenter()
            zoomAt(center.x, center.y, (viewportRef.current?.scale ?? 1) / 1.25)
          }}>
            −
          </button>
          <button type="button" className="dsh-canvas-design-hud-pct" title="点击回到 100%" onClick={() => {
            const center = viewCenter()
            zoomAt(center.x, center.y, 1)
          }}>
            <span ref={zoomLabelRef}>100%</span>
          </button>
          <button type="button" title="放大" aria-label="放大" onClick={() => {
            const center = viewCenter()
            zoomAt(center.x, center.y, (viewportRef.current?.scale ?? 1) * 1.25)
          }}>
            ＋
          </button>
          <button type="button" title="居中显示全部容器" onClick={fitView}>
            适应
          </button>
          <span className="dsh-canvas-design-hud-hint">
            {mode === 'edit' ? '点选拖移 · 空格+拖动平移 · Q/E 缩放' : 'WASD 平移 · Q/E 缩放'}
          </span>
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <div className="dsh-canvas-design-note">{state.message}</div>
      ) : null}
      </div>
    </>
  )
}

/**
 * 注册项：认领 `design` kind。编辑面长在组件里；外壳（chrome 插槽与协商）
 * 待选择能力稳定后再按 F3.14 的路数挂头部按钮。
 */
export const designViewer: ViewerRegistration = {
  id: 'design',
  component: DesignViewer,
  claims: (kind) => kind === 'design',
}
