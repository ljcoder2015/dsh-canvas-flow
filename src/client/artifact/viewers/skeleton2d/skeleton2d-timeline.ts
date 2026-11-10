/**
 * dsh-canvas — skeleton2d 编辑器**时间线模式**的纯算术（零依赖、零 React）。
 *
 * 对应 Cubism Editor 的动画工作区：每条动作（呼吸 / 摇摆 / 倾头）是一条**轨道**，
 * 横轴是循环（0–1），纵轴是动作取值（-1 … 1）。键画在轨道上，曲线按
 * `motionValueAt`（core 里的唯一分岔点）采样——屏幕上画的与渲染器算的必然是同一条线。
 *
 * 交互算术三件事：坐标↔时间/取值、键的命中测试、整幅时间线的绘制。动画的实时形状
 * 不在这里算——绘制方把「当前取值函数」递进来，这里只管把它画出来。
 */

import type { Skeleton2dKeyframe } from '../../../../core/skeleton2d/model.ts'
import { GRID_COLS } from '../../../../core/skeleton2d/rig.ts'

/** 顶部标尺带的高度（像素）：刻度与循环百分比。 */
export const RULER_HEIGHT = 18

/** 键的命中半径（像素）。 */
export const KEY_RADIUS_PX = 10

/** 一条轨道的屏幕矩形（相对时间线画布左上角）。 */
export interface TrackRect {
  top: number
  height: number
}

/** 三条轨道的布局：从标尺下面开始，等高平分剩下的高度。 */
export function trackRects(count: number, height: number, gap = 6): TrackRect[] {
  const usable = Math.max(0, height - RULER_HEIGHT - gap * (count + 1))
  const each = count === 0 ? 0 : (usable - gap * (count - 1)) / count
  const rects: TrackRect[] = []
  let top = RULER_HEIGHT + gap
  for (let index = 0; index < count; index += 1) {
    rects.push({ top, height: each })
    top += each + gap
  }
  return rects
}

/** 循环比例 p（0–1）→ 时间线画布横坐标。 */
export function timeToX(p: number, width: number): number {
  return Math.min(1, Math.max(0, p)) * Math.max(1, width)
}

/** 时间线画布横坐标 → 循环比例（0–1，夹边）。 */
export function xToTime(px: number, width: number): number {
  return Math.min(1, Math.max(0, px / Math.max(1, width)))
}

/** 动作取值 v（-1…1）→ 轨道内纵坐标（轨道中线为零点）。 */
export function valueToY(v: number, rect: TrackRect): number {
  const clamped = Math.min(1, Math.max(-1, v))
  return rect.top + rect.height * (1 - (clamped + 1) / 2)
}

/** 轨道内纵坐标 → 动作取值（夹进 -1…1）。 */
export function yToValue(py: number, rect: TrackRect): number {
  const inside = Math.min(rect.height, Math.max(0, py - rect.top))
  return 1 - (inside / Math.max(1, rect.height)) * 2
}

/** 一枚键的屏幕位置（横轴用整幅画布宽，纵轴用轨道矩形）。 */
export function keyPoint(key: Skeleton2dKeyframe, rect: TrackRect, width: number): { x: number; y: number } {
  return { x: timeToX(key.t, width), y: valueToY(key.v, rect) }
}

/** 命中测试：最近的键；距离超过 {@link KEY_RADIUS_PX} 算没抓住。 */
export function nearestKey(
  px: number,
  py: number,
  keys: readonly Skeleton2dKeyframe[],
  rect: TrackRect,
  width: number,
): number | undefined {
  let best = -1
  let bestDistance = KEY_RADIUS_PX
  for (let index = 0; index < keys.length; index += 1) {
    const point = keyPoint(keys[index] as Skeleton2dKeyframe, rect, width)
    const distance = Math.hypot(px - point.x, py - point.y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  }
  return best === -1 ? undefined : best
}

/** 时间线画布的纵向点击落在哪条轨道（不在任何轨道里是 `undefined`）。 */
export function trackAt(py: number, rects: readonly TrackRect[]): number | undefined {
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index] as TrackRect
    if (py >= rect.top && py <= rect.top + rect.height) return index
  }
  return undefined
}

/**
 * 画整幅时间线：标尺刻度、每条轨道的零线与动作曲线、键点、播放头。
 *
 * `values` 给出每条轨道此刻的取值（-1…1，调用方用 `motionValueAt` 现算——这里是
 * 画笔不是算盘）；`playhead` 是循环比例；`selected` 是被拖住的那枚键。
 */
export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rects: readonly TrackRect[],
  values: readonly number[],
  keys: readonly (readonly Skeleton2dKeyframe[] | undefined)[],
  sampled: readonly ((p: number) => number)[],
  playhead: number,
  selected: { track: number; key: number } | undefined,
): void {
  ctx.clearRect(0, 0, width, height)
  // 标尺：八格刻度 + 播放头竖线。
  ctx.strokeStyle = 'rgba(127, 127, 127, 0.4)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let tick = 0; tick <= 8; tick += 1) {
    const x = timeToX(tick / 8, width)
    ctx.moveTo(x, 0)
    ctx.lineTo(x, RULER_HEIGHT - 6)
  }
  ctx.stroke()
  const headX = timeToX(playhead, width)
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)'
  ctx.beginPath()
  ctx.moveTo(headX, 0)
  ctx.lineTo(headX, height)
  ctx.stroke()
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index] as TrackRect
    // 轨道底 + 零线。
    ctx.strokeStyle = 'rgba(127, 127, 127, 0.25)'
    ctx.strokeRect(0.5, rect.top + 0.5, width - 1, rect.height - 1)
    const zero = valueToY(0, rect)
    ctx.strokeStyle = 'rgba(127, 127, 127, 0.35)'
    ctx.beginPath()
    ctx.moveTo(0, zero)
    ctx.lineTo(width, zero)
    ctx.stroke()
    // 曲线：按网格密度采样（与渲染同一副函数算出来的形状）。
    const sample = sampled[index]
    if (sample !== undefined) {
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.9)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let step = 0; step <= GRID_COLS * 2; step += 1) {
        const p = step / (GRID_COLS * 2)
        const x = timeToX(p, width)
        const y = valueToY(sample(p), rect)
        if (step === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.lineWidth = 1
    }
    // 此刻的取值：一枚横杠——曲线在动，横杠就是「现在」。
    const value = values[index]
    if (value !== undefined) {
      const y = valueToY(value, rect)
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)'
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }
    // 键点。
    const trackKeys = keys[index]
    if (trackKeys !== undefined) {
      for (let k = 0; k < trackKeys.length; k += 1) {
        const point = keyPoint(trackKeys[k] as Skeleton2dKeyframe, rect, width)
        const grabbed = selected !== undefined && selected.track === index && selected.key === k
        ctx.fillStyle = grabbed ? 'rgba(255, 255, 255, 0.95)' : 'rgba(96, 165, 250, 0.95)'
        ctx.beginPath()
        ctx.arc(point.x, point.y, grabbed ? 5 : 3.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}
