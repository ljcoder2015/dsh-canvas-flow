/**
 * dsh-canvas — skeleton2d-lite 的**曲线采样**（纯，零依赖）。
 *
 * 「一条动作/骨骼曲线在时刻 t 是多少」的唯一真源：正弦参数化与关键帧两条驱动路在这
 * 里分岔。单放一个模块是因为**骨骼层（`bones.ts`）与变形层（`rig.ts`）都要用同一副
 * 采样**——把它塞进任何一边，另一边就得反向引用，画出环来。
 *
 * 无缝循环的数学性质钉在这里：正弦的频率是「每循环几拍」（整数），关键帧在 [0,1)
 * 上环绕余弦插值——两条路都保证 `t + loop` 处逐位重现。
 */

import type { Skeleton2dKeyframe, Skeleton2dMotion } from './model.ts'

/**
 * 一组正弦动作在时刻 t 的取值（-1 … 1）。
 *
 * `cycles` 是整数这件事由模型归一保证（`model.ts` 的 `motionOf` 取整）；这里再用
 * `Math.round` 钉一道，因为本函数是「无缝循环」这条性质的最后守门人。
 */
function waveAt(cycles: number, phase: number, t: number, loop: number): number {
  const whole = Math.round(cycles)
  return Math.sin(2 * Math.PI * (whole * (t / loop) + phase))
}

/**
 * 关键帧曲线在循环比例 p（0–1，可越过 1——环绕取模）处的取值（-1 … 1）。
 *
 * 相邻两键之间走**余弦插值**（`(1-cos(πu))/2`）：键两侧的斜率都归零，曲线像手调的
 * 呼吸而不是折线；尾键到首键**环绕**——`p=1` 处的值就是 `p=0` 处的值，无缝循环与
 * 正弦同源。单一键凑不成曲线（归一已拒），两个键重位时退回前值。
 *
 * 环绕那一段是 `[尾键, 1 + 首键]`，跨过循环缝合点：`p > 尾键.t` 与 `p <= 首键.t` 都是
 * 这一段里的位置（前者还没过 1，后者已经过了）。**两半都要算**——只算后一半的话，
 * 尾键到缝合点之间会停在尾键值上，过 1 那一刻再跳到环绕值，循环处就是一个硬接。
 */
export function sampleKeys(keys: readonly Skeleton2dKeyframe[], p: number): number {
  const wrapped = p - Math.floor(p)
  const first = keys[0] as Skeleton2dKeyframe
  const last = keys[keys.length - 1] as Skeleton2dKeyframe
  // 环绕段：`p` 落在尾键之后（还没过 1）或首键之前（已经过了 1）。前者直接用 p，后者
  // 借 `+1` 把它搬到同一条数轴上——两条路落在同一段里，缝合处因此是余弦，不是硬接。
  if (wrapped > last.t || wrapped <= first.t) {
    const span = 1 + first.t - last.t
    if (span <= 0) return first.v
    const u = ((wrapped > last.t ? wrapped : wrapped + 1) - last.t) / span
    return last.v + ((first.v - last.v) * (1 - Math.cos(Math.PI * u))) / 2
  }
  for (let index = 0; index < keys.length - 1; index += 1) {
    const a = keys[index] as Skeleton2dKeyframe
    const b = keys[index + 1] as Skeleton2dKeyframe
    if (wrapped <= b.t) {
      const span = b.t - a.t
      if (span <= 0) return a.v
      const u = (wrapped - a.t) / span
      return a.v + ((b.v - a.v) * (1 - Math.cos(Math.PI * u))) / 2
    }
  }
  return last.v
}

/**
 * 一组动作在时刻 t 的取值（-1 … 1）：有关键帧（≥2 键）走曲线，否则走正弦。
 * 这是「两条驱动路」的唯一分岔点——渲染、导出、判据都只认这一扇门。
 */
export function motionValueAt(motion: Skeleton2dMotion, t: number, loop: number): number {
  if (motion.keys !== undefined && motion.keys.length >= 2) {
    return sampleKeys(motion.keys, t / loop)
  }
  return waveAt(motion.cycles, motion.phase, t, loop)
}
