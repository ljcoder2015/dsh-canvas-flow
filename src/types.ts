/**
 * dsh-canvas — shared types for both halves of the plugin.
 *
 * These are the values that actually cross the wire or land in the storage
 * domain. The zod schemas that validate them live in `contract.ts` (wire) and
 * `domain.ts` (durable records); this module only names the shapes.
 */

/** Branded project identifier. */
export type ProjectId = string
/**
 * Card identity: an opaque board seat id, minted as six random letters when the
 * card is seated. It is *not* a path — the artifact's workspace-relative path
 * lives on the card record ({@link Card.file}) and may be anything, renamed
 * even, without touching the id. Records minted before this split keep a
 * path-shaped id and read their file as the id itself.
 */
export type CardId = string
/** Storage key of a card record — project-qualified so two projects may hold the same relative path. */
export type CardKey = string
/** Storage key of a source edge. */
export type SourceId = string
/** Storage key of a shared note. */
export type NoteId = string
/** Bound Agent session identity. */
export type SessionId = string

/** Where a card sits on the infinite canvas, in canvas coordinates. */
export interface Point {
  x: number
  y: number
}

/** Persisted view state of one canvas (F1.4). */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** Per-project style profile (F9.1) — injected into every card session prompt. */
export interface StyleProfile {
  /** Named colour tokens the project standardises on, e.g. `['#FF7A17', '#0A0A0A']`. */
  palette: string[]
  /** Preferred type family, e.g. `'Inter / Noto Sans SC'`. */
  font: string
  /** Tone-of-voice instruction, e.g. `'克制、结论先行'`. */
  tone: string
}

/** One canvas project: a name, a workspace root on disk, and its own view state. */
export interface Project {
  id: ProjectId
  name: string
  /** Absolute directory the project's cards are relative to. */
  root: string
  viewport: Viewport
  style: StyleProfile
  createdAt: number
}

/** One artifact card (F1.2) — a file on disk plus its board position and bound session. */
export interface Card {
  /** Board seat id — six random letters on cards minted after the id/path split. */
  id: CardId
  /** Path of the bound artifact, relative to the owning project's root. */
  file: string
  project: ProjectId
  /** Kind id resolved by the kind registry (F2.2). */
  kind: string
  position: Point
  /** Bound Agent session; empty until the session is created through the agent lifecycle. */
  sessionId: SessionId
  /**
   * The card's own name (F1.12), when the user gave it one that the path does
   * not already say. Absent means "call it whatever its artifact is called" —
   * see `core/canvas/card-name.ts`, which derives the display name from the
   * file and the kind.
   */
  name?: string
  /** 这张卡由哪个模型生成（F2.7）；空 = 交给配置里第一个对得上族的模型。 */
  mediaModel?: string
  /** 产物的真实宽高比（宽 ÷ 高，F3.11）；空 = 还不知道，媒体卡按默认 16:9 坐。 */
  aspect?: number
  /** Epoch millis of the last observed write, used for staleness hints. */
  updatedAt: number
}

/** The single directed edge type (F4.1): the downstream card sources from the upstream card. */
export interface Source {
  id: SourceId
  project: ProjectId
  /** The card whose artifact builds on the other. */
  downstream: CardId
  /** The card whose artifact is used as material. */
  upstream: CardId
  /** Manual connection, or produced by artifact reconciliation (F4.5). */
  origin: 'manual' | 'reconciled'
}

/** A shared board note (F9.3). */
export interface Note {
  id: NoteId
  project: ProjectId
  text: string
  author: string
  position: Point
  createdAt: number
}

/** Aggregate card state derived from its session and its file (F3.5). */
export type CardStatus = 'idle' | 'running' | 'notified'

/**
 * One card as the board renders it.
 *
 * Deliberately carries no session *state*: whether the bound session is idle,
 * running or holding a notification is read live from the session itself by
 * the browser half (§4.8 — subscribe, do not poll or mirror). The board
 * snapshot is seating and binding only.
 */
export interface BoardCard {
  id: CardId
  /** Path of the bound artifact, relative to the project root — never the id itself on new cards. */
  file: string
  /**
   * What the card is called on the board (F1.12) — the user's name for it, or,
   * when they never gave it one, the name derived from its artifact: the folder
   * for a directory-backed kind, the file without its extension otherwise.
   * Always populated: the board never has to know which of the two it is.
   */
  name: string
  project: ProjectId
  kind: string
  /** Human label of the kind, for the card's caption. */
  kindLabel: string
  position: Point
  sessionId: SessionId
  /**
   * Whether the artifact is **provably gone** (F3.5 / F1.11): the probe
   * resolved the path and the seam reported no such file, and the seat was not
   * one that was born without an artifact.
   *
   * Deliberately not "the file is not readable right now". A seat whose
   * artifact has never been written — a card seeded a moment ago, a bitmap
   * waiting for a generation run — and a card the seam simply could not judge
   * are both *not* missing, so the card is drawn as an ordinary card rather
   * than accused of something nobody knows.
   */
  missing: boolean
  /**
   * 这张卡由哪个模型生成（F2.7）。空 = 没单独选过，交给配置里第一个对得上族的模型。
   *
   * 只有媒体卡会用到它；它**不是**会话模型——那张卡用哪个模型说话是会话自己的事
   * （`sessionId` 那条通路上）。两者刻意不共用一个字段：共用了就会出现「给视频卡选了
   * 生成模型，会话也跟着换，下一次请求 400」那件事。
   */
  mediaModel?: string
  /**
   * 产物的真实宽高比（宽 ÷ 高，F3.11）。有它，这张卡就按产物的比例坐——一张 1:1 的图
   * 不该塞进 16:9 的框里左右留白，一段 9:16 的竖视频也不该被压成横的。
   *
   * 空 = 还不知道（还没生成、或还没在浏览器里加载过），按默认 16:9 坐。
   */
  aspect?: number
}

/** One source edge as the board renders it. */
export interface BoardSource {
  id: SourceId
  downstream: CardId
  upstream: CardId
  origin: Source['origin']
}

/** Everything the client needs to paint one board (F1.3). */
export interface BoardSnapshot {
  project: Project
  cards: readonly BoardCard[]
  sources: readonly BoardSource[]
  notes: readonly Note[]
}

/** Content summary of one artifact, used both for injection and for card previews (F5.2). */
export interface CardSummary {
  /** The seat id of the card the artifact belongs to. */
  cardId: CardId
  kind: string
  /** Absolute path on disk. */
  path: string
  /** Bounded prose/plain-text digest of the artifact. */
  summary: string
  /** Structural outline — headings, slide titles, top-level keys. */
  outline: string[]
  /** Raw head of the artifact text for the board preview; markdown only, '' for every other kind. */
  head: string
  /** Byte size, or 0 when unknown. */
  bytes: number
  updatedAt: number
}

/**
 * Everything one artifact's fullscreen view needs (F3.8).
 *
 * Exactly one of `text` / `dataUrl` carries content, decided by the artifact's
 * kind on the host: text kinds read whole (capped), binary media become a data
 * URL the browser can hand to `<img>` / `<video>` directly — the plugin wire
 * has no streaming and no resource URLs, so the payload rides in the response.
 */
export interface ArtifactView {
  cardId: CardId
  /** Path of the artifact the view was read from, relative to the project root. */
  file: string
  /** What the card is called (F1.12); `''` at the IO layer, stamped by the card runtime. */
  name: string
  /** Kind id as the artifact classifier resolved it at read time. */
  kind: string
  /** Whether the bound file exists on disk. */
  present: boolean
  /** Full decoded text for text-shaped kinds; `''` otherwise. */
  text: string
  /** `data:<mime>;base64,…` for binary media; `''` otherwise. */
  dataUrl: string
  /** True when content was cut at the wire cap rather than read whole. */
  truncated: boolean
  /** Byte size, or 0 when unknown. */
  bytes: number
  updatedAt: number
}

/** One entry of the resolved source chain (F4.7). */
export interface SourceChain {
  cardId: CardId
  /** Cards this card directly sources from. */
  direct: string[]
  /** Transitive upstreams, ordered nearest first, excluding `direct`. */
  indirect: string[]
  /** Cards that source from this card. */
  downstream: string[]
}

/**
 * One upstream artifact named to a card's conversation as a **file reference**
 * (F5.3).
 *
 * The canvas does not copy upstream content into the conversation: it names the
 * upstream artifact with the harness's own `@file` mention grammar, and the
 * model reads it with its ordinary `read` tool when it decides the material
 * matters. That is the whole point of a reference — the material stays the one
 * file it already is, so it cannot go stale, and it costs no context until
 * somebody asks for it.
 */
export interface ReferencedFile {
  /** The upstream card, as this board names it. */
  cardId: CardId
  /** Workspace-relative path of the artifact — the card's `file`, not its id. */
  path: string
  /** The prompt token the model resolves: `@brief.md` or `@"my brief.md"`. */
  mention: string
  kind: string
  kindLabel: string
  /** Whether the artifact exists on disk yet (a seated card may have no file). */
  present: boolean
  /** Byte size when it exists — the model's only cue about reading cost. */
  bytes: number
}

/** What one {@link CardRuntime.referenceFiles} call handed over (F5.3). */
export interface ReferencedFiles {
  cardId: CardId
  /** Files actually named, nearest upstream first. */
  files: ReferencedFile[]
  /**
   * Upstreams left out because their path cannot be written in the `@file`
   * grammar (a control character or a quote in the name). Never silent.
   */
  skipped: string[]
}

/** Result of an artifact write (F8.1). */
export interface WriteResult {
  cardId: CardId
  /** Whether the write created the artifact or replaced an existing one. */
  operation: 'create' | 'update'
  /** Freshness token to echo back on the next guarded write. */
  version: string
  /** Content before the write; `null` when the artifact did not exist. */
  before: string | null
}

/**
 * Outcome of one media generation run (F2.7).
 *
 * 与 {@link WriteResult} 一样是「一份答案而不是一个异常」：宿主里的一句失败
 * （`ok: false` + `reason`）必须原样走到画布上，因为画布的执行壳只接异常——把失败抛出去
 * 的结果是**按钮点了什么都不发生**，而不是一句可读的话。
 */
export interface GenerationResult {
  cardId: CardId
  ok: boolean
  /** Absolute path of the artifact that was written; `''` on failure. */
  path: string
  /** Why it did not happen, in the user's language; `''` on success. */
  reason: string
}

/**
 * One file of an application artifact, as the browser packs it into an archive
 * (F10.1).
 *
 * `text` and `base64` are mutually exclusive, and the split is a cost decision
 * rather than a type: a folder of HTML, CSS and JS is what an app artifact
 * almost always is, and carrying its text as *text* keeps the wire (and the
 * archive) from paying a 33% base64 tax on the common case. Anything the seam
 * will not decode — an image, a font, whatever the app ships — travels as its
 * own bytes.
 */
export interface BundleFile {
  /** Path inside the artifact folder, `/`-joined, never absolute. */
  path: string
  /** Decoded content of a text file; `''` for every other file. */
  text: string
  /** Base64 of the raw bytes for a non-text file; `''` for text. */
  base64: string
  bytes: number
}

/**
 * Everything the browser needs to pack one application artifact into a `.zip`
 * (F10.1).
 *
 * The reading half lives on the host (`ArtifactIo.readBundle`), because only
 * the host can walk the folder, and the packing half lives in the browser,
 * because that is where a download happens — the same division of labour the
 * text export already uses.
 *
 * `skipped` and `truncated` exist because an incomplete archive must be
 * refusable *knowably*: the client reads `truncated` and declines to export
 * rather than handing over a zip that silently lost a file.
 */
export interface BundleView {
  cardId: CardId
  /** Artifact path relative to the project root. */
  file: string
  /** What the card is called (F1.12) — the folder the archive unpacks into. */
  name: string
  kind: string
  /** Whether the artifact exists on disk. */
  present: boolean
  /** Whether the artifact is a folder rather than a single page. */
  directory: boolean
  /** Every file that travels, in archive order. */
  files: BundleFile[]
  /** Paths left out because they did not fit the budget. Never silent. */
  skipped: string[]
  /** Uncompressed size of everything in `files`. */
  bytes: number
  /** True when something did not fit, so the archive would be incomplete. */
  truncated: boolean
}

/** One queued region-of-interest intent, fed to the card's next turn (F8.2/F8.4). */
export interface PendingIntent {
  id: string
  cardId: CardId
  kind: 'text-edit' | 'region-comment' | 'element-style' | 'reorder'
  /** The structured intent payload, JSON-shaped by convention. */
  payload: string
  /** Data-URL of the circled screenshot, when the intent carries one. */
  image: string
  createdAt: number
}

/** Outcome of opening (or re-attaching) a card's Agent session (F3.1). */
export interface SessionBinding {
  cardId: CardId
  sessionId: SessionId
  /** Whether this call created the conversation, or reused a live one. */
  created: boolean
}

/**
 * The user's own most recent message to a card's session, verbatim (F3.9).
 *
 * This is what an untouched composer shows, and it is deliberately *not* the
 * session's latest message: plugin-pushed context rides the same log and must
 * never be offered back to the user as their own words.
 */
export interface LastPrompt {
  /** The message text, line breaks and all — the box hands it back for editing. */
  text: string
  /** Epoch ms of the message's event, or `0` when the log does not carry one. */
  time: number
}

/** How `canvas_arrange_on_board` lays the board out (F4.6). */
export type ArrangeStrategy = 'source-chain' | 'grid' | 'organize'

/** Export formats a kind may offer (F10.1). */
export type ExportFormat = 'html' | 'pdf' | 'pptx' | 'png' | 'svg' | 'zip'

/** Session response policy when an upstream artifact changes (F5.7). */
export type UpstreamPolicy = 'silent' | 'notify' | 'pull'

/** Host configuration, validated and defaulted by `Config` in `index.ts`. */
export interface ResolvedConfig {
  /** Directory scanned for candidate workspace folders when the picker opens. */
  pickerRoot: string
  /** Horizontal gap between layered cards when arranging by source chain, in canvas px. */
  arrangeGap: number
  /** Cap on the characters of one upstream artifact digest injected into a card session (F5.2). */
  summaryBudget: number
  /** Depth of the transitive source chain resolved by `canvas_get_sources`. */
  sourceDepth: number
  /** Default response policy when an upstream artifact changes (F5.7). */
  upstreamPolicy: UpstreamPolicy
}

/** Result of binding a directory to a project (F1.1, design screen 02). */
export interface ProjectBinding {
  project: Project
  /** How many artifacts the initial scan discovered under the root. */
  discovered: number
}

/** Structured outcome of an export or publish attempt (F10.1/F10.3). */
export interface ExportResult {
  cardId: CardId
  /** Requested format, or the publishing backend's name for a publish. */
  format: string
  ok: boolean
  /** Path (or URL) of the produced artifact when `ok`. */
  path: string
  /** Machine-readable reason when not `ok`; `''` on success. */
  reason: string
}

/** Result of publishing one artifact (F10.3). */
export interface PublishResult {
  /** Public URL the artifact became reachable at. */
  url: string
  /** Name of the backend that served the publish, for the card's status line. */
  provider: string
}

/** One row of the folder picker listing (design screen 02). */
export interface FolderEntry {
  name: string
  /** Project-relative path of the entry. */
  path: string
  /** Whether the entry is a directory the picker can descend into or select. */
  selectable: boolean
  /** Direct child count for directories, byte size for files. */
  size: number
}

/** One entry of the kind registry (F2.1/F2.4). */
export interface KindDefinition {
  /** Stable kind id, e.g. `app`. */
  id: string
  /** Human label shown on the card caption. */
  label: string
  /** Address globs the client tab claims for this kind (§4.7). */
  addressPatterns: readonly string[]
  /** Whether the artifact is a directory with an `index.html` entry, not a single file. */
  directory: boolean
  /** Formats this kind can export to (F10.1). */
  exportFormats: readonly ExportFormat[]
  /** Whether the artifact can be published (F10.3). */
  publishable: boolean
}
