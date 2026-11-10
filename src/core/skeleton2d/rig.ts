/**
 * dsh-canvas — skeleton2d 的**变形数学**（纯，零依赖）。
 *
 * 渲染器（client）与导出器（client/canvas/export）都要算「网格的第 i 个顶点在这一刻
 * 在哪里」。这段算术只有一份真源，就在这里：两处各写一遍，迟早一边改了参数形状另一边
 * 还在算旧版——本仓已经三次撞上「同一个东西两个来源」的静默失败。
 *
 * 设计约定（与 `model.ts` 同一条纪律）：
 *
 * - **位移按权重分布**：每个顶点带一个 0–1 的权重 w，离锚点越远 w 越大。人物贴图锚在
 *   脚底时，头顶 w≈1、脚底 w=0——呼吸时上身起伏、脚下站得稳，正是伪骨骼动画该有的样子。
 * - **三组动作都是正弦**，且频率由「每循环几拍」（整数）给出：`sin(2π · cycles · t / loop + 2π·phase)`
 *   在 `t + loop` 处逐位重现。**无缝循环是数学性质，不是补间技巧**，导出帧序列因此不需要
 *   任何收尾帧。
 * - 坐标系统一用 **uv（0–1，y 向下）**：顶点在贴图上的位置。翻转成 WebGL 的纹理坐标是
 *   渲染器的事，这里不管。
 * - **分层不改变坐标系统**：一层的网格顶点照样用整幅 uv 表达（局部比例映射进层矩形），
 *   所以骨骼、锚点、雕刻三套参数在「整幅」与「分层」两种模型上说的是同一种坐标。
 */

import type { Skeleton2dLayer, Skeleton2dModel, Skeleton2dOffsets } from './model.ts'
import { motionValueAt, sampleKeys } from './curve.ts'
import { bonePosesAt, boneWeightsAt, skinAt, type Skeleton2dBonePose } from './bones.ts'

// 曲线采样搬去了 `curve.ts`（骨骼层与变形层共用的真源不能住进任何一边）；这里再导出
// 维持旧的引用路径——编辑器与判据都还从 `rig.ts` 拿它们。
export { motionValueAt, sampleKeys }

/** 网格的密度：横向 24 × 纵向 24 个格胞。够表现起伏，又不至于让每帧的顶点上传变成负担。 */
export const GRID_COLS = 24
export const GRID_ROWS = 24

/** 一个网格顶点在某一刻的完整状态。 */
export interface GridVertex {
  /** 贴图 uv（0–1，y 向下），位移**之后**的位置。 */
  u: number
  v: number
  /** 贴图上的原始 uv（位移之前），采样用——采样永远取原图，位移只挪顶点。 */
  su: number
  sv: number
}

/** 网格行列的顶点 uv（位移之前）：`(rows+1) × (cols+1)` 个，均匀铺满。 */
export function baseGrid(cols = GRID_COLS, rows = GRID_ROWS): GridVertex[] {
  const vertices: GridVertex[] = []
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      const su = col / cols
      const sv = row / rows
      vertices.push({ u: su, v: sv, su, sv })
    }
  }
  return vertices
}

/**
 * 一层的网格顶点（位移之前）：局部比例映射进层矩形，得到整幅 uv。
 *
 * 顶点数 `(rows+1) × (cols+1)`，与 `baseGrid` 同一个排列——层内雕刻的键（`列,行`）
 * 因此与整幅网格的键同构，编辑器在两套网格上用的是同一段拾取代码。
 */
export function baseLayerGrid(
  rect: { x: number; y: number; w: number; h: number },
  cols: number,
  rows: number,
): GridVertex[] {
  const vertices: GridVertex[] = []
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      const su = rect.x + (rect.w * col) / cols
      const sv = rect.y + (rect.h * row) / rows
      vertices.push({ u: su, v: sv, su, sv })
    }
  }
  return vertices
}

/**
 * 顶点的位移权重：0–1，锚点处为 0、离锚点越远越接近 1。
 *
 * 只按**纵向距离**算（`|v - anchor.y|`），不按欧氏距离：呼吸 / 摇摆 / 倾头都是「上身
 * 相对下身」的动作，横向位置不该稀释它。平方让权重在中段偏小、顶端集中——大部分像素
 * 几乎不动，动的是轮廓，这才像「活着」而不是「果冻」。
 */
export function vertexWeight(v: number, anchorY: number): number {
  const distance = Math.abs(v - anchorY)
  return distance * distance
}

/** 顶点的雕刻位移（uv）：网格模式雕出来的静态形状，直接叠加在动作位移之后。 */
function deformAt(offsets: Skeleton2dOffsets | undefined, col: number, row: number): [number, number] | undefined {
  if (offsets === undefined) return undefined
  return offsets[`${col},${row}`]
}

/** 一层的骨骼子集：把这层绑定的骨名翻成 `model.bones` 的下标（缺席 = 全部）。 */
function boneSubsetOf(model: Skeleton2dModel, layer: Skeleton2dLayer | undefined): readonly number[] | undefined {
  const bones = model.bones
  if (layer?.bones === undefined || bones === undefined) return undefined
  const indices: number[] = []
  for (let index = 0; index < bones.length; index += 1) {
    if (layer.bones.includes((bones[index] as { name: string }).name)) indices.push(index)
  }
  return indices.length === 0 ? undefined : indices
}

/** 一根骨此刻的世界姿态表（没骨就是 `undefined`，调用方走「无蒙皮」短路）。 */
function posesOf(model: Skeleton2dModel, t: number): Skeleton2dBonePose[] | undefined {
  const bones = model.bones
  if (bones === undefined || bones.length === 0) return undefined
  return bonePosesAt(bones, model.boneTracks, t, model.loop)
}

/**
 * 单个顶点的完整变换（**唯一一处**把三层叠加写全的地方）。
 *
 * 次序：骨骼蒙皮（有骨时）→ 三组动作 → 雕刻。`deform` 与骨子集由调用方按「整幅」或
 * 「层内」取好再传进来——这一层不知道自己在整幅里还是层里。
 */
function composePoint(
  model: Skeleton2dModel,
  poses: Skeleton2dBonePose[] | undefined,
  subset: readonly number[] | undefined,
  su: number,
  sv: number,
  t: number,
  shaped: [number, number] | undefined,
): { u: number; v: number } {
  const weight = vertexWeight(sv, model.anchor.y)
  const toward = model.anchor.y >= sv ? 1 : -1
  let u = su
  let v = sv
  if (poses !== undefined && model.bones !== undefined) {
    const weights = boneWeightsAt(model.bones, su, sv, subset)
    const skinned = skinAt(model.bones, poses, weights, su, sv)
    u = skinned.u
    v = skinned.v
  }
  u += model.sway.amplitude * weight * motionValueAt(model.sway, t, model.loop)
  v -= toward * model.breath.amplitude * weight * motionValueAt(model.breath, t, model.loop)
  // 倾头：绕锚点旋转。角度本身乘权重，离锚越远转得越多，锚点纹丝不动。
  if (model.tilt.amplitude > 0) {
    const dx = u - model.anchor.x
    const dy = v - model.anchor.y
    const angle = model.tilt.amplitude * weight * motionValueAt(model.tilt, t, model.loop)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    u = model.anchor.x + dx * cos - dy * sin
    v = model.anchor.y + dx * sin + dy * cos
  }
  if (shaped !== undefined) {
    u += shaped[0]
    v += shaped[1]
  }
  return { u, v }
}

/**
 * 把网格推到时刻 t 的形状（原地修改传入的数组，避免每帧分配）。
 *
 * 变形按三层叠加，次序只在这里写这一遍：
 *
 * 1. **骨骼蒙皮**（有 `bones` 时）：rest 点按距离反比权重交给骨骼姿态（`bones.ts`）；
 * 2. **三组动作**，各按各的权重与相位（或各自的关键帧曲线，`motionValueAt` 是分岔点）；
 * 3. **雕刻位移**（`deform.offsets`）：静态、不随时间动、不乘权重。
 *
 * `t` 可以是任意实数（循环之外的值同样成立——`t + loop` 处必然重现）。传入 `layer`
 * 时按层的绑定与层内雕刻算（顶点仍是整幅 uv）——渲染与导出都只走这一条。
 */
export function poseGridAt(
  vertices: GridVertex[],
  model: Skeleton2dModel,
  t: number,
  cols = GRID_COLS,
  rows = GRID_ROWS,
  layer?: Skeleton2dLayer,
): void {
  const poses = posesOf(model, t)
  const subset = boneSubsetOf(model, layer)
  const deform = layer === undefined ? model.deform?.offsets : layer.deform?.offsets
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      const vertex = vertices[row * (cols + 1) + col] as GridVertex
      const point = composePoint(model, poses, subset, vertex.su, vertex.sv, t, deformAt(deform, col, row))
      vertex.u = point.u
      vertex.v = point.v
    }
  }
}

/** 一次采样得到的顶点位置（不分配网格，直接算单个点——导出端逐帧复用同一份网格）。 */
export function poseAt(model: Skeleton2dModel, su: number, sv: number, t: number): { u: number; v: number } {
  return composePoint(model, posesOf(model, t), undefined, su, sv, t, undefined)
}

/** 网格的三角索引（两个三角形一个格胞），布局只算一次。 */
export function gridIndices(cols = GRID_COLS, rows = GRID_ROWS): Uint16Array {
  const indices: number[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const a = row * (cols + 1) + col
      const b = a + 1
      const c = a + (cols + 1)
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  return new Uint16Array(indices)
}
