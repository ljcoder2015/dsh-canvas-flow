/**
 * dsh-canvas — `@` 候选弹窗的**壳**：一枚贴着那一枚 `@` 出现的浮层。
 *
 * 从 `card-overlay.tsx` 里请出来的那一层，只管三件事：**挂在哪**、**摆在哪**、**什么时候
 * 量**。里面装什么（候选行、缩略图、空态那句话）仍归调用方。
 *
 * ## 为什么是浮层、还得挂在画布根上
 *
 * 用户要的是「弹窗位置根据 `@` 符号定位」——那它就不能再是材料行里的一个盒子（从前它
 * 是 `left:0;right:0;bottom:100%`，永远贴在带子上沿，与光标在哪儿无关）。两件事挡在
 * 「按字符定位」前面：
 *
 * 1. **画布是 `transform: scale()` 出来的**。元素长在那一层里，`position:fixed` 会认那个
 *    transform 当包含块（缩放、平移一起跟着走），量出来的视口坐标写进去也不对。所以浮层
 *    `createPortal` 到**画布根**（`.dsh-canvas-root`，那层不在缩放里）——`fixed` 于是真的
 *    是视口坐标，与 `charRect` 量出来的那四个数是同一个坐标系。
 * 2. **它还挡在卡片上面**。卡片是各自 `position:absolute` 的兄弟节点，谁高谁低看 DOM 次序
 *    与 z-index；浮层挂在根上、带着自己的层级（见 `styles.ts` 的 `.dsh-canvas-refmenu`），
 *    于是不会被下一张卡片盖住，也不会被 `.dsh-canvas-body{overflow:hidden}` 裁掉。
 *
 * 挂根而不是挂 `<body>`：`--dsh-*` 那一整套变量只活在 `.dsh-canvas-root` 上，挂到 body
 * 上就是一个有形状、没有颜色的空盒子（宿主的主题令牌拿不到，`var(--dsh-card)` 全是空值）。
 *
 * ## 为什么量完再摆
 *
 * 菜单的高度随候选条数变（0～8 条、空态一行），宽度随卡片名变。只有真量过才知道「下面
 * 还放不放得下」——卡片贴着窗口底边时，带子下面根本没有 220px。落点算术在
 * `ref-popup.ts` 的 `placePopup`（纯，node 环境可测），这里只负责量、然后摆。
 *
 * 量之前那一帧是 `visibility:hidden`：`useLayoutEffect` 在浏览器绘制之前跑，摆好位置再
 * 现形，用户看不到它从 (0,0) 跳过来。
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { POPUP_GAP, placePopup } from './ref-popup.ts'
import type { PopupPlacement, QueryAnchor } from './ref-popup.ts'

/** 浮层的落点（视口坐标）。 */
type Placement = PopupPlacement

/** Props of the `@` reference popup. */
export interface RefPopupProps {
  /** 那一枚 `@` 在视口里的盒子；`null` = 没在写引用，什么都不出。 */
  anchor: QueryAnchor | null
  /**
   * 输入框正文的宿主元素。
   *
   * 只用来找**挂载点**（最近的画布根）——位置来自 {@link RefPopupProps.anchor}，不是
   * 量输入框量出来的。找不到根（比如这个组件有一天被搬到画布外）就挂 body：颜色会丢，
   * 但至少不静默地什么都不显示。
   */
  field: HTMLElement | null
  /** 无障碍名字（`role="listbox"`）。 */
  label: string
  children: ReactNode
}

/** 浮层挂到画布根上（理由见文件头）。 */
const ROOT_SELECTOR = '.dsh-canvas-root'

/** The `@` reference popup. */
export function RefPopup(props: RefPopupProps) {
  const { anchor, field, label, children } = props
  const box = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)

  /**
   * 量一次、摆一次。**没有依赖表**：候选条数一变菜单高度就变，而 `children` 每次渲染都是
   * 新对象——写依赖表要么漏摆、要么每帧都摆。这里靠下面的等值判断收住：落点没变就返回
   * 原对象，React 自己会跳过这次重渲染，不会转成死循环。
   */
  useLayoutEffect(() => {
    const element = box.current
    if (element === null || anchor === null) return
    const view = element.ownerDocument.defaultView
    const rect = element.getBoundingClientRect()
    const next = placePopup(
      anchor,
      { width: rect.width, height: rect.height },
      { width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 },
    )
    setPlacement((now) =>
      now !== null && now.left === next.left && now.top === next.top && now.flipped === next.flipped
        ? now
        : next,
    )
  })

  if (anchor === null) return null
  const target = field === null ? null : (field.closest(ROOT_SELECTOR) ?? field.ownerDocument.body)
  if (target === null) return null
  return createPortal(
    <div
      ref={box}
      className="dsh-canvas-menu dsh-canvas-refmenu"
      role="listbox"
      aria-label={label}
      data-flip-y={placement?.flipped === true ? 'true' : 'false'}
      style={{
        // 还没量到的那一帧先按「贴在 `@` 下面」摆着（它是隐藏的），量到之后换成真落点。
        left: placement?.left ?? anchor.left,
        top: placement?.top ?? anchor.bottom + POPUP_GAP,
        visibility: placement === null ? 'hidden' : undefined,
      }}
    >
      {children}
    </div>,
    target,
  )
}
