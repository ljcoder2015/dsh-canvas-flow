/**
 * dsh-canvas — 产物弹窗交给预览器的那个「壳」（F3.8 / F3.12 / F3.14）。
 *
 * 弹窗只有一副骨架：一栏头部、一栏条带、一块正文、一层遮罩。**谁往里面放东西、放什么、
 * 什么时候出现，是各预览器自己的事** —— markdown 放的是「预览/编辑」单选组与保存钮、
 * 还有未保存时的那条确认；页面帧预览器放的是元素选择钮、选中圈与提示词框；图片、视频、
 * 表格什么都不放，于是头上干干净净。
 *
 * 从前不是这样：「这个 kind 能不能就地编」「它的预览里有没有一个能对话的页面帧」是注册表
 * 里的两条**谓词** ——预览器声明能力，外壳查表，然后外壳替它把按钮画出来、把提示条摆好。
 * 能力写在一个文件、界面长在另一个文件，于是「加一种形态」还是得回到外壳里改那几处 `if`。
 * 现在外壳只提供**位置**（三个插槽）与**通道**（下面这几条），按钮连同它的判断与状态都在
 * 预览器自己的文件里，外壳一行都不用动。
 *
 * 四条通道各解决一件事，都不是「能力声明」而是「协商」：
 *
 * | 通道 | 谁有话说 | 为什么不能由外壳决定 |
 * |---|---|---|
 * | {@link useEscapeLayer} | 开着模式的那一方（先退它那一层，再关弹窗） | 只有它知道自己现在在第几层 |
 * | {@link useEscapeSink} | 不用 Esc 关窗的那几种形态（垫底收下这一下） | 外壳不知道用户在这个形态里想不想用 Esc 关 |
 * | {@link useCloseGate} | 手上有未保存草稿的那一方 | 外壳看不见草稿，问不出一句「真放弃吗」 |
 * | {@link Slot} | 三处插槽的所有者 | 按钮属于预览器，外壳不认识它们 |
 *
 * 遮罩层那块面积（`areaRef`）也是外壳给的：选中圈与提示词框按视口坐标摆，而「框不许落
 * 出去」的边界只有遮罩知道。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactElement, ReactNode, RefObject } from 'react'
import type { ArtifactView } from '../../types.ts'
import type { Translate } from '../ui/locales.ts'
import type { ModelBridge } from '../ui/model/model-picker.tsx'
import { claimFirst, type Claim } from './chrome-stack.ts'

/**
 * 弹窗用得到的那几个 Remote 方法。
 *
 * 结构上与 `CanvasBridge` 相容。前三个是弹窗自己读写的产物通道；模型那四个（{@link ModelBridge}）
 * 是**给预览器里的模型席位**用的——设计预览的 AI 标签页要和画布输入框选出同一个模型，
 * 就得走同一条会话选择通道（见 `ui/model-picker.tsx`）。四个都不是新增的远端能力：它们
 * 都长在 `CanvasBridge` 上，这里只是把类型写全，好让预览器不必认识整个画布桥。
 */
export interface ArtifactModalBridge extends ModelBridge {
  readArtifact(projectId: string, cardId: string): Promise<ArtifactView>
  writeText(projectId: string, cardId: string, content: string): Promise<unknown>
  /** Hand a picked element's edit request to the card's conversation (F3.14). */
  sendMessage(projectId: string, cardId: string, prompt: string): Promise<unknown>
}

/** 三处插槽的挂载点；没挂上（`null`）时往里放东西的预览器什么也不画。 */
export interface ChromeSlots {
  /** 头部右侧：操作按钮与状态文案。 */
  header: HTMLElement | null
  /** 头部下方那一条：回话、错误、放弃确认。 */
  banner: HTMLElement | null
  /** 遮罩层：坐标与它同一套的浮件（选中圈、提示词框）。 */
  overlay: HTMLElement | null
}

/** 预览器能看到的全部外壳。 */
export interface ArtifactChrome {
  projectId: string
  cardId: string
  /**
   * 这张卡绑定的会话，或还没有会话时的 `''`。
   *
   * 预览器自己不需要会话，但**模型席位需要**：会话选择是按会话存的，问「下一次请求用哪个
   * 模型」就得拿得出那个 id（`''` 也有意义，见 `ui/model-picker.tsx` 的补种那一段）。
   */
  sessionId: string
  bridge: ArtifactModalBridge
  t: Translate
  /** 会话域的变动计数（画布自己的重读触发器）。 */
  revision: number | undefined
  /** 弹窗是被控制带的「手动输入」打开的：文本节点直接开在编辑面。 */
  openInEditor: boolean
  /** 「框不许落出去」的那块面积。 */
  areaRef: RefObject<HTMLElement>
  slots: ChromeSlots
  /** 采用一份新读回来的产物，预览跟着换。 */
  adopt(payload: ArtifactView): void
  /** 一次写入落地了：画布据此重读它画的东西。 */
  saved(): void
  /** 放弃手上的改动，关掉弹窗（不再问）。 */
  discard(): void
  /** 登记一档 Esc，返回注销。后登记的先生效。 */
  takeEscape(claim: Claim): () => void
  /** 登记一道关闭闸，返回注销。后登记的先生效。 */
  holdClose(claim: Claim): () => void
}

const ChromeContext = createContext<ArtifactChrome | null>(null)

/** 预览器读它拿桥、插槽、归属与两条通道。挂在弹窗之外是写错了。 */
export function useChrome(): ArtifactChrome {
  const chrome = useContext(ChromeContext)
  if (chrome === null) throw new Error('dsh-canvas: 预览器必须挂在产物弹窗里')
  return chrome
}

/**
 * 把节点挂进某个插槽。
 *
 * 走 portal 而不是让调用方把元素交上去，是因为**位置在外壳手里、内容在预览器手里**：
 * 头部那一栏是弹窗的布局，而按钮是预览器的。React 的 portal 只换 DOM 的落点，事件与
 * 上下文仍沿 React 树走，所以插槽里的按钮照样读得到同一个壳。
 */
export function Slot({ at, children }: { at: keyof ChromeSlots; children: ReactNode }): ReactElement | null {
  const target = useChrome().slots[at]
  if (target === null) return null
  return createPortal(children, target)
}

/**
 * 登记一档 Esc。
 *
 * `active` 是「这一档现在在不在最上面」，不是「能不能用」：Esc 一次退一层 —— 选元素的
 * 时候它退的是选择模式，框开着的时候退的是那一笔，放弃确认开着的时候收起确认条，都没有
 * 才算「要关掉预览」。这个顺位只有握着这些状态的一方说得清，所以由它登记。
 */
export function useEscapeLayer(active: boolean, onEscape: () => void): void {
  const { takeEscape } = useChrome()
  /**
   * 登记一次就够，读的永远是最新一次渲染的那份状态。
   *
   * 经 ref 而不是把 `active` / `onEscape` 放进依赖：后者会让每敲一个字就注销重登记
   * 一次，而登记是在事件处理里被遍历的那一摞——中间那个窗口正好按键落下就会漏掉一下。
   */
  const latest = useRef({ active, onEscape })
  useEffect(() => {
    latest.current = { active, onEscape }
  })
  useEffect(
    () =>
      takeEscape(() => {
        const now = latest.current
        if (!now.active) return false
        now.onEscape()
        return true
      }),
    [takeEscape],
  )
}

/**
 * 登记一档**垫底**的 Esc：谁都不认领时由它收下，于是这张预览里 Esc 不再是「关掉」的快捷键。
 *
 * 处理者是**从后往前**问的（`chrome-stack.ts`），后登记的在上面——所以开着模式、开着确认条
 * 的预览器仍先用 Esc 退自己那一层，轮到这一档才是最后一问：按 Esc 的人要退的是手头那样
 * 东西，不是整张预览。关掉于是只剩 × 与点遮罩两条路。
 *
 * 由此也定了调用位置：它**必须先于**同一张预览里别的 `useEscapeLayer`——登记顺序就是顺位。
 */
export function useEscapeSink(): void {
  const { takeEscape } = useChrome()
  useEffect(() => takeEscape(() => true), [takeEscape])
}

/**
 * 登记一道关闭闸。
 *
 * 关闭是外壳的动作（×、Esc、点遮罩到最后都走它），但「现在关掉会不会丢东西」只有握着
 * 草稿的那一方知道。返回 `true` = 先别关，我去问一句 —— 问出来的那条确认由它自己画。
 */
export function useCloseGate(hold: () => boolean): void {
  const { holdClose } = useChrome()
  const latest = useRef(hold)
  useEffect(() => {
    latest.current = hold
  })
  useEffect(() => holdClose(() => latest.current()), [holdClose])
}

/** 外壳要用的一切：给出去的那份 `chrome`，三处插槽的 ref，以及两条通道的出口。 */
export interface ArtifactShell {
  chrome: ArtifactChrome
  /** 头部插槽的挂载点（回调 ref）。 */
  headerRef(node: HTMLElement | null): void
  /** 条带插槽的挂载点。 */
  bannerRef(node: HTMLElement | null): void
  /** 遮罩层：既是插槽，也是量尺（`areaRef`）。 */
  scrimRef(node: HTMLElement | null): void
  /** Esc 的最后一问：`true` = 有人收下了这一下。 */
  escapeClaimed(): boolean
  /** 关闭的最后一问：`true` = 有人拦下了（它去问用户）。 */
  closeHeld(): boolean
}

export interface ArtifactShellInput {
  projectId: string
  cardId: string
  sessionId: string
  bridge: ArtifactModalBridge
  t: Translate
  revision?: number
  openInEditor: boolean
  adopt(payload: ArtifactView): void
  saved(): void
  discard(): void
}

/**
 * 外壳这一侧的那半边。
 *
 * 只做三件事：把三处插槽钉出来、把两条登记通道摊开、把调用点给的那几个回调（每次渲染
 * 都是新的行内箭头）按 ref 收住 —— 否则它们会顺着 `chrome` 流到每个预览器的依赖表里，
 * 让「登记一次」变成「每渲染一次就重登记」。
 */
export function useArtifactShell(input: ArtifactShellInput): ArtifactShell {
  const { projectId, cardId, sessionId, bridge, t, revision, openInEditor, adopt, saved, discard } = input
  const [header, setHeader] = useState<HTMLElement | null>(null)
  const [banner, setBanner] = useState<HTMLElement | null>(null)
  /** 遮罩层：量尺是 ref（量的是当下那一刻的矩形），插槽是 state（portal 要一个落点）。 */
  const areaRef = useRef<HTMLElement | null>(null)
  const [overlay, setOverlay] = useState<HTMLElement | null>(null)
  const escapes = useRef<Claim[]>([])
  const holds = useRef<Claim[]>([])
  const latest = useRef({ adopt, saved, discard })
  useEffect(() => {
    latest.current = { adopt, saved, discard }
  })

  const take = useCallback((stack: Claim[], claim: Claim): (() => void) => {
    stack.push(claim)
    return () => {
      const at = stack.indexOf(claim)
      if (at >= 0) stack.splice(at, 1)
    }
  }, [])
  const takeEscape = useCallback((claim: Claim) => take(escapes.current, claim), [take])
  const holdClose = useCallback((claim: Claim) => take(holds.current, claim), [take])

  const headerRef = useCallback((node: HTMLElement | null) => setHeader(node), [])
  const bannerRef = useCallback((node: HTMLElement | null) => setBanner(node), [])
  const scrimRef = useCallback((node: HTMLElement | null) => {
    areaRef.current = node
    setOverlay(node)
  }, [])
  const escapeClaimed = useCallback(() => claimFirst(escapes.current), [])
  const closeHeld = useCallback(() => claimFirst(holds.current), [])
  /**
   * 这三个经 ref 走、而且本身是稳定的：`adopt` 会一路流进编辑器**自动保存那个 effect 的
   * 依赖表**（`use-text-editing.ts` 的 `flush`），它每次渲染换个新函数就等于每渲染一次给
   * 保存的节拍重新上弦 —— 停手 800ms 会变回「5 秒内某个时候」。
   */
  const adoptPayload = useCallback((payload: ArtifactView) => latest.current.adopt(payload), [])
  const savedNow = useCallback(() => latest.current.saved(), [])
  const discardNow = useCallback(() => latest.current.discard(), [])

  const chrome = useMemo<ArtifactChrome>(
    () => ({
      projectId,
      cardId,
      sessionId,
      bridge,
      t,
      revision,
      openInEditor,
      areaRef,
      slots: { header, banner, overlay },
      adopt: adoptPayload,
      saved: savedNow,
      discard: discardNow,
      takeEscape,
      holdClose,
    }),
    [
      adoptPayload,
      banner,
      bridge,
      cardId,
      discardNow,
      header,
      holdClose,
      openInEditor,
      overlay,
      projectId,
      revision,
      savedNow,
      sessionId,
      t,
      takeEscape,
    ],
  )

  return { chrome, headerRef, bannerRef, scrimRef, escapeClaimed, closeHeld }
}

/** 把 {@link ArtifactShell} 给的壳交给它下面那棵子树。 */
export const ArtifactChromeProvider = ChromeContext.Provider
