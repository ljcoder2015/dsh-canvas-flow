/**
 * dsh-canvas — 元素选择（F3.14）：页面帧这一侧。
 *
 * 「点页面里的某个元素，然后告诉模型改它」这件事跨着两个地方：**页面里**住着探针（宿主
 * 注入的 `preview-picker.ts`），它只看得见帧内；**这里**住着工具、提示词与这张卡的会话
 * —— 框画在哪、提示词长什么样、发去哪里。而把这两头连起来的那扇窗只有一个：跑着页面的
 * 那个预览器（`viewers/deck-viewer.tsx`）。所以这个 hook 由**它**调用，不再由弹窗外壳代管：
 * 能力（有没有一个能对话的页面帧）就是「谁真的拿着那个 iframe」，不必再声明一次。
 *
 * 它管四样东西：一个开关（`armed`）、一笔选择（`held`）、一次投递（`send` + 回读产物），
 * 以及**这一笔的寿命**——从选中到最后一次改动落地，中间可能跨过一次「关掉预览又打开」。
 * 四者共享同一套坐标（框锚在用户点的那个元素上），所以它们不能拆成几个各拿一半的返回值：
 * 拆开只会让调用方把两个不同时刻的矩形拼在一起，圈出来的位置差着一条提示条的高度。
 *
 * 而「同一套坐标」里的那个**帧的矩形是活的量，不是快照**（`onMoved`）：一次选择可以从
 * 选中活到改动落地（几秒到十几秒），这中间帧头上会长出回话、窗口会被缩放、画布会被拉动
 * ——每一样都把帧挪个位置。锚定在旧坐标上的圈就会从元素上错开，而那些挪动**没有一个**
 * 是用户选的元素造成的。所以拿着 iframe 的那一方持续报告帧在哪，来了就在这里换掉这一笔
 * 的锚（`frameMoved` 挡住亚像素抖动，避免每次排版都白渲染一次）。
 *
 * 这一笔的寿命分三段，判据都在「产物变没变」上：
 *
 * | 段 | 手里的东西 | 页面 | 怎么出去 |
 * |---|---|---|---|
 * | 挑 | `armed` | 只读，滚轮仍归它 | 单击选中 |
 * | 写 | `held` + `draft` | 只读，**且一动不动**（探针进 hold） | 发送 / × / Esc |
 * | 等 | `held` + `awaiting`（圈上流光） | 同上 | 产物一变就自己收起 |
 *
 * 第二段与第三段都**跨得过去一次关闭**：`pending.ts` 按卡把这一笔记在模块级，重开时摆回
 * 原样（见那里的分工）。而「等」这一段之所以要留着框，不只是为了好看——用户此刻在说的是
 * 「这一段」，把框收掉他就没有对象可指了。
 *
 * 一提的是「一发一收」不对等：单击时探针**吞掉**那次 pointerdown/up/click，页面自己收不到
 * 这一击；而这一击的结果（`describe(node)`）回到父窗口之后，一律按不可信内容重建
 * （`readsPick`）。页面不能自己把选择模式打开，也不能替用户按下发送。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import {
  PICK_BOX_HEIGHT,
  PICK_BOX_WIDTH,
  buildEditPrompt,
  cutEditPrompt,
  frameMoved,
  placePickBox,
  type PickRect,
  type PickTarget,
} from '../../../core/artifact/kind/preview-picker.ts'
import type { ArtifactView } from '../../../types.ts'
import type { PromptFold } from '../../../core/artifact/prompt/prompt-blocks.ts'
import type { ArtifactChrome } from '../chrome.tsx'
import { PromptInput } from '../../ui/prompt/prompt-input.tsx'
import type { PromptInputHandle } from '../../ui/prompt/prompt-input.tsx'
import { dropPending, pendingKey, readPending, writePending } from './pending.ts'

/** 选中的元素，加上弹窗要围着它画的那些东西。 */
interface HeldPick {
  target: PickTarget
  /** The frame's box at the moment of the pick, in window coordinates. */
  frame: PickRect
  /**
   * The artifact text the pick was made against.
   *
   * Kept so the *held outline* can be withheld when the artifact has been
   * rewritten since: the frame reloads with the new page, the old coordinates
   * point at whatever happens to be there now, and an outline that names the
   * wrong element is worse than none. Compared during render rather than
   * tracked in state — the two facts are both already at hand.
   */
  viewText: string
  /**
   * 定位那半截**原文**：生成草稿那一次调用（`buildEditPrompt`，空要求）的返回值。
   *
   * 留着它，是因为输入面要把这几十行折成一枚标签，而「折哪一段」必须是**草稿自己**
   * 那一段——不是照着 `file` / `target` 再拼一份。这两者曾经是两个来源（草稿按
   * `view.file` 生成、切分时递的是 `cardId`），于是标签在真机上一次也没画出来过。
   * 谁生成的草稿，谁就把这段原文留着。
   */
  head: string
}

/**
 * 页面帧与探针之间的那条通道（生产者是这里，消费者是持有 iframe 的预览器）。
 *
 * 分得这么细是因为两头看得见的东西不同：这里握着工具、提示词与这张卡的会话，而只有拿着
 * `iframe` 的一方发得出消息（这一侧没有可 post 的窗口）。所以预览器拿到的是三件它能做的
 * 事，没有自己的状态。
 */
export interface PickChannel {
  /** Whether the frame should be picking right now. */
  readonly armed: boolean
  /** A click landed on an element inside the page; `frame` is the frame's own box. */
  onPicked(target: PickTarget, frame: PickRect): void
  /**
   * The frame's box changed, or was measured again and found where it was.
   *
   * 帧的位置只有拿着 iframe 的那一方量得到，而它是个**活的量**：回话长出来、窗口缩放、
   * 画布被拉动，都会把它挪走。手握一笔的时候每一样都得在这里换掉锚，否则圈会从元素上错开。
   * 没握手的时候调用方不会报（也不用量）。
   */
  onMoved(frame: PickRect): void
  /** The page relayed Escape — while armed it holds the keyboard, not the viewer. */
  onEscape(): void
}

export interface ElementPick {
  /** 这个产物有没有可选的页面：payload 完整（这不含「有没有帧」——调用方就是帧主）。 */
  available: boolean
  /** 选择模式开着吗（探针在页面里画不画十字、点不点得动就看它）。 */
  armed: boolean
  /**
   * 手里还攥着一笔选择（框开着）。
   *
   * 调用方要它，是因为这一笔决定**页面是哪个态**：框开着的时候帧冻结（探针进 hold），
   * 而这个判断只有这里知道。
   */
  holding: boolean
  toggle(): void
  /**
   * 只把模式关掉，手里那一笔不动。
   *
   * 与 {@link toggle} 分开：toggle 是用户按按钮，按下去意味着"这件事我不做了"，
   * 所以它顺手把回话与错误也清掉；而 Esc 要退的是**模式**这一层——框还没开的时候
   * 按 Esc 只该收起十字光标，不该顺手抹掉屏幕上那行"已交给会话"的通知。
   */
  disarm(): void
  /**
   * 放下这一笔：圈、框、草稿与「等产物」一起收。
   *
   * 它是**用户明确放手**的那条路（框上的 ×、Esc），所以连同 `pending.ts` 里那份记录
   * 一起丢掉——重开预览不会再把它摆回来。
   */
  clear(): void
  /** 交给预览器（也就是调用方自己）的通道。 */
  channel: PickChannel
  /** 框下方的回话：已交给会话 / 产物已更新。 */
  notice: string
  dismissNotice(): void
  /**
   * 选中圈 + 提示词框，都已在正确的坐标上；没有选择时是 `null`。
   *
   * 作为一个元素交出去（而不是让调用方拿坐标自己摆）是刻意的：圈只在「这一笔还对得上
   * 现在这一页」时画，而那个判断要同时看这一笔和当前 payload——两样都在这里，调用方拿
   * 过去只会再算一遍。
   */
  overlay: ReactElement | null
}

/** 页面帧预览器的元素选择。 */
export function useElementPick(input: { view: ArtifactView; chrome: ArtifactChrome }): ElementPick {
  const { view, chrome } = input
  const { projectId, cardId, bridge, t, revision, areaRef, adopt } = chrome
  /** 一笔选择记在哪个键下：这张卡。 */
  const key = pendingKey(projectId, cardId)
  /**
   * 上一次关掉预览时手里攥着的那一笔（没有就是 `undefined`）。
   *
   * 只在挂载时读一次：这一笔的归属是"这张卡"，而弹窗就是按卡挂载的（调用处给了 key，
   * 换卡即换一棵树）。读出来之后由下面那几个状态接手，此后一切都从状态走——这块表不参与
   * 渲染，只是一个"比组件活得久"的落点。
   */
  const [kept] = useState(() => readPending(key))
  const [armed, setArmed] = useState(false)
  const [held, setHeld] = useState<HeldPick | undefined>(() =>
    kept === undefined
      ? undefined
      : {
          target: kept.target,
          frame: kept.frame,
          viewText: kept.viewText,
          // 重开时按同一套输入重算——与生成草稿那次是同一个纯函数、同一份 file/target，
          // 得出的就是同一段原文（推不出来时前缀自然对不上，输入面退回纯文本）。
          head: buildEditPrompt({ file: view.file, target: kept.target, request: '' }),
        },
  )
  /** 提示词框里的全文。节点源码已经嵌在里面，用户接着往下写。 */
  const [draft, setDraft] = useState(() => kept?.draft ?? '')
  /** 已经发出去的那一份——与 `draft` 一比，就知道用户发完之后有没有又写了一句话。 */
  const [sent, setSent] = useState(() => kept?.sent ?? '')
  /**
   * 等这张卡的会话把产物改出来。
   *
   * 发了要求之后产物不会立刻变——会话要先跑一轮。这里不是轮询：画布的
   * `revision`（会话域的变动计数）每动一次才回读一次，回读到文本真的变了就收工。
   * 上限是给「会话跑完却没写这个文件」兜底：那时再读下去也只是白读。
   */
  const [awaiting, setAwaiting] = useState(() => kept?.awaiting ?? false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const awaitReads = useRef(0)
  /** 发出要求时产物的文本——回读到与它不同，才算改动落地。 */
  const awaitingFrom = useRef(kept?.from ?? '')
  /** 提示词框里的正文，用来把光标放到末尾（用户接在「改动要求：」后面补写）。 */
  const boxRef = useRef<PromptInputHandle | null>(null)
  /**
   * 最新的 `draft` / `sent`，专给回读那个 effect 读。
   *
   * 它们不能进那个 effect 的依赖表：它每跑一次就要读一遍产物，而它是由「会话域动了」
   * 触发的——把 `draft` 放进去等于每敲一个字就多读一次盘。经 ref 读，依赖表就只剩会话。
   */
  const latest = useRef({ draft, sent })
  useEffect(() => {
    latest.current = { draft, sent }
  })

  /**
   * Whether there is a running page to pick from.
   *
   * 只剩 payload 这一半了：「有没有一个能对话的页面帧」由**调用方就是帧主**这件事回答
   * —— 这个 hook 只可能被跑着 iframe 的预览器调用。剩下要问的是页面够不够完整：读了一半
   * 的页面里，探针报出来的元素，用户接下来的改动要求要对着一段谁也没看全的文本解释。
   */
  const available = view.present && !view.truncated

  /**
   * 记住这一笔，或者忘掉它。
   *
   * 「框还开着」与「改动还在跑」都值得跨过一次关闭；两者都没有时这条记录立刻消失——否则
   * 下次打开会重新摆出一个早就办完的框。
   */
  useEffect(() => {
    if (held === undefined) {
      dropPending(key)
      return
    }
    writePending(key, {
      target: held.target,
      frame: held.frame,
      viewText: held.viewText,
      draft,
      sent,
      awaiting,
      from: awaitingFrom.current,
    })
  }, [awaiting, draft, held, key, sent])

  /** 工具按钮：开/关元素选择模式。手里攥着一笔时按钮是禁用的（见 `deck-viewer`）。 */
  const toggle = useCallback((): void => {
    if (held !== undefined) return
    setError('')
    setNotice('')
    setArmed(!armed)
  }, [armed, held])

  /** 放下这一笔：撤掉高亮与提示词框，连「等产物」也一起停。 */
  const clear = useCallback((): void => {
    setHeld(undefined)
    setArmed(false)
    setDraft('')
    setSent('')
    setAwaiting(false)
    setError('')
    setNotice('')
  }, [])

  /** 只收起十字光标（Esc 的第一档，见 `ElementPick.disarm`）。 */
  const disarm = useCallback((): void => {
    setArmed(false)
  }, [])

  /**
   * 帧报到「点了这个元素」。
   *
   * 模式同时关掉：一击就是一次选择，探针自己也不再跟随鼠标（它随即进了 hold，页面继续
   * 只读并且冻住）。提示词是**在这里组装**的——节点源码此刻嵌进去，用户接着在末尾写要求，
   * 于是「改动范围」不是他描述出来的，而是这次点击本身。
   */
  const onPicked = useCallback(
    (target: PickTarget, frame: PickRect): void => {
      setArmed(false)
      setError('')
      setNotice('')
      // 新的一笔顶掉上一笔：上一笔的草稿与「等产物」都不再是屏幕上这个东西的事。
      setSent('')
      setAwaiting(false)
      // 定位原文在这里算**一次**：它就是草稿开头那一段，留着给输入面折标签用。
      const locator = buildEditPrompt({ file: view.file, target, request: '' })
      setHeld({ target, frame, viewText: view.text, head: locator })
      setDraft(locator)
    },
    [view.file, view.text],
  )

  /**
   * 帧挪窝了：把这一笔的锚换到它的新位置。
   *
   * 只在**真的**挪了才写回（`frameMoved` 挡掉亚像素）：这个回调是被「每一次提交之后都
   * 量一遍」叫着的，无条件 `setHeld` 会变成量一次、渲染一次、再量一次的死循环。
   * 返回原对象时 React 不重渲染，循环就断在这里。
   */
  const onMoved = useCallback((frame: PickRect): void => {
    setHeld((now) => (now === undefined || !frameMoved(now.frame, frame) ? now : { ...now, frame }))
  }, [])

  const channel = useMemo<PickChannel>(
    () => ({ armed, onPicked, onMoved, onEscape: clear }),
    [armed, clear, onMoved, onPicked],
  )

  /**
   * 把提示词交给这张卡的会话——它才是改文件的那一方。
   *
   * 与画布输入框走同一条通道（`card/sendMessage`），因为「让模型改这个产物」从来就只
   * 有一个入口。发完**框不收**：这一笔的事还没办完，圈与框留在原处（圈上亮起流光），
   * 挂一条回话，并开始等产物真的变。
   */
  const send = useCallback((): void => {
    const prompt = draft.trim()
    if (prompt === '' || sending || awaiting) return
    setSending(true)
    setError('')
    void bridge
      .sendMessage(projectId, cardId, prompt)
      .then(() => {
        awaitingFrom.current = view.text
        awaitReads.current = 0
        setSending(false)
        setSent(draft)
        setAwaiting(true)
        setNotice(t('canvas.pick.sent'))
      })
      .catch((reason: unknown) => {
        setSending(false)
        setError(reason instanceof Error ? reason.message : t('canvas.error.unknown'))
      })
  }, [awaiting, bridge, cardId, draft, projectId, sending, t, view.text])

  /**
   * 回读产物，直到它真的变了。
   *
   * 触发源是画布那个「会话域动了」的计数，不是定时器：会话每动一步才读一次，读到文本不同
   * 就收工（`setAwaiting(false)`），把这一笔收掉，并在框的位置说一句「已更新」。上限兜住
   * 「跑完了却没写这个文件」——那时再读下去只是白读。
   *
   * 收框有一处例外：用户在这期间又在框里写了下一句（`draft !== sent`）。那句话是他还没发
   * 出去的东西，替他合上框就等于替他丢掉它——所以框留着，只把「在跑」停掉。
   */
  useEffect(() => {
    if (!awaiting || revision === undefined || awaitReads.current >= 30) return undefined
    awaitReads.current += 1
    let cancelled = false
    bridge
      .readArtifact(projectId, cardId)
      .then((payload) => {
        if (cancelled) return
        adopt(payload)
        if (payload.text === awaitingFrom.current) return
        setAwaiting(false)
        setNotice(t('canvas.pick.updated'))
        const now = latest.current
        if (now.draft === now.sent) {
          setHeld(undefined)
          setDraft('')
          setSent('')
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [adopt, awaiting, bridge, cardId, projectId, revision, t])

  /**
   * 光标落在末尾，并且**末尾那一行看得见**。
   *
   * 用户是接着「改动要求：」往下写的，不该先自己按到行尾；同理，滚动条也不该停在开头——
   * 框里的正文（节点源码）常常比框高，只把焦点交过去不会把它滚出来，用户看到的是一个停在
   * 源码中间、要写的那一行在折叠线以下的框。所以这件事交给输入框自己那一只把手
   * （`PromptInputHandle.caretToEnd`）：光标与滚动一起摆好，这里不用知道正文是 textarea
   * 还是别的什么。
   */
  useEffect(() => {
    if (held === undefined) return
    const box = boxRef.current
    if (box === null) return
    box.caretToEnd()
  }, [held])

  /**
   * 提示词框落在哪：就在刚点的那个元素旁边。
   *
   * 量尺在这里读，是因为框与帧用的是**同一套视口坐标**——帧的位置来自回话那一刻的
   * `getBoundingClientRect`，而遮罩层（`areaRef`）就是「框不许落出去」的那块面积。
   */
  let overlay: ReactElement | null = null
  if (held !== undefined) {
    const holdStyle: CSSProperties = {
      left: `${held.frame.left + held.target.rect.left}px`,
      top: `${held.frame.top + held.target.rect.top}px`,
      width: `${held.target.rect.width}px`,
      height: `${held.target.rect.height}px`,
    }
    const area = areaRef.current?.getBoundingClientRect()
    const at =
      area === undefined
        ? {
            left: held.frame.left + held.target.rect.left,
            top: held.frame.top + held.target.rect.top + held.target.rect.height + 8,
          }
        : placePickBox({
            target: held.target.rect,
            frame: held.frame,
            area: { left: area.left, top: area.top, width: area.width, height: area.height },
            size: { width: PICK_BOX_WIDTH, height: PICK_BOX_HEIGHT },
          })
    const boxStyle: CSSProperties = {
      left: `${at.left}px`,
      top: `${at.top}px`,
      width: `${PICK_BOX_WIDTH}px`,
      height: `${PICK_BOX_HEIGHT}px`,
    }
    // 高亮框只在「这一笔还对得上现在这一页」时画：产物被重写过（帧已经换了一页），旧坐标
    // 指着的是别的东西，圈错人比不圈更糟。
    const holdLive = view.text === held.viewText
    // 定位那半截折成一枚**元素标签**（多模态引用的第四种长相）：几十行原文收成一行
    // 「◫ section.hero」，用户只看见自己在改哪个节点、随手就能整枚删掉。折的只是画法——
    // 发出去的提示词与从前逐字相同。切的是 `held.head`：**生成草稿那一次留下的原文**，
    // 不是照 file/target 再拼一份（那正是标签一直没画出来的原因）。对不上就整段按普通
    // 文本编辑：展示让路，值不动。
    const split = cutEditPrompt({ head: held.head, text: draft })
    const folds: PromptFold[] | undefined =
      split === undefined
        ? undefined
        : [
            {
              at: 0,
              length: split.head.length,
              reference: {
                id: split.head,
                type: 'element',
                label: held.target.label,
                detail: t('canvas.pick.blockDetail', { label: held.target.label, file: view.file }),
              },
            },
          ]

    overlay = (
      <>
        {/* 选中的那一圈：帧那边收起高亮之后，由这里把「改哪儿」一直画着——
            探针在页面里，页面一重载就没了；框是这里画的，两者才总是一致。

            改动跑起来时这一圈亮起**流光**，与卡片上那道是同一层、同一趟（`.dsh-canvas-shimmer`
            连同它的令牌一起复用）：动作只有一套语义——光在动 = 正在产出。区别只在于对象：
            卡片说的是「这张卡在生成」，这里说的正是页面里那一段在改。 */}
        {holdLive ? (
          <div className="dsh-canvas-pickhold" style={holdStyle} aria-hidden="true">
            {awaiting ? <span className="dsh-canvas-shimmer" /> : null}
            <span className="dsh-canvas-pickhold-tag">{held.target.label}</span>
          </div>
        ) : null}
        <div
          className="dsh-canvas-pickbox"
          style={boxStyle}
          role="dialog"
          aria-label={t('canvas.pick.title')}
        >
          <div className="dsh-canvas-pickbox-head">
            <span className="dsh-canvas-pickbox-tag">{held.target.label}</span>
            <span className="dsh-canvas-pickbox-file">{view.file}</span>
            <span className="dsh-canvas-spacer" />
            <button className="dsh-canvas-chipbtn" onClick={clear} aria-label={t('canvas.action.cancel')}>
              ×
            </button>
          </div>
          {/* 一个输入框装两样东西：**折起来的元素定位**（一枚内联标签，整枚可删）与用户
              写的要求。定位在值里就是那几十行原文，只是没画出来——所以「◫ 节点名」后面
              接的那句话，就是发出去的提示词末尾那一句。 */}
          <PromptInput
            className="dsh-canvas-pickbox-input"
            handleRef={boxRef}
            value={draft}
            folds={folds}
            spellCheck={false}
            onChange={setDraft}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                send()
              }
            }}
          />
          {error === '' ? null : (
            <div className="dsh-canvas-pickbox-error">{t('canvas.pick.failed', { message: error })}</div>
          )}
          <div className="dsh-canvas-pickbox-foot">
            <span className="dsh-canvas-pickbox-hint">
              {awaiting ? t('canvas.pick.waitingHint') : t('canvas.pick.hint')}
            </span>
            <button
              className="dsh-canvas-chipbtn"
              data-primary="true"
              disabled={sending || awaiting || draft.trim() === ''}
              onClick={send}
            >
              {awaiting ? t('canvas.pick.waiting') : sending ? t('canvas.pick.sending') : t('canvas.pick.send')}
            </button>
          </div>
        </div>
      </>
    )
  }

  return {
    available,
    armed,
    holding: held !== undefined,
    toggle,
    disarm,
    clear,
    channel,
    notice,
    dismissNotice: () => setNotice(''),
    overlay,
  }
}
