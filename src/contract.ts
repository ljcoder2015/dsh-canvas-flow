/**
 * dsh-canvas — the strict Typert wire contract, shared by both halves.
 *
 * This module is the single source of truth: the host manifest (`typert.ts`)
 * and the browser contribution (`client/remote.ts`) both point at
 * {@link DSH_CANVAS_INVOCATIONS}, so the two halves cannot drift apart. Every
 * Remote method has exactly one descriptor here, and every canonical board or
 * artifact value that crosses the wire is validated by a codec declared here.
 */
import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Package identity on the wire:
 * every Typert descriptor id is `<package>#<service>/<method>`, and the manifest
 * attributes the contribution to this exact npm package name. It is the one
 * string that must equal `package.json` `name` — the human-facing label
 * (`host/prompt.ts` `PLUGIN_ID`) is deliberately a different, stable word.
 */
export const PACKAGE_NAME = 'dsh-canvas-flow'

/**
 * Model-facing tool names, declared once.
 *
 * The charset is not ours to choose: every name travels to the model provider
 * as `tools[].name`, and the wire pattern is `^[a-zA-Z0-9_-]+$` — a dotted
 * `canvas.read_card` is refused with a 400 before the model ever sees it
 * (verified against the live endpoint, 2026-09-17). So the namespace separator
 * is an underscore here, not the doc's dot; the harness itself does not
 * constrain or rewrite the name.
 *
 * They are kept in one table rather than inline at each registration so the
 * tool registry, the client's `tool.call.toolview` slots and the doc's tool
 * table stay one edit apart.
 */
export const TOOL_NAMES = {
  readCard: 'canvas_read_card',
  readSources: 'canvas_read_sources',
  referenceFiles: 'canvas_reference_files',
  linkSource: 'canvas_link_source',
  getSources: 'canvas_get_sources',
  injectCard: 'canvas_inject_card',
  readBoard: 'canvas_read_board',
  arrangeOnBoard: 'canvas_arrange_on_board',
  createOnBoard: 'canvas_create_on_board',
  organizeBoard: 'canvas_organize_board',
  linkSourceOnBoard: 'canvas_link_source_on_board',
  generateImage: 'canvas_generate_image',
  generateVideo: 'canvas_generate_video',
  generateAudio: 'canvas_generate_audio',
  designRead: 'canvas_design_read',
  designEdit: 'canvas_design_edit',
  export: 'canvas_export',
  publish: 'canvas_publish',
} as const

/** Every model-facing tool name this plugin registers. */
export const TOOL_NAME_LIST: readonly string[] = Object.values(TOOL_NAMES)

/**
 * The charset a tool name must satisfy to survive the provider's request
 * validation. Kept next to the table it constrains so a future rename that
 * reintroduces a `.` fails a test instead of a live request.
 */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

/** Identifiers that address one canvas project. */
export const projectIdSchema = z.string().trim().min(1).max(120)
/**
 * Card identity: an opaque seat id (six random letters on new cards; legacy
 * records keep a path-shaped id). The artifact's path is the card's `file`,
 * never assumed to be the id.
 */
export const cardIdSchema = z.string().trim().min(1).max(400)
/** Path of a card's artifact, relative to the project root. */
export const cardFileSchema = z.string().trim().min(1).max(400)
/** Storage identity of one source edge. */
export const sourceIdSchema = z.string().trim().min(1).max(500)
/** Storage identity of one shared note. */
export const noteIdSchema = z.string().trim().min(1).max(200)
/** Absolute directory of a project root, or a directory inside it.
 *
 * An empty string is the picker's "host decides" marker: both the folder
 * listing and the project binding resolve it to the configured picker root.
 */
export const directoryPathSchema = z.string().trim().max(1024)

/** One canvas coordinate pair. */
export const pointSchema = z.object({ x: z.number(), y: z.number() }).readonly()
/** Persisted canvas view state. */
export const viewportSchema = z
  .object({ x: z.number(), y: z.number(), zoom: z.number().positive() })
  .readonly()
/** The project style profile injected into card sessions. */
export const styleProfileSchema = z
  .object({ palette: z.array(z.string()), font: z.string(), tone: z.string() })
  .readonly()
/** One canvas project. */
export const projectSchema = z
  .object({
    id: projectIdSchema,
    name: z.string(),
    root: z.string(),
    viewport: viewportSchema,
    style: styleProfileSchema,
    createdAt: z.number(),
  })
  .readonly()
/** One card as the board renders it. Seating and binding only — session state is read live. */
export const boardCardSchema = z
  .object({
    id: cardIdSchema,
    /** Artifact path relative to the project root — the card's file, not its id. */
    file: cardFileSchema,
    /** What the card is called (F1.12): the user's name, or its artifact's own. */
    name: z.string().max(120),
    project: projectIdSchema,
    kind: z.string(),
    kindLabel: z.string(),
    position: pointSchema,
    sessionId: z.string(),
    missing: z.boolean(),
    /**
     * 这张卡**由哪个模型生成**（F2.7），空 = 交给配置里第一个对得上族的模型。
     *
     * 可选，且与 `seatedEmpty` 同一条纪律：老记录读出来是 `undefined`，意思就是
     * 「没单独选过」——正是它们此前的行为，所以一张卡都不用迁。
     */
    mediaModel: z.string().max(200).optional(),
    /**
     * 产物的真实宽高比（宽 ÷ 高，F3.11），空 = 还不知道、按默认 16:9 坐。
     *
     * 与 `mediaModel` 同一条纪律：可选，老记录读出来是 `undefined`，意思就是「还没量过」。
     */
    aspect: z.number().positive().max(100).optional(),
  })
  .readonly()
/** One source edge as the board renders it. */
export const boardSourceSchema = z
  .object({
    id: sourceIdSchema,
    downstream: cardIdSchema,
    upstream: cardIdSchema,
    origin: z.enum(['manual', 'reconciled']),
  })
  .readonly()
/** One shared board note. */
export const noteSchema = z
  .object({
    id: noteIdSchema,
    project: projectIdSchema,
    text: z.string(),
    author: z.string(),
    position: pointSchema,
    createdAt: z.number(),
  })
  .readonly()
/** Everything needed to paint one board. */
export const boardSnapshotSchema = z
  .object({
    project: projectSchema,
    cards: z.array(boardCardSchema),
    sources: z.array(boardSourceSchema),
    notes: z.array(noteSchema),
  })
  .readonly()
/** Bounded digest of one artifact. */
export const cardSummarySchema = z
  .object({
    cardId: cardIdSchema,
    kind: z.string(),
    path: z.string(),
    summary: z.string(),
    outline: z.array(z.string()),
    head: z.string(),
    bytes: z.number(),
    updatedAt: z.number(),
  })
  .readonly()
/** One artifact's fullscreen view payload (F3.8). */
export const artifactViewSchema = z
  .object({
    cardId: cardIdSchema,
    /** Artifact path the view was read from, relative to the project root. */
    file: cardFileSchema,
    /** What the card is called (F1.12); `''` when the reader did not know the card. */
    name: z.string().max(120),
    kind: z.string(),
    present: z.boolean(),
    text: z.string().max(2_000_000),
    dataUrl: z.string().max(40_000_000),
    truncated: z.boolean(),
    bytes: z.number(),
    updatedAt: z.number(),
  })
  .readonly()
/** One file of an application artifact's archive (F10.1). */
export const bundleFileSchema = z
  .object({
    /** Path inside the artifact folder, `/`-joined. */
    path: z.string().max(400),
    /** Decoded content of a text file; `''` for anything else. */
    text: z.string().max(4_000_000),
    /** Base64 of a non-text file's bytes; `''` for text. */
    base64: z.string().max(6_000_000),
    bytes: z.number(),
  })
  .readonly()
/** One application artifact's files, as the browser packs them (F10.1). */
export const bundleViewSchema = z
  .object({
    cardId: cardIdSchema,
    file: cardFileSchema,
    /** The card's name — the folder the archive unpacks into. */
    name: z.string().max(120),
    kind: z.string(),
    present: z.boolean(),
    /** Whether the artifact is a folder rather than a single page. */
    directory: z.boolean(),
    files: z.array(bundleFileSchema).max(400),
    /** Paths the budget left out. Never silent. */
    skipped: z.array(z.string().max(400)),
    bytes: z.number(),
    truncated: z.boolean(),
  })
  .readonly()
/** Resolved upstream/downstream neighborhood of one card (F4.7). */
export const sourceChainSchema = z
  .object({
    cardId: cardIdSchema,
    direct: z.array(cardIdSchema),
    indirect: z.array(cardIdSchema),
    downstream: z.array(cardIdSchema),
  })
  .readonly()
/** One upstream artifact named to a conversation as a file reference (F5.3). */
export const referencedFileSchema = z
  .object({
    cardId: cardIdSchema,
    path: z.string(),
    mention: z.string(),
    kind: z.string(),
    kindLabel: z.string(),
    present: z.boolean(),
    bytes: z.number(),
  })
  .readonly()
/** Outcome of one file-reference injection (F5.3). */
export const referencedFilesSchema = z
  .object({
    cardId: cardIdSchema,
    files: z.array(referencedFileSchema),
    /** Upstreams whose path the `@file` grammar cannot denote. */
    skipped: z.array(cardIdSchema),
  })
  .readonly()
/** One entry of the folder picker listing (design screen 02). */
export const folderEntrySchema = z
  .object({
    name: z.string(),
    path: z.string(),
    /** Whether the entry is a directory the picker can descend into or select. */
    selectable: z.boolean(),
    /** Direct child count for directories, byte size for files. */
    size: z.number(),
  })
  .readonly()
/** Result of binding a project to a directory (design screen 02 → 03). */
export const projectBindingSchema = z
  .object({ project: projectSchema, discovered: z.number() })
  .readonly()
/** Result of an artifact write (F8.1). */
export const writeResultSchema = z
  .object({
    cardId: cardIdSchema,
    operation: z.enum(['create', 'update']),
    /** Opaque freshness token, echoed back on the next guarded write. */
    version: z.string(),
    /** Content before the write; `null` when the file did not exist. */
    before: z.string().nullable(),
  })
  .readonly()
/** One node of a design document, in its model-facing JSON shape (F2.6, v2 — scene-graph). */
export const designNodeSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    parentId: z.string(),
    name: z.string(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    rotation: z.number(),
    opacity: z.number(),
    cornerRadius: z.number(),
    visible: z.boolean(),
    /** First visible solid fill as CSS (`#rrggbb` / `#rrggbbaa`); `''` = unpainted. */
    fill: z.string(),
    stroke: z.string(),
    strokeWidth: z.number(),
    text: z.string(),
    fontSize: z.number(),
    fontFamily: z.string(),
    align: z.enum(['left', 'center', 'right', 'justified']),
  })
  .readonly()
/** A design document as the session tools hand it over (F2.6, v2 — scene-graph snapshot). */
export const designDocumentSchema = z
  .object({
    cardId: cardIdSchema,
    formatVersion: z.number(),
    containers: z.array(z.string()),
    nodes: z.array(designNodeSchema),
  })
  .readonly()
/** One structured design edit op (F2.6) — see `core/artifact/design/ops.ts`. */
export const designOpSchema = z
  .object({
    kind: z.enum(['upsert', 'setProps', 'move', 'delete', 'reorder']),
    id: z.string().max(200).optional(),
    type: z.string().max(40).optional(),
    parentId: z.string().max(400).optional(),
    name: z.string().max(400).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    rotation: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    cornerRadius: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    fill: z.string().max(9).optional(),
    stroke: z.string().max(9).optional(),
    strokeWidth: z.number().optional(),
    text: z.string().max(20_000).optional(),
    fontSize: z.number().optional(),
    fontFamily: z.string().max(200).optional(),
    align: z.enum(['left', 'center', 'right', 'justified']).optional(),
    visible: z.boolean().optional(),
    index: z.number().int().optional(),
  })
  .readonly()

/** Outcome of one `canvas_design_edit` batch (F2.6). */
export const designEditResultSchema = z
  .object({
    cardId: cardIdSchema,
    applied: z.number(),
    errors: z.array(z.string()),
    version: z.string(),
  })
  .readonly()

/** The design document as it crosses the wire (F2.6). */
export type DesignDocumentWire = z.infer<typeof designDocumentSchema>
/** The design edit result as it crosses the wire (F2.6). */
export type DesignEditResultWire = z.infer<typeof designEditResultSchema>
/** Structured outcome of an export attempt (F10.1). */
export const exportResultSchema = z
  .object({
    cardId: cardIdSchema,
    format: z.string(),
    ok: z.boolean(),
    /** Path of the produced artifact when `ok`. */
    path: z.string(),
    /** Machine-readable reason when not `ok`. */
    reason: z.string(),
  })
  .readonly()
/** One queued region-of-interest intent, fed to the card's next turn (F8.2/F8.4). */
export const pendingIntentSchema = z
  .object({
    id: z.string(),
    cardId: cardIdSchema,
    kind: z.enum(['text-edit', 'region-comment', 'element-style', 'reorder']),
    /** The structured intent payload, JSON-shaped by convention. */
    payload: z.string(),
    /** Data-URL of the circled screenshot, when the intent carries one. */
    image: z.string(),
    createdAt: z.number(),
  })
  .readonly()
/** Outcome of opening (or re-attaching) a card's Agent session (F3.1). */
export const sessionBindingSchema = z
  .object({ cardId: cardIdSchema, sessionId: z.string(), created: z.boolean() })
  .readonly()
/** The user's own latest message to a card's session, verbatim (F3.9). */
export const lastPromptSchema = z
  .object({ text: z.string().max(2_000_000), time: z.number() })
  .readonly()

/** Constrain an artifact digest to a canonical, wire-safe object. */
const json = (name: string, wire: string, typeSymbol: string, schema: z.ZodType) => ({
  name,
  wire,
  source: 'json' as const,
  // A strict codec materializes its realm schema lazily: `create()` is called on
  // first boundary use, so the same descriptor object can cross a process or
  // worker boundary without carrying a non-serializable schema with it.
  codec: { mode: 'strict' as const, typeSymbol, create: () => schema },
})
const resultOf = (typeSymbol: string, schema: z.ZodType) => ({
  mode: 'strict' as const,
  typeSymbol,
  create: () => schema,
})

const P = {
  projectId: json('projectId', 'projectId', 'dsh-canvas-flow#ProjectId', projectIdSchema),
  cardId: json('cardId', 'cardId', 'dsh-canvas-flow#CardId', cardIdSchema),
  upstream: json('upstream', 'upstream', 'dsh-canvas-flow#CardId', cardIdSchema),
  downstream: json('downstream', 'downstream', 'dsh-canvas-flow#CardId', cardIdSchema),
  sourceCardId: json('sourceCardId', 'sourceCardId', 'dsh-canvas-flow#CardId', cardIdSchema),
  sourceId: json('sourceId', 'sourceId', 'dsh-canvas-flow#SourceId', sourceIdSchema),
  noteId: json('noteId', 'noteId', 'dsh-canvas-flow#NoteId', noteIdSchema),
  path: json('path', 'path', 'dsh-canvas-flow#DirectoryPath', directoryPathSchema),
  name: json('name', 'name', 'dsh-canvas-flow#ProjectName', z.string().trim().max(120)),
  content: json('content', 'content', 'dsh-canvas-flow#FileContent', z.string().max(2_000_000)),
  text: json('text', 'text', 'dsh-canvas-flow#NoteText', z.string().trim().min(1).max(2_000)),
  mode: json('mode', 'mode', 'dsh-canvas-flow#InjectionMode', z.enum(['summary', 'full'])),
  format: json('format', 'format', 'dsh-canvas-flow#ExportFormat', z.enum(['html', 'pdf', 'pptx', 'png', 'svg', 'zip'])),
  strategy: json('strategy', 'strategy', 'dsh-canvas-flow#ArrangeStrategy', z.enum(['source-chain', 'grid', 'organize'])),
  position: json('position', 'position', 'dsh-canvas-flow#Point', pointSchema),
  viewport: json('viewport', 'viewport', 'dsh-canvas-flow#Viewport', viewportSchema),
  kind: json('kind', 'kind', 'dsh-canvas-flow#KindId', z.string().trim().min(1).max(80)),
  intentKind: json(
    'kind',
    'kind',
    'dsh-canvas-flow#PendingIntentKind',
    z.enum(['text-edit', 'region-comment', 'element-style', 'reorder']),
  ),
  intentPayload: json('payload', 'payload', 'dsh-canvas-flow#IntentPayload', z.string().max(200_000)),
  intentImage: json('image', 'image', 'dsh-canvas-flow#IntentImage', z.string().max(4_000_000)),
  prompt: json('prompt', 'prompt', 'dsh-canvas-flow#PromptText', z.string().trim().min(1).max(32_000)),
  file: json('file', 'file', 'dsh-canvas-flow#CardFile', cardFileSchema),
  cardName: json('name', 'name', 'dsh-canvas-flow#CardName', z.string().max(120)),
  /**
   * 卡片选定的生成模型 id（F2.7）。空串是**合法入参**，意思是「回到自动挑」——
   * 所以这里不能加 `.min(1)`：那会让「取消选择」变成一次协议层报错。
   */
  mediaModel: json('model', 'model', 'dsh-canvas-flow#MediaModel', z.string().max(200)),
  /**
   * 产物的真实宽高比（宽 ÷ 高）。上限 100 / 必须为正：这不是给用户填的字段，是浏览器
   * 量出来后回写的，界外值只可能是算错了——在协议层拒绝，比让它把卡片撑成一条线好。
   */
  aspect: json('aspect', 'aspect', 'dsh-canvas-flow#MediaAspect', z.number().positive().max(100)),
  /**
   * 导入的文件名（含扩展名）。路径只取 basename、扩展名必须是媒体——两条判据都在
   * `core/canvas/import-plan.ts` 里，这里只卡长度（一段文件名长过 200 字符不是文件名）。
   */
  importName: json('name', 'name', 'dsh-canvas-flow#ImportName', z.string().trim().min(1).max(200)),
  /**
   * 导入文件的字节，base64 编码。
   *
   * 上限按「搬运上限的编码长度」给：16MB × 4/3 ≈ 21.3MB，多留一点余量。协议层先拦一道，
   * 是为了不让一段离谱的字符串走进宿主再被拒——那一段已经被分配出来了。
   */
  fileData: json('content', 'content', 'dsh-canvas-flow#ImportBytes', z.string().max(21_400_000)),
  version: json('version', 'version', 'dsh-canvas-flow#FsVersion', z.string().min(1).max(200)),
  designOps: json('ops', 'ops', 'dsh-canvas-flow#DesignOps', z.array(designOpSchema).min(1).max(200)),
  style: json('style', 'style', 'dsh-canvas-flow#StyleProfile', styleProfileSchema),
}

const R = {
  board: resultOf('dsh-canvas-flow#BoardSnapshot', boardSnapshotSchema),
  project: resultOf('dsh-canvas-flow#Project', projectSchema),
  projectList: resultOf('dsh-canvas-flow#ProjectList', z.array(projectSchema)),
  binding: resultOf('dsh-canvas-flow#ProjectBinding', projectBindingSchema),
  folders: resultOf('dsh-canvas-flow#FolderEntryList', z.array(folderEntrySchema)),
  card: resultOf('dsh-canvas-flow#BoardCard', boardCardSchema),
  cardList: resultOf('dsh-canvas-flow#BoardCardList', z.array(boardCardSchema)),
  source: resultOf('dsh-canvas-flow#BoardSource', boardSourceSchema),
  sourceList: resultOf('dsh-canvas-flow#BoardSourceList', z.array(boardSourceSchema)),
  chain: resultOf('dsh-canvas-flow#SourceChain', sourceChainSchema),
  referencedFiles: resultOf('dsh-canvas-flow#ReferencedFiles', referencedFilesSchema),
  note: resultOf('dsh-canvas-flow#Note', noteSchema),
  style: resultOf('dsh-canvas-flow#StyleProfile', styleProfileSchema),
  summary: resultOf('dsh-canvas-flow#CardSummary', cardSummarySchema),
  summaryList: resultOf('dsh-canvas-flow#CardSummaryList', z.array(cardSummarySchema)),
  artifact: resultOf('dsh-canvas-flow#ArtifactView', artifactViewSchema),
  bundle: resultOf('dsh-canvas-flow#BundleView', bundleViewSchema),
  write: resultOf('dsh-canvas-flow#WriteResult', writeResultSchema),
  designDocument: resultOf('dsh-canvas-flow#DesignDocument', designDocumentSchema),
  designEdit: resultOf('dsh-canvas-flow#DesignEditResult', designEditResultSchema),
  export: resultOf('dsh-canvas-flow#ExportResult', exportResultSchema),
  session: resultOf('dsh-canvas-flow#SessionBinding', sessionBindingSchema),
  lastPrompt: resultOf('dsh-canvas-flow#LastPrompt', lastPromptSchema),
  pending: resultOf('dsh-canvas-flow#PendingIntentList', z.array(pendingIntentSchema)),
  boolean: resultOf('dsh-canvas-flow#Boolean', z.boolean()),
  count: resultOf('dsh-canvas-flow#Count', z.number()),
  text: resultOf('dsh-canvas-flow#Text', z.string()),
}

const signal = { parameter: 'signal' as const }

/**
 * Every Remote method of the plugin, one descriptor each.
 *
 * `canvas` carries board-level work — projects, seating, source edges, notes.
 * `card` carries artifact-level work — digests, injection, writes, exports.
 * Card-scoped behavior that needs to know *which* card is speaking is resolved
 * from the calling Agent in `tools.ts`, not from a Remote context parameter:
 * the browser half always passes the project and card it is acting on.
 */
export const DSH_CANVAS_INVOCATIONS: readonly InvocationDescriptor[] = [
  // ── canvas: projects ────────────────────────────────────────────────────
  {
    id: 'dsh-canvas-flow#canvas/list_projects', service: 'canvas', namespace: 'canvas', method: 'listProjects',
    invocation: { kind: 'direct' }, parameters: [], cancellation: signal, result: R.projectList,
  },
  {
    id: 'dsh-canvas-flow#canvas/create_project', service: 'canvas', namespace: 'canvas', method: 'createProject',
    invocation: { kind: 'direct' }, parameters: [P.name, P.path], cancellation: signal, result: R.binding,
  },
  {
    id: 'dsh-canvas-flow#canvas/remove_project', service: 'canvas', namespace: 'canvas', method: 'removeProject',
    invocation: { kind: 'direct' }, parameters: [P.projectId], cancellation: signal, result: R.boolean,
  },
  {
    id: 'dsh-canvas-flow#canvas/list_folders', service: 'canvas', namespace: 'canvas', method: 'listFolders',
    invocation: { kind: 'direct' }, parameters: [P.path], cancellation: signal, result: R.folders,
  },

  // ── canvas: board ───────────────────────────────────────────────────────
  {
    id: 'dsh-canvas-flow#canvas/set_active_project', service: 'canvas', namespace: 'canvas', method: 'setActiveProject',
    invocation: { kind: 'direct' }, parameters: [P.projectId], cancellation: signal, result: R.project,
  },
  {
    id: 'dsh-canvas-flow#canvas/read_board', service: 'canvas', namespace: 'canvas', method: 'readBoard',
    invocation: { kind: 'direct' }, parameters: [P.projectId], cancellation: signal, result: R.board,
  },
  {
    id: 'dsh-canvas-flow#canvas/set_viewport', service: 'canvas', namespace: 'canvas', method: 'setViewport',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.viewport], cancellation: signal, result: R.project,
  },
  {
    id: 'dsh-canvas-flow#canvas/set_style', service: 'canvas', namespace: 'canvas', method: 'setStyle',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.style], cancellation: signal, result: R.style,
  },
  {
    id: 'dsh-canvas-flow#canvas/move_card', service: 'canvas', namespace: 'canvas', method: 'moveCard',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.position], cancellation: signal, result: R.card,
  },
  {
    id: 'dsh-canvas-flow#canvas/arrange', service: 'canvas', namespace: 'canvas', method: 'arrange',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.strategy], cancellation: signal, result: R.board,
  },

  // ── canvas: source edges ────────────────────────────────────────────────
  {
    id: 'dsh-canvas-flow#canvas/link_source', service: 'canvas', namespace: 'canvas', method: 'linkSource',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.upstream, P.downstream], cancellation: signal, result: R.source,
  },
  {
    id: 'dsh-canvas-flow#canvas/unlink_source', service: 'canvas', namespace: 'canvas', method: 'unlinkSource',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.sourceId], cancellation: signal, result: R.boolean,
  },
  {
    id: 'dsh-canvas-flow#canvas/get_sources', service: 'canvas', namespace: 'canvas', method: 'getSources',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.chain,
  },
  {
    id: 'dsh-canvas-flow#canvas/reconcile', service: 'canvas', namespace: 'canvas', method: 'reconcile',
    invocation: { kind: 'direct' }, parameters: [P.projectId], cancellation: signal, result: R.sourceList,
  },

  // ── canvas: notes ───────────────────────────────────────────────────────
  {
    id: 'dsh-canvas-flow#canvas/create_note', service: 'canvas', namespace: 'canvas', method: 'createNote',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.text, P.position], cancellation: signal, result: R.note,
  },
  {
    id: 'dsh-canvas-flow#canvas/remove_note', service: 'canvas', namespace: 'canvas', method: 'removeNote',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.noteId], cancellation: signal, result: R.boolean,
  },

  // ── card: artifacts ─────────────────────────────────────────────────────
  {
    id: 'dsh-canvas-flow#card/create_card', service: 'card', namespace: 'card', method: 'createCard',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.file, P.kind, P.position], cancellation: signal, result: R.card,
  },
  {
    id: 'dsh-canvas-flow#card/scaffold_webapp', service: 'card', namespace: 'card', method: 'scaffoldWebapp',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.name, P.position], cancellation: signal, result: R.card,
  },
  {
    id: 'dsh-canvas-flow#card/scaffold_design', service: 'card', namespace: 'card', method: 'scaffoldDesign',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.name, P.position], cancellation: signal, result: R.card,
  },
  {
    id: 'dsh-canvas-flow#card/read_design', service: 'card', namespace: 'card', method: 'readDesign',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.designDocument,
  },
  {
    id: 'dsh-canvas-flow#card/edit_design', service: 'card', namespace: 'card', method: 'editDesign',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.designOps], cancellation: signal, result: R.designEdit,
  },
  {
    id: 'dsh-canvas-flow#card/rename_card', service: 'card', namespace: 'card', method: 'renameCard',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.cardName], cancellation: signal, result: R.card,
  },
  {
    id: 'dsh-canvas-flow#card/set_media_model', service: 'card', namespace: 'card', method: 'setMediaModel',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.mediaModel], cancellation: signal, result: R.card,
  },
  {
    id: 'dsh-canvas-flow#card/set_aspect', service: 'card', namespace: 'card', method: 'setAspect',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.aspect], cancellation: signal, result: R.card,
  },
  {
    id: 'dsh-canvas-flow#card/import_artifact', service: 'card', namespace: 'card', method: 'importArtifact',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.importName, P.fileData], cancellation: signal, result: R.card,
  },
  {
    id: 'dsh-canvas-flow#card/remove_card', service: 'card', namespace: 'card', method: 'removeCard',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.boolean,
  },
  {
    id: 'dsh-canvas-flow#card/remove_missing_cards', service: 'card', namespace: 'card', method: 'removeMissingCards',
    invocation: { kind: 'direct' }, parameters: [P.projectId], cancellation: signal, result: R.count,
  },
  {
    id: 'dsh-canvas-flow#card/read_summary', service: 'card', namespace: 'card', method: 'readSummary',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.summary,
  },
  {
    id: 'dsh-canvas-flow#card/read_artifact', service: 'card', namespace: 'card', method: 'readArtifact',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.artifact,
  },
  {
    id: 'dsh-canvas-flow#card/read_bundle', service: 'card', namespace: 'card', method: 'readBundle',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.bundle,
  },
  {
    id: 'dsh-canvas-flow#card/read_sources', service: 'card', namespace: 'card', method: 'readSources',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.summaryList,
  },
  {
    id: 'dsh-canvas-flow#card/reference_files', service: 'card', namespace: 'card', method: 'referenceFiles',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.referencedFiles,
  },
  {
    id: 'dsh-canvas-flow#card/inject_card', service: 'card', namespace: 'card', method: 'injectCard',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.sourceCardId, P.mode], cancellation: signal, result: R.summary,
  },
  {
    id: 'dsh-canvas-flow#card/open_session', service: 'card', namespace: 'card', method: 'openSession',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.session,
  },
  {
    id: 'dsh-canvas-flow#card/release_session', service: 'card', namespace: 'card', method: 'releaseSession',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.boolean,
  },
  {
    id: 'dsh-canvas-flow#card/write_text', service: 'card', namespace: 'card', method: 'writeText',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.content], cancellation: signal, result: R.write,
  },
  {
    id: 'dsh-canvas-flow#card/edit_text', service: 'card', namespace: 'card', method: 'editText',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.content, P.version], cancellation: signal, result: R.write,
  },
  {
    id: 'dsh-canvas-flow#card/queue_intent', service: 'card', namespace: 'card', method: 'queueIntent',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.intentKind, P.intentPayload, P.intentImage], cancellation: signal, result: R.pending,
  },
  {
    id: 'dsh-canvas-flow#card/read_pending', service: 'card', namespace: 'card', method: 'readPending',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.pending,
  },
  {
    id: 'dsh-canvas-flow#card/export_card', service: 'card', namespace: 'card', method: 'exportCard',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.format], cancellation: signal, result: R.export,
  },
  {
    id: 'dsh-canvas-flow#card/publish_card', service: 'card', namespace: 'card', method: 'publishCard',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.export,
  },
  {
    id: 'dsh-canvas-flow#card/send_message', service: 'card', namespace: 'card', method: 'sendMessage',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.prompt], cancellation: signal, result: R.session,
  },
  {
    id: 'dsh-canvas-flow#card/read_last_prompt', service: 'card', namespace: 'card', method: 'readLastPrompt',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.lastPrompt,
  },
]

/**
 * Failure codes this plugin raises.
 *
 * Merged into the protocol's `RemoteErrorDetailsMap` so `RemoteErrorCode`
 * accepts them: the plugin keeps one failure class (`RemoteError`) and encodes
 * the domain in the code, exactly as the protocol intends.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No project is stored under this id. */
    'canvas/project-not-found': { readonly projectId: string }
    /** No card is stored under this id inside the named project. */
    'canvas/card-not-found': { readonly projectId: string; readonly cardId: string }
    /** A card is already seated under this id inside the named project. */
    'canvas/card-exists': { readonly projectId: string; readonly cardId: string }
    /** No source edge is stored under this id inside the named project. */
    'canvas/source-not-found': { readonly projectId: string; readonly sourceId: string }
    /** The edge would duplicate an existing one, or would close a cycle. */
    'canvas/source-invalid': { readonly downstream: string; readonly upstream: string; readonly reason: string }
    /** The directory cannot serve as a project root. */
    'canvas/root-unusable': { readonly path: string; readonly reason: string }
    /**
     * The canvas folder cannot be read right now, so nothing about its cards can
     * be decided. Raised by the bulk cleanup (F1.11): with the root unreadable
     * every card would look absent, and unseating them all is not a conclusion
     * this plugin is willing to draw from a probe that failed.
     */
    'canvas/root-unavailable': { readonly projectId: string; readonly root: string }
    /** The artifact's kind has no implementation for the requested operation. */
    'card/unsupported': { readonly kind: string; readonly operation: string }
    /** The card has no bound session yet. */
    'card/session-missing': { readonly projectId: string; readonly cardId: string }
    /**
     * The card's conversation is held open elsewhere — its log's single-writer
     * lease is taken, typically by the session controller that put it in the
     * main chat. Retriable, and never a reason to start a second conversation.
     */
    'card/session-busy': { readonly projectId: string; readonly cardId: string; readonly sessionId: string }
    /** A guarded write lost a race against a newer version. */
    'card/stale-version': { readonly cardId: string; readonly expected: string; readonly actual: string }
    /** The artifact is absent, or is a directory where a file is required. */
    'card/artifact-absent': { readonly cardId: string; readonly path: string }
    /**
     * A rename this deployment will not perform (F1.12): the name carries no
     * path segment, the card's artifact *is* the canvas folder, or the backend
     * serves another execution world whose paths this process may not touch.
     * The reason travels as text because the set grows with the refusal cases.
     */
    'card/rename-refused': { readonly cardId: string; readonly name: string; readonly reason: string }
    /**
     * 一次导入被拒（F2.7，v1.81）：不是媒体扩展名、超过搬运上限、或者是个空文件。
     *
     * 三种都是**答案**而不是故障（用户换一个文件、压小一点、或者挑错了），所以理由
     * 作为 `reason` 原样带出来，界面按它说三种不同的话。与 `card/rename-refused`
     * 同一条纪律：理由的集合会长，枚举写死在协议里迟早漏一种。
     */
    'card/import-refused': { readonly cardId: string; readonly name: string; readonly reason: string }
    /**
     * 导入的载荷不是一段合法的 base64（F2.7，v1.81）。
     *
     * 这是**调用方写错了**，不是用户做错了什么：客户端的 `readBase64` 只会给出合法的
     * 一段。单独一个码，是为了让它与「被拒」在日志里分得开——一个要改代码，一个要换文件。
     */
    'card/import-malformed': { readonly length: number }
  }
}
