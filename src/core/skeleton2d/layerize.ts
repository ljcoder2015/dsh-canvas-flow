/**
 * dsh-canvas — skeleton2d 的**自动分层与建骨**（纯，零依赖）。
 *
 * 用户原话：「根据图片自动分层，生成骨骼动画」。一张已经画好的角色图是一整块像素，
 * 想让它动起来，第一步是把它切成**几层可以各自转动的部件**（头、躯干、两臂、两腿），
 * 第二步是给这些部件配一具**骨架**（`Bone2D` 那样的父子关节），第三步是把层与骨按
 * 距离绑起来（蒙皮，`bones.ts`）。本模块只做前两步的**算术**：吃一张 RGBA，吐一份
 * 分层与骨骼；切图、建画布、写盘都是客户端的事。
 *
 * 为什么是剪影而不是语义分割：语义分割要模型、要权重、要联网，而这个插件的一份产物
 * 应该在任何机器上重算出同一个结果。剪影能给出的信息比想象中多——**宽度轮廓**上，
 * 脖子是一个局部极细处、肩膀是一次陡增、裆部是左右两半第一次分开；这三处足够把
 * 人形切成六块。切不准的部分用户可以在编辑器里调矩形与掩码，自动分层给的是**初稿**。
 *
 * 全部函数都是确定的：同一张图跑两次，逐字节相同的分层与骨骼（掩码是游程，坐标
 * 量化到千分位）——判据因此可以钉住具体数值，而不是「差不多像个人」。
 */

import {
  LAYER_GRID_DEFAULT,
  type Skeleton2dBone,
  type Skeleton2dBoneTracks,
  type Skeleton2dKeyframe,
  type Skeleton2dLayer,
  type Skeleton2dModel,
  type Skeleton2dRect,
} from './model.ts'

/** 一张 RGBA8 位图（行优先、每像素四字节）。跨域图与画布都给得出这个形状。 */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

/** 一层自动分层的产物：名字、像素矩形、掩码。 */
export interface LayerizedLayer {
  name: string
  /** 像素矩形（左、上、宽、高），已经裁到贴图内。 */
  pixel: { x: number; y: number; w: number; h: number }
  /** 归一化矩形（uv），模型里存的那一份。 */
  rect: Skeleton2dRect
  /** 游程掩码（从透明开始，按行扫）。 */
  mask: string
  /** 掩码栅格的宽高（= 像素矩形的宽高）。 */
  mw: number
  mh: number
}

/** 一次自动分层的完整结果。 */
export interface LayerizeResult {
  layers: LayerizedLayer[]
  bones: Skeleton2dBone[]
  boneTracks: Skeleton2dBoneTracks
}

/** 透明度下限：低于它算背景。16/255 是「肉眼看不见」的量级。 */
const ALPHA_MIN = 16

/** 一层的像素少于整幅剪影的这个比例就不要了——那多半是噪点或一条发丝。 */
const MIN_LAYER_SHARE = 0.004

/** 生成骨骼时的量化：与 `model.ts` 的归一同一档（千分位）。 */
const Q = 1000

/** 量化到千分位并夹进 [0,1]。 */
function q(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * Q) / Q
}

/** 游程编码：一串 0/1 长度，第一段是 0（透明）。全空返回空串。 */
export function encodeMask(bits: ArrayLike<number>): string {
  const runs: number[] = []
  let current = 0
  let length = 0
  for (let index = 0; index < bits.length; index += 1) {
    const value = (bits[index] ?? 0) === 0 ? 0 : 1
    if (value === current) {
      length += 1
      continue
    }
    runs.push(length)
    current = value
    length = 1
  }
  if (length > 0) runs.push(length)
  return runs.join(',')
}

/** 游程解码：解出 `count` 个 0/1；长度不够的部分补 0，多的截掉。 */
export function decodeMask(text: string | undefined, count: number): Uint8Array {
  const bits = new Uint8Array(count)
  if (text === undefined || text === '') return bits
  let at = 0
  let value = 0
  for (const part of text.split(',')) {
    const run = Number.parseInt(part, 10)
    if (!Number.isFinite(run) || run < 0) continue
    if (run === 0) {
      value = value === 1 ? 0 : 1
      continue
    }
    if (value === 1) {
      const end = Math.min(count, at + run)
      bits.fill(1, at, end)
      at = end
    } else {
      at = Math.min(count, at + run)
    }
    value = value === 1 ? 0 : 1
    if (at >= count) break
  }
  return bits
}

/** 掩码里 (x, y) 这一格是不是层内像素。 */
export function maskAt(bits: Uint8Array, w: number, x: number, y: number): boolean {
  return bits[y * w + x] === 1
}

/** 剪影：不透明的包围盒与逐行左右边界。 */
interface Silhouette {
  left: number
  top: number
  right: number
  bottom: number
  /** 逐行（相对整图）的左/右边与宽度。 */
  rowLeft: number[]
  rowRight: number[]
  rowWidth: number[]
}

/** 按 alpha 求剪影；整幅全透明时返回 `undefined`（没什么可分的）。 */
function silhouetteOf(image: RgbaImage): Silhouette | undefined {
  const { width, height, data } = image
  const rowLeft: number[] = new Array(height).fill(Number.POSITIVE_INFINITY)
  const rowRight: number[] = new Array(height).fill(-1)
  const rowWidth: number[] = new Array(height).fill(0)
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) < ALPHA_MIN) continue
      rowWidth[y] = (rowWidth[y] ?? 0) + 1
      if (x < (rowLeft[y] as number)) rowLeft[y] = x
      if (x > (rowRight[y] as number)) rowRight[y] = x + 1
      if (x < left) left = x
      if (x + 1 > right) right = x + 1
      if (y < top) top = y
      if (y + 1 > bottom) bottom = y + 1
    }
  }
  if (right <= 0 || bottom <= 0) return undefined
  return { left, top, right, bottom, rowLeft, rowRight, rowWidth }
}

/** 一行里不透明像素的分段（用于找裆部那道缝）。 */
function runsOfRow(silhouette: Silhouette, y: number): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  const rowWidth = silhouette.rowWidth[y] ?? 0
  if (rowWidth === 0) return runs
  // 逐行左右边界不足以表达「两段」：再扫一遍这一行是必须的，但只扫这一行。
  const left = silhouette.rowLeft[y] as number
  const right = silhouette.rowRight[y] as number
  runs.push([left, right])
  return runs
}

/**
 * 把一层像素写成层定义：矩形取包围盒（外扩一格防锯齿），掩码按矩形重采样。
 *
 * `label` 是逐像素的层号；这里只认 `index` 那一层的像素。
 */
function layerOf(
  label: Int8Array,
  image: RgbaImage,
  silhouette: Silhouette,
  index: number,
  name: string,
): LayerizedLayer | undefined {
  const { width } = image
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = -1
  let bottom = -1
  for (let y = silhouette.top; y < silhouette.bottom; y += 1) {
    for (let x = silhouette.left; x < silhouette.right; x += 1) {
      if (label[y * width + x] !== index) continue
      if (x < left) left = x
      if (x + 1 > right) right = x + 1
      if (y < top) top = y
      if (y + 1 > bottom) bottom = y + 1
    }
  }
  if (right <= 0 || bottom <= 0) return undefined
  const w = right - left
  const h = bottom - top
  const bits = new Uint8Array(w * h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      bits[y * w + x] = label[(top + y) * width + (left + x)] === index ? 1 : 0
    }
  }
  return {
    name,
    pixel: { x: left, y: top, w, h },
    rect: {
      x: q(left / image.width),
      y: q(top / image.height),
      w: q(w / image.width),
      h: q(h / image.height),
    },
    mask: encodeMask(bits),
    mw: w,
    mh: h,
  }
}

/** 一层的像素数（判小层用）。 */
function countOf(label: Int8Array, index: number): number {
  let count = 0
  for (let at = 0; at < label.length; at += 1) if (label[at] === index) count += 1
  return count
}

/** 分层的层号与名字：次序就是绘制次序（后面的画在上面）。 */
const LAYER_NAMES = ['leg.l', 'leg.r', 'arm.l', 'arm.r', 'torso', 'head'] as const
const LEG_L = 0
const LEG_R = 1
const ARM_L = 2
const ARM_R = 3
const TORSO = 4
const HEAD = 5

/**
 * 从一张 RGBA 图切出**六层**并配一副**十骨**的骨架。
 *
 * 六层：两腿、两臂、躯干、头（缺的部位自动缺席——半身像就只剩躯干与头）。十骨：
 * 根 / 脊 / 胸 / 头，两臂各两段、两腿各两段；父级关系与 Godot 里搭 Bone2D 的次序
 * 一致，先父后子（`model.ts` 的归一就按这个次序验环）。
 *
 * 分层依据只有一条：**剪影的宽度轮廓**。
 *
 * - 脖子＝上半身里最细的一行（宽度出现局部极小、且往下立刻变宽）；
 * - 裆部＝下半身第一处「一行分成两段」的地方，两段的中点就是两腿的分界；
 * - 手臂＝躯干带里伸出**躯干中位宽度**之外的部分（中位宽度用分位数取，手臂撑着也不至于
 *   把躯干算胖）。
 *
 * 边界情况一律退化成更少层而不是报错：找不到脖子就没有头（整幅当躯干），找不到裆部
 * 就没有腿。少一层是「没分出来」，报错是「用不了」，前者用户能改，后者只能重来。
 */
export function layerize(image: RgbaImage): LayerizeResult | undefined {
  const silhouette = silhouetteOf(image)
  if (silhouette === undefined) return undefined
  const { width, height } = image
  const bodyHeight = silhouette.bottom - silhouette.top
  const bodyWidth = silhouette.right - silhouette.left
  if (bodyHeight < 8 || bodyWidth < 8) return undefined

  const label = new Int8Array(width * height).fill(-1)

  // ── 脖子：上半身最细的一行（宽度局部极小，且至少比下方最宽处细三成）。
  const upperFrom = silhouette.top + Math.round(bodyHeight * 0.08)
  const upperTo = silhouette.top + Math.round(bodyHeight * 0.46)
  let neck = -1
  let neckWidth = Number.POSITIVE_INFINITY
  let lowerMax = 0
  for (let y = upperTo; y < silhouette.bottom; y += 1) lowerMax = Math.max(lowerMax, silhouette.rowWidth[y] ?? 0)
  for (let y = upperFrom; y <= upperTo; y += 1) {
    const w = silhouette.rowWidth[y] ?? 0
    if (w === 0) continue
    const above = silhouette.rowWidth[y - 2] ?? 0
    const below = silhouette.rowWidth[y + 2] ?? 0
    if (w > above || w > below) continue
    if (w > lowerMax * 0.7) continue
    if (w < neckWidth) {
      neckWidth = w
      neck = y
    }
  }

  // ── 裆部：下半身第一处一行分成两段（缝至少占身宽 3%）。
  let crotch = -1
  let splitX = -1
  const scanFrom = silhouette.top + Math.round(bodyHeight * 0.5)
  for (let y = scanFrom; y < silhouette.bottom - 1; y += 1) {
    const row = runsOfRow(silhouette, y)
    void row
    // 逐像素找这一行的「洞」：左边界之后第一次从有到无、再从无到有。
    let seen = false
    let gapStart = -1
    for (let x = silhouette.left; x < silhouette.right; x += 1) {
      const solid = (image.data[(y * width + x) * 4 + 3] ?? 0) >= ALPHA_MIN
      if (solid) {
        if (gapStart >= 0 && x - gapStart >= Math.max(2, Math.round(bodyWidth * 0.03))) {
          crotch = y
          splitX = Math.round((gapStart + x) / 2)
          break
        }
        seen = true
        gapStart = -1
        continue
      }
      if (seen && gapStart < 0) gapStart = x
    }
    if (crotch >= 0) break
  }

  const headBottom = neck > 0 ? neck : silhouette.top
  const torsoBottom = crotch > 0 ? crotch : silhouette.bottom
  if (headBottom <= silhouette.top) {
    // 没找到脖子：整幅当躯干（没有头、没有腿）。
  }

  // ── 手臂：躯干带里伸出「躯干本身宽度」之外的像素。躯干宽度取**最窄的那几条行**
  // （肩线一带，手臂还没开始的地方）：左边界取 90 分位（越大越靠内）、右边界取
  // 10 分位。中位数不行——手臂几乎占满整个躯干带，会把「躯干」算成整幅宽。
  const torsoFrom = Math.max(headBottom, silhouette.top)
  const torsoTo = Math.max(torsoFrom + 1, torsoBottom)
  const lefts: number[] = []
  const rights: number[] = []
  for (let y = torsoFrom; y < torsoTo; y += 1) {
    if ((silhouette.rowWidth[y] ?? 0) === 0) continue
    lefts.push(silhouette.rowLeft[y] as number)
    rights.push(silhouette.rowRight[y] as number)
  }
  lefts.sort((a, b) => a - b)
  rights.sort((a, b) => a - b)
  const pick = (values: number[], fraction: number, fallback: number): number =>
    values.length === 0 ? fallback : (values[Math.min(values.length - 1, Math.floor(values.length * fraction))] as number)
  const coreLeft = pick(lefts, 0.9, silhouette.left)
  const coreRight = pick(rights, 0.1, silhouette.right)
  const margin = Math.max(1, Math.round(bodyWidth * 0.015))

  for (let y = silhouette.top; y < silhouette.bottom; y += 1) {
    for (let x = silhouette.left; x < silhouette.right; x += 1) {
      if ((image.data[(y * width + x) * 4 + 3] ?? 0) < ALPHA_MIN) continue
      const at = y * width + x
      if (y < headBottom) {
        label[at] = HEAD
        continue
      }
      if (y >= torsoBottom && crotch > 0) {
        label[at] = x < splitX ? LEG_L : LEG_R
        continue
      }
      if (x < coreLeft - margin) {
        label[at] = ARM_L
        continue
      }
      if (x > coreRight + margin) {
        label[at] = ARM_R
        continue
      }
      label[at] = TORSO
    }
  }

  const total = countOf(label, HEAD) + countOf(label, TORSO) + countOf(label, ARM_L) + countOf(label, ARM_R) + countOf(label, LEG_L) + countOf(label, LEG_R)
  const minPixels = Math.max(16, Math.round(total * MIN_LAYER_SHARE))
  const layers: LayerizedLayer[] = []
  for (let index = 0; index < LAYER_NAMES.length; index += 1) {
    if (countOf(label, index) < minPixels) continue
    const layer = layerOf(label, image, silhouette, index, LAYER_NAMES[index] as string)
    if (layer !== undefined) layers.push(layer)
  }
  if (layers.length === 0) return undefined

  const byName = new Map(layers.map((layer) => [layer.name, layer]))
  const bones = templateBones(byName, image)
  return { layers, bones: bones.bones, boneTracks: bones.tracks }
}

/** 取一层的 uv 矩形；没这层时给一个退化的空矩形（`undefined` 更好，调用方自行判）。 */
function uvOf(layer: LayerizedLayer | undefined): Skeleton2dRect | undefined {
  return layer?.rect
}

/** 层矩形的几个常用锚点（uv）。 */
function anchorOf(rect: Skeleton2dRect, fx: number, fy: number): { x: number; y: number } {
  return { x: q(rect.x + rect.w * fx), y: q(rect.y + rect.h * fy) }
}

/** 一条静止的骨（没铺轨道就停在这里）。 */
function boneAt(name: string, point: { x: number; y: number }, parent?: string): Skeleton2dBone {
  return { name, x: point.x, y: point.y, ...(parent === undefined ? {} : { parent }) }
}

/**
 * 人体模板：拿到六层的矩形，摆出十根关节。
 *
 * 关节落在**解剖上的连接处**而不是层中心：根在裆（两腿之间）、脊在腰、胸在肩线、
 * 头在颈根；手臂两段分别落在肩与肘（肘取臂矩形半高），腿两段落在髋与膝。层中心当
 * 关节会让肢体绕自己的中间转，看起来像风车；连接处当关节才是「抬起来」。
 */
function templateBones(
  layers: Map<string, LayerizedLayer>,
  image: RgbaImage,
): { bones: Skeleton2dBone[]; tracks: Skeleton2dBoneTracks } {
  const torso = uvOf(layers.get('torso'))
  const head = uvOf(layers.get('head'))
  const armL = uvOf(layers.get('arm.l'))
  const armR = uvOf(layers.get('arm.r'))
  const legL = uvOf(layers.get('leg.l'))
  const legR = uvOf(layers.get('leg.r'))
  void image

  const body = torso ?? head
  if (body === undefined) return { bones: [], tracks: {} }

  const hip = anchorOf(body, 0.5, 0.96)
  const waist = anchorOf(body, 0.5, 0.6)
  const shoulder = anchorOf(body, 0.5, 0.08)
  const neck = head === undefined ? shoulder : { x: q(head.x + head.w * 0.5), y: q(head.y + head.h * 0.98) }

  const bones: Skeleton2dBone[] = [boneAt('root', hip), boneAt('spine', waist, 'root'), boneAt('chest', shoulder, 'spine'), boneAt('head', neck, 'chest')]

  if (armL !== undefined) {
    bones.push(boneAt('arm.l.1', anchorOf(armL, 0.86, 0.08), 'chest'))
    bones.push(boneAt('arm.l.2', anchorOf(armL, 0.5, 0.55), 'arm.l.1'))
  }
  if (armR !== undefined) {
    bones.push(boneAt('arm.r.1', anchorOf(armR, 0.14, 0.08), 'chest'))
    bones.push(boneAt('arm.r.2', anchorOf(armR, 0.5, 0.55), 'arm.r.1'))
  }
  if (legL !== undefined) {
    bones.push(boneAt('leg.l.1', anchorOf(legL, 0.5, 0.02), 'root'))
    bones.push(boneAt('leg.l.2', anchorOf(legL, 0.5, 0.5), 'leg.l.1'))
  }
  if (legR !== undefined) {
    bones.push(boneAt('leg.r.1', anchorOf(legR, 0.5, 0.02), 'root'))
    bones.push(boneAt('leg.r.2', anchorOf(legR, 0.5, 0.5), 'leg.r.1'))
  }

  return { bones, tracks: idleTracks(bones) }
}

/** 两枚键的正弦形（半周期上、半周期下）——给自动生成的骨架一点「活着」的默认动作。 */
function idleKeys(amplitude: number, phase: number): Skeleton2dKeyframe[] {
  const at = (t: number): Skeleton2dKeyframe => ({ t: Math.round(((t + phase) % 1) * 1000) / 1000, v: amplitude })
  return [at(0), { t: (phase + 0.5) % 1, v: -amplitude }].sort((a, b) => a.t - b.t)
}

/** 默认待机：胸与头各摆一个反相的小角度，四肢末端轻一点。 */
function idleTracks(bones: readonly Skeleton2dBone[]): Skeleton2dBoneTracks {
  const tracks: Skeleton2dBoneTracks = {}
  const add = (name: string, amplitude: number, phase: number): void => {
    if (!bones.some((bone) => bone.name === name)) return
    tracks[name] = { rot: idleKeys(amplitude, phase) }
  }
  add('spine', 0.25, 0)
  add('chest', 0.2, 0.25)
  add('head', 0.35, 0.5)
  add('arm.l.1', 0.3, 0)
  add('arm.r.1', 0.3, 0.5)
  add('arm.l.2', 0.2, 0.25)
  add('arm.r.2', 0.2, 0.75)
  return tracks
}

/**
 * 把一次自动分层的产出装回模型：层、骨、轨道、锚点一齐换，`autoRig` 标记摘掉。
 *
 * 这是「自动分层」与「模型格式」之间**唯一**的一次翻译，放在 core 里是为了让判据能直接
 * 验它（不需要画布、不需要浏览器）。层序即绘制次序：`layerize` 给的是「腿 → 臂 → 躯干
 * → 头」，后面的盖住前面的。
 */
export function withRig(model: Skeleton2dModel, result: LayerizeResult): Skeleton2dModel {
  const layers: Skeleton2dLayer[] = result.layers.map((layer) => ({
    name: layer.name,
    rect: layer.rect,
    mask: layer.mask,
    mw: layer.mw,
    mh: layer.mh,
    cols: LAYER_GRID_DEFAULT,
    rows: LAYER_GRID_DEFAULT,
  }))
  const next: Skeleton2dModel = {
    ...model,
    anchor: { x: 0.5, y: 1 },
    ...(layers.length === 0 ? {} : { layers }),
    ...(result.bones.length === 0 ? {} : { bones: result.bones }),
    ...(Object.keys(result.boneTracks).length === 0 ? {} : { boneTracks: result.boneTracks }),
  }
  delete next.autoRig
  return next
}
