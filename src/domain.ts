/**
 * dsh-canvas — durable canvas state.
 *
 * Source edges are deliberately *not* kept in the file system: "引用数据独立于产物文件"
 * (§2.4). They live in a storage domain so the deployment's backend
 * routing, record versioning, serialized write chain and `domain/changed`
 * notifications all apply, and the plugin never grows its own metadata file.
 *
 * Layout is `per-record`: card and note records are small, sparse and
 * independently disposable, and each one is validated on its own.
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

/** Board position of a record. */
const point = z.object({ x: z.number(), y: z.number() })
/** Persisted view state of one board. */
const viewport = z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() })
/** Per-project style profile (F9.1). */
const styleProfile = z.object({ palette: z.array(z.string()), font: z.string(), tone: z.string() })

/**
 * One canvas project (F1.4, F9.1).
 *
 * The product doc's domain declaration carries a single global viewport and
 * style profile, which assumes one canvas per plugin instance. The board the
 * design calls for holds several projects side by side, so each project keeps
 * its own view state and style profile here, and the domain global keeps only
 * which project was last active. Everything else follows the doc's shape.
 */
const projectRecord = z.object({
  name: z.string(),
  root: z.string(),
  viewport,
  style: styleProfile,
  createdAt: z.number(),
})

/**
 * One card: seating, resolved kind, and the bound Agent session (F1.4, F2.2, F3.1).
 *
 * `seatedEmpty` records that the seat was created while its artifact did not
 * exist yet — a state a card is allowed to be in, since a dock spec seeds the
 * file a moment after seating it and an Agent may seat a card for what it is
 * about to write. It is what lets "missing artifact" (F3.5) mean *gone* rather
 * than *not written yet*, and so what keeps a bulk cleanup (F1.11) off a card
 * that was never anything but a promise.
 *
 * Optional on purpose: records written before this field existed are cards
 * whose history nobody recorded, and `undefined` reads as "not known to be
 * empty", which leaves them removable. Widening a record schema with an
 * optional key needs no domain version bump and no migration — every stored
 * record stays valid (`dsh-storage-domain` refuses the whole domain at open if
 * one fails its schema, so a *required* key would have locked users out).
 */
const cardRecord = z.object({
  project: z.string(),
  kind: z.string(),
  position: point,
  sessionId: z.string(),
  updatedAt: z.number(),
  seatedEmpty: z.boolean().optional(),
  /**
   * Path of the bound artifact, relative to the project root. Optional on
   * purpose: records written before the id/path split have a path-shaped id
   * and no file, and `undefined` reads as "the file is the id" — the old
   * behavior, so no migration is needed. New records always carry it.
   */
  file: z.string().optional(),
  /**
   * The card's own name (F1.12), when the user gave it one the artifact's own
   * path does not already say. Optional for the same reason `file` is: records
   * written before this field existed read as "name it after its artifact",
   * which is exactly what they showed. `core/canvas/card-name.ts` owns the
   * derivation and the rule that a name equal to it is not stored at all.
   */
  name: z.string().optional(),
  /**
   * 这张卡**由哪个模型生成**（F2.7）：图片卡 / 视频卡 / 音频卡上那颗下拉框选的就是它。
   *
   * 与 `name` 同一条可选纪律：`undefined` 读作「没单独选过」，也就是此前一直的行为
   * （交给配置里第一个对得上模型族的模型），所以老记录一张都不用迁。
   *
   * 它**不是**会话模型。会话用哪个模型说话归会话自己（宿主的 `model/selection`），
   * 两者一旦共用一个字段，就会出现「给视频卡选了生成模型，会话也跟着换，下一次请求
   * 400」——那正是 v1.73 / v1.75 反复踩的那件事。
   */
  mediaModel: z.string().optional(),
  /**
   * 产物的真实宽高比（宽 ÷ 高，F3.11）。有它，媒体卡就按图的比例坐，而不是一律 16:9。
   *
   * 由**浏览器**测出来再写回来（`card/setAspect`）：解码一张图 / 一段视频的宽高，
   * 浏览器是最可靠的那个解码器，宿主去解析 PNG / JPEG / WebP / MP4 的容器头等于把同一
   * 件事再实现一遍，还只认得自己实现过的那几种。测不到就不写——`undefined` 读作
   * 「还不知道比例」，卡片按默认 16:9 坐，老记录一张都不用迁。
   */
  aspect: z.number().optional(),
})

/** One source edge: `downstream` builds on `upstream` (F4.1, F4.3). */
const sourceRecord = z.object({
  project: z.string(),
  downstream: z.string(),
  upstream: z.string(),
  origin: z.enum(['manual', 'reconciled']),
})

/** One shared board note (F9.3). */
const noteRecord = z.object({
  project: z.string(),
  text: z.string(),
  author: z.string(),
  position: point,
  createdAt: z.number(),
})

/** One queued structured intent awaiting the card's next turn (F8.2, F8.4). */
const intentRecord = z.object({
  project: z.string(),
  cardId: z.string(),
  kind: z.enum(['text-edit', 'region-comment', 'element-style', 'reorder']),
  payload: z.string(),
  image: z.string(),
  createdAt: z.number(),
})

/** The board's global singleton: which canvas is open, and its view state. */
export const canvasGlobalSchema = z.object({
  activeProjectId: z.string(),
  viewport,
  style: styleProfile,
})

/** Value served before the first write; never stored until something sets it. */
export const DEFAULT_CANVAS_GLOBAL = {
  activeProjectId: '',
  viewport: { x: 0, y: 0, zoom: 1 },
  style: { palette: [] as string[], font: '', tone: '' },
}

/**
 * The one domain this plugin declares.
 *
 * The medium's unit-name rule is `[a-z][a-z0-9_]*`, so the package's hyphen is
 * not reusable here: `'dsh-canvas'` throws at module load, before any medium is
 * touched. The name is also the on-disk unit key, so it is renamed only with a
 * migration, never for cosmetic alignment with the package name.
 */
export const CANVAS_DOMAIN = defineDomain({
  name: 'dsh_canvas',
  version: 1,
  layout: 'per-record',
  global: { schema: canvasGlobalSchema, initial: DEFAULT_CANVAS_GLOBAL },
  tables: {
    projects: domainTable<string, z.infer<typeof projectRecord>>(projectRecord),
    cards: domainTable<string, z.infer<typeof cardRecord>>(cardRecord),
    sources: domainTable<string, z.infer<typeof sourceRecord>>(sourceRecord),
    notes: domainTable<string, z.infer<typeof noteRecord>>(noteRecord),
    intents: domainTable<string, z.infer<typeof intentRecord>>(intentRecord),
  },
})

/** The opened-domain handle type, derived from the spec so it can never drift. */
export type CanvasDomain = Domain<typeof CANVAS_DOMAIN>
