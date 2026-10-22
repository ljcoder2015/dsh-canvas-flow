/**
 * dsh-canvas — `canvas` Remote service: projects, seating, source edges, notes.
 *
 * Everything the board *is* lives here; everything a card *contains* lives in
 * `card-runtime.ts`. Ownership of durable state is one-directional: this class
 * reads and writes the storage domain and never touches artifact contents
 * beyond the bounded probe the kind registry needs.
 *
 * Failure surface follows §4.4: one class (`RemoteError`), domain-qualified
 * codes, never a local exception family.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ArrangeStrategy,
  BoardCard,
  BoardSnapshot,
  BoardSource,
  CardId,
  FolderEntry,
  Note,
  NoteId,
  Point,
  Project,
  ProjectId,
  Source,
  SourceChain,
  SourceId,
  StyleProfile,
  Viewport,
} from '../../types.ts'
import type { CanvasDomain } from '../../domain.ts'
import { ArtifactIo, missingOf } from '../../core/artifact/io/artifact-io.ts'
import type { BoardFile } from './board-file.ts'
import { arrangeSeats } from '../../core/canvas/board/board.ts'
import { planEdges, planIdentity, planNotes, planSeats } from '../../core/canvas/board/board-file.ts'
import { mintCardId, projectIdOf } from '../../core/canvas/card/ids.ts'
import { cardNameOf } from '../../core/canvas/card/card-name.ts'
import { applyFoldPlans, foldedPathOf, planFolds } from '../../core/canvas/project/artifact-folders.ts'
import { aspectSlotOf, mediaSlotOf } from '../../core/canvas/card/card-fields.ts'
import { cardFileOf, cardIdOfKey, cardKeyOf, SessionManager } from '../../core/session/session-manager.ts'
import { isMediaKind, kindLabel } from '../../core/artifact/kind/kind-registry.ts'
import { claimCanvasWorkspace } from '../../core/canvas/project/workspace.ts'
import { PLUGIN_ID } from '../prompt.ts'
import {
  reconcileEdges,
  referencedPaths,
  sourceIdOf,
  transitiveUpstreams,
  validateEdge,
} from '../../core/canvas/board/source-store.ts'

/** What {@link CanvasRuntime} needs from the plugin's composition root. */
export interface CanvasRuntimeDeps {
  domain: CanvasDomain
  io: ArtifactIo
  sessions: SessionManager
  /** The board's portable projection in the bound folder (F1.9/F1.10). */
  board: BoardFile
  /** Horizontal gap used when arranging, in canvas px. */
  arrangeGap: number
  /** Depth of the chain `getSources` resolves. */
  sourceDepth: number
  /** Root the folder picker starts from. */
  pickerRoot: string
}

/** A stored card record, as the domain keeps it. */
interface CardRecord {
  project: string
  kind: string
  position: Point
  sessionId: string
  updatedAt: number
  /** The seat was created without an artifact; see `core/canvas/cleanup.ts` (F1.11). */
  seatedEmpty?: boolean | undefined
  /** Artifact path relative to the project root; absent on pre-split records, where the id *is* the path. */
  file?: string | undefined
  /** The card's own name (F1.12), when it says more than its artifact's path does. */
  name?: string | undefined
  /** 这张卡由哪个模型生成（F2.7）；缺席 = 没选过，交给配置里第一个对得上族的模型。 */
  mediaModel?: string | undefined
  /** 产物的真实宽高比（F3.11）；缺席 = 还没量过，卡片按默认 16:9 坐。 */
  aspect?: number | undefined
}

/** The artifact path a record names — `file`, falling back to a legacy path-shaped id. */
const fileOf = cardFileOf

/** A stored project record. */
interface ProjectRecord {
  name: string
  root: string
  viewport: Viewport
  style: StyleProfile
  createdAt: number
}

/**
 * Where new work goes when the picker starts from the configured root.
 *
 * The picker is deliberately shallow-on-open and deep-on-demand: handing the
 * client a full recursive tree would be both slow and unhelpful, and the
 * deployment's root may be a home directory.
 */
const MAX_FOLDER_ENTRIES = 500

export class CanvasRuntime extends TypertRemoteService {
  constructor(ctx: Context, private readonly deps: CanvasRuntimeDeps) {
    // The service key doubles as the wire namespace; `canvas` is the hex
    // namespace base recorded in §4.3.
    super(ctx, 'canvas')
  }

  private get projects() {
    return this.deps.domain.table('projects')
  }

  private get cards() {
    return this.deps.domain.table('cards')
  }

  private get sources() {
    return this.deps.domain.table('sources')
  }

  private get notes() {
    return this.deps.domain.table('notes')
  }

  /**
   * 已经整理过的画布（每个进程一次）。
   *
   * 值是一个 Promise 而不是布尔：板面会被两个座位同时画（右栏标签页与主列面板），
   * 第二次进来时应当等第一次搬完，而不是看着半搬的状态去算卡片。
   */
  private readonly folded = new Map<ProjectId, Promise<void>>()

  // ── projects ────────────────────────────────────────────────────────────

  /** Every project, oldest first. */
  @Remote
  async listProjects(signal?: AbortSignal): Promise<Project[]> {
    signal?.throwIfAborted()
    return [...this.projects.entries()]
      .map(([id, record]) => this.projectOf(id, record))
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  /**
   * Bind a directory as a project and discover the artifacts already in it
   * (F1.3).
   *
   * Re-binding an existing root is idempotent: it returns the stored project
   * and only adds cards for artifacts that are not seated yet, so a second
   * "new project" on the same folder never duplicates the board.
   *
   * It is also where a directory's *identity* is decided (F1.9) and where a
   * carried board is imported (F1.10). The folder's own board file, when it has
   * one, names the canvas; without it the path digest decides, exactly as it
   * always did — which is why every canvas that already exists keeps its id and
   * its records, and simply gains the file on its next bind.
   */
  @Remote
  async createProject(name: string, path: string, signal?: AbortSignal): Promise<{ project: Project; discovered: number }> {
    signal?.throwIfAborted()
    // The picker's empty path means "start where the configured root starts".
    const directory = path.trim() === '' ? this.deps.pickerRoot : path
    const scan = await this.deps.io.scanProject(directory, signal)
    const root = await this.deps.io.displayPathOf(directory, '.', signal).catch(() => directory)

    const outcome = await this.deps.board.read(root, signal)
    const carried = outcome.kind === 'parsed' ? outcome.content : undefined
    const derivedId = projectIdOf(root)
    const recorded = this.projects.get(carried?.id ?? derivedId)
    const plan = planIdentity({
      fileId: carried?.id,
      derivedId,
      recorded: recorded !== undefined,
      recordedRootIsHere: recorded?.root === root,
      // `move` and `copy` are told apart by one question: is the path the
      // record names still there? A directory that was renamed leaves nothing
      // behind, so the record is re-pointed here; a directory that was copied
      // leaves the original in place, so this one is a second canvas and gets
      // an id of its own.
      recordedRootPresent: recorded === undefined ? false : await this.rootPresent(recorded.root, signal),
      taken: [...this.projects.keys()],
    })

    const existing = this.projects.get(plan.id)
    // Name and style: the record wins when it is ours (this machine, this
    // folder) because it may hold a change the file has not caught up with; the
    // carried file wins for a project this deployment has never had, which is
    // the import case. Either way a card session's prompt sees the same profile
    // the folder came with.
    const carriedName = carried?.name.trim() ?? ''
    await this.projects.put(plan.id, {
      name: carriedName !== '' ? carriedName : (existing?.name ?? (name.trim() === '' ? (root.split('/').pop() ?? 'canvas') : name.trim())),
      root,
      viewport: existing?.viewport ?? { x: 0, y: 0, zoom: 1 },
      style: existing?.style ?? carried?.style ?? { palette: [], font: '', tone: '' },
      createdAt: existing?.createdAt ?? Date.now(),
    })

    const seated = this.cardsOf(plan.id)
    // The mint closes over every id the project already holds plus the ones it
    // mints below, so a scan can never mint a duplicate seat id.
    const taken = new Set(seated.map(([key]) => cardIdOfKey(plan.id, key)))
    const seats = planSeats({
      seated: seated.map(([key, record]) => {
        const id = cardIdOfKey(plan.id, key)
        return { id, file: fileOf(record, id), position: record.position }
      }),
      filed: carried?.cards ?? [],
      scanned: scan,
      gap: this.deps.arrangeGap,
      mint: () => {
        const id = mintCardId(taken)
        taken.add(id)
        return id
      },
    })
    for (const seat of seats) {
      const facts = await this.deps.io.facts(root, seat.file, signal)
      await this.cards.put(cardKeyOf(plan.id, seat.id), {
        project: plan.id,
        kind: facts.kind,
        position: seat.position,
        sessionId: '',
        updatedAt: Date.now(),
        file: seat.file,
        // Restored only where the file says so: a card the file lists whose
        // artifact is simply gone was **never** an empty seat, and marking it
        // one would make it permanently un-cleanable (F1.11).
        ...(seat.empty === true ? { seatedEmpty: true } : {}),
        // A carried name travels with the board (F1.12): it is the user's word
        // for the work, not a fact about this machine.
        ...(seat.name === undefined ? {} : { name: seat.name }),
        // 生成模型也跟着作品走（F2.7）：换台机器打开同一个目录，「图片用 pro、
        // 视频用 2.5」这个制作决定应当还在。文件里没写就是没选过。
        ...(seat.mediaModel === undefined ? {} : { mediaModel: seat.mediaModel }),
        // 比例也随作品走（F3.11）：不带着它，换台机器打开同一个目录，图片卡会先按 16:9
        // 坐一次、等浏览器量完再跳一下——而它本来就知道自己多宽多高。
        ...(seat.aspect === undefined ? {} : { aspect: seat.aspect }),
      })
    }

    // Relations carried by the folder are restored through the same validation
    // a hand-drawn link goes through, so a file cannot smuggle in a self-edge,
    // a duplicate or a cycle.
    const known = [...seated.map(([key]) => cardIdOfKey(plan.id, key)), ...seats.map((seat) => seat.id)]
    for (const edge of planEdges({ filed: carried?.sources ?? [], known, existing: this.edgeList(plan.id) })) {
      await this.sources.put(sourceIdOf(edge.downstream, edge.upstream), {
        project: plan.id,
        downstream: edge.downstream,
        upstream: edge.upstream,
        origin: edge.origin,
      })
    }
    const takenNotes = [...this.notes.entries()].filter(([, record]) => record.project === plan.id).map(([id]) => id)
    for (const note of planNotes(carried?.notes ?? [], takenNotes)) {
      await this.notes.put(note.id, {
        project: plan.id,
        text: note.text,
        author: note.author,
        position: note.position,
        createdAt: note.createdAt,
      })
    }

    const record = this.projects.get(plan.id)
    const project = this.projectOf(plan.id, record as ProjectRecord)
    // 目录自己的那份板面投影（F1.10）：首次绑定在这里把文件补出来，从别处带来的板面在这里
    // 对账，而被复制的那一份会在此处改写成它自己的新 id —— 否则再打开一次又会认回原画布。
    await this.deps.board.write(project, signal)
    // 画布即工作区（F1.6）：建画布的同时把这个根目录登记成宿主工作区，并把已经绑过
    // 会话的卡片一并交账——重开一张旧画布，它的对话也就当场从「未分组」挪到这张画布
    // 名下。尽力而为，没有工作区名册的部署里整体是空操作。
    await claimCanvasWorkspace(
      this.ctx,
      { root: project.root, title: project.name },
      this.cardsOf(plan.id).map(([, card]) => card.sessionId),
    )
    const scanned = new Set(scan)
    return { project, discovered: seats.filter((seat) => scanned.has(seat.file)).length }
  }

  /** Forget a project. The files on disk are never touched. */
  @Remote
  async removeProject(projectId: ProjectId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    for (const [key] of this.cardsOf(projectId)) await this.cards.delete(key)
    for (const [id, record] of [...this.sources.entries()]) {
      if (record.project === projectId) await this.sources.delete(id)
    }
    for (const [id, record] of [...this.notes.entries()]) {
      if (record.project === projectId) await this.notes.delete(id)
    }
    const removed = await this.projects.delete(projectId)
    // The deleted canvas may be the one the board-wide tools answer for. Left
    // pointing at a project that no longer exists, that slot would turn every
    // later board-wide call into `canvas/project-not-found` — so it is cleared
    // here, and only when it names this very project.
    if (removed && this.deps.domain.global.get().activeProjectId === projectId) {
      await this.writeActiveProject('')
    }
    // 目录里那份板面文件**不删**（F1.10）：它是这张作品自己的东西，不属于这次「从列表里
    // 拿开」。于是把文件夹重新加成画布，板面就从文件里回来——忘记与恢复互为逆操作。
    return removed
  }

  /** Direct subdirectories of a path, for the folder picker (design screen 02). */
  @Remote
  async listFolders(path: string, signal?: AbortSignal): Promise<FolderEntry[]> {
    signal?.throwIfAborted()
    const start = path.trim() === '' ? this.deps.pickerRoot : path
    const entries = await this.deps.io.listFolders(start, signal)
    return entries.slice(0, MAX_FOLDER_ENTRIES)
  }

  // ── board ───────────────────────────────────────────────────────────────

  /**
   * Record which canvas the user is looking at.
   *
   * The board-wide agent tools (`canvas_read_board` and its siblings) answer for
   * *the canvas the user has open*, and this global slot is the only place that
   * fact lives: a card conversation can resolve its own project, but a plain
   * conversation inside the deployment cannot. The client writes it whenever the
   * visible canvas changes, and nothing else does.
   */
  @Remote
  async setActiveProject(projectId: ProjectId, signal?: AbortSignal): Promise<Project> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    await this.writeActiveProject(projectId)
    return project
  }

  /** The whole board: seating, edges, notes (F1.3). */
  @Remote
  async readBoard(projectId: ProjectId, signal?: AbortSignal): Promise<BoardSnapshot> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    // 老画布的产物原本平铺在项目根上；画一次板面顺手把它们按类型收进子目录（F1.13）。
    // 放在算卡片**之前**：搬完之后每条记录指向的已经是新路径，这一趟读出来的就是结果。
    await this.foldArtifacts(project, signal)
    const cards = await Promise.all(
      this.cardsOf(projectId).map(async ([key, record]) => {
        const cardId = cardIdOfKey(projectId, key)
        const file = fileOf(record, cardId)
        // Presence only, never a head read: painting the board asks "is it
        // there", and the artifact's own view is the one that reads content.
        const presence = await this.deps.io.presenceOf(project.root, file, signal)
        if (presence === 'present' && record.seatedEmpty === true) {
          // The seat has been filled — by a seed write, a generation run, or
          // the model writing the file with its own tools, which is why the
          // observer has to be the board read rather than the write path. Once
          // cleared it never writes again, and the card becomes an ordinary one
          // that a later deletion may legitimately make missing (F1.11).
          await this.cards.put(key, { ...record, seatedEmpty: false })
        }
        return {
          id: cardId,
          file,
          name: cardNameOf({ file, kind: record.kind, name: record.name }),
          project: projectId,
          kind: record.kind,
          kindLabel: kindLabel(record.kind),
          position: record.position,
          sessionId: record.sessionId,
          missing: missingOf(presence, record.seatedEmpty),
      ...mediaSlotOf(record),
      ...aspectSlotOf(record),
        } satisfies BoardCard
      }),
    )
    return {
      project,
      cards,
      sources: this.sourcesOf(projectId),
      notes: [...this.notes.entries()]
        .filter(([, record]) => record.project === projectId)
        .map(([id, record]) => ({ id, ...record })),
    }
  }

  /** Remember where the user left the viewport (F1.4). */
  @Remote
  async setViewport(projectId: ProjectId, viewport: Viewport, signal?: AbortSignal): Promise<Project> {
    signal?.throwIfAborted()
    const record = this.requireProjectRecord(projectId)
    await this.projects.put(projectId, { ...record, viewport })
    return this.projectOf(projectId, { ...record, viewport })
  }

  /** Remember the project's palette, font and tone (F9.1). */
  @Remote
  async setStyle(projectId: ProjectId, style: StyleProfile, signal?: AbortSignal): Promise<StyleProfile> {
    signal?.throwIfAborted()
    const record = this.requireProjectRecord(projectId)
    await this.projects.put(projectId, { ...record, style })
    await this.persist(projectId, signal)
    return style
  }

  /** Move one card by hand. */
  @Remote
  async moveCard(projectId: ProjectId, cardId: CardId, position: Point, signal?: AbortSignal): Promise<BoardCard> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const key = cardKeyOf(projectId, cardId)
    const record = this.cards.get(key)
    if (record === undefined) throw this.cardNotFound(projectId, cardId)
    await this.cards.put(key, { ...record, position })
    await this.persist(projectId, signal)
    const presence = await this.deps.io.presenceOf(project.root, fileOf(record, cardId), signal)
    return {
      id: cardId,
      file: fileOf(record, cardId),
      name: cardNameOf({ file: fileOf(record, cardId), kind: record.kind, name: record.name }),
      project: projectId,
      kind: record.kind,
      kindLabel: kindLabel(record.kind),
      position,
      sessionId: record.sessionId,
      missing: missingOf(presence, record.seatedEmpty),
      ...mediaSlotOf(record),
      ...aspectSlotOf(record),
    }
  }

  /**
   * Re-seat every card by strategy (F4.6).
   *
   * Positions are written one record at a time; the domain's write chain
   * serializes them, so an interrupted arrange leaves a partially moved board
   * rather than a corrupt one, and re-running it converges.
   */
  @Remote
  async arrange(projectId: ProjectId, strategy: ArrangeStrategy, signal?: AbortSignal): Promise<BoardSnapshot> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    const entries = this.cardsOf(projectId)
    const seats = arrangeSeats(
      // 比例要跟着座位走：一张 9:16 的竖视频卡比 16:9 的图卡高一倍，按默认高度排位会让
      // 下一张压进它的身位（`core/canvas/card-size.ts` 的 `sizeOfCard`）。
      entries.map(([key, record]) => ({
        id: cardIdOfKey(projectId, key),
        position: record.position,
        kind: record.kind,
        ...(record.aspect === undefined ? {} : { aspect: record.aspect }),
      })),
      [...this.sources.entries()].filter(([, record]) => record.project === projectId).map(([id, record]) => ({ id, ...record })),
      strategy,
      this.deps.arrangeGap,
    )
    for (const seat of seats) {
      const key = cardKeyOf(projectId, seat.id)
      const record = this.cards.get(key)
      if (record === undefined) continue
      await this.cards.put(key, { ...record, position: seat.position })
    }
    await this.persist(projectId, signal)
    return this.readBoard(projectId, signal)
  }

  // ── source edges ────────────────────────────────────────────────────────

  /** Declare that an artifact builds on another (F4.1–F4.3). */
  @Remote
  async linkSource(
    projectId: ProjectId,
    upstream: CardId,
    downstream: CardId,
    signal?: AbortSignal,
  ): Promise<BoardSource> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    const known = this.cardsOf(projectId).map(([key]) => cardIdOfKey(projectId, key))
    const existing = this.edgeList(projectId)
    const verdict = validateEdge({ upstream, downstream }, known, existing)
    if (!verdict.ok) {
      throw new RemoteError('canvas/source-invalid', `refused to link ${downstream} ← ${upstream}: ${verdict.reason}`, {
        upstream,
        downstream,
        reason: verdict.reason,
      })
    }
    const id = sourceIdOf(downstream, upstream)
    const record = { project: projectId, downstream, upstream, origin: 'manual' as const }
    await this.sources.put(id, record)
    await this.persist(projectId, signal)
    return { id, downstream, upstream, origin: record.origin }
  }

  /** Remove one edge by storage id. */
  @Remote
  async unlinkSource(projectId: ProjectId, sourceId: SourceId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    const record = this.sources.get(sourceId)
    if (record === undefined || record.project !== projectId) {
      throw new RemoteError('canvas/source-not-found', `no source edge ${sourceId} in ${projectId}`, { projectId, sourceId })
    }
    const removed = await this.sources.delete(sourceId)
    if (removed) await this.persist(projectId, signal)
    return removed
  }

  /** Resolve one card's source chain (F4.7). */
  @Remote
  async getSources(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<SourceChain> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    if (this.cards.get(cardKeyOf(projectId, cardId)) === undefined) throw this.cardNotFound(projectId, cardId)
    const edges = this.edgeList(projectId)
    const { direct, indirect } = transitiveUpstreams(cardId, edges, this.deps.sourceDepth)
    return {
      cardId,
      direct,
      indirect,
      downstream: edges.filter((edge) => edge.upstream === cardId).map((edge) => edge.downstream),
    }
  }

  /**
   * Add the edges artifact evidence implies (F4.5).
   *
   * Only adds, never removes, and only for cards whose artifact actually
   * references a path that resolves to another seated card — a reference the
   * user drew by hand stays even if the artifact stops mentioning it. Returns
   * the edges this pass created, so the caller can announce just the deltas.
   */
  @Remote
  async reconcile(projectId: ProjectId, signal?: AbortSignal): Promise<BoardSource[]> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const entries = this.cardsOf(projectId)
    const known = entries.map(([key]) => cardIdOfKey(projectId, key))
    const knownSet = new Set(known)
    // A reference inside an artifact names a *file*; the board means the card
    // whose artifact that file is. This map is the whole translation.
    const cardOfFile = new Map(entries.map(([key, record]) => [fileOf(record, cardIdOfKey(projectId, key)), cardIdOfKey(projectId, key)]))
    const existing = this.edgeList(projectId)
    const addedEdges: Source[] = []
    const added: BoardSource[] = []

    for (const [key, record] of entries) {
      const cardId = cardIdOfKey(projectId, key)
      const file = fileOf(record, cardId)
      const facts = await this.deps.io.facts(project.root, file, signal)
      // 二进制产物（媒体）与目录不参与对账：这一步要读**文本**去找产物里写着哪些引用，
      // 而媒体走文本口读得出来、读出来是替换字符——白读一遍整份字节，还可能把字节里的
      // 偶然片段当成一个路径。形态判据走 `isMediaKind`，不在这里手写名单：这句话原先写的是
      // image / video 两个名字，加音频时漏了它（今天第三次撞这个剧本）。
      if (!facts.present || facts.kind === 'folder' || isMediaKind(facts.kind)) continue
      const extension = file.includes('.') ? (file.split('.').pop() ?? '') : ''
      let text = ''
      try {
        text = (await this.deps.io.readText(project.root, file, signal)).text
      } catch {
        continue
      }
      // A reference is only a candidate once it resolves to a seated card:
      // resolving is relative to the referencing artifact's own directory.
      const base = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : ''
      const referenced = referencedPaths(facts.kind, text, extension)
        .map((raw) => normaliseRelative(base, raw))
        .flatMap((candidate) => {
          const owner = cardOfFile.get(candidate)
          return owner !== undefined && knownSet.has(owner) ? [owner] : []
        })

      for (const edge of reconcileEdges(cardId, referenced, known, [...existing, ...addedEdges])) {
        const id = sourceIdOf(edge.downstream, edge.upstream)
        const record = {
          project: projectId,
          downstream: edge.downstream,
          upstream: edge.upstream,
          origin: 'reconciled' as const,
        }
        await this.sources.put(id, record)
        addedEdges.push({ id, ...record })
        added.push({ id, downstream: edge.downstream, upstream: edge.upstream, origin: 'reconciled' })
      }
    }
    if (added.length > 0) await this.persist(projectId, signal)
    return added
  }

  // ── notes ───────────────────────────────────────────────────────────────

  /** Drop a shared note on the board (F9.3). */
  @Remote
  async createNote(projectId: ProjectId, text: string, position: Point, signal?: AbortSignal): Promise<Note> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    const id: NoteId = `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const note: Note = { id, project: projectId, text, author: 'user', position, createdAt: Date.now() }
    await this.notes.put(id, {
      project: projectId,
      text: note.text,
      author: note.author,
      position,
      createdAt: note.createdAt,
    })
    await this.persist(projectId, signal)
    return note
  }

  /** Remove a note. */
  @Remote
  async removeNote(projectId: ProjectId, noteId: NoteId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    const record = this.notes.get(noteId)
    if (record === undefined || record.project !== projectId) return false
    const removed = await this.notes.delete(noteId)
    if (removed) await this.persist(projectId, signal)
    return removed
  }

  // ── internals ───────────────────────────────────────────────────────────

  /**
   * Replace the global's active-project slot, leaving the rest of the global be.
   *
   * Writing the same value again is skipped: the global is durable, and a board
   * that re-renders — or a seat that re-mounts on the canvas already open —
   * would otherwise spend a write on every paint.
   */
  private async writeActiveProject(projectId: ProjectId | ''): Promise<void> {
    const current = this.deps.domain.global.get()
    if (current.activeProjectId === projectId) return
    await this.deps.domain.global.set({ ...current, activeProjectId: projectId })
  }

  /** The stored project record, or a typed refusal. */
  private requireProjectRecord(projectId: ProjectId): ProjectRecord {
    const record = this.projects.get(projectId)
    if (record === undefined) {
      throw new RemoteError('canvas/project-not-found', `no canvas project ${projectId}`, { projectId })
    }
    return record
  }

  /**
   * 把平铺在项目根上的产物收进按类型命名的子目录（F1.13）。
   *
   * 三层都是**尽力而为**：算计划是纯的（`planFolds`），搬是逐条容错的
   * （`applyFoldPlans`），整件事再包一层 catch——整理目录失败只意味着「还是老样子」，
   * 一张能打开的卡片不该因为在只读部署上画了个板面就报错。失败不缓存，下次画板再试。
   */
  private async foldArtifacts(project: Project, signal?: AbortSignal): Promise<void> {
    const running = this.folded.get(project.id)
    if (running !== undefined) {
      await running
      return
    }
    const task = this.runFold(project, signal).catch((error: unknown) => {
      this.folded.delete(project.id)
      this.ctx.logger(PLUGIN_ID).warn(`canvas ${project.id}: artifacts stay at the project root`, error)
    })
    this.folded.set(project.id, task)
    await task
  }

  private async runFold(project: Project, signal?: AbortSignal): Promise<void> {
    const cards = this.cardsOf(project.id).map(([key, record]) => {
      const id = cardIdOfKey(project.id, key)
      return { id, file: fileOf(record, id), kind: record.kind }
    })
    const plans = planFolds(cards)
    if (!plans.some((plan) => plan.action === 'move')) return

    const outcome = await applyFoldPlans(plans, {
      present: async (path) => (await this.deps.io.presenceOf(project.root, path, signal)) === 'present',
      prepare: async (folder) => this.deps.io.ensureFolder(project.root, folder, signal),
      move: async (from, to) => this.deps.io.renameEntry(project.root, from, to, signal),
      warn: (message, error) => this.ctx.logger(PLUGIN_ID).warn(`canvas ${project.id}: ${message}`, error),
    })
    if (outcome.applied.length === 0) return

    // 一条根条目可能挂着好几张卡（应用目录里的入口页与它的兄弟文件），所以改的是
    // **所有**落在它下面的路径，而不是只改那个「最深」的。
    let changed = false
    for (const [key, record] of this.cardsOf(project.id)) {
      const id = cardIdOfKey(project.id, key)
      const current = fileOf(record, id)
      const next = foldedPathOf(current, outcome.applied)
      if (next === current) continue
      await this.cards.put(key, { ...record, file: next })
      changed = true
    }
    if (changed) await this.persist(project.id, signal)
  }

  /**
   * 把这张画布的板面写回目录里的投影（F1.10）。
   *
   * 每个改动板面的方法在**写完存储域之后**调它一次，顺序不能反：存储域是真源，投影可以
   * 慢一拍、也可以整体失败（目录只读、沙箱拦下、盘满了），但绝不能因为投影没写成就让
   * 用户的一次拖拽失败——那种失败会把「本机没问题」的状态报成错误。
   */
  private async persist(projectId: ProjectId, signal?: AbortSignal): Promise<void> {
    const record = this.projects.get(projectId)
    if (record === undefined) return
    await this.deps.board.write(this.projectOf(projectId, record), signal)
  }

  /** Whether a path still names a directory this deployment can see. */
  private async rootPresent(root: string, signal?: AbortSignal): Promise<boolean> {
    try {
      return (await this.deps.io.probe(root, '.', signal)).present
    } catch {
      // Unreadable counts as gone: the question this answers is "does another
      // canvas still live there", and a path we cannot look at holds no board
      // we could be stealing the identity from.
      return false
    }
  }

  /** The stored project, projected for the wire. */
  private requireProject(projectId: ProjectId): Project {
    return this.projectOf(projectId, this.requireProjectRecord(projectId))
  }

  private projectOf(id: ProjectId, record: ProjectRecord): Project {
    return {
      id,
      name: record.name,
      root: record.root,
      viewport: record.viewport,
      style: record.style,
      createdAt: record.createdAt,
    }
  }

  private cardsOf(projectId: ProjectId): [string, CardRecord][] {
    return [...this.cards.entries()].filter(([, record]) => record.project === projectId)
  }

  /** Every stored edge of a project, shaped as the pure layer expects. */
  private edgeList(projectId: ProjectId): Source[] {
    return [...this.sources.entries()]
      .filter(([, record]) => record.project === projectId)
      .map(([id, record]) => ({ id, ...record }))
  }

  private sourcesOf(projectId: ProjectId): BoardSource[] {
    return this.edgeList(projectId).map((source) => ({
      id: source.id,
      downstream: source.downstream,
      upstream: source.upstream,
      origin: source.origin,
    }))
  }

  private cardNotFound(projectId: ProjectId, cardId: CardId): RemoteError<'canvas/card-not-found'> {
    return new RemoteError('canvas/card-not-found', `no card ${cardId} in project ${projectId}`, { projectId, cardId })
  }
}

/**
 * Resolve a reference found inside `base`'s artifact to a project-relative
 * card id, collapsing `.`/`..` segments.
 *
 * Kept local rather than shared: it exists so the reconciliation pass can turn
 * what an artifact *says* into what the board *means*, and nothing else in the
 * plugin needs that translation. A reference that escapes the project root is
 * simply not a seated card, so the traversal is clamped rather than rejected.
 */
function normaliseRelative(base: string, reference: string): string {
  const segments = reference.startsWith('/') ? [] : base.split('/').filter((part) => part !== '')
  for (const part of reference.replace(/^\/+/, '').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  return segments.join('/')
}
