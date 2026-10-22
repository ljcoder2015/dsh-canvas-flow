/**
 * dsh-canvas — `card` Remote service: artifact digests, writes, injection, export.
 *
 * Every method here answers for *one named card*, passed in by the caller. The
 * agent-facing tools are different: they resolve the card from the calling
 * agent instead (see `tools.ts`), which is what makes card isolation structural
 * rather than a prompt convention.
 *
 * Session creation goes through the agent lifecycle, never
 * `ctx.sessions.create()` — see `core/session-manager.ts` for why that
 * distinction is the difference between a durable conversation and one that
 * vanishes with the plugin fiber.
 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ArtifactView,
  BoardCard,
  BundleView,
  CardId,
  CardSummary,
  ExportFormat,
  GenerationResult,
  LastPrompt,
  PendingIntent,
  Point,
  Project,
  ProjectId,
  ReferencedFiles,
  SessionBinding,
  UpstreamPolicy,
  WriteResult,
} from '../../types.ts'
import type { CanvasDomain } from '../../domain.ts'
import type { CanvasCapabilities } from '../../capabilities.ts'
import type { ArtifactIo } from '../../core/artifact/io/artifact-io.ts'
import { missingOf } from '../../core/artifact/io/artifact-io.ts'
import { cardFileOf, cardIdOfKey, cardKeyOf, SessionManager, type CardSession } from '../../core/session/session-manager.ts'
import { mintCardId, slugify } from '../../core/canvas/card/ids.ts'
import { cardPreset, composeCardAgent } from '../../core/session/agent-preset.ts'
import { lastUserPromptOfEvents, sessionQueryFace } from '../../core/session/session-log.ts'
import type { ModelRouting } from '../../core/session/model-routing.ts'
import { kindById, detectKind, kindLabel, kindSupportsExport } from '../../core/artifact/kind/kind-registry.ts'
import {
  injectionMessage,
  installCardScope,
  PLUGIN_ID,
  referenceMessage,
  renderMaterial,
  upstreamChangedMessage,
  userPromptMessage,
} from '../prompt.ts'
import { attachCanvasSession } from '../../core/canvas/project/workspace.ts'
import { planCleanup, type CleanupCandidate } from '../../core/canvas/project/cleanup.ts'
import {
  basenameOf,
  cardNameOf,
  extensionOf,
  renameStep,
  RENAME_REFUSAL_TEXT,
  settleRename,
  storedNameOf,
} from '../../core/canvas/card/card-name.ts'
import { IMPORT_MAX_BYTES, IMPORT_REFUSAL_TEXT, importPlanOf, type ImportRefusal } from '../../core/canvas/project/import-plan.ts'
import { aspectSlotOf, mediaSlotOf } from '../../core/canvas/card/card-fields.ts'
import { artifactFolderPathOf, artifactPathOf } from '../../core/canvas/project/artifact-folders.ts'
import { materialUpstreams } from '../../core/canvas/board/source-store.ts'
import type { BoardFile } from './board-file.ts'
import { nameFileReferences, nameWithoutProbe, type FileReferenceTarget } from '../../core/artifact/prompt/file-reference.ts'
import { containersOf, designNodeToJson, scaffoldDesignDocument, DESIGN_FILE_VERSION } from '../../core/artifact/design/document.ts'
import { applyDesignOps, type DesignOpInput } from '../../core/artifact/design/ops.ts'
import type { DesignDocumentWire } from '../../contract.ts'
import { TOOL_NAMES } from '../../contract.ts'

/** What {@link CardRuntime} needs from the plugin's composition root. */
export interface CardRuntimeDeps {
  domain: CanvasDomain
  io: ArtifactIo
  sessions: SessionManager
  /** The board's portable projection in the bound folder (F1.9/F1.10). */
  board: BoardFile
  /** Character budget of one artifact digest. */
  summaryBudget: number
  /** What happens to a downstream card's session when this card's artifact changes (F5.7). */
  upstreamPolicy: UpstreamPolicy
  /**
   * The deployment's model policy, borrowed by every card conversation this
   * runtime opens. See `core/model-routing.ts` for why a card session needs it
   * supplied rather than inherited.
   */
  routing: ModelRouting
  /** Deployment-provided export / publish / image generation, when present. */
  capabilities?: CanvasCapabilities | undefined
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

/**
 * The artifact path a card record names.
 *
 * Records written before the id/path split have no `file` and a path-shaped
 * id — reading their file as the id is exactly the old behavior, so the split
 * needs no migration.
 */
const fileOf = cardFileOf

/** Mint an id for a card's brand-new conversation. */
function mintSessionId(projectId: ProjectId, cardId: CardId): SessionId {
  const nonce = Math.random().toString(36).slice(2, 8)
  return SessionId(`cv-${Date.now().toString(36)}-${nonce}-${projectId.length}${cardId.length}`)
}

/**
 * 一段 base64 解成字节。
 *
 * 两种写法都收：纯 base64，和 `data:<mime>;base64,…` 那种整串。浏览器那边给的是前一种
 * （它先剥掉了前缀），但收后一种不花一分钱，却能让「把 data URL 直接递进来」这个很容易
 * 犯的错变成一次正常的导入，而不是一个写成 `data:iVBOR…` 的怪文件。
 *
 * **格式不对就报**。`Buffer.from(x, 'base64')` 是宽容的：它会把不认识的字符悄悄丢掉，
 * 于是「传错了一个字符串」会得到一堆看起来正常的字节和一个打不开的文件。这里先按 base64
 * 的形状验一遍，不合法就当作协议错误抛出去。
 */
function decodeBase64(content: string): Uint8Array {
  const trimmed = content.trim()
  if (trimmed === '') return new Uint8Array(0)
  const comma = trimmed.indexOf(',')
  const body = trimmed.startsWith('data:') && comma !== -1 ? trimmed.slice(comma + 1) : trimmed
  if (!/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(body) || body.replace(/[\r\n]/g, '').length % 4 !== 0) {
    throw new RemoteError('card/import-malformed', '导入的内容不是一段合法的 base64', {
      length: body.length,
    })
  }
  return new Uint8Array(Buffer.from(body, 'base64'))
}

/**
 * 一个文件名按扩展名该算哪种形态。
 *
 * 用 `detectKind` 而不是自己写一张扩展名表——形态判定的真源只有那一处（`kind-registry`，
 * 它自己也是按扩展名判的前半段）。`head` 给空串：这里没有读过产物，而文件的形态在
 * `detectKind` 里本来就看扩展名。
 */
function kindOfFile(file: string): string {
  const basename = basenameOf(file).toLowerCase()
  return detectKind({
    path: file,
    directory: false,
    basename,
    extension: extensionOf(basename).replace(/^\./, ''),
    head: '',
    children: [],
  })
}

/**
 * Whether a resume failed because the log's single-writer lease is held.
 *
 * Matched by `name`, not `instanceof`: the class belongs to the persistence
 * backend's own bundle, and across a bundle boundary `instanceof` is silently
 * false — the same reason `FsError` is matched by its code prefix.
 */
function isAlreadyOwned(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'SessionAlreadyOwnedError'
}

/**
 * 三条生成能力全都没有时，各自那句诚实的回答。
 *
 * 这**不是**「本插件没实现」的意思：装配时插件那份默认实现会补上缺的那几条
 * （`src/index.ts`），所以这三句真正会在的场合只有两种——一个刻意关掉了它的部署，以及
 * 构造 `CardRuntime` 时就没给能力的单测。写成三句不一样的话，是因为「哪条能力缺席」
 * 正是要报出来的那件事：三条都回同一句，用户就不知道补哪一条。
 */
const UNSUPPORTED_IMAGE = '部署未提供生图能力（服务键 dsh-canvas.capabilities）'
const UNSUPPORTED_VIDEO = '部署未提供生视频能力（服务键 dsh-canvas.capabilities）'
const UNSUPPORTED_AUDIO = '部署未提供生音频能力（服务键 dsh-canvas.capabilities）'

export class CardRuntime extends TypertRemoteService {
  constructor(ctx: Context, private readonly deps: CardRuntimeDeps) {
    super(ctx, 'card')
  }

  /**
   * Agents whose card scope this runtime has already installed.
   *
   * Only adopted agents are marked: they are published before the card sees
   * them, so the scope cannot ride the factory's `setup`. See {@link openSession}.
   */
  private readonly scopedAgents = new WeakSet<Context>()

  private get cards() {
    return this.deps.domain.table('cards')
  }

  private get projects() {
    return this.deps.domain.table('projects')
  }

  private get sources() {
    return this.deps.domain.table('sources')
  }

  private get intents() {
    return this.deps.domain.table('intents')
  }

  /** The seated cards of one project, in storage order. */
  private cardsOf(projectId: ProjectId): [string, CardRecord][] {
    return [...this.cards.entries()].filter(([, record]) => record.project === projectId)
  }

  // ── seating ─────────────────────────────────────────────────────────────

  /**
   * Seat a new card on the board. Its artifact may be created later.
   *
   * The caller names the *file* the card binds (`file`, relative to the
   * project root); the card's id is minted here as six random letters, so a
   * file may be renamed without ever changing the seat's identity.
   */
  @Remote
  async createCard(
    projectId: ProjectId,
    file: string,
    kind: string,
    position: Point,
    signal?: AbortSignal,
  ): Promise<BoardCard> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const cardId = mintCardId(this.cardsOf(projectId).map(([key]) => cardIdOfKey(projectId, key)))
    const key = cardKeyOf(projectId, cardId)
    const facts = await this.deps.io.facts(project.root, file, signal)
    const resolved = facts.present ? facts.kind : kind
    await this.cards.put(key, {
      project: projectId,
      kind: resolved,
      position,
      sessionId: '',
      updatedAt: Date.now(),
      file,
      // A seat is allowed to precede its artifact (F1.11): remember which
      // seats were born that way, so "missing" can later mean *gone* rather
      // than *not written yet*.
      seatedEmpty: !facts.present,
    })
    await this.persist(projectId, project, signal)
    return {
      id: cardId,
      file,
      name: cardNameOf({ file, kind: resolved }),
      project: projectId,
      kind: resolved,
      kindLabel: kindLabel(resolved),
      position,
      sessionId: '',
      // Never missing: the file is either there, or the seat has just recorded
      // that it was born without one.
      missing: false,
    }
  }

  /**
   * 给卡片起个名字（F1.12）。
   *
   * 名字有两处：**记录上的 `name`**（用户自己起的，与产物推出来的默认名不一致时才写）
   * 与**磁盘上那一项**（文件的改文件、目录的改目录——判据在 `core/canvas/card-name.ts`：
   * 应用（app）的产物是「一个目录带 index.html」，所以改的是那个目录，入口页跟着搬）。
   *
   * 三条次序上的规矩：
   *
   * 1. **撞名从 `-2` 起往下试**，判据在磁盘上而不是板上——与建卡、脚手架同一个规矩，且
   *    一张已经不在板上的旧卡留下的文件同样算占位（它确实还占着那个名字）。
   * 2. **先动磁盘、后写记录。** 反过来会留下一条指向不存在路径的记录；磁盘失败时板面
   *    原样不动，用户看到的就是一次没发生过的改名。
   * 3. **源不存在就不搬，只改绑定。** 产物确实丢了的卡片（F3.5）与还没写过产物的空座位
   *    都不是异常状态：改名把它们指到新路径上，会话与引用关系一个字都不动。
   *
   * 形态不重新判定：改名不是改形态——`.md` 还是 markdown、`myapp/index.html` 挪进
   * `市场分析/` 之后还是 webapp。真去探一次反而会在产物缺失时把形态错读成兜底的
   * `file`。
   */
  @Remote
  async renameCard(projectId: ProjectId, cardId: CardId, name: string, signal?: AbortSignal): Promise<BoardCard> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    const file = fileOf(record, cardId)

    const plan = await settleRename({
      file,
      kind: record.kind,
      name,
      // 撞名的判据在磁盘上（与建卡、脚手架同一条），板上一张已经拿掉的旧卡留下的文件
      // 同样算占位——它确实还占着那个名字。
      taken: async (candidate) => (await this.deps.io.presenceOf(project.root, candidate, signal)) === 'present',
    })
    if (plan.kind === 'refused') {
      throw new RemoteError('card/rename-refused', `卡片改名被拒：${RENAME_REFUSAL_TEXT[plan.reason]}`, {
        cardId,
        name,
        reason: plan.reason,
      })
    }

    const step = renameStep({
      plan,
      // The source may be gone: a ghost card (F3.5) or a seat that has not been
      // written yet (F1.11). Either way the rename is a re-point, not an error.
      sourcePresent: (await this.deps.io.presenceOf(project.root, plan.from, signal)) === 'present',
    })
    if (step.kind === 'move') await this.deps.io.renameEntry(project.root, step.from, step.to, signal)

    const stored = storedNameOf({ file: step.file, kind: record.kind, name })
    await this.cards.put(cardKeyOf(projectId, cardId), {
      ...record,
      file: step.file,
      name: stored,
      updatedAt: Date.now(),
    })
    await this.persist(projectId, project, signal)

    const presence = await this.deps.io.presenceOf(project.root, step.file, signal)
    return {
      id: cardId,
      file: step.file,
      name: cardNameOf({ file: step.file, kind: record.kind, name: stored }),
      project: projectId,
      kind: record.kind,
      kindLabel: kindLabel(record.kind),
      position: record.position,
      sessionId: record.sessionId,
      missing: missingOf(presence, record.seatedEmpty),
      ...mediaSlotOf(record),
    }
  }

  /**
   * 记下这张卡**由哪个模型生成**（F2.7）。
   *
   * 与 `renameCard` 是同一类事：改的是卡片记录上的一个字段，回报的是改完之后的卡。
   * 三条规矩：
   *
   * 1. **空串 = 回到「自动」**，字段直接删掉而不是存一个空串。这是「派生默认 + 只存差异」
   *    那条纪律的落法：没选过与选了「自动」在记录里是同一种状态，将来读的人不必判两种。
   * 2. **不校验这个模型还在不在配置里**。配置是别人的（DSH 模型设置），此刻在、下一次
   *    打开画布可能就没了；在这张卡上拒绝一次写入，只会让用户看见一个按不动的选项，而
   *    真正的答案应该在**生成的时候**说（`missingModelReason` 那句）。
   * 3. **不改会话**。这张卡用哪个模型说话归会话自己，两者共用一个字段就会退回到
   *    「给视频卡选了生成模型，会话跟着换，下一次请求 400」那件事。
   */
  @Remote
  async setMediaModel(
    projectId: ProjectId,
    cardId: CardId,
    model: string,
    signal?: AbortSignal,
  ): Promise<BoardCard> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    const trimmed = model.trim()
    const next = { ...record, updatedAt: Date.now() }
    if (trimmed === '') delete next.mediaModel
    else next.mediaModel = trimmed
    await this.cards.put(cardKeyOf(projectId, cardId), next)
    await this.persist(projectId, project, signal)

    const file = fileOf(record, cardId)
    const presence = await this.deps.io.presenceOf(project.root, file, signal)
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
      // 回的是**改完之后**的那一份：写空串时 `next` 上已经没有这个字段，所以这里
      // 直接展开它，而不是展开旧记录再补一次。
      ...mediaSlotOf(next),
      ...aspectSlotOf(next),
    }
  }

  /**
   * 记下产物真实的宽高比（F3.11）。
   *
   * 调用方是卡面自己：媒体产物一加载完，浏览器已经把宽高解出来了（`naturalWidth` ／
   * `videoWidth`）。宿主在这里只做三件事——归一、写记录、把改完的卡片回过去。**不读
   * 产物、不校验它「像不像一张图」**：那是调用方刚亲眼解码过的东西，宿主再猜一遍只会
   * 多出一个会漂移的答案。
   *
   * 归一是指四舍五入到 4 位：这条记录会写进板面文件，`1.7777777777777777` 那种尾巴
   * 除了让 diff 变脏没有别的作用；而 0.0001 的比例误差在一张 400 宽的卡上不到 0.05px。
   */
  @Remote
  async setAspect(projectId: ProjectId, cardId: CardId, aspect: number, signal?: AbortSignal): Promise<BoardCard> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    const next: CardRecord = { ...record, updatedAt: Date.now(), aspect: Math.round(aspect * 10_000) / 10_000 }
    await this.cards.put(cardKeyOf(projectId, cardId), next)
    await this.persist(projectId, project, signal)

    const file = fileOf(record, cardId)
    const presence = await this.deps.io.presenceOf(project.root, file, signal)
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
      ...mediaSlotOf(next),
      ...aspectSlotOf(next),
    }
  }

  /**
   * 把用户本地选中的一个文件**导入成这张卡的产物**（F2.7，v1.81）。
   *
   * 用户原话：「卡片操作栏添加导入功能，可以上传本地的图片和视频当做产物」。
   *
   * 五步，每一步都有一条踩过的坑：
   *
   * 1. **先排定路径，再落字节**（`core/canvas/import-plan.ts`）。文件名清洗、扩展名是不是
   *    媒体、撞名怎么加序号，全在那个纯模块里；这里只把「磁盘上有没有这个东西」递进去
   *    （`taken`）——板面不参与判撞名：一张已经拿掉的旧卡留下的文件同样占着那个名字。
   * 2. **字节走 `ArtifactIo.writeBytes`**，不走 `writeText`。后者把内容当 UTF-8 发布，
   *    一张 PNG 从那儿过去不报错，只写出一个打不开的文件。
   * 3. **形态按新文件名重判**（`detectKind`）。一张图片卡导进一段视频，这张卡的产物就是
   *    视频了——形态从来由产物决定（`createCard` 也是这么判的），不该让旧 kind 挂在记录上
   *    与卡面各说各话。
   * 4. **比例作废**。`aspect` 是「这张卡的产物多宽多高」，产物换了还留着旧数，卡片会先按
   *    旧比例坐一次，等浏览器量完再跳一下。删掉＝回到默认 16:9，下一次加载就量新的。
   * 5. **`seatedEmpty` 也清掉**。它是「这个座位生来没有产物」，用来区分「还没写」与
   *    「写过但丢了」；既然现在有产物了，这个豁免继续留着只会让后续的失效判据读错。
   *
   * 旧产物**不删**：导入是「这张卡现在显示这个」，不是「把之前那个文件删了」。文件还在
   * 目录里，用户想留就留；需要的话画布的对账会把它当成一张未落座的文件提出来。
   *
   * @param name - 用户选中的文件名（含扩展名）。路径只取其中的 basename。
   * @param content - 文件的字节，base64 编码（浏览器只能把它整段交过来，本机没有第二条
   *   通道；上限见 `IMPORT_MAX_BYTES`）。
   */
  @Remote
  async importArtifact(
    projectId: ProjectId,
    cardId: CardId,
    name: string,
    content: string,
    signal?: AbortSignal,
  ): Promise<BoardCard> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    const current = fileOf(record, cardId)

    /**
     * 拒一次导入：理由只有一份（纯模块那个枚举），措辞也同一句。
     *
     * 类型标成 `never` 不是装饰：TS 只把**带显式类型标注的 const 箭头函数**当成
     * 控制流终点，于是下面 `plan.kind === 'refused'` 那一支才真的被排除掉——否则后面对
     * `plan.file` 的每一次读都会报「可能没有这个属性」。
     */
    const refuse: (reason: ImportRefusal) => never = (reason) => {
      throw new RemoteError('card/import-refused', `导入被拒：${IMPORT_REFUSAL_TEXT[reason]}`, {
        cardId,
        name,
        reason,
      })
    }

    // 超限先按 base64 的**长度**判：解一遍再拒，等于先把那几十兆分配出来。4/3 是编码
    // 膨胀比，多给几个字节的余量（前缀、换行）。
    if (content.length > Math.ceil(IMPORT_MAX_BYTES / 3) * 4 + 8) refuse('too-large')

    const bytes = decodeBase64(content)
    const plan = await importPlanOf({
      name,
      size: bytes.byteLength,
      current,
      taken: async (candidate) => (await this.deps.io.presenceOf(project.root, candidate, signal)) === 'present',
    })
    if (plan.kind === 'refused') refuse(plan.reason)

    await this.deps.io.writeBytes(project.root, plan.file, bytes, signal)

    const next: CardRecord = {
      ...record,
      file: plan.file,
      kind: kindOfFile(plan.file),
      updatedAt: Date.now(),
    }
    // 「派生默认 + 只存差异」：这两个字段表示的推断都不再成立，就删掉而不是写一个假值。
    delete next.aspect
    delete next.seatedEmpty
    await this.cards.put(cardKeyOf(projectId, cardId), next)
    await this.persist(projectId, project, signal)

    const presence = await this.deps.io.presenceOf(project.root, plan.file, signal)
    return {
      id: cardId,
      file: plan.file,
      name: cardNameOf({ file: plan.file, kind: next.kind, name: record.name }),
      project: projectId,
      kind: next.kind,
      kindLabel: kindLabel(next.kind),
      position: record.position,
      sessionId: record.sessionId,
      missing: missingOf(presence, undefined),
      ...mediaSlotOf(next),
      ...aspectSlotOf(next),
    }
  }

  /** Unseat a card. The artifact on disk is never deleted (F1.2). */
  @Remote
  async removeCard(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const key = cardKeyOf(projectId, cardId)
    if (this.cards.get(key) === undefined) return false
    await this.unseat(projectId, cardId)
    await this.persist(projectId, project, signal)
    return true
  }

  /**
   * Unseat every card whose artifact is provably gone (F1.11).
   *
   * A card outlives its file by design — a seated card may have no artifact yet,
   * and a missing one is a real board state (F3.5) rather than a broken record —
   * so nothing here is automatic and nothing here guesses. Three refusals are
   * what separate "clear the ghosts" from "empty the board":
   *
   * 1. **The folder itself must be there.** If the project root cannot be
   *    probed, every card would look absent and one call would unseat the whole
   *    board. That the root is really gone, and that its path no longer
   *    resolves, are indistinguishable from here — so the honest answer is to
   *    refuse and let `removeProject` be the way to empty a canvas.
   * 2. **Only proven absence counts.** A card whose id will not resolve, or
   *    whose `stat` the sandbox or the permissions refused, reads as `unknown`
   *    and is left where it is (`planCleanup`): a cleanup may not act on a
   *    probe that failed to answer.
   * 3. **Empty seats stay.** A card seated before its artifact exists — seeded a
   *    moment later, waiting for a generation run, or seated by an Agent for
   *    what it is about to write — is not a ghost. Removing it would take its
   *    conversation binding and its edges with it, so it is only ever removable
   *    one at a time, by the user naming it (`removeCard`).
   *
   * Nothing here deletes an artifact.
   *
   * @returns how many cards left the board.
   */
  @Remote
  async removeMissingCards(projectId: ProjectId, signal?: AbortSignal): Promise<number> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    if ((await this.deps.io.presenceOf(project.root, '.', signal)) !== 'present') {
      throw new RemoteError(
        'canvas/root-unavailable',
        `the canvas folder cannot be read right now, so no card can be called missing: ${project.root}`,
        { projectId, root: project.root },
      )
    }

    const candidates: CleanupCandidate[] = []
    for (const [key, record] of this.cardsOf(projectId)) {
      const cardId = cardIdOfKey(projectId, key)
      candidates.push({
        id: cardId,
        presence: await this.deps.io.presenceOf(project.root, fileOf(record, cardId), signal),
        empty: record.seatedEmpty === true,
      })
    }

    const plan = planCleanup(candidates)
    for (const cardId of plan.remove) await this.unseat(projectId, cardId)
    if (plan.unknown.length > 0) {
      // Not silently: a count that promises more than it removes is only honest
      // if the cards it skipped are written down somewhere.
      this.ctx
        .logger(PLUGIN_ID)
        .warn(`${plan.unknown.length} 张卡片的产物查不出来（路径解析不了，或被沙箱/权限拒绝），本次已跳过：${plan.unknown.join(', ')}`)
    }
    if (plan.remove.length > 0) await this.persist(projectId, project, signal)
    return plan.remove.length
  }

  /**
   * Take one card off the board: its conversation, then its edges, then its seat.
   *
   * The order matters at the edges only — a card whose record is gone but whose
   * edges remain would leave lines pointing at nothing, and an edge whose
   * endpoint is not seated is exactly what `validateEdge` refuses later, so a
   * half-done removal would make the leftover lines un-removable through the
   * normal path.
   */
  private async unseat(projectId: ProjectId, cardId: CardId): Promise<void> {
    await this.deps.sessions.release(projectId, cardId)
    for (const [id, record] of [...this.sources.entries()]) {
      if (record.project === projectId && (record.upstream === cardId || record.downstream === cardId)) {
        await this.sources.delete(id)
      }
    }
    await this.cards.delete(cardKeyOf(projectId, cardId))
  }

  /** 把板面写回目录里的投影（F1.10）；失败只记日志，存储域仍是真源。 */
  private async persist(projectId: ProjectId, project: Project, signal?: AbortSignal): Promise<void> {
    await this.deps.board.write(project, signal)
  }

  /**
   * Scaffold a webapp into a fresh folder and seat its entry as a card (应用节点).
   *
   * One call, one folder: `name` is slugged into a directory under the project
   * root, the scaffold (manifest, entry page, shadcn token stylesheet, web
   * components) is written into it, and the entry `index.html` is seated with
   * the kind the manifest's evidence resolves to — `webapp`. Naming collisions
   * are settled here, against the disk rather than the board: a folder that
   * already exists (even one whose card was removed) gets a numeric suffix, so
   * a scaffold never overwrites a file it did not just create.
   */
  @Remote
  async scaffoldWebapp(projectId: ProjectId, name: string, position: Point, signal?: AbortSignal): Promise<BoardCard> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const base = slugify(name)
    // 应用目录落在 `apps/` 下（F1.13）；目录名只从 artifact-folders 取。
    let folder = artifactFolderPathOf('app', base)
    for (let n = 2; await this.deps.io.probe(project.root, folder, signal).then((probe) => probe.present); n += 1) {
      folder = artifactFolderPathOf('app', `${base}-${n}`)
    }
    await this.deps.io.writeScaffold(project.root, folder, name, signal)
    return this.createCard(projectId, `${folder}/index.html`, 'app', position, signal)
  }

  /**
   * Scaffold a design document and seat it as a card (设计节点, F2.6).
   *
   * The webapp scaffold's sibling, for a single file instead of a folder: the
   * name is slugged into `<name>.design` under the project root (numeric
   * suffix on collision, settled against the disk), the file holds one blank
   * 1024×1024 container, and the card is seated on it. The scaffold is a Host
   * call rather than a client-side seed because the artifact is a structured
   * scene-graph snapshot — a text seed cannot produce it, and the model-side
   * tools read and edit the document through the same structured path.
   */
  @Remote
  async scaffoldDesign(projectId: ProjectId, name: string, position: Point, signal?: AbortSignal): Promise<BoardCard> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const base = slugify(name)
    // 设计稿落在 `designs/` 下（F1.13）。
    let filePath = artifactPathOf('design', base, 'design')
    for (let n = 2; await this.deps.io.probe(project.root, filePath, signal).then((probe) => probe.present); n += 1) {
      filePath = artifactPathOf('design', `${base}-${n}`, 'design')
    }
    await this.deps.io.writeDesign(project.root, filePath, scaffoldDesignDocument(), undefined, signal)
    return this.createCard(projectId, filePath, 'design', position, signal)
  }

  /**
   * Read a design document as model-facing JSON (F2.6 — `canvas_design_read`).
   *
   * The whole node list is handed over with its format version, so the model
   * sees the same structure the viewer renders; containers are named by id
   * (the frames of a page, through its regions) and the full layer list follows.
   */
  async readDesign(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<DesignDocumentWire> {
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    const { doc } = await this.deps.io.readDesign(project.root, fileOf(record, cardId), signal)
    return {
      cardId,
      formatVersion: DESIGN_FILE_VERSION,
      containers: containersOf(doc).map((board) => board.id),
      nodes: [...doc.nodes.values()].filter((node) => node.id !== doc.rootId).map(designNodeToJson),
    }
  }

  /**
   * Apply structured edit ops to a design document (F2.6 — `canvas_design_edit`).
   *
   * The version guard is the same freshness contract as {@link editText}: the
   * ops apply to the document the caller read, and a concurrent change is a
   * `card/stale-version` refusal rather than a silent lost update.
   */
  async editDesign(
    projectId: ProjectId,
    cardId: CardId,
    ops: readonly DesignOpInput[],
    signal?: AbortSignal,
  ): Promise<{ cardId: CardId; applied: number; errors: string[]; version: string }> {
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    const { doc, version } = await this.deps.io.readDesign(project.root, fileOf(record, cardId), signal)
    const result = applyDesignOps(doc, ops)
    if (result.errors.length > 0 && result.applied === 0) {
      // Nothing in the batch landed; fail loudly so the model re-reads instead
      // of believing the edit succeeded.
      throw new RemoteError('card/unsupported', `design ops 全部失败：${result.errors.join('；')}`, {
        kind: record.kind,
        operation: 'design-edit',
      })
    }
    const outcome = await this.deps.io.writeDesign(project.root, fileOf(record, cardId), doc, { version }, signal)
    await this.touch(projectId, cardId, record)
    await this.notifyDownstream(project, cardId)
    return { cardId, applied: result.applied, errors: result.errors, version: outcome.version }
  }

  // ── digests ─────────────────────────────────────────────────────────────

  /**
   * Bounded digest of one artifact (F5.2).
   *
   * The IO layer is handed the card's **file**, never its seat id — since
   * v1.49 the two are different things, and an id passed here would be read as
   * a path (`<root>/qkxwvd`), which used to answer "no such artifact" for every
   * card whose id was not itself a path.
   */
  @Remote
  async readSummary(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<CardSummary> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    return this.deps.io.summarize(project.root, fileOf(record, cardId), this.deps.summaryBudget, signal)
  }

  /**
   * The fullscreen view payload of one artifact (F3.8).
   *
   * Where {@link readSummary} bounds its read for a prompt, this one reads the
   * artifact whole within the wire caps — it is what a person opens to *read*.
   * An absent artifact is answered, not failed: a seated card whose file has
   * not been written yet gets its viewer with an absent state.
   */
  @Remote
  async readArtifact(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<ArtifactView> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    const file = fileOf(record, cardId)
    const view = await this.deps.io.view(project.root, file, signal)
    // The IO layer knows the artifact; only the record knows what the card is
    // called (F1.12), so the two deck-side values are stamped on here.
    return {
      ...view,
      cardId,
      file,
      name: cardNameOf({ file, kind: record.kind, name: record.name }),
    }
  }

  /**
   * 一张**应用类**卡片的整份产物，读成浏览器要打包的那个清单（F10.1）。
   *
   * 与 {@link readArtifact}（「这份产物显示成什么」）不同，这一条答的是「这份产物里有什么」：
   * 一个应用要被**完整地**交出去，就得连它的每一个文件一起走。于是分工与它完全一样——
   * IO 层只认识路径，卡片那两个字段（真 id 与显示名）在这里盖上去。
   */
  @Remote
  async readBundle(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<BundleView> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    const file = fileOf(record, cardId)
    const bundle = await this.deps.io.bundle(project.root, file, signal)
    return {
      ...bundle,
      cardId,
      file,
      name: cardNameOf({ file, kind: record.kind, name: record.name }),
    }
  }

  /**
   * Digests of every artifact this card sources from.
   *
   * One hop only — this answer *is* the card's material, and material is what
   * its own edges declare ({@link materialUpstreams} carries the reasoning).
   * The chain further up is a fact about the board, not about this card's
   * inputs: `canvas_get_sources` reports it when the model wants the shape of
   * the graph, and the digest of a grandparent is one `canvas_read_card` away
   * if some instruction really calls for it.
   */
  @Remote
  async readSources(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<CardSummary[]> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    this.requireCard(projectId, cardId)
    const order = materialUpstreams(cardId, this.edgesOf(projectId))
    const summaries: CardSummary[] = []
    for (const upstream of order) {
      const upstreamRecord = this.cards.get(cardKeyOf(projectId, upstream))
      if (upstreamRecord === undefined) continue
      try {
        const summary = await this.deps.io.summarize(
          project.root,
          fileOf(upstreamRecord, upstream),
          this.deps.summaryBudget,
          signal,
        )
        summaries.push({ ...summary, cardId: upstream })
      } catch {
        // A card whose artifact is missing is a real board state (seated, not
        // yet written). It contributes nothing to the material list rather
        // than failing the whole read.
      }
    }
    return summaries
  }

  /**
   * Push one artifact into a card's conversation (F5.3).
   *
   * The injection is durable context, not a turn: `agent.inject` appends to the
   * session without waking an idle agent, so a background material update never
   * spends the user's tokens behind their back.
   *
   * `summary` mode carries the F5.2 digest — path, structure, bounded body —
   * rather than the bare summary text, because the path and the outline are the
   * two things an agent cannot reconstruct from the prose alone.
   */
  @Remote
  async injectCard(
    projectId: ProjectId,
    cardId: CardId,
    sourceCardId: CardId,
    mode: 'summary' | 'full',
    signal?: AbortSignal,
  ): Promise<CardSummary> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    this.requireCard(projectId, cardId)
    this.requireCard(projectId, sourceCardId)
    return this.injectDigest(project, cardId, sourceCardId, mode, this.liveSession(projectId, cardId), signal)
  }

  /**
   * Hand this card's material over as **file references** (F5.3).
   *
   * A source edge (引用) says "this artifact builds on that artifact", and the harness
   * already has a way to say that inside a prompt: an `@` token holding a
   * workspace-relative path. Every card names its artifact by its own `file`
   * — which sits at `<project root>/<file>`, the card session's working
   * directory — so this method names upstream artifacts rather than copying them.
   *
   * Nothing is read here and no content is attached, and that is the point of a
   * reference: the material stays the one file it already is, so it cannot go
   * stale, the model chooses whether it is worth the context, and the plugin
   * escapes the whole class of problems a copy brings — truncation the model
   * cannot see, a digest budget to negotiate, a service to be missing. The
   * convention is not invented here either: `@deepseek-ai/dsh-file-reference-local`
   * installs exactly this grammar whenever the agent has a `read` tool, which
   * every card conversation does.
   *
   * The two channels answer different questions and both are kept. A reference
   * says *where* the material is and leaves reading to the model; a digest puts
   * a bounded summary *in* the context whether or not anyone asks
   * ({@link injectDigest}, `canvas_inject_card`). The answer never blurs them:
   * `files` lists what was named, `skipped` names what the `@file` grammar
   * cannot carry (a quote or a control character in the path), so a board that
   * could not name something says so instead of quietly dropping it.
   *
   * The chain is **not** walked: what gets named is this card's own material,
   * one hop ({@link materialUpstreams}). Naming an ancestor would hand the model
   * files its own upstream already absorbed, and a reference is a claim about
   * what this artifact builds on — the deeper a chain gets, the less true that
   * claim is about any hop past the first.
   */
  @Remote
  async referenceFiles(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<ReferencedFiles> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    this.requireCard(projectId, cardId)
    const session = this.liveSession(projectId, cardId)

    const targets = await this.fileReferenceTargets(project, cardId, signal)
    const { references, skipped } = nameFileReferences(targets)
    // Injected when there is anything to say — including "some of your material
    // could not be named", which a silent return would hide.
    if (references.length > 0 || skipped.length > 0) session.agent.inject(referenceMessage(references, skipped))
    return { cardId, files: references, skipped }
  }

  // ── sessions ────────────────────────────────────────────────────────────

  /**
   * Open — or re-attach to — the card's conversation (F3.1).
   *
   * Created through the agent factory, which is what makes the log durable
   * (§4.5). When the stored binding no longer resolves, a fresh conversation is
   * created rather than the stale one being overwritten: the old log stays on
   * disk, so nothing a user said is destroyed by a read failure.
   *
   * Three ways in, in this order: a session this plugin already holds; the
   * conversation already live under another owner, which is *adopted* — the
   * harness's own session controller resumes a session the user opens in the
   * main chat, and that resume takes the log's single-writer lease, so resuming
   * it here would collide and mint a second conversation behind the user's
   * back; and only then a resume of the stored binding, which is where a log
   * that is genuinely gone becomes a fresh conversation.
   *
   * The agent is composed from the deployment's agent preset before anything
   * else happens, because that composition is where its file tools live: a card
   * conversation writes its artifact with the ordinary `write`/`edit` tools, and
   * on the Web surface those come from the preset rather than the host
   * composition (`core/agent-preset.ts` carries the reasoning). Only then is it
   * created with the deployment's default model and — still before this method
   * returns — told the model its own session already intends, if it has one.
   * Without the model the turn cannot even assemble its prompt; without the
   * selection a choice made before a reload would be silently dropped
   * ({@link align} carries that reasoning).
   */
  @Remote
  async openSession(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<SessionBinding> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const key = cardKeyOf(projectId, cardId)
    const record = this.requireCard(projectId, cardId)

    const live = this.deps.sessions.live(projectId, cardId)
    if (live !== undefined) {
      await this.align(live)
      await this.claim(project, live.sessionId)
      return { cardId, sessionId: live.sessionId, created: false }
    }

    let binding = record.sessionId
    let created = binding === ''

    // An adopted agent is already published, so its card scope is installed
    // here rather than in the factory's `setup`. A conversation that was
    // released while its agent stayed live can be adopted again, and a second
    // registration of the same prompt section would duplicate it — hence the
    // guard, keyed by the agent's own context so the mark dies with the agent.
    if (binding !== '') {
      const sessionId = SessionId(binding)
      const agent = this.ctx.agents.get(sessionId)
      if (agent !== undefined) {
        if (!this.scopedAgents.has(agent.ctx)) {
          this.scopeFor(agent.ctx, project, cardId, fileOf(record, cardId), record.kind)
          this.scopedAgents.add(agent.ctx)
        }
        const adopted = this.deps.sessions.adopt(project.id, cardId, sessionId, agent)
        await this.align(adopted)
        await this.claim(project, adopted.sessionId)
        return { cardId, sessionId: adopted.sessionId, created: false }
      }
    }

    // The preset a card conversation composes from, resolved before anything is
    // created — see `core/agent-preset.ts` for why it is not optional to the
    // card's job. Neither create nor resume carries it in its options: the join
    // is a scope parentage installed by the setup callback, and it is the same
    // join for a resumed conversation as for a fresh one.
    const presetId = await cardPreset(this.ctx)

    const attach = async (ownerCtx: Context, resumeId: SessionId | undefined, fresh: boolean) => {
      const setup = async (agentCtx: Context): Promise<void> => {
        await composeCardAgent(this.ctx, agentCtx, presetId)
        this.scopeFor(agentCtx, project, cardId, fileOf(record, cardId), record.kind)
      }
      const options = this.deps.routing.agentOptions()
      const agentOptions = options === undefined ? {} : { agentOptions: options }
      const meta = presetId === undefined ? { cwd: project.root } : { cwd: project.root, agentPreset: presetId }
      const handle = fresh
        ? await ownerCtx.agents.create({
            sessionId: resumeId ?? mintSessionId(projectId, cardId),
            meta,
            ...agentOptions,
            setup,
          })
        : await ownerCtx.agents.resume({
            resumeSessionId: resumeId as SessionId,
            ...agentOptions,
            setup,
          })
      return { agent: handle.agent, dispose: () => handle.dispose() }
    }

    let opened: Awaited<ReturnType<SessionManager['open']>>
    if (created) {
      opened = await this.deps.sessions.open(projectId, cardId, (ownerCtx) => attach(ownerCtx, undefined, true))
    } else {
      try {
        opened = await this.deps.sessions.open(projectId, cardId, (ownerCtx) =>
          attach(ownerCtx, SessionId(binding), false),
        )
      } catch (error) {
        // A taken write lease is a *transient* conflict, not a missing log:
        // whoever holds it is reading this same conversation right now, so
        // minting a second one would orphan the conversation the user is
        // actually looking at. Refuse instead, and leave the binding alone —
        // the next open finds the agent live and adopts it.
        if (isAlreadyOwned(error)) {
          throw new RemoteError(
            'card/session-busy',
            `card ${cardId}: conversation ${binding} is open in another session`,
            { projectId, cardId, sessionId: binding },
          )
        }
        this.ctx.logger(PLUGIN_ID).warn(
          `card ${cardId}: stored conversation ${binding} could not be resumed, starting a new one`,
          error,
        )
        binding = ''
        created = true
        opened = await this.deps.sessions.open(projectId, cardId, (ownerCtx) => attach(ownerCtx, undefined, true))
      }
    }

    await this.align(opened.session)
    await this.claim(project, opened.session.sessionId)
    if (created || binding !== opened.session.sessionId) {
      await this.cards.put(key, { ...record, sessionId: opened.session.sessionId })
    }
    return { cardId, sessionId: opened.session.sessionId, created: opened.created }
  }

  /**
   * Put this card's conversation under the canvas's Workspace (F1.6).
   *
   * The conversation's own cwd is already the canvas root, so the only thing
   * missing for the sidebar to file it under that folder instead of 未分组 is
   * the Workspace account — `core/workspace.ts` owns both moves. Failure is
   * logged there and never raised: a conversation that cannot be grouped is
   * still a usable conversation, and refusing to open one over a sidebar
   * grouping would trade a real capability for a cosmetic one.
   */
  private async claim(project: { root: string; name: string }, sessionId: string): Promise<void> {
    await attachCanvasSession(this.ctx, { root: project.root, title: project.name }, sessionId)
  }

  /**
   * Hand one live card conversation the model its session intends.
   *
   * A failure here is logged, not raised: the conversation is open and usable on
   * the deployment default, and refusing to open it would turn a model-policy
   * problem into "this card has no conversation". A resumed conversation never
   * needs a second attempt — the selection lives on the session, so the next
   * open reads it back from the projection.
   */
  private async align(session: CardSession): Promise<void> {
    try {
      await this.deps.routing.align(session.agent, session.sessionId)
    } catch (error) {
      this.ctx.logger(PLUGIN_ID).warn(
        `card ${session.cardId}: the session's model selection could not be installed`,
        error,
      )
    }
  }

  /** Release the live conversation. The log and the binding both survive (F3.4). */
  @Remote
  async releaseSession(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    return this.deps.sessions.release(projectId, cardId)
  }

  /**
   * Submit the user's own prompt to a card's conversation (F3.2 — composer).
   *
   * The board's composer is a full conversation entry point, not a mirror of
   * the host's chat surface: this opens (or re-attaches) the session like
   * {@link openSession} does, then hands the text to `agent.followup` — the
   * same admission path the harness's own composer uses. `followup` queues the
   * prompt as the next turn's sole ordinary message, so a prompt typed while
   * the agent is running waits its turn instead of steering or erroring.
   */
  @Remote
  async sendMessage(projectId: ProjectId, cardId: CardId, prompt: string, signal?: AbortSignal): Promise<SessionBinding> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    this.requireCard(projectId, cardId)
    const binding = await this.openSession(projectId, cardId, signal)
    const session = this.deps.sessions.live(projectId, cardId)
    if (session === undefined) {
      throw new RemoteError('card/session-missing', `card ${cardId} has no conversation to receive the prompt`, {
        projectId,
        cardId,
      })
    }
    session.agent.followup(userPromptMessage(prompt))
    return binding
  }

  /**
   * The user's own latest message to this card's session, verbatim (F3.9).
   *
   * This is what an untouched composer shows. Reading it from the *session log*
   * rather than from the browser's live projection is the whole point: the
   * projection only exists for sessions this page has opened, and the composer
   * must answer for a card the user has not opened yet — the common case.
   * Plugin-pushed context (`agent.inject`) rides the same log; the reader
   * distinguishes by message source, so it is never offered back as the user's
   * words.
   */
  @Remote
  async readLastPrompt(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<LastPrompt> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    if (record.sessionId === '') return { text: '', time: 0 }
    // A failure here means the conversation's log is not readable right now
    // (never flushed, storage absent). The composer still works — it just has
    // nothing to seed from — so this read answers "nobody has spoken" instead
    // of failing the selection.
    try {
      const query = sessionQueryFace(this.ctx)
      if (query !== undefined) {
        const read = await query.readSession(record.sessionId)
        return lastUserPromptOfEvents(read.events)
      }
    } catch {
      if (signal?.aborted) throw signal.reason
      return { text: '', time: 0 }
    }
    // No session-query service in this deployment (bare harness): a live
    // session is still readable, and a cold one has nothing to say.
    const live = liveSessionEvents(this.ctx, record.sessionId)
    return live === undefined ? { text: '', time: 0 } : lastUserPromptOfEvents(live)
  }

  // ── writes ──────────────────────────────────────────────────────────────

  /**
   * Replace the whole artifact (F8.1 — double-click, edit, write back).
   *
   * Unguarded on purpose: this is the user's own edit of the file they are
   * looking at, and the canvas has already shown them the content they are
   * replacing. The guarded path is {@link editText}, which is what automation
   * uses.
   */
  @Remote
  async writeText(projectId: ProjectId, cardId: CardId, content: string, signal?: AbortSignal): Promise<WriteResult> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    const outcome = await this.deps.io.write(project.root, fileOf(record, cardId), content, undefined, signal)
    await this.touch(projectId, cardId, record)
    return { cardId, ...outcome }
  }

  /**
   * Replace the artifact only if it still holds the version the caller saw.
   *
   * `version` comes from a previous `WriteResult` or `readSummary`; a mismatch
   * is `card/stale-version` rather than a silent overwrite, which is what keeps
   * a user's concurrent edit and an agent's write from destroying each other
   * (§4.9).
   */
  @Remote
  async editText(
    projectId: ProjectId,
    cardId: CardId,
    content: string,
    version: string,
    signal?: AbortSignal,
  ): Promise<WriteResult> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    const current = await this.deps.io.readText(project.root, fileOf(record, cardId), signal)
    if (String(current.version) !== version) {
      throw new RemoteError(
        'card/stale-version',
        `card ${cardId} changed on disk since it was read`,
        { cardId, expected: version, actual: String(current.version) },
      )
    }
    const outcome = await this.deps.io.write(project.root, fileOf(record, cardId), content, { version: current.version }, signal)
    await this.touch(projectId, cardId, record)
    await this.notifyDownstream(project, cardId)
    return { cardId, ...outcome }
  }

  // ── structured intents (F8.2/F8.4) ───────────────────────────────────────

  /** Queue one structured edit intent for the card's next turn. */
  @Remote
  async queueIntent(
    projectId: ProjectId,
    cardId: CardId,
    kind: PendingIntent['kind'],
    payload: string,
    image: string,
    signal?: AbortSignal,
  ): Promise<PendingIntent[]> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    this.requireCard(projectId, cardId)
    const id = `intent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    await this.intents.put(id, { project: projectId, cardId, kind, payload, image, createdAt: Date.now() })
    return this.readPending(projectId, cardId, signal)
  }

  /** Every intent still queued for one card, oldest first. */
  @Remote
  async readPending(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<PendingIntent[]> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    return [...this.intents.entries()]
      .filter(([, record]) => record.project === projectId && record.cardId === cardId)
      .map(([id, record]) => ({
        id,
        cardId: record.cardId,
        kind: record.kind,
        payload: record.payload,
        image: record.image,
        createdAt: record.createdAt,
      }))
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  /** Drop every queued intent of one card, after they have been consumed. */
  async clearPending(projectId: ProjectId, cardId: CardId): Promise<void> {
    for (const [id, record] of [...this.intents.entries()]) {
      if (record.project === projectId && record.cardId === cardId) await this.intents.delete(id)
    }
  }

  // ── export / publish (F10) ───────────────────────────────────────────────

  /**
   * Render one artifact to another format.
   *
   * The kind decides whether the format is even meaningful (an `.mp4` has no
   * `pptx`), and the deployment decides whether it can be produced at all.
   * Both refusals are reported as a structured result rather than a throw,
   * because "this kind cannot be exported to PDF" is an answer the UI shows,
   * not an error the user should have to interpret.
   */
  @Remote
  async exportCard(
    projectId: ProjectId,
    cardId: CardId,
    format: ExportFormat,
    signal?: AbortSignal,
  ): Promise<{ cardId: CardId; format: string; ok: boolean; path: string; reason: string }> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    return this.runExport(project, cardId, record.kind, format, signal)
  }

  /** Publish one artifact and return its URL (F10.3). */
  @Remote
  async publishCard(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<{ cardId: CardId; format: string; ok: boolean; path: string; reason: string }> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    const definition = kindById(record.kind)
    if (definition?.publishable !== true) {
      return { cardId, format: 'publish', ok: false, path: '', reason: `${record.kind} 形态不支持发布` }
    }
    const publish = this.deps.capabilities?.publish
    if (publish === undefined) {
      return {
        cardId,
        format: 'publish',
        ok: false,
        path: '',
        reason: `部署未提供发布能力（服务键 ${'dsh-canvas.capabilities'}）`,
      }
    }
    try {
      const file = fileOf(record, cardId)
      const result = await publish(
        { project, cardId, kind: record.kind, path: await this.deps.io.displayPathOf(project.root, file, signal), title: file },
        signal,
      )
      return { cardId, format: 'publish', ok: true, path: result.url, reason: '' }
    } catch (error) {
      return { cardId, format: 'publish', ok: false, path: '', reason: describe(error) }
    }
  }

  /**
   * Run one export, shared by the Remote method and the tool layer.
   *
   * Kept public (not `@Remote`) so `tools.ts` can reuse it without going back
   * over the wire — the tool runs in the same process.
   */
  async runExport(
    project: Project,
    cardId: CardId,
    kind: string,
    format: ExportFormat,
    signal?: AbortSignal,
  ): Promise<{ cardId: CardId; format: string; ok: boolean; path: string; reason: string }> {
    if (!kindSupportsExport(kind, format)) {
      const supported = kindById(kind)?.exportFormats ?? []
      return {
        cardId,
        format,
        ok: false,
        path: '',
        reason: supported.length === 0 ? `${kind} 形态不支持导出` : `${kind} 形态不支持导出为 ${format}（支持：${supported.join(' / ')}）`,
      }
    }
    const exporter = this.deps.capabilities?.export
    if (exporter === undefined) {
      return { cardId, format, ok: false, path: '', reason: '部署未提供导出能力（服务键 dsh-canvas.capabilities）' }
    }
    try {
      // 与导出、发布同一条规矩：能力拿到的是**路径**，不是座位 id。
      const record = this.cards.get(cardKeyOf(project.id, cardId))
      const file = record === undefined ? cardId : fileOf(record, cardId)
      const artifact = await this.deps.io.facts(project.root, file, signal)
      if (!artifact.present) {
        throw new RemoteError('card/artifact-absent', `artifact ${cardId} is not on disk`, {
          cardId,
          path: artifact.displayPath,
        })
      }
      const result = await exporter(
        { project, cardId, kind, path: artifact.displayPath, format },
        signal,
      )
      return { cardId, format, ok: true, path: result.path, reason: '' }
    } catch (error) {
      return { cardId, format, ok: false, path: '', reason: describe(error) }
    }
  }

  /**
   * Generate an image artifact for one card (F7.2 / `canvas_generate_image`).
   *
   * Writes into an existing card when the caller names one, so the image lands
   * as material on the board rather than as an orphan file.
   */
  async generateImage(
    project: Project,
    cardId: CardId,
    prompt: string,
    referencePath: string | undefined,
    signal?: AbortSignal,
  ): Promise<GenerationResult> {
    const generate = this.deps.capabilities?.generateImage
    if (generate === undefined) {
      return { cardId, ok: false, path: '', reason: UNSUPPORTED_IMAGE }
    }
    return this.runGeneration(project, cardId, signal, (file, model) =>
      generate({ project, file, prompt, referencePath, ...(model === undefined ? {} : { model }) }, signal),
    )
  }

  /**
   * Generate a video artifact for one card (F2.7 / `canvas_generate_video`).
   *
   * 与生图那条**只差两件事**：调的是另一条能力，以及参数是一组可选值而不是一个 prompt。
   * 其余（找卡片的文件、生成后重读形态、失败变成一句 `reason` 而不是异常）完全共用
   * {@link runGeneration}——那三件事是「一次生成落进一张卡」这件事的全部内容，抄三遍等于
   * 给自己留三份会各自漂移的实现。
   */
  async generateVideo(
    project: Project,
    cardId: CardId,
    options: {
      prompt: string
      ratio?: string
      duration?: number
      resolution?: string
      referencePath?: string
      referenceRole?: string
    },
    signal?: AbortSignal,
  ): Promise<GenerationResult> {
    const generate = this.deps.capabilities?.generateVideo
    if (generate === undefined) {
      return { cardId, ok: false, path: '', reason: UNSUPPORTED_VIDEO }
    }
    return this.runGeneration(project, cardId, signal, (file, model) =>
      generate({ project, file, ...options, ...(model === undefined ? {} : { model }) }, signal),
    )
  }

  /**
   * Generate an audio artifact for one card (F2.7 / `canvas_generate_audio`).
   *
   * 与生视频**同一个形状**：一个 prompt，交给模型。音频不是「念稿工具」——`seed-audio`
   * 那一族收的是一条导演指令，多角色对白、音效、配乐都能写在一条里。
   */
  async generateAudio(
    project: Project,
    cardId: CardId,
    options: { prompt: string },
    signal?: AbortSignal,
  ): Promise<GenerationResult> {
    const generate = this.deps.capabilities?.generateAudio
    if (generate === undefined) {
      return { cardId, ok: false, path: '', reason: UNSUPPORTED_AUDIO }
    }
    return this.runGeneration(project, cardId, signal, (file, model) =>
      generate({ project, file, ...options, ...(model === undefined ? {} : { model }) }, signal),
    )
  }

  /**
   * 「一次生成落进一张卡」的那条共同路径。
   *
   * 三件事，三件都不能漏：
   *
   * 1. **能力拿到的是路径，不是座位 id**（v1.57 那条判据）。座位 id 是 6 位随机串，
   *    拿它当路径会让产物落在项目根下叫 `m4k2p1` 的游离文件里——正是 v1.57 修掉的那个
   *    指纹（见 `tests/host/card-paths.spec.ts`）。
   * 2. **生成完重读一次形态**。坐空位的媒体卡在生成之前没有文件、kind 是调用方声明的；
   *    生成之后磁盘上真的出现了 `png`，形态该由**证据**重新认定。不重读的后果是那张卡
   *    的记录停在「还没有产物」上，而预览器按 kind 选——用户会看到一张打不开的卡。
   * 3. **失败是一份答案，不是异常**。宿主那句 `ok:false` 必须原样变成 `reason` 带出去：
   *    画布那边只接异常，把失败抛出去等于按钮点了什么都不发生（这一类已经在导出线上
   *    修过两次）。
   * 4. **这张卡选定的生成模型要传下去**。`mediaModel` 是卡片记录上的一个字段（席位写进去
   *    的），能力接口靠它决定「从哪条路线、用哪个模型」；不传就等于用户在卡片上选的那个
   *    模型从来没生效——而那正是这一版要修的语义（用户原话：「图片和视频模型的选择，
   *    只是选择图片模型和视频模型」）。
   */
  private async runGeneration(
    project: Project,
    cardId: CardId,
    signal: AbortSignal | undefined,
    produce: (file: string, model: string | undefined) => Promise<{ path: string }>,
  ): Promise<GenerationResult> {
    try {
      const record = this.cards.get(cardKeyOf(project.id, cardId))
      const file = record === undefined ? cardId : fileOf(record, cardId)
      const result = await produce(file, record?.mediaModel)
      if (record !== undefined) {
        const facts = await this.deps.io.facts(project.root, file, signal)
        await this.cards.put(cardKeyOf(project.id, cardId), { ...record, kind: facts.kind, updatedAt: Date.now() })
      }
      return { cardId, ok: true, path: result.path, reason: '' }
    } catch (error) {
      return { cardId, ok: false, path: '', reason: describe(error) }
    }
  }

  // ── internals ───────────────────────────────────────────────────────────

  /** The card's live conversation, or the refusal every injection path shares. */
  private liveSession(projectId: ProjectId, cardId: CardId): CardSession {
    const session = this.deps.sessions.live(projectId, cardId)
    if (session === undefined) {
      throw new RemoteError('card/session-missing', `card ${cardId} has no open conversation to inject into`, {
        projectId,
        cardId,
      })
    }
    return session
  }

  /** Read one upstream artifact and hand it over as durable context (F5.2). */
  private async injectDigest(
    project: Project,
    cardId: CardId,
    sourceCardId: CardId,
    mode: 'summary' | 'full',
    session: CardSession,
    signal?: AbortSignal,
  ): Promise<CardSummary> {
    const sourceRecord = this.cards.get(cardKeyOf(project.id, sourceCardId))
    const sourceFile = sourceRecord === undefined ? sourceCardId : fileOf(sourceRecord, sourceCardId)
    const summary = await this.deps.io.summarize(project.root, sourceFile, this.deps.summaryBudget, signal)
    const body =
      mode === 'full'
        ? (await this.deps.io.readText(project.root, sourceFile, signal)).text.slice(0, 200_000)
        : renderMaterial([summary])
    session.agent.inject(injectionMessage(summary, mode, body))
    return { ...summary, cardId: sourceCardId }
  }

  /**
   * The upstream artifacts of one card, as reference targets.
   *
   * One hop, by {@link materialUpstreams}: the files named here are the ones
   * this artifact is declared to build on, and nothing beyond them.
   *
   * Each upstream is *probed* rather than assumed: whether it is a directory
   * decides the mention's shape (a directory keeps a trailing slash), and a card
   * that is seated but has not been written yet is a real board state worth
   * naming with `present: false` instead of hiding — the model can see that the
   * material is not there yet, which is different from the board forgetting to
   * mention it.
   */
  private async fileReferenceTargets(
    project: Project,
    cardId: CardId,
    signal?: AbortSignal,
  ): Promise<FileReferenceTarget[]> {
    const targets: FileReferenceTarget[] = []
    for (const upstream of materialUpstreams(cardId, this.edgesOf(project.id))) {
      const record = this.cards.get(cardKeyOf(project.id, upstream))
      const kind = record?.kind ?? 'text'
      // The mention must name the *file* the model's own `read` resolves — the
      // card's artifact path, not the seat id.
      const path = record === undefined ? upstream : fileOf(record, upstream)
      let directory = false
      let present = false
      let bytes = 0
      try {
        const probe = await this.deps.io.probe(project.root, path, signal)
        directory = probe.directory
        present = probe.present
        bytes = probe.bytes
      } catch (error) {
        if (signal?.aborted === true) throw signal.reason
        this.ctx.logger(PLUGIN_ID).debug(`card ${cardId}: cannot probe upstream ${upstream}`, error)
      }
      targets.push({ cardId: upstream, path, directory, kind, kindLabel: kindLabel(kind), present, bytes })
    }
    return targets
  }

  /**
   * Tell every open downstream conversation that its material changed (F5.7).
   *
   * Only *live* sessions are told, and only by injection: a closed card has no
   * context to become stale, and an idle one must not be woken by a background
   * write. `notify` reports the change; `pull` also carries the fresh digest, so
   * a downstream card does not have to spend a tool call rediscovering it.
   */
  private async notifyDownstream(project: Project, cardId: CardId): Promise<void> {
    if (this.deps.upstreamPolicy === 'silent') return
    const downstreams = this.edgesOf(project.id)
      .filter((edge) => edge.upstream === cardId)
      .map((edge) => edge.downstream)

    for (const downstream of downstreams) {
      const session = this.deps.sessions.live(project.id, downstream)
      if (session === undefined) continue
      let digest = ''
      if (this.deps.upstreamPolicy === 'pull') {
        try {
          const record = this.cards.get(cardKeyOf(project.id, cardId))
          const file = record === undefined ? cardId : fileOf(record, cardId)
          digest = (await this.deps.io.summarize(project.root, file, this.deps.summaryBudget)).summary
        } catch {
          // A digest that cannot be produced still leaves a useful notice.
          digest = ''
        }
      }
      session.agent.inject(upstreamChangedMessage(cardId, downstream, digest))
    }
  }

  /** Compose the card's prompt facts; used from the agent setup callback. */
  private scopeFor(agentCtx: Context, project: Project, cardId: CardId, file: string, kind: string): void {
    installCardScope(agentCtx, {
      project,
      cardId,
      file,
      kind,
      kindLabel: kindLabel(kind),
      material: () => this.materialText(project.id, cardId),
    })
  }

  /** The material block, rendered from the card's own edges. */
  private materialText(projectId: ProjectId, cardId: CardId): string {
    const project = this.projects.get(projectId)
    if (project === undefined) return ''
    // One hop (`materialUpstreams`): the block names what *this* artifact is
    // declared to build on, not what the board happens to sit downstream of. A
    // chain resolved transitively here would put a grandparent's file in every
    // grandchild's prompt — the products in between exist precisely to have
    // absorbed it.
    //
    // Resolved synchronously against cached facts, so this block carries *names*
    // and never file bodies: the card's `file` is the workspace-relative path,
    // which is exactly what the harness's `@file` grammar denotes, and the
    // material itself arrives when somebody reads it. A digest served from here
    // would have to be cached — and nothing invalidates such a cache, so a card
    // whose upstream was rewritten by an ordinary file edit would keep feeding
    // the prompt a stale summary.
    const lines = materialUpstreams(cardId, this.edgesOf(projectId)).map((upstream) => {
      const record = this.cards.get(cardKeyOf(projectId, upstream))
      // `nameWithoutProbe` and not the kind: this block is assembled without
      // I/O, and a `site`/`webapp` card is a *file* even though its kind is a
      // directory — see that helper. `canvas_reference_files` probes, so it
      // owns the exact token; this block just names the files.
      const name = nameWithoutProbe(record === undefined ? upstream : fileOf(record, upstream))
      return record === undefined ? `- ${name}` : `- ${name} (${kindLabel(record.kind)})`
    })
    if (lines.length === 0) return ''
    return [
      `Sourced material — the files this artifact builds on. Read one with the ordinary file tools when you need it; call \`${TOOL_NAMES.readSources}\` for digests of all of them, or \`${TOOL_NAMES.readCard}\` for one artifact directly:`,
      ...lines,
    ].join('\n')
  }

  private edgesOf(projectId: ProjectId) {
    return [...this.sources.entries()]
      .filter(([, record]) => record.project === projectId)
      .map(([id, record]) => ({ id, ...record }))
  }

  private async touch(projectId: ProjectId, cardId: CardId, record: CardRecord): Promise<void> {
    const facts = await this.deps.io.facts(this.requireProject(projectId).root, fileOf(record, cardId))
    await this.cards.put(cardKeyOf(projectId, cardId), {
      ...record,
      kind: facts.kind,
      updatedAt: Date.now(),
    })
  }

  private requireProject(projectId: ProjectId): Project {
    const record = this.projects.get(projectId)
    if (record === undefined) {
      throw new RemoteError('canvas/project-not-found', `no canvas project ${projectId}`, { projectId })
    }
    return { id: projectId, ...record }
  }

  private requireCard(projectId: ProjectId, cardId: CardId): CardRecord {
    const record = this.cards.get(cardKeyOf(projectId, cardId))
    if (record === undefined) {
      throw new RemoteError('canvas/card-not-found', `no card ${cardId} in project ${projectId}`, { projectId, cardId })
    }
    return record
  }
}

/**
 * A live session's full event log, read structurally.
 *
 * The fallback for deployments without the session-query service: only sessions
 * currently in the store can be read there, which is honest degradation — a
 * deployment that composition cannot query is also one whose card sessions are
 * short-lived.
 */
function liveSessionEvents(ctx: Context, sessionId: string): readonly SessionEvent[] | undefined {
  const store = ctx.get('sessions') as { get(id: string): { snapshotEvents(): readonly SessionEvent[] } | undefined } | undefined
  return store?.get(sessionId)?.snapshotEvents()
}

/** One line of human-readable cause, for the structured export/publish result. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
