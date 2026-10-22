/**
 * dsh-canvas — 设计编辑面板（React 改写自 @open-pencil/vue 的三块 UI）。
 *
 * Vue 原版是完整编辑器的左栏（pages + layers）与右栏（properties，基于
 * reka-ui / tanstack-table）。我们只搬它的**信息架构与交互语义**，不搬实现：
 * - 页面面板：列表、切换（`switchPage`，core 异步做字体/layout 准备）、
 *   新建、重命名、删除（最后一页拒删是 core 的规则，UI 也不再出按钮）。
 * - 图层面板：当前页子树、点选、显隐眼睛、锁定、重命名；点选口径**不在这一层**——
 *   viewer 拿顶栏那个单选/多选开关统一裁决（这里只报「点了谁、按没按 shift」，
 *   见 DesignSidePanels 的 onSelectLayer）；
 *   展示顺序取子节点**倒序**（场景图 latter-on-top，图层面板惯例顶层在上）。
 * - 属性面板：顶部「设计 / AI」两个标签页。设计页按模块分组编辑选中图层
 *   （名称、位置 X·Y/旋转角、形状 W·H/圆角（统一或四角独立）/裁切溢出、
 *   **形状特有属性**（多边形的边数、星形的角数+内径、椭圆的弧：起点/扫过角/内径）、
 *   外观填充/不透明/**混合模式**、文本内容与**排版**（字体/字重/字号/行距/字距/对齐）
 *   与**尺寸行为**、边框动态数组（颜色/宽度/实虚线/内外居中描边/
 *   作用边）、阴影、内阴影、模糊）；AI 页是一个提示词框：**选中的图层折成框内的
 *   内联标签**（与元素选择同一条折法——值里那一段原文照旧，只是另画一种样子），
 *   底栏是模型席位与发送。单选模式下框里始终是一枚跟着选区走的标签；多选模式下
 *   一段段累积（选一批写一句、再选一批再写一句，见 AiChip）。AI 页更宽：框里
 *   要装得下标签和一整句话。
 *
 * 「哪种类型显示哪几格、下拉里有什么可选、值怎么夹」一律问纯判据模块
 * （`core/artifact/design/node-props.ts`，F2.6）：面板这一层只把答案画成控件，
 * 不许自己判类型、也不许再列一遍取值——两份取值表迟早说两样话。
 *
 * 发出去之后这一笔归 viewer：那批图层被圈起来（流光扫过被改的那一块），画布与面板一起
 * 锁上——改稿在别人手里，这里的每一笔改动都是两个人同时写一份文档。改完落地自动收。
 *
 * 数据流是「拉」不是「推」：面板不做任何订阅，每次渲染时从
 * `engine.snapshot()` / `engine.nodeProps()` 现取；图一变，viewer 的
 * onDirty 通道 bump 版本号 → 重挂 → 重读。字段提交节律沿用属性条
 * （blur/回车提交，每条一个 undo；组件按版本 key 重挂，不搞双向绑定）。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { PromptFold } from '../../../../core/artifact/prompt/prompt-blocks.ts'
import {
  BLEND_MODES,
  type BlendModeId,
  POINT_COUNT_MAX,
  POINT_COUNT_MIN,
  TEXT_ALIGNMENTS,
  TEXT_AUTO_RESIZE,
  TEXT_FAMILIES,
  type TextAlignId,
  type TextAutoResizeId,
  arcAngles,
  arcSweep,
  hasStarInnerRadius,
  shapeTraitsOf,
  settleWeight,
  weightLabel,
  weightsOf,
} from '../../../../core/artifact/design/node-props.ts'
import { canRemovePage, pageLabel } from '../../../../core/artifact/design/pages.ts'
import {
  emptyCollapse,
  expandNodes,
  toggleCollapse,
  withNewNodesCollapsed,
  type LayerCollapseState,
} from '../../../../core/artifact/design/layer-tree.ts'
import { useChrome } from '../../chrome.tsx'
import { ModelPicker } from '../../../ui/model/model-picker.tsx'
import { PromptInput } from '../../../ui/prompt/prompt-input.tsx'
import type {
  DesignEffectItem,
  DesignEngine,
  DesignLayerNode,
  DesignNodeProps,
  DesignSnapshot,
  DesignStrokeItem,
} from './design-engine-types.ts'

/** 面板动作的统一收口：viewer 那边连着落盘时钟 + 重画 + 版本 bump。 */
export interface DesignPanelsProps {
  snapshot: DesignSnapshot
  engine: DesignEngine
  onAction: () => void
  /** 图状态版本（viewer 的 editVersion）：属性表单按它重挂，undo/拖移后字段回真值。 */
  revision: number
}

/**
 * 一笔改稿（AI 页把选中的图层交给会话去改）在两头的说法：面板这边报「起手了」，viewer
 * 那边据此收走编辑权、圈住那几个图层。
 */
export interface DesignHoldProps {
  /** 改稿在跑：面板只看着（整列不接指针，见 styles.ts 的 is-locked）。 */
  locked: boolean
  /** 起手：把这一批图层报给 viewer（圈住它们、锁住编辑，等改稿落地自动收）。 */
  onHold: (ids: readonly string[]) => void
}

/**
 * 画布的点选口径——dock 上那对单选/多选按钮。
 *
 * 它管两件事，两件都落在「一次点击意味着什么」上：**选区**（换人还是加上一个）与 **AI 框里
 * 那几段标签的写法**（重瞄最后一段，还是另起一段）。
 */
export type DesignSelectMode = 'single' | 'multi'

/**
 * 侧栏容器的类名。viewer 那边的滚轮闸门按它认出「这一滚是给列表的，不是给画布
 * 的」——两处必须指同一个名字，所以只有这一份（@see design-viewer.tsx 的 wheel）。
 */
export const DESIGN_SIDE_CLASS = 'dsh-canvas-design-side'

/** 右栏在两种标签页下的宽度：设计页一行字段够用，AI 页要装得下一枚标签与一整句话。 */
const SIDE_WIDTH: Record<PanelTab, number> = { design: 200, ai: 300 }

/**
 * 左栏宽度（样式表里 `.dsh-canvas-design-side` 的那条 width）。
 *
 * 它到了 JS 这一侧只有一个用处：给 dock 那条浮层量出**两块面板之间那段空当**的左边界
 * （见 {@link DesignDockLayer}）。改动这里必须同时改样式表那一条。
 */
const SIDE_LEFT_WIDTH = 180

/**
 * 编辑态的左右栏：左 = 页面 + 图层，右 = 属性。
 *
 * `dock` 是画布顶部中间那条工具栏（viewer 画的内容，位置归这里——它要落在两块面板**之间**
 * 的空当正中，而空当的两条边只有这一层知道）。
 */
export function DesignSidePanels({
  snapshot,
  engine,
  onAction,
  revision,
  locked,
  onHold,
  onSelectLayer,
  selectMode,
  dock,
}: DesignPanelsProps &
  DesignHoldProps & {
    /**
     * 点选走 viewer 那一份公共口径（选区只有一份，画布与面板必须给出同一个结果）。
     *
     * 面板不再自己 `engine.select`——以前那一版按 shift 加选，同一个 shift 在画布上是另一个
     * 意思；现在两处都只报「点了谁、按没按 shift」，怎么选由 viewer 按顶栏的模式定。
     */
    onSelectLayer: (id: string, range: boolean) => void
    selectMode: DesignSelectMode
    dock?: ReactElement
  }): ReactElement {
  /**
   * 属性面板的两个标签由**这里**拿着，不是 `PropertiesPanel` 自己拿着。
   *
   * 因为宽度是**栏**的事（右栏按标签页换宽，见下面的 SIDE_WIDTH），而栏是这一层画的
   * ——标签落在里面那一层，宽度就够不着它。
   */
  const [tab, setTab] = useState<PanelTab>('design')
  const lock = locked ? ' is-locked' : ''
  return (
    <>
      <div
        className={`${DESIGN_SIDE_CLASS} dsh-canvas-design-side-left${lock}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <PagesPanel snapshot={snapshot} engine={engine} onAction={onAction} revision={revision} />
        <LayersPanel
          snapshot={snapshot}
          engine={engine}
          onAction={onAction}
          revision={revision}
          onSelectLayer={onSelectLayer}
        />
      </div>
      {dock === undefined ? null : <DesignDockLayer right={SIDE_WIDTH[tab]}>{dock}</DesignDockLayer>}
      <div
        className={`${DESIGN_SIDE_CLASS} dsh-canvas-design-side-right${lock}`}
        // 宽度走行内样式：它跟着**标签页状态**走，写在这里就没有第二条选择器可以跟它打架
        // （伸缩那 180ms 留在样式表里）。
        style={{ width: SIDE_WIDTH[tab] }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <PropertiesPanel
          snapshot={snapshot}
          engine={engine}
          onAction={onAction}
          revision={revision}
          tab={tab}
          onTab={setTab}
          locked={locked}
          onHold={onHold}
          selectMode={selectMode}
        />
      </div>
    </>
  )
}

/** dock 那条浮层：横跨两块面板之间的空当，把内容摆在正中（内容不许吃指针，按钮自己吃）。 */
function DesignDockLayer({ right, children }: { right: number; children: ReactNode }): ReactElement {
  return (
    <div className="dsh-canvas-design-dock-layer" style={{ left: SIDE_LEFT_WIDTH, right }}>
      {children}
    </div>
  )
}

/**
 * 类型记号的外壳：24 视框、12px、只描边不填充、颜色随 currentColor。
 *
 * 一族的笔法只有这一份——尺寸、粗细、端点都在这里定死，加一枚新记号不必再抄一遍。
 * 圆头、圆角是这族记号的共同长相，和面板里那两枚开关的图标同源。
 */
function Glyph({ strokeWidth = 1.8, children }: { strokeWidth?: number; children: ReactNode }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {children}
    </svg>
  )
}

/**
 * Figma 的 frame 记号：井字形（四根短线穿成一个框）。
 *
 * 容器在 Figma 的图层树上就是这枚 `#`，图层面板与画布上的容器名称签共用同一枚。
 */
export function FrameIcon(): ReactElement {
  return (
    <Glyph strokeWidth={2}>
      <path d="M8 3v18M16 3v18M3 8h18M3 16h18" />
    </Glyph>
  )
}

/**
 * Figma 的 section 记号：圆角方框 + 左上角一格（区域自己的名字就挂在那格里）。
 *
 * 区域是归类容器的组织层，不裁切——容器是光秃的 `#`，区域是框起来的，
 * 两枚记号一眼分得开。
 */
export function SectionIcon(): ReactElement {
  return (
    <Glyph>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M3 10.5h9.5V3" />
    </Glyph>
  )
}

/** 文本：一枚 T。 */
function TextIcon(): ReactElement {
  return (
    <Glyph>
      <path d="M5 6h14M12 6v13" />
    </Glyph>
  )
}

/** 矩形：方框；圆角矩形把圆角放大到一眼看得出「圆」的那一档。 */
function RectIcon({ rounded }: { rounded: boolean }): ReactElement {
  return (
    <Glyph>
      <rect x="4.5" y="4.5" width="15" height="15" rx={rounded ? 5.5 : 1.5} />
    </Glyph>
  )
}

/** 椭圆 / 圆。 */
function EllipseIcon(): ReactElement {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="8.5" />
    </Glyph>
  )
}

/** 直线：一根斜线。 */
function LineIcon(): ReactElement {
  return (
    <Glyph>
      <path d="M5 19 19 5" />
    </Glyph>
  )
}

/** 星形：十点闭合星。 */
function StarIcon(): ReactElement {
  return (
    <Glyph>
      <path d="M12 4 14.2 9.5 20.1 9.9 15.5 13.6 17 19.4 12 16.2 7 19.4 8.5 13.6 3.9 9.9 9.8 9.5Z" />
    </Glyph>
  )
}

/** 多边形：正六边形。 */
function PolygonIcon(): ReactElement {
  return (
    <Glyph>
      <path d="M12 3.6 19.4 7.8v8.4L12 20.4 4.6 16.2V7.8Z" />
    </Glyph>
  )
}

/** 矢量图形：一条曲线接两个节点。 */
function VectorIcon(): ReactElement {
  return (
    <Glyph>
      <path d="M5.5 18.5C5.5 11 18.5 13 18.5 5.5" />
      <circle cx="5.5" cy="18.5" r="1.5" />
      <circle cx="18.5" cy="5.5" r="1.5" />
    </Glyph>
  )
}

/** 分组：四角的括号——只表示「这是一组」，不画里面的成员。 */
function GroupIcon(): ReactElement {
  return (
    <Glyph>
      <path d="M4 9V5.8A1.8 1.8 0 0 1 5.8 4H9M15 4h3.2A1.8 1.8 0 0 1 20 5.8V9M20 15v3.2a1.8 1.8 0 0 1-1.8 1.8H15M9 20H5.8A1.8 1.8 0 0 1 4 18.2V15" />
    </Glyph>
  )
}

/** 认不得的类型（组件 / 实例等）：一枚空菱形，具体是什么交给提示文字说。 */
function UnknownIcon(): ReactElement {
  return (
    <Glyph>
      <path d="M12 3.8 20.2 12 12 20.2 3.8 12Z" />
    </Glyph>
  )
}

/** 图层面板两枚开关的线性图标：开与关是同一族里的两笔差别，笔画都随 currentColor 走。 */
function EyeIcon({ off }: { off: boolean }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
      {/* 斜杠压住眼睛就是「藏起来」——同一只眼睛加一笔，两态一眼配对。 */}
      {off ? <path d="M3 21 21 3" /> : null}
    </svg>
  )
}

/** 挂锁：关着是两条腿都扣住，开着是右腿离地（Figma 那副长相）。 */
function LockIcon({ open }: { open: boolean }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d={open ? 'M8.2 10.5V7.2a3.8 3.8 0 0 1 7.2-1.6' : 'M8.2 10.5V7.2a3.8 3.8 0 0 1 7.6 0v3.3'} />
    </svg>
  )
}

/**
 * 类型徽标：一枚线性记号认一种类型。
 *
 * frame 的 `#` 与 section 的「框套格」跟着 Figma；其余是同一族的线性图形——原先那几枚
 * 字形（`T`/`◯`/`▨`/`❏`/`◆`）换掉了：字符的字重、端点、基线都随字体走，和两侧的 SVG
 * 开关摆在一行里对不上。
 */
function TypeGlyph({ type }: { type: string }): ReactElement {
  if (type === 'frame' || type === 'canvas') return <FrameIcon />
  if (type === 'section') return <SectionIcon />
  if (type === 'text') return <TextIcon />
  if (type === 'rectangle' || type === 'rounded-rectangle') return <RectIcon rounded={type === 'rounded-rectangle'} />
  if (type === 'ellipse') return <EllipseIcon />
  if (type === 'line') return <LineIcon />
  if (type === 'star') return <StarIcon />
  if (type === 'polygon') return <PolygonIcon />
  if (type === 'vector') return <VectorIcon />
  if (type === 'group') return <GroupIcon />
  return <UnknownIcon />
}

/** 类型徽标的中文名（悬停提示）：认得的给中文，认不得的退回 wire 名本身。 */
const TYPE_LABELS: Record<string, string> = {
  frame: '容器',
  canvas: '容器',
  section: '区域',
  group: '分组',
  text: '文本',
  rectangle: '矩形',
  'rounded-rectangle': '圆角矩形',
  ellipse: '椭圆',
  line: '直线',
  star: '星形',
  polygon: '多边形',
  vector: '矢量图形',
  component: '组件',
  'component-set': '组件集',
  instance: '实例',
  'boolean-operation': '布尔运算',
  'shape-with-text': '图形文字',
}

// —— 页面管理 ————————————————————————————————————————————————————————

/**
 * 页面行的左边距：与图层面板那一列的**基本缩进**取同一个值。
 *
 * 那边是 `4 + 层深 × 12`（顶层节点就是 4px，接着才是折叠箭头与类型徽标），页是平的、
 * 没有这两样，于是只跟那 4px 对齐——两段列表挨在一起，左沿看着是一条线。
 */
const PAGE_INDENT = 4

/** 复制：两片重叠的方角纸（Figma 那一副）。 */
function CopyGlyph(): ReactElement {
  return (
    <Glyph>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M6 15H5.5A2.5 2.5 0 0 1 3 12.5v-7A2.5 2.5 0 0 1 5.5 3h7A2.5 2.5 0 0 1 15 5.5V6" />
    </Glyph>
  )
}

/** 重命名：铅笔（笔尖朝左下，与 Figma 的编辑图标同一根）。 */
function PencilGlyph(): ReactElement {
  return (
    <Glyph>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    </Glyph>
  )
}

/** 删除：废纸篓（盖子 + 桶身 + 两道竖纹）。 */
function TrashGlyph(): ReactElement {
  return (
    <Glyph>
      <path d="M4 7h16M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.5 7 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5L17.5 7" />
      <path d="M10.5 11v6M13.5 11v6" />
    </Glyph>
  )
}

/**
 * 页面管理（F2.8）：图层面板**上面**那一段。
 *
 * 四件事各有各的位置：**新建**在标题栏（空文档也得能加页，且它是唯一不针对某一行的动作），
 * **复制 / 重命名 / 删除**在每一行行尾——当前页那三枚常显（这一栏的操作本来就只有这三件，
 * 全藏进悬停里等于没有），其余行悬停才露。
 *
 * 两条不显眼但必须的规矩：
 *
 * - **名字一律过 `pageLabel`**：空名的页（只有模型手写的文档才可能）也得有一行字。
 * - **删除要二次确认**：上游的 `deletePage` 直接删图上那个节点、**不进撤销栈**，删掉就没了
 *   （见 `design-engine-types.ts` 那一格的注释）。确认**落在行内**（那一行本来就是它的主语）：
 *   行染上一层警示色，行尾那三枚换成「删除 / 取消」两枚——**页名留在原地**，所以「删的是哪
 *   一页」不必再问一遍。不做弹窗：面板这一层没有别的地方可以弹，而用户此刻看的就是这一行。
 */
function PagesPanel({ snapshot, engine, onAction }: DesignPanelsProps): ReactElement {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  // 「能不能删」只问这一句（只剩一页时不给删，上游也拒）——面板不许自己数一遍。
  const canRemove = canRemovePage(snapshot.pages.length)
  return (
    <section className="dsh-canvas-design-panel">
      <header className="dsh-canvas-design-panel-head">
        页面
        <button
          type="button"
          className="dsh-canvas-design-tip is-right"
          aria-label="新建页面"
          data-tip="新建页面"
          onPointerEnter={(event) => placeTip(event.currentTarget)}
          onClick={() => {
            engine.addPage()
            onAction()
          }}
        >
          ＋
        </button>
      </header>
      <ul className="dsh-canvas-design-panel-list">
        {snapshot.pages.map((page) => {
          const isActive = page.id === snapshot.currentPageId
          const isConfirming = confirming === page.id
          const rowClass = [
            'dsh-canvas-design-page',
            isActive ? 'is-active' : undefined,
            isConfirming ? 'is-confirming' : undefined,
          ].filter(Boolean).join(' ')
          return (
            <li key={page.id}>
              <div
                className={rowClass}
                style={{ paddingLeft: PAGE_INDENT }}
                // 确认态那一行点哪儿都不该切页：这一刻它问的是一个是非题。
                onClick={() => {
                  if (isConfirming || isActive) return
                  engine.setPage(page.id)
                  onAction()
                }}
                onDoubleClick={() => {
                  if (isConfirming) return
                  setRenaming(page.id)
                }}
              >
                {renaming === page.id ? (
                  <span className="dsh-canvas-design-row-name">
                    <TextField
                      autoFocus
                      value={page.name}
                      onCommit={(name) => {
                        engine.renamePage(page.id, name)
                        setRenaming(null)
                        onAction()
                      }}
                      onCancel={() => setRenaming(null)}
                    />
                  </span>
                ) : (
                  <span className="dsh-canvas-design-row-name" title={pageLabel(page.name)}>
                    {pageLabel(page.name)}
                  </span>
                )}
                {isConfirming ? (
                  <>
                    <button
                      type="button"
                      className="dsh-canvas-design-page-act is-danger"
                      onClick={(event) => {
                        event.stopPropagation()
                        setConfirming(null)
                        engine.deletePage(page.id)
                        onAction()
                      }}
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      className="dsh-canvas-design-page-act"
                      onClick={(event) => {
                        event.stopPropagation()
                        setConfirming(null)
                      }}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="dsh-canvas-design-row-act dsh-canvas-design-tip"
                      aria-label="复制页面"
                      data-tip="复制页面"
                      onPointerEnter={(event) => placeTip(event.currentTarget)}
                      onClick={(event) => {
                        event.stopPropagation()
                        engine.duplicatePage(page.id)
                        onAction()
                      }}
                    >
                      <CopyGlyph />
                    </button>
                    <button
                      type="button"
                      className="dsh-canvas-design-row-act dsh-canvas-design-tip"
                      aria-label="重命名页面"
                      data-tip="重命名页面"
                      onPointerEnter={(event) => placeTip(event.currentTarget)}
                      onClick={(event) => {
                        event.stopPropagation()
                        setRenaming(page.id)
                      }}
                    >
                      <PencilGlyph />
                    </button>
                    {canRemove ? (
                      <button
                        type="button"
                        className="dsh-canvas-design-row-act dsh-canvas-design-tip is-danger"
                        aria-label="删除页面"
                        data-tip="删除页面"
                        onPointerEnter={(event) => placeTip(event.currentTarget)}
                        onClick={(event) => {
                          event.stopPropagation()
                          setRenaming(null)
                          setConfirming(page.id)
                        }}
                      >
                        <TrashGlyph />
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// —— 图层面板 ————————————————————————————————————————————————————————

/**
 * 缩进的最大层级：再深的节点也只缩到这里。
 *
 * 侧栏定宽 180px，而行里除缩进外还有折叠箭头、类型徽标、名字与两枚按钮（眼睛与
 * 锁）。缩进按 12px 无限累加的话，深度十来层的行就会把这些固定宽度顶出面板——眼睛
 * 与锁被裁掉，横向再多一根滚动条（面板不该有）。封顶换来的代价是极深的节点与它
 * 的父级缩进相同，但那一档的树本来也读不出层级了，看得见的按钮更要紧。
 */
const MAX_INDENT_DEPTH = 6

/** 气泡占的竖向空间：11px 字 + 上下各 1px 内边距 + 6px 空当——翻不翻就看这点够不够。 */
const TIP_STACK_HEIGHT = 24

/**
 * 悬停气泡默认落在元素**下方**，下方装不下才翻到上方。
 *
 * 「装不下」以最近的可裁父级的底边为准：图层列表是 `overflow:auto`、侧栏是
 * `overflow:hidden`，越过它们的气泡会被直接切掉；而那条边在哪儿只有量出来才知道
 * （列表还可能已经滚过）。翻转靠一枚类，样式那边只切 `top`/`bottom`。
 */
function placeTip(host: HTMLElement): void {
  const clip = host.closest('.dsh-canvas-design-panel-list') ?? host.closest(`.${DESIGN_SIDE_CLASS}`)
  const limit = clip?.getBoundingClientRect().bottom ?? window.innerHeight
  host.classList.toggle('is-up', host.getBoundingClientRect().bottom + TIP_STACK_HEIGHT > limit)
}

function LayersPanel({
  snapshot,
  engine,
  onAction,
  onSelectLayer,
}: DesignPanelsProps & { onSelectLayer: (id: string, range: boolean) => void }): ReactElement {
  /**
   * 展开状态**默认全折叠**（F2.9，v1.67）：一进来只看得见顶层那几个画板。
   *
   * 状态本体与那两条规矩（新节点默认折叠、动过的不再自动改）都在
   * `core/artifact/design/layer-tree.ts` 里——面板这一层只负责把三条路接上去：
   * 初次挂载、快照刷新、用户点箭头。
   */
  const [collapse, setCollapse] = useState<LayerCollapseState>(() =>
    withNewNodesCollapsed(snapshot.layers, emptyCollapse()),
  )
  const [renaming, setRenaming] = useState<string | null>(null)
  const selected = new Set(snapshot.selection)
  const listRef = useRef<HTMLUListElement | null>(null)
  // 上次滚动聚焦的选区——同一选区的快照刷新（重画/落盘 bump）不再滚动。
  const scrolledRef = useRef<string>('')
  const selectionKey = snapshot.selection.join(',')

  // 快照换了：新出现的可展开节点收进折叠集合（用户动过的保持原样）。
  useEffect(() => {
    setCollapse((previous) => withNewNodesCollapsed(snapshot.layers, previous))
  }, [snapshot.layers])

  // 画布上点选后，图层面板滚动到选中行。选中行若藏在折叠的祖先里，先展开
  // 祖先（否则行根本没渲染、无从滚动），再 rAF 等行挂载后 scrollIntoView。
  useEffect(() => {
    if (selectionKey === '' || selectionKey === scrolledRef.current) return
    scrolledRef.current = selectionKey
    const hitSelection = new Set(snapshot.selection)
    const ancestors = new Set<string>()
    const walk = (nodes: DesignLayerNode[], path: readonly string[]): void => {
      for (const node of nodes) {
        if (hitSelection.has(node.id)) for (const id of path) ancestors.add(id)
        walk(node.children, node.children.length > 0 ? [...path, node.id] : path)
      }
    }
    walk(snapshot.layers, [])
    if (ancestors.size > 0) {
      setCollapse((previous) => expandNodes(previous, ancestors))
    }
    const frame = requestAnimationFrame(() => {
      listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [selectionKey, snapshot.layers, snapshot.selection])

  const row = (node: DesignLayerNode, depth: number): ReactElement => {
    const isSelected = selected.has(node.id)
    const hasChildren = node.children.length > 0
    const isCollapsed = collapse.collapsed.has(node.id)
    return (
      <li key={node.id}>
        <div
          className={[
            'dsh-canvas-design-layer',
            isSelected ? 'is-active' : undefined,
            node.visible ? undefined : 'is-hidden',
          ].filter(Boolean).join(' ')}
          style={{ paddingLeft: 4 + Math.min(depth, MAX_INDENT_DEPTH) * 12 }}
          onClick={(event) => {
            // 单选/多选、shift 铺一段——口径都在 viewer 那一份 selectLayer 里，这里只报点击。
            onSelectLayer(node.id, event.shiftKey)
          }}
          onDoubleClick={() => setRenaming(node.id)}
        >
          {hasChildren ? (
            <button
              type="button"
              className="dsh-canvas-design-caret"
              onClick={(event) => {
                event.stopPropagation()
                setCollapse((previous) => toggleCollapse(previous, node.id))
              }}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className="dsh-canvas-design-caret" />
          )}
          <span
            className="dsh-canvas-design-glyph dsh-canvas-design-tip is-right"
            data-tip={TYPE_LABELS[node.type] ?? node.type}
            onPointerEnter={(event) => placeTip(event.currentTarget)}
          >
            <TypeGlyph type={node.type} />
          </span>
          {renaming === node.id ? (
            <TextField
              autoFocus
              value={node.name}
              onCommit={(name) => {
                engine.updateProps(node.id, { name })
                setRenaming(null)
                onAction()
              }}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <span className="dsh-canvas-design-row-name" title={node.name}>
              {node.name === '' ? node.type : node.name}
            </span>
          )}
          <button
            type="button"
            className="dsh-canvas-design-row-act dsh-canvas-design-tip"
            aria-label={node.locked ? '解除锁定' : '锁定'}
            data-tip={node.locked ? '解除锁定' : '锁定'}
            onPointerEnter={(event) => placeTip(event.currentTarget)}
            onClick={(event) => {
              event.stopPropagation()
              engine.updateProps(node.id, { locked: !node.locked })
              onAction()
            }}
          >
            <LockIcon open={!node.locked} />
          </button>
          <button
            type="button"
            className="dsh-canvas-design-row-act dsh-canvas-design-tip"
            aria-label={node.visible ? '隐藏' : '显示'}
            data-tip={node.visible ? '隐藏' : '显示'}
            onPointerEnter={(event) => placeTip(event.currentTarget)}
            onClick={(event) => {
              event.stopPropagation()
              engine.updateProps(node.id, { visible: !node.visible })
              onAction()
            }}
          >
            <EyeIcon off={!node.visible} />
          </button>
        </div>
        {hasChildren && !isCollapsed ? (
          <ul>{[...node.children].reverse().map((child) => row(child, depth + 1))}</ul>
        ) : null}
      </li>
    )
  }

  return (
    <section className="dsh-canvas-design-panel dsh-canvas-design-panel-grow">
      <header className="dsh-canvas-design-panel-head">图层</header>
      <ul ref={listRef} className="dsh-canvas-design-panel-list">
        {[...snapshot.layers].reverse().map((node) => row(node, 0))}
      </ul>
    </section>
  )
}

// —— 属性面板（设计 / AI 标签页） ——————————————————————————————————————————

/** 属性面板顶部的两个标签。 */
type PanelTab = 'design' | 'ai'

interface PropertiesPanelProps extends DesignPanelsProps, DesignHoldProps {
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  selectMode: DesignSelectMode
}

function PropertiesPanel({
  snapshot,
  engine,
  onAction,
  revision,
  tab,
  onTab,
  locked,
  onHold,
  selectMode,
}: PropertiesPanelProps): ReactElement {
  return (
    <section className="dsh-canvas-design-panel">
      <div className="dsh-canvas-design-tabs" role="tablist" aria-label="属性面板">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'design'}
          className={`dsh-canvas-design-tab${tab === 'design' ? ' is-active' : ''}`}
          onClick={() => onTab('design')}
        >
          设计
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'ai'}
          className={`dsh-canvas-design-tab${tab === 'ai' ? ' is-active' : ''}`}
          onClick={() => onTab('ai')}
        >
          AI
        </button>
      </div>
      {tab === 'design' ? (
        <DesignPropertiesTab snapshot={snapshot} engine={engine} onAction={onAction} revision={revision} />
      ) : (
        <AiPromptTab
          snapshot={snapshot}
          engine={engine}
          onAction={onAction}
          revision={revision}
          locked={locked}
          onHold={onHold}
          selectMode={selectMode}
        />
      )}
    </section>
  )
}

function DesignPropertiesTab({ snapshot, engine, onAction, revision }: DesignPanelsProps): ReactElement {
  const count = snapshot.selection.length
  if (count === 0) {
    return <p className="dsh-canvas-design-panel-empty">选中一个图层查看属性。</p>
  }
  if (count > 1) {
    return (
      <>
        <p className="dsh-canvas-design-panel-empty">已选中 {count} 个图层。</p>
        <button
          type="button"
          className="dsh-canvas-design-danger"
          onClick={() => {
            engine.deleteSelection()
            onAction()
          }}
        >
          删除选中
        </button>
      </>
    )
  }
  const read = engine.nodeProps(snapshot.selection[0] ?? '')
  if (read === null) {
    return <p className="dsh-canvas-design-panel-empty">图层已不存在。</p>
  }
  const commit = (props: DesignNodeProps): void => {
    engine.updateProps(read.id, props)
    onAction()
  }

  // 效果按类型分桶展示；任一桶提交都把三桶按固定顺序合并回去——
  // updateProps 的 effects 是整组替换，各模块不能只写自己的那份。
  const shadows = read.effects.filter((effect) => effect.type === 'DROP_SHADOW')
  const innerShadows = read.effects.filter((effect) => effect.type === 'INNER_SHADOW')
  const blurs = read.effects.filter((effect) => effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR')
  const commitEffects = (parts: { shadows?: DesignEffectItem[]; inner?: DesignEffectItem[]; blurs?: DesignEffectItem[] }): void => {
    commit({
      effects: [...(parts.shadows ?? shadows), ...(parts.inner ?? innerShadows), ...(parts.blurs ?? blurs)],
    })
  }

  // 形状特有属性（F2.6）：**按类型露哪几格只问 `shapeTraitsOf`**，面板里不许再写
  // `type === 'polygon'` 这类判断（判据在纯模块里，测得到）。
  const traits = shapeTraitsOf(read.type)
  const arc = read.arc
  /**
   * 字重下拉的可选项：这支字面真到货的档，外加**当前值本身**（它不在表里时）。
   *
   * 旧文档里可能落着一个我们没有字面的字重（如 300）：把这一格丢掉的话，控件显示空的，
   * 用户看不见真值、一碰就悄悄改成别的；列出来至少是诚实的——选一个真有的档就是修好它。
   */
  const weights = weightsOf(read.fontFamily)
  const weightOptions = weights.includes(read.fontWeight)
    ? weights
    : [...weights, read.fontWeight].sort((a, b) => a - b)
  /**
   * 写弧：起点/扫过角/内径三格共享同一个弧，改一格要把另两格一起带上（整组替换）。
   * 「起点 + 扫过角 → 起点/终点角」的换算在纯模块 `arcAngles` 里，面板不做算术。
   */
  const writeArc = (patch: { start?: number; sweep?: number; inner?: number }): void => {
    const current = arc ?? { startingAngle: 0, endingAngle: 270, innerRadius: 0 }
    commit({
      arc: {
        ...arcAngles(patch.start ?? current.startingAngle, patch.sweep ?? arcSweep(current)),
        innerRadius: patch.inner ?? current.innerRadius,
      },
    })
  }

  const isFrame = read.type === 'frame'
  const isText = read.type === 'text'
  return (
    <div className="dsh-canvas-design-form" key={`${read.id}:${revision}`}>
      <label className="dsh-canvas-design-field">
        <span>名称</span>
        <TextField value={read.name} onCommit={(name) => commit({ name })} />
      </label>

      <Module title="位置">
        <div className="dsh-canvas-design-grid2">
          <label className="dsh-canvas-design-field">
            <span>X</span>
            <NumField value={Math.round(read.x)} onCommit={(x) => commit({ x })} />
          </label>
          <label className="dsh-canvas-design-field">
            <span>Y</span>
            <NumField value={Math.round(read.y)} onCommit={(y) => commit({ y })} />
          </label>
        </div>
        {/* 旋转与 X/Y 同属位置（Figma 的变换一节也是这么并排的）：不设上下限，
            整圈、负角都合法，值一个都不改地交给场景图。 */}
        <label className="dsh-canvas-design-field">
          <span>旋转</span>
          <NumField
            value={Math.round(read.rotation * 10) / 10}
            onCommit={(rotation) => commit({ rotation })}
          />
        </label>
      </Module>

      <Module title="形状">
        <div className="dsh-canvas-design-grid2">
          <label className="dsh-canvas-design-field">
            <span>W</span>
            <NumField value={Math.round(read.width)} min={1} onCommit={(width) => commit({ width })} />
          </label>
          <label className="dsh-canvas-design-field">
            <span>H</span>
            <NumField value={Math.round(read.height)} min={1} onCommit={(height) => commit({ height })} />
          </label>
        </div>
        {!isText && !read.independentCorners ? (
          <label className="dsh-canvas-design-field">
            <span>圆角</span>
            <NumField value={read.cornerRadius} min={0} onCommit={(cornerRadius) => commit({ cornerRadius })} />
          </label>
        ) : null}
        {!isText && read.independentCorners ? (
          <>
            <div className="dsh-canvas-design-grid2">
              <label className="dsh-canvas-design-field">
                <span>左上</span>
                <NumField value={read.topLeftRadius} min={0} onCommit={(topLeftRadius) => commit({ topLeftRadius })} />
              </label>
              <label className="dsh-canvas-design-field">
                <span>右上</span>
                <NumField value={read.topRightRadius} min={0} onCommit={(topRightRadius) => commit({ topRightRadius })} />
              </label>
            </div>
            <div className="dsh-canvas-design-grid2">
              <label className="dsh-canvas-design-field">
                <span>左下</span>
                <NumField value={read.bottomLeftRadius} min={0} onCommit={(bottomLeftRadius) => commit({ bottomLeftRadius })} />
              </label>
              <label className="dsh-canvas-design-field">
                <span>右下</span>
                <NumField value={read.bottomRightRadius} min={0} onCommit={(bottomRightRadius) => commit({ bottomRightRadius })} />
              </label>
            </div>
          </>
        ) : null}
        {!isText ? (
          <SelectField
            value={read.independentCorners ? 'independent' : 'uniform'}
            options={[
              { value: 'uniform', label: '统一圆角' },
              { value: 'independent', label: '四角独立' },
            ]}
            onChange={(next) => commit(next === 'independent' ? { independentCorners: true } : { cornerRadius: read.topLeftRadius })}
          />
        ) : null}
        {isFrame ? (
          <CheckField
            label="裁切溢出内容"
            checked={read.clipsContent}
            onChange={(clipsContent) => commit({ clipsContent })}
          />
        ) : null}
      </Module>

      {/* 形状特有属性（F2.6）：多边形的边数、星形的角数共用场景图同一个 `pointCount`，
          星形另有内径；椭圆的弧存的是**起点/终点角**，面板按 Figma 的说法给「起点 + 扫过角」。 */}
      {traits.title === '' ? null : (
        <Module title={traits.title}>
          <label className="dsh-canvas-design-field">
            <span>{traits.pointCountLabel}</span>
            <NumField
              value={read.pointCount}
              min={POINT_COUNT_MIN}
              max={POINT_COUNT_MAX}
              onCommit={(pointCount) => commit({ pointCount })}
            />
          </label>
          {hasStarInnerRadius(read.type) ? (
            <label className="dsh-canvas-design-field">
              <span>内径</span>
              <NumField
                value={Math.round(read.starInnerRadius * 100)}
                min={0}
                max={100}
                onCommit={(value) => commit({ starInnerRadius: value / 100 })}
              />
            </label>
          ) : null}
        </Module>
      )}

      {traits.arc ? (
        <Module
          title="弧"
          action={
            <button
              type="button"
              onClick={() => (arc === null ? writeArc({ sweep: 270 }) : commit({ arc: null }))}
            >
              {arc === null ? '转为弧' : '还原整圆'}
            </button>
          }
        >
          {arc === null ? (
            <span className="dsh-canvas-design-module-empty">完整椭圆</span>
          ) : (
            <>
              <div className="dsh-canvas-design-grid2">
                <label className="dsh-canvas-design-field">
                  <span>起点</span>
                  <NumField value={arc.startingAngle} onCommit={(start) => writeArc({ start })} />
                </label>
                <label className="dsh-canvas-design-field">
                  <span>扫过</span>
                  {/* 扫过角与 Figma 同为 −360…360（负值=反向扫） */}
                  <NumField
                    value={arcSweep(arc)}
                    min={-360}
                    max={360}
                    onCommit={(sweep) => writeArc({ sweep })}
                  />
                </label>
              </div>
              <label className="dsh-canvas-design-field">
                <span>内径</span>
                <NumField
                  value={Math.round(arc.innerRadius * 100)}
                  min={0}
                  max={100}
                  onCommit={(value) => writeArc({ inner: value / 100 })}
                />
              </label>
            </>
          )}
        </Module>
      ) : null}

      <Module title="外观">
        <label className="dsh-canvas-design-field">
          <span>填充</span>
          <input
            type="color"
            value={(read.fill ?? '#000000').slice(0, 7)}
            onChange={(event) => commit({ fill: event.target.value })}
          />
        </label>
        <label className="dsh-canvas-design-field">
          <span>不透明</span>
          <NumField
            value={Math.round(read.opacity * 100)}
            min={0}
            max={100}
            onCommit={(value) => commit({ opacity: Math.min(1, Math.max(0, value / 100)) })}
          />
        </label>
        {/* 混合模式在 Figma 里归「图层」那一节，我们并进外观——它改的是这个图层**怎么和
            下面的东西合成**，和填充/不透明是同一件事的三种说法。取值表来自纯判据模块
            （`node-props.ts`），别处不许再列一遍。 */}
        <SelectField
          value={read.blendMode}
          options={BLEND_MODES.map((mode) => ({ value: mode.id, label: mode.label }))}
          onChange={(next) => commit({ blendMode: next as BlendModeId })}
        />
      </Module>

      {isText ? (
        <>
          <Module title="文本">
            <label className="dsh-canvas-design-field">
              <span>内容</span>
              <TextField value={read.text} onCommit={(text) => commit({ text })} />
            </label>
          </Module>

          {/* 排版（F2.6）：字体下拉里只会出现**真注册过的字面**（`TEXT_FAMILIES`），
              列一支没装上的一眼看上去没差别——画布上文字是空白的，什么也不报。 */}
          <Module title="排版">
            <SelectField
              value={read.fontFamily}
              options={TEXT_FAMILIES.map((family) => ({ value: family.id, label: family.label }))}
              onChange={(fontFamily) =>
                // 换字体**连带把字重落回这支字面真有的档**（中文只有 Regular）：
                // 两格一起写，一次编辑一笔 undo，不留中间态。
                commit({ fontFamily, fontWeight: settleWeight(fontFamily, read.fontWeight) })
              }
            />
            {weightOptions.length > 1 ? (
              <SelectField
                value={String(read.fontWeight)}
                options={weightOptions.map((weight) => ({ value: String(weight), label: weightLabel(weight) }))}
                onChange={(next) => commit({ fontWeight: Number(next) })}
              />
            ) : null}
            <div className="dsh-canvas-design-grid2">
              <label className="dsh-canvas-design-field">
                <span>字号</span>
                <NumField value={read.fontSize} min={1} onCommit={(fontSize) => commit({ fontSize })} />
              </label>
              <label className="dsh-canvas-design-field">
                <span>字距</span>
                <NumField value={read.letterSpacing} onCommit={(letterSpacing) => commit({ letterSpacing })} />
              </label>
            </div>
            <CheckField
              label="行高自动"
              checked={read.lineHeight === null}
              // 关掉自动时给一个确定的起点（1.5 倍字号，Figma 的默认行距口径）；
              // 开着就是 `null`——场景图按字面自己排。
              onChange={(auto) =>
                commit({ lineHeight: auto ? null : Math.max(1, Math.round(read.fontSize * 1.5)) })
              }
            />
            {read.lineHeight === null ? null : (
              <label className="dsh-canvas-design-field">
                <span>行高</span>
                <NumField value={read.lineHeight} min={1} onCommit={(lineHeight) => commit({ lineHeight })} />
              </label>
            )}
            <SelectField
              value={read.textAlignHorizontal}
              options={TEXT_ALIGNMENTS.map((align) => ({ value: align.id, label: align.label }))}
              onChange={(next) => commit({ textAlignHorizontal: next as TextAlignId })}
            />
          </Module>

          {/* 尺寸行为：自动宽高 / 自动高度 / 固定 / 截断——文本块会不会被内容撑开。 */}
          <Module title="尺寸行为">
            <SelectField
              value={read.textAutoResize}
              options={TEXT_AUTO_RESIZE.map((mode) => ({ value: mode.id, label: mode.label }))}
              onChange={(next) => commit({ textAutoResize: next as TextAutoResizeId })}
            />
          </Module>
        </>
      ) : null}

      <BordersModule items={read.strokes} commit={(strokes) => commit({ strokes })} />

      <EffectList items={shadows} kind="shadow" onChange={(items) => commitEffects({ shadows: items })} />
      <EffectList items={innerShadows} kind="inner-shadow" onChange={(items) => commitEffects({ inner: items })} />
      <EffectList items={blurs} kind="blur" onChange={(items) => commitEffects({ blurs: items })} />

      <button
        type="button"
        className="dsh-canvas-design-danger"
        onClick={() => {
          engine.deleteSelection()
          onAction()
        }}
      >
        删除图层
      </button>
    </div>
  )
}

// —— 属性面板的小部件：模块壳 / 下拉 / 勾选 / 边框与效果列表 ————————————————

/** 模块小节：标题行（可挂动作按钮，如「＋添加」）+ 内容。 */
function Module({ title, action, children }: { title: string; action?: ReactElement; children: ReactNode }): ReactElement {
  return (
    <div className="dsh-canvas-design-module">
      <div className="dsh-canvas-design-module-head">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

/** 选项下拉：样式与数字输入框同壳。 */
function SelectField({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}): ReactElement {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}

/** 勾选行：标题 + 开关。 */
function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }): ReactElement {
  return (
    <label className="dsh-canvas-design-check">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

/** css 颜色的不透明度（#rrggbbaa 的 aa；6 位视为 1）。 */
function alphaOf(css: string): number {
  return css.length === 9 ? Number.parseInt(css.slice(7), 16) / 255 : 1
}

/** 把不透明度写回 css 颜色（保留 6 位的 RGB 部分）。 */
function withAlpha(css: string, alpha: number): string {
  const byte = Math.round(Math.min(Math.max(alpha, 0), 1) * 255).toString(16).padStart(2, '0')
  return `${css.slice(0, 7)}${byte}`
}

/** 拾色器 onChange 里的保 alpha：input[type=color] 只吐 6 位，后缀从旧值搬过来。 */
function pickColor(picked: string, previous: string): string {
  return previous.length === 9 ? `${picked}${previous.slice(7)}` : picked
}

/** 边框模块：动态数组，每格一条描边（颜色/宽度/样式/描边类型/作用边）。 */
function BordersModule({ items, commit }: { items: DesignStrokeItem[]; commit: (items: DesignStrokeItem[]) => void }): ReactElement {
  const patch = (index: number, part: Partial<DesignStrokeItem>): void => {
    commit(items.map((item, i) => (i === index ? { ...item, ...part } : item)))
  }
  return (
    <Module
      title="边框"
      action={
        <button
          type="button"
          title="添加边框"
          onClick={() => commit([...items, { color: '#0F172A', weight: 1, align: 'INSIDE', dashed: false, side: 'ALL' }])}
        >
          ＋
        </button>
      }
    >
      {items.length === 0 ? <span className="dsh-canvas-design-module-empty">无边框</span> : null}
      {items.map((item, index) => (
        <div key={index} className="dsh-canvas-design-item">
          <div className="dsh-canvas-design-item-row">
            <input
              type="color"
              title="边框颜色"
              value={item.color.slice(0, 7)}
              onChange={(event) => patch(index, { color: pickColor(event.target.value, item.color) })}
            />
            <label className="dsh-canvas-design-field">
              <span>宽度</span>
              <NumField value={item.weight} min={0} onCommit={(weight) => patch(index, { weight })} />
            </label>
          </div>
          <div className="dsh-canvas-design-grid2">
            <SelectField
              value={item.dashed ? 'dashed' : 'solid'}
              options={[
                { value: 'solid', label: '实线' },
                { value: 'dashed', label: '虚线' },
              ]}
              onChange={(next) => patch(index, { dashed: next === 'dashed' })}
            />
            <SelectField
              value={item.align}
              options={[
                { value: 'INSIDE', label: '内描边' },
                { value: 'CENTER', label: '居中描边' },
                { value: 'OUTSIDE', label: '外描边' },
              ]}
              onChange={(align) => patch(index, { align: align as DesignStrokeItem['align'] })}
            />
          </div>
          <div className="dsh-canvas-design-item-row">
            <SelectField
              value={item.side}
              options={[
                { value: 'ALL', label: '四边' },
                { value: 'TOP', label: '顶部' },
                { value: 'RIGHT', label: '右侧' },
                { value: 'BOTTOM', label: '底部' },
                { value: 'LEFT', label: '左侧' },
              ]}
              onChange={(side) => patch(index, { side: side as DesignStrokeItem['side'] })}
            />
            <button
              type="button"
              className="dsh-canvas-design-item-remove"
              title="移除此边框"
              onClick={() => commit(items.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </Module>
  )
}

/**
 * 效果列表（阴影/内阴影/模糊共用）。`kind` 决定新格的默认值与展示字段：
 * 模糊只露类型与半径，阴影露颜色/偏移/半径/扩展/不透明。
 */
function EffectList({
  items,
  kind,
  onChange,
}: {
  items: DesignEffectItem[]
  kind: 'shadow' | 'inner-shadow' | 'blur'
  onChange: (items: DesignEffectItem[]) => void
}): ReactElement {
  const isBlur = kind === 'blur'
  const blank: DesignEffectItem = isBlur
    ? { type: 'LAYER_BLUR', color: '#00000000', x: 0, y: 0, radius: 8, spread: 0 }
    : { type: kind === 'shadow' ? 'DROP_SHADOW' : 'INNER_SHADOW', color: '#00000040', x: 0, y: 4, radius: 10, spread: 0 }
  const patch = (index: number, part: Partial<DesignEffectItem>): void => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...part } : item)))
  }
  const head = kind === 'shadow' ? '阴影' : kind === 'inner-shadow' ? '内阴影' : '模糊'
  return (
    <Module
      title={head}
      action={
        <button type="button" title={`添加${head}`} onClick={() => onChange([...items, blank])}>
          ＋
        </button>
      }
    >
      {items.length === 0 ? <span className="dsh-canvas-design-module-empty">无{head}</span> : null}
      {items.map((item, index) => (
        <div key={index} className="dsh-canvas-design-item">
          {isBlur ? (
            <div className="dsh-canvas-design-item-row">
              <SelectField
                value={item.type}
                options={[
                  { value: 'LAYER_BLUR', label: '层模糊' },
                  { value: 'BACKGROUND_BLUR', label: '背景模糊' },
                ]}
                onChange={(type) => patch(index, { type: type as DesignEffectItem['type'] })}
              />
              <button
                type="button"
                className="dsh-canvas-design-item-remove"
                title="移除此模糊"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
          ) : (
            <div className="dsh-canvas-design-item-row">
              <input
                type="color"
                title="颜色"
                value={item.color.slice(0, 7)}
                onChange={(event) => patch(index, { color: pickColor(event.target.value, item.color) })}
              />
              <button
                type="button"
                className="dsh-canvas-design-item-remove"
                title="移除此阴影"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
          )}
          <div className="dsh-canvas-design-grid2">
            <label className="dsh-canvas-design-field">
              <span>模糊</span>
              <NumField value={item.radius} min={0} onCommit={(radius) => patch(index, { radius })} />
            </label>
            {!isBlur ? (
              <label className="dsh-canvas-design-field">
                <span>扩展</span>
                <NumField value={item.spread} onCommit={(spread) => patch(index, { spread })} />
              </label>
            ) : null}
          </div>
          {!isBlur ? (
            <>
              <div className="dsh-canvas-design-grid2">
                <label className="dsh-canvas-design-field">
                  <span>X</span>
                  <NumField value={item.x} onCommit={(x) => patch(index, { x })} />
                </label>
                <label className="dsh-canvas-design-field">
                  <span>Y</span>
                  <NumField value={item.y} onCommit={(y) => patch(index, { y })} />
                </label>
              </div>
              <label className="dsh-canvas-design-field">
                <span>不透明</span>
                <NumField
                  value={Math.round(alphaOf(item.color) * 100)}
                  min={0}
                  max={100}
                  onCommit={(value) => patch(index, { color: withAlpha(item.color, value / 100) })}
                />
              </label>
            </>
          ) : null}
        </div>
      ))}
    </Module>
  )
}

// —— AI 标签页：通用提示词 + 内联选中图层 ————————————————————————————————

/** 内联进提示词的选中图层上限（再多就截断——提示词不是图层清单）。 */
const AI_INLINE_MAX = 8

/** 一枚内联图层标签要说的那点事实。 */
interface InlineLayer {
  id: string
  type: string
  name: string
  x: number
  y: number
  width: number
  height: number
  fill: string | null
}

/**
 * 选中图层那半截原文——**它就是发出去那一段提示词的开头**，输入框只是把它折成一枚标签。
 *
 * 与元素选择的定位同一套做法（`cutEditPrompt` + `PromptFold`）：折的只是画法，整串字符仍是
 * 值的一部分，发送时照原样吐回去，于是「缩量的提示词」与「屏幕上看见的那句话」不会分成
 * 两份事实。数组在前、要求在后，也是那个顺序：先说改哪儿，再说改成什么。
 */
function layerContext(layers: readonly InlineLayer[]): string {
  return `（内联的选中图层，请以这些 id 为目标用 canvas_design_edit 修改：${JSON.stringify(layers)}）\n\n`
}

/** 标签上那行字：选一个就报名字，选多个就报个数——一枚标签装不下八个名字。 */
function layerLabel(layers: readonly InlineLayer[]): string {
  if (layers.length === 1) {
    const only = layers[0]!
    return only.name === '' ? only.type : only.name
  }
  return `${layers.length} 个图层`
}

/** 悬停时把这一笔的全部内容摊开（标签本身只有一枚的宽度）。 */
function layerDetail(layers: readonly InlineLayer[], truncated: boolean): string {
  const lines = layers.map((layer) => `${layer.name} (${layer.type}) · id=${layer.id}`)
  if (truncated) lines.push(`（只内联了前 ${AI_INLINE_MAX} 个）`)
  return lines.join('\n')
}

/**
 * 值里的一段定位：**朝这几个图层说的那句话**。
 *
 * 一枚标签 = 一段（图层 + 紧跟其后的要求）。单选模式下永远只有一段——它跟着选区走（选中
 * 别人就重新瞄准）；多选模式下会一段段累积起来：选一批说一句、再选一批再说一句，每一段
 * 自己带着目标与人话。于是「一句话同时改好几个图层」与「好几句话分别改不同的图层」，在同一
 * 个框里都写得出来。
 */
interface AiChip {
  /** 这一段冲着哪些图层说。 */
  layers: readonly InlineLayer[]
  /** 这一段是从被截断的选区里来的（只进 tooltip）。 */
  truncated: boolean
}

/** 把一段定位接在值末尾：中间隔一个空行（值本来就是空的就是它自己）。 */
function appendChip(value: string, text: string): string {
  return value === '' ? text : `${value.replace(/\n+$/u, '')}\n\n${text}`
}

/**
 * 把值里现存的每一段折成一枚标签。
 *
 * 位置是**现找**的（上一段之后的第一处出现），不是存下来的偏移——用户在原文里删改过之后，
 * 存下来的偏移早就不是那一段了。找不到的那些段就不折：它不再是标签，这一笔也不再朝它说话
 * （见 `AiPromptTab` 的 targets）。
 */
function chipFolds(value: string, chips: readonly AiChip[]): PromptFold[] {
  const folds: PromptFold[] = []
  let cursor = 0
  for (const chip of chips) {
    const text = layerContext(chip.layers)
    const at = value.indexOf(text, cursor)
    if (at === -1) continue
    folds.push({
      at,
      length: text.length,
      reference: {
        id: text,
        type: 'element',
        label: layerLabel(chip.layers),
        detail: layerDetail(chip.layers, chip.truncated),
      },
    })
    cursor = at + text.length
  }
  return folds
}

function AiPromptTab({
  snapshot,
  engine,
  locked,
  onHold,
  selectMode,
}: DesignPanelsProps & DesignHoldProps & { selectMode: DesignSelectMode }): ReactElement {
  const chrome = useChrome()
  // 内联的图层上下文：每次渲染现取（与面板的「拉」数据流一致），发送时定格在这段值里。
  const inlined: InlineLayer[] = snapshot.selection
    .slice(0, AI_INLINE_MAX)
    .map((id) => engine.nodeProps(id))
    .filter((read): read is NonNullable<typeof read> => read !== null)
    .map((read) => ({
      id: read.id,
      type: read.type,
      name: read.name,
      x: Math.round(read.x),
      y: Math.round(read.y),
      width: Math.round(read.width),
      height: Math.round(read.height),
      fill: read.fill,
    }))
  const truncated = snapshot.selection.length > AI_INLINE_MAX
  const multi = selectMode === 'multi'

  /** 框里的**整段**值（各段定位 + 用户写的要求）。定位那几截折成标签画，值里一个字不少。 */
  const [value, setValue] = useState(() => (inlined.length === 0 ? '' : layerContext(inlined)))
  /** 值里那几段定位的目录（谁在这段标签里、截断过没有）——值才是真源，它只是索引。 */
  const [chips, setChips] = useState<readonly AiChip[]>(() =>
    inlined.length === 0 ? [] : [{ layers: inlined, truncated }],
  )
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  /**
   * 选区变了就动值——「标签跟着选中走」这件事的全部实现，也是它唯一的触发点。
   *
   * 两条路，各自对得上手上的一个动作：
   * - **重瞄最后一枚**：它后面那段文字还是空白（还没被说过话），换掉它不丢任何东西。单选
   *   永远走这条（框里始终是「一个目标 + 一句话」）；多选时最后一枚还没落定也走这条——
   *   「点了 A 再点 B，然后才写要求」因此写成一枚 [A,B] 的标签，而不是两枚。
   * - **另起一段**：最后一枚后面已经有人话了，那一段就落定；再选图层（多选）便是新的一段。
   *   新段只点**还没谈到的**图层——重复点名会让模型收到两遍同一枚标签。
   *
   * 清空选区什么都不动：那些标签是**说过的话的记录**，不是选区的影子。选区一没就把它们划
   * 掉，等于替用户删掉他写过的要求。
   */
  const selectionKey = snapshot.selection.join(',')
  const lastSelectionRef = useRef(selectionKey)
  useEffect(() => {
    if (selectionKey === lastSelectionRef.current) return
    lastSelectionRef.current = selectionKey
    if (inlined.length === 0) return
    // 值才是真源：先从目录里剔掉用户在原文里删掉的段——「谁还没被谈到」才数得准。
    const kept = chips.filter((chip) => value.includes(layerContext(chip.layers)))
    const last = kept[kept.length - 1]
    const lastText = last === undefined ? '' : layerContext(last.layers)
    const lastAt = lastText === '' ? -1 : value.indexOf(lastText)
    const settled = lastAt !== -1 && value.slice(lastAt + lastText.length).trim() !== ''
    if (!settled || !multi) {
      setChips([...kept.slice(0, -1), { layers: inlined, truncated }])
      setValue(
        lastAt === -1
          ? appendChip(value, layerContext(inlined))
          : value.slice(0, lastAt) + layerContext(inlined) + value.slice(lastAt + lastText.length),
      )
      return
    }
    const known = new Set(kept.flatMap((chip) => chip.layers.map((layer) => layer.id)))
    const fresh = inlined.filter((layer) => !known.has(layer.id))
    if (fresh.length === 0) return
    setChips([...kept, { layers: fresh, truncated }])
    setValue(appendChip(value, layerContext(fresh)))
  }, [selectionKey])

  /** 值里现存的几段：既是画出来的标签，也是这一笔要改的目标。 */
  const present = chips.filter((chip) => value.includes(layerContext(chip.layers)))
  const folds = chipFolds(value, present)
  const targets =
    present.length === 0
      ? [...snapshot.selection]
      : [...new Set(present.flatMap((chip) => chip.layers.map((layer) => layer.id)))]

  const send = (): void => {
    const prompt = value.trim()
    if (prompt === '' || sending || locked) return
    // 交给会话去改的就是**框里每一段标签点到的那几个图层**（去重）——在起手这一刻定格：起手
    // 之后画布锁住、选区也动不了，所以这批 id 与画面上圈住的那一块从头到尾是同一件事。
    // 一枚标签都不剩（用户把标签删了）就退回当前选区，与只有一句话的老行为同一条路。
    const ids = targets
    setSending(true)
    setError('')
    void chrome.bridge
      .sendMessage(chrome.projectId, chrome.cardId, prompt)
      .then(() => {
        setSending(false)
        // 发出去的那句话**留在框里**：刚写完的要求就是接下来要对照的东西（哪里没改到、
        // 哪句说重了），清掉它等于把刚才说过的话从眼前拿走。下一次要改的多半还是这批
        // 图层、还是接着这句话往下说——改一两个词再发，比重打一遍省事。
        onHold(ids)
      })
      .catch((reason: unknown) => {
        setSending(false)
        setError(reason instanceof Error ? reason.message : chrome.t('canvas.design.sendFailed'))
      })
  }

  return (
    <div className="dsh-canvas-design-ai">
      <div className="dsh-canvas-design-ai-box">
        <PromptInput
          className="dsh-canvas-design-ai-input"
          value={value}
          onChange={setValue}
          folds={folds.length === 0 ? undefined : folds}
          spellCheck={false}
          placeholder={
            multi
              ? '多选：选几个图层写一句，再选几个再写一句…'
              : '描述要做的修改，例如「把这个卡片改成深色主题，加上投影」…'
          }
          onKeyDown={(event) => {
            // ⌘/Ctrl+Enter 直接发送；面板表单的其余键节律不在此处。
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              send()
            }
          }}
        />
      </div>
      <div className="dsh-canvas-design-ai-foot">
        {/* 模型席位：与画布输入框底栏同一颗（`ui/model-picker.tsx`），同一份会话选择。 */}
        <ModelPicker
          bridge={chrome.bridge}
          projectId={chrome.projectId}
          cardId={chrome.cardId}
          sessionId={chrome.sessionId}
          kind="design"
          t={chrome.t}
        />
        <span className="dsh-canvas-spacer" />
        <button
          type="button"
          className="dsh-canvas-chipbtn"
          data-primary="true"
          disabled={locked || sending || value.trim() === ''}
          onClick={send}
        >
          {sending ? '发送中…' : '发送'}
        </button>
      </div>
      {locked ? (
        <p className="dsh-canvas-design-ai-notice">改稿进行中：画布暂时锁定，模型写完会自动刷新。</p>
      ) : null}
      {error !== '' ? <p className="dsh-canvas-design-ai-error">{error}</p> : null}
    </div>
  )
}

// —— 输入字段（从底部属性条迁来，节律不变） ————————————————————————————

/** 数字字段：blur / 回车提交，非法输入回弹到当前值。 */
export function NumField({
  value,
  min,
  max,
  onCommit,
}: {
  value: number
  min?: number
  max?: number
  onCommit: (value: number) => void
}): ReactElement {
  const ref = useRef<HTMLInputElement | null>(null)
  const send = (): void => {
    const input = ref.current
    if (input === null) return
    const parsed = Number(input.value)
    if (!Number.isFinite(parsed) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
      input.value = String(value)
      return
    }
    if (parsed !== value) onCommit(parsed)
  }
  return (
    <input
      ref={ref}
      type="number"
      defaultValue={value}
      min={min}
      max={max}
      onBlur={send}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          send()
        }
      }}
    />
  )
}

/** 文本字段：同 {@link NumField} 的提交节律；Esc 复原。 */
export function TextField({
  value,
  onCommit,
  onCancel,
  autoFocus,
}: {
  value: string
  onCommit: (value: string) => void
  onCancel?: () => void
  autoFocus?: boolean
}): ReactElement {
  const ref = useRef<HTMLInputElement | null>(null)
  const send = (): void => {
    const input = ref.current
    if (input === null || input.value === value) {
      onCancel?.()
      return
    }
    onCommit(input.value)
  }
  return (
    <input
      ref={ref}
      type="text"
      defaultValue={value}
      // 重命名场景下直接进编辑态；每次击键都可能丢焦点的话就没法改名了。
      autoFocus={autoFocus}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={send}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          send()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel?.()
        }
      }}
    />
  )
}
