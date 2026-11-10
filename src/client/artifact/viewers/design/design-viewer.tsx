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
import type { ReactElement, ReactNode } from 'react'
import type { ViewerProps, ViewerRegistration } from '../types.ts'
import type { BoardSnapshot } from '../../../../types.ts'
import { useChrome, Slot, useEscapeSink } from '../../chrome.tsx'
import { autosaveDelay, autosaveRetryDelay } from '../../editing/autosave.ts'
import { resolveKindId } from '../../../../core/artifact/kind/kind-registry.ts'
import { base64ToBytes } from '../../../../core/artifact/design/image-bytes.ts'
import { mediaMimeOf } from '../../../../core/media/mime.ts'
import { markdownImageSrc } from '../markdown-image.ts'
import type { DesignImageResultWire } from '../../../../contract.ts'
import { loadCanvasKit } from './design-canvaskit.ts'
import { loadDesignEngine } from './design-engine-module.ts'
import {
  fontPercentKnown,
  fontPercentOf,
  fontProgressChanged,
  fontProgressVisible,
  formatBytes,
  type DesignFontProgress,
} from './design-font-progress.ts'
import { createFrameGate, type FrameGate } from './design-frame-gate.ts'
import { designPhaseOf, type DesignPhase } from './design-phase.ts'
import { DESIGN_SIDE_CLASS, DesignSidePanels, FrameIcon, SectionIcon } from './design-panels.tsx'
import type { DesignSelectMode } from './design-panels.tsx'
import type {
  DesignEngine,
  DesignGeometry,
  DesignHistoryState,
  DesignLayerNode,
  DesignShapeRect,
  DesignSnapshot,
  DesignTool,
  DesignViewport,
  EngineOutcome,
} from './design-engine-types.ts'
import type { CanvasKey } from '../../../ui/locales.ts'

/** The viewer's honest states: engine loading, failed, live. */
type DesignState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' }

/** 加载盖板的两段：`engine`（资源在路上，只在第一次付）与 `paint`（首帧还没落屏，每次都付）。 */

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
const DESIGN_KEYS = new Set([' ', 'w', 'a', 's', 'd', 'q', 'e', 'delete', 'backspace', 'escape', 'enter', 'v', 'f', 'r', 'o', 'l', 'p', 't'])

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

/** dock 工具图标：14×14 描边，与 HistoryIcon / ImageIcon 同一套画法。 */
function ToolGlyph({ children }: { children: ReactNode }): ReactElement {
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
      style={{ display: 'block' }}
    >
      {children}
    </svg>
  )
}

/** 移动工具：Figma 那枚斜指针。 */
function MoveIcon(): ReactElement {
  return (
    <ToolGlyph>
      <path d="M5 3.5 18.5 11.2l-6 1.6-2.6 5.7L5 3.5Z" />
    </ToolGlyph>
  )
}

/** 容器/区域两枚走图层面板同一族（FrameIcon / SectionIcon，来自 design-panels）。 */
/** 矩形（也当矩形工具的主脸）。 */
function RectIcon(): ReactElement {
  return (
    <ToolGlyph>
      <rect x="4.5" y="4.5" width="15" height="15" rx="1.5" />
    </ToolGlyph>
  )
}

/** 椭圆。 */
function EllipseIcon(): ReactElement {
  return (
    <ToolGlyph>
      <circle cx="12" cy="12" r="8" />
    </ToolGlyph>
  )
}

/** 直线。 */
function LineIcon(): ReactElement {
  return (
    <ToolGlyph>
      <path d="M5 19 19 5" />
    </ToolGlyph>
  )
}

/** 三角形（多边形笔，POLYGON 默认 3 针）。 */
function PolygonIcon(): ReactElement {
  return (
    <ToolGlyph>
      <path d="M12 4.5 20 19H4L12 4.5Z" />
    </ToolGlyph>
  )
}

/** 星形。 */
function StarIcon(): ReactElement {
  return (
    <ToolGlyph>
      <path d="M12 4 14.2 9.5 20.1 9.9 15.5 13.6 17 19.4 12 16.2 7 19.4 8.5 13.6 3.9 9.9 9.8 9.5Z" />
    </ToolGlyph>
  )
}

/** 图片工具主脸：山与太阳（与图层面板的图片徽标同一族）。 */
function ImageIcon(): ReactElement {
  return (
    <ToolGlyph>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <circle cx="9" cy="9" r="1.8" />
      <path d="m20.5 15.5-3.6-3.6a1.7 1.7 0 0 0-2.4 0L6.5 20" />
    </ToolGlyph>
  )
}

/** 钢笔：斜握的钢笔（笔杆 + 笔尖缝线），不是 nib 那一枚。 */
function PenIcon(): ReactElement {
  return (
    <ToolGlyph>
      <path d="M20.2 3.8a2.05 2.05 0 0 0-2.9 0L4.6 16.5a2 2 0 0 0-.5.9l-1.1 3.6a.5.5 0 0 0 .6.6l3.6-1.1a2 2 0 0 0 .9-.5L20.7 6.7a2.05 2.05 0 0 0-.5-2.9Z" />
      <path d="m14.5 6.5 3 3" />
    </ToolGlyph>
  )
}

/** 文本：一枚 T。 */
function TextIcon(): ReactElement {
  return (
    <ToolGlyph>
      <path d="M5 6h14M12 6v13" />
    </ToolGlyph>
  )
}

/** 下拉小箭头（工具按钮右侧那枚）。 */
function ChevronIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="9"
      height="9"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/**
 * 画布顶部中间那条 dock（v1.99 排成 Figma 的工具条）：撤销 / 重做，然后是一排
 * **笔**——移动（下拉带单选/多选）、容器（下拉带容器/区域）、矩形（下拉带
 * 椭圆/直线/多边形/星形）、钢笔、文本、图片（下拉带 插入文件 / AI 生成 / 引用画布图）。
 *
 * 几组按钮的语气**不一样**，这是有意的：
 * - 撤销、重做是**一动就走**的动作（按下去办完事，键面上不留痕迹），所以它们没有持续
 *   高亮，只有按不动的那种灰（没得退/没得进时）。
 * - 带下拉的工具是**split 按钮**：点主脸 = 直接拿当前那一支笔，点小箭头 = 换同组的另一支
 *   ——换上的那支会把主脸换掉（Figma 的规矩）。
 * - 图片那格不是笔：它的下拉全是「要展开再办事」的入口（生成与引用各自展开一条小面板，
 *   插入直接开文件选择器），三种来源殊途同归——字节交到引擎手里，落成 IMAGE 填充的图层。
 *
 * 撤销/重做在键盘上是同一条路（⌘Z / ⇧⌘Z，见 `stepHistory`）；摆在 dock 上是因为画布之外
 * 没有第二处能让人发现它们。
 */
/** 引用清单里的一张画布图片卡（列清单时按卡片记录裁好的那几格）。 */
interface ReferenceImage {
  cardId: string
  name: string
  file: string
}

/** dock 上能展开下拉的那几枚（其余工具单枚一个、没有同组兄弟）。 */
type DockFlyout = 'frame' | 'rect' | 'image'

/** 形状组各支笔的说法（主脸提示语跟着最后那支换）。 */
const RECT_FACE_LABELS: Record<'rectangle' | 'ellipse' | 'line' | 'polygon' | 'star', string> = {
  rectangle: '矩形',
  ellipse: '椭圆',
  line: '直线',
  polygon: '三角形',
  star: '星形',
}

/** 一枚下拉项：脸 + 说法 + 选中态（工具类项有 radio 语义，入口类项没有）。 */
function FlyoutItem({
  face,
  label,
  hint,
  on,
  checked,
  onPick,
}: {
  face: ReactNode
  label: string
  hint: string
  on: boolean
  /** radio 语义的选中态（undefined = 纯入口项，不标）。 */
  checked?: boolean
  onPick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      className={['dsh-canvas-design-flyout-item', on ? 'is-active' : ''].filter(Boolean).join(' ')}
      role={checked === undefined ? undefined : 'radio'}
      aria-checked={checked}
      title={hint}
      onClick={onPick}
    >
      <span className="dsh-canvas-design-flyout-check" aria-hidden="true">{checked === true ? '✓' : ''}</span>
      <span className="dsh-canvas-design-flyout-face">{face}</span>
      <span>{label}</span>
    </button>
  )
}

function DesignDock({
  history,
  canStep,
  locked,
  tool,
  onTool,
  onStep,
  onInsertFiles,
  onGenerate,
  listReferenceImages,
  onReference,
}: {
  history: DesignHistoryState
  /** 这一步现在走不走得动（改稿在跑时不作数）。 */
  canStep: boolean
  /** 改稿圈在跑（AI 正在写这份文档）：落形与图片都是改稿，一并锁住。 */
  locked: boolean
  /** 手里正握着的笔（engine 的 `tool()` 是同一份的只读镜像）。 */
  tool: DesignTool
  onTool: (tool: DesignTool) => void
  onStep: (forward: boolean) => void
  /** 插入本地图片：返回一句报错，或 `null` = 成功。 */
  onInsertFiles: (files: readonly File[]) => Promise<string | null>
  /** AI 生成一张图并落层：返回一句报错，或 `null` = 成功。 */
  onGenerate: (prompt: string) => Promise<string | null>
  /** 画布上的图片产物清单（引用入口展开时现取）。 */
  listReferenceImages: () => Promise<ReferenceImage[]>
  /** 引用一张画布图片落层：返回一句报错，或 `null` = 成功。 */
  onReference: (file: string) => Promise<string | null>
}): ReactElement {
  const [panel, setPanel] = useState<'none' | 'generate' | 'reference'>('none')
  const [flyout, setFlyout] = useState<DockFlyout | null>(null)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [images, setImages] = useState<ReferenceImage[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // 结果一句话留 6 秒：成功不占地方，失败看得完（比 toast 少一套壳）。
  useEffect(() => {
    if (notice === null) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  // 下拉开着时点外面（画布、侧栏）就收：dock 自己的 pointerdown 有 stopPropagation，
  // 不会漏出去，所以这里用捕获档在 document 上拦。
  useEffect(() => {
    if (flyout === null) return
    const close = (event: PointerEvent): void => {
      if (wrapRef.current?.contains(event.target as Node) !== true) setFlyout(null)
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [flyout])

  /** 一句收场话：报错就留下，成功就收面板。 */
  const settle = (error: string | null): void => {
    setNotice(error)
    if (error === null) {
      setPanel('none')
      setPrompt('')
    }
  }

  const openReference = (): void => {
    setFlyout(null)
    const next = panel === 'reference' ? 'none' : 'reference'
    setPanel(next)
    if (next === 'reference') {
      setImages(null)
      void listReferenceImages()
        .then((list) => setImages(list))
        .catch((error: unknown) => setNotice(error instanceof Error ? error.message : '读画布失败'))
    }
  }

  const submitGenerate = (): void => {
    if (busy || prompt.trim() === '') return
    setBusy(true)
    void onGenerate(prompt)
      .then((error) => settle(error))
      .finally(() => setBusy(false))
  }

  /** 换笔 + 收下拉（split 主脸与下拉项共用的收口）。 */
  const pickTool = (next: DesignTool): void => {
    setFlyout(null)
    onTool(next)
  }

  // 组内主脸**记住最后一次挑的那支**：画完一笔切回移动笔后，主脸不弹回组里第一枚——
  // 用户挑了三角形， dock 上就该一直露着三角形（Figma 的规矩）。手里握着组内某支时
  // 主脸跟它走，离开后停在最后那支上。
  const rectFaces = {
    rectangle: <RectIcon />,
    ellipse: <EllipseIcon />,
    line: <LineIcon />,
    polygon: <PolygonIcon />,
    star: <StarIcon />,
  } as const
  type RectFace = keyof typeof rectFaces
  const [lastShape, setLastShape] = useState<RectFace>('rectangle')
  const [lastFrame, setLastFrame] = useState<'frame' | 'section'>('frame')
  if (tool in rectFaces) setLastShape(tool as RectFace)
  if (tool === 'frame' || tool === 'section') setLastFrame(tool)
  const rectTool: RectFace = tool in rectFaces ? (tool as RectFace) : lastShape
  const frameTool: 'frame' | 'section' = tool === 'section' ? 'section' : tool === 'frame' ? 'frame' : lastFrame

  return (
    <div className="dsh-canvas-design-dock-wrap" ref={wrapRef}>
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
        {/* 移动：单枚笔。点选换人、shift 加选/铺一段、空手拖框选一批——不再分单选/多选两面。 */}
        <button
          type="button"
          className={['dsh-canvas-design-tool-solo', tool === 'move' ? 'is-active' : ''].filter(Boolean).join(' ')}
          title="移动：点选、拖移图层；空手拖一下框选多个（V）"
          aria-label="移动工具"
          aria-pressed={tool === 'move'}
          onClick={() => pickTool('move')}
        >
          <MoveIcon />
        </button>
        {/* 容器组（split）：容器 / 区域。 */}
        <div className={['dsh-canvas-design-tool', tool === 'frame' || tool === 'section' ? 'is-active' : ''].filter(Boolean).join(' ')}>
          <button
            type="button"
            className="dsh-canvas-design-tool-main"
            title={frameTool === 'section' ? '区域：圈一块只管归类的地盘（拖画落形）' : '容器：圈一块裁切子图层的画板（拖画落形，F）'}
            aria-label="容器工具"
            disabled={locked}
            onClick={() => pickTool(frameTool)}
          >
            {frameTool === 'section' ? <SectionIcon /> : <FrameIcon />}
          </button>
          <button
            type="button"
            className="dsh-canvas-design-tool-caret"
            title="容器/区域"
            aria-label="容器工具菜单"
            aria-expanded={flyout === 'frame'}
            disabled={locked}
            onClick={() => setFlyout(flyout === 'frame' ? null : 'frame')}
          >
            <ChevronIcon />
          </button>
          {flyout === 'frame' ? (
            <div className="dsh-canvas-design-flyout" role="radiogroup" aria-label="容器工具">
              <FlyoutItem
                face={<FrameIcon />}
                label="容器"
                hint="圈一块裁切子图层的画板（F）"
                on={tool === 'frame'}
                checked={tool === 'frame'}
                onPick={() => pickTool('frame')}
              />
              <FlyoutItem
                face={<SectionIcon />}
                label="区域"
                hint="圈一块只管归类的地盘，不裁切"
                on={tool === 'section'}
                checked={tool === 'section'}
                onPick={() => pickTool('section')}
              />
            </div>
          ) : null}
        </div>
        {/* 矩形组（split）：矩形 / 椭圆 / 直线 / 多边形 / 星形。 */}
        <div className={['dsh-canvas-design-tool', tool in rectFaces ? 'is-active' : ''].filter(Boolean).join(' ')}>
          <button
            type="button"
            className="dsh-canvas-design-tool-main"
            title={`${RECT_FACE_LABELS[rectTool]}：拖画落形（下拉换椭圆/直线/三角形/星形）`}
            aria-label={`${RECT_FACE_LABELS[rectTool]}工具`}
            disabled={locked}
            onClick={() => pickTool(rectTool)}
          >
            {rectFaces[rectTool]}
          </button>
          <button
            type="button"
            className="dsh-canvas-design-tool-caret"
            title="基本形状"
            aria-label="形状工具菜单"
            aria-expanded={flyout === 'rect'}
            disabled={locked}
            onClick={() => setFlyout(flyout === 'rect' ? null : 'rect')}
          >
            <ChevronIcon />
          </button>
          {flyout === 'rect' ? (
            <div className="dsh-canvas-design-flyout" role="radiogroup" aria-label="形状工具">
              {(['rectangle', 'ellipse', 'line', 'polygon', 'star'] as const).map((shape) => (
                <FlyoutItem
                  key={shape}
                  face={rectFaces[shape]}
                  label={shape === 'rectangle' ? '矩形' : shape === 'ellipse' ? '椭圆' : shape === 'line' ? '直线' : shape === 'polygon' ? '三角形' : '星形'}
                  hint={shape === 'rectangle' ? '拖画落一个矩形（R）' : shape === 'ellipse' ? '拖画落一个椭圆（O）' : shape === 'line' ? '拖画落一条直线（L）' : shape === 'polygon' ? '拖画落一个三角形' : '拖画落一颗星形'}
                  on={tool === shape}
                  checked={tool === shape}
                  onPick={() => pickTool(shape)}
                />
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={['dsh-canvas-design-tool-solo', tool === 'pen' ? 'is-active' : ''].filter(Boolean).join(' ')}
          title="钢笔：点一下加一个顶点，近首点再点一下闭合；双击/回车收笔，Esc 弃笔（P）"
          aria-label="钢笔工具"
          aria-pressed={tool === 'pen'}
          disabled={locked}
          onClick={() => pickTool('pen')}
        >
          <PenIcon />
        </button>
        <button
          type="button"
          className={['dsh-canvas-design-tool-solo', tool === 'text' ? 'is-active' : ''].filter(Boolean).join(' ')}
          title="文本：点一下落一个文本节点，内容在右侧属性面板改（T）"
          aria-label="文本工具"
          aria-pressed={tool === 'text'}
          disabled={locked}
          onClick={() => pickTool('text')}
        >
          <TextIcon />
        </button>
        {/* 图片（纯菜单）：插入本地文件 / AI 生成 / 引用画布图——三入口换掉旧的并排三钮。 */}
        <div className="dsh-canvas-design-tool">
          <button
            type="button"
            className="dsh-canvas-design-tool-main"
            title="图片：插入本地图片、AI 生成或引用画布上的图片产物"
            aria-label="图片工具菜单"
            aria-expanded={flyout === 'image'}
            disabled={locked}
            onClick={() => setFlyout(flyout === 'image' ? null : 'image')}
          >
            <ImageIcon />
            <ChevronIcon />
          </button>
          {flyout === 'image' ? (
            <div className="dsh-canvas-design-flyout" aria-label="图片入口">
              <FlyoutItem
                face={<ImageIcon />}
                label="插入本地图片"
                hint="选本地图片落成图层（可多选）"
                on={false}
                onPick={() => {
                  setFlyout(null)
                  fileInputRef.current?.click()
                }}
              />
              <FlyoutItem
                face={<TextIcon />}
                label="AI 生成"
                hint="写一句提示词，按这张卡的模型配置生成并落成图层"
                on={false}
                onPick={() => {
                  setFlyout(null)
                  setPanel('generate')
                }}
              />
              <FlyoutItem
                face={<FrameIcon />}
                label="引用画布图片"
                hint="把项目里已有的图片产物落成图层"
                on={false}
                onPick={openReference}
              />
            </div>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            if (files.length === 0) return
            setBusy(true)
            void onInsertFiles(files)
              .then((error) => settle(error))
              .finally(() => setBusy(false))
          }}
        />
      </div>
      {panel === 'generate' ? (
        <div className="dsh-canvas-design-dock-panel" onPointerDown={(event) => event.stopPropagation()}>
          <input
            type="text"
            value={prompt}
            autoFocus
            placeholder="描述要生成的图片，例如：扁平风的群山插画，蓝绿色调"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitGenerate()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setPanel('none')
              }
              event.stopPropagation()
            }}
          />
          <button type="button" disabled={busy || prompt.trim() === ''} onClick={submitGenerate}>
            {busy ? '生成中…' : '生成并插入'}
          </button>
        </div>
      ) : null}
      {panel === 'reference' ? (
        <div className="dsh-canvas-design-dock-panel" onPointerDown={(event) => event.stopPropagation()}>
          {images === null ? (
            <span className="dsh-canvas-design-dock-panel-empty">读取画布中…</span>
          ) : images.length === 0 ? (
            <span className="dsh-canvas-design-dock-panel-empty">画布上还没有图片产物</span>
          ) : (
            images.map((image) => (
              <button
                key={image.cardId}
                type="button"
                title={image.file}
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void onReference(image.file)
                    .then((error) => settle(error))
                    .finally(() => setBusy(false))
                }}
              >
                {image.name}
              </button>
            ))
          )}
        </div>
      ) : null}
      {notice !== null ? <div className="dsh-canvas-design-dock-notice">{notice}</div> : null}
    </div>
  )
}

// 临时复现导出（排查下拉空白），结案后删除。
export { DesignDock }

export function DesignViewer({ view }: ViewerProps) {
  const chrome = useChrome()
  const t = chrome.t
  // 设计这一面不用 Esc 关窗（关掉只剩 × 与点遮罩）：垫底收下这一下。
  useEscapeSink()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<DesignState>({ kind: 'loading' })
  /**
   * 首帧是否已经落到屏幕上。
   *
   * **盖板的撤下条件不是「引擎就好了」**：`setState({kind:'ready'})` 到第一帧之间还有一次
   * 同步的整页录制（yoga 布局 + Skia picture，实测 200–500ms，随文档大小），那一段屏幕上
   * 同样什么都没有。盖板留到 `draw` 真跑过一帧再撤，白屏才真正被换成了「正在绘制」这句话。
   */
  const [painted, setPainted] = useState(false)
  const paintedRef = useRef(false)
  /**
   * 字体加载进度（v1.88）。`null` = 没有字面在路上（全在缓存里，或者还没开始）。
   *
   * 为什么它值得一块自己的状态：字面是这张预览里**唯一一段还在跑、用户却看不见**的加载
   * ——四支 Inter 约 1.3MB 挡着首帧，中文字面 17.7MB 更是在首帧之后才到货，到货前含中文
   * 的文字整段空白。没有这一行，用户分不清「还在取字体」与「这份稿子坏了」。
   */
  const [fontProgress, setFontProgress] = useState<DesignFontProgress | null>(null)
  /** 字体进度的待渲染值（`undefined` = 这一帧没有新值）。见下面的合帧闸。 */
  const pendingFontRef = useRef<DesignFontProgress | null | undefined>(undefined)
  /**
   * 字体进度的**合帧闸**：一帧只渲染一次。
   *
   * 字面是按流读的，17.7MB 会来成百上千次回调（64KB 一块）；本机 50ms 内就读完，每次都
   * setState 等于在这 50ms 里插进几十次 React 渲染——而那正是「画面刚出来」的时刻。
   * 并到一帧不改变语义（最坏晚 16ms），却把那一串并成一次（闸本身与 `onRepaint` 共用
   * `design-frame-gate.ts`）。
   */
  const fontGateRef = useRef<FrameGate | null>(null)
  if (fontGateRef.current === null) {
    fontGateRef.current = createFrameGate(() => {
      const next = pendingFontRef.current
      pendingFontRef.current = undefined
      if (next === undefined) return
      setFontProgress((prev) => (fontProgressChanged(prev, next) ? next : prev))
    }, requestAnimationFrame, cancelAnimationFrame)
  }
  /** 打开时刻与引擎就绪时刻：只为在控制台留一条能复盘的耗时记录（见 `noteFirstPaint`）。 */
  const openedAtRef = useRef(0)
  const engineAtRef = useRef(0)
  /** `onRepaint` 的合帧闸（见 `scheduleRepaint`）。建一次，跟着组件活。 */
  const gateRef = useRef<FrameGate | null>(null)
  if (gateRef.current === null) {
    gateRef.current = createFrameGate(() => drawRef.current(), requestAnimationFrame, cancelAnimationFrame)
  }

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
  // 点选口径：只有一种——多选语义（点一下加一个、shift 铺一段、空手拖框选一批）。
  // 以前 dock 上那对单选/多选开关已拆（v2.04）：ref 留着是给 selectLayer 与 AI 框
  // 的分段逻辑看的，它们只需要一个常量。
  const selectModeRef = useRef<DesignSelectMode>('multi')
  // 手里正握的笔（v1.99 工具 dock）：ref 供指针手势即时判断（拖画/钢笔不打一次 React
  // 渲染），state 只驱动按钮高亮与光标。engine.setTool 与这份 state 永远同进同出——
  // 见 selectTool，别单边改。
  const [tool, setToolState] = useState<DesignTool>('move')
  const toolRef = useRef<DesignTool>('move')
  toolRef.current = tool
  // 拖画落形的手势（shape 笔按下即起）：起点世界坐标 + 手里那支笔 + 活节点 id。
  // 几何每帧直写节点（活节点预览），不付 React 渲染。
  const createRef = useRef<{ pointerId: number; sx: number; sy: number; wx: number; wy: number; tool: DesignTool; id: string | null } | null>(null)
  const marqueeRef = useRef<DesignShapeRect | null>(null)
  // 框选手势（移动笔在空手上按下即起）：橡皮筋与落形共用 marqueeRef 一条预览通路，
  // 收手时按矩形挑命中交 select。
  const selectRef = useRef<{ pointerId: number; sx: number; sy: number; wx: number; wy: number } | null>(null)
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

  /**
   * `onRepaint` 的**合帧闸**：同一帧里的多次重画请求只画一次。
   *
   * 引擎会在「字体到货、场景变更、切页」时回头叫我们重画。中文字面（17.7MB）注册进来的
   * 那一刻，core 的 `settleFontDemand` 会**逐节点**结算一遍，实测一口气叫了 88–153 次
   * ——每次都老实跑一遍 `draw` 就是同一帧里把整页重录上百遍，卡顿全落在「画面刚出来」之后。
   * 合并到一帧不改变语义（最坏延后 16ms），却把那一串并成一次（闸本身见
   * `design-frame-gate.ts`）。
   *
   * 定义在 `draw` 之前，是因为建引擎那条 effect 要把它当 `onRepaint` 交出去；它只碰
   * `drawRef`（ref 在首渲染就存在），所以这里没有先有鸡还是先有蛋的问题。
   */
  const scheduleRepaint = useCallback(() => {
    gateRef.current?.schedule()
  }, [])

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
    setPainted(false)
    paintedRef.current = false
    openedAtRef.current = performance.now()
    engineAtRef.current = 0
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
        onRepaint: scheduleRepaint,
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
      engineAtRef.current = performance.now()
      setState({ kind: 'ready' })
    })()
    return () => {
      cancelled = true
    }
    // `t` 不在依赖里：它是外壳每次渲染都给的新函数，挂上去会让引擎跟着每次重渲染重建。
    // 这个 effect 只在「盘的文档变了」时该跑，文案只用在失败那一支。
  }, [endHold, scheduleRepaint, view.present, view.text])

  /**
   * 订阅字体加载进度。
   *
   * 挂一次、活到卸载（不是跟着引擎走）：最长的那一段在引擎建完之后才开始——中文字面
   * 17.7MB 是后台到货的，首帧不等它。跟着引擎退订的话，进度条会在最需要它的那一刻消失。
   *
   * 进度可能比这块界面晚到（chunk 还在路上），所以订阅本身是异步的；`cancelled` 兜住
   * 「取到 chunk 之前就被关掉」。
   */
  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    void loadDesignEngine().then((module) => {
      if (cancelled || module?.subscribeDesignFonts === undefined) return
      stop = module.subscribeDesignFonts((next) => {
        // 逐块读会来得很密（17.7MB / 64KB ≈ 280 次）——排到下一帧，同帧只画最后一个值。
        pendingFontRef.current = next
        fontGateRef.current?.schedule()
      })
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

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

  /**
   * 首帧落屏时留一条耗时记录。
   *
   * 这一面「为什么慢」只有两段，而它们混在一起看不出来：引擎就绪（一次性：wasm + chunk +
   * 字面）与首帧绘制（每次都要：布局 + 整页录制）。分开打出来，下一次有人说慢，控制台里
   * 就有现成的数——不用再把这条链路重跑一遍。
   */
  const noteFirstPaint = useCallback(() => {
    if (openedAtRef.current === 0) return
    const now = performance.now()
    const engine = engineAtRef.current === 0 ? now : engineAtRef.current
    console.info(
      `[dsh-canvas] 设计预览首帧 ${Math.round(now - openedAtRef.current)}ms`
        + `（引擎就绪 ${Math.round(engine - openedAtRef.current)}ms，绘制 ${Math.round(now - engine)}ms）`,
    )
    openedAtRef.current = 0
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
    engine.render(viewportRef.current, width, height, dpr, { marquee: marqueeRef.current })
    // 画面真的出来了：这时才撤 loading 盖板（见 `painted`）。
    if (!paintedRef.current) {
      paintedRef.current = true
      setPainted(true)
      noteFirstPaint()
    }
    paintHold()
    paintFrame()
    paintLabels()
    const label = zoomLabelRef.current
    if (label !== null) label.textContent = `${Math.round(viewportRef.current.scale * 100)}%`
  }, [paintHold, paintFrame, paintLabels, noteFirstPaint])
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

  // ── 图片图层（v1.96）：三个入口共用「字节交引擎、围绕视口中心落图」这半步。 ──

  /** 视口中心的**世界**坐标（插图落点：镜头看着哪儿，图就落在哪儿）。 */
  const imageWorldCenter = useCallback(() => {
    const wrap = wrapRef.current
    const viewport = viewportRef.current
    if (wrap === null || viewport === null) return { x: 0, y: 0 }
    return {
      x: (wrap.clientWidth / 2 - viewport.x) / viewport.scale,
      y: (wrap.clientHeight / 2 - viewport.y) / viewport.scale,
    }
  }, [])

  /** 把几份图片字节落成图层；返回一句报错，或 `null` = 成功。 */
  const insertImageFiles = useCallback(async (files: readonly File[]): Promise<string | null> => {
    const engine = engineRef.current
    if (engine === null) return '预览还没准备好，稍等一下再试'
    try {
      const created = await engine.addImageLayers(files, imageWorldCenter())
      if (created.length === 0) return '没有落成图层：只认 png / jpeg / webp / gif / avif，且要解得出尺寸'
      return null
    } catch (error) {
      return error instanceof Error ? error.message : '插入图片失败'
    }
  }, [imageWorldCenter])

  /** AI 生成一张图并落层：宿主生成、落盘到项目，字节带回由这里转成图层。 */
  const generateImageLayer = useCallback(
    async (prompt: string): Promise<string | null> => {
      try {
        const result = (await chrome.bridge.generateImage(chrome.projectId, chrome.cardId, prompt)) as DesignImageResultWire
        if (!result.ok) return result.reason === '' ? '生成失败' : result.reason
        const bytes = base64ToBytes(result.base64)
        const name = result.path.split('/').pop()?.replace(/\.[^.]+$/, '') || '生成图片'
        return await insertImageFiles([new File([bytes], `${name}.png`, { type: 'image/png' })])
      } catch (error) {
        return error instanceof Error ? error.message : '生成图片失败'
      }
    },
    [chrome, insertImageFiles],
  )

  /** 画布上的图片产物清单（引用入口展开时现取一张板面）。 */
  const listReferenceImages = useCallback(async (): Promise<ReferenceImage[]> => {
    const board = (await chrome.bridge.readBoard(chrome.projectId)) as BoardSnapshot
    return board.cards
      // 形态判据走唯一的 kind 清单（resolveKindId 归一别名），不写裸字符串比较。
      .filter((card) => !card.missing && resolveKindId(card.kind) === 'image')
      .map((card) => ({ cardId: card.id, name: card.name === '' ? card.file : card.name, file: card.file }))
  }, [chrome])

  /** 引用一张画布图片：经工作区路由取字节，落成图层。 */
  const referenceImageLayer = useCallback(
    async (file: string): Promise<string | null> => {
      try {
        // `/${file}` = 项目根相对引用，markdownImageSrc 会验穿越、拼工作区路由。
        const url = markdownImageSrc(chrome.projectId, view.file, `/${file}`)
        if (url === undefined) return '这个路径不能作为图片引用'
        const response = await fetch(url)
        if (!response.ok) return `取图片失败（HTTP ${String(response.status)})`
        const bytes = new Uint8Array(await response.arrayBuffer())
        const name = file.split('/').pop()?.replace(/\.[^.]+$/, '') || '图片'
        // 类型按扩展名判（宿主可能给 octet-stream；引擎那张类型表认 mime，不认扩展名）。
        const type = mediaMimeOf(file.split('.').pop()?.toLowerCase() ?? '') ?? 'image/png'
        return await insertImageFiles([new File([bytes], `${name}.png`, { type })])
      } catch (error) {
        return error instanceof Error ? error.message : '引用图片失败'
      }
    },
    [chrome, view.file, insertImageFiles],
  )

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

  /** 换笔：state（按钮高亮/光标）与 engine.setTool（离开钢笔撤账本）同进同出。 */
  const selectTool = useCallback(
    (next: DesignTool): void => {
      setToolState(next)
      engineRef.current?.setTool(next)
      // 钢笔收笔后引擎内部会把笔换回移动（penDown/penFinish 里已切）：这里对齐 UI。
      if (next === 'move') marqueeRef.current = null
      draw()
    },
    [draw],
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

  // 指针三态：预览模式按住即平移；编辑模式按手里的笔分支——移动笔选元素（按住空格
  // 才变抓手平移，Figma 语义），落形笔拖画（橡皮筋、松手落图），钢笔点一下加一针，
  // 文本点一下落字。打空且没按空格 = 取消选中，不拖动画布。手势共用 pointer
  // capture，光标离面板也不丢。
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
        // 改稿在跑：画布只看着——不点选、不落形（平移仍归空格那一路，平移不是编辑）。
        if (holdRef.current !== null) return
        // 屏幕 → 世界（与 pick 同一条换算）。
        const wx = (sx - viewport.x) / viewport.scale
        const wy = (sy - viewport.y) / viewport.scale
        const active = toolRef.current
        // 钢笔：点一下加一针；指针悬在首点上时引擎已立起 pendingClose——这一针是闭合，
        // 落成矢量节点后引擎把笔换回移动，UI 在这里对齐。
        if (active === 'pen') {
          const outcome = engine.penDown(wx, wy)
          if (outcome === 'done') setToolState('move')
          event.currentTarget.setPointerCapture(event.pointerId)
          draw()
          return
        }
        // 文本：点一下落一个占位文本节点并选中（内容在属性面板改），交还移动笔。
        if (active === 'text') {
          const id = engine.createTextAt(wx, wy)
          engine.select([id], false)
          selectAnchorRef.current = id
          setToolState('move')
          draw()
          refreshSelection()
          return
        }
        // 落形笔：起手**就落真节点**（活节点预览——拖画中画的就是三角形/矩形本体，
        // 不再是橡皮筋矩形），拖动中每帧把几何写到这个节点上。
        if (active !== 'move') {
          const id = engine.beginShape(active, { x: wx, y: wy })
          event.currentTarget.setPointerCapture(event.pointerId)
          createRef.current = { pointerId: event.pointerId, sx, sy, wx, wy, tool: active, id }
          return
        }
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
        // 打空：起框选。收手时按橡皮筋挑命中——原地松手（框没拉开）才轮到清选区
        // （shift 框选/点空都保留选区，锚点一并清——不然下一次 shift 会从一段已经
        // 不亮的旧选区上铺开）。
        event.currentTarget.setPointerCapture(event.pointerId)
        selectRef.current = { pointerId: event.pointerId, sx, sy, wx, wy }
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
      // 拖画中：几何每帧直写活节点（世界坐标、左上角原点 + 正宽高），不付 React 渲染。
      const creating = createRef.current
      if (creating !== null && creating.pointerId === event.pointerId) {
        const viewport = viewportRef.current
        if (viewport === null || viewport.scale <= 0) return
        const rect = wrap.getBoundingClientRect()
        const wx = (event.clientX - rect.left - viewport.x) / viewport.scale
        const wy = (event.clientY - rect.top - viewport.y) / viewport.scale
        if (creating.id !== null) {
          engineRef.current?.updateShapeRect(creating.id, {
            x: Math.min(creating.wx, wx),
            y: Math.min(creating.wy, wy),
            width: Math.abs(wx - creating.wx),
            height: Math.abs(wy - creating.wy),
          })
          draw()
        }
        return
      }
      // 框选中：橡皮筋每帧直写 marqueeRef（与落形共用一条预览通路），不付 React 渲染。
      const selecting = selectRef.current
      if (selecting !== null && selecting.pointerId === event.pointerId) {
        const viewport = viewportRef.current
        if (viewport === null || viewport.scale <= 0) return
        const rect = wrap.getBoundingClientRect()
        const wx = (event.clientX - rect.left - viewport.x) / viewport.scale
        const wy = (event.clientY - rect.top - viewport.y) / viewport.scale
        marqueeRef.current = {
          x: Math.min(selecting.wx, wx),
          y: Math.min(selecting.wy, wy),
          width: Math.abs(wx - selecting.wx),
          height: Math.abs(wy - selecting.wy),
        }
        draw()
        return
      }
      const drag = dragRef.current
      const viewport = viewportRef.current
      // 编辑模式悬停高亮（无按键按下时）：跟随指针 pick 最深可选中节点
      // （hitTestDeep，含子图层），hover 变化引擎内部自查、只重画一次。
      // 改稿在跑时这份高亮也停：画布既然不接编辑，「将被选中」就成了空头支票。
      // 高亮只在移动笔下有意义——落形笔的指针是在圈地，不是在选人。
      if (
        modeRef.current === 'edit' &&
        toolRef.current === 'move' &&
        holdRef.current === null &&
        gestureRef.current === null &&
        moveRef.current === null &&
        dragRef.current === null &&
        createRef.current === null &&
        selectRef.current === null &&
        !spaceRef.current
      ) {
        const engine = engineRef.current
        if (engine !== null && viewport !== null) {
          const rect = wrap.getBoundingClientRect()
          engine.hover(engine.pick(event.clientX - rect.left, event.clientY - rect.top, viewport))
        }
      }
      // 钢笔悬停：喂橡皮线端点；指针离首点 8px（屏幕）内提示可闭合——近了立
      // pendingClose，远了收回去。penState 不在场（还没落第一针）时无事可喂。
      if (modeRef.current === 'edit' && toolRef.current === 'pen' && viewport !== null && viewport.scale > 0) {
        const engine = engineRef.current
        if (engine !== null) {
          const rect = wrap.getBoundingClientRect()
          const sx = event.clientX - rect.left
          const sy = event.clientY - rect.top
          const wx = (sx - viewport.x) / viewport.scale
          const wy = (sy - viewport.y) / viewport.scale
          const first = engine.penFirstVertex()
          const closing = first !== null && Math.hypot(sx - (first.x * viewport.scale + viewport.x), sy - (first.y * viewport.scale + viewport.y)) < 8
          engine.penHover(wx, wy, closing)
          draw()
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
      // 拖画收手：真拖了按橡皮筋落形；只是点了一下落一枚默认尺寸（Figma 的规矩）。
      // 落完交还移动笔——一支笔办完一件事就放下，继续画再按键取笔；与文本/钢笔
      // 同一套收场，手里不会留着「下一步画什么都是图形」的惯性。
      const creating = createRef.current
      if (creating !== null && creating.pointerId === event.pointerId) {
        createRef.current = null
        const engine = engineRef.current
        const viewport = viewportRef.current
        const wrap = wrapRef.current
        if (engine !== null && viewport !== null && wrap !== null) {
          const rect = wrap.getBoundingClientRect()
          const dragged = Math.hypot(event.clientX - rect.left - creating.sx, event.clientY - rect.top - creating.sy) >= 4
          // 默认尺寸（点一下不拖）：四形 100×100 以点为中心；直线横 120；容器/区域
          // 各给一块能看见的底盘。
          const defaults: Record<string, DesignShapeRect> = {
            frame: { x: creating.wx, y: creating.wy, width: 200, height: 150 },
            section: { x: creating.wx, y: creating.wy, width: 400, height: 300 },
            rectangle: { x: creating.wx - 50, y: creating.wy - 50, width: 100, height: 100 },
            ellipse: { x: creating.wx - 50, y: creating.wy - 50, width: 100, height: 100 },
            polygon: { x: creating.wx - 50, y: creating.wy - 50, width: 100, height: 100 },
            star: { x: creating.wx - 50, y: creating.wy - 50, width: 100, height: 100 },
            line: { x: creating.wx - 60, y: creating.wy, width: 120, height: 0 },
          }
          if (creating.id !== null) {
            if (!dragged) {
              const shape = defaults[creating.tool]
              if (shape !== undefined) engine.updateShapeRect(creating.id, shape)
            }
            const id = engine.endShape()
            if (id !== null) selectAnchorRef.current = id
          }
          setToolState('move')
          draw()
          refreshSelection()
        }
        return
      }
      // 框选收手：橡皮筋拉开过就按矩形挑命中（shift 框加选）；原地松手（框没拉开）
      // 才轮到清选区——点空的旧语义收在这一条里。
      const selecting = selectRef.current
      if (selecting !== null && selecting.pointerId === event.pointerId) {
        selectRef.current = null
        const engine = engineRef.current
        if (engine !== null) {
          const marquee = marqueeRef.current
          marqueeRef.current = null
          if (marquee !== null && (marquee.width > 0 || marquee.height > 0)) {
            const hits = engine.pickRect(marquee)
            if (event.shiftKey) engine.select(hits, true)
            else engine.select(hits, false)
            selectAnchorRef.current = null
          } else if (!event.shiftKey) {
            selectAnchorRef.current = null
            engine.select([], false)
          }
        }
        draw()
        refreshSelection()
        return
      }
      if (dragRef.current?.pointerId !== event.pointerId) return
      dragRef.current = null
      event.currentTarget.classList.remove('is-panning')
    },
    [draw, refreshSelection],
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
    if (wrap === null || state.kind !== 'ready' || !painted) return
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
        // 钢笔在场先弃笔：Esc 的第一语义是「这笔不要了」，清选区退居其次。
        if (toolRef.current === 'pen') {
          engineRef.current?.penAbort()
          setToolState('move')
          draw()
          refreshSelection()
          return
        }
        // 握着落形笔时 Esc 先回移动笔（笔是用户自己换的，Esc 只是把笔放下）；
        // 再按一次才轮到清选区。
        if (toolRef.current !== 'move') {
          selectTool('move')
          return
        }
        engineRef.current?.select([], false)
        draw()
        refreshSelection()
        return
      }
      // 工具快捷键（Figma 同一套字母）：V 移动 / F 容器 / R 矩形 / O 椭圆 / L 直线 /
      // P 钢笔 / T 文本。回车在钢笔下是收笔。
      if (editing && key === 'enter' && toolRef.current === 'pen') {
        event.preventDefault()
        engineRef.current?.penFinish()
        setToolState('move')
        draw()
        refreshSelection()
        return
      }
      if (editing && !event.shiftKey) {
        const toolKeys: Record<string, DesignTool> = { v: 'move', f: 'frame', r: 'rectangle', o: 'ellipse', l: 'line', p: 'pen', t: 'text' }
        const next = toolKeys[key]
        if (next !== undefined) {
          event.preventDefault()
          selectTool(next)
          return
        }
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
  }, [state, painted, draw, zoomAt, viewCenter, refreshSelection, stepHistory, selectTool])

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

  // 卸载时收掉挂着的落盘时钟、改稿的兜底时钟，以及还没跑的那一帧重画。
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current)
      gateRef.current?.stop()
      fontGateRef.current?.stop()
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

  // 加载期的阶段：`engine` 是资源在路上（一次性），`paint` 是首帧还没落屏（每次都付）。
  // 两段都要盖住——`ready` 但没画完的那 200–500ms 同样是一片白。判定在 design-phase.ts。
  const phase: DesignPhase | null = designPhaseOf(state, painted)
  // 字体进度：只在「还有字面在路上」时说。全缓存命中的那些打开没有可讲的东西——一条停在
  // 100% 的进度条只会让人以为还有东西在加载（判定在 design-font-progress.ts）。
  const fontsLoading: DesignFontProgress | null = fontProgressVisible(fontProgress) ? fontProgress : null
  /**
   * 能不能画条：分母要覆盖本轮全部字面。
   *
   * 分母不齐时只报「字体 4/5」。真机上踩过：四支 Inter 先到齐，条冲到 99% 停住，中文字面
   * 一开读分母变成 18.2MB，数字**掉回 7%**——一条会倒退的进度条比没有更糟。
   */
  const fontPercent = fontsLoading !== null && fontPercentKnown(fontsLoading) ? fontPercentOf(fontsLoading) : null
  /**
   * 字体那一行的字面：`字体 3/5 · 4.2 MB / 18.2 MB`。
   *
   * 分母（总字节）还没从响应头回来时只报支数：那一刻按字节折算出来的百分比是假的，
   * 而「3/5 支」本身是真的。
   */
  const fontLine = fontsLoading === null
    ? ''
    : `${t('canvas.design.fontsLoading', { done: String(fontsLoading.done), total: String(fontsLoading.total) })}`
      + (fontsLoading.totalBytes > 0 ? ` · ${formatBytes(fontsLoading.bytes)} / ${formatBytes(fontsLoading.totalBytes)}` : '')

  return (
    <>
      {/* 模式开关长在弹窗 header（× 左侧）。**必须挂在画布 wrap 之外**：Slot 的
          内容沿 React 树冒泡，会吃到 wrap 的 onPointerDown——画布一
          setPointerCapture，click 就落在捕获元素上，按钮永远收不到点击。
          首帧没落屏之前不给：这一面还没有可切换的东西。 */}
      {state.kind === 'ready' && painted ? (
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
        className={[
          'dsh-canvas-design',
          mode === 'edit' ? ' is-editing' : '',
          mode === 'edit' && spaceHeld ? ' is-space' : '',
          mode === 'edit' && tool !== 'move' ? ' is-drawing' : '',
        ].join('')}
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
        {/* 加载盖板：两段各一句话（见 DesignPhase）。它必须留在 DOM 里直到**首帧真的画完**
            ——`ready` 只是引擎有了，布局与整页录制还在后头，那一段同样是白屏。
            底色与画布一致（#e9ebef，见 styles.ts），撤下时不会闪一下别的颜色。
            字体那一行只在**还有字面在路上**时出现：它是这张预览里唯一「还在跑却看不见」
            的加载（中文字面 17.7MB 在首帧之后才到货，到货前含中文的文字整段空白）。 */}
        {phase === null ? null : (
          <div className="dsh-canvas-design-loading">
            <span className="dsh-canvas-design-loading-ring" aria-hidden="true" />
            {/* 主文案才是读屏该念的那一句；进度条自己带 progressbar 语义，不挂在 live 区里
                ——逐块变化的数字被念一遍就够吵的了。 */}
            <span className="dsh-canvas-design-loading-text" role="status">
              {t(phase === 'engine' ? 'canvas.design.loadingEngine' : 'canvas.design.loadingPaint')}
            </span>
            <span className="dsh-canvas-design-loading-hint">
              {t(phase === 'engine' ? 'canvas.design.loadingEngineHint' : 'canvas.design.loadingPaintHint')}
            </span>
            {fontsLoading === null ? null : (
              <>
                {fontPercent === null ? null : (
                  <span
                    className="dsh-canvas-design-loading-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={fontPercent}
                    aria-label={fontLine}
                  >
                    <i style={{ width: `${fontPercent}%` }} />
                  </span>
                )}
                <span className="dsh-canvas-design-loading-fonts" aria-hidden="true">{fontLine}</span>
              </>
            )}
          </div>
        )}
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
          selectMode="multi"
          dock={<DesignDock
            history={history}
            canStep={canStep}
            locked={hold !== null}
            tool={tool}
            onTool={selectTool}
            onStep={stepHistory}
            onInsertFiles={insertImageFiles}
            onGenerate={generateImageLayer}
            listReferenceImages={listReferenceImages}
            onReference={referenceImageLayer}
          />}
        />
      ) : null}
      {state.kind === 'ready' && painted ? (
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
          {/* 盖板撤了、字面还在路上（中文字面 17.7MB 就是这种）：留一枚小胶囊接着报。
              它不带左边框——那样它出现/消失时 hint 前面那条竖线会跟着挪，像界面在抖。 */}
          {fontsLoading === null ? null : (
            <span className="dsh-canvas-design-hud-fonts" title={fontLine}>
              {t('canvas.design.fontsLoading', { done: String(fontsLoading.done), total: String(fontsLoading.total) })}
            </span>
          )}
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
