/**
 * dsh-canvas — 产物按卡片类型分目录（F1.13）。
 *
 * 画布项目曾经是「一张画布一个文件夹」，于是所有产物平铺在同一层：`产品需求文档.md`
 * 挨着 `图片.png`、`视频.mp4`、`dsh-canvas-应用/`，用户打开文件管理器看到的是一堆
 * 名字而不是一组结构。这一版把**产物**收进按类型命名的子目录：
 *
 * ```
 * docs/产品需求文档.md      apps/dsh-canvas-应用/index.html   designs/设计稿.design
 * images/图片.png           videos/视频.mp4                  audio/音频.mp3
 * data/表格.csv             files/说明.txt                   folders/素材/
 * ```
 *
 * 三条设计决定，每一条都是为了「这层结构不会自己漂移」：
 *
 * 1. **目录名只有一份真源**（{@link ARTIFACT_FOLDERS}）。建卡（客户端挑名字）、
 *    脚手架（宿主落盘）、迁移（老画布整理）、扫描（绑定已有目录时发现产物）四处都
 *    从这张表取，谁都不许自己拼一个字符串——漏改一处的表现是「东西落在两个地方」，
 *    而它不会报错。
 * 2. **路径仍然是卡片的 `file`，不是第二套身份。** 卡片 id 与产物路径早就分开了
 *    （v1.49），这里只改 `file` 的**形状**：`图片.png` → `images/图片.png`。于是
 *    `cardNameOf`、改名、打包、预览、导出这些按路径推「产物是谁」的地方一个都不用
 *    改——它们读的是路径，而路径只是多了一层前缀。
 * 3. **老画布零代价，迁移只搬根上的条目。** 已经坐在子目录里的产物（用户的
 *    `decks/intro.html`、`apps/应用1/`）一律不动：这层结构是**约定**，不是管制。
 *    迁移只把平铺在项目根上的条目收进去，一件一件搬、搬不动就留着（原样仍然可用）。
 *
 * 迁移这件事本身拆成两半：{@link planFolds} 是纯的（给定卡片记录算出「谁搬到哪」），
 * {@link applyFoldPlans} 只负责撞名与落盘（副作用全部由调用方注入，同 `settleRename`
 * 的形状）。所以整套策略可以在容器外穷举验过，宿主那边只剩「读记录 → 调两个函数 →
 * 写回记录」。
 */
import { isEntryPage } from '../card/card-name.ts'
import { resolveKindId } from '../../artifact/kind/kind-registry.ts'

/**
 * 每种形态的产物落在哪个目录（F1.13）。
 *
 * 键是**折算后**的 kind id（`resolveKindId`），所以老记录上的 `webapp` / `site` /
 * `html-deck` 也会落到 `apps/`——它们读出来的就是 `app`。
 *
 * 取名用英文而不是卡片标签：目录是用户的项目结构，会被 `git`、脚本、别的编辑器读到，
 * 而 `docs/` 与 `images/` 是任何人一眼都认得的；卡片上显示什么语言是界面的事。
 *
 * 没有条目的形态（部署自己注册的 kind，或将来新加的）**留在项目根**：猜一个目录名比
 * 不猜更坏——猜错就是把产物挪到用户不认的地方。
 */
export const ARTIFACT_FOLDERS: Readonly<Record<string, string>> = {
  markdown: 'docs',
  app: 'apps',
  design: 'designs',
  image: 'images',
  video: 'videos',
  audio: 'audio',
  data: 'data',
  file: 'files',
  folder: 'folders',
}

/** 全部类型目录名，用来认「这条路径是不是已经在某个类型目录里了」。 */
const FOLDER_NAMES: ReadonlySet<string> = new Set(Object.values(ARTIFACT_FOLDERS))

/** 这张卡的产物该进哪个目录；`undefined` 表示留在项目根（未知形态）。 */
export function artifactFolderOf(kind: string): string | undefined {
  return ARTIFACT_FOLDERS[resolveKindId(kind)]
}

/** 这个路径段是不是一个类型目录（`docs` / `images` / …）。 */
export function isArtifactFolder(segment: string): boolean {
  return FOLDER_NAMES.has(segment)
}

/** 路径的第一段——迁移的单位是「根上的一个条目」。 */
export function topSegmentOf(path: string): string {
  const cut = path.indexOf('/')
  return cut === -1 ? path : path.slice(0, cut)
}

/** 名字 + 扩展名落在哪个路径上：`文本1` + `md` → `docs/文本1.md`。 */
export function artifactPathOf(kind: string, stem: string, extension: string): string {
  const folder = artifactFolderOf(kind)
  const file = `${stem}.${extension}`
  return folder === undefined ? file : `${folder}/${file}`
}

/**
 * 一个**目录形态**的产物落在哪个路径上：`应用1` → `apps/应用1`。
 *
 * 应用节点的产物是一个带入口页的文件夹，两个脚手架（应用 / 设计）都只需要这一段，
 * 入口页由各自动手拼（`index.html` / `<名字>.design`）。
 */
export function artifactFolderPathOf(kind: string, stem: string): string {
  const folder = artifactFolderOf(kind)
  return folder === undefined ? stem : `${folder}/${stem}`
}

/** 一张卡片在迁移眼里的样子：身份、它指着的路径、它是什么形态。 */
export interface FoldCard {
  readonly id: string
  readonly file: string
  readonly kind: string
}

/** 一个根条目为什么没有被收进类型目录。 */
export type FoldSkipReason =
  /** 已经在某个类型目录里了（新卡、或者迁移已经跑过一次）。 */
  | 'already-folded'
  /** 占着项目根的那张入口页（`index.html`）：整个画布就是它的产物，搬走等于拆了它。 */
  | 'root-entry'
  /** 形态没有对应的目录（部署自定义的 kind）。 */
  | 'no-folder'
  /** 同一个根条目下挂着两种形态的卡片：搬成谁都可能拆散另一个，留给用户。 */
  | 'mixed-kinds'

/** 一个根条目的处置。 */
export type FoldPlan =
  | {
      readonly action: 'move'
      /** 根上的条目（一段）：`图片.png` 或 `dsh-canvas-应用`。 */
      readonly from: string
      /** 目标路径：`images/图片.png`（撞名时会带 `-2`，那是落盘时的事）。 */
      readonly to: string
      /** 目标目录，落盘前要先把它建出来。 */
      readonly folder: string
      readonly kind: string
      /** 指向这个条目的全部卡片（含目录形态里那一层）。 */
      readonly cards: readonly string[]
    }
  | { readonly action: 'skip'; readonly from: string; readonly reason: FoldSkipReason }

/**
 * 算出「哪些根条目该搬进哪个类型目录」（纯函数，不碰磁盘）。
 *
 * 三条判据：
 *
 * 1. **按根条目分组**，不是按卡片。一张应用卡的 `file` 是 `dsh-canvas-应用/index.html`，
 *    搬的必须是整个 `dsh-canvas-应用` 目录——只搬入口页会让它的 `styles.css` 与
 *    `app.js` 留在原地，页面当场变白。同一组里的所有卡片一起改路径。
 * 2. **已经在类型目录里的不再动**（`already-folded`）。这既让迁移可以反复跑，
 *    也让用户自己整理过的结构不会被「越搬越深」。
 * 3. **形态有分歧就不搬**（`mixed-kinds`）。一个目录里既有应用入口页又有一份 md，
 *    说明那是用户自己的结构；搬成 `apps/` 会拆掉应用、搬成 `docs/` 会拆掉那一页。
 */
export function planFolds(cards: readonly FoldCard[]): FoldPlan[] {
  const groups = new Map<string, FoldCard[]>()
  const plans: FoldPlan[] = []

  for (const card of cards) {
    // 指向画布根自己的记录（`''` / `.`）没有可搬的条目。
    if (card.file === '' || card.file === '.') {
      plans.push({ action: 'skip', from: card.file, reason: 'root-entry' })
      continue
    }
    const top = topSegmentOf(card.file)
    const bucket = groups.get(top)
    if (bucket === undefined) groups.set(top, [card])
    else bucket.push(card)
  }

  for (const [top, bucket] of groups) {
    if (isArtifactFolder(top)) {
      plans.push({ action: 'skip', from: top, reason: 'already-folded' })
      continue
    }
    // 根上的入口页＝「这个文件夹本身就是一个应用」，搬它没有安全的目标。
    if (bucket.some((card) => card.file === top && isEntryPage(top))) {
      plans.push({ action: 'skip', from: top, reason: 'root-entry' })
      continue
    }
    const kinds = new Set(bucket.map((card) => resolveKindId(card.kind)))
    if (kinds.size > 1) {
      plans.push({ action: 'skip', from: top, reason: 'mixed-kinds' })
      continue
    }
    const kind = [...kinds][0] as string
    const folder = artifactFolderOf(kind)
    if (folder === undefined) {
      plans.push({ action: 'skip', from: top, reason: 'no-folder' })
      continue
    }
    plans.push({
      action: 'move',
      from: top,
      to: `${folder}/${top}`,
      folder,
      kind,
      cards: bucket.map((card) => card.id),
    })
  }

  return plans
}

/** 一次搬动：`from` 整段被 `to` 顶替。 */
export interface FoldMove {
  readonly from: string
  readonly to: string
}

/**
 * 一条旧路径在搬完之后指向哪儿。
 *
 * 判据是**路径段**而不是字符串前缀：`图片.png` 与 `图片.png.bak` 是两件东西，后者
 * 不该跟着前者走。所以比对的是 `from` 本身或其下的 `from/`。
 */
export function foldedPathOf(file: string, moves: readonly FoldMove[]): string {
  for (const move of moves) {
    if (file === move.from) return move.to
    if (file.startsWith(`${move.from}/`)) return `${move.to}${file.slice(move.from.length)}`
  }
  return file
}

/** 撞名时最多试到 `-99`（与改名同一条上限）。 */
const MAX_SUFFIX = 99

/** {@link applyFoldPlans} 要的副作用——全部由调用方注入，于是它自己能在容器外测。 */
export interface FoldEffects {
  /** 这个路径上有没有东西（磁盘，不是板面）。 */
  present(path: string): Promise<boolean>
  /** 把类型目录建出来（`mkdir -p`）。 */
  prepare(folder: string): Promise<void>
  /** 搬一个根条目。 */
  move(from: string, to: string): Promise<void>
  /** 搬不动时说一声；不传就是静默。 */
  warn?(message: string, error: unknown): void
}

/** 搬了什么、没搬成什么。 */
export interface FoldOutcome {
  applied: FoldMove[]
  failed: { from: string; reason: string }[]
}

/**
 * 把计划落到磁盘上：撞名从 `-2` 起试，一个条目失败不影响其它条目。
 *
 * **失败是允许的。** 迁移是整理，不是正确性的一部分：一个只读部署、一个权限不够的
 * 目录、一个刚好被别的程序占着的文件，都只意味着「这一件留在原地」——它照样能被打开、
 * 被预览、被导出。把整个画布读盘搞失败，才是真正的坏结果。
 */
export async function applyFoldPlans(plans: readonly FoldPlan[], effects: FoldEffects): Promise<FoldOutcome> {
  const applied: FoldMove[] = []
  const failed: { from: string; reason: string }[] = []
  const prepared = new Set<string>()

  for (const plan of plans) {
    if (plan.action !== 'move') continue

    let target = plan.to
    let free = false
    for (let suffix = 1; suffix <= MAX_SUFFIX; suffix += 1) {
      const candidate = suffix === 1 ? plan.to : `${plan.to}-${suffix}`
      if (!(await effects.present(candidate))) {
        target = candidate
        free = true
        break
      }
    }
    if (!free) {
      failed.push({ from: plan.from, reason: 'name-taken' })
      continue
    }

    try {
      if (!prepared.has(plan.folder)) {
        await effects.prepare(plan.folder)
        prepared.add(plan.folder)
      }
      await effects.move(plan.from, target)
      applied.push({ from: plan.from, to: target })
    } catch (error) {
      failed.push({ from: plan.from, reason: 'move-failed' })
      effects.warn?.(`artifact ${plan.from} stays at the project root`, error)
    }
  }

  return { applied, failed }
}
