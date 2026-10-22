/**
 * dsh-canvas — 卡片底栏那颗下拉框：**这张卡用哪个模型**。
 *
 * 同一个控件，两种语义（v1.76，用户定下来的）：
 *
 * - **对话卡**（文本 / 设计 / 应用）：选的是这段会话下一次请求用哪个模型。读宿主的模型
 *   目录、写会话的选择投影、按类型记住。
 * - **媒体卡**（图片 / 视频 / 音频）：选的是**这张卡由哪个模型生成**。菜单只列这一族的
 *   模型，选择写进卡片记录的 `mediaModel`（`setMediaModel`），**不碰会话**。
 *
 * 两处要用同一个控件：卡片控制带底栏（`card-overlay.tsx`）与设计预览的 AI 标签页
 * （`design-panels.tsx`）。两处说的其实是同一句话——「这张卡用哪个模型」——所以只有这
 * 一份实现：读同一份目录、走同一条落点规则（`model-seat.ts`）、写同一个按类型记住的偏好。
 * 复制一份出来就会有两套「记忆」的写法，而记忆这种东西一旦分裂，用户看到的就是「在这里
 * 选过的模型，到那边不认」。
 *
 * 它只认 {@link ModelBridge} 这几件事：目录、会话选择投影、写会话选择、写卡片生成模型、
 * 开会话。卡片那边给的是整个 `CanvasBridge`，弹窗那边给的是产物弹窗的桥（同一批方法的
 * 结构型），两处都不必多写一层适配。
 *
 * **开会话只在对话卡上用**：补种时（把节点类型记住的模型装进一个还没有选择的会话），
 * 以及用户在一张**还没有会话**的对话卡上直接选一个模型时——建卡不等于开会话，所以那种卡
 * 上席位照样得能用（见 `model-seat.ts`）。媒体卡**从来不需要会话**：它选的是生成模型，
 * 跟有没有对话无关。
 */
import { useEffect, useState } from 'react'
import type { CatalogModel, ModelCatalog } from '../../wire/bridge.ts'
import {
  recallModel,
  rememberModel,
  selectionOf,
  type ModelChoice,
  type ModelSelectionView,
} from '../../wire/model-memory.ts'
import {
  isMediaSeat,
  mediaCapabilityOf,
  mediaSeatCandidates,
  seatCandidates,
  seatTarget,
  seatUsable,
} from './model-seat.ts'
import type { Translate } from '../locales.ts'

/**
 * 席位需要的全部外部能力。
 *
 * `openSession` 返回什么不作要求，只要有 `sessionId`——这里只在**需要一张会话**的时候把
 * 「会话已经开着」这件事变成一个 id（补种时，与用户在一张还没有会话的对话卡上选项时）。
 */
export interface ModelBridge {
  /** The Host-generation model catalog, shared by every session's picker. */
  modelCatalog(): Promise<ModelCatalog>
  /** Open, or re-attach, the Agent session bound to a card. */
  openSession(projectId: string, cardId: string): Promise<{ sessionId: string }>
  /** Read one session's model-selection projection. */
  readModelSelection(sessionId: string): Promise<ModelSelectionView | undefined>
  /** Write a durable per-session model selection. */
  selectModel(sessionId: string, provider: string, model: string): Promise<void>
  /** 记下这张卡由哪个模型生成（媒体卡用）；空串回到「自动」。 */
  setMediaModel(projectId: string, cardId: string, model: string): Promise<unknown>
}

/**
 * The Host catalog, loaded at most once per client page and shared by every
 * seat. A failed load clears the cache so the next open retries.
 */
let catalogCache: Promise<ModelCatalog> | undefined

function loadCatalog(bridge: ModelBridge): Promise<ModelCatalog> {
  catalogCache ??= bridge.modelCatalog().catch((error: unknown) => {
    catalogCache = undefined
    throw error
  })
  return catalogCache
}

/** Resolve a model id to its catalog display name, falling back to the id. */
function modelName(catalog: ModelCatalog | undefined, choice: ModelChoice | undefined): string {
  if (choice === undefined) return ''
  const group = catalog?.groups.find((entry) => entry.id === choice.provider)
  return group?.models.find((model) => model.id === choice.model)?.name ?? choice.model
}

/**
 * 按**模型 id** 找显示名。
 *
 * 媒体卡记的是 id、没有 provider 那一半（同一个 id 在目录里只会属于一条路线，而记录里
 * 存两个字段等于给「同一个选择」留两份可能对不上的来源），所以这边按 id 找。
 */
function nameById(catalog: ModelCatalog | undefined, id: string | undefined): string {
  if (id === undefined) return ''
  for (const group of catalog?.groups ?? []) {
    const found = group.models.find((model) => model.id === id)
    if (found !== undefined) return found.name
  }
  return id
}

/**
 * What the seat can say about the session's model.
 *
 * - `pending` — nothing read yet (catalog loading, or the list read in flight).
 * - `chosen` — the session has a selection; it is what its next request uses.
 * - `none` — the session has never picked a model and never run, so the node
 *   type's memory may speak for it.
 * - `unknown` — the session is not in the host's list, so nothing can be said.
 *
 * `pending` and `unknown` both keep the label at its placeholder rather than
 * printing the catalog default: an unverified default reads as a fact, and that
 * is exactly the claim this seat must not make.
 *
 * 只有对话卡用它；媒体卡的状态就是记录里那个字段（`mediaModel`），没有第三种可能。
 */
type ModelSeat =
  | { status: 'pending' }
  | { status: 'chosen'; choice: ModelChoice }
  | { status: 'none' }
  | { status: 'unknown' }

/** Cards this page has already seeded from the type memory; one write each. */
const seededCards = new Set<string>()

/**
 * The model seat: one pill that opens the catalog, for one card.
 *
 * 对话卡读宿主目录、写会话选择（宿主的 `session.selectModel`，与宿主自己的模型席位是
 * 同一条线）；媒体卡读同一份目录、但只列这一族的模型，写的是卡片记录上的 `mediaModel`。
 * 两条路的落点判断都在 `model-seat.ts` 里，这个组件只负责把结果画出来。
 *
 * 对话卡的补种意味着*先把这张卡的会话开出来*：宿主的 `selectModel` 会去 resume 一个会话，
 * 而它 resume 出来的那个会被组合在本卡 agent 作用域之外 —— 插件随后就找不到自己的会话，
 * 于是给这张卡再开第二个。走画布自己的 `openSession` 才能让 agent、作用域与选择是同一份
 * 状态。媒体卡没有这个问题：它压根不开会话。
 */
export function ModelPicker({
  bridge,
  projectId,
  cardId,
  sessionId,
  kind,
  mediaModel,
  t,
}: {
  bridge: ModelBridge
  projectId: string
  cardId: string
  /** The session the card is bound to, or `''` before it has one. */
  sessionId: string
  /** The node type whose remembered model this card may inherit. */
  kind: string
  /** 卡片记录里选定的生成模型（媒体卡用）；`undefined` 即「自动」。 */
  mediaModel?: string
  t: Translate
}) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<ModelCatalog | undefined>(undefined)
  const [seat, setSeat] = useState<ModelSeat>({ status: 'pending' })
  /** 媒体卡的当前选择：记录里那个 id，或 `undefined`（自动）。写完先乐观地记在这儿。 */
  const [chosenMedia, setChosenMedia] = useState<string | undefined>(mediaModel)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  /**
   * 这张卡是媒体卡吗——决定这个席位问的是哪件事。
   *
   * 判断走形态注册表（`mediaCapabilityOf`），不看 `kind` 的字面量：形态 id 可以被别名
   * 解析（`resolveKindId`），拿原始字符串比会漏掉带别名的那一次。
   */
  const capability = mediaCapabilityOf(kind)
  const isMedia = capability !== undefined

  // 记录被别处改过（改名、换机器打开板面）时跟上：这一笔的真相在卡片记录里。
  useEffect(() => {
    setChosenMedia(mediaModel)
  }, [mediaModel])

  /**
   * 这一笔的落点（判据在 `model-seat.ts`）。
   *
   * 对话卡**可以先于它的会话存在**：建卡不等于开会话（技术文档 §十一 差异表第一条），
   * 所以新座的 `sessionId` 就是空串。席位在这种卡上照样得能用——要么直接写进已有的会话，
   * 要么先替卡片把会话开出来再写。媒体卡的落点是卡片记录，与会话无关。
   */
  const target = seatTarget({ sessionId, projectId, cardId, media: isMedia })

  // The catalog is loaded on mount, not on first open: the label needs a name
  // for the card's model before the menu is ever consulted. The shared cache
  // makes every later card free.
  useEffect(() => {
    let cancelled = false
    loadCatalog(bridge)
      .then((value) => {
        if (!cancelled) setCatalog(value)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
    return () => {
      cancelled = true
    }
  }, [bridge])

  // Read the session's own projection. It is the only face that can say what
  // the next request will actually use, so the label is read from it rather
  // than guessed from the catalog default. A card that has no conversation yet
  // has no selection either — that is an answer, not a missing read.
  //
  // 媒体卡不走这一条：它问的不是会话。
  useEffect(() => {
    if (isMedia) return
    setSeat({ status: 'pending' })
    if (sessionId === '') {
      setSeat({ status: 'none' })
      return
    }
    let cancelled = false
    bridge
      .readModelSelection(sessionId)
      .then((view: ModelSelectionView | undefined) => {
        if (cancelled) return
        if (view === undefined) {
          setSeat({ status: 'unknown' })
          return
        }
        const choice = selectionOf(view)
        setSeat(choice === undefined ? { status: 'none' } : { status: 'chosen', choice })
      })
      .catch(() => {
        if (!cancelled) setSeat({ status: 'unknown' })
      })
    return () => {
      cancelled = true
    }
  }, [bridge, sessionId, isMedia])

  // A card with nothing chosen inherits its node type's memory: that is what
  // makes remembering worth doing. The write lands where this kind of card
  // keeps it — the session for a conversation card, the record for a media one.
  // Once per card, and only on the projection's own "nothing chosen yet" answer.
  useEffect(() => {
    if (catalog === undefined || projectId === '' || cardId === '' || seededCards.has(cardId)) return
    if (isMedia) {
      if (chosenMedia !== undefined) return
      const remembered = recallModel(kind, catalog, { media: true })
      if (remembered === undefined) return
      seededCards.add(cardId)
      setBusy(true)
      setError('')
      bridge
        .setMediaModel(projectId, cardId, remembered.model)
        .then(() => setChosenMedia(remembered.model))
        .catch((seedError: unknown) => setError(seedError instanceof Error ? seedError.message : String(seedError)))
        .finally(() => setBusy(false))
      return
    }
    if (seat.status !== 'none') return
    const remembered = recallModel(kind, catalog)
    if (remembered === undefined) return
    seededCards.add(cardId)
    setBusy(true)
    setError('')
    bridge
      .openSession(projectId, cardId)
      .then((binding) => bridge.selectModel(binding.sessionId, remembered.provider, remembered.model))
      .then(() => setSeat({ status: 'chosen', choice: remembered }))
      .catch((seedError: unknown) => setError(seedError instanceof Error ? seedError.message : String(seedError)))
      .finally(() => setBusy(false))
  }, [seat, catalog, kind, projectId, cardId, bridge, isMedia, chosenMedia])

  /**
   * 选一个模型。
   *
   * - **媒体卡**：写卡片记录（`setMediaModel`）。那张卡由这个模型生成，与会话无关。
   * - **对话卡**：写进这张卡的会话；会话还没有就先开一个——**选择的落点是会话，而卡片
   *   可以先于它的会话存在**。开法走画布自己那条 `openSession`，与补种同一个理由。
   *
   * 开不出来（宿主拒了）就照实把错误摆出来，不改标签、不写记忆——记忆只在用户真的选成
   * 之后才写。
   */
  const pick = (provider: string, model: CatalogModel): void => {
    if (busy || !seatUsable(target)) return
    setBusy(true)
    setError('')
    const choice: ModelChoice = { provider, model: model.id }
    if (isMedia) {
      bridge
        .setMediaModel(projectId, cardId, model.id)
        .then(() => {
          rememberModel(kind, choice)
          setChosenMedia(model.id)
          setOpen(false)
        })
        .catch((pickError: unknown) => setError(pickError instanceof Error ? pickError.message : String(pickError)))
        .finally(() => setBusy(false))
      return
    }
    const landing: Promise<string> =
      target === 'session'
        ? Promise.resolve(sessionId)
        : bridge.openSession(projectId, cardId).then((binding) => binding.sessionId)
    landing
      .then((session) => bridge.selectModel(session, provider, model.id))
      .then(() => {
        // The memory is written only here: what the user picked, never a guess.
        rememberModel(kind, choice)
        setSeat({ status: 'chosen', choice })
        setOpen(false)
      })
      .catch((pickError: unknown) => setError(pickError instanceof Error ? pickError.message : String(pickError)))
      .finally(() => setBusy(false))
  }

  /**
   * What the label may state.
   *
   * 对话卡：会话自己的选择，或者——投影确认「还没选过」之后——下一次请求会从哪个模型
   * 起步（先是类型记忆，然后是部署默认）。媒体卡：记录里那个 id，没有就是**「自动」**
   * ——那是个诚实的词：生成时会按模型族去配置里挑一个。
   */
  const shown =
    isMedia
      ? undefined
      : seat.status === 'chosen'
        ? seat.choice
        : seat.status === 'none'
          ? (recallModel(kind, catalog) ?? catalog?.default)
          : undefined
  const label = isMedia
    ? chosenMedia === undefined
      ? t('canvas.composer.modelAuto')
      : nameById(catalog, chosenMedia)
    : shown === undefined
      ? t('canvas.composer.model')
      : modelName(catalog, shown)
  const current = seat.status === 'chosen' ? seat.choice : undefined
  /**
   * **对话卡**上这个席位选的是不是媒体生成模型（历史遗留的那种）。
   *
   * 媒体卡上选生成模型是**对的**，所以这个判断只在非媒体卡上有意义：那种模型的会话
   * 下一次请求会以 400 回来（`max_completion_tokens` 超过该模型上限），而报错离原因
   * 隔着一整个下拉框。
   */
  const mediaSeat = !isMedia && shown !== undefined && isMediaSeat(shown.model)

  return (
    <span className="dsh-canvas-modelzone">
      <button
        className="dsh-canvas-modelbtn"
        onClick={() => setOpen((value) => !value)}
        // **不是**「有没有会话」：还没有会话的卡片照样能选，选的时候替它开一个
        // （`target === 'open-first'`）。只有连卡片都定位不到时才禁用。
        disabled={!seatUsable(target)}
        data-media-seat={mediaSeat ? 'true' : 'false'}
        data-media-model={isMedia ? 'true' : 'false'}
        title={
          isMedia ? t('canvas.composer.modelMedia') : mediaSeat ? t('canvas.composer.modelMediaSeat') : t('canvas.composer.model')
        }
      >
        {label}
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="dsh-canvas-menu is-raised dsh-canvas-modelmenu">
          {error !== '' ? <span className="dsh-canvas-composer-menuempty">{error}</span> : null}
          {error === '' && catalog === undefined ? (
            <span className="dsh-canvas-composer-menuempty">{t('canvas.composer.modelLoading')}</span>
          ) : null}
          {error === '' && isMedia ? (
            <span className="dsh-canvas-composer-menunote">{t('canvas.composer.modelMediaNote')}</span>
          ) : null}
          {error === '' && mediaSeat ? (
            <span className="dsh-canvas-composer-menunote">{t('canvas.composer.modelMediaSeat')}</span>
          ) : null}
          {catalog?.groups.map((group) => {
            // 两种卡各列各的：对话卡滤掉生成模型（选中即崩），媒体卡只列这一族的。
            const models = isMedia ? mediaSeatCandidates(kind, group.models) : seatCandidates(group.models)
            return (
              <div key={group.id}>
                <div className="dsh-canvas-modelgroup">{group.name}</div>
                {models.length === 0 ? (
                  <span className="dsh-canvas-composer-menuempty">
                    {isMedia ? t('canvas.composer.modelNoFamily') : t('canvas.composer.modelEmpty')}
                  </span>
                ) : (
                  models.map((model) => (
                    <button
                      className="dsh-canvas-row"
                      data-current={
                        isMedia
                          ? chosenMedia === model.id
                            ? 'true'
                            : 'false'
                          : current?.provider === group.id && current?.model === model.id
                            ? 'true'
                            : 'false'
                      }
                      disabled={busy}
                      key={model.id}
                      title={model.description}
                      onClick={() => pick(group.id, model)}
                    >
                      {model.name}
                    </button>
                  ))
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </span>
  )
}
