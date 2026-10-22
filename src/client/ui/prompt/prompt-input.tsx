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
import { caretFlat, selection, serializeHost, setCaret, writeAtoms } from './prompt-dom.ts'

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
   * 光标前正在打的那半枚 `@查询`（没有就是 `null`）。
   *
   * 上报而不是自己开菜单：候选是谁（这张卡能引用哪些文件）是调用方的事，输入面只认光标。
   */
  onQueryChange?: (query: string | null) => void
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
 * 光标前那枚 `@查询` 是什么；不成半边记号就是 `null`。
 *
 * 与 `prompt-blocks.ts` 认记号的边界同一条：`@` 必须在词首（串首或前一字符是空白），
 * 查询里也不能有空白——否则用户打「see @ 2pm」这种话时菜单会自己冒出来。
 */
function queryAt(text: string, caret: number): string | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  if (at > 0 && !/\s/u.test(before[at - 1]!)) return null
  const query = before.slice(at + 1)
  return /\s/u.test(query) ? null : query
}

/** 那半枚 `@查询` 在值里的起点；没有查询就是光标自己。 */
function queryStart(text: string, caret: number): number {
  const query = queryAt(text, caret)
  return query === null ? caret : caret - query.length - 1
}

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

  /** 把「光标前那半枚 @查询」上报给调用方（它拿这个开候选菜单）。 */
  const syncQuery = useCallback(() => {
    const host = hostRef.current
    const caret = host === null ? undefined : caretFlat(host)
    const span = caret === undefined ? readCaret() : { start: caret, end: caret }
    latest.current.onQueryChange?.(queryAt(latest.current.value, span.end))
  }, [readCaret])

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
   */
  const deleteNeighbourChip = useCallback(
    (key: 'Backspace' | 'Delete'): boolean => {
      const caret = caretFlat(hostRef.current as HTMLElement)
      if (caret === undefined) return false
      const text = latest.current.value
      let at = 0
      for (const atom of promptAtoms(text, latest.current.refs, latest.current.folds)) {
        const length = atom.kind === 'text' ? atom.text.length : atom.reference.id.length
        if (atom.kind === 'ref' && key === 'Backspace' && at + length === caret) {
          apply(text.slice(0, at) + text.slice(caret), at)
          return true
        }
        if (atom.kind === 'ref' && key === 'Delete' && at === caret) {
          apply(text.slice(0, at) + text.slice(at + length), at)
          return true
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
        // 菜单是点出去的：焦点先要回来，光标才有地方落（它落在我们刚放的那一处）。
        host.focus()
        const text = latest.current.value
        const span = caretRef.current
        const start = queryStart(text, span.start)
        const tail = text.slice(span.end)
        // 后面紧跟的是字就把自己那枚记号封上（`@brief.md` 后面直接接「改成…」会把两个记号
        // 粘成一个词）；后面本来就是空白或行尾就不再添空格。
        const inserted = tail === '' || /^\s/u.test(tail) ? mention : `${mention} `
        apply(`${text.slice(0, start)}${inserted}${tail}`, start + inserted.length)
        latest.current.onQueryChange?.(null)
        return true
      },
    }),
    [apply],
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

  /** 用户改过内容：读回值（标签吐回原文），再报一次光标前的查询。 */
  const onInput = () => {
    const host = hostRef.current
    if (host === null) return
    const text = serializeHost(host)
    markRef.current = { text, key: contentKey(latest.current.refs, latest.current.folds) }
    latest.current.onChange(text)
    const caret = caretFlat(host)
    latest.current.onQueryChange?.(queryAt(text, caret ?? text.length))
  }

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
        onInput={onInput}
        onKeyDown={onKeyDownInternal}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
        }}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(event) => event.preventDefault()}
        onFocus={syncQuery}
        onBlur={() => latest.current.onQueryChange?.(null)}
        onKeyUp={syncQuery}
        onMouseUp={syncQuery}
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
