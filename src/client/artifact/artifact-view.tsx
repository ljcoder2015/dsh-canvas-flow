/**
 * dsh-canvas — 全屏产物弹窗（F3.8）：外壳。
 *
 * 这个文件只做四件事：读一次产物、按 kind 挑出正文那个预览器、摆出对话框的骨架、把
 * Esc 与「关掉」在两层之间分派。**它不知道任何一种形态长什么样**——也不知道哪些形态
 * 能就地编辑、哪些有能对话的页面帧。那些都在各自的文件里：
 *
 * | 住在哪 | 管什么 |
 * |---|---|
 * | `use-artifact-payload.ts` | 打开时读一次产物；读回来的 payload 是整窗共享的事实 |
 * | `registry.ts` | kind → 预览器（只剩这一件事） |
 * | `viewers/*` | 每种形态自己怎么画、以及它有哪些按钮与状态 |
 * | `editing/*` | markdown / 纯文本的编辑面：草稿、自动保存、写被拒之后怎么办 |
 * | `element-pick/*` | 元素选择：开关、选中圈、提示词框、交给这张卡的会话 |
 * | `chrome.tsx` | 三个插槽与两条登记通道（Esc 分级、关闭闸）——下面那两个大头 |
 *
 * 从前这些是一个 1394 行的文件：分派是文件正中的一张表，能力是两条谓词（外壳查完表再
 * 替预览器画按钮），编辑与元素选择的状态机又各占两百多行。功能都在，但「加一种形态」得
 * 在三处都想起它。
 *
 * **外壳与预览器之间只剩两条通道**，都是「协商」而不是「声明」：
 *
 * - `escapeClaimed()`：Esc 一次退一层。开着模式、开着确认条的那一方先收这一下
 *   （`useEscapeLayer`），都没人认领才算「要关掉预览」。
 * - `closeHeld()`：× / 遮罩 / Esc 到最后都从这里过。手上有未保存草稿的那一方拦下来问
 *   一句（`useCloseGate`），免得一次误点丢掉一段话。
 *
 * 正文之外的三处位置（头部右侧、头部下方那一条、遮罩层）是**插槽**：外壳把位置摆好，
 * 谁往里放东西、放什么由预览器自己决定。这样的好处不是省了几行，而是外壳的正文里没有
 * 一个 `if` 是关于某个形态的。
 *
 * 编辑是这同一个弹窗的一个面，而不是第二个对话框：用户改的和刚读的是同一份东西，`draft`
 * 跳回预览也不丢，所以「看一眼渲染结果」从来不必付掉手上的工作，而未保存的关闭会先问一句
 * 而不是默默丢掉。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Translate } from '../ui/locales.ts'
import { ArtifactChromeProvider, useArtifactShell, type ArtifactModalBridge } from './chrome.tsx'
import { needsBlankText } from './editing/writable.ts'
import type { ViewerMode } from './editing/mode.ts'
import { seedBlankText } from './editing/seed-blank.ts'
import { viewerFor } from './registry.ts'
import { useArtifactPayload } from './use-artifact-payload.ts'

export type { ArtifactModalBridge } from './chrome.tsx'

/** 什么都不做的回调：`onSaved` 是可选的，而壳里的那一格必须有东西可叫。 */
const noop = (): void => undefined

export function ArtifactModal(props: {
  projectId: string
  cardId: string
  /**
   * 这张卡绑定的会话，或还没有会话时的 `''`——模型席位按它查「这张卡的会话下一次请求用
   * 哪个模型」（见 `chrome.tsx` 的 `sessionId`）。
   */
  sessionId: string
  bridge: ArtifactModalBridge
  t: Translate
  /** Open straight into the editor — the control strip's 手动输入 button. */
  initialMode?: ViewerMode
  /**
   * 去发布（v1.95）：发布页铺满画布、由画布自己渲染，弹窗只是把这件事交上去
   * ——通常是关掉弹窗、打开页面，所以这里只有回调、没有「初始状态」。
   */
  onPublish?: () => void
  /** A save landed; the board re-reads what it draws from this. */
  onSaved?: () => void
  /**
   * A coarse counter that moves when the sessions domain moves — the board's own
   * re-read trigger. Used here for one thing only: watching for the artifact an
   * armed pick produced, so a change that arrives from the conversation shows up
   * in the preview without the user closing and reopening it.
   */
  revision?: number
  onClose: () => void
}) {
  const { projectId, cardId, sessionId, bridge, t, initialMode, onPublish, onSaved, onClose, revision } = props

  const payload = useArtifactPayload({ projectId, cardId, bridge, t })
  const shell = useArtifactShell({
    projectId,
    cardId,
    sessionId,
    bridge,
    t,
    revision,
    openInEditor: initialMode === 'edit',
    openPublish: () => onPublish?.(),
    adopt: payload.adopt,
    saved: onSaved ?? noop,
    discard: onClose,
  })

  /**
   * Escape unwinds one layer at a time — 元素选择模式、那一笔选择、放弃确认、关闭：按下
   * Esc 的人要退的是「刚打开的那样东西」，不是整张预览。前几档由握着那些状态的预览器
   * 登记（`useEscapeLayer`），外壳只问「有没有人认领」，没人认领才是关闭。文本、设计与
   * 应用预览三面还各垫一档 `useEscapeSink`：在那三面里 Esc 退到底也不关窗。
   *
   * ⌘/Ctrl+S 不在这里：那是编辑面的和弦（`use-text-editing.ts` 自己听），而外壳现在已经
   * 不知道「这里有没有东西可以保存」。
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (shell.escapeClaimed()) return
      if (shell.closeHeld()) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // 依赖表里放的是两个**稳定**的函数，不是 `shell` 那个每次渲染都新的对象：换一次绑定
    // 就是解绑到重绑之间的一个空档，而键盘事件正好落在那里的那一按会丢。
  }, [onClose, shell.closeHeld, shell.escapeClaimed])

  /** ×、遮罩、Esc 的最后一步：先过关闭闸（有人拦下就先别关）。 */
  const close = (): void => {
    if (shell.closeHeld()) return
    onClose()
  }

  const { view, error, adopt } = payload

  /**
   * 「手动输入」落到一张还没有产物的文本卡上：先把那个文件造出来，再开编辑面。
   *
   * 卡片可以先于它的产物存在（F1.11），而这枚按钮的**含义**是「我要写字」——用户点它是
   * 想写，不是想看一句「产物不存在」。所以这里替他落一份空文件（真源仍是他自己敲的字），
   * 回读一次，编辑面自然就画出来了。判据在 `needsBlankText`（三条同时成立才落）。
   *
   * 三个细节都不是随便定的：
   *
   * - **只在这是第一次**（`seeded`）。落盘之后回读仍说不在（写被静默丢掉的极端情形）也
   *   不许再试第二遍：那会变成一次写盘循环，而用户手里并没有按任何东西。
   * - **落盘期间画的是「加载中」**，不是「产物不存在」：效果跑在首次绘制之后，不挡这一帧
   *   就会闪一句本来不成立的话。
   * - **写完叫一次 `onSaved`**：板上这张卡的「产物丢了」（F1.11）该跟着消掉，卡面也该重读。
   */
  const seeded = useRef(false)
  const [seeding, setSeeding] = useState(false)
  const [seedError, setSeedError] = useState('')
  useEffect(() => {
    if (view === undefined || seeded.current || !needsBlankText(view, initialMode === 'edit')) return
    seeded.current = true
    let cancelled = false
    setSeeding(true)
    setSeedError('')
    void (async () => {
      try {
        // 落空文件 + 回读的那两步在 `seed-blank.ts` 里（判据能拿假 wire 真跑一遍）。
        const next = await seedBlankText(bridge, projectId, cardId)
        if (cancelled) return
        adopt(next)
        onSaved?.()
      } catch (reason: unknown) {
        // 写不进去就说写不进去。退回「产物不存在」会让人以为是自己点错了。
        if (!cancelled) setSeedError(reason instanceof Error ? reason.message : t('canvas.error.unknown'))
      } finally {
        if (!cancelled) setSeeding(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adopt, bridge, cardId, initialMode, onSaved, projectId, t, view])

  let body: ReactElement
  if (error !== '' || seedError !== '') {
    body = <div className="dsh-canvas-viewer-note">{t('canvas.error', { message: error !== '' ? error : seedError })}</div>
  } else if (seeding || view === undefined) {
    // 唯一的加载态。它还有第二个用处：换一张卡时正文先回到这里，于是**预览器随之卸载**
    // ——草稿、选择模式这些跟着它的东西不会走到另一张卡上（见 `use-text-editing.ts`）。
    // 落一份空白的那一瞬也走这里：见上面那个效果（不挡这一帧就会闪一句「产物不存在」）。
    body = <div className="dsh-canvas-viewer-note">{t('canvas.viewer.loading')}</div>
  } else if (!view.present) {
    body = <div className="dsh-canvas-viewer-note">{t('canvas.viewer.absent')}</div>
  } else if (view.truncated && view.dataUrl === '' && view.text === '') {
    body = (
      <div className="dsh-canvas-viewer-note">
        {t('canvas.viewer.tooLarge')}
      </div>
    )
  } else {
    // 预览器由注册表挑：kind → 组件。弹窗不知道任何一种形态长什么样，也不需要知道。
    const Viewer = viewerFor(view.kind).component
    body = (
      <div className="dsh-canvas-viewer-body">
        {view.truncated ? <div className="dsh-canvas-viewer-truncated">{t('canvas.viewer.truncated')}</div> : null}
        <Viewer view={view} t={t} />
      </div>
    )
  }

  return (
    <ArtifactChromeProvider value={shell.chrome}>
      <div
        className="dsh-canvas-scrim is-viewer"
        ref={shell.scrimRef}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) close()
        }}
      >
        <div className="dsh-canvas-dialog dsh-canvas-viewer">
          <div className="dsh-canvas-dialog-head">
            {view?.name !== undefined && view.name !== '' ? view.name : (view?.file ?? cardId).split('/').pop()}
            <span className="dsh-canvas-card-meta">{view?.kind ?? ''}</span>
            <span className="dsh-canvas-spacer" />
            {/* 头部插槽：头部的布局在这里，头部里的按钮属于各个预览器。 */}
            <div className="dsh-canvas-slot" ref={shell.headerRef} />
            <button className="dsh-canvas-chipbtn" onClick={close} aria-label={t('canvas.action.collapse')}>
              ×
            </button>
          </div>
          {/* 条带插槽：写失败、放弃确认——都只在某些形态下存在。（元素选择的回话不走这里：
              它浮在帧上，因为一出现就要给一个已经画好的圈当邻居。） */}
          <div className="dsh-canvas-slot" ref={shell.bannerRef} />
          {body}
        </div>
      </div>
    </ArtifactChromeProvider>
  )
}
