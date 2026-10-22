/**
 * dsh-canvas — the model a node type remembers.
 *
 * A card's model choice is durable per *session*, which is the host's own rule:
 * `session.selectModel` writes into the session's selection projection. That is
 * right for one artifact and wrong for a canvas, where a user who settles on a
 * model for text nodes expects the next text node to start there instead of
 * re-picking it every time.
 *
 * So the board keeps one small piece of its own memory: the last model the user
 * picked, per node *type*, in the browser. The type key is the kind the card is
 * drawn with (`markdown`, `image`, …), which is what makes "another node like
 * this one" expressible without knowing anything about the file.
 *
 * Three rules keep this honest rather than decorative:
 *
 * - A memory is only ever *offered*. It is written when the user picks from the
 *   composer's own menu, never inferred.
 * - It is only applied to a session the host's projection reports as having no
 *   selection of its own (never run, never picked). A card the user has already
 *   used is never silently re-pointed at another model.
 * - A remembered model that the current catalog no longer offers is ignored, so
 *   memory cannot resurface an id the deployment has dropped.
 */
import type { BoardCard, CardSummary } from '../../types.ts'
import type { ModelCatalog } from './bridge.ts'
import { isMediaModel } from '../../core/media/routes.ts'

/** One provider/model pair, as the catalog and the selection projection name it. */
export interface ModelChoice {
  provider: string
  model: string
}

/** Where the per-type memory lives in the browser. Versioned: the shape may move. */
const STORAGE_KEY = 'dsh-canvas:model-by-kind:v1'

/**
 * The host's durable model-selection projection for one session
 * (`dsh-api-session-controller`'s `modelSelection` view, ported as data).
 *
 * `next` is what the session's next request will use — the pending intent when
 * there is one, otherwise the model the last request ran with. Both `null` is
 * the host's own way of saying "this session has no model intent yet", which is
 * the only condition under which the type memory below is allowed to speak.
 */
export interface ModelSelectionView {
  readonly lastUsed: ModelChoice | null
  readonly next: ModelChoice | null
}

/**
 * The model the session's next request will use, from its projection view.
 *
 * @param view - the projection value, or `undefined` when the session is
 *   unknown to this client (`session/list` rows carry it; a session that is not
 *   in that list cannot be judged).
 * @returns the selection, or `undefined` when the session has none yet.
 */
export function selectionOf(view: ModelSelectionView | undefined): ModelChoice | undefined {
  if (view === undefined || view === null) return undefined
  return view.next ?? view.lastUsed ?? undefined
}

/**
 * The node type a card counts as.
 *
 * The recognized kind wins over the seated one: the memory should follow what
 * the user sees on the card, and the summary's kind is the current fact —
 * old records may still carry a pre-merge kind id.
 *
 * @param card - the card.
 * @param summary - its digest, when read.
 * @returns the kind id used as the memory key.
 */
export function nodeTypeOf(card: BoardCard, summary: CardSummary | undefined): string {
  const kind = summary?.kind ?? ''
  return kind === '' ? card.kind : kind
}

/** The browser's key/value store, or `undefined` where there is none. */
function storage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage
}

/** Read the whole memory, tolerating an absent or unreadable store. */
function readMemory(): Record<string, ModelChoice> {
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    if (raw === undefined || raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return {}
    const next: Record<string, ModelChoice> = {}
    for (const [kind, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object') continue
      const entry = value as { provider?: unknown; model?: unknown }
      if (typeof entry.provider !== 'string' || typeof entry.model !== 'string') continue
      next[kind] = { provider: entry.provider, model: entry.model }
    }
    return next
  } catch {
    // A browser with storage disabled still gets a working composer; it just
    // does not carry the choice from one node to the next.
    return {}
  }
}

/**
 * Record the model the user just picked for one node type.
 *
 * @param kind - the node type key (see {@link nodeTypeOf}).
 * @param choice - the selection the host accepted.
 */
export function rememberModel(kind: string, choice: ModelChoice): void {
  if (kind === '') return
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ ...readMemory(), [kind]: choice }))
  } catch {
    // Same as above: the selection is already live on the host, so a store that
    // refuses the write costs the memory, not the choice.
  }
}

/**
 * The remembered model for one node type, if the catalog still offers it.
 *
 * 两条都要过：**目录里还有没有**（部署可能撤掉了这个 id），以及**它是不是这类卡该记的
 * 那种模型**。第二条是这一版（v1.76）新增的分岔：
 *
 * - 对话卡（文本 / 设计 / 应用）只认**非**生成模型。v1.73 之前生成模型本来就在菜单里，
 *   用户点过一次就会把那条记忆写下，而菜单上的过滤管不到记忆这条通路——下一次补种会
 *   原样复现「新卡继承一个视频生成模型，下一次请求 400」。
 * - 媒体卡（图片 / 视频 / 音频）**只认**生成模型。用户在这张卡上选的就是「用哪个模型
 *   出图」，那次选择同样值得按类型记住：下一张图片卡默认还用同一个。
 *
 * 一个 `kind` 只可能是其中一边，所以这条分岔不会同时成立——它挡的是「两边都接受」那种
 * 写法，那种写法会让每一张对话卡都有机会继承一个不能对话的模型。
 *
 * @param kind - the node type key.
 * @param catalog - the loaded host catalog; absent means "cannot verify".
 * @param options - `media: true` 表示这是媒体卡（只认生成模型）。
 * @returns the choice to apply, or `undefined` when there is nothing usable.
 */
export function recallModel(
  kind: string,
  catalog: ModelCatalog | undefined,
  options?: { readonly media?: boolean },
): ModelChoice | undefined {
  if (kind === '' || catalog === undefined) return undefined
  const remembered = readMemory()[kind]
  if (remembered === undefined) return undefined
  const group = catalog.groups.find((entry) => entry.id === remembered.provider)
  if (group === undefined) return undefined
  const wanted = options?.media === true
  return group.models.some((model) => model.id === remembered.model && isMediaModel(model.id) === wanted)
    ? remembered
    : undefined
}
