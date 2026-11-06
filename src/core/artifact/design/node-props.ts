/**
 * dsh-canvas — 设计属性面板的**判据表**（零依赖纯模块，浏览器/宿主两侧都可见，F2.6）。
 *
 * 面板里那些「有什么可选、按类型显示哪几格、值怎么夹」的问题全在这里答，`design-panels.tsx`
 * 只负责把答案画成控件。抽出来的理由和仓库里别处一样：**同一个判断不许有两个来源**——
 * 尤其是字体名，面板下拉里列一支没注册的字面，场景图会静默回落、文字画成空白（不报错），
 * 而「哪些字面真注册了」这份事实住在 `design-skia.ts` 的 CORE_FONTS 里。
 *
 * 与场景图的关系：这里的 id 是**字符串字面量**，与 `@open-pencil/scene-graph` 的
 * `BlendMode` / `TextAutoResize` 逐字相同（本模块不能 import 它——类型模块保持零依赖，
 * 而引擎 chunk 的类身份必须唯一）。对账由 `tests/core/artifact/design/node-props.spec.ts`
 * 读 scene-graph 的类型声明钉住：那边多一个取值、这边没跟上，判据就红。
 */

import { CJK_TEXT_FAMILY } from './export-font.ts'

/** 默认西文字面名：与 `design-skia.ts` 的 CORE_FONTS 是同一个名字（那边从这里读）。 */
export const LATIN_TEXT_FAMILY = 'Inter'

/** 面板「混合模式」下拉的一格。 */
export interface BlendModeOption {
  id: BlendModeId
  label: string
}

/**
 * 图层混合模式（与场景图 `BlendMode` 同集）。
 *
 * `PASS_THROUGH` 是**容器**的默认模式（子级直接混到容器背后那层去），Figma 也只在 frame 上
 * 露它——但这一格我们照旧列出来：值本身是场景图的合法字段，面板不做「谁能改」的二次裁剪，
 * 免得将来加容器专用入口时又要动这张表。顺序按「常用在前」，`NORMAL` 打头。
 */
export type BlendModeId =
  | 'NORMAL'
  | 'PASS_THROUGH'
  | 'MULTIPLY'
  | 'SCREEN'
  | 'OVERLAY'
  | 'DARKEN'
  | 'LIGHTEN'
  | 'COLOR_DODGE'
  | 'COLOR_BURN'
  | 'HARD_LIGHT'
  | 'SOFT_LIGHT'
  | 'DIFFERENCE'
  | 'EXCLUSION'
  | 'HUE'
  | 'SATURATION'
  | 'COLOR'
  | 'LUMINOSITY'

export const BLEND_MODES: readonly BlendModeOption[] = [
  { id: 'NORMAL', label: '正常' },
  { id: 'PASS_THROUGH', label: '穿透' },
  { id: 'MULTIPLY', label: '正片叠底' },
  { id: 'SCREEN', label: '滤色' },
  { id: 'OVERLAY', label: '叠加' },
  { id: 'DARKEN', label: '变暗' },
  { id: 'LIGHTEN', label: '变亮' },
  { id: 'COLOR_DODGE', label: '颜色减淡' },
  { id: 'COLOR_BURN', label: '颜色加深' },
  { id: 'HARD_LIGHT', label: '强光' },
  { id: 'SOFT_LIGHT', label: '柔光' },
  { id: 'DIFFERENCE', label: '差值' },
  { id: 'EXCLUSION', label: '排除' },
  { id: 'HUE', label: '色相' },
  { id: 'SATURATION', label: '饱和度' },
  { id: 'COLOR', label: '颜色' },
  { id: 'LUMINOSITY', label: '明度' },
]

/**
 * 面板可选的字体族——**只有真注册到 `fontManager` 的那几支**。
 *
 * `weights` 是这支字面实际到货的字重档：Inter 四档（CORE_FONTS 里四份 ttf），中文只有
 * Regular 一份。列一支没有的字重不是「退化成合成粗体」那么轻——这些字面是经
 * `fontManager.markLoaded` 注入的，字号/字重对不上就没有可用的字面，文字直接画不出来。
 * 所以换字体族时用 {@link settleWeight} 把字重降到新字面真有的那一档。
 */
export interface TextFamilyOption {
  id: string
  label: string
  weights: readonly number[]
}

/** 中文字面名从导出那份**同一个常量**读（fig/PDF 两条路按它取字形轮廓，不能各写一份）。 */
export const TEXT_FAMILIES: readonly TextFamilyOption[] = [
  { id: LATIN_TEXT_FAMILY, label: 'Inter（西文）', weights: [400, 500, 600, 700] },
  { id: CJK_TEXT_FAMILY, label: `${CJK_TEXT_FAMILY}（中文）`, weights: [400] },
]

/** 某支字面到货的字重档；不认识的字体族退回 Regular（场景图那份落下来的旧值可能不在表里）。 */
export function weightsOf(family: string): readonly number[] {
  return TEXT_FAMILIES.find((option) => option.id === family)?.weights ?? [400]
}

/**
 * 换字体族时把字重落到**新字面真有的那一档**（就近取，并列时取小的那个）。
 *
 * 这是「同一个东西两个来源」那一类的预防：面板上字重与字体族是两个控件，但**能用的字重由
 * 字体族决定**。换了族却不改字重，写下去的就是一份取不到字面的样式——而失败表现是空白文字。
 *
 * `weights` 是给「本机字体」开的：那些族不在 `TEXT_FAMILIES` 里，字重档由宿主扫出来的
 * 清单决定（苹方有 Regular/Medium/Semibold…），不传就按内置那张表。
 */
export function settleWeight(
  family: string,
  weight: number,
  weights: readonly number[] = weightsOf(family),
): number {
  const list = weights.length > 0 ? weights : [400]
  if (list.includes(weight)) return weight
  return list.reduce((best, candidate) =>
    Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best,
  )
}

/**
 * 字重档的中文名（面板下拉的标签）。
 *
 * 表里只有 400–700 四档：那正是 {@link TEXT_FAMILIES} 里到货的字面（Inter 四支，中文一支），
 * 别的档位写下去没有对应字面可用。表外的值原样回显数字——老文档里那份落下来的字重不该被
 * 悄悄改写成 400（那是一次用户没要的编辑）。
 */
const WEIGHT_LABELS: Readonly<Record<number, string>> = {
  400: '常规 Regular',
  500: '中等 Medium',
  600: '半粗 SemiBold',
  700: '粗 Bold',
}

export function weightLabel(weight: number): string {
  return WEIGHT_LABELS[weight] ?? String(weight)
}

/** 文本水平对齐（与场景图 `SceneNode['textAlignHorizontal']` 同集）。 */
export type TextAlignId = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'

export type TextAlignOption = { id: TextAlignId; label: string }

export const TEXT_ALIGNMENTS: readonly TextAlignOption[] = [
  { id: 'LEFT', label: '左对齐' },
  { id: 'CENTER', label: '居中' },
  { id: 'RIGHT', label: '右对齐' },
  { id: 'JUSTIFIED', label: '两端对齐' },
]

/** 文本尺寸行为（Figma 的「自动宽度/自动高度/固定尺寸」，与场景图 `TextAutoResize` 同集）。 */
export type TextAutoResizeId = 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE'

export const TEXT_AUTO_RESIZE: readonly { id: TextAutoResizeId; label: string }[] = [
  { id: 'WIDTH_AND_HEIGHT', label: '自动宽高' },
  { id: 'HEIGHT', label: '自动高度' },
  { id: 'NONE', label: '固定尺寸' },
  { id: 'TRUNCATE', label: '截断' },
]

// ── 形状特有属性：哪种节点显示哪几格 ─────────────────────────────────────────

/**
 * 一个节点类型该显示哪些「形状特有」的格子。
 *
 * 判据只此一处：面板照着画，别处不许再写一遍 `type === 'polygon'`。Figma 的形状特有属性
 * 就是按类型分的（矩形/框架圆角、椭圆弧、多边形边数、星形角数+内径），而场景图把边数与
 * 星形内径放在**同一对字段**上（`pointCount` / `starInnerRadius`）——所以这里给的是
 * 「这一节要不要露、露的时候叫什么」，不是字段名。
 *
 * 连**标题与格名**也在这里定：面板里再写一次 `read.type === 'star'` 去挑「角数」，
 * 就又多了一个按类型分叉的地方，而它同样该被测到。
 *
 * 圆角不在其中：它长在「形状」模块的通用格上（`design-panels.tsx` 按 `isText` 判）。
 */
export interface ShapeTraits {
  /** 这一节的小标题；空串 = 这个类型没有「边数/角数」这一节。 */
  title: string
  /** 边数/角数那一格的名字。 */
  pointCountLabel: string
  /** 椭圆的弧（起点/扫过角/内径比例）。 */
  arc: boolean
}

const NO_SHAPE_TRAITS: ShapeTraits = { title: '', pointCountLabel: '', arc: false }

/** 类型名一律走 `node.type.toLowerCase()`（引擎的读面就是这么给的）。 */
export function shapeTraitsOf(type: string): ShapeTraits {
  switch (type) {
    case 'polygon':
      return { title: '多边形', pointCountLabel: '边数', arc: false }
    case 'star':
      return { title: '星形', pointCountLabel: '角数', arc: false }
    case 'ellipse':
      return { title: '', pointCountLabel: '', arc: true }
    default:
      return NO_SHAPE_TRAITS
  }
}

/** 这个类型要不要显示「内径」那一格（只有星形有）。 */
export function hasStarInnerRadius(type: string): boolean {
  return type === 'star'
}

/** 边数/角数的合法区间（整数）：Figma 的多边形最少 3 边。 */
export const POINT_COUNT_MIN = 3
export const POINT_COUNT_MAX = 60

/** 边数/角数夹取：非数、越界一律收回区间；取整（半个角画不出来）。 */
export function clampPointCount(value: number): number {
  if (!Number.isFinite(value)) return POINT_COUNT_MIN
  return Math.min(POINT_COUNT_MAX, Math.max(POINT_COUNT_MIN, Math.round(value)))
}

/** 比例夹取（星形内径、椭圆内径都是 0–1 的比值）。 */
export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * 椭圆弧的两种说法：场景图存**起点/终点角**，而 Figma 的界面给的是**起点 + 扫过角**。
 *
 * 面板照 Figma 给（用户想的是「从这里扫过去 90 度」，不是「终点在 180 度」——扫过角为负时
 * 逆推终点还要绕一圈），换算在这里一次性做完。角度都用**度**，与场景图同单位，不归一化：
 * `360` 与 `0` 在场景图里是同一个位置，但写成 `360` 读回来还是 `360`，用户输入不会被吃掉。
 */
export interface ArcAngles {
  startingAngle: number
  endingAngle: number
}

export function arcAngles(start: number, sweep: number): ArcAngles {
  return { startingAngle: start, endingAngle: start + sweep }
}

/** {@link arcAngles} 的反向：终点角 − 起点角 = 扫过角。 */
export function arcSweep(arc: ArcAngles): number {
  return arc.endingAngle - arc.startingAngle
}
