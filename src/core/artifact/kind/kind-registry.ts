/**
 * dsh-canvas — kind registry (F2.1–F2.4).
 *
 * A kind is decided from *file evidence*, never declared by the user: the
 * extension and a bounded sniff of the content. This module is pure — it takes
 * a probe result, not a context — so both the host's artifact reader and the
 * naming tests can call it without a Cordis container.
 */
import type { ExportFormat, KindDefinition } from '../../../types.ts'
import { WEBAPP_MANIFEST } from './webapp.ts'

/** Text and byte evidence gathered from the target before classification. */
export interface KindProbe {
  /** Path relative to the project root, e.g. `decks/intro.html`. */
  path: string
  /** Whether the path resolved to a directory. */
  directory: boolean
  /** Lower-cased basename, e.g. `index.html`. */
  basename: string
  /** Lower-cased extension without the dot; empty when there is none. */
  extension: string
  /** First few KB of text, when the target is a UTF-8 file within budget. */
  head: string
  /** Direct child names, when the target is a directory. */
  children: readonly string[]
}

/** Characters of `head` a detector may look at. Keeps sniffing bounded. */
export const PROBE_HEAD_LIMIT = 4096

/**
 * The built-in kinds (F2.3).
 *
 * Adding a kind is adding an entry here plus its client tab pattern — no
 * scattered branches (F2.4, §4.7).
 */
export const BUILTIN_KINDS: readonly KindDefinition[] = [
  {
    // 应用（v1.56 归并）：html-deck / site / webapp 三类产物本是同一种东西——一份
    // 跑在沙箱 iframe 里的 HTML 入口页，落在单个文件或一个带入口的目录上。类型表只留
    // 一个 id，预览、内联、命名、导出走同一套判据；目录形态的判据在 detectKind。
    id: 'app',
    label: '应用',
    addressPatterns: ['dsh-resource://file/**/*.html', 'dsh-resource://file/**/index.html'],
    directory: false,
    exportFormats: ['zip', 'html', 'pdf', 'png'],
    publishable: true,
  },
  {
    id: 'markdown',
    label: '文本',
    addressPatterns: ['dsh-resource://file/**/*.md'],
    directory: false,
    exportFormats: ['html', 'pdf'],
    publishable: false,
  },
  {
    id: 'image',
    label: '图片',
    addressPatterns: ['dsh-resource://file/**/*.png', 'dsh-resource://file/**/*.jpg', 'dsh-resource://file/**/*.svg'],
    directory: false,
    exportFormats: ['png', 'svg'],
    publishable: false,
  },
  {
    // 设计节点（F2.6）：一个 `.design` 文件就是一份场景图快照（v2）的多容器设计文档。
    id: 'design',
    label: '设计',
    addressPatterns: ['dsh-resource://file/**/*.design'],
    directory: false,
    exportFormats: ['png'],
    publishable: false,
  },
  {
    id: 'video',
    label: '视频',
    addressPatterns: ['dsh-resource://file/**/*.mp4'],
    directory: false,
    exportFormats: [],
    publishable: false,
  },
  {
    // 音频节点（F2.7）：与图片、视频并列的第三种媒体产物。它在类型表里没有导出格式 ——
    // 「把一段音频变成另一种格式」不是这个插件的职责，导出那条线归部署。
    id: 'audio',
    label: '音频',
    addressPatterns: ['dsh-resource://file/**/*.mp3', 'dsh-resource://file/**/*.wav'],
    directory: false,
    exportFormats: [],
    publishable: false,
  },
  {
    id: 'data',
    label: '数据图表',
    addressPatterns: ['dsh-resource://file/**/*.csv', 'dsh-resource://file/**/*.json'],
    directory: false,
    exportFormats: ['html', 'png'],
    publishable: false,
  },
  {
    id: 'folder',
    label: '文件夹',
    addressPatterns: [],
    directory: true,
    exportFormats: [],
    publishable: false,
  },
  {
    id: 'file',
    label: '文件',
    addressPatterns: ['dsh-resource://file/**'],
    directory: false,
    exportFormats: [],
    publishable: false,
  },
]

/**
 * 归并前的 kind id → 归并后的 id（v1.56）。
 *
 * 老板上的记录还盖着旧章（`webapp` / `site` / `html-deck`），零迁移的代价是读侧
 * 顺手对齐：查表时先折算，标签、导出格式这些按 kind 查的东西对老卡照常成立。
 */
const LEGACY_KIND_IDS: Readonly<Record<string, string>> = { 'html-deck': 'app', site: 'app', webapp: 'app' }

/** Look up a kind definition by id; pre-merge ids resolve onto their merged kind. */
export function kindById(id: string, definitions: readonly KindDefinition[] = BUILTIN_KINDS): KindDefinition | undefined {
  return definitions.find((entry) => entry.id === (LEGACY_KIND_IDS[id] ?? id))
}

/**
 * 一个 kind id 折算成它今天的那个 id（v1.56/v1.59）。
 *
 * 老记录盖着旧章，而**读侧一律先折算**是那条零迁移的全部内容——所以凡是「按 kind 认一件事」
 * 的判据都得从这里过一遍。未知 id 原样返回（部署自己注册的形态照旧能被指认）。
 *
 * 它独立成一个函数，是因为下面那四个集合判据此前各自拿**裸 id** 去 `includes`：`kindById`
 * 折算、`isBundleKind` 不折算，同一个函数里于是有了两种「kind」（`export-plan.ts` 里正是
 * 这个形状）。老应用卡（`webapp`）会因此掉到部署那条导出线上——一条在没有导出能力的部署上
 * **点了什么都不发生**的路，而 v1.58 花了一整版才把它绕开。
 */
export function resolveKindId(id: string, definitions: readonly KindDefinition[] = BUILTIN_KINDS): string {
  return kindById(id, definitions)?.id ?? id
}

/** Human label for a kind id, falling back to the id itself. */
export function kindLabel(id: string, definitions: readonly KindDefinition[] = BUILTIN_KINDS): string {
  return kindById(id, definitions)?.label ?? id
}

/** Whether a kind can export to a format (F10.1). */
export function kindSupportsExport(
  id: string,
  format: ExportFormat,
  definitions: readonly KindDefinition[] = BUILTIN_KINDS,
): boolean {
  return kindById(id, definitions)?.exportFormats.includes(format) ?? false
}

/**
 * The kinds whose artifact is a whole HTML page (F3.8).
 *
 * There is exactly one such kind (`app`), but the set stays a set on purpose:
 * the host's inlining gate and the client's kind→viewer table both read it, and
 * they were two hand-written lists once — the one that forgot a kind is exactly
 * how an HTML artifact lost its stylesheet.
 *
 * A `srcdoc` document has no base URL, so a locally referenced `styles.css` or
 * `app.js` resolves against nothing and the page renders unstyled and dead.
 * The host inlines those references for every kind in this set.
 */
export const HTML_KINDS: readonly string[] = ['app']

/** Whether a kind's artifact is a whole HTML page (see {@link HTML_KINDS}). */
export function isHtmlKind(kind: string): boolean {
  return HTML_KINDS.includes(resolveKindId(kind))
}

/**
 * The kinds whose artifact **is its own text** (F3.12).
 *
 * A markdown file and a plain file are the two whose bytes are the whole of
 * what a preview shows, so writing the whole thing back is lossless. Every
 * other kind is looking at something *derived* from the file — a table parsed
 * out of a CSV, a page rendered from markup, pixels decoded from a PNG — and an
 * editor that wrote its own view back would replace the file with a different
 * file.
 *
 * It lives here, beside the kind table, because **two layers ask it and they
 * must not disagree**: the card's control strip, which decides whether to offer
 * 手动输入 *before* the modal is open (it has a kind, not a payload), and the
 * text viewers, which decide from the payload whether to offer an editor. The
 * frame is the same one {@link HTML_KINDS} sits in — a fact about kinds, read
 * by both halves, written once.
 *
 * @remarks `file` is the catch-all kind, so an extension nothing else claims
 * (`.txt`, `.js`, `.css`, and any kind a user's own definitions add later) is
 * directly editable. `folder` is not: a directory's payload is not text.
 */
export const DIRECT_TEXT_KINDS: readonly string[] = ['markdown', 'file']

/** Whether a kind's artifact is its own text (see {@link DIRECT_TEXT_KINDS}). */
export function isDirectTextKind(kind: string): boolean {
  return DIRECT_TEXT_KINDS.includes(resolveKindId(kind))
}

/**
 * 导出＝「把整份产物打包带走」的形态（F10.1）。
 *
 * 应用节点是唯一一个：它的产物要么是一个带入口页的文件夹，要么是一张单文件页面，而
 * 「交给别人」的方式都不是把它渲染成另一种格式，是**原样装进一个压缩包**。这条判据让
 * 客户端知道该走本地那条打包路（`client/canvas/bundle-export.ts`），而不是去问部署要
 * 一个导出能力——把文件装进 zip 是浏览器里做得了的事，不需要后端。
 *
 * 与 {@link HTML_KINDS} 落在同一个位置、读同一张类型表：这两条都是「关于形态的事实」，
 * 两侧（凭它选路的一侧、凭它内联的一侧）必须给出一致答案，所以都写在这里而不是各自的
 * 调用点上。
 */
export const BUNDLE_KINDS: readonly string[] = ['app']

/** Whether a kind exports by packing its artifact into an archive (see {@link BUNDLE_KINDS}). */
export function isBundleKind(kind: string): boolean {
  return BUNDLE_KINDS.includes(resolveKindId(kind))
}

/**
 * 导出＝「要把这份产物**画出来**」的形态（F10.1，v1.59）。
 *
 * 与 {@link BUNDLE_KINDS} 一样是一根指针而不是一张表，但指向的**不是**类型表里的
 * `exportFormats`——那一格是**部署能力那条线**的格式表（`canvas_export` 工具与
 * `kindSupportsExport` 读它，契约里是 `P.format` 这个 enum）。设计稿的四样出路部署一个
 * 都做不到：fig 要 Figma 的 kiwi schema，图片与 PPT 要 CanvasKit 的渲染器，PDF 要 DOM
 * （open-pencil 那条实现靠 `DOMParser` + `svg2pdf`）——而它们**全在浏览器**里。往那个
 * enum 里加一个 `fig` 只会让部署多收到一个它永远实现不了的格式（一条必然失败的请求），
 * 所以设计卡的本地格式表归客户端自己：`client/canvas/design-export.ts` 的
 * `DESIGN_EXPORT_FORMATS`。这与文本节点同一条道理——它的 md / txt / docx 也不在类型表里，
 * 而在 `TEXT_EXPORT_FORMATS` 里。
 *
 * 这里存在的理由只有一个：**「这个形态走哪条路」必须只判一次**。画布那张菜单（胶囊上的
 * 导出钮）与选路那处都要一个答案，两处各写一遍就是「同一个东西两个来源」。
 */
export const DESIGN_KINDS: readonly string[] = ['design']

/** Whether a kind exports by rendering its artifact in the browser (see {@link DESIGN_KINDS}). */
export function isDesignKind(kind: string): boolean {
  return DESIGN_KINDS.includes(resolveKindId(kind))
}

/**
 * 三种**媒体形态**：产物是画出来的（图片）、放出来的（视频）、听出来的（音频），
 * 而不是读出来的（文本）或跑起来的（应用）。
 *
 * 与上面几根指针同一个理由，但这一次被三方共读：客户端那张「谁画这个 kind」的预览表、
 * 卡片控制带上「这一格该不该长生成钮」的判断、以及卡片会话里那套**媒体生成预设**
 * （`host/prompt.ts`）。三处各写一遍 `kind === 'image' || kind === 'video' || …`，
 * 就正好是「加一种媒体形态时漏掉一处」的剧本——而漏掉的那一处不会报错，它只是**不出现**：
 * 音频节点点开是一个没有生成能力的会话，或者一段刚落地的视频在预览里被当文本读。
 *
 * 「产物是不是二进制」这条事实**不在这里**，它在 `artifact-io.ts` 的 `MEDIA_MIME` 表上——
 * 那张表按**扩展名**认，因为 view 要在还没分类出 kind 之前就知道该不该按字节读。两张表
 * 的判据不同（那边是字节通道，这边是形态语义），所以刻意没有互相读。
 */
export const MEDIA_KINDS: readonly string[] = ['image', 'video', 'audio']

/** Whether a kind's artifact is media — an image, a video, or audio (see {@link MEDIA_KINDS}). */
export function isMediaKind(kind: string): boolean {
  return MEDIA_KINDS.includes(resolveKindId(kind))
}

/**
 * True for a directory that behaves as an app: it carries an entry page or the
 * scaffold manifest. The manifest alone separates a scaffolded folder from a
 * hand-made one, but both preview and name identically, so one verdict serves.
 */
function isAppDirectory(probe: KindProbe): boolean {
  return (
    probe.children.some((name) => name.toLowerCase() === 'index.html') || probe.children.includes(WEBAPP_MANIFEST)
  )
}

/**
 * Resolve the kind of one artifact from its evidence (F2.2).
 *
 * Any HTML page — a deck, a site's entry, an app's entry, a plain page — is
 * `app`; only a directory without either entry point or manifest falls through
 * to `folder`. The last entry in {@link BUILTIN_KINDS} is the catch-all, so
 * this never returns `undefined` for a path that exists.
 */
export function detectKind(probe: KindProbe, definitions: readonly KindDefinition[] = BUILTIN_KINDS): string {
  if (probe.directory) return isAppDirectory(probe) ? 'app' : 'folder'

  const { extension } = probe

  if (extension === 'html' || extension === 'htm') return 'app'
  if (extension === 'md' || extension === 'mdx') return 'markdown'
  if (extension === 'design') return 'design'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(extension)) return 'image'
  if (['mp4', 'mov', 'webm', 'm4v'].includes(extension)) return 'video'
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma'].includes(extension)) return 'audio'
  if (['csv', 'tsv', 'json', 'xlsx'].includes(extension)) return 'data'

  // A definition outside the built-ins may claim exotic extensions.
  const byExtension = definitions.find((entry) =>
    entry.addressPatterns.some((pattern) => pattern.endsWith(`*.${extension}`)),
  )
  return byExtension?.id ?? 'file'
}

/**
 * Extract a structural outline from artifact text (F5.2).
 *
 * The outline is what makes a digest useful to the model — it names the parts
 * without pasting the whole artifact. Each kind has its own cheap structural
 * signal; an unknown kind yields nothing rather than guessing.
 */
export function outlineOf(kind: string, text: string, limit = 24): string[] {
  const take = (pattern: RegExp): string[] => {
    const found: string[] = []
    for (const match of text.matchAll(pattern)) {
      const captured = match[1]?.trim()
      if (captured !== undefined && captured !== '' && !found.includes(captured)) found.push(captured)
      if (found.length >= limit) break
    }
    return found
  }
  switch (kind) {
    case 'markdown':
      return take(/^\s{0,3}#{1,3}\s+(.+)$/gm)
    case 'app': {
      // 标题在前（页面叫什么），标题级标签在后（页面有什么章节）——幻灯片、站点、
      // 应用共用这一套，去重由 add 统一负责。
      const found: string[] = []
      const add = (raw: string): void => {
        const line = raw.replace(/<[^>]+>/g, '').trim()
        if (line !== '' && !found.includes(line)) found.push(line)
      }
      for (const match of text.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)) add(match[1] ?? '')
      for (const match of text.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)) add(match[1] ?? '')
      return found.slice(0, limit)
    }
    case 'data': {
      const [header = ''] = text.split(/\r?\n/)
      return header
        .split(',')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '')
        .slice(0, limit)
    }
    default:
      return []
  }
}

/**
 * Build the bounded digest injected into a card session (F5.2).
 *
 * Structure first, then a trimmed body: the budget is honoured on characters
 * because the digest is a prompt fragment, and the caller owns the budget
 * (`Config.summaryBudget`).
 */
export function digestOf(kind: string, text: string, budget: number): string {
  const outline = outlineOf(kind, text)
  const head = text.trim().slice(0, budget)
  const parts: string[] = []
  if (outline.length > 0) parts.push(`结构：${outline.join(' / ')}`)
  parts.push(head.length < text.trim().length ? `${head}\n…（已截断）` : head)
  return parts.join('\n')
}
