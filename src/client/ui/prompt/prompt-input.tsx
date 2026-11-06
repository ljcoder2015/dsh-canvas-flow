/**
 * dsh-canvas — 提示词输入框的公共件：**原子引用标签**的输入面。
 *
 * 一处抽象，两处使用：画布的 composer（行内与 ⤢ 放大弹窗共用同一个 ComposerBody）与
 * 元素选择的提示词框都由它画。外形（边框、底色、字号、最小/最大高度）归调用方的皮肤类
 * （如 `.dsh-canvas-composer-input`），组件只管一件事：把 `@文件` 记号（`file-reference.ts`
 * 那份语法）画成一枚**标签**——图标 + 文件名 + 可选的行号徽标——而值一个字节都不动。
 *
 * ## 为什么是 `contenteditable`
 *
 * 上一版是「透明 textarea + 同度量镜像层」：镜像层照抄整段文本、给记号换一段配色。它做到
 * 了「显示改不到值」，但**画不出一枚真正的标签**——镜像只能重绘同一串字符（插不进图标、
 * 改不了宽度、更显示不了比原文短的名字），而一件事只有真做成原子节点才谈得上原子：文档要
 * 的「整体作为一个不可分割的单元」「标签内部不可编辑」，在 textarea 里无从表达。
 *
 * 所以正文换成 `contenteditable`，标签是 `contenteditable="false"` 的元素。换来的是
 * 一条要自己守住的边界：**内容就是值**。守在三处——
 *
 * 1. **写只有一条路**（`prompt-dom.ts` 的 `writeAtoms`），而且只在**外面给的值与我们上次
 *    交出去的不同**时才写。用户自己敲的字 DOM 已经是对的，重写一次就会把光标与输入法一起
 *    打断；这也是这张输入面在中文输入法下安全的原因（合成期间 `change` 照发，DOM 一动不动）。
 * 2. **读只有一条路**（`serializeHost`）：标签吐回**它自己那串字符**，不是重新拼的路径。
 * 3. **改值的地方（删除、换行、粘贴、插入引用）都按值算**，算完连同光标一起写回
 *    （`apply`）——不靠浏览器的默认行为去猜。
 *
 * 于是四条交互判据都落在这里：标签整体删除（Backspace/Delete 在标签边界上删的是**一枚
 * 引用**，不是它的一个字符）、标签内部不可编辑（非可编辑节点里没有光标）、复制/剪切按
 * 原文（标签还原成 `@路径`）、粘贴只取纯文本（富文本粘贴进来会带一堆 DOM，那正是这条
 * 边界最容易被撕开的地方）。
 *
 * ## 第五件事：`@` 在句子的任何位置都算
 *
 * 从前只有**词首**那个 `@` 会弹候选（那是宿主记号语法的边界，被顺手抄到了「要不要弹」
 * 上），于是想引用一张卡得先把光标挪到词首、敲个空格。现在光标前那半枚查询只要不带空白
 * 就弹（判据在 `ref-popup.ts` 的 `queryAt`），弹窗的位置也**贴着那一枚 `@`**——DOM 量
 * 出来的视口盒子（`prompt-dom.ts` 的 `charRect`），不再挂在材料行下方。插进提示词的
 * 那串字符仍必须落在词首：句子中间敲的 `@` 前面补一个空格（`mentionInsertion`），否则
 * 它只是一个奇怪的长单词——标签画不出来、宿主也不认。
 */
import { useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import type {
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
} from 'react'
import { promptAtoms } from '../../../core/artifact/prompt/prompt-blocks.ts'
import type { PromptFold, ReferenceFacts } from '../../../core/artifact/prompt/prompt-blocks.ts'
import { caretFlat, charRect, chipSpans, selection, separatedSpans, serializeHost, setCaret, writeAtoms } from './prompt-dom.ts'
import { mentionInsertion, queryAt, queryStart } from './ref-popup.ts'
import type { QueryAnchor } from './ref-popup.ts'

/**
 * 调用方伸进输入框里做的那几件事。
 *
 * 一个 handle 而不是把 `textarea` 的 ref 交出去：正文已经不是 `textarea` 了，而调用方要
 * 的那三件事（量尺寸、摆光标、插一枚引用）本来也不需要知道正文是怎么实现的。
 */
export interface PromptInputHandle {
  /** 宿主元素（行内那条控制带的把手要量它的高）。 */
  readonly el: HTMLElement | null
  focus(): void
  /** 光标落到末尾，并把末尾那一行滚进可视区。 */
  caretToEnd(): void
  /**
   * 在光标处插一枚引用，正在打的那半枚 `@查询` 一并顶掉；插完光标落在它后面、焦点回到框里。
   *
   * 返回是否插进去了——写不出来的路径（含引号或控制字符）调用方本来就该拦下，这里再给一次
   * 门，免得半枚标签落进提示词。
   */
  insertMention(mention: string): boolean
  /**
   * 收起候选弹窗：只是不再认正在打的这半枚 `@查询`，值里那串字符一个都不动。
   *
   * 走这条而不是让调用方自己把状态置空，是因为输入面身上还记着那半枚查询的**偏移**
   * （框里滚动时要拿它把弹窗按回那一枚 `@` 上）。只清外部的状态，那笔账就留在了这里
   * ——下一次滚动会把它重新报上去，弹窗在你已经 Esc 之后又自己冒出来。
   */
  dismissQuery(): void
}

/** Props of the reference-tag prompt input. */
export type PromptInputProps = {
  /** 提示词本身——唯一真源，内容只是它的画法。 */
  value: string
  /** 记下用户改过的文本。 */
  onChange: (text: string) => void
  placeholder?: string
  /**
   * 皮肤类：盒子的边框、底色、最小/最大高度与字体度量（含 `data-fullscreen` 这类开关的
   * 样式）都由它给。组件自己的布局类永远排在它前面。
   */
  className?: string
  /** 要伸进框里做事（量高、摆光标、插引用）就把它交出来。 */
  handleRef?: MutableRefObject<PromptInputHandle | null>
  autoFocus?: boolean
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  /**
   * 光标前正在打的那半枚 `@查询`（没有就是 `null`），连同**那一枚 `@` 在视口里的位置**。
   *
   * 上报而不是自己开菜单：候选是谁（这张卡能引用哪些文件）是调用方的事，输入面只认光标；
   * 而「弹窗该贴着哪一枚字符」也只有这里量得出来——`@` 是值里的一个偏移，落成屏幕上的
   * 一个盒子要问 DOM。位置与查询一起报，是因为它们说的是同一个东西：调用方不必自己再
   * 换算一遍偏移，也就不会算错一位。
   */
  onQueryChange?: (query: string | null, anchor: QueryAnchor | null) => void
  /**
   * 调用方知道的那些「文件之外的事实」（类型、行号、缩略图、坐标）。
   *
   * 只有调用方给得出：路径写在提示词里，而**它是什么**（一张图？一段有行号的代码？）在
   * 文件那一侧。给不出来也不影响用——扩展名已经决定了长相（`referenceTypeOf`），这里是
   * 额外的信息（缩略图尤其：它让「引用了哪张图」一眼看得见）。
   */
  refs?: Readonly<Record<string, ReferenceFacts>>
  /**
   * 调用方**已经知道**是引用的那几段原文（元素选择的定位就是这样一整段）。
   *
   * `@文件` 记号是从字符里认出来的，而元素定位写不出记号语法——它是几十行原文。调用方
   * 知道它从第几个字符起、有多长（就是它自己刚写进去的），于是由它声明，输入面照着画
   * 一枚标签。**折叠只改画法**：序列化时它吐回那 N 个字符本身，提示词一个字不变。
   */
  folds?: readonly PromptFold[]
  spellCheck?: boolean
  style?: CSSProperties
} & Record<`data-${string}`, string | undefined>

/** 光标（或选区）当前落在值里的哪一段。 */
interface Span {
  start: number
  end: number
}

/**
 * 把「事实变没变」压成一个键。
 *
 * 它挡的是两种情况，两边都真会踩到：调用方**每次渲染都新造一个对象**（那样按身份比就会
 * 每次重画一遍 DOM，打字打到一半光标被拽走），以及**同一份事实换了内容**（缩略图取回来
 * 了、模型换了行号——那时确实该重画一次）。所以比的是内容，不是那个对象的身份。
 */
function factsKey(facts: Readonly<Record<string, ReferenceFacts>> | undefined): string {
  if (facts === undefined) return ''
  return Object.entries(facts)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([path, entry]) =>
      [
        path,
        entry.type ?? '',
        entry.label ?? '',
        entry.startLine ?? '',
        entry.endLine ?? '',
        entry.thumbnail === undefined ? '' : '1',
        entry.point?.join(',') ?? '',
        entry.bbox?.join(',') ?? '',
        entry.target ?? '',
      ].join(':'),
    )
    .join('\n')
}

/**
 * 折叠段的指纹：位置、长度、长相。
 *
 * 与 {@link factsKey} 同一个理由——它决定「这次重渲染要不要重画 DOM」。值与折叠**未必**
 * 同步：同一段原文换了一枚标签的长相（元素换了名字而源码没变），值一个字节没动，画法
 * 却得跟上。不把它算进去，那种变化会静默地不生效。
 */
function foldsKey(folds: readonly PromptFold[] | undefined): string {
  if (folds === undefined || folds.length === 0) return ''
  return folds
    .map((fold) =>
      [fold.at, fold.length, fold.reference.type, fold.reference.label, fold.reference.detail ?? ''].join(':'),
    )
    .join('|')
}

/** 内容指纹：值与事实、折叠两样都算。 */
function contentKey(
  refs: Readonly<Record<string, ReferenceFacts>> | undefined,
  folds: readonly PromptFold[] | undefined,
): string {
  return `${factsKey(refs)}|${foldsKey(folds)}`
}

/**
 * 光标前那枚 `@查询` 是什么、弹窗摆哪、插进去什么——三件事都在 `ref-popup.ts`（纯，node
 * 环境可测）。这里只负责在正确的时机问一次、把 DOM 量出来的位置一起报上去。
 */

/** The reference-tag prompt input. */
export function PromptInput(props: PromptInputProps) {
  const {
    value, onChange, placeholder, className, handleRef, autoFocus, onKeyDown, onQueryChange,
    refs, folds, spellCheck, style, ...data
  } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  /**
   * 我们上一次交出去（或刚画上去）的那份内容：**值 + 事实的键**。
   *
   * 它是「谁动了这份内容」的判据：两者都没变 = 这次变化是用户自己敲出来的（或与画布无关
   * 的重渲染），DOM 已经是对的，一个节点都不要碰；变了一样 = 外面换了值（回填、切卡、
   * 程序化插入）或事实变富了（缩略图回来了），才重画一遍。
   */
  const markRef = useRef<{ text: string; key: string } | null>(null)
  /**
   * 上一次知道的光标/选区。
   *
   * 菜单是**点**出去的，而点的那一下焦点就离开框里了——那时再问浏览器「光标在哪」问不到，
   * 插入就会落到末尾去。所以每次拿到位置就记下来。
   */
  const caretRef = useRef<Span>({ start: 0, end: 0 })
  /**
   * 那半枚 `@查询` 的起点（就是那一枚 `@` 在值里的偏移）；`-1` = 没在写引用。
   *
   * 单独记着是为了**框里滚动时**还能把弹窗按回那一枚字符上：滚动不改值、也不改光标，只
   * 改它们在屏幕上的位置；而重报是从光标重算一遍的，重算得出同一个查询，量的却是新位置。
   */
  const queryStartRef = useRef(-1)
  /** 输入法正在合成：这期间 DOM 归它，我们一个字都不许动。 */
  const composing = useRef(false)
  /**
   * 回调与行号的最新一份，专给那些**不是**由这次渲染发起的事情读（`apply`、输入法、
   * 剪贴板）。它们不能进依赖表：`onChange` 每次渲染都是新的，进去等于每次渲染都重排一遍。
   */
  const latest = useRef({ value, onChange, onQueryChange, refs, folds })
  const key = contentKey(refs, folds)
  const atoms = useMemo(() => promptAtoms(value, refs, folds), [value, refs, folds])

  /**
   * 写一份新值：DOM、光标、回调一起走，**不经过 React 的重渲染**。
   *
   * 程序化改动（删一枚标签、插一个换行、粘贴一段字）都要走这里：等 React 重渲染再改 DOM，
   * 光标早被浏览器挪走了，而这里改完立刻把光标摆到说好的位置，中间没有别人插得进来。
   */
  const apply = useCallback((next: string, caret: number, end?: number) => {
    const host = hostRef.current
    const now = latest.current
    markRef.current = { text: next, key: contentKey(now.refs, now.folds) }
    if (host !== null) {
      writeAtoms(host, promptAtoms(next, now.refs, now.folds))
      setCaret(host, caret, end)
    }
    caretRef.current = { start: caret, end: end ?? caret }
    now.onChange(next)
  }, [])

  /** 光标现在在值里的哪儿（读 DOM）；读不到就用上一次记住的。 */
  const readCaret = useCallback((): Span => {
    const host = hostRef.current
    if (host !== null) {
      const now = selection(host)
      if (now !== undefined) caretRef.current = now
    }
    return caretRef.current
  }, [])

  /**
   * 报一次「光标前那半枚 `@查询`」**连同那一枚 `@` 的位置**（调用方按它开候选弹窗）。
   *
   * `text` / `caret` 由调用方给：`onInput` 手上那份刚从 DOM 读出来，比 `latest` 里那份
   * 早一拍——拿旧值算出来的查询会差一个字符。
   */
  const report = useCallback((text: string, caret: number) => {
    const host = hostRef.current
    const query = queryAt(text, caret)
    queryStartRef.current = query === null ? -1 : queryStart(text, caret)
    // 量不到那一枚字符（空行上有的浏览器给出 0×0）就退回**整个框**当落点：弹窗会贴在框
    // 下面，位置不算精准，但绝不会「什么都不显示」——静默的失败比一个粗糙的落点更坏。
    const anchor =
      query === null || host === null
        ? null
        : (charRect(host, queryStartRef.current) ?? host.getBoundingClientRect())
    latest.current.onQueryChange?.(query, anchor)
  }, [])

  /** 从当下这份值与光标重报一次（焦点、按键、点击、滚动之后都走它）。 */
  const syncQuery = useCallback(() => {
    const host = hostRef.current
    if (host === null) {
      queryStartRef.current = -1
      latest.current.onQueryChange?.(null, null)
      return
    }
    // 顺手把光标（或选区）记下来再报：候选菜单是**点**出去的，点的那一下焦点就离开框里，
    // 那时再问浏览器要位置要不到——插进去的记号会落到开头或末尾去（见 `insertMention`）。
    report(latest.current.value, readCaret().end)
  }, [readCaret, report])

  /** 在光标处（或选区上）插一段纯文本，光标落在它后面。 */
  const insertText = useCallback(
    (text: string) => {
      const span = readCaret()
      const now = latest.current.value
      apply(now.slice(0, span.start) + text + now.slice(span.end), span.start + text.length)
    },
    [apply, readCaret],
  )

  /**
   * 光标紧挨着一枚标签时，那一下删除删的是**这一枚引用**，不是它的一个字符。
   *
   * 浏览器对 `contenteditable=false` 的节点本来也大多整枚删，但「大多」不够：不同浏览器在
   * 边界上的行为并不一致（有时顺手带掉旁边的空白）。所以这里直接按值判——光标正好落在某
   * 枚标签的界上（扁平偏移与它对齐）就自己删，并且 `preventDefault` 掉那次默认删除：一
   * 条路，没有第二种结果。
   *
   * 还有一条**对账**：值里那枚记号必须与界面上这枚标签冻着的是**同一串字符**。合成期间
   * 值可能短暂地比标签长（字被拼进了路径，见 `readBack`），那时按值删就会把用户刚打的字
   * 一起抹掉——宁可退回浏览器默认（一个字一个字删），也不要整块消失。
   */
  const deleteNeighbourChip = useCallback(
    (key: 'Backspace' | 'Delete'): boolean => {
      const host = hostRef.current
      if (host === null) return false
      const caret = caretFlat(host)
      if (caret === undefined) return false
      const text = latest.current.value
      const chips = chipSpans(host)
      let at = 0
      let index = 0
      for (const atom of promptAtoms(text, latest.current.refs, latest.current.folds)) {
        const length = atom.kind === 'text' ? atom.text.length : atom.reference.id.length
        if (atom.kind === 'ref') {
          const chip = chips[index]
          index += 1
          const same = chip !== undefined && chip.at === at && chip.token === atom.reference.id
          if (same && key === 'Backspace' && at + length === caret) {
            apply(text.slice(0, at) + text.slice(caret), at)
            return true
          }
          if (same && key === 'Delete' && at === caret) {
            apply(text.slice(0, at) + text.slice(at + length), at)
            return true
          }
        }
        at += length
      }
      return false
    },
    [apply],
  )

  const handle = useMemo<PromptInputHandle>(
    () => ({
      get el() {
        return hostRef.current
      },
      focus() {
        hostRef.current?.focus()
      },
      caretToEnd() {
        const host = hostRef.current
        if (host === null) return
        host.focus()
        setCaret(host, latest.current.value.length)
      },
      insertMention(mention: string) {
        const host = hostRef.current
        if (host === null || mention === '') return false
        // **先读位置，再把焦点要回来**：菜单是点出去的，这一下焦点才刚离开框里；反过来
        // （先 focus）浏览器可能把选区摆回它自己记着的那一处，读到的就是另一个位置了。
        const span = readCaret()
        host.focus()
        const text = latest.current.value
        // 顶掉正在打的那半枚 `@查询`；句子中间敲的那个 `@` 前面补一个空格（记号只在词首
        // 才算引用，见 `ref-popup.ts` 的 `mentionInsertion`）。
        const next = mentionInsertion(text, { start: queryStart(text, span.end), end: span.end }, mention)
        apply(next.text, next.caret)
        queryStartRef.current = -1
        latest.current.onQueryChange?.(null, null)
        return true
      },
      dismissQuery() {
        queryStartRef.current = -1
        latest.current.onQueryChange?.(null, null)
      },
    }),
    [apply, readCaret],
  )
  useImperativeHandle(handleRef, () => handle)

  /**
   * 值 → 内容。**唯一的写入口**，而且只在外面真的换了东西时才写。
   *
   * 判据是 `markRef`（值 + 事实的键）：用户敲的字在 `onInput` 里已经记成最新一份，这里立刻
   * 返回——这正是输入法与光标的保命符。事实变富时（缩略图回来了）才重画一次，而那时**光标
   * 要留在原处**：用户没改一个字，把他打字的位置端走是最没道理的一种打扰。
   *
   * 「留在原处」得自己做：`writeAtoms` 换的是整棵子树，选区连着它那个容器节点一起没了
   * （浏览器只好把光标扔回开头）。所以这一路**先量后画**，画完把选区原样还回去——还的是
   * 一整个选区，不只是折叠的光标（用户可能正选着半句话）。
   */
  useLayoutEffect(() => {
    latest.current = { value, onChange, onQueryChange, refs, folds }
    const host = hostRef.current
    if (host === null) return
    const mark = markRef.current
    if (mark !== null && mark.text === value && mark.key === key) return
    const valueChanged = mark === null || mark.text !== value
    markRef.current = { text: value, key }
    const held = valueChanged ? undefined : selection(host)
    writeAtoms(host, atoms)
    if (valueChanged) {
      // 外面换了值（回填、切卡、清空）：光标放到末尾——用户接下来的话该接在那儿。
      if (host.ownerDocument.activeElement === host) setCaret(host, value.length)
      caretRef.current = { start: value.length, end: value.length }
      return
    }
    if (held !== undefined) {
      setCaret(host, held.start, held.end === held.start ? undefined : held.end)
      caretRef.current = held
    }
  }, [atoms, folds, key, onChange, onQueryChange, refs, value])

  /** 放大态打开时接住焦点（`autoFocus` 对 `contenteditable` 不生效，得自己做）。 */
  useLayoutEffect(() => {
    if (autoFocus !== true) return
    const host = hostRef.current
    if (host === null) return
    host.focus()
    setCaret(host, value.length)
    // 只在 `autoFocus` 翻真时接一次焦点：之后值怎么变都是用户自己在写（连 `value` 一起
    // 进依赖表，就等于每次回填都把人正在打的那一行端走）。本仓的 eslint 只带 js +
    // typescript-eslint，没有启用 react-hooks 规则，写 eslint-disable 反而会报
    // 「规则不存在」——这一条由评审把关，见 `canvas-panels.tsx` 同一处约定。
  }, [autoFocus])

  /**
   * 读回值：序列化 → **把被标签吞掉的字补回一处分隔** → 记档 → 上报。
   *
   * 中间那一步是这枚 bug 的正解（用户原话：「在 @ 选中文件后面输入文本，删除时会直接删除
   * 文件及以后的文本，而不是一个一个文字删除」）：写在标签右边紧贴处的字会被拼进路径——
   * `@hero.png` + `abc` 成了 `@hero.pngabc`，那在值里是**另一份文件**，界面上却还是那枚
   * 冻着的标签。于是值重新解析出的是**一整枚**原子，Backspace 一删就是整块（还顺手带走
   * 后面的字）。补一个空格，字就回到「引用后面的文字」这个身份上。
   *
   * 输入法合成期间一个字都不许动（DOM 归它），合成结束时再补——所以两条路都走这里。
   */
  const readBack = useCallback(() => {
    const host = hostRef.current
    if (host === null) return
    const typed = serializeHost(host)
    let text = typed
    let caret = caretFlat(host) ?? typed.length
    if (!composing.current) {
      // 浏览器在「这一行空了」时会自己塞一枚占位 `<br>`（`contenteditable` 的老办法），
      // 序列化读回来就成了凭空多出的一个换行——删掉标签旁边最后一个空格时正好踩上，
      // 删除的末尾就白白多出一个空行。判据：DOM 末节点是 `<br>`、读回来是个换行，而
      // **上一次的值并不以换行结尾**（用户自己敲的 Enter 走 `apply`，到不了这里；粘贴
      // 与换行也一样，只有浏览器默认那一下会留下这枚占位）。
      const last = host.lastChild
      if (last !== null && last.nodeName === 'BR' && typed.endsWith('\n') && !latest.current.value.endsWith('\n')) {
        text = typed.slice(0, -1)
        caret = Math.min(caret, text.length)
      }
      const fixed = separatedSpans(text, chipSpans(host), caret)
      const next = fixed ?? (text === typed ? null : { text, caret })
      if (next !== null) {
        // 走 `apply`：重画、摆光标、`onChange` 一气做完，中间没有别人插得进来。
        apply(next.text, next.caret)
        report(next.text, next.caret)
        return
      }
    }
    markRef.current = { text: typed, key: contentKey(latest.current.refs, latest.current.folds) }
    latest.current.onChange(typed)
    // 打字的每一个字都从 DOM 读一次：这是「光标在哪儿」的唯一真源，隔一次读就可能停在
    // 上一个字的位置上（候选菜单插进来时尤其要命）。
    caretRef.current = { start: caret, end: caret }
    report(typed, caret)
  }, [apply, report])

  /**
   * 键盘：**先问调用方**（它有菜单、有发送快捷键），它没拦下才是输入面自己那两件事。
   *
   * 顺序不能反：候选菜单开着时那颗 Enter 是「选中这一枚」，而不是「换一行」——输入面自己
   * 先插一个换行，菜单就永远选不中了。所以判据是 `defaultPrevented`：调用方拦下的那一下，
   * 这里一个字都不动。
   */
  const onKeyDownInternal = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    // 输入法合成期间连 Enter 都属于它（选字），一个字都不许我们插。
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey
    if (!plain || composing.current || event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      insertText('\n')
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      if (deleteNeighbourChip(event.key)) event.preventDefault()
    }
  }

  /** 复制按**原文**：标签在剪贴板里还原成 `@路径`（按它画出来的样子复制，粘回去就少一截）。 */
  const writeClipboard = (event: ReactClipboardEvent<HTMLDivElement>): Span | undefined => {
    const host = hostRef.current
    if (host === null) return undefined
    const span = selection(host)
    if (span === undefined || span.start === span.end) return undefined
    event.preventDefault()
    event.clipboardData.setData('text/plain', latest.current.value.slice(span.start, span.end))
    return span
  }

  const onCopy = (event: ReactClipboardEvent<HTMLDivElement>) => {
    writeClipboard(event)
  }

  const onCut = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const span = writeClipboard(event)
    if (span === undefined) return
    const now = latest.current.value
    apply(now.slice(0, span.start) + now.slice(span.end), span.start)
  }

  /** 粘贴只取纯文本：富文本进来会带一整棵 DOM，那正是「内容就是值」这条边界最易被撕开处。 */
  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    insertText(event.clipboardData.getData('text/plain').replace(/\r\n?/gu, '\n'))
  }

  /** 拖进来的文字同理：只当纯文本读，别让浏览器把它当 HTML 塞进正文。 */
  const onDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    insertText(event.dataTransfer.getData('text/plain').replace(/\r\n?/gu, '\n'))
  }

  return (
    <div
      className={className === undefined ? 'dsh-canvas-promptbox' : `dsh-canvas-promptbox ${className}`}
      style={style}
      {...data}
    >
      <div
        className="dsh-canvas-promptbox-field"
        ref={hostRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-placeholder={placeholder}
        spellCheck={spellCheck}
        onInput={readBack}
        onKeyDown={onKeyDownInternal}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
          // 合成期间不让动 DOM（见 `readBack`），所以「贴着标签打的中文」在这里补分隔。
          readBack()
        }}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(event) => event.preventDefault()}
        onFocus={syncQuery}
        onBlur={() => {
          queryStartRef.current = -1
          latest.current.onQueryChange?.(null, null)
        }}
        onKeyUp={syncQuery}
        onMouseUp={syncQuery}
        // 框里滚了一下：值没变、光标没变，只有它们在屏幕上的位置变了——弹窗得跟着那一枚
        // `@` 走（不然它停在滚动前的地方，或者干脆被滚出框外还挂在原处）。
        onScroll={() => {
          if (queryStartRef.current >= 0) syncQuery()
        }}
      />
      {/* 占位符自己画（`contenteditable` 没有 placeholder）：值里**只有空白**时露出来，
          指针全开给下面那层，点它等于点进框里。 */}
      {value.trim() === '' && placeholder !== undefined ? (
        <div className="dsh-canvas-promptbox-placeholder" aria-hidden="true">
          {placeholder}
        </div>
      ) : null}
    </div>
  )
}
