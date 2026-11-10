/**
 * dsh-canvas — live2d-lite 模型格式（live2d 卡的产物本体）。
 *
 * 一张 live2d 卡的产物是**一份 JSON**（`live2d/名字.live2d.json`），它描述「一张贴图
 * 怎么动起来」：贴图路径、一个循环时长、以及三组参数化的动作（呼吸 / 摇摆 / 倾头）。
 * 贴图是项目里的另一份图片文件，模型里以**相对路径**引用——引用即数据，贴图照旧是一张
 * 普通图片卡也能读的文件，被删了模型才坏，坏的方式与 markdown 引用坏图一致。
 *
 * 「为什么不是 .moc3」：真正的 Live2D 模型只能在官方 Cubism Editor 里制作，从一张图片
 * 程序化地生成它做不到，且官方 SDK 的分发有许可负担。live2d-lite 走的是另一条现实的路：
 * 网格切分 + 参数化变形（顶点位移按离锚点的距离加权，离锚点越远动得越多），零第三方
 * 依赖、无许可问题，导出的帧序列各游戏引擎直接当素材用。
 *
 * **所有动作都是正弦，且周期由「每循环几拍」表达**（整数），所以任意时刻 t 的画面在
 * `t + loop` 处逐位重现——导出帧序列因此天然无缝循环，不需要任何补间收尾。这条性质
 * 由 {@link ./rig.ts} 与本文件共同钉住：模型只存整数拍数，渲染只算
 * `sin(2π · cycles · t / loop)`。
 *
 * 本模块是纯的：不认识 fs、不认识卡片，只认 JSON。归一（读不懂的字段收敛掉、缺省补齐）
 * 只在这里——宿主写盘、客户端渲染、导出打包读到的都是同一个函数的产出。
 */

/** 格式标记：一份 JSON 是不是 live2d-lite 模型，先认这个串。 */
export const LIVE2D_FORMAT = 'dsh-live2d-lite'

/** 当前格式版本。读侧对更高版本如实拒绝，而不是猜它长什么样。 */
export const LIVE2D_VERSION = 1

/** 产物的扩展名（含点）。detectKind 按 basename 的这个尾巴认它。 */
export const LIVE2D_EXTENSION = '.live2d.json'

/** 循环时长（秒）的缺省：呼吸两拍、摇摆一拍，4.8s 是三者都整除又不太拖沓的一档。 */
export const DEFAULT_LOOP_SECONDS = 4.8

/** 一个关键帧：`t` 是循环内的比例（0–1，不含 1——1 与 0 是同一个点），`v` 是动作取值（-1 … 1）。 */
export interface Live2dKeyframe {
  t: number
  v: number
}

/**
 * 一组动作：每循环几拍（整数，决定 seamless）与振幅（相对贴图高的比例）。
 *
 * **两条驱动路**，互斥、正弦是缺省：
 * - 不带 `keys`：正弦参数化（`cycles` × `phase`），「活着的默认样子」；
 * - 带 `keys`（≥2 个）：关键帧驱动——时间线上排出来的曲线，`cycles`/`phase` 退位。
 *   关键帧在 `[0,1)` 上环绕插值（尾键 → 首键），所以 `t+loop` 处逐位重现的无缝性质
 *   与正弦同源——编辑器随便加键都破不了循环。
 */
export interface Live2dMotion {
  /** 每个循环里的整周期数。**必须是整数**——它保证了 `t + loop` 处画面逐位重现。 */
  cycles: number
  /** 振幅，以贴图高度为 1 的比例。0 = 这组动作关掉。 */
  amplitude: number
  /** 相位（0–1，一个周期内的偏移），用来让三组动作错开节拍。 */
  phase: number
  /** 关键帧（可选）：存在且 ≥2 个时驱动这组动作，正弦参数退位。 */
  keys?: Live2dKeyframe[]
}

/** 一处网格雕刻：`'col,row'`（网格顶点序号）→ uv 位移（贴图高为 1）。 */
export type Live2dOffsets = Record<string, [number, number]>

/** 静态变形：用户在网格模式亲手摆出来的形状，不随时间动（Cubism 的「形状」那一半）。 */
export interface Live2dDeform {
  /** 稀疏表：只存动过的顶点。空表 = 没雕过。 */
  offsets: Live2dOffsets
}

/** 雕刻位移的上限（贴图高的比例）：再大就是撕图，不是造型。 */
export const DEFORM_MAX = 0.15

/**
 * 一根骨骼：关节的 rest 位置（uv）与可选的父级。
 *
 * `parent` 必须指向**数组里更早**的一根——先父后子的次序既让层级合成一遍扫完，也
 * 天然排除成环。名字是蒙皮与轨道表的键，同一份模型里不许重名。
 */
export interface Live2dBone {
  name: string
  x: number
  y: number
  parent?: string
}

/** 一根骨骼的驱动曲线（缺 = 静止在 rest 位）。 */
export interface Live2dBoneTrack {
  /** 旋转关键帧：v ∈ [-1,1] 映射 ±{@link ./bones.ts} 的 `BONE_ROT_MAX` 弧度。 */
  rot?: Live2dKeyframe[]
}

/** 骨骼轨道表：骨骼名 → 该骨的曲线。只给铺了曲线的骨骼写条目。 */
export type Live2dBoneTracks = Record<string, Live2dBoneTrack>

/** 一份归一后的 live2d-lite 模型。 */
export interface Live2dModel {
  format: typeof LIVE2D_FORMAT
  version: number
  /** 贴图路径：**相对本 JSON 所在目录**（`少女.png`），项目根相对以 `/` 开头。 */
  texture: string
  /** 循环时长（秒），正数。 */
  loop: number
  /** 动作锚点（归一化贴图坐标，0–1）：离它越远动得越多。人物贴图锚在脚底 (0.5, 1)。 */
  anchor: { x: number; y: number }
  /** 呼吸：纵向的起伏压缩（贴图顶端动得最多）。 */
  breath: Live2dMotion
  /** 摇摆：横向的左右倾（同上，顶端动得最多）。 */
  sway: Live2dMotion
  /** 倾头：绕锚点的小角度旋转。 */
  tilt: Live2dMotion
  /** 静态变形（可选）：网格模式雕出来的形状，缺席 = 没雕过。 */
  deform?: Live2dDeform
  /** 骨骼链（可选）：rest 位置先父后子排布；缺席 = 没绑过骨骼。 */
  bones?: Live2dBone[]
  /** 骨骼轨道（可选）：骨骼名 → 旋转曲线；缺席或缺某骨 = 那根骨静止。 */
  boneTracks?: Live2dBoneTracks
  /** 生成时的提示词，只作出处记录，渲染不读它。 */
  prompt: string
}

/** 任何来路的一包 JSON：每个字段都可能缺席、类型不对、或者离谱。 */
export type RawLive2dModel = Record<string, unknown>

/** 只收非空字符串；其余算「没给」。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 收一个有限数；其余（缺、字符串数字、NaN、无穷）算「没给」。 */
function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 收一个夹进 [min, max] 的数；没给算 `fallback`。 */
function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback
  return Math.min(max, Math.max(min, value))
}

/** 收一组动作：拍数取整夹进 [0, 8]，振幅夹进 [0, 0.2]（0.2 已是夸张的动作），相位夹进 [0, 1)。 */
function motionOf(raw: unknown, fallback: Live2dMotion): Live2dMotion {
  if (typeof raw !== 'object' || raw === null) return fallback
  const entry = raw as Record<string, unknown>
  const cycles = finite(entry.cycles)
  const amplitude = finite(entry.amplitude)
  const phase = finite(entry.phase)
  return {
    cycles: cycles === undefined ? fallback.cycles : Math.min(8, Math.max(0, Math.round(cycles))),
    amplitude: clamp(amplitude, 0, 0.2, fallback.amplitude),
    phase: clamp(phase, 0, 0.999, fallback.phase),
    keys: keysOf(entry.keys),
  }
}

/** 关键帧条数上限：时间线不是无限画布，64 个键足够任何一支曲线说话。 */
export const MAX_KEYS = 64

/** 收一支关键帧曲线：t 夹进 [0,1) 量化到千分位、v 夹进 [-1,1] 量化到千分位，按 t 排序；凑不足两键不算曲线。 */
function keysOf(raw: unknown): Live2dKeyframe[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const keys: Live2dKeyframe[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>
    const t = finite(item.t)
    const v = finite(item.v)
    if (t === undefined || v === undefined) continue
    keys.push({
      t: Math.round(clamp(t, 0, 0.999, 0) * 1000) / 1000,
      v: Math.round(clamp(v, -1, 1, 0) * 1000) / 1000,
    })
  }
  if (keys.length < 2) return undefined
  keys.sort((a, b) => a.t - b.t)
  return keys.slice(0, MAX_KEYS)
}

/**
 * 收一张雕刻表：键必须是 `整数,整数` 的顶点序号，值是一对夹进 ±{@link DEFORM_MAX} 的
 * 位移（量化到万分之一）。越界序号不报错也留着——渲染侧按序号查表，查不到的键自然
 * 哑火；空表整体收掉（「没雕过」就是没有 deform）。
 */
function deformOf(raw: unknown): Live2dDeform | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const offsets = (raw as Record<string, unknown>).offsets
  if (typeof offsets !== 'object' || offsets === null) return undefined
  const result: Live2dOffsets = {}
  for (const [key, value] of Object.entries(offsets as Record<string, unknown>)) {
    if (!/^\d+,\d+$/.test(key) || !Array.isArray(value)) continue
    const du = finite(value[0])
    const dv = finite(value[1])
    if (du === undefined || dv === undefined) continue
    const q = (n: number): number => Math.round(clamp(n, -DEFORM_MAX, DEFORM_MAX, 0) * 10000) / 10000
    result[key] = [q(du), q(dv)]
  }
  if (Object.keys(result).length === 0) return undefined
  // 稳定序列化的另一半：顶点序号按字典序落盘，谁先雕、谁后雕不影响字节。
  const sorted: Live2dOffsets = {}
  for (const key of Object.keys(result).sort()) sorted[key] = result[key] as [number, number]
  return { offsets: sorted }
}

/**
 * 收一份骨骼链：名字唯一、坐标夹进 [0,1] 量化到千分位、父级必须是**数组里更早**的
 * 一根（先父后子，天然无环）。无名、重名、指向自己或后人的统统丢掉——骨骼链是编辑
 * 器造出来的，读侧只收干净的。超过 {@link ./bones.ts} 的 `MAX_BONES` 截断。
 */
function bonesOf(raw: unknown): Live2dBone[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const bones: Live2dBone[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>
    const name = text(item.name)
    const x = finite(item.x)
    const y = finite(item.y)
    if (name === undefined || x === undefined || y === undefined) continue
    if (bones.some((bone) => bone.name === name)) continue
    const parent = text(item.parent)
    const known = parent === undefined ? true : bones.some((bone) => bone.name === parent)
    bones.push({
      name,
      x: Math.round(clamp(x, 0, 1, 0.5) * 1000) / 1000,
      y: Math.round(clamp(y, 0, 1, 0.5) * 1000) / 1000,
      ...(known && parent !== undefined ? { parent } : {}),
    })
    if (bones.length >= MAX_BONES_LIMIT) break
  }
  return bones.length === 0 ? undefined : bones
}

/** 骨骼条数上限的真源在 `core/live2d/bones.ts`；这里复制常量避免 core 内新增环。 */
const MAX_BONES_LIMIT = 12

/**
 * 收骨骼轨道表：键必须是骨骼清单里的名字，`rot` 走与动作同一副 `keysOf`（量化、
 * 排序、两键起）。查无此骨的条目整条丢——轨道跟骨骼走，骨骼没了轨道没有独立生命。
 */
function boneTracksOf(raw: unknown, bones: Live2dBone[] | undefined): Live2dBoneTracks | undefined {
  if (typeof raw !== 'object' || raw === null || bones === undefined) return undefined
  const result: Live2dBoneTracks = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!bones.some((bone) => bone.name === name)) continue
    if (typeof value !== 'object' || value === null) continue
    const rot = keysOf((value as Record<string, unknown>).rot)
    if (rot === undefined) continue
    result[name] = { rot }
  }
  return Object.keys(result).length === 0 ? undefined : result
}

/** 三组动作的出厂值：能看出「活着」，又不会动得像喝醉。 */export const DEFAULT_MOTIONS: Readonly<Record<'breath' | 'sway' | 'tilt', Live2dMotion>> = {
  breath: { cycles: 2, amplitude: 0.012, phase: 0 },
  sway: { cycles: 1, amplitude: 0.01, phase: 0 },
  tilt: { cycles: 1, amplitude: 0.008, phase: 0.25 },
}

/**
 * 把一包原始 JSON 收敛成模型；收敛不出来的整份拒绝（`undefined`）。
 *
 * 贴图路径是唯一的**硬条件**：没有它模型就是一具空壳，渲染无从谈起——所以它缺席时
 * 返回 `undefined` 而不是补一个缺省。其余字段全部有出厂值：一份手写的最小 JSON
 * （`{ format, texture }`）就是一份能跑的模型。
 */
export function normalizeLive2dModel(raw: RawLive2dModel | undefined | null): Live2dModel | undefined {
  if (raw === undefined || raw === null) return undefined
  const format = text(raw.format)
  if (format !== LIVE2D_FORMAT) return undefined
  const version = finite(raw.version)
  if (version !== undefined && version > LIVE2D_VERSION) return undefined
  const texture = text(raw.texture)
  if (texture === undefined) return undefined
  const loop = finite(raw.loop)
  const anchor = (typeof raw.anchor === 'object' && raw.anchor !== null ? raw.anchor : {}) as Record<string, unknown>
  const motions = (typeof raw.motions === 'object' && raw.motions !== null ? raw.motions : {}) as Record<string, unknown>
  const bones = bonesOf(raw.bones)
  const boneTracks = boneTracksOf(raw.boneTracks, bones)
  return {
    format: LIVE2D_FORMAT,
    version: LIVE2D_VERSION,
    texture,
    loop: clamp(loop, 1, 60, DEFAULT_LOOP_SECONDS),
    anchor: {
      x: clamp(finite(anchor.x), 0, 1, 0.5),
      y: clamp(finite(anchor.y), 0, 1, 1),
    },
    breath: motionOf(motions.breath, DEFAULT_MOTIONS.breath),
    sway: motionOf(motions.sway, DEFAULT_MOTIONS.sway),
    tilt: motionOf(motions.tilt, DEFAULT_MOTIONS.tilt),
    deform: deformOf(raw.deform),
    ...(bones === undefined ? {} : { bones }),
    ...(boneTracks === undefined ? {} : { boneTracks }),
    prompt: text(raw.prompt) ?? '',
  }
}
/** 稳定序列化：字段顺序固定，两次生成同一模型得到逐字节相同的文本。 */
export function serializeLive2dModel(model: Live2dModel): string {
  return `${JSON.stringify(
    {
      format: model.format,
      version: model.version,
      texture: model.texture,
      loop: model.loop,
      anchor: model.anchor,
      motions: { breath: model.breath, sway: model.sway, tilt: model.tilt },
      ...(model.deform === undefined ? {} : { deform: model.deform }),
      ...(model.bones === undefined ? {} : { bones: model.bones }),
      ...(model.boneTracks === undefined ? {} : { boneTracks: model.boneTracks }),
      prompt: model.prompt,
    },
    null,
    2,
  )}\n`
}

/** 产物路径的目录段（不带尾斜杠）；产物在项目根上时是空串。 */
function directoryOf(file: string): string {
  const at = file.lastIndexOf('/')
  return at === -1 ? '' : file.slice(0, at)
}

/**
 * 贴图路径（模型内的相对引用）→ 项目根相对路径。
 *
 * `/` 开头的引用本来就是项目根相对，原样交回；其余以模型文件所在目录为基准逐段收
 * （`..` 只允许收到根为止——收出根的引用在写盘侧根本不该存在，这里照样拒绝）。
 * 与 markdown 插图那条（`client/.../markdown-image.ts`）是同一条规则，但那边带
 * `hostBase` 拼的是 URL，这边拼的是路径——两边各活各的，谁也不该抄谁。
 */
export function texturePathOf(modelFile: string, texture: string): string | undefined {
  const trimmed = texture.trim()
  if (trimmed === '') return undefined
  if (trimmed.startsWith('/')) return trimmed.slice(1) || undefined
  const parts = directoryOf(modelFile) === '' ? [] : directoryOf(modelFile).split('/')
  for (const segment of trimmed.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.length === 0 ? undefined : parts.join('/')
}

/**
 * 一次生成落在哪张贴图上：与模型文件同目录、同词干的 `.png`。
 *
 * `live2d/少女.live2d.json` → `live2d/少女.png`。贴图跟模型住在一起，整张卡连图带模型
 * 搬一次目录就搬全了；不用 `images/` 是因为它是模型的内部零件，不是一张独立的图卡。
 */
export function defaultTexturePathOf(modelFile: string): string {
  const directory = directoryOf(modelFile)
  const stem = modelFile.slice(directory.length + (directory === '' ? 0 : 1)).replace(/\.live2d\.json$/i, '')
  const name = `${stem}.png`
  return directory === '' ? name : `${directory}/${name}`
}

/**
 * 贴图的绝对位置 → 模型里的相对引用。
 *
 * 生成时贴图可能在任何地方（上游图卡在 `images/`、自动落在 `live2d/`）；模型里引用它
 * 一律走这条：同目录就写裸文件名（搬目录不断链），否则写项目根相对的 `/` 前缀形式。
 * 算不出相对关系（不可能，项目内必有公共前缀；防御分支）就退回根相对。
 */
export function textureReferenceOf(modelFile: string, texturePath: string): string {
  const directory = directoryOf(modelFile)
  if (directory !== '' && texturePath.startsWith(`${directory}/`)) {
    return texturePath.slice(directory.length + 1)
  }
  return `/${texturePath.replace(/^\/+/, '')}`
}
