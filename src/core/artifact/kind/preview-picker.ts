/**
 * dsh-canvas — 预览里的**元素选择**：在跑起来的页面上点一个元素，把它的源码
 * 嵌进提示词，交给这张卡自己的会话去改（F3.14）。
 *
 * 这个模块与 `webapp.ts` 的链接闸门同源同构：**一份脚本源码 + 一段注入 + 一组
 * 纯决策**，host 把脚本追加进预览文本，客户端把帧回话读成结构化事件。之所以必
 * 须走 `postMessage`，是因为预览帧是 `sandbox="allow-scripts"` **没有**
 * `allow-same-origin` 的不透明源——父子两边互相看不见 DOM，这条通道是唯一的。
 *
 * 分工按「谁看得见什么」切：
 *
 * - **帧内**（{@link PREVIEW_PICKER_SOURCE}）：只有它知道鼠标底下是哪个元素。
 *   悬停高亮、深层命中（穿 open shadow root）、把元素描述成
 *   {@link PickTarget} 回话——全部在页面自己那侧完成。
 * - **帧外**（本模块的纯函数 + `element-pick/element-pick.tsx`）：校验回话
 *   （{@link readsPick}，帧里的内容是**不可信**的）、把节点源码嵌进提示词
 *   （{@link buildEditPrompt}）、算出提示词框该落在哪
 *   （{@link placePickBox}）。
 *
 * 四条设计判据：
 *
 * 1. **探针默认是死的**。它注入每一份 HTML 预览，但不接到父窗口的 `enable`
 *    之前一个像素都不画、一条消息都不发——预览里的页面是用户在看的页面，探针
 *    不许改变它的样子。
 * 2. **开了模式，页面就是只读的**；**一笔选定、框开着的时候，页面连动都不动**。参照物
 *    是浏览器调试工具的元素选择：指向哪儿圈哪儿，但页面一动不动。这件事要**逐层兑现**，
 *    缺一层就漏——一层盖满视口的透明层接住鼠标（页面元素从此收不到悬停、按下与点击，
 *    元素自己声明的 `cursor` 与 `title` 也就无从生效），捕获期把指针族、鼠标族连同
 *    `mousemove` 一起吞掉（页面挂在 `document` / `window` 上的**委托**处理器否则仍会收到
 *    从那一层冒上来的事件），进模式时把页面原有的焦点请出去、之后也不让新焦点落进来。
 *
 *    这三件事按**三个态**分（{@link PICK_HOLD}）：正在挑（`aim`）时滚轮留给页面——不放行
 *    则下半页的元素根本够不着；而一笔已定、框开着（`hold`）时页面**连滚都不许滚**，滚轮
 *    拦下、滚动位置也钉住（拖滚动条与键盘滚动都没有事件可拦，只有位置能作准）。十字光标
 *    只属于 `aim`：框开了之后这一笔已经落定，光标交还平常的样子，页面也不该再因为鼠标
 *    而动一下。
 * 3. **回话当不可信内容读**。{@link readsPick} 逐字段校验并**重建**对象，长度
 *    一律收敛到上限；页面自己伪造一条「选中了某元素」也不能把任意字符串塞进
 *    用户的提示词里。
 * 4. **提示词里给的是定位，不是补丁**。串回去的源码是 DOM 序列化结果（属性顺序
 *    与转义与文件原文未必逐字相同），所以提示词同时给**选择器路径**并明说两者
 *    的关系——围栏长度按内容自适应，节点里本来就有反引号也不会撑破这段提示词。
 */

/**
 * 探针脚本自己的 id，注入两次是空操作（与链接闸门的
 * `PREVIEW_GUARD_ID` 同一套做法）。
 */
export const PREVIEW_PICKER_ID = 'dsh-canvas-element-picker'

/**
 * The attribute the probe stamps on the nodes it creates for itself.
 *
 * Not decoration: the read-only veil sits on top of the page, so the veil *is*
 * what the pointer is over. Answering "which of the page's elements is under
 * the cursor" therefore means hit-testing and skipping everything wearing this
 * mark — the same mark that lets an end-to-end check ask the page who is on top.
 */
export const PREVIEW_PICKER_MARK = 'data-dsh-canvas-picker'

/** 父窗口 → 帧：使能探针。 */
export const PICK_ENABLE = 'enable'

/** 父窗口 → 帧：收起探针。 */
export const PICK_DISABLE = 'disable'

/**
 * 父窗口 → 帧：这一笔已经选定，框开着 —— 页面继续只读，但**不再跟随、也不许再动**。
 *
 * 三态而不是两态，因为「正在挑」与「挑完了、框还开着」是两件事：前者页面得能滚（不然
 * 下半页的元素根本够不着），后者是一张正在被看的图 —— 用户此刻在框里写要求，页面在底下
 * 挪一下，圈着的位置就不再是他在说的那个元素了。
 */
export const PICK_HOLD = 'hold'

/** 父窗口 → 帧那条报文（以及它自己）的消息种类。 */
export const PICK_ORDER_KIND = 'picker'

/** 帧 → 父窗口：选中了一个元素。 */
export const PICK_KIND = 'pick'

/** 帧 → 父窗口：用户在帧里按了 Esc（键盘此刻归帧，帧得替父窗口说话）。 */
export const PICK_ESCAPE_KIND = 'pick-escape'

/**
 * 一个元素回话里最多带多少字符的源码。
 *
 * 提示词是给模型**定位**用的，不是把整个页面搬进上下文：一个 `<body>` 的
 * `outerHTML` 可以是几百 KB，那既撑爆提示词也不比选择器路径更有用。截断时
 * {@link PickTarget.truncated} 置真，提示词里会明说只给了一半。
 */
export const PICK_SNIPPET_CAP = 2000

/**
 * 提示词框的尺寸（px）。**它就是 {@link placePickBox} 的输入**，所以与样式同源。
 *
 * 高从 268 收到 160（v1.49）：从前框里摊着整段节点源码，得留出一屏给文本；现在那几十行
 * 折成了一枚元素标签（`PromptFold`），框里只剩「一枚标签 + 用户写的几行要求」——268 的
 * 框会有大半是空的，而框越大、`placePickBox` 越容易被迫把元素挪到看不见的那一侧去。
 */
export const PICK_BOX_WIDTH = 420
export const PICK_BOX_HEIGHT = 160

/** 一个矩形，两边共用的最小形状：帧坐标系与窗口坐标系都用它。 */
export interface PickRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * Whether the frame has moved since it was measured.
 *
 * The held outline and the prompt box are drawn against the frame's own box, and
 * that box is **a live quantity, not a snapshot**: anything that lands above the
 * frame in the viewer's column — a notice of ours, a truncation warning, the
 * window being resized — pushes or shrinks it, while the overlay keeps the
 * coordinates it was born with. So the viewer re-measures and asks this question
 * before spending a render.
 *
 * The threshold is half a pixel rather than exact equality: sub-pixel jitter from
 * font metrics and zoom would otherwise re-anchor on every layout pass.
 *
 * @param before - the box measured earlier.
 * @param after - the box measured now.
 * @returns `true` when any edge moved further than half a pixel.
 */
export function frameMoved(before: PickRect, after: PickRect): boolean {
  const moved = (a: number, b: number): boolean => Math.abs(a - b) > 0.5
  return (
    moved(before.left, after.left) ||
    moved(before.top, after.top) ||
    moved(before.width, after.width) ||
    moved(before.height, after.height)
  )
}

/** 帧对「鼠标底下是谁」的完整回答。 */
export interface PickTarget {
  /** `section.hero` —— 标签名加它自己的 id / 类名（最多两个类）。 */
  readonly label: string
  /** 从文档根起的路径，` >>> ` 表示跨过一层 open shadow 边界。 */
  readonly selector: string
  /** 元素自己的源码（DOM 序列化结果），不超过 {@link PICK_SNIPPET_CAP} 字符。 */
  readonly html: string
  /** 源码是否被 {@link PICK_SNIPPET_CAP} 截断。 */
  readonly truncated: boolean
  /** 元素是否位于某个 open shadow root 里。 */
  readonly shadow: boolean
  /** 元素在**帧自己的视口**里的位置。 */
  readonly rect: PickRect
}

/** 父窗口发给帧的那条命令。 */
export interface PickOrder {
  readonly channel: string
  readonly kind: string
  readonly action: string
}

/**
 * Build the message that arms or disarms the probe inside a preview frame.
 *
 * @param action - {@link PICK_ENABLE} or {@link PICK_DISABLE}.
 */
export function pickOrder(action: string): PickOrder {
  return { channel: PREVIEW_CHANNEL, kind: PICK_ORDER_KIND, action }
}

/**
 * 这一帧现在该听哪一条命令。
 *
 * 纯函数并且单独摆出来，是因为三个态的名字只在这一处出现：**框开着压过正在挑**（框开着
 * 的时候页面是冻的），两者都没有时探针是死的。帧那边把这条报文当**幂等的目标态**读，
 * 所以调用方每次变化都重发一遍同一句话是安全的。
 *
 * @param armed - 工具按钮按下了（正在挑元素）。
 * @param holding - 手里攥着一笔（提示词框开着）。
 */
export function pickMode(armed: boolean, holding: boolean): string {
  if (holding) return PICK_HOLD
  return armed ? PICK_ENABLE : PICK_DISABLE
}

/** Cap a string at a character budget, without touching the tail. */
function bound(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text
}

/** A finite number, or `undefined` when the wire handed over anything else. */
function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Read a frame's reply, or refuse it.
 *
 * The page inside a preview is *untrusted content*, and this is the one place its
 * words cross into the host: the sender is checked at the call site
 * (`event.source` must be this frame's window), and the shape is checked here,
 * field by field, with every string capped and every number required to be
 * finite. The result is a **new object built from the validated fields** — the
 * page's own object never travels further, so nothing it smuggles along (getters,
 * prototype tricks, extra keys) can reach the prompt.
 *
 * @param data - the `MessageEvent.data` that arrived.
 * @returns the target, or `undefined` for anything that is not a well-formed pick.
 */
export function readsPick(data: unknown): PickTarget | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const message = data as Record<string, unknown>
  if (message.channel !== PREVIEW_CHANNEL || message.kind !== PICK_KIND) return undefined
  const raw = message.target
  if (typeof raw !== 'object' || raw === null) return undefined
  const target = raw as Record<string, unknown>
  if (
    typeof target.label !== 'string' ||
    typeof target.selector !== 'string' ||
    typeof target.html !== 'string' ||
    typeof target.truncated !== 'boolean' ||
    typeof target.shadow !== 'boolean'
  ) {
    return undefined
  }
  const rect = target.rect
  if (typeof rect !== 'object' || rect === null) return undefined
  const box = rect as Record<string, unknown>
  const left = finite(box.left)
  const top = finite(box.top)
  const width = finite(box.width)
  const height = finite(box.height)
  if (left === undefined || top === undefined || width === undefined || height === undefined) return undefined
  return {
    label: bound(target.label, 160),
    selector: bound(target.selector, 400),
    html: bound(target.html, PICK_SNIPPET_CAP),
    truncated: target.truncated,
    shadow: target.shadow,
    rect: { left, top, width, height },
  }
}

/**
 * Whether a frame's reply is the user pressing Escape inside the page.
 *
 * While the probe is armed the frame holds the keyboard, so a plain press
 * reaches the page rather than the viewer's own handler; the frame relays it
 * instead of swallowing it.
 *
 * @param data - the `MessageEvent.data` that arrived.
 */
export function isPickEscape(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const message = data as Record<string, unknown>
  return message.channel === PREVIEW_CHANNEL && message.kind === PICK_ESCAPE_KIND
}

/**
 * Pick a code fence that the snippet cannot break out of.
 *
 * A markdown fence ends at the first run of backticks that is at least as long
 * as the opening one, so a snippet containing its own fence would end the block
 * early and let the rest of the element be read as prose. The fence is therefore
 * one backtick longer than the longest run inside the snippet, and never shorter
 * than three.
 *
 * @param html - the snippet about to be fenced.
 * @returns the fence to use, opening and closing.
 */
export function fenceFor(html: string): string {
  let longest = 0
  for (const run of html.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * The message a picked element turns into.
 *
 * One shape, and it says four things: **which file**, **which node** (with the
 * path that survives a re-serialization), **the node's own source** as the
 * changed scope, and an empty line for the user's requirement. Everything the
 * model needs to locate the change is a locator; the snippet is there to bound
 * the scope.
 *
 * The snippet is a DOM serialization, not the file's own text — attribute order
 * and entity escaping can differ — so the prompt says that out loud instead of
 * letting the model search for a string that is not in the file.
 *
 * @param input.file - the card id (workspace-relative path of the artifact).
 * @param input.target - what the probe reported.
 * @param input.request - what the user typed; empty while the box is first shown.
 */
export function buildEditPrompt(input: { file: string; target: PickTarget; request: string }): string {
  const { file, target, request } = input
  const fence = fenceFor(target.html)
  const lines = [
    '请改这个页面节点，改动范围就是下面这一段。',
    '',
    '产物文件：' + '`' + file + '`',
    '节点：' + '`' + target.label + '`',
    '位置：' + '`' + target.selector + '`',
    '',
    fence + 'html',
    target.html,
    fence,
  ]
  if (target.truncated) {
    lines.push(
      '',
      '节点源码超过 ' + String(PICK_SNIPPET_CAP) + ' 字符，上面只是一半——剩下的按「位置」在文件里读出来，别按上面这段的结束位置猜。',
    )
  }
  lines.push(
    '',
    '上面是浏览器按 DOM 序列化的节点源码（属性顺序、实体转义可能与文件原文不同），照「节点」与「位置」在文件里定位它。',
  )
  if (target.shadow) {
    lines.push(
      '这个节点在开放 shadow DOM 里（` >>> ` 表示跨过 shadow 边界）：它的结构与样式可能由自定义元素的模板生成，只改外层标签改不动它。',
    )
  }
  lines.push('', '改动要求：' + request)
  return lines.join('\n')
}

/** What {@link splitEditPrompt} cuts a written edit prompt into. */
export interface EditPromptSplit {
  /**
   * The locator half: everything {@link buildEditPrompt} writes before the
   * user's request, the trailing `改动要求：` marker included.
   */
  head: string
  /** The request the user typed (or is about to type) after the marker. */
  request: string
}

/**
 * Cut a written edit prompt by **the very head it was built from**.
 *
 * 这是切分唯一的那一半真本事：拿一段已知原文当**前缀**去量草稿，对上就切、对不上就
 * 返回 `undefined`（调用方退回纯文本编辑，不猜「要求」从哪儿开始）。
 *
 * 之所以要有这个「直接把 head 递进来」的入口，是因为 {@link splitEditPrompt} 那副长相
 * 里藏着一个已经踩过的坑：它要调用方**再交代一次**这是哪个产物、哪个节点，而那份交代与
 * 生成草稿时那份是两个来源——元素选择当场就是拿 `view.file` 生成的草稿、切分时却递了
 * `cardId`（卡片的 6 位 id，与产物路径根本不是一回事），于是前缀永远对不上，标签在真机
 * 上一次也没画出来过。凡是「同一个东西有两个来源」的地方，早晚会有一个是错的；所以谁
 * **生成的**草稿，谁就把那段 head **留着**，切分时原样递回来——两份值在结构上就是同一份。
 *
 * @param input.head - the locator half as {@link buildEditPrompt} wrote it (empty request).
 * @param input.text - the draft as written (locator and request together).
 */
export function cutEditPrompt(input: { head: string; text: string }): EditPromptSplit | undefined {
  if (!input.text.startsWith(input.head)) return undefined
  return { head: input.head, request: input.text.slice(input.head.length) }
}

/**
 * Cut a written edit prompt into its locator block and the user's request.
 *
 * The prompt box displays the locator as **one folded element tag** and lets the
 * user edit only the request — a display change, never a prompt change. The cut
 * is therefore not a text heuristic: the head is rebuilt by calling
 * {@link buildEditPrompt} with an empty request and matched as a **prefix** of
 * the written text. That is exact by construction — the head is whatever this
 * module would have written for the same pick — and a draft that no longer
 * starts with it (something edited the raw text beyond the shape) comes back
 * `undefined`, the caller's cue to fall back to plain editing rather than to
 * guess where the request begins.
 *
 * 调用方手里**已经**有那段 head 时（元素选择就是在生成草稿的那一次调用里拿到的），
 * 用 {@link cutEditPrompt} 直接递 head——别再在这里把 `file` / `target` 交代第二遍。
 *
 * @param input.file - the artifact the prompt was built with. **不是卡片 id**：这两者
 *   自 v1.49 起就是两件事，拿 id 来切一份按路径生成的草稿，前缀一定对不上。
 * @param input.target - the pick the prompt was built with.
 * @param input.text - the draft as written (locator and request together).
 */
export function splitEditPrompt(input: {
  file: string
  target: PickTarget
  text: string
}): EditPromptSplit | undefined {
  return cutEditPrompt({
    head: buildEditPrompt({ file: input.file, target: input.target, request: '' }),
    text: input.text,
  })
}

/** What {@link placePickBox} needs to know. */
export interface PickBoxInput {
  /** The picked element's box, in the frame's viewport. */
  target: PickRect
  /** The frame's own box, in the window's viewport. */
  frame: PickRect
  /** The area the box must stay inside (the viewer's own box), in window coordinates. */
  area: PickRect
  /** The box's own size. */
  size: { width: number; height: number }
  /** Space between the element and the box. */
  gap?: number
  /** Space kept between the box and the area's edge. */
  margin?: number
}

/**
 * Where the prompt box goes.
 *
 * Pure, because it is the kind of arithmetic that silently drifts: the element
 * is where the user just clicked, and the box has to appear *there* — one line
 * below the element when there is room, one line above when there is not (a
 * click near the bottom of the page is the common case), and always inside the
 * viewer. Degenerate geometry — a box wider than the area it must fit in — falls
 * back to the area's own corner rather than producing a negative coordinate.
 *
 * @param input - the element, the frame, the area and the box's size.
 * @returns the box's `left` / `top` in window coordinates, rounded to whole pixels.
 */
export function placePickBox(input: PickBoxInput): { left: number; top: number } {
  const gap = input.gap ?? 8
  const margin = input.margin ?? 12
  const { target, frame, area, size } = input
  const elementLeft = frame.left + target.left
  const elementTop = frame.top + target.top
  const elementBottom = elementTop + target.height

  const leftEdge = area.left + margin
  const rightEdge = area.left + area.width - margin - size.width
  const topEdge = area.top + margin
  const bottomEdge = area.top + area.height - margin - size.height

  let top = elementBottom + gap
  if (top > bottomEdge) {
    const above = elementTop - gap - size.height
    top = above >= topEdge ? above : bottomEdge
  }
  const left = Math.min(Math.max(elementLeft, leftEdge), Math.max(leftEdge, rightEdge))
  return { left: Math.round(left), top: Math.round(Math.max(top, topEdge)) }
}

/** The `postMessage` channel the guard and the picker share. */
import { PREVIEW_CHANNEL } from './webapp.ts'

/**
 * The probe, as the string the host appends to a previewed page.
 *
 * Written in ES5 for the same reason the guard is: it runs inside whatever the
 * artifact happens to be. It touches exactly three globals — `window`,
 * `document`, `parent` — which is what makes it testable by execution rather
 * than by reading (`tests/preview-picker.spec.ts` runs this string with those
 * three handed in).
 *
 * Behaviour, in one breath: dormant until the parent names a state; then it
 * raises a transparent, pointer-catching veil over the whole viewport — the page
 * goes read-only (no hover, no element cursor, no title tooltip, no selection,
 * no focus, no pointer event of any kind reaches it) — tracks the element under
 * the cursor through open shadow roots by hit-testing *past* that veil, draws an
 * overlay box and a label chip of its own, swallows the presses and the click so
 * the page does not act on them (a click here selects, it does not activate),
 * reports the element to the parent, and **holds**: the veil stays up while the
 * viewer's own outline and prompt box are open, so the page cannot move under a
 * selection the user is still describing. The overlay goes away with the aim
 * state — from `hold` on, the outline is drawn by the viewer, on its own side of
 * the boundary, which is the only way it and the prompt box always agree.
 */
export const PREVIEW_PICKER_SOURCE = `(function () {
  var CHANNEL = '${PREVIEW_CHANNEL}'
  var CAP = ${PICK_SNIPPET_CAP}
  var ORDER = '${PICK_ORDER_KIND}'
  var PICK = '${PICK_KIND}'
  var ESCAPE = '${PICK_ESCAPE_KIND}'
  var MARK = '${PREVIEW_PICKER_MARK}'
  // 三个态：死的、正在挑（页面能滚）、一笔已定框开着（页面连滚都不许滚）。
  var OFF = 'off'
  var AIM = 'aim'
  var HOLD = '${PICK_HOLD}'
  var mode = OFF
  var hovered = null
  var veil = null
  var box = null
  var chip = null
  // 「框开着」那一刻的滚动位置：拖滚动条与键盘滚动都拦不到事件，只有把它钉回原处。
  var pinned = null

  function live() {
    return mode !== OFF
  }

  function post(data) {
    try { parent.postMessage(data, '*') } catch (error) {}
  }

  // 我们自己挂的记号。只读层挡在页面与鼠标之间，它**就是**「鼠标底下第一名」，所以命中
  // 测试得拿这个记号把自己的三层筛干净。
  function ours(node) {
    if (!node || !node.getAttribute) return false
    var mark = node.getAttribute(MARK)
    return mark !== null && mark !== undefined && mark !== ''
  }

  function ensureNodes() {
    if (veil !== null) return
    // 只读层：盖满视口、透明、**接得住鼠标**（全部浮层里只有它该接鼠标）。页面从此收不到
    // 指针事件——悬停样式、悬停处理器、title 提示、文字选择、按下带来的焦点，全无从发生；
    // 十字光标也由它统一出示（元素自己声明的 cursor 赢不过它）。
    veil = document.createElement('div')
    veil.setAttribute(MARK, 'veil')
    veil.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483647;' +
      'display:none;background:transparent;pointer-events:auto;cursor:crosshair'
    document.documentElement.appendChild(veil)
    // 高亮框与记号牌相反：它们只负责画，不接鼠标。
    box = document.createElement('div')
    box.setAttribute(MARK, 'box')
    box.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;' +
      'box-sizing:border-box;border:1px solid #4176E6;background:rgba(65,118,230,.16);border-radius:2px'
    chip = document.createElement('div')
    chip.setAttribute(MARK, 'label')
    chip.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;' +
      'background:#4176E6;color:#fff;border-radius:3px;padding:1px 6px;white-space:nowrap;' +
      'font:11px/16px ui-monospace,Menlo,monospace'
    document.documentElement.appendChild(box)
    document.documentElement.appendChild(chip)
  }

  function hide() {
    if (veil === null) return
    veil.style.display = 'none'
    box.style.display = 'none'
    chip.style.display = 'none'
  }

  function nameOf(node) {
    var name = (node.tagName || '').toLowerCase()
    if (node.id) name += '#' + node.id
    var classes = node.classList
    if (classes) {
      var limit = classes.length < 2 ? classes.length : 2
      for (var index = 0; index < limit; index += 1) name += '.' + classes[index]
    }
    return name
  }

  var SAFE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/

  function segmentOf(node) {
    var tag = (node.tagName || '').toLowerCase()
    // id 优先：它是这条路径里最结实的一段。写不成 CSS 名字的 id（含空白、以数字
    // 开头）不往里塞——选择器的每一段都该是能直接用的。
    if (node.id && SAFE_NAME.test(node.id)) return tag + '#' + node.id
    var suffix = ''
    var classes = node.classList
    if (classes) {
      var limit = classes.length < 2 ? classes.length : 2
      for (var index = 0; index < limit; index += 1) {
        if (SAFE_NAME.test(classes[index])) suffix += '.' + classes[index]
      }
    }
    if (suffix !== '') return tag + suffix
    // 同类兄弟之间没有别的记号可用时，位置就是唯一的记号。
    var parent = node.parentNode
    var same = 0
    var at = 0
    if (parent && parent.children) {
      for (var sibling = 0; sibling < parent.children.length; sibling += 1) {
        var child = parent.children[sibling]
        if ((child.tagName || '').toLowerCase() === tag) {
          same += 1
          if (child === node) at = same
        }
      }
    }
    return same > 1 ? tag + ':nth-of-type(' + at + ')' : tag
  }

  function pathOf(node) {
    var text = ''
    var crossed = false
    var current = node
    var hops = 0
    while (current && current.nodeType === 1 && hops < 12) {
      hops += 1
      var segment = segmentOf(current)
      // crossed 是上一轮留下的：上一轮走到了 shadow root，这一轮补上的就是宿主，
      // 所以这一段与前面之间是跨 shadow 的那一跳，而不是普通的父子。
      if (text === '') text = segment
      else text = crossed ? segment + ' >>> ' + text : segment + ' > ' + text
      crossed = false
      var parent = current.parentNode
      if (parent && parent.nodeType === 11) {
        crossed = true
        current = parent.host
      } else {
        current = parent
      }
    }
    return text
  }

  function insideShadow(node) {
    var current = node.parentNode
    while (current) {
      if (current.nodeType === 11) return true
      current = current.parentNode
    }
    return false
  }

  function elementAt(x, y) {
    var node = null
    var stack = document.elementsFromPoint ? document.elementsFromPoint(x, y) : null
    if (stack) {
      // 自上而下第一个**不是我们的**元素。少了这一步，答案永远是只读层自己。
      for (var index = 0; index < stack.length; index += 1) {
        if (!ours(stack[index])) { node = stack[index]; break }
      }
    } else if (document.elementFromPoint) {
      // 没有 elementsFromPoint 的浏览器：把只读层临时让开一次，问完立刻放回去。
      veil.style.pointerEvents = 'none'
      node = document.elementFromPoint(x, y)
      veil.style.pointerEvents = 'auto'
      if (ours(node)) node = null
    }
    while (node && node.shadowRoot && node.shadowRoot.elementFromPoint) {
      var deeper = node.shadowRoot.elementFromPoint(x, y)
      if (!deeper || deeper === node || ours(deeper)) break
      node = deeper
    }
    return node
  }

  function describe(node) {
    var html = ''
    try { html = node.outerHTML || '' } catch (error) { html = '' }
    var cut = html.length > CAP
    var rect = node.getBoundingClientRect()
    return {
      label: nameOf(node),
      selector: pathOf(node),
      html: cut ? html.slice(0, CAP) : html,
      truncated: cut,
      shadow: insideShadow(node),
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    }
  }

  function track(x, y) {
    var node = elementAt(x, y)
    if (!node) return
    hovered = node
    var rect = node.getBoundingClientRect()
    box.style.display = 'block'
    box.style.left = rect.left + 'px'
    box.style.top = rect.top + 'px'
    box.style.width = rect.width + 'px'
    box.style.height = rect.height + 'px'
    var label = nameOf(node)
    chip.textContent = label
    chip.style.display = 'block'
    chip.style.left = rect.left + 'px'
    chip.style.top = (rect.top - 19 < 0 ? rect.bottom + 2 : rect.top - 19) + 'px'
  }

  function dropFocus() {
    var active = document.activeElement
    if (!active || active === document.body || active === document.documentElement) return
    if (active.blur) active.blur()
  }

  function pinScroll() {
    pinned = { x: window.pageXOffset || 0, y: window.pageYOffset || 0 }
  }

  // 位置钉住：滚轮那条下面拦得住，拖滚动条与键盘滚动没有事件可拦 —— 只有位置能作准。
  // 钉的是**进入这个态那一刻**的位置，用户正是照着那一刻的画面选中的元素。
  function holdScroll() {
    if (mode !== HOLD || pinned === null) return
    var x = window.pageXOffset || 0
    var y = window.pageYOffset || 0
    if (x === pinned.x && y === pinned.y) return
    window.scrollTo(pinned.x, pinned.y)
  }

  function setMode(next) {
    if (next === mode) return
    mode = next
    hovered = null
    pinned = null
    if (!live()) {
      hide()
      return
    }
    ensureNodes()
    // 只读从**按下按钮那一刻**就兑现，不等第一次划过：页面在这之前就已经不动了。所以这里
    // 只收起上一次留下的高亮，只读层立刻盖上。
    box.style.display = 'none'
    chip.style.display = 'none'
    veil.style.display = 'block'
    // 十字只说「现在可以挑」：一笔选定之后这一笔已经落定，光标交还平常的样子。
    veil.style.cursor = mode === AIM ? 'crosshair' : 'default'
    // 开模式之前点过的那个输入框还握着焦点，当场请出去。
    dropFocus()
    if (mode === HOLD) pinScroll()
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return
    var data = event.data
    if (!data || data.channel !== CHANNEL || data.kind !== ORDER) return
    if (data.action === '${PICK_HOLD}') setMode(HOLD)
    else setMode(data.action === '${PICK_ENABLE}' ? AIM : OFF)
  }, false)

  window.addEventListener('mousemove', function (event) {
    if (!live()) return
    // 跟随只在 aim 里；但**吞下去**是三个态都要做的事 —— 挂在 document 上的委托 mousemove
    // 否则照样会收到从只读层冒上来的这一发。
    event.stopPropagation()
    if (mode !== AIM) return
    track(event.clientX, event.clientY)
  }, true)

  function swallow(event) {
    if (!live()) return
    event.preventDefault()
    event.stopPropagation()
  }

  function swallowOnly(event) {
    if (live()) event.stopPropagation()
  }

  // 只读要**两层**才兑现，缺一层就漏：只读层挡住的只是页面元素（悬停、光标、点击都到不了
  // 它们），而页面挂在 document / window 上的**委托**处理器仍会收到从层上冒上来的事件 ——
  // 所以还得在捕获期拦下。分两族是因为默认动作不一样：指针那一族**只挡不吞**（对一个
  // pointerdown 调 preventDefault 会连带压掉后续的兼容鼠标事件，而我们的选择正靠 click）；
  // 鼠标那一族挡下并且吞掉默认动作（焦点、选区、拖放、右键菜单都从这里断）。表里没有 click
  // （那是选择）也没有 mousemove（那是跟随），两者各有自己的监听；**更没有 wheel** ——
  // 滚轮的账要分两个态算，见下面那一条。
  var BLOCK = [
    'pointermove', 'pointerdown', 'pointerup', 'pointerover', 'pointerout',
    'pointerenter', 'pointerleave', 'pointercancel'
  ]
  var DEAD = [
    'mousedown', 'mouseup', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
    'dblclick', 'auxclick', 'contextmenu', 'dragstart', 'selectstart'
  ]
  for (var blocked = 0; blocked < BLOCK.length; blocked += 1) {
    window.addEventListener(BLOCK[blocked], swallowOnly, true)
  }
  for (var dead = 0; dead < DEAD.length; dead += 1) {
    window.addEventListener(DEAD[dead], swallow, true)
  }

  // 滚轮**分两档**：正在挑的时候留给页面（不放行则下半页的元素根本够不着 —— 代价是页面
  // 自己的内层滚动容器在这期间滚不动，整块被只读层盖住）；而一笔选定、框开着的时候，页面
  // 是被看的那张图，一下都不许动。这一条必须显式写 passive:false —— 浏览器对 window 上的
  // wheel 监听默认是 passive 的，不写就等于 preventDefault 空转、页面照样滚。
  window.addEventListener('wheel', function (event) {
    if (mode !== HOLD) return
    event.preventDefault()
    event.stopPropagation()
  }, { passive: false })
  window.addEventListener('scroll', holdScroll, false)

  // 焦点也别想落进来：Tab 键、页面自己的 focus() 都当场请出去。这个监听常驻，模式关着的时候
  // 它一个指头都不动。
  document.addEventListener('focusin', function (event) {
    if (!live()) return
    var node = event.target
    if (node && node.blur) node.blur()
  }, true)

  window.addEventListener('click', function (event) {
    if (!live()) return
    event.preventDefault()
    event.stopPropagation()
    // 框开着的那一笔已经定了：这一击既不到页面上，也不再改选择。
    if (mode !== AIM) return
    var node = hovered
    if (!node) node = elementAt(event.clientX, event.clientY)
    if (!node) return
    post({ channel: CHANNEL, kind: PICK, target: describe(node) })
    // 自己先进 hold：父窗口那边要等这一发回话才把框摆出来，这中间页面不该闪一下「活的」。
    setMode(HOLD)
  }, true)

  window.addEventListener('keydown', function (event) {
    if (!live() || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    setMode(OFF)
    post({ channel: CHANNEL, kind: ESCAPE })
  }, true)
})()`

/**
 * Put the probe into a page that is about to be previewed.
 *
 * Appended at the very end of the text, for the same reason the link guard is
 * ({@link injectPreviewLinkGuard}): a page whose own script contains the string
 * `</body>` is a real thing, and a tag injected at the wrong `</body>` would
 * close that script early. The tail has no such hazard, and trailing content is
 * hoisted into the body and runs anyway.
 *
 * Idempotent — a page that already carries the probe comes back unchanged.
 *
 * @param html - the entry page's text.
 * @returns the same page with the probe installed.
 */
export function injectPreviewPicker(html: string): string {
  if (html.includes(PREVIEW_PICKER_ID)) return html
  return `${html}\n<script id="${PREVIEW_PICKER_ID}">\n${PREVIEW_PICKER_SOURCE}\n</script>`
}
