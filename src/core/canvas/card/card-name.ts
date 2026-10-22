/**
 * dsh-canvas — 卡片名（F1.12）。
 *
 * 卡片在板上一直**只有文件名**（`brief.md`、`index.html`），于是两件事说不通：
 * 应用卡显示的是入口页的名字而不是它自己（`myapp/index.html` → 「index.html」），
 * 而名字与磁盘上的文件名互为因果——想换个叫法只能去文件管理器里改，改完卡片还得
 * 重新落座。
 *
 * 这个模块把「卡片叫什么」与「它落在哪条路径」分成两件事：名字是卡片自己的，路径
 * 是产物的。二者仍然**对齐**——改名字会顺手改磁盘上的那一项（文件的改文件、目录的
 * 改目录），但记录里只留**与默认不一致**的那一份：`name` 为空时显示按文件推出来的
 * 那个默认名，于是老记录（没有 `name`）读出来的正是它一直显示的样子，零迁移。
 *
 * 改名这件事本身是**纯粹的几何**：给定 `file`、`kind` 与新名字，算出「改谁、改成
 * 什么、记录里的 file 变成什么」。撞名要不要带序号由调用方循环（它才知道磁盘上
 * 有什么），拒改的理由由这里给。所以每一条都能在容器外测（`tests/core/canvas/card-name.spec.ts`）。
 *
 * 三条判据：
 *
 * 1. **改的是「产物自己那一项」。** 文件形态改文件、目录形态改目录：判据是**路径
 *    形态**（入口页固定叫 `index.html`，见 {@link isEntryPage}）——目录形态的产物
 *    改的是那个**目录**，入口页跟着走（`myapp/index.html` → `市场分析/index.html`）；
 *    `folder` 的产物就是目录本身；其余形态改文件，**扩展名留着**（改的是名字，不是形态）。
 * 2. **画布根目录不归卡片管。** 产物就落在项目根上时（根上的 `index.html`、
 *    根名本身）没有可改的那一项：改了就等于改画布目录，交给画布自己那条路。
 * 3. **名字里不出现路径。** 用户输入先过一遍 {@link fileStemOf}：控制字符与
 *    `/ \ : * ? " < > |` 换掉，空白收成 `-`，首尾的点与横杠去掉（否则能写出
 *    `.hidden` 或 `../x` 这种东西）。CJK 与大小写原样留着——用户打的是什么，
 *    文件就叫什么。
 */

/**
 * 产物是不是「一个目录的入口页」：scaffold 的约定是入口页固定叫 `index.html`，
 * 所以判据看**路径形态**而不是 kind——归并后 `app` 既盖得住单文件页面
 * （`deck.html`，改名改文件），也盖得住目录应用（`myapp/index.html`，改名改目录），
 * kind 已经分不出这两种形态，路径分得清。
 *
 * 导出。这条判据不止是改名的：**凡是「产物是一个人还是一个文件夹」这个问题，答案
 * 都由它给出**——改名要知道改哪一项（`planRename`），打包要知道装哪一项
 * （`bundleTarget`），预览要知道按哪个目录解析同级资源（`ArtifactIo.inlinePageAssets`）。
 * 三处各写一遍 `endsWith('index.html')` 就是三份会各自漂移的知识，而它们漂移起来是
 * 静默的：改名的判据错了是改错文件，打包的判据错了是**少装几个文件**——一个看起来
 * 像导出、实为半份的包（v1.58 就是这么发出一份只有 `index.html` 的 zip 的）。
 */
export function isEntryPage(file: string): boolean {
  return basenameOf(file).toLowerCase() === 'index.html'
}

/** Longest name this module keeps, in characters. */
const NAME_LIMIT = 60

/** One path segment boundary: the last `/`, with the rest of the path. */
export function basenameOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? path : path.slice(cut + 1)
}

/** Everything before the last `/`; `''` for a path at the project root. */
export function dirnameOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}

/** Join two project-relative segments, tolerating an empty parent. */
function join(parent: string, child: string): string {
  return parent === '' ? child : `${parent}/${child}`
}

/** The `.ext` a file basename carries, dot included; `''` when it has none. */
export function extensionOf(basename: string): string {
  const cut = basename.lastIndexOf('.')
  // `cut === 0` is a dotfile (`.gitignore`): its dot is the whole name, not an
  // extension, and the stem must stay the name itself.
  return cut <= 0 ? '' : basename.slice(cut)
}

/** A file basename without its extension. */
export function stemOf(basename: string): string {
  const extension = extensionOf(basename)
  return extension === '' ? basename : basename.slice(0, -extension.length)
}

/**
 * Turn a user-typed name into a path segment that cannot escape its folder.
 *
 * Deliberately not `slugify`: that one lowercases and collapses CJK-adjacent
 * runs because it names a *new* scaffold from a spec, while this one is the
 * user typing a title they will see on the card and in their file manager. So
 * case and non-ASCII letters survive, and only what a file name may not carry
 * (or must not begin with) is changed.
 */
export function fileStemOf(name: string): string {
  return name
    // `\p{Cc}` rather than a `\x00-\x1f` range: the same control characters,
    // spelled as the Unicode category they are, which also keeps a linter from
    // having to look at escape sequences it cannot tell from a typo.
    .replace(/\p{Cc}/gu, '')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '')
    .slice(0, NAME_LIMIT)
}

/**
 * The name a card shows (F1.12), stored value first.
 *
 * The fallback is what the card showed before this field existed, minus the
 * noise: a directory-backed artifact is named after its **folder** rather than
 * its entry page (that `index.html` is a detail of how a site is built, not the
 * thing the user made), and a file artifact is named after its basename without
 * the extension.
 */
export function cardNameOf(input: { file: string; kind: string; name?: string | undefined }): string {
  const stored = input.name?.trim() ?? ''
  if (stored !== '') return stored
  const base = basenameOf(input.file)
  if (!isEntryPage(input.file)) return stemOf(base)
  const folder = dirnameOf(input.file)
  // A root-level entry page has no folder of its own to borrow a name from.
  return folder === '' ? stemOf(base) : basenameOf(folder)
}

/**
 * 一个刚落座的卡片在**没人给它起名之前**叫什么：类型名，第二张起带序号（v1.54）。
 *
 * 建卡那一侧拿它当**产物的名字**用（`文本1.md` / `应用1/` / `设计1.design`），
 * 而不是往记录里塞一个 `name`——名字与磁盘从出生就是同一句话，`cardNameOf` 推出来的
 * 正是它，于是一条记录都不用多写。序号的判据在调用方（它才看得到板上与盘上已占的
 * 名字），这里只负责「第 n 张叫什么」。
 */
export function autoNameOf(label: string, sequence: number): string {
  return sequence <= 1 ? label : `${label}${String(sequence)}`
}

/**
 * What a rename decided, or why it declined to decide anything. */
export type RenamePlan =
  | {
      kind: 'rename'
      /** The directory entry to move, project-relative — a folder or a file. */
      from: string
      /** Where it goes, project-relative, same parent unless it is a folder rename. */
      to: string
      /** The record's `file` after the rename. `=== from`'s counterpart when nothing moves. */
      file: string
    }
  | { kind: 'refused'; reason: RenameRefusal }

/** Why a rename is not something this card may do. */
export type RenameRefusal =
  /** The name carries nothing a path segment can be made of. */
  | 'empty-name'
  /** The renameable entry *is* the canvas folder, which belongs to the project. */
  | 'root-entry'
  /** Every `-2`…`-99` on the way to a free name was taken as well. */
  | 'name-taken'

/** A refusal, with the caller's own message included. */
export const RENAME_REFUSAL_TEXT: Readonly<Record<RenameRefusal, string>> = {
  'empty-name': '这个名字里没有一个能当文件名的字',
  'root-entry': '产物就在画布根目录上，改它的名字等于改画布目录——留给画布自己那条路',
  'name-taken': '这个名字（连同它的 -2…-99 变体）在磁盘上都被占着，换一个',
}

/** Highest collision suffix this module will try before giving up. */
const MAX_SUFFIX = 99

/**
 * Decide what a rename moves.
 *
 * `suffix` is the caller's collision counter (2, 3, …): this module never looks
 * at the disk, so "the target is taken" is answered by calling again with the
 * next suffix (see {@link settleRename}). With `suffix === 1` the result may
 * equal the current entry, which is the caller's signal that only the record's
 * `name` is in play.
 */
export function planRename(input: { file: string; kind: string; name: string; suffix?: number }): RenamePlan {
  const stem = fileStemOf(input.name)
  if (stem === '') return { kind: 'refused', reason: 'empty-name' }
  // A card bound to the root itself — the whole canvas is its artifact — has no
  // entry of its own to move, whatever its kind.
  if (input.file === '' || input.file === '.') return { kind: 'refused', reason: 'root-entry' }
  const suffix = input.suffix ?? 1
  const entry = suffix > 1 ? `${stem}-${suffix}` : stem

  if (isEntryPage(input.file)) {
    const folder = dirnameOf(input.file)
    if (folder === '') return { kind: 'refused', reason: 'root-entry' }
    const parent = dirnameOf(folder)
    const to = join(parent, entry)
    return { kind: 'rename', from: folder, to, file: join(to, basenameOf(input.file)) }
  }

  // `folder`'s artifact *is* the directory the card's `file` names, so its name
  // is the path itself and there is no extension to preserve — `my.docs` is a
  // directory called that, not a `docs` file.
  const extension = input.kind === 'folder' ? '' : extensionOf(basenameOf(input.file))
  const to = join(dirnameOf(input.file), `${entry}${extension}`)
  return { kind: 'rename', from: input.file, to, file: to }
}

/**
 * The rename to actually perform, with collisions settled.
 *
 * `taken` is injected — the caller is the one that can look at the disk — the
 * same way `planSeats` takes its `mint` callback, so the whole policy ("`-2`,
 * `-3`, … until free") is testable without a container. The loop is bounded:
 * a folder that has somehow accumulated ninety-nine of the same name refuses
 * rather than grinding through probes forever.
 */
export async function settleRename(input: {
  file: string
  kind: string
  name: string
  /** Whether an entry path is already occupied. */
  taken: (candidate: string) => Promise<boolean>
}): Promise<RenamePlan> {
  for (let suffix = 1; suffix <= MAX_SUFFIX; suffix += 1) {
    const plan = planRename({ file: input.file, kind: input.kind, name: input.name, suffix })
    if (plan.kind === 'refused') return plan
    // The target is the entry itself: nothing to move on disk, and only the
    // record's own name may have anything to say.
    if (plan.to === plan.from) return plan
    if (!(await input.taken(plan.to))) return plan
  }
  return { kind: 'refused', reason: 'name-taken' }
}

/**
 * What to do on disk for a settled rename — one step, or none.
 *
 * The judgement this pins is the one that is easy to get wrong: **a card whose
 * artifact is not on disk is not an error.** A seat may be waiting for its first
 * write (F1.11) and a card may be a ghost whose file was deleted (F3.5); in both
 * cases a rename is simply the seat re-pointing at the new path, and the file
 * the user is thinking of is the one that will be written there.
 */
export type RenameStep =
  | { kind: 'move'; from: string; to: string; file: string }
  | { kind: 'rebind'; file: string }

/** The disk half of one settled rename (see {@link settleRename}). */
export function renameStep(input: {
  /** A plan that decided to rename — a refusal is the caller's to raise, not ours to act on. */
  plan: Extract<RenamePlan, { kind: 'rename' }>
  sourcePresent: boolean
}): RenameStep {
  const { plan } = input
  if (plan.to === plan.from || !input.sourcePresent) return { kind: 'rebind', file: plan.file }
  return { kind: 'move', from: plan.from, to: plan.to, file: plan.file }
}

/**
 * What to store on the record: the name when it says something the file does
 * not already say, `undefined` when it is exactly the derived default.
 *
 * The same discipline as `file` (stored only when it differs from the id): a
 * record that carries no `name` is one whose display name is a pure function of
 * its path, so a future change to the derivation reaches every card that never
 * chose a name of its own.
 */
export function storedNameOf(input: { file: string; kind: string; name: string }): string | undefined {
  const wanted = input.name.trim().slice(0, NAME_LIMIT * 2)
  if (wanted === '') return undefined
  return wanted === cardNameOf({ file: input.file, kind: input.kind }) ? undefined : wanted
}
