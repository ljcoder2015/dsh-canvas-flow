/**
 * dsh-canvas — 「导入本地文件当产物」（F2.7，v1.81）。
 *
 * 用户原话：「卡片操作栏添加导入功能，可以上传本地的图片和视频当做产物」。
 *
 * 这个模块只回答两件事，都是纯的：
 *
 * 1. **这个文件名能不能用**——扩展名得是媒体（判据在 `core/media/mime.ts` 那张表上，
 *    与全屏预览的字节通道同一份），名字得能落成一个安全的路径段。
 * 2. **落在哪个路径**——沿用卡片现产物所在的目录；同名且就是这张卡自己的文件时算
 *    **替换**，被别人的文件占着就往下加 `-2`、`-3`。
 *
 * 真正搬字节的是宿主（`ArtifactIo.writeBytes`）与客户端（读文件），这里不碰 fs、不碰
 * DOM：撞名那个判据由调用方以 `taken` 注入，于是这份逻辑在 node 里能穷举验。
 */
import { mediaMimeOf } from '../../media/mime.ts'
import { basenameOf, dirnameOf, extensionOf, fileStemOf, stemOf } from '../card/card-name.ts'

/**
 * 一次导入允许搬运的字节上限（16MB）。
 *
 * 与全屏预览的读取上限（`artifact-io.ts` 的 `VIEW_BYTES_CAP`）**是两个事实**，只是恰好
 * 取同一个数：那边是「一次读回多少字节给预览」，这边是「一次允许搬进画布多少字节」。
 * 合成一个常量看着省事，代价是调其中一个会莫名其妙地放开另一个。
 *
 * 不过它们之间有一条必须成立的关系：**能搬进来的，必须也看得见**。所以判据里有一条
 * `IMPORT_MAX_BYTES <= VIEW_BYTES_CAP` 的接线——不然用户会导进来一个点开就报「产物
 * 过大」的视频，而没有任何一步告诉过他。
 *
 * 再往上的视频（几十 MB）就直说「先压小再导入」：本机只有一条 wire 能把字节从浏览器送
 * 到宿主，而那条路要整段 base64 一趟走完。
 */
export const IMPORT_MAX_BYTES = 16_000_000

/** 一次导入被拒的三种理由，客户端据此说三种不同的话。 */
export type ImportRefusal =
  /** 不是媒体扩展名（.pdf / .heic / .txt…）：这张卡的产物该是画/放/听的东西。 */
  | 'unsupported'
  /** 超过 {@link IMPORT_MAX_BYTES}。 */
  | 'too-large'
  /** 零字节：选了个空文件，落下去只会让卡面显示「产物在里面是空的」。 */
  | 'empty'

/**
 * 一次导入的结论。
 *
 * `replaced` 只在「新名字与这张卡现在的产物路径一模一样」时为真——那时是覆盖自己，
 * 不是新建一个文件，提示条也该说「替换了」而不是「导入了」。
 */
export type ImportPlan =
  | { readonly kind: 'write'; readonly file: string; readonly replaced: boolean }
  | { readonly kind: 'refused'; readonly reason: ImportRefusal }

/**
 * 把用户选中的文件名收成一个能落盘的路径段。
 *
 * 只取 basename（浏览器给的是名字，但 `webkitRelativePath` 之类的东西会带斜杠），
 * 其余交给 `fileStemOf`——它已经是「用户亲手打的名字」那条规矩的落点：大小写与非 ASCII
 * 原样保留，只改文件名不能带的东西。**扩展名不参与清洗**，但要转成小写再认：
 * `IMG_0042.JPG` 该被认成 jpg，而落盘时仍按用户的名字写。
 *
 * @param name - 用户选中的文件名，可能带目录、可能什么都没有。
 * @returns 净化后的文件名（可能为空串，调用方据此判 `unsupported`），以及小写扩展名。
 */
export function importNameOf(name: string): { file: string; extension: string } {
  const base = basenameOf(name.replace(/\\/g, '/')).trim()
  const extension = extensionOf(base).replace(/^\./, '').toLowerCase()
  const stem = fileStemOf(stemOf(base))
  return stem === '' ? { file: '', extension } : { file: `${stem}${extensionOf(base)}`, extension }
}

/**
 * 决定这次导入写到哪儿，或者为什么不能导。
 *
 * @param input.name - 用户选中的文件名。
 * @param input.size - 文件的字节数（浏览器已解出来的，不用读内容）。
 * @param input.current - 这张卡现在的产物路径。新文件落在**同一个目录**里：一张
 *   `decks/slide.md` 的卡导进一张图，图该进 `decks/`，而不是跑到项目根去。
 * @param input.taken - 这个路径上已经有别的东西了吗。**由调用方注入**：只有宿主知道
 *   磁盘上真正有什么（板上已经拿掉的旧卡留下的文件同样算占位）。
 * @returns 要写的路径，或者拒绝的理由。
 */
export async function importPlanOf(input: {
  readonly name: string
  readonly size: number
  readonly current: string
  readonly taken: (file: string) => Promise<boolean>
}): Promise<ImportPlan> {
  const { file, extension } = importNameOf(input.name)
  // 媒体表既判「有没有扩展名」也判「是不是媒体」，不必再写一条 `file === ''` 的分支：
  // 空名字必然得到空扩展名，而空扩展名在那张表里查不到。
  if (mediaMimeOf(extension) === undefined) return { kind: 'refused', reason: 'unsupported' }
  if (input.size <= 0) return { kind: 'refused', reason: 'empty' }
  if (input.size > IMPORT_MAX_BYTES) return { kind: 'refused', reason: 'too-large' }

  const folder = dirnameOf(input.current)
  const join = (base: string): string => (folder === '' ? base : `${folder}/${base}`)

  const first = join(file)
  // 撞的是**自己**：同一个名字、同一张卡 → 覆盖。这是「再导一次同一张照片」的正常路径，
  // 加个 `-2` 反而会把同一张图变成两个文件。
  if (first === input.current) return { kind: 'write', file: first, replaced: true }

  const stem = stemOf(file)
  const suffix = extensionOf(file)
  for (let sequence = 1; ; sequence += 1) {
    const candidate = join(sequence === 1 ? file : `${stem}-${String(sequence)}${suffix}`)
    if (!(await input.taken(candidate))) return { kind: 'write', file: candidate, replaced: false }
  }
}

/**
 * 一句话说清一次拒绝（宿主侧的那一份；界面上显示的是 `locales.ts` 里同一件事的文案）。
 *
 * 两处都有措辞看起来像「同一个东西两个来源」，但它们的读者不同：这一句进错误对象，
 * 会被日志、工具调用、报错条原样带出来；界面上那一句要跟着语言走。所以**理由**只有
 * 一份（{@link ImportRefusal}），措辞各说各的语言。
 */
export const IMPORT_REFUSAL_TEXT: Readonly<Record<ImportRefusal, string>> = {
  unsupported: '只能导入图片、视频或音频：这个扩展名不是媒体',
  'too-large': `文件超过 ${String(Math.round(IMPORT_MAX_BYTES / 1024 / 1024))}MB，请先压小再导入`,
  empty: '这个文件是空的（0 字节），导入进去卡片上也没有东西可显示',
}
