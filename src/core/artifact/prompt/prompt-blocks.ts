/**
 * dsh-canvas — 提示词输入框的**引用标签**：把提示词文本切成「普通文字 + 引用记号」。
 *
 * 提示词里那枚 `@path` 记号（语法在 `file-reference.ts`——与宿主逐字对齐的那份）在
 * 输入框里画成一枚**标签**：图标 + 文件名（超长省略）+ 可选的行号徽标，整体不可分隔。
 * 所以这里的解析只服务**展示**：标签怎么画、画几枚，都不影响发出去的提示词；解析器
 * 也因此必须是纯函数，node 环境单测即可覆盖。
 *
 * 一条**判据级**的不变量把两件事拴在一起：{@link promptAtoms} 切出来的原子，用
 * {@link atomsText} 拼回去必须**逐字节等于原文**（含引号形态的全部字符）。输入面的
 * 序列化就建立在这条上——标签写出去的是它自己那串字符，不是重新拼的路径
 * （`@"my brief.md"` 与 `@"dir/` 两种形态都拼不出来），于是「显示成标签」这件事
 * 在机制上改不到提示词。
 *
 * 切分规则与宿主记号语法同一条边界，刻意保守：
 *
 * - 记号必须从**词首**开始（串首，或前一个字符是空白）——`foo@bar` 里的 `@` 不是引用。
 * - 裸记号 `@path` 到第一个空白为止；带引号的形式 `@"path"` 到同行的闭合引号（跨不了
 *   行）；引号不闭合就是宿主补全的那条「开着引号的目录」约定——记号延伸到行尾。
 * - 路径过不了 `formatFileMention` 的同一道安检（控制字符、DEL/C1、双引号）就当普通
 *   文字画：一段语法带不动的路径，宁可不作块，也不把块画在一个发出去就变样的记号上。
 *
 * 不变量：各段的字符依次拼回去必须等于原文（`tests/core/artifact/prompt-blocks.spec.ts`
 * 钉住这一条）——镜像层是逐段照抄渲染的，拼不回去就等于显示的不是用户写的话。
 */

/** 一段提示词文本：普通文字，或一枚文件引用记号。 */
export type PromptSegment =
  | { kind: 'text'; text: string }
  | {
      kind: 'file'
      /** The characters as written — the mirror layer renders them verbatim. */
      token: string
      /** The path the token names: quotes stripped, directory suffix kept. */
      path: string
      /** 展示名：路径的最后一段；目录形式带着自己的那条斜杠。 */
      name: string
      /** 记号的引号形态：裸、开着（目录补全约定）、闭合。 */
      quote: 'none' | 'open' | 'closed'
    }

/** The file-mention half of {@link PromptSegment}. */
export type FileSegment = Extract<PromptSegment, { kind: 'file' }>

/** 路径安检与宿主同源：`formatFileMention` 用哪道，展示解析就用哪道。 */
import { hasUnsafeCharacter } from './file-reference.ts'

function isWhitespace(character: string): boolean {
  return /\s/u.test(character)
}

/** 路径的最后一段；目录形式把结尾那条斜杠留在展示名里。 */
function baseNameOf(path: string): string {
  const directory = path.endsWith('/')
  const stem = directory ? path.slice(0, -1) : path
  const at = stem.lastIndexOf('/')
  return (at === -1 ? stem : stem.slice(at + 1)) + (directory ? '/' : '')
}

/** 从 `start`（一个 `@`）读出一枚记号；语法带不动就交回 `undefined`（按普通文字画）。 */
function readMention(text: string, start: number): FileSegment | undefined {
  const after = start + 1
  if (after >= text.length) return undefined
  if (text[after] === '"') {
    const lineEnd = text.indexOf('\n', after + 1)
    const limit = lineEnd === -1 ? text.length : lineEnd
    const close = text.indexOf('"', after + 1)
    if (close !== -1 && close < limit) {
      const path = text.slice(after + 1, close)
      if (path === '' || hasUnsafeCharacter(path)) return undefined
      return { kind: 'file', token: text.slice(start, close + 1), path, name: baseNameOf(path), quote: 'closed' }
    }
    const path = text.slice(after + 1, limit)
    if (path === '' || hasUnsafeCharacter(path)) return undefined
    return { kind: 'file', token: text.slice(start, limit), path, name: baseNameOf(path), quote: 'open' }
  }
  let end = after
  while (end < text.length && !isWhitespace(text[end]!)) end += 1
  const path = text.slice(after, end)
  if (path === '' || hasUnsafeCharacter(path)) return undefined
  return { kind: 'file', token: text.slice(start, end), path, name: baseNameOf(path), quote: 'none' }
}

/**
 * Scan a prompt into its display segments.
 *
 * @param text - the prompt as written.
 * @returns the segments, in order; joined, they are `text` again.
 */
export function scanFileMentions(text: string): PromptSegment[] {
  const segments: PromptSegment[] = []
  let plain = ''
  let at = 0
  while (at < text.length) {
    const character = text[at]!
    if (character === '@' && (at === 0 || isWhitespace(text[at - 1]!))) {
      const mention = readMention(text, at)
      if (mention !== undefined) {
        if (plain !== '') {
          segments.push({ kind: 'text', text: plain })
          plain = ''
        }
        segments.push(mention)
        at += mention.token.length
        continue
      }
    }
    plain += character
    at += 1
  }
  if (plain !== '') segments.push({ kind: 'text', text: plain })
  return segments
}

/**
 * One reference as the input surface carries it — 一枚**类型化的引用标签**。
 *
 * 类型是文档给的那六种，按「它指着什么」分家：`code` / `image` / `video` / `audio` 指一份
 * **文件**（本插件里引用一律是文件：锚点就是路径，模型照它自己去读），`mark` / `region`
 * 指一张图上的**一个点或一个框**（坐标归一化到 0–999，与图像模型那套约定一致）。
 *
 * 两处必须说明：
 *
 * - **`id` 就是它写进提示词的那串字符**（`@a.ts` / `@"my brief.md"` / `@"dir/`；标记类是
 *   `@img.png <point>420 380</point>`），不是另起的编号。理由是不变量——宿主记号有三种
 *   形态，从 `filePath` 反推不出用户写的是哪一种，重新拼一次就可能把发出去的提示词改掉
 *   一个字节。存原文，序列化就永远是对的。
 * - **标签写文件名，不写序号**。文档那套 `@图片1` 编号是「图片另走一路、文本里只留锚点」
 *   的产物；本插件的锚点就是文件的路径（模型照 `read` 去取那一份），所以标签老老实实写
 *   `hero.png`——两枚同名图片因此在提示词里也还分得清谁是谁。视觉内容由模型自己去读那份
 *   文件，不需要第二条通道。
 */
export interface PromptReference {
  /** The characters that stand for this reference in the prompt. */
  readonly id: string
  /** 引用类型（文档的分类）。 */
  readonly type: ReferenceType
  /** 展示名：文件类是路径最后一段（目录形式带着自己那条斜杠），标记类是调用方给的记号。 */
  readonly label: string
  /** The path the token names: quotes stripped, directory suffix kept. */
  readonly filePath?: string
  /** 行号范围（`code` 类可选）——只有调用方**知道**行号时才在。 */
  readonly startLine?: number
  readonly endLine?: number
  /** 缩略图（`data:` URL，媒体类可选）——只有调用方取得到时才在。 */
  readonly thumbnail?: string
  /** 标记类：它标在哪张图上（那枚文件记号）。 */
  readonly target?: string
  /** 标记类：归一化到 0–999 的点与框。 */
  readonly point?: readonly [number, number]
  readonly bbox?: readonly [number, number, number, number]
  /**
   * 悬停时给出的那一行说明（调用方给得出才有）。
   *
   * 元素类靠它把被折进去的定位交代清楚——一枚标签把那几十行原文收成一行字，人总得有个
   * 地方确认「说的是哪个节点、哪个文件」。没有它时退回路径 / 目标 / 名字。
   */
  readonly detail?: string
}

/**
 * The reference types, as the document names them.
 *
 * `code` 是本插件的主力（提示词里引一份文件，模型去读它），媒体三类是同一件事换了一副
 * 长相（缩略图 / 类型图标），`mark` / `region` 是**图上的坐标**——它的文本形态
 * （{@link markText}）今天还没有入口产生，契约先钉在这里：等图像预览器上有了圈选，
 * 写进提示词的就是这一段。
 *
 * `element` 与它们都不同：它指的**不是文件、也不是图上的坐标**，而是「产物里的这个
 * 节点」（F3.14 的元素选择）。它那串字符是一整段定位提示词（产物、节点、位置、源码），
 * 由 {@link PromptFold} 折成一枚标签——多模态引用的第四种长相，也是唯一一种**原文由
 * 调用方生成**的引用。
 */
export type ReferenceType = 'code' | 'image' | 'video' | 'audio' | 'mark' | 'region' | 'element'

/** Image extensions the board shows as pictures rather than text. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac'])

/**
 * Which reference type a path is — **by extension, not by asking the board**.
 *
 * 判据刻意只有一份：调用方（控制带）手上是卡片、而卡片可能已经离开画布，引用却还写在
 * 草稿里；扩展名写在路径本身，谁都能读，两处也就不会各说各话。它只管**长相**（缩略图
 * 还是图标），管不着对错——文件不存在时它照样是个文件引用。
 *
 * @param path - the workspace-relative path.
 */
export function referenceTypeOf(path: string): ReferenceType {
  const cut = path.lastIndexOf('.')
  const extension = cut === -1 ? '' : path.slice(cut + 1).toLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  return 'code'
}

/**
 * What a caller knows about one referenced path, beyond what its characters say.
 *
 * 全部可选：不知道就什么都不给，标签照旧画——扩展名已经决定了长相，行号与缩略图是**额外**
 * 的东西。今天控制带给得出缩略图（媒体产物读得到的 data URL），行号还没有哪个界面知道；
 * 标记类那几项要等图像上的圈选。
 */
export interface ReferenceFacts {
  /** Override the type the extension implies. */
  type?: ReferenceType
  startLine?: number
  endLine?: number
  thumbnail?: string
  label?: string
  target?: string
  point?: readonly [number, number]
  bbox?: readonly [number, number, number, number]
}

/** 显示模型的原子：一段普通文字，或一枚引用标签。 */
export type PromptAtom =
  | { kind: 'text'; text: string }
  | { kind: 'ref'; reference: PromptReference }

/**
 * 值里的一段**已知原文**：调用方说「这 N 个字符是一枚引用」。
 *
 * `@文件` 记号是输入面**自己认出来**的（语法就写在字符里）。但有些引用不是那种形态——
 * 元素选择把「产物 + 节点 + 位置 + 源码」一整段定位写进提示词（F3.14），那是几十行原文，
 * 没有任何记号语法能表达它。而调用方**知道**那一段的确切位置与长度（它就是自己刚写进去
 * 的），所以由调用方声明「这一段是一枚引用」，输入面照着画一枚标签。
 *
 * 两处刻意的设计：
 *
 * - `at` 是**绝对**偏移。相对长度（「从上一枚之后数」）省不了几个字符，却要多一次累加，
 *   而累加错一位就会把不相干的字符折进去。今天只有一枚（在 0），多枚也只是排个序。
 * - **`reference.id` 不作数**，输入面一律拿 `text` 上那一段原文当自己的 token（见
 *   {@link promptAtoms}）。于是「标签写出去的是它自己那串字符」这条不变量在折叠这条路上
 *   是**结构性**成立的，不靠调用方守规矩。
 */
export interface PromptFold {
  /** 从值的开头数，这段原文排第几个字符起。 */
  readonly at: number
  /** 折进去几个字符。 */
  readonly length: number
  /** 这一段该画成什么样（类型、名字、tooltip）。它的 `id` 会被原文覆盖。 */
  readonly reference: PromptReference
}

/** 归一化坐标的上界：0–999 是图像那套约定（{@link markText} 写出去的就是这个刻度）。 */
export const COORDINATE_SPAN = 999

/**
 * Turn a 0–1 fraction into the 0–999 integer the coordinate grammar speaks.
 *
 * 一处算术，三处要用（点、框的两个角）：夹在 0 与 999 之间、四舍五入到整数——它写进
 * 提示词就是要给图像模型看的像素刻度，小数没有意义。
 *
 * @param fraction - a 0–1 position along either axis.
 */
export function normalizeCoordinate(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0
  return Math.max(0, Math.min(COORDINATE_SPAN, Math.round(fraction * COORDINATE_SPAN)))
}

/**
 * The text form of a mark: `@path <point>x y</point>` / `@path <bbox>x1 y1 x2 y2</bbox>`.
 *
 * 里层那两个标签与文档给的形态**逐字一致**（`<point>` / `<bbox>`，坐标为 0–999 的整数），
 * 变的是外面那半截：文档写的是标记自己的名字（`mark1<point>…`），这里写的是**它标在哪张
 * 图上**（那枚 `@路径`）。同一条理由贯穿全篇——本插件里一切引用都锚在路径上，而「哪张
 * 图上的哪个点」这件事必须能从提示词本身读回来（草稿是按字符串存与回填的，没有第二张
 * 表可以查）。标记的名字因此由路径推出来（标签写的就是图的名字）。
 *
 * 它是**构造**那一半：圈选界面把一次点击/拖框变成这段文字写进提示词，输入面再把这段
 * 文字读回一枚标记标签（{@link promptAtoms}），两边共用这一份语法。
 *
 * @param input.target - the image's mention as written, e.g. `@hero.png`.
 * @param input.point - a normalized point, for a single-spot mark.
 * @param input.bbox - a normalized box, for a region.
 * @returns the text form, or `undefined` when it carries neither a point nor a box.
 */
export function markText(input: {
  target: string
  point?: readonly [number, number]
  bbox?: readonly [number, number, number, number]
}): string | undefined {
  if (input.bbox !== undefined) {
    const [x1, y1, x2, y2] = input.bbox
    return `${input.target} <bbox>${String(x1)} ${String(y1)} ${String(x2)} ${String(y2)}</bbox>`
  }
  if (input.point !== undefined) {
    const [x, y] = input.point
    return `${input.target} <point>${String(x)} ${String(y)}</point>`
  }
  return undefined
}

/** 标记的那段文字（`<point>` / `<bbox>`）——{@link markText} 写出来的那半截。 */
const MARK_PATTERN = /^\s*<(point|bbox)>([\d\s.]+)<\/\1>/u

/**
 * Read a coordinate tag as a mark reference.
 *
 * 只认紧跟在某枚文件记号后面的那一段（中间隔一个空白）：`@hero.png <point>420 380</point>`
 * 说的是「这张图上的这一个点」。隔着别的话就不是标记了——那是用户自己在写标签。
 *
 * @param text - the prompt tail right after a mention.
 * @param target - the mention the tag attaches to.
 * @returns the mark and how many characters it consumed.
 */
function readMark(
  text: string,
  target: string,
): { reference: PromptReference; length: number } | undefined {
  const matched = MARK_PATTERN.exec(text)
  if (matched === null || matched[1] === undefined || matched[2] === undefined) return undefined
  const [whole, tag, numbers] = [matched[0], matched[1], matched[2]] as const
  const parts = numbers.trim().split(/\s+/u).map(Number)
  if (parts.some((value) => !Number.isFinite(value))) return undefined
  const point = tag === 'point' && parts.length === 2 ? ([parts[0]!, parts[1]!] as const) : undefined
  const bbox = tag === 'bbox' && parts.length === 4 ? ([parts[0]!, parts[1]!, parts[2]!, parts[3]!] as const) : undefined
  if (point === undefined && bbox === undefined) return undefined
  return {
    reference: {
      id: whole,
      type: tag === 'point' ? 'mark' : 'region',
      label: '',
      target,
      ...(point === undefined ? { bbox } : { point }),
    },
    length: whole.length,
  }
}

/**
 * Split a prompt into the atoms the input surface draws.
 *
 * 两条路合起来读一段文本：**折叠**（调用方声明的那几段，直接成原子）与**记号**（字符
 * 里自己写得出来的 `@路径`）。两者不冲突——折叠区间的字符不再过扫描器，扫描器只处理
 * 它们**之间**的普通文本。
 *
 * 折叠那一侧有一条结构性的保证：原子的 token 一律取 `text` 上那一段原文，**不用调用方
 * 给的 `id`**。于是「标签吐回它自己那串字符」这件事不依赖调用方不出错——哪怕它给的 id
 * 与原文差着几个字符，往返也照样逐字节成立（`{@link atomsText}` 拼的是我们存下来的那份）。
 * 区间越界或与前一枚重叠的，按普通文本画：宁可少画一枚标签，也不能把不相干的字符折进去。
 *
 * @param text - the prompt as written.
 * @param facts - what the caller knows about particular paths (thumbnail, lines, mark).
 * @param folds - stretches of text the caller already knows are references.
 * @returns the atoms, in order; {@link atomsText} of them is `text` again.
 */
export function promptAtoms(
  text: string,
  facts?: Readonly<Record<string, ReferenceFacts>>,
  folds?: readonly PromptFold[],
): PromptAtom[] {
  const atoms: PromptAtom[] = []
  let cursor = 0
  for (const fold of [...(folds ?? [])].sort((left, right) => left.at - right.at)) {
    const end = fold.at + fold.length
    if (fold.length <= 0 || fold.at < cursor || end > text.length) continue
    atoms.push(...plainAtoms(text.slice(cursor, fold.at), facts))
    atoms.push({ kind: 'ref', reference: { ...fold.reference, id: text.slice(fold.at, end) } })
    cursor = end
  }
  atoms.push(...plainAtoms(text.slice(cursor), facts))
  return atoms
}

/**
 * 一段**没有折叠**过的文本能认出的原子：`@记号`，以及紧跟其后的坐标标签。
 *
 * @param text - plain prompt text.
 * @param facts - what the caller knows about particular paths.
 */
function plainAtoms(
  text: string,
  facts?: Readonly<Record<string, ReferenceFacts>>,
): PromptAtom[] {
  const segments = scanFileMentions(text)
  const atoms: PromptAtom[] = []
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    if (segment.kind === 'text') {
      atoms.push({ kind: 'text', text: segment.text })
      continue
    }
    const known = facts?.[segment.path]
    const label = known?.label ?? segment.name
    const file: PromptReference = {
      id: segment.token,
      type: known?.type ?? referenceTypeOf(segment.path),
      label,
      filePath: segment.path,
      ...(known?.startLine === undefined
        ? {}
        : { startLine: known.startLine, endLine: known.endLine ?? known.startLine }),
      ...(known?.thumbnail === undefined ? {} : { thumbnail: known.thumbnail }),
    }
    // 紧跟其后的坐标标签并进这一枚（`@hero.png <point>420 380</point>` 是一枚**标记**，
    // 不是「一枚文件引用 + 一段用户自己写的标签」）。并进去之后它照样只剩一个字符区间，
    // 所以原子删除、复制、序列化三条路一个字都不用改。
    const after = segments[index + 1]
    if (after === undefined || after.kind !== 'text') {
      atoms.push({ kind: 'ref', reference: file })
      continue
    }
    const mark = readMark(after.text, segment.token)
    if (mark === undefined) {
      atoms.push({ kind: 'ref', reference: file })
      continue
    }
    atoms.push({
      kind: 'ref',
      reference: {
        id: segment.token + mark.reference.id,
        type: mark.reference.type,
        label,
        filePath: segment.path,
        target: segment.token,
        ...(mark.reference.point === undefined ? {} : { point: mark.reference.point }),
        ...(mark.reference.bbox === undefined ? {} : { bbox: mark.reference.bbox }),
      },
    })
    const rest = after.text.slice(mark.length)
    if (rest === '') segments.splice(index + 1, 1)
    else segments[index + 1] = { kind: 'text', text: rest }
  }
  return atoms
}

/**
 * The badge a reference shows next to its label, or `undefined` for no badge.
 *
 * 行号与坐标都只在**真有**的时候画：引用的是整份产物（今天绝大多数）就不挂一枚 `1-∞`
 * 之类的假徽标——一个永远在的装饰会让人以为它说的是别的什么。
 *
 * @param reference - the reference as written.
 */
export function referenceBadge(reference: PromptReference): string | undefined {
  if (reference.bbox !== undefined) return reference.bbox.join(' ')
  if (reference.point !== undefined) return reference.point.join(' ')
  const { startLine, endLine } = reference
  if (startLine === undefined) return undefined
  const last = endLine === undefined ? startLine : endLine
  return last === startLine ? String(startLine) : `${String(startLine)}-${String(last)}`
}

/**
 * Put the atoms back together — the prompt, byte for byte.
 *
 * 这是输入面唯一的序列化出口，也是「标签只是画上去的」这句话的兑现处：它只把每枚标签
 * 自己那串字符原样写回去，不去问它长什么样、有没有被点开过。媒体类因此也还是那枚路径
 * ——视觉内容由模型照路径自己去读，不走第二条通道。
 *
 * @param atoms - the display atoms.
 * @returns the prompt they stand for.
 */
export function atomsText(atoms: readonly PromptAtom[]): string {
  return atoms.map((atom) => (atom.kind === 'text' ? atom.text : atom.reference.id)).join('')
}
