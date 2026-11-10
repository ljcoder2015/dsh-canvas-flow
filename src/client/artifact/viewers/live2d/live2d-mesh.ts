/**
 * dsh-canvas — live2d 编辑器**网格模式**的纯算术（零依赖、零 React）。
 *
 * 网格模式把编辑台变成 Cubism Editor 的顶点编辑：贴图上铺开 25×25 个网格顶点，拖哪个
 * 哪个就带着贴图走，位移存进模型的 `deform.offsets`（顶点序号 → uv 位移）。这段算术
 * 只有屏幕像素 ↔ 贴图 uv 的换算和拾取——变形数学本体在 `core/live2d/rig.ts`，这里
 * 不碰顶点，只认屏幕。
 *
 * 坐标约定与 `live2d-editor-layout.ts` 同一条：uv（0–1，y 向下），贴合盒由
 * {@link containLayout} 给出。
 */

import { GRID_COLS, GRID_ROWS } from '../../../../core/live2d/rig.ts'
import type { Live2dModel } from '../../../../core/live2d/model.ts'
import type { ContainBox } from './live2d-editor-layout.ts'

/** 拾取半径（像素）：鼠标到顶点中心不超过这个距离算「抓住了」。网格 24 格在 300px 的
 *  贴合盒里是 12.5px 一格，半径 8 意味着格胞正中是真空——点空白处不会有任何反应。 */
export const PICK_RADIUS_PX = 8

/** 一个网格顶点在贴合盒里的屏幕像素位置（相对编辑台左上角）。 */
export function vertexPixel(col: number, row: number, box: ContainBox, cols = GRID_COLS, rows = GRID_ROWS): { x: number; y: number } {
  return {
    x: box.left + (col / cols) * box.width,
    y: box.top + (row / rows) * box.height,
  }
}

/**
 * 屏幕坐标 → 最近的网格顶点；距离超过 {@link PICK_RADIUS_PX} 就是没抓住（`undefined`）。
 * 顶点必须落在贴合盒里才有意义——letterbox 区的点先被距离挡掉了。
 */
export function nearestVertex(
  px: number,
  py: number,
  box: ContainBox,
  cols = GRID_COLS,
  rows = GRID_ROWS,
): { col: number; row: number } | undefined {
  const u = (px - box.left) / Math.max(1, box.width)
  const v = (py - box.top) / Math.max(1, box.height)
  if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) return undefined
  const col = Math.round(u * cols)
  const row = Math.round(v * rows)
  const point = vertexPixel(Math.min(cols, Math.max(0, col)), Math.min(rows, Math.max(0, row)), box, cols, rows)
  const distance = Math.hypot(px - point.x, py - point.y)
  return distance <= PICK_RADIUS_PX ? { col: Math.min(cols, Math.max(0, col)), row: Math.min(rows, Math.max(0, row)) } : undefined
}

/**
 * 拖动中的位移：抓住的顶点从原位被拉到屏幕某点，位移 = 目标 uv − 原 uv，夹进
 * ±`max`（归一上限，`DEFORM_MAX`）。返回 uv 位移对，调用方量化后写进草稿。
 */
export function dragOffset(
  px: number,
  py: number,
  col: number,
  row: number,
  box: ContainBox,
  max: number,
  cols = GRID_COLS,
  rows = GRID_ROWS,
): [number, number] {
  const u = (px - box.left) / Math.max(1, box.width)
  const v = (py - box.top) / Math.max(1, box.height)
  const du = u - col / cols
  const dv = v - row / rows
  return [Math.min(max, Math.max(-max, du)), Math.min(max, Math.max(-max, dv))]
}

/** 位移等于零（顶点回到了原位）就不存——稀疏表里只放真动过的顶点。 */
export function isZeroOffset(offset: [number, number]): boolean {
  return offset[0] === 0 && offset[1] === 0
}

/**
 * 画网格叠层：细线网格 + 雕过的顶点（实心点）+ 悬停/抓住的顶点（亮环）。
 * 画布尺寸与编辑台一致；`box` 是贴合盒（与动画画布的 contain 同一句算术）。
 */
export function drawMeshOverlay(
  ctx: CanvasRenderingContext2D,
  box: ContainBox,
  model: Live2dModel,
  highlight: { col: number; row: number } | undefined,
  cols = GRID_COLS,
  rows = GRID_ROWS,
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  if (box.width <= 0 || box.height <= 0) return
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(127, 127, 127, 0.28)'
  ctx.beginPath()
  for (let col = 0; col <= cols; col += 1) {
    const { x } = vertexPixel(col, 0, box, cols, rows)
    ctx.moveTo(x, box.top)
    ctx.lineTo(x, box.top + box.height)
  }
  for (let row = 0; row <= rows; row += 1) {
    const { y } = vertexPixel(0, row, box, cols, rows)
    ctx.moveTo(box.left, y)
    ctx.lineTo(box.left + box.width, y)
  }
  ctx.stroke()
  // 雕过的顶点：一枚实心点，大小反着位移走——动得多的看得见，动得少的不糊面。
  const offsets = model.deform?.offsets ?? {}
  ctx.fillStyle = 'rgba(96, 165, 250, 0.9)'
  for (const [key, offset] of Object.entries(offsets)) {
    const [colText, rowText] = key.split(',')
    const col = Number(colText)
    const row = Number(rowText)
    if (!Number.isInteger(col) || !Number.isInteger(row)) continue
    const { x, y } = vertexPixel(col, row, box, cols, rows)
    const radius = 2.5 + Math.min(4, Math.hypot(offset[0], offset[1]) * 40)
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  if (highlight !== undefined) {
    const { x, y } = vertexPixel(highlight.col, highlight.row, box, cols, rows)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, Math.PI * 2)
    ctx.stroke()
  }
}
