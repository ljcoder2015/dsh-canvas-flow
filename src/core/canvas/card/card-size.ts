/**
 * dsh-canvas — 一张卡在画布上占多大（F2.7 / F3.11）。
 *
 * 尺寸只有这一份真源：卡片自己的渲染、引用线的锚点、连线落点的命中矩形、取景与缩略图、
 * 宿主排位、以及控制带与工具条挂在哪——六处全读这里。从前 `CARD_WIDTH` / `CARD_HEIGHT`
 * 是**一个**常数，客户端还另抄了一份 `const CARD_W = 200`（两份数字，改一处另一处悄悄
 * 错位）。
 *
 * **所有形态同一个尺寸（v1.79）**。用户原话：「其他类型的卡片大小改成和图片和视频一样的
 * 默认大小」。此前分两档（图片 / 视频 400×252、其余 200×140），代价是画布上永远两种节拍：
 * 整理要逐列取最宽、取景要逐张算矩形、命中要逐张判——而人看画布时先看的是齐不齐。现在
 * 一档 **400×252**。
 *
 * **为什么是 400×252 而不是 400×280**：卡面**铺满预览面板**（`styles.ts` 里
 * `.dsh-canvas-card-media` 用负边距抵掉了内边距），而面板 = 卡宽减两边边框 ／ 卡高减卡头
 * 再减两边边框。高度若按「宽度的 70%」给，面板就是 398×252（1.58:1），一张 16:9 的图按
 * `contain` 铺进去，上下各空出一条 13.5px 的底色——「高度有空白区域」就是这么来的。所以
 * 高度由**面板 16:9 反推**：`Math.round(398 / (16/9)) = 224` ⇒ 整卡 `224 + 26 + 2 = 252`。
 *
 * **尺寸与形态无关**这件事由两处一起钉住：`cardSizeOf()` **不收 kind**，于是「图片大、
 * 文本小」这种分岔在类型层面就写不出来；判据另有一条遍历形态表验「所有形态都等于同一个
 * 矩形」。哪天某个形态真的要单独坐，必须回来改这里，并想清楚排位、取景与命中。
 */

/** 一张卡的渲染宽度（与 `styles.ts` 里 `.dsh-canvas-card` 的兜底值一致）。 */
export const CARD_WIDTH = 400

/**
 * 卡头占的高度：`.dsh-canvas-card-head` 的上下 padding 各 5px + 名字行 16px。
 *
 * 这个数不能凭感觉写：卡面要「正好 16:9」就得从卡高里扣掉卡头与边框，扣错了图就在卡面
 * 下方留出一条空带。`tests/core/canvas/card-size.spec.ts` 会拿 `styles.ts` 里的 padding
 * 与 `line-height` 现算一遍来对账。
 */
export const CARD_HEAD_HEIGHT = 26

/** 卡片**单边**边框宽度（`box-sizing: border-box` ⇒ 面板宽高各要减两边）。 */
export const CARD_BORDER = 1

/** 卡面的宽高比：16:9（图片与视频的默认产出比例）。 */
export const MEDIA_CARD_ASPECT = 16 / 9

/** 卡面（预览面板）的宽度：卡宽减两边边框。 */
const PANEL_WIDTH = CARD_WIDTH - CARD_BORDER * 2

/** 卡面的高度：卡面 16:9。取整是因为半像素会在卡边上渲染出一条更浅的缝。 */
const PANEL_HEIGHT = Math.round(PANEL_WIDTH / MEDIA_CARD_ASPECT)

/** 一张卡的渲染高度：卡面 + 卡头 + 两道边框。 */
export const CARD_HEIGHT = CARD_HEAD_HEIGHT + CARD_BORDER * 2 + PANEL_HEIGHT

/**
 * 卡面的最小高度。
 *
 * 比例极端的产物（20:1 的横幅、全景条）按真实比例算会让面板矮到十几像素——卡头比画面
 * 还高，那已经不是一张卡。这条下限只管「别塌」，不改变常见比例下的结果：16:9、1:1、
 * 9:16 都远在它之上。
 */
const MIN_PANEL_HEIGHT = 60

/** 一张卡在画布坐标里占的矩形尺寸。 */
export interface CardSize {
  readonly width: number
  readonly height: number
}

/**
 * 一张卡该占多大。
 *
 * **不收形态**：所有卡一样大（v1.79）。签名里没有 kind 不是省事，是让「按形态分尺寸」
 * 这件事写不出来——真要分，得先改这个签名。
 *
 * @returns 所有形态都是 `400×252`（卡面 398×224，正好 16:9）。
 */
export function cardSizeOf(): CardSize {
  return { width: CARD_WIDTH, height: CARD_HEIGHT }
}

/**
 * 一张媒体卡按产物**真实比例**该占多大（F3.11）。
 *
 * 宽仍是 `CARD_WIDTH`，高度由比例反推：面板高 = 398 ÷ aspect，再加上卡头与两道边框。
 * 一张 1:1 的图得到 400×426，一段 9:16 的竖视频得到 400×735——卡片于是长得像它的产物，
 * 卡面上不再有两侧或上下的底色。
 *
 * **不夹比例**：「按真实比例渲染」这句话没有附带条件。极端长图会得到很扁或很高的卡，
 * 那是产物本来的形状；要收窄得先有人明确说收窄到哪儿，而不是这里悄悄夹一刀。
 *
 * @param aspect - 宽 ÷ 高。缺席、非正数、非有限数一律退回默认尺寸（`cardSizeOf()`）。
 * @returns 宽度固定，高度按比例算（整数像素）。
 */
export function cardSizeFor(aspect?: number): CardSize {
  if (aspect === undefined || !Number.isFinite(aspect) || aspect <= 0) return cardSizeOf()
  const panelHeight = Math.round(PANEL_WIDTH / aspect)
  // 太扁的产物（比如 20:1 的横幅）会让面板矮到 20px 以下，卡头比内容还高——那已经不是
  // 「卡片」，是一条缝。给面板留一个下限，再矮就按这条缝坐（而不是让它塌成 0）。
  const panel = Math.max(panelHeight, MIN_PANEL_HEIGHT)
  return { width: CARD_WIDTH, height: CARD_HEAD_HEIGHT + CARD_BORDER * 2 + panel }
}

/**
 * 一张卡该占多大——先看它有没有量过比例。
 *
 * 这是六处消费者真正该调的那一个：`cardSizeFor` 只管「按比例算」，`cardSizeOf` 只管
 * 「默认多大」，而「这张卡到底多大」取决于它自己量没量过。
 *
 * @param card - 任何带可选 `aspect` 的东西（`Card` / `BoardCard` / 座位记录）。
 * @returns 量过比例就是那个比例下的尺寸，否则默认 400×252。
 */
export function sizeOfCard(card: { readonly aspect?: number | undefined }): CardSize {
  return cardSizeFor(card.aspect)
}

/**
 * 卡面的尺寸——媒体卡面、设计截图与迷你帧铺满的那一块。
 *
 * 单独导出是为了让「卡面正好 16:9」这件事**能被判据说出来**：验 `cardPanelOf()` 的宽高比，
 * 比验「高度等于 252」更接近意图（改卡宽时高度会跟着变，比例不该变）。
 *
 * @returns 面板宽 = 卡宽 − 两边边框；面板高 = 卡高 − 卡头 − 两边边框。
 */
export function cardPanelOf(): CardSize {
  return { width: PANEL_WIDTH, height: PANEL_HEIGHT }
}
