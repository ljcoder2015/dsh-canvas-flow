/**
 * dsh-canvas — 引用进来的那张图，怎么变成生成请求里的参考图（F2.7 / F4.1）。
 *
 * 画布上「引用」是一条有向边（`sources`：上游卡片的产物被下游当材料用）。对文本卡来说，
 * 兑现它的方式是**把上游摘要注入下游会话**；对图片 / 视频卡来说，唯一的兑现方式是
 * **把上游那张图送进生成请求**——`image`（图生图）或 `content[].image_url`（图生视频）。
 *
 * ## 为什么这件事必须有一个纯模块
 *
 * 它是一次**自动判断**，而自动判断最容易变成「猜」：画布上连了什么，就该把什么喂过去，
 * 这中间有三个岔口，每一个都能安静地做错——
 *
 * - 上游可能**不止一张**（引用是 N 对 N 的图，不是一条链）：取哪一张？
 * - 上游可能是**一张视频或一段音频**：它们不是参考图，硬塞进 `image_url` 会被服务端拒。
 * - 上游可能**还没有产物**（空座位）：路径是有的，磁盘上是空的。
 *
 * 所以规则写成一句话、能穷举：**取第一条上游、且形态是图片、且产物在盘上的那张**；
 * 调用方可以用一个卡片 id 点名另一张。挑不到就返回 `undefined`——**不猜、不退化成一个
 * 默认值**，让调用方去说「这次没用上参考图」。
 *
 * ## 与「引用即数据」是同一条纪律
 *
 * 这里不读盘、不认识 Ark、不发请求：它只回答「哪张卡的哪个文件」。文件是否存在、怎么读、
 * 怎么变成地址，都是 host 侧 `media-provider.ts` 的事（那里才有 ctx 与 OS 能力）。
 */
import { resolveKindId } from '../artifact/kind/kind-registry.ts'

/** 画布上一张卡里，这个模块要读的三栏。 */
export interface ReferenceCardShape {
  readonly id: string
  /** 项目相对路径 —— 产物路径，不是座位 id。 */
  readonly file: string
  /** 形态；可能是扩展名（`png`）也可能已是形态名（`image`），一律走 {@link resolveKindId} 折算。 */
  readonly kind: string
}

/** 画布上一条引用边：下游用了上游的产物。 */
export interface ReferenceEdgeShape {
  readonly upstream: string
  readonly downstream: string
}

/**
 * 这次能不能给参考图、给的是哪一张。
 *
 * 分三种而不是 `undefined` 一种，因为**「没有引用」与「引用了但不能用」对使用者是两件事**：
 * 前者是正常状态（纯文生图 / 文生视频），后者要如实说出口——引用了却没用上，用户会以为
 * 模型没照参考图来。
 */
export type ReferenceLookup =
  | { readonly status: 'found'; readonly cardId: string; readonly file: string }
  /** 没有任何可用的上游图片引用（或调用方点名的那张不存在）。 */
  | { readonly status: 'none' }
  /** 点名的那张卡在画布上，但它的产物不是图片。 */
  | { readonly status: 'not-image'; readonly cardId: string; readonly kind: string }

/** 一张卡能不能当参考图：形态折算后是 `image`。 */
function asImage(card: ReferenceCardShape): ReferenceCardShape | undefined {
  return resolveKindId(card.kind) === 'image' ? card : undefined
}

/**
 * 找到这次生成该用的参考图。
 *
 * @param cards - 画布上的卡片。
 * @param sources - 画布上的引用边。
 * @param cardId - 正在为哪张卡生成。
 * @param named - 调用方点名要用的卡片 id；省略即按引用自动挑。
 */
export function referenceFor(
  cards: readonly ReferenceCardShape[],
  sources: readonly ReferenceEdgeShape[],
  cardId: string,
  named?: string,
): ReferenceLookup {
  const wanted = named?.trim() ?? ''
  if (wanted !== '') {
    const card = cards.find((entry) => entry.id === wanted)
    if (card === undefined) return { status: 'none' }
    const image = asImage(card)
    return image === undefined
      ? { status: 'not-image', cardId: card.id, kind: card.kind }
      : { status: 'found', cardId: image.id, file: image.file }
  }

  // 自动：按引用边的顺序（板面文件里的顺序就是用户连线的顺序）取第一条能用的。
  // 一次生成只喂一张图：`image` 支持数组，但**一张卡一个产物**，而多图会让「这张图
  // 动了」变成「这两张图混在一起」——那是另一个功能（多参考图），不该由自动挑选顺手决定。
  for (const edge of sources) {
    if (edge.downstream !== cardId) continue
    const card = cards.find((entry) => entry.id === edge.upstream)
    if (card === undefined) continue
    const image = asImage(card)
    if (image !== undefined) return { status: 'found', cardId: image.id, file: image.file }
  }
  return { status: 'none' }
}

/**
 * 挑不到参考图时，对 agent 说的那句话；没什么可说的就 `undefined`。
 *
 * 「自动挑不到」不值得说（纯文生图就是没有引用），但**点名了却不行**必须说，否则一次
 * 生成会安静地少掉用户以为已经给的东西。
 */
export function referenceNote(lookup: ReferenceLookup): string | undefined {
  if (lookup.status === 'not-image') {
    return `卡片 ${lookup.cardId} 的产物不是图片（形态：${lookup.kind}），不能当参考图——这次没有使用它`
  }
  return undefined
}
