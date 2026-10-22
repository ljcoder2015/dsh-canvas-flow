/**
 * dsh-canvas — 板面文件（F1.9 / F1.10）。
 *
 * 一张画布原本只活在部署的存储域里（`~/.dsh/storages/dsh_canvas`），于是「画布＝这个
 * 文件夹」这句话只在同一台机器上成立：目录一改名，`projectIdOf(root)` 就换了人，旧记录
 * 成了没人认领的孤儿；换台机器打开同一个目录，只剩一堆按默认网格摆开的卡片。
 *
 * 这个模块补上缺的那一半——**目录自己带一份可迁移的板面投影**，写在
 * `<root>/.dsh-canvas/board.json`：
 *
 * - `id`：这张画布是谁。目录改名、搬家之后，绑定先读它，于是认回同一张画布、同一批
 *   座位与引用（F1.9）。没有它时退回 `projectIdOf(root)`，所以**已经存在的画布一个字节
 *   都不用迁**——第一次重新绑定会照着老身份把文件补出来。
 * - `cards` / `sources` / `notes` / `style` / `name`：人读得懂、可 diff、可手改的板面快照。
 *   换一台机器、或把目录拷给同事，绑定它就能把板面重建出来（F1.10）。
 *
 * 三条不写进去的东西，因为它们不是这张作品的属性：`sessionId`（换台机器就是另一个会话，
 * 带过去只会假装「有对话」）、`viewport`（本机屏幕态）、存储域里的排队意图。布局与关系
 * 跟着作品走，视图状态留在本地——这是这条规则的划线处。
 *
 * **本模块是纯的**：编解码、身份判定与「该补哪些卡片/边/便签」都做成对普通数据的函数，
 * 于是每一条都能在容器外测；读写盘与表都归 `host/board-file.ts`。
 */
import type { CardId, NoteId, Point, ProjectId, Source, StyleProfile } from '../../../types.ts'
import { nextFreeSeat, type Seat, type SeatInput } from './board.ts'
import { sourceIdOf, validateEdge, type EdgeRef } from './source-store.ts'

/**
 * The folder the canvas keeps its own state in, relative to the project root.
 *
 * Hidden on purpose: `ArtifactIo.scanProject` skips dot-entries, so the canvas
 * never scans its own bookkeeping as an artifact, and a project bound to a real
 * repository looks untouched in the file browser.
 */
export const BOARD_DIR = '.dsh-canvas'

/** The one file inside {@link BOARD_DIR}. */
export const BOARD_FILE = `${BOARD_DIR}/board.json`

/** Envelope marker, so a stray JSON file is never mistaken for a board. */
export const BOARD_FILE_FORMAT = 'dsh-canvas-board'

/** Envelope version this code writes and accepts. */
export const BOARD_FILE_VERSION = 1

/** One card's seat, as the file remembers it. */
export interface BoardFileCard {
  id: CardId
  position: Point
  /**
   * Path of the artifact the card binds, relative to the project root.
   * Optional so a file written before the id/path split still parses — there
   * the id *is* the path, and a missing `file` reads as exactly that. Written
   * only when it differs from the id, so a legacy board is unchanged on disk.
   */
  file?: string
  /**
   * The user's own name for the card (F1.12), when it says something the path
   * does not. Carried for the same reason the seats are: a name is the user's
   * word for the work, so a folder opened elsewhere — or handed to a colleague
   * — must show the board they named, not its file names.
   */
  name?: string
  /**
   * The seat was created without an artifact and has not been seen with one
   * since (F1.11). Carried so the exemption survives leaving this machine: a
   * folder opened elsewhere must not offer a not-yet-written card to a bulk
   * cleanup, whose removal would take the restored edges with it.
   */
  empty?: boolean
  /**
   * 这张卡由哪个模型生成（F2.7）。跟着作品走，与 `name` 同理：用户在一台机器上选好的
   * 「图片用 pro、视频用 2.5」，把目录拷给同事或换台机器打开时应当还在——那是这张作品的
   * 制作决定，不是本机环境的一部分。
   *
   * 可选：没选过就不写（写出去的文件与这个字段出现之前逐字节相同），读回来
   * `undefined` 即「交给配置里第一个对得上族的模型」。
   */
  mediaModel?: string
  /**
   * 产物的真实宽高比（宽 ÷ 高，F3.11），跟着作品走。
   *
   * 它决定这张卡在画布上占多大，所以必须随目录迁移：换台机器打开同一份作品，图片卡
   * 还是那个比例，而不是先按 16:9 坐一次、等浏览器量完再跳一下。
   */
  aspect?: number
}

/** One source edge, as the file remembers it. */
export interface BoardFileSource {
  downstream: CardId
  upstream: CardId
  origin: Source['origin']
}

/** One shared note, as the file remembers it. */
export interface BoardFileNote {
  id: NoteId
  text: string
  author: string
  position: Point
  createdAt: number
}

/** The portability projection of one board. */
export interface BoardFileContent {
  id: ProjectId
  name: string
  style: StyleProfile
  cards: BoardFileCard[]
  sources: BoardFileSource[]
  notes: BoardFileNote[]
}

/**
 * Outcome of reading a file that exists.
 *
 * `unreadable` is not an error to raise: a board file this build cannot
 * understand may be a hand-edit mid-flight or a document written by a newer
 * format, and the honest response in both cases is to leave it alone and carry
 * on with the storage domain. What it must *never* do is get silently
 * overwritten by our older projection.
 */
export type BoardFileRead = { kind: 'parsed'; content: BoardFileContent } | { kind: 'unreadable'; reason: string }

/**
 * Render a board as the file's text.
 *
 * Sorted, so two renders of the same board are byte-identical — that is what
 * lets the writer skip unchanged writes (no mtime churn for build watchers, no
 * empty git diffs) and what makes a real change the only thing in a diff.
 */
export function composeBoardFile(content: BoardFileContent): string {
  const cards = [...content.cards]
    .sort((left, right) => left.id.localeCompare(right.id))
    // `empty` only when it is true: the field is an exception flag, and a board
    // whose seats all hold artifacts should read as if it did not exist.
    // `file` only when it differs from the id: a legacy board (id-shaped path,
    // no split) renders byte-identically to before.
    .map((card) => ({
      id: card.id,
      position: card.position,
      ...(card.file !== undefined && card.file !== card.id ? { file: card.file } : {}),
      ...(card.name !== undefined && card.name !== '' ? { name: card.name } : {}),
      ...(card.empty === true ? { empty: true } : {}),
      // 只在选过时写：没选过的画布与这个字段出现之前逐字节相同。
      ...(card.mediaModel !== undefined && card.mediaModel !== '' ? { mediaModel: card.mediaModel } : {}),
      // 同理：没量过比例的画布与这个字段出现之前逐字节相同。
      ...(typeof card.aspect === 'number' && card.aspect > 0 ? { aspect: card.aspect } : {}),
    }))
  const sources = [...content.sources].sort(
    (left, right) => left.downstream.localeCompare(right.downstream) || left.upstream.localeCompare(right.upstream),
  )
  const notes = [...content.notes].sort((left, right) => left.id.localeCompare(right.id))
  const payload = {
    format: BOARD_FILE_FORMAT,
    version: BOARD_FILE_VERSION,
    id: content.id,
    name: content.name,
    style: content.style,
    cards,
    sources,
    notes,
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

/**
 * Parse a board file's text.
 *
 * The envelope is strict and the entries are lenient: a wrong `format` or a
 * version this build does not know makes the whole file foreign (see
 * {@link BoardFileRead}), while one malformed card inside an otherwise valid
 * file is skipped rather than costing the user the rest of the board — a
 * half-typed `cards` entry should not lock anyone out of their own layout.
 */
export function parseBoardFile(text: string): BoardFileRead {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { kind: 'unreadable', reason: 'not JSON' }
  }
  if (typeof raw !== 'object' || raw === null) return { kind: 'unreadable', reason: 'not an object' }
  const value = raw as Record<string, unknown>
  if (value['format'] !== BOARD_FILE_FORMAT) return { kind: 'unreadable', reason: 'not a canvas board file' }
  if (value['version'] !== BOARD_FILE_VERSION) {
    return { kind: 'unreadable', reason: `unsupported board file version: ${String(value['version'])}` }
  }
  const id = text1(value['id'])
  if (id === '') return { kind: 'unreadable', reason: 'board file carries no project id' }

  return {
    kind: 'parsed',
    content: {
      id,
      name: text1(value['name']),
      style: style(value['style']),
      cards: list(value['cards']).flatMap((entry) => {
        const cardId = text1(entry['id'])
        const position = point(entry['position'])
        if (cardId === '' || position === undefined) return []
        const file = text1(entry['file'])
        const name = text1(entry['name'])
        const mediaModel = text1(entry['mediaModel'])
        const aspect = ratio(entry['aspect'])
        return [
          {
            id: cardId,
            position,
            ...(file !== '' && file !== cardId ? { file } : {}),
            // Empty reads as "no name of its own": the display name falls back
            // to the artifact, exactly as it did before this field existed.
            ...(name !== '' ? { name } : {}),
            ...(entry['empty'] === true ? { empty: true } : {}),
            // 没写 = 没选过（交给自动挑），与写出去那一侧是同一条判断。
            ...(mediaModel !== '' ? { mediaModel } : {}),
            // 非正数 / 不是数字一律读作「没量过」：卡片按默认比例坐，而不是被一条坏数据撑坏。
            ...(aspect === undefined ? {} : { aspect }),
          },
        ]
      }),
      sources: list(value['sources']).flatMap((entry) => {
        const downstream = text1(entry['downstream'])
        const upstream = text1(entry['upstream'])
        if (downstream === '' || upstream === '') return []
        return [{ downstream, upstream, origin: entry['origin'] === 'reconciled' ? 'reconciled' : 'manual' } as BoardFileSource]
      }),
      notes: list(value['notes']).flatMap((entry) => {
        const noteId = text1(entry['id'])
        const position = point(entry['position'])
        if (noteId === '' || position === undefined) return []
        const createdAt = entry['createdAt']
        return [
          {
            id: noteId,
            text: text1(entry['text']),
            author: text1(entry['author']),
            position,
            createdAt: typeof createdAt === 'number' ? createdAt : 0,
          },
        ]
      }),
    },
  }
}

// ── identity ───────────────────────────────────────────────────────────────

/** What the deployment knows when a directory is bound, reduced to the facts identity needs. */
export interface IdentityFacts {
  /** The id the folder's board file carries, when it has one this build can read. */
  fileId?: ProjectId
  /** The id derived from the path — the fallback that keeps pre-existing canvases stable. */
  derivedId: ProjectId
  /** Whether a project record already exists under the id we are about to use. */
  recorded: boolean
  /** Whether that record names this very folder. */
  recordedRootIsHere: boolean
  /** Whether the root that record names still exists on disk. */
  recordedRootPresent: boolean
  /** Ids other projects hold, for minting a free one in the copy case. */
  taken: readonly ProjectId[]
}

/** Which of the four things binding this directory means. */
export type IdentityPlan =
  | { kind: 'fresh'; id: ProjectId }
  | { kind: 'reuse'; id: ProjectId }
  | { kind: 'move'; id: ProjectId }
  | { kind: 'copy'; id: ProjectId }

/**
 * Decide which canvas a directory *is* (F1.9).
 *
 * - `fresh` — no record under this id yet: a new canvas, an import from another
 *   machine, or a folder whose file was written by a deployment that never had
 *   a record. The id comes from the file when there is one, so an imported
 *   board keeps the identity its own folder claims.
 * - `reuse` — the record already names this folder: the ordinary re-open.
 * - `move` — the record names this id but another path, and that path is gone:
 *   the directory was renamed or moved, so it is the same canvas and the record
 *   is re-pointed here. **This is what makes a rename stop minting a new
 *   canvas** and what keeps seats, edges and notes through it.
 * - `copy` — the record's path is still there, so this folder is a *second*
 *   one carrying the same identity: a copy. It gets a fresh id of its own
 *   (otherwise two folders would share one board and one `root`, and a card
 *   removed in one would vanish from the other), and its own board file is
 *   rewritten to say so.
 */
export function planIdentity(facts: IdentityFacts): IdentityPlan {
  const id = facts.fileId ?? facts.derivedId
  if (!facts.recorded) return { kind: 'fresh', id }
  if (facts.recordedRootIsHere) return { kind: 'reuse', id }
  if (!facts.recordedRootPresent) return { kind: 'move', id }
  return { kind: 'copy', id: mintId(facts.derivedId, facts.taken) }
}

/** The first free id at or after `base` — `base`, `base-2`, `base-3`… */
export function mintId(base: ProjectId, taken: readonly ProjectId[]): ProjectId {
  const used = new Set(taken)
  if (!used.has(base)) return base
  // `taken` is finite, so this terminates; a canvas copied a hundred times is
  // not a case worth a cleverer rule.
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!used.has(candidate)) return candidate
  }
}

// ── import ─────────────────────────────────────────────────────────────────

/** What the deployment holds for a board, reduced to what an import decision needs. */
export interface SeatPlanInput {
  /** Cards already seated in the storage domain, with their committed positions. */
  seated: readonly SeatInput[]
  /** Cards the board file lists, in file order. */
  filed: readonly BoardFileCard[]
  /** Artifact paths the directory scan found, sorted — candidates, not yet cards. */
  scanned: readonly string[]
  /** Horizontal gap between cards, in canvas px. */
  gap: number
  /**
   * Mints a fresh card id for a scanned file no card binds yet. Injected so
   * this function stays pure: the caller owns the rule (six random letters,
   * unique against the project's seats) and the randomness.
   */
  mint: (file: string) => CardId
}

/**
 * A seat an import still has to write.
 *
 * Extends a plain seat with the two facts geometry has no use for but the card
 * record does: the artifact path the card binds, and whether the seat is known
 * to have been born without an artifact (F1.11), which is what keeps a bulk
 * cleanup's hands off it.
 */
export interface PlannedSeat extends Seat {
  file: string
  /** The card's own name, when the file carried one (F1.12). */
  name?: string
  empty?: boolean
  /** 这张卡由哪个模型生成（F2.7），文件里带了才带得回来。 */
  mediaModel?: string
  /** 产物的真实宽高比（F3.11），文件里带了才带得回来。 */
  aspect?: number
}

/**
 * The cards a bind still has to seat, and where.
 *
 * The split of authority is the whole content of this function. A card that is
 * already seated keeps the seat the *storage domain* remembers — it is this
 * deployment's own, newest state, and a stale file must not drag it back. Only
 * the cards that are missing get positions, and they take them from the file
 * (which is where a seat survives a change of machine or a copy), falling back
 * to the ordinary "one step right of the right-most card" for artifacts the
 * file never knew about — files dropped into the folder while nobody was
 * looking.
 *
 * Reconciliation is by **file**, not id: a scanned artifact path that some
 * seated card (or some card the board file lists) already binds is that card —
 * the id stays whatever it was, random letters included. Only a file no card
 * claims gets a seat, and its id comes from {@link SeatPlanInput.mint}.
 *
 * Nothing here deletes. A card the file lists but the disk no longer has is
 * still seated, because it is a real board position carrying real edges and
 * notes; it shows up as a missing card (F3.5) and the user removes it (F1.11).
 */
export function planSeats(input: SeatPlanInput): PlannedSeat[] {
  const seats: SeatInput[] = input.seated.map((card) => ({ ...card, file: card.file ?? card.id }))
  const known = new Set(input.seated.map((card) => card.id))
  const ownerOf = new Map<string, CardId>(seats.map((card) => [card.file ?? card.id, card.id]))
  const fresh: PlannedSeat[] = []

  for (const card of input.filed) {
    if (known.has(card.id)) continue
    known.add(card.id)
    const file = card.file ?? card.id
    const position = { ...card.position }
    fresh.push({
      id: card.id,
      file,
      position,
      ...(card.name === undefined ? {} : { name: card.name }),
      ...(card.empty === true ? { empty: true } : {}),
      ...(card.mediaModel === undefined ? {} : { mediaModel: card.mediaModel }),
      ...(card.aspect === undefined ? {} : { aspect: card.aspect }),
    })
    seats.push({ id: card.id, file, position })
    if (!ownerOf.has(file)) ownerOf.set(file, card.id)
  }

  for (const file of input.scanned) {
    if (ownerOf.has(file)) continue
    const id = input.mint(file)
    known.add(id)
    ownerOf.set(file, id)
    const position = nextFreeSeat(seats, input.gap)
    fresh.push({ id, file, position })
    seats.push({ id, file, position })
  }

  return fresh
}

/** The edges an import still has to write, each one validated like a hand-drawn link. */
export function planEdges(input: {
  filed: readonly BoardFileSource[]
  known: readonly CardId[]
  existing: readonly Source[]
}): BoardFileSource[] {
  // Not `reconcileEdges`: that one turns artifact *evidence* into `reconciled`
  // edges, while this one restores a stored snapshot and must keep each edge's
  // own origin. The rules they share are the validating ones, and those live in
  // `validateEdge` — one copy, two callers.
  const edges = [...input.existing]
  const added: BoardFileSource[] = []
  for (const edge of input.filed) {
    const candidate: EdgeRef = { downstream: edge.downstream, upstream: edge.upstream }
    if (!validateEdge(candidate, input.known, edges).ok) continue
    edges.push({
      id: sourceIdOf(edge.downstream, edge.upstream),
      project: '',
      downstream: edge.downstream,
      upstream: edge.upstream,
      origin: edge.origin,
    })
    added.push(edge)
  }
  return added
}

/** The notes an import still has to write. Ids are minted per note, so this is a plain filter. */
export function planNotes(filed: readonly BoardFileNote[], taken: Iterable<NoteId>): BoardFileNote[] {
  const known = new Set(taken)
  const added: BoardFileNote[] = []
  for (const note of filed) {
    if (known.has(note.id)) continue
    known.add(note.id)
    added.push(note)
  }
  return added
}

// ── narrow readers (the file is hand-editable, so nothing is trusted) ───────

function text1(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 宽高比：只认有限正数，其余（字符串、0、NaN、Infinity）一律当作「没量过」。 */
function ratio(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function list(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
}

function point(value: unknown): Point | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { x, y } = value as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number') return undefined
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  return { x, y }
}

function style(value: unknown): StyleProfile {
  const empty: StyleProfile = { palette: [], font: '', tone: '' }
  if (typeof value !== 'object' || value === null) return empty
  const raw = value as { palette?: unknown; font?: unknown; tone?: unknown }
  return {
    palette: Array.isArray(raw.palette) ? raw.palette.filter((entry): entry is string => typeof entry === 'string') : [],
    font: text1(raw.font),
    tone: text1(raw.tone),
  }
}
