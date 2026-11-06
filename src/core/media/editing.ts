/**
 * dsh-canvas — 媒体卡参数面板的那组参数（媒体编辑台）。
 *
 * 这份参数住在**卡片记录**上（`cardRecord.mediaParams`），由卡面底栏的「参数」面板写入
 * （`setMediaParams`），在**生成的时候**被读出来拼进请求。它是「这张卡怎么做图 / 做片」
 * 的常设设定，与提示词里随口说的那一句不同层：提示词每轮都换，参数设一次就一直生效。
 *
 * **归一是这里的职责**：面板送上来的是一整包用户点过的东西（包括「没设」的字段），写进
 * 记录之前必须在这里收敛成「只存差异」——没设的字段删掉、全没设就是整个不写。这条规则
 * 只在这一处，宿主的 `setMediaParams` 与板面文件的窄读者都调它；抄到第二处就会漂移成
 * 「同一个东西两个来源」。
 *
 * 本模块是纯的：不认识 ctx、不认识卡片、不认识请求体——请求体那一侧在 `core/media/ark.ts`。
 */

/** 图片卡上可设的编辑模式。 */
export const IMAGE_EDIT_MODES = ['inpaint', 'outpaint', 'matting'] as const
export type ImageEditMode = (typeof IMAGE_EDIT_MODES)[number]

/**
 * 图片卡上的**生成参数**档位（面板上半部的五组 chip）。
 *
 * 去向分三层，与相机模式是同一条纪律——能进协议的进协议，进不了协议但影响成片的
 * 走**导演指令**（prompt 后缀），两头都承载不了的只存卡片：
 * - 清晰度 + 比例 → `arkImageBody` 的 `size`（协议字段，真约束出图的画幅）；
 * - 画质、背景 → {@link imageQualityPromptOf} / {@link imageBackgroundPromptOf} 写成
 *   一句追加在 prompt 后的话（协议里没有这两个旋钮，硬编字段等于发明服务端不认识的东西）；
 * - 生成数量 → 不进单次请求（协议一次一张），由宿主按数量循环发起 N 次生成。
 */
export const IMAGE_QUALITIES = ['low', 'standard', 'high', 'ultra', 'extreme'] as const
export type ImageQuality = (typeof IMAGE_QUALITIES)[number]

export const IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number]

export const IMAGE_BACKGROUNDS = ['auto', 'keep', 'transparent'] as const
export type ImageBackground = (typeof IMAGE_BACKGROUNDS)[number]

/** 出图画幅。顺序即面板顺序；换算 WxH 时按 `a:b` 解析，解析不动的档位不该进这份清单。 */
export const IMAGE_RATIOS = [
  '1:1', '1:2', '2:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21',
] as const
export type ImageRatio = (typeof IMAGE_RATIOS)[number]

/** 一次「生成」出的张数。协议一次一张，多张由宿主循环兑现。 */
export const IMAGE_COUNTS = [1, 2, 4] as const
export type ImageCount = (typeof IMAGE_COUNTS)[number]

/** 清晰度档位的基准边长（正方形基准，面积意义下的 1K/2K/4K）。 */
export const RESOLUTION_BASE: Record<ImageResolution, number> = { '1K': 1024, '2K': 2048, '4K': 4096 }

/**
 * 视频卡上可设的相机模式。
 *
 * 协议层（Seedance 的请求体）只有**一个**相机字段：`camera_fixed` 布尔——「固定机位」。
 * 推、拉、摇这些运镜语言在协议里没有承载位置，它们属于**提示词层**（Seedance 的提示词
 * 指南就是这么教的），所以这里的运镜档位最终由 {@link cameraPromptOf} 变成一句写进
 * prompt 的导演指令，而 `fixed` 由 `arkVideoBody` 变成协议字段。两种去向都必须各自诚实：
 * 把运镜硬塞进协议等于发明一个服务端不认识的字段。
 */
export const CAMERA_MODES = ['fixed', 'push_in', 'pull_out', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down'] as const
export type CameraMode = (typeof CAMERA_MODES)[number]

/** 一张媒体卡上设下的生成参数。每个字段都是「设了才有」，没设即不出现。 */
export interface MediaParams {
  /** 图片编辑模式（仅图片卡）。 */
  editMode?: ImageEditMode
  /** 局部重绘的蒙版：项目相对路径、`https://…` 或 `data:…`（仅图片卡）。 */
  maskPath?: string
  /** 扩图的目标尺寸，如 `2048x2048`；空 = 交给模型（仅图片卡）。 */
  outpaintSize?: string
  /** 首帧参考图（仅视频卡）；与调用方当次给的参考图是同一个槽位。 */
  firstFramePath?: string
  /** 尾帧参考图（仅视频卡）。 */
  lastFramePath?: string
  /** 相机模式（仅视频卡）。 */
  camera?: CameraMode
  /** 画质档位（仅图片卡）；协议无字段，走导演指令。 */
  quality?: ImageQuality
  /** 清晰度档位（仅图片卡）；与 ratio 一起换算成协议的 `size`。 */
  resolution?: ImageResolution
  /** 背景档位（仅图片卡）；协议无字段，走导演指令。 */
  background?: ImageBackground
  /** 出图画幅（仅图片卡）；与 resolution 一起换算成协议的 `size`。 */
  ratio?: ImageRatio
  /** 一次生成几张（仅图片卡）；协议一次一张，由宿主循环兑现。 */
  count?: ImageCount
}

/** 面板送上来的一包原始值：每个字段都可能没设、可能是空串、可能是认不出的档位。 */
export interface RawMediaParams {
  readonly editMode?: unknown
  readonly maskPath?: unknown
  readonly outpaintSize?: unknown
  readonly firstFramePath?: unknown
  readonly lastFramePath?: unknown
  readonly camera?: unknown
  readonly quality?: unknown
  readonly resolution?: unknown
  readonly background?: unknown
  readonly ratio?: unknown
  readonly count?: unknown
}

/** 只收非空字符串；其余（空串、空白、非字符串）一律算「没给」。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 只收清单里的档位；认不出的一律算「没给」，而不是替用户改写成最近似的那一档。 */
function oneOf<T extends string>(value: unknown, modes: readonly T[]): T | undefined {
  return typeof value === 'string' ? (modes.find((mode) => mode === value.trim()) as T | undefined) : undefined
}

/** 数量是唯一的数值档位：只收 1/2/4 这三个整数，其余（含小数、负数、字符串数字）算「没给」。 */
function countOf(value: unknown): ImageCount | undefined {
  return (IMAGE_COUNTS as readonly number[]).includes(value as number) ? (value as ImageCount) : undefined
}

/**
 * 把一包原始值收敛成「只存差异」的参数；**全都没设就是 `undefined`**——意思是
 * 「这张卡没有参数」，而不是「有一包空参数」。落进记录的形状因此只有两种：不出现，
 * 或者每一项都真的设过。
 */
export function normalizeMediaParams(raw: RawMediaParams | undefined | null): MediaParams | undefined {
  if (raw === undefined || raw === null) return undefined
  const params: MediaParams = {}
  const editMode = oneOf(raw.editMode, IMAGE_EDIT_MODES)
  if (editMode !== undefined) params.editMode = editMode
  const maskPath = text(raw.maskPath)
  if (maskPath !== undefined) params.maskPath = maskPath
  const outpaintSize = text(raw.outpaintSize)
  if (outpaintSize !== undefined) params.outpaintSize = outpaintSize
  const firstFramePath = text(raw.firstFramePath)
  if (firstFramePath !== undefined) params.firstFramePath = firstFramePath
  const lastFramePath = text(raw.lastFramePath)
  if (lastFramePath !== undefined) params.lastFramePath = lastFramePath
  const camera = oneOf(raw.camera, CAMERA_MODES)
  if (camera !== undefined) params.camera = camera
  const quality = oneOf(raw.quality, IMAGE_QUALITIES)
  if (quality !== undefined) params.quality = quality
  const resolution = oneOf(raw.resolution, IMAGE_RESOLUTIONS)
  if (resolution !== undefined) params.resolution = resolution
  const background = oneOf(raw.background, IMAGE_BACKGROUNDS)
  if (background !== undefined) params.background = background
  const ratio = oneOf(raw.ratio, IMAGE_RATIOS)
  if (ratio !== undefined) params.ratio = ratio
  const count = countOf(raw.count)
  if (count !== undefined) params.count = count
  return Object.keys(params).length === 0 ? undefined : params
}

/**
 * 图片编辑模式写给生图模型的**导演指令**（追加在用户 prompt 之后）。
 *
 * 返回 `''` 表示这句不需要说：没设模式，或者模式本身在协议里有自己的字段（inpaint 的
 * 蒙版走 `mask`，outpaint 的目标尺寸走 `size`，都不靠 prompt 传达）——但「这里只画蒙版
 * 区域」「扩展出去要连成一幅」这句话协议字段替不了，仍然要写。
 */
export function imageEditPromptOf(params: MediaParams | undefined): string {
  switch (params?.editMode) {
    case 'inpaint':
      return '，只重绘蒙版覆盖的区域，蒙版之外的画面保持原样'
    case 'outpaint':
      return params.outpaintSize === undefined
        ? '，将画面向四周自然扩展，扩展部分与原画面风格一致'
        : `，将画面向四周自然扩展至 ${params.outpaintSize}，扩展部分与原画面风格一致`
    case 'matting':
      return '，抠出画面主体，背景置为透明'
    default:
      return ''
  }
}

/**
 * 相机模式的**运镜导演指令**（追加在用户 prompt 之后）。
 *
 * `fixed` 回 `''`：固定机位走协议字段（`camera_fixed`），不是一句话能说清的东西。
 * 其余档位在这里逐字给出——运镜措辞与成片效果强相关，每次生成换一种说法就是换一种片子。
 */
export function cameraPromptOf(camera: CameraMode | undefined): string {
  switch (camera) {
    case 'push_in':
      return '，镜头缓慢平稳地向前推进'
    case 'pull_out':
      return '，镜头缓慢平稳地向后拉远'
    case 'pan_left':
      return '，镜头平稳地向左横摇'
    case 'pan_right':
      return '，镜头平稳地向右横摇'
    case 'tilt_up':
      return '，镜头缓慢平稳地向上摇'
    case 'tilt_down':
      return '，镜头缓慢平稳地向下摇'
    default:
      return ''
  }
}

/**
 * 画质档位的导演指令。`standard` 回 `''`：它是模型的默认行为，多说一个字都是噪音。
 *
 * 画质在生图协议里没有字段——「多细」只能靠话说给模型听。措辞与成片质感强相关，
 * 所以逐字给在这里，而不是让调用方现编。
 */
export function imageQualityPromptOf(quality: ImageQuality | undefined): string {
  switch (quality) {
    case 'low':
      return '，简洁轻量的画面，细节从简'
    case 'high':
      return '，高清细腻的画面质感'
    case 'ultra':
      return '，超高细节，纹理精细、画质锐利'
    case 'extreme':
      return '，极致细节，精微纹理与电影级质感'
    default:
      return ''
  }
}

/**
 * 背景档位的导演指令。`auto` 回 `''`：交给模型自己决定。
 *
 * 协议同样没有背景字段；「透明背景」在文生图里只能是一句指令，成不成要看模型。
 */
export function imageBackgroundPromptOf(background: ImageBackground | undefined): string {
  switch (background) {
    case 'keep':
      return '，保持画面原有的背景不变'
    case 'transparent':
      return '，主体之外的背景完全透明'
    default:
      return ''
  }
}

/**
 * 清晰度 + 比例 → 协议的 `size` 字段值。
 *
 * - 只设了清晰度：直接给 token（`'2K'`），协议认识这个词，画幅由模型自定；
 * - 设了比例：换算成**像素宽高** `WxH`——比例是硬约束，token 表达不了 21:9。
 *   以清晰度的基准边长为面积基准（`RESOLUTION_BASE`），宽 = 基准 × √(a/b)、
 *   高 = 基准 × √(b/a)，向 32 对齐（编码器喜欢整块）；没设清晰度按 2K。
 * - 两样都没设：`undefined`，请求体里不写 `size`，完全交给模型。
 *
 * 返回 `undefined` 与返回空串是两种失败：前者是「没设」（正常路径），后者不可能是
 * 合法产出——比例解析不出来时宁可退回 token，也不发一个服务端消化不了的值。
 */
export function imageSizeOf(resolution: ImageResolution | undefined, ratio: ImageRatio | undefined): string | undefined {
  if (ratio === undefined) return resolution
  const [a, b] = ratio.split(':').map((part) => Number.parseInt(part, 10))
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return resolution
  const base = RESOLUTION_BASE[resolution ?? '2K']
  const align = (value: number): number => Math.max(32, Math.round(value / 32) * 32)
  const width = align(base * Math.sqrt(a / b))
  const height = align(base * Math.sqrt(b / a))
  return `${width}x${height}`
}
