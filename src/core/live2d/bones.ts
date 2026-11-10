/**
 * dsh-canvas — live2d-lite 的**骨骼层**（纯，零依赖）。
 *
 * 骨骼是网格变形之外的第二个变形来源：一组带父级关系的关节（`model.ts` 的
 * `Live2dBone`），每根关节可以绕自己的原点旋转（关键帧驱动，`boneTracks`）。顶点不
 * 绑死在某根骨骼上——按「到各关节距离的平方反比」分给最近的两根（蒙皮），这样一根
 * 手臂骨转动时，附近的像素跟着走、远处的像素几乎不动，不需要逐顶点刷权重。
 *
 * 坐标与约定沿用 `rig.ts`：uv（0–1，y 向下），循环无缝的数学性质与动作层同源——
 * 旋转曲线用 `sampleKeys` 环绕插值，`t + loop` 处逐位重现。
 *
 * 本模块只算数：层级合成（父动子随）、权重、蒙皮。往网格上写回是 `rig.ts` 的事——
 * 那边把这三样按「贴图 rest → 骨骼 → 动作 → 雕刻」的次序叠起来，次序只写那一遍。
 */

import type { Live2dKeyframe } from './model.ts'
import { sampleKeys } from './curve.ts'

/** 单根骨骼旋转的满幅（弧度）：v=±1 的关键帧对应 ±0.4rad ≈ ±23°——再大就是甩胳膊了。 */
export const BONE_ROT_MAX = 0.4

/** 一份模型的骨骼条数上限：骨骼链不是角色装配图，十几根足够「头颈肩臂」。 */
export const MAX_BONES = 12

/** 一根骨骼在时刻 t 的世界姿态：原点（uv）与累计旋转（弧度，含全部父级）。 */
export interface Live2dBonePose {
  ox: number
  oy: number
  angle: number
}

/**
 * 一根骨骼的旋转曲线在时刻 t 的取值（弧度，±{@link BONE_ROT_MAX}）。
 *
 * 没有关键帧（不足两键）就是静止——骨骼不铺曲线就停在 rest 位，铺了才动。曲线本身
 * 走 `sampleKeys` 的环绕余弦：无缝循环与动作层同一扇门。
 */
export function boneRotationAt(rot: readonly Live2dKeyframe[] | undefined, t: number, loop: number): number {
  if (rot === undefined || rot.length < 2) return 0
  return sampleKeys(rot, t / loop) * BONE_ROT_MAX
}

/**
 * 算出全部骨骼在时刻 t 的**世界姿态**（返回数组与 `bones` 同序）。
 *
 * 父动子随的合成规则：子骨骼的 rest 原点相对父骨骼 rest 原点有个偏移向量 r；父旋转
 * θ 后，子原点 = 父世界原点 + R(父角)·r，子角 = 父角 + 自己的旋转角。归一保证了
 * `parent` 指向数组里**更早**的一根（先父后子），一遍线性扫就够了，也天然无环。
 *
 * 没铺曲线的骨骼照样参与合成——它的角度是 0，但原点会跟着父级走（手臂抬起来，手腕
 * 的关节得跟着到新位置）。
 */
export function bonePosesAt(
  bones: readonly { name: string; x: number; y: number; parent?: string }[],
  tracks: Readonly<Record<string, { rot?: Live2dKeyframe[] }>> | undefined,
  t: number,
  loop: number,
): Live2dBonePose[] {
  const poses: Live2dBonePose[] = []
  for (let index = 0; index < bones.length; index += 1) {
    const bone = bones[index] as { name: string; x: number; y: number; parent?: string }
    const local = boneRotationAt(tracks?.[bone.name]?.rot, t, loop)
    const parentIndex = bone.parent === undefined ? -1 : bones.findIndex((entry) => entry.name === bone.parent)
    if (parentIndex < 0 || parentIndex >= index) {
      // 没父级（或父级不在自己前面——归一不该放它进来，防御一道）：自己就是根。
      poses.push({ ox: bone.x, oy: bone.y, angle: local })
      continue
    }
    const parent = poses[parentIndex] as Live2dBonePose
    const rest = bones[parentIndex] as { x: number; y: number }
    const rx = bone.x - rest.x
    const ry = bone.y - rest.y
    const cos = Math.cos(parent.angle)
    const sin = Math.sin(parent.angle)
    poses.push({
      ox: parent.ox + rx * cos - ry * sin,
      oy: parent.oy + rx * sin + ry * cos,
      angle: parent.angle + local,
    })
  }
  return poses
}

/**
 * 顶点 (u,v) 的蒙皮权重：与 `bones` 同序的数组，归一到和为 1。
 *
 * 距离平方反比（`1/(d²+ε)`）取**最近的两根**再归一：一根骨管贴身的一片，边界处两根
 * 各摊一半，过渡平滑。没有骨骼就是空数组（调用方按「无蒙皮」短路）。
 */
export function boneWeightsAt(
  bones: readonly { x: number; y: number }[],
  u: number,
  v: number,
): number[] {
  const weights = new Array<number>(bones.length).fill(0)
  if (bones.length === 0) return weights
  // ε 防除零，也让「骑在关节上」的顶点不至于权重爆炸。
  const scores = bones.map((bone) => {
    const du = u - bone.x
    const dv = v - bone.y
    return 1 / (du * du + dv * dv + 0.0025)
  })
  if (bones.length === 1) {
    weights[0] = 1
    return weights
  }
  // 最近的两根。n ≤ 12，直接扫两遍比排序省心。
  let first = 0
  for (let index = 1; index < scores.length; index += 1) {
    if ((scores[index] as number) > (scores[first] as number)) first = index
  }
  let second = first === 0 ? 1 : 0
  for (let index = 0; index < scores.length; index += 1) {
    if (index === first) continue
    if ((scores[index] as number) > (scores[second] as number)) second = index
  }
  const a = scores[first] as number
  const b = scores[second] as number
  const total = a + b
  weights[first] = a / total
  weights[second] = b / total
  return weights
}

/**
 * 蒙皮：把一个 rest 点交给骨骼姿态与权重，得到这一刻的位置。
 *
 * 每根骨骼对点的变换是「绕自己的**世界**原点转自己的**世界**角」；多根按权重线性
 * 混合（线性混合蒙皮，LBS 的 2D 最简版）。rest 态（全角 0、原点未动）下输出恒等于
 * 输入——这是「没铺曲线的骨骼不搅局」的判据锚点。
 */
export function skinAt(
  bones: readonly { x: number; y: number }[],
  poses: readonly Live2dBonePose[],
  weights: readonly number[],
  su: number,
  sv: number,
): { u: number; v: number } {
  let u = 0
  let v = 0
  for (let index = 0; index < bones.length; index += 1) {
    const w = weights[index] ?? 0
    if (w === 0) continue
    const pose = poses[index] as Live2dBonePose
    const rest = bones[index] as { x: number; y: number }
    const dx = su - rest.x
    const dy = sv - rest.y
    const cos = Math.cos(pose.angle)
    const sin = Math.sin(pose.angle)
    u += w * (pose.ox + dx * cos - dy * sin)
    v += w * (pose.oy + dx * sin + dy * cos)
  }
  return { u, v }
}
