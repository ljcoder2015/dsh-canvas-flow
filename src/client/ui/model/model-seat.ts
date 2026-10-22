/**
 * dsh-canvas — 卡片底栏那颗模型席位：**它问的是哪件事**，以及那一笔落在哪儿。
 *
 * ## 同一个控件，两种语义（v1.76）
 *
 * 用户原话：「图片和视频模型的选择，只是选择图片模型和视频模型，不是选择对话模型」。
 * 所以这个席位的含义**按卡片形态分岔**：
 *
 * - **文本 / 设计 / 应用卡**：选的是**这段会话下一次请求用哪个模型**。落点是会话
 *   （宿主 `selectModel` 写的那个选择投影）。
 * - **图片 / 视频 / 音频卡**：选的是**这张卡由哪个模型生成**。落点是卡片记录上的
 *   `mediaModel` 字段（`setMediaModel`），**完全不碰会话**。
 *
 * 两件事共用一个控件是合理的（用户眼里都是「这张卡用哪个模型」），共用一个**落点**却是
 * 灾难：v1.73 那场 400 就是「给视频卡选了生成模型，选择写进了会话」——下一次对话请求
 * 以 `POST /chat/completions` 打到方舟，换回一句 `max_completion_tokens … <= 12288`。
 * 那以后我们一度把生成模型整个挡在席位的候选之外（v1.73），结果是**图片卡根本没法选
 * 图片模型**，而这正是这一版要反过来修的东西。
 *
 * 于是：**候选名单按形态收窄，落点按形态分开**。
 *
 * ## 为什么落点规则单独放在这里
 *
 * 与 `whoami` 式的「有没有会话」分开写、并放在一个零依赖模块里，理由与仓库里其它纯判断
 * 一样：它是**一条可以单独验的规则**（哪种卡写哪儿、什么时候必须先开会话、什么时候该
 * 禁用）；而 `model-picker.tsx` 引了宿主 UI 原语，node 下 import 不了，只能读源码文本
 * 把接线对一遍。
 *
 * 三种落点，各对一件事：
 *
 * - `session` —— 对话卡已经有会话，直接写。
 * - `open-first` —— 对话卡还没有会话，但知道该开哪一张：**先开再写**。开法必须是画布
 *   自己那条 `openSession`，不能让宿主的 `selectModel` 自己去 resolve——那样冒出来的会话
 *   会被组合在本插件的 agent 作用域之外，卡片随即认不回自己的对话。
 * - `card` —— 媒体卡：写卡片记录本身，**不需要会话**（建卡不等于开会话，而生成模型
 *   与有没有对话毫无关系）。
 * - `unreachable` —— 连卡片都定位不到（席位在控制带与设计弹窗两处共用）。这一笔没有
 *   落点，就如实禁用，而不是点下去什么都不发生。
 */
import { resolveKindId } from '../../../core/artifact/kind/kind-registry.ts'
import { isMediaModel, mediaCapabilitiesOf, MEDIA_CAPABILITIES } from '../../../core/media/routes.ts'
import type { MediaCapability } from '../../../core/media/types.ts'

/** 「这一笔落在哪儿」的四种答复。 */
export type SeatTarget = 'session' | 'open-first' | 'card' | 'unreachable'

/** 席位当下的处境：会话有没有、卡片能不能定位到、这张卡是不是媒体卡。 */
export interface SeatFacts {
  /** 卡已经绑上的会话，还没开会话时是空串。 */
  readonly sessionId: string
  /** 卡所在的项目。 */
  readonly projectId: string
  /** 卡的座位 id（**不是产物路径**）。 */
  readonly cardId: string
  /**
   * 这张卡是不是媒体卡（图片 / 视频 / 音频）。
   *
   * 缺省当作 `false`——那是这个控件从前的语义，也是绝大多数卡片的形态；把它写成必需
   * 字段会让每一个旧调用点都被迫回答一个它答不上来的问题。
   */
  readonly media?: boolean
}

/**
 * 这张卡的形态对应哪种媒体生成能力；不是媒体卡就是 `undefined`。
 *
 * 用 `MEDIA_CAPABILITIES` 做匹配而不是强转：kind id 与能力名在这三者上恰好是同一批
 * 字符串（`image` / `video` / `audio`），但「恰好」不该靠一句 `as` 维持——名单变了要
 * 报得出来（`tests/core/media/` 里有一条判据钉住 `MEDIA_CAPABILITIES` 与 kind 表的
 * `MEDIA_KINDS` 相等）。
 */
export function mediaCapabilityOf(kind: string): MediaCapability | undefined {
  const id = resolveKindId(kind)
  return MEDIA_CAPABILITIES.find((capability) => capability === id)
}

/**
 * 媒体卡的菜单里该列哪些模型：**只有这个能力族的**。
 *
 * 图片卡列 seedream 那一族、视频卡列 seedance 那一族、音频卡列 tts 那一族。判据与挑
 * 生成路线共用同一份模型族指纹（`mediaCapabilitiesOf`）——两处各写一份名单，就是「加一种
 * 模型时有一处认不出来」的老剧本，而那次的表现是**菜单里少一项**，不报错。
 *
 * 非媒体卡调用它得到空数组：那说明调用方问错了问题（对话卡该问 {@link seatCandidates}）。
 */
export function mediaSeatCandidates<T extends { readonly id: string }>(
  kind: string,
  models: readonly T[],
): readonly T[] {
  const capability = mediaCapabilityOf(kind)
  if (capability === undefined) return []
  return models.filter((model) => mediaCapabilitiesOf(model.id).includes(capability))
}

/**
 * 对话卡的菜单里该列哪些模型：**除媒体生成模型之外的全部**。
 *
 * 宿主的模型目录是「这个部署配了哪些模型」，不是「哪些模型能当对话模型」——用户往配置里
 * 加一条 doubao 路线好让 seedream / seedance 出图出视频，这条路线里的模型就会一起出现在
 * 会话的模型下拉里，而它们**不是对话模型**：选中的那一刻什么都没发生，下一次请求才以
 * 400 回来。
 *
 * 所以这里不是「少列几个更清爽」，是**把一次必崩的选择挡在列表之外**。判据在
 * `core/media/routes.ts` 的 `isMediaModel`（与挑生成路线读的是同一份模型族指纹）。
 *
 * 泛型收 `{ id }` 而不是 `CatalogModel`：这个文件是零依赖的规则模块，判据在 node 下
 * 直接 import 它跑，不必拖着桥的类型过来。
 */
export function seatCandidates<T extends { readonly id: string }>(models: readonly T[]): readonly T[] {
  return models.filter((model) => !isMediaModel(model.id))
}

/**
 * **对话卡**上这个选择是不是媒体生成模型（历史遗留的那种）。
 *
 * 媒体卡上选媒体模型是**对的**（那是这一版的核心），所以这个判断只在对话卡上有意义；
 * 调用方拿它来提示「这里不是生成模型的位置」。
 *
 * 已经选错的不静默改掉——那是用户的选择，画布不替他做决定；但要说出来，因为症状
 * （下一次请求 400）离原因（下拉里选了视频模型）隔得很远。
 */
export function isMediaSeat(model: string | undefined): boolean {
  return model !== undefined && isMediaModel(model)
}

/**
 * 这一笔选择的落点。
 *
 * 顺序是有意的：**媒体卡先分岔**（它跟会话无关），然后才是对话卡那两条——已经有会话就用它
 * （哪怕卡片 / 项目这两栏是空的：那种壳里会话就是全部所需的上下文），没有会话才轮到
 * 「要不要替它开一个」。
 */
export function seatTarget(facts: SeatFacts): SeatTarget {
  if (facts.media === true) {
    return facts.projectId === '' || facts.cardId === '' ? 'unreachable' : 'card'
  }
  if (facts.sessionId !== '') return 'session'
  if (facts.projectId === '' || facts.cardId === '') return 'unreachable'
  return 'open-first'
}

/** 席位此刻能不能接受一次选择（`unreachable` 是唯一的「不能」）。 */
export function seatUsable(target: SeatTarget): boolean {
  return target !== 'unreachable'
}
