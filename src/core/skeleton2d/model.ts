/**
 * dsh-canvas — skeleton2d-lite 模型格式（skeleton2d 卡的产物本体）。
 *
 * 一张 skeleton2d 卡的产物是**一份 JSON**（`skeleton2d/名字.skeleton2d.json`），它描述「一张贴图
 * 怎么动起来」：贴图路径、一个循环时长、以及三组参数化的动作（呼吸 / 摇摆 / 倾头）。
 * 贴图是项目里的另一份图片文件，模型里以**相对路径**引用——引用即数据，贴图照旧是一张
 * 普通图片卡也能读的文件，被删了模型才坏，坏的方式与 markdown 引用坏图一致。
 *
 * 「按 Godot 的 Skeleton2D 建模」：一份模型 = **一具骨架**（`Bone2D` 那样的父子关节，
 * rest 位置 + 旋转轨道）＋ **若干绑定到它上面的网格层**（`Polygon2D` 挂 skeleton 那种）。
 * 层是分开画的：每层从整幅贴图上裁一块矩形、带自己的掩码与网格密度，可以只绑一部分骨。
 *
 * 「为什么不是 .moc3」：真正的 Live2D 模型只能在官方 Cubism Editor 里制作，从一张图片
 * 程序化地生成它做不到，且官方 SDK 的分发有许可负担。这份格式走的是另一条现实的路：
 * 剪影分层 + 网格蒙皮 + 参数化变形（顶点位移按离锚点的距离加权），零第三方依赖、
 * 无许可问题，导出的帧序列与 DragonBones 骨架包各引擎直接当素材用。
 *
 * **所有动作都是正弦，且周期由「每循环几拍」表达**（整数），所以任意时刻 t 的画面在
 * `t + loop` 处逐位重现——导出帧序列因此天然无缝循环，不需要任何补间收尾。这条性质
 * 由 {@link ./rig.ts} 与本文件共同钉住：模型只存整数拍数，渲染只算
 * `sin(2π · cycles · t / loop)`。
 *
 * 本模块是纯的：不认识 fs、不认识卡片，只认 JSON。归一（读不懂的字段收敛掉、缺省补齐）
 * 只在这里——宿主写盘、客户端渲染、导出打包读到的都是同一个函数的产出。
 */

/** 格式标记：一份 JSON 是不是 skeleton2d-lite 模型，先认这个串。 */
export const SKELETON2D_FORMAT = 'dsh-skeleton2d'

/** 当前格式版本。读侧对更高版本如实拒绝，而不是猜它长什么样。 */
export const SKELETON2D_VERSION = 1

/**
 * v3（Rigby2D 改道）的版本号：外壳 + 内嵌 Rigby2D 项目。v2 从未发布过（v1.0 方案的
 * 扩展字段没落地就被 v2.0 改道推翻），所以版本号从 1 直接跳到 3——与两份方案文档的
 * 口径一致。归一按版本分派：`1`（或缺席）走轻模型，`3` 走外壳，其余拒绝。
 */
export const SKELETON2D_RIGBY_VERSION = 3

/** 产物的扩展名（含点）。detectKind 按 basename 的这个尾巴认它。 */
export const SKELETON2D_EXTENSION = '.skeleton2d.json'

/** 循环时长（秒）的缺省：呼吸两拍、摇摆一拍，4.8s 是三者都整除又不太拖沓的一档。 */
export const DEFAULT_LOOP_SECONDS = 4.8

/** 一个关键帧：`t` 是循环内的比例（0–1，不含 1——1 与 0 是同一个点），`v` 是动作取值（-1 … 1）。 */
export interface Skeleton2dKeyframe {
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
export interface Skeleton2dMotion {
  /** 每个循环里的整周期数。**必须是整数**——它保证了 `t + loop` 处画面逐位重现。 */
  cycles: number
  /** 振幅，以贴图高度为 1 的比例。0 = 这组动作关掉。 */
  amplitude: number
  /** 相位（0–1，一个周期内的偏移），用来让三组动作错开节拍。 */
  phase: number
  /** 关键帧（可选）：存在且 ≥2 个时驱动这组动作，正弦参数退位。 */
  keys?: Skeleton2dKeyframe[]
}

/** 一处网格雕刻：`'col,row'`（网格顶点序号）→ uv 位移（贴图高为 1）。 */
export type Skeleton2dOffsets = Record<string, [number, number]>

/** 静态变形：用户在网格模式亲手摆出来的形状，不随时间动（Cubism 的「形状」那一半）。 */
export interface Skeleton2dDeform {
  /** 稀疏表：只存动过的顶点。空表 = 没雕过。 */
  offsets: Skeleton2dOffsets
}

/** 雕刻位移的上限（贴图高的比例）：再大就是撕图，不是造型。 */
export const DEFORM_MAX = 0.15

/**
 * 一根骨骼：关节的 rest 位置（uv）与可选的父级。
 *
 * `parent` 必须指向**数组里更早**的一根——先父后子的次序既让层级合成一遍扫完，也
 * 天然排除成环。名字是蒙皮与轨道表的键，同一份模型里不许重名。
 */
export interface Skeleton2dBone {
  name: string
  x: number
  y: number
  parent?: string
}

/** 一根骨骼的驱动曲线（缺 = 静止在 rest 位）。 */
export interface Skeleton2dBoneTrack {
  /** 旋转关键帧：v ∈ [-1,1] 映射 ±{@link ./bones.ts} 的 `BONE_ROT_MAX` 弧度。 */
  rot?: Skeleton2dKeyframe[]
}

/** 骨骼轨道表：骨骼名 → 该骨的曲线。只给铺了曲线的骨骼写条目。 */
export type Skeleton2dBoneTracks = Record<string, Skeleton2dBoneTrack>

/** 一层网格的矩形：在整幅贴图上的位置与大小（uv，0–1）。 */
export interface Skeleton2dRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 一层：从整幅贴图上裁下的一块，挂在自己的网格上。
 *
 * 掩码是**可选的**：裁一块矩形就够用的层（头、躯干）不写掩码，整块不透明；手臂、腿
 * 这类要从邻层里抠出来的，掩码把「属于这层的像素」标出来——没有掩码的层画出矩形，
 * 有掩码的层画出形状，两者用同一套网格与蒙皮算术。
 *
 * 掩码写成**游程长度**（`"12,340,5,88"`，逗号分隔，第一段是透明），量化到层内像素
 * 网格：一串整数比一段 base64 更像「文件即产物」——打开 JSON 能读出这一层长什么样。
 */
export interface Skeleton2dLayer {
  /** 层名：模型内唯一，也是轨道、判据与导出里的槽名。 */
  name: string
  rect: Skeleton2dRect
  /** 层内掩码（游程长度，空格与换行无关）；缺席 = 整块不透明。 */
  mask?: string
  /** 掩码的栅格宽高（像素）：掩码串按这个尺寸逐行扫，缺省按矩形长宽比推。 */
  mw?: number
  mh?: number
  /** 层内网格列数 / 行数（2–32）：层越小，格胞越细。 */
  cols: number
  rows: number
  /** 只绑这几根骨（名字）；缺席 = 全部骨骼按距离蒙皮。 */
  bones?: string[]
  /** 层内雕刻：键是层内网格的 `列,行`（与整幅那一份同一个结构，只是坐标系在层内）。 */
  deform?: Skeleton2dDeform
}

/** 层内网格密度的缺省与上下限：12×12 够摆一块肢体，格数再多每帧顶点上传就白给。 */
export const LAYER_GRID_DEFAULT = 12
export const LAYER_GRID_MIN = 2
export const LAYER_GRID_MAX = 32

/** 一层掩码的字符上限：超过就是坏数据（正常一层几十到几千个游程）。 */
export const LAYER_MASK_MAX_CHARS = 200_000

/** 一份归一后的 skeleton2d-lite 模型。 */
export interface Skeleton2dModel {
  format: typeof SKELETON2D_FORMAT
  version: number
  /** 贴图路径：**相对本 JSON 所在目录**（`少女.png`），项目根相对以 `/` 开头。 */
  texture: string
  /** 循环时长（秒），正数。 */
  loop: number
  /** 动作锚点（归一化贴图坐标，0–1）：离它越远动得越多。人物贴图锚在脚底 (0.5, 1)。 */
  anchor: { x: number; y: number }
  /** 呼吸：纵向的起伏压缩（贴图顶端动得最多）。 */
  breath: Skeleton2dMotion
  /** 摇摆：横向的左右倾（同上，顶端动得最多）。 */
  sway: Skeleton2dMotion
  /** 倾头：绕锚点的小角度旋转。 */
  tilt: Skeleton2dMotion
  /** 静态变形（可选）：网格模式雕出来的形状，缺席 = 没雕过。 */
  deform?: Skeleton2dDeform
  /** 骨骼链（可选）：rest 位置先父后子排布；缺席 = 没绑过骨骼。 */
  bones?: Skeleton2dBone[]
  /** 骨骼轨道（可选）：骨骼名 → 旋转曲线；缺席或缺某骨 = 那根骨静止。 */
  boneTracks?: Skeleton2dBoneTracks
  /** 分层（可选）：每层一块矩形 + 掩码 + 自己的网格；缺席 = 整幅当一层。 */
  layers?: Skeleton2dLayer[]
  /** 生成时标记「打开就自动分层建骨」（客户端跑一次 `layerize`，之后写回成正式分层）。 */
  autoRig?: boolean
  /** 生成时的提示词，只作出处记录，渲染不读它。 */
  prompt: string
}

/** 任何来路的一包 JSON：每个字段都可能缺席、类型不对、或者离谱。 */
export type RawSkeleton2dModel = Record<string, unknown>

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
function motionOf(raw: unknown, fallback: Skeleton2dMotion): Skeleton2dMotion {
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
function keysOf(raw: unknown): Skeleton2dKeyframe[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const keys: Skeleton2dKeyframe[] = []
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
function deformOf(raw: unknown): Skeleton2dDeform | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const offsets = (raw as Record<string, unknown>).offsets
  if (typeof offsets !== 'object' || offsets === null) return undefined
  const result: Skeleton2dOffsets = {}
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
  const sorted: Skeleton2dOffsets = {}
  for (const key of Object.keys(result).sort()) sorted[key] = result[key] as [number, number]
  return { offsets: sorted }
}

/**
 * 收一份骨骼链：名字唯一、坐标夹进 [0,1] 量化到千分位、父级必须是**数组里更早**的
 * 一根（先父后子，天然无环）。无名、重名、指向自己或后人的统统丢掉——骨骼链是编辑
 * 器造出来的，读侧只收干净的。超过 {@link ./bones.ts} 的 `MAX_BONES` 截断。
 */
function bonesOf(raw: unknown): Skeleton2dBone[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const bones: Skeleton2dBone[] = []
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

/** 骨骼条数上限的真源在 `core/skeleton2d/bones.ts`；这里复制常量避免 core 内新增环。 */
const MAX_BONES_LIMIT = 12

/**
 * 收骨骼轨道表：键必须是骨骼清单里的名字，`rot` 走与动作同一副 `keysOf`（量化、
 * 排序、两键起）。查无此骨的条目整条丢——轨道跟骨骼走，骨骼没了轨道没有独立生命。
 */
function boneTracksOf(raw: unknown, bones: Skeleton2dBone[] | undefined): Skeleton2dBoneTracks | undefined {
  if (typeof raw !== 'object' || raw === null || bones === undefined) return undefined
  const result: Skeleton2dBoneTracks = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!bones.some((bone) => bone.name === name)) continue
    if (typeof value !== 'object' || value === null) continue
    const rot = keysOf((value as Record<string, unknown>).rot)
    if (rot === undefined) continue
    result[name] = { rot }
  }
  return Object.keys(result).length === 0 ? undefined : result
}

/** 收一个矩形：四边都夹进 0–1，宽高至少一格（退化成点的层没有意义）。 */
function rectOf(raw: unknown): Skeleton2dRect | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const entry = raw as Record<string, unknown>
  const x = finite(entry.x)
  const y = finite(entry.y)
  const w = finite(entry.w)
  const h = finite(entry.h)
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined
  const left = Math.round(clamp(x, 0, 0.999, 0) * 1000) / 1000
  const top = Math.round(clamp(y, 0, 0.999, 0) * 1000) / 1000
  const width = Math.round(clamp(w, 0.001, 1 - left, 0.5) * 1000) / 1000
  const height = Math.round(clamp(h, 0.001, 1 - top, 0.5) * 1000) / 1000
  return { x: left, y: top, w: width, h: height }
}

/** 收一段游程掩码：只留数字与逗号（空白去掉），超过上限或凑不出游程就整体收掉。 */
function maskOf(raw: unknown): string | undefined {
  const text = typeof raw === 'string' ? raw.replace(/[\s,]+/g, ',').replace(/^,|,$/g, '') : ''
  if (text === '' || text.length > LAYER_MASK_MAX_CHARS) return undefined
  if (!/^\d+(,\d+)*$/.test(text)) return undefined
  return text
}

/**
 * 收一组分层：层名去重、矩形/网格各自收敛、绑定的骨骼必须真的存在（按名字筛，筛空了就
 * 当「不限制」——一层绑不到骨不是错误，是「这层还没绑」）。掩码坏掉整层不丢：宁可画出
 * 矩形也不让用户的层消失。
 */
function layersOf(raw: unknown, bones: Skeleton2dBone[] | undefined): Skeleton2dLayer[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const layers: Skeleton2dLayer[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>
    const name = text(item.name)
    const rect = rectOf(item.rect)
    if (name === undefined || rect === undefined) continue
    if (layers.some((layer) => layer.name === name)) continue
    const cols = Math.round(clamp(finite(item.cols), LAYER_GRID_MIN, LAYER_GRID_MAX, LAYER_GRID_DEFAULT))
    const rows = Math.round(clamp(finite(item.rows), LAYER_GRID_MIN, LAYER_GRID_MAX, LAYER_GRID_DEFAULT))
    const named = Array.isArray(item.bones)
      ? item.bones
          .map((value) => text(value))
          .filter((value): value is string => value !== undefined && (bones ?? []).some((bone) => bone.name === value))
      : []
    const bound = named.length === 0 ? undefined : Array.from(new Set(named))
    const deform = deformOf(item.deform)
    const mask = maskOf(item.mask)
    const mw = mask === undefined ? undefined : Math.round(clamp(finite(item.mw), 1, 512, 0))
    const mh = mask === undefined ? undefined : Math.round(clamp(finite(item.mh), 1, 512, 0))
    layers.push({
      name,
      rect,
      cols,
      rows,
      ...(mask === undefined ? {} : { mask }),
      ...(mask !== undefined && mw !== undefined && mw > 0 && mh !== undefined && mh > 0 ? { mw, mh } : {}),
      ...(bound === undefined ? {} : { bones: bound }),
      ...(deform === undefined ? {} : { deform }),
    })
  }
  return layers.length === 0 ? undefined : layers
}

/** 三组动作的出厂值：能看出「活着」，又不会动得像喝醉。 */export const DEFAULT_MOTIONS: Readonly<Record<'breath' | 'sway' | 'tilt', Skeleton2dMotion>> = {
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
export function normalizeSkeleton2dModel(raw: RawSkeleton2dModel | undefined | null): Skeleton2dModel | undefined {
  if (raw === undefined || raw === null) return undefined
  const format = text(raw.format)
  if (format !== SKELETON2D_FORMAT) return undefined
  const version = finite(raw.version)
  if (version !== undefined && version > SKELETON2D_VERSION) return undefined
  const texture = text(raw.texture)
  if (texture === undefined) return undefined
  const loop = finite(raw.loop)
  const anchor = (typeof raw.anchor === 'object' && raw.anchor !== null ? raw.anchor : {}) as Record<string, unknown>
  const motions = (typeof raw.motions === 'object' && raw.motions !== null ? raw.motions : {}) as Record<string, unknown>
  const bones = bonesOf(raw.bones)
  const boneTracks = boneTracksOf(raw.boneTracks, bones)
  const layers = layersOf(raw.layers, bones)
  return {
    format: SKELETON2D_FORMAT,
    version: SKELETON2D_VERSION,
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
    ...(layers === undefined ? {} : { layers }),
    ...(raw.autoRig === true ? { autoRig: true } : {}),
    prompt: text(raw.prompt) ?? '',
  }
}
/** 稳定序列化：字段顺序固定，两次生成同一模型得到逐字节相同的文本。 */
export function serializeSkeleton2dModel(model: Skeleton2dModel): string {
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
      ...(model.layers === undefined ? {} : { layers: model.layers }),
      ...(model.autoRig === true ? { autoRig: true } : {}),
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
 * `skeleton2d/少女.skeleton2d.json` → `skeleton2d/少女.png`。贴图跟模型住在一起，整张卡连图带模型
 * 搬一次目录就搬全了；不用 `images/` 是因为它是模型的内部零件，不是一张独立的图卡。
 */
export function defaultTexturePathOf(modelFile: string): string {
  const directory = directoryOf(modelFile)
  const stem = modelFile.slice(directory.length + (directory === '' ? 0 : 1)).replace(/\.skeleton2d\.json$/i, '')
  const name = `${stem}.png`
  return directory === '' ? name : `${directory}/${name}`
}

/**
 * 贴图的绝对位置 → 模型里的相对引用。
 *
 * 生成时贴图可能在任何地方（上游图卡在 `images/`、自动落在 `skeleton2d/`）；模型里引用它
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

// ── v3：外壳 + 内嵌 Rigby2D 项目（编辑器 vendor 改道的产物形态）──────────────────
//
// 产物**仍是一份 JSON**（文件即产物、kind 检测、分目录、引用扫描全部不变），但编辑器
// 换成了 vendor 进来的 Rigby2D：外壳三个字段归本仓管（format / version / texture——贴图
// 引用是工作区路由与「引用即数据」要的），`rigby` 段是编辑器的工作档 + 随档文件，
// **本仓不解读、只透传**——上游改内部 schema 我们零成本跟随。

/** v3 外壳：本仓只认这三个字段 + prompt，其余全是 opaque。 */
export interface Skeleton2dRigbyShell {
  format: typeof SKELETON2D_FORMAT
  version: typeof SKELETON2D_RIGBY_VERSION
  /** 贴图路径：相对引用规则与 v1 相同（`texturePathOf` 共用）。 */
  texture: string
  /** Rigby2D 工作档（`.rigby` 的 JSON 本体，原样透传）。 */
  doc: Record<string, unknown>
  /** 工作档里的项目名（桥打开时给它当文件名）。 */
  workfile: string
  /** 随档文件（图集、贴图）：rigby 内部引用的相对路径 → base64。保存时由编辑器写回。 */
  files: Record<string, string>
  /** 生成时的提示词，只作出处记录（与 v1 同一纪律）。 */
  prompt: string
}

/** 单个随档文件的 base64 字符上限（≈4.5MB 原始字节）：图集是大头，正常远够。 */
export const RIGBY_FILE_MAX_CHARS = 6_000_000

/** 一份产物两种形态：轻模型（v1，渲染走自家 stage）或 Rigby 外壳（v3，编辑器/播放器）。 */
export type Skeleton2dArtifact = Skeleton2dModel | Skeleton2dRigbyShell

/** 这份产物是不是 v3 外壳（卡面/预览/编辑按它分派渲染路径）。 */
export function isRigbyShell(artifact: Skeleton2dArtifact): artifact is Skeleton2dRigbyShell {
  return artifact.version === SKELETON2D_RIGBY_VERSION
}

/**
 * 把一包原始 JSON 收敛成产物（v3 分派器）。
 *
 * v3 的硬条件：`doc` 必须是对象（编辑器的工作档）、`workfile` 非空、贴图非空；
 * 随档文件的键不许穿越（`..` 段与根相对前缀都拒——它们是编辑器内部的相对引用，
 * 出现穿越就是坏数据）。值只收非空字符串且限长（上限即坏）。
 */
export function normalizeSkeleton2dArtifact(raw: RawSkeleton2dModel | undefined | null): Skeleton2dArtifact | undefined {
  if (raw === undefined || raw === null) return undefined
  const version = finite(raw.version)
  if (version === SKELETON2D_RIGBY_VERSION) {
    const format = text(raw.format)
    const texture = text(raw.texture)
    const workfile = text(raw.workfile)
    if (format !== SKELETON2D_FORMAT || texture === undefined || workfile === undefined) return undefined
    if (typeof raw.doc !== 'object' || raw.doc === null || Array.isArray(raw.doc)) return undefined
    const files: Record<string, string> = {}
    if (raw.files !== undefined) {
      if (typeof raw.files !== 'object' || raw.files === null || Array.isArray(raw.files)) return undefined
      for (const [name, value] of Object.entries(raw.files as Record<string, unknown>)) {
        if (typeof value !== 'string' || value === '' || value.length > RIGBY_FILE_MAX_CHARS) return undefined
        const segments = name.split('/')
        if (name === '' || name.startsWith('/') || segments.some((s) => s === '' || s === '.' || s === '..')) return undefined
        files[name] = value
      }
    }
    return {
      format: SKELETON2D_FORMAT,
      version: SKELETON2D_RIGBY_VERSION,
      texture,
      doc: raw.doc as Record<string, unknown>,
      workfile,
      files,
      prompt: text(raw.prompt) ?? '',
    }
  }
  return normalizeSkeleton2dModel(raw)
}

/** v3 外壳的稳定序列化（与 `serializeSkeleton2dModel` 同一条纪律：字段顺序固定）。 */
export function serializeSkeleton2dShell(shell: Skeleton2dRigbyShell): string {
  return `${JSON.stringify(
    {
      format: shell.format,
      version: shell.version,
      texture: shell.texture,
      doc: shell.doc,
      workfile: shell.workfile,
      files: shell.files,
      prompt: shell.prompt,
    },
    null,
    2,
  )}\n`
}
