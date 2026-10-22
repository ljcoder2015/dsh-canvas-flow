/**
 * dsh-canvas — HTML 页面（应用 app）共用的页面预览器。
 *
 * 三个 kind 一个预览：入口页的标记跑在一个沙箱 iframe 里。`allow-scripts` 而不给
 * `allow-same-origin` 是那个折中——幻灯片要靠自己的 JS 翻页，而文档待在 opaque
 * origin 里，够不到宿主页面、它的存储和它的 cookie。
 *
 * The two popup permissions are the other half of that compromise, and they are
 * about *links*: a page whose only exit is a link would otherwise be a page you
 * cannot leave. `allow-popups` unblocks `target="_blank"` (without it Chrome
 * refuses with "the request was made in a sandboxed frame whose 'allow-popups'
 * permission is not set"), and `allow-popups-to-escape-sandbox` makes the window
 * that opens a normal one — a sandboxed popup keeps the opaque origin, so the
 * far site would run without its own storage or session. The preview's own
 * frames stay exactly as locked down as before; only the window the *user* asked
 * for is free.
 *
 * `postMessage` from the frame is the one channel left open, and it is treated
 * as untrusted content: the sender is checked against this frame's own window,
 * the shape is checked field by field, and nothing is done with it beyond
 * showing a sentence — the guard injected into the page (`PREVIEW_GUARD_SOURCE`
 * in `core/artifact/webapp.ts`) is what acts, so the viewer never opens anything
 * on a page's say-so.
 *
 * The same channel carries the element picker (F3.14), and it is checked the
 * same way — but the two directions are not symmetrical. The **host injects**
 * the probe into the page's text (`injectPreviewPicker`), and the viewer only
 * ever names the state it wants the frame to be in (aiming / holding a pick /
 * dormant); the page cannot arm itself, and a message from any window other
 * than this frame's is dropped. What comes back is read through `readsPick`,
 * which rebuilds the payload from validated fields rather than trusting the
 * page's object.
 *
 * 元素选择的另外半边（工具按钮、选中圈、提示词框、交给会话）也由**这个文件**叫起来
 * （`useElementPick`），因为「有没有一个能对话的页面帧」这个问题只有拿着 iframe 的一方
 * 答得出：帧就是它画的。按钮挂进头部插槽、圈与框挂进遮罩层插槽——弹窗外壳不认识它们，
 * 也不需要认识。
 *
 * 而**回话不走任何插槽**：它浮在帧区自己那一层（`.dsh-canvas-frame-notestack`），因为
 * 它一出现就在给一个已经画好的圈当邻居——排进流里（曾经挂在条带插槽）会把帧顶走一整条，
 * 圈与框立刻从元素上错开。同理，帧的矩形在这一笔活着的时候要**持续重报**（`onMoved`），
 * 它是锚，而锚不能是快照。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isHtmlKind } from '../../../core/artifact/kind/kind-registry.ts'
import {
  isPickEscape,
  pickMode,
  pickOrder,
  readsPick,
} from '../../../core/artifact/kind/preview-picker.ts'
import { PREVIEW_CHANNEL } from '../../../core/artifact/kind/webapp.ts'
import { Slot, useChrome, useEscapeLayer, useEscapeSink } from '../chrome.tsx'
import { useElementPick } from '../element-pick/element-pick.tsx'
import type { ViewerProps, ViewerRegistration } from './types.ts'

/** 页面预览器：产物在一个沙箱 iframe 里跑起来。 */
export function DeckViewer({ view, t }: ViewerProps) {
  const chrome = useChrome()
  const pick = useElementPick({ view, chrome })
  const frame = useRef<HTMLIFrameElement | null>(null)
  /** The href of a link the guard refused to follow; `''` when there is none. */
  const [blocked, setBlocked] = useState('')
  const channel = pick.channel
  const armed = channel.armed
  /** 手里攥着一笔（框开着）：这一笔决定帧在哪个态——只读并且**冻住**。 */
  const holding = pick.holding
  /**
   * The latest pick channel, held rather than depended on.
   *
   * The hook hands it over as a memoized object, but the message listener below
   * must not re-subscribe when it moves (that window between unsubscribe and
   * subscribe is a window where a click is lost).
   */
  const channelRef = useRef(channel)
  useEffect(() => {
    channelRef.current = channel
  })
  /** 帧此刻在父页面里的矩形，报给握着这一笔的那一方当锚（见下面那两处注释）。 */
  const reportFrame = useCallback((): void => {
    const node = frame.current
    if (node === null) return
    const box = node.getBoundingClientRect()
    channelRef.current.onMoved({ left: box.left, top: box.top, width: box.width, height: box.height })
  }, [])
  /**
   * 手里攥着一笔的时候，帧的矩形是**活的量，不是快照**。
   *
   * 圈与提示词框拿这个矩形当锚，而帧所在的那一栏是弹窗的最后一个可伸缩行：**任何**排到它
   * 上方的东西（我们的回话、截断提示、窗口被缩放、画布被拉动）都会把它整个挪走或压扁，
   * 覆盖层自己不会知道。所以每次提交量一遍——我们自己的界面变了，就是这一次提交。
   *
   * `useLayoutEffect` 是这里的关键：量到新位置到重渲染之间不能让浏览器画一帧，否则圈会
   * 先错开一下再跳回去。代价是一次 `getBoundingClientRect`，而且只在握着一笔时才量。
   */
  useLayoutEffect(() => {
    if (holding) reportFrame()
  })
  /**
   * 上面那一遍只盖得住**我们自己**引起的排版变化。另外两条路得挂监听：窗口缩放（帧整块
   * 换尺寸）与帧自己的大小变化（子元素撑开、被上方的东西压扁）。两者都在手里有东西可锚
   * 的时候才挂着。
   */
  useEffect(() => {
    if (!holding) return undefined
    const node = frame.current
    if (node === null) return undefined
    const observer = new ResizeObserver(reportFrame)
    observer.observe(node)
    window.addEventListener('resize', reportFrame)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', reportFrame)
    }
  }, [holding, reportFrame])
  // A re-read (an edit saved, the card's file written again) replaces the text
  // and reloads the frame; the note belongs to the page that is gone.
  useEffect(() => {
    setBlocked('')
  }, [view.text])
  // 这张预览不用 Esc 关窗：垫底那一档由 sink 收下（见 chrome 的 useEscapeSink），下面那层照旧优先。
  useEscapeSink()
  /**
   * Esc 在帧这边退的是「刚打开的那样东西」：模式开着就收起十字光标，手里攥着一笔就撤掉
   * 那一笔。两者互斥（点完一下模式就关了），所以是一档；而它先于「关掉预览」——退的是刚
   * 打开的那样东西，不是整张预览。
   */
  useEscapeLayer(armed || pick.holding, () => (armed ? pick.disarm() : pick.clear()))
  /**
   * Tell the frame what to be.
   *
   * Three states, not two (`pickMode`): aiming, or holding a pick (the box is
   * open — the page stays read-only *and* frozen), or dormant. The order is a
   * target state rather than a toggle, and it is re-sent on every text change as
   * well as on those two flags: a reloaded frame starts dormant (the probe is
   * injected into each page as inert), so a viewer that was armed when the
   * artifact was rewritten has to re-arm the page it just received. The message
   * is idempotent on the frame's side.
   */
  const tell = useCallback((): void => {
    const target = frame.current?.contentWindow
    if (target === null || target === undefined) return
    target.postMessage(pickOrder(pickMode(armed, holding)), '*')
  }, [armed, holding])
  useEffect(() => {
    tell()
  }, [tell, view.text])
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const source = frame.current?.contentWindow
      // The frame's own window, not merely *a* frame: a page elsewhere on the
      // host must not be able to put words in this viewer's mouth.
      if (source === null || source === undefined || event.source !== source) return
      const data = event.data as { channel?: unknown; kind?: unknown; href?: unknown } | null
      if (typeof data !== 'object' || data === null) return
      if (data.channel !== PREVIEW_CHANNEL) return
      if (isPickEscape(data)) {
        channelRef.current.onEscape()
        return
      }
      const target = readsPick(data)
      if (target === undefined) {
        if (data.kind !== 'local-link') return
        if (typeof data.href !== 'string') return
        setBlocked(data.href.slice(0, 200))
        return
      }
      const box = frame.current?.getBoundingClientRect()
      if (box === undefined) return
      channelRef.current.onPicked(target, { left: box.left, top: box.top, width: box.width, height: box.height })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  return (
    <>
      <Slot at="header">
        {pick.available ? (
          // 元素选择（F3.14）：按下去，页面里的鼠标就成了一支「点哪儿选哪儿」的笔。
          // 是切换按钮，所以状态由 aria-pressed 与那点实心色说，不去改按钮上的字。
          <button
            type="button"
            className="dsh-canvas-chipbtn dsh-canvas-picktool"
            data-on={armed ? 'true' : 'false'}
            aria-pressed={armed}
            // 手里攥着一笔时按不动：重新选会把「改这一段」这句话连同圈一起顶掉，而它可能
            // 正跑着。要放手有框上的 × 与 Esc，两条路都比按这个按钮更明确。
            disabled={holding}
            title={holding ? t('canvas.pick.repick') : t('canvas.pick.tool')}
            onClick={pick.toggle}
          >
            {t('canvas.pick.tool')}
          </button>
        ) : null}
      </Slot>
      {/* 帧区是**一个定位上下文**：提示条要么排在流里（链接闸门那条，它说的是页面自己
          的事）、要么浮在上面（元素选择那两条）。浮着的那两条见下面那处注释。 */}
      <div className="dsh-canvas-frame-area">
        {blocked === '' ? null : (
          <div className="dsh-canvas-frame-note">
            <span className="dsh-canvas-frame-notetext">{t('canvas.viewer.linkBlocked', { href: blocked })}</span>
            <button
              className="dsh-canvas-chipbtn"
              onClick={() => setBlocked('')}
              aria-label={t('canvas.viewer.linkBlocked.dismiss')}
            >
              ×
            </button>
          </div>
        )}
        {/* 元素选择的两条提示，**都浮在帧上，不占排版位**（`.dsh-canvas-frame-notestack`）。
            不占位不是省地方，是这条判据：圈与提示词框拿帧的位置当锚，而它们是在这一笔出生
            那一刻量好的——提示条只要排进流里，就会在出现/消失的那一瞬把帧顶走一整条，圈
            与框便整个错开（用户报的就是这个：发送后回话冒出来，选中区偏了）。

            两条互斥（回话只在模式关着时存在，模式一开回话就被清掉），排在同一个浮层里只是
            为了它们万一同时在场也有先来后到。 */}
        <div className="dsh-canvas-frame-notestack">
          {armed ? (
            // 探针在页面里画的是「鼠标底下是谁」，这句话说的是「接下来会发生什么」——
            // 用户按下按钮之后如果只在页面里看到一个十字光标，没人告诉他这一击不会
            // 真的按到那个按钮上。
            <div className="dsh-canvas-frame-note is-pick">
              <span className="dsh-canvas-frame-notetext">{t('canvas.pick.armed')}</span>
            </div>
          ) : null}
          {pick.notice === '' ? null : (
            // 元素选择的回话：发出去是一件事、产物真的变了是另一件事，两句话都说出来，
            // 否则用户关掉框之后无从知道刚才那一下有没有发生。
            <div className="dsh-canvas-viewer-picked">
              <span className="dsh-canvas-frame-notetext">{pick.notice}</span>
              <span className="dsh-canvas-spacer" />
              <button
                className="dsh-canvas-chipbtn"
                onClick={pick.dismissNotice}
                aria-label={t('canvas.action.collapse')}
              >
                ×
              </button>
            </div>
          )}
        </div>
        <iframe
          ref={frame}
          className="dsh-canvas-frame"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          srcDoc={view.text}
          title={view.file}
          onLoad={tell}
        />
      </div>
      {/* 选中圈与提示词框：位置是视口的，落点归遮罩层（`areaRef` 量的就是它）。 */}
      <Slot at="overlay">{pick.overlay}</Slot>
    </>
  )
}

/**
 * 注册项：HTML 页面（应用 app）共用同一个 iframe 预览。
 *
 * `claims` 直接拿 `isHtmlKind` —— kind 清单只有一份，在宿主的
 * `core/artifact/kind-registry.ts`。这条从前是两份手抄的清单，而「漏掉一个 kind」的后果
 * 之一正是某个 HTML 产物丢了它的样式表。
 *
 * 「有页面帧所以能做元素选择」不再是这里的一条声明：帧就是上面那个组件画的，所以元素选择
 * 的工具与状态也住在同一条记录里（`useElementPick`）。注册项只剩下认领哪些 kind。
 */
export const deckViewer: ViewerRegistration = {
  id: 'deck',
  component: DeckViewer,
  claims: isHtmlKind,
}
