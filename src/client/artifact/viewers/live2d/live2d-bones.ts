/**
 * dsh-canvas — live2d 编辑器**骨骼模式**的纯算术（零依赖、零 React）。
 *
 * 骨骼模式把编辑台变成最小的绑骨台：点击画面空白处落一枚关节（父级＝当前选中的那
 * 枚），拖动调位置，面板里改父级 / 删除。屏幕上只画 **rest 姿态**的骨架——绑骨是
 * 在「静止的角色」上做的，动画里的实时姿态交给左侧的 WebGL 画布。
 *
 * 坐标约定与 `live2d-mesh.ts` 同一条：uv（0–1，y 向下），贴合盒由 `containLayout`
 * 给出；变形数学本体在 `core/live2d/bones.ts`，这里只认屏幕。
 */

import type { Live2dBone } from '../../../../core/live2d/model.ts'
import type { ContainBox } from './live2d-editor-layout.ts'

/** 关节的拾取半径（像素）：比网格顶点宽——关节稀疏，点中了就该抓住。 */
export const BONE_PICK_RADIUS_PX = 14

/** 一枚关节在贴合盒里的屏幕像素位置（相对编辑台左上角）。 */
export function bonePixel(bone: { x: number; y: number }, box: ContainBox): { x: number; y: number } {
  return {
    x: box.left + bone.x * box.width,
    y: box.top + bone.y * box.height,
  }
}

/**
 * 屏幕坐标 → 最近的关节序号；距离超过 {@link BONE_PICK_RADIUS_PX} 就是没抓住。
 * letterbox 区的点先被 uv 越界挡掉。
 */
export function nearestBone(
  px: number,
  py: number,
  bones: readonly Live2dBone[],
  box: ContainBox,
): number | undefined {
  let best = -1
  let bestDistance = BONE_PICK_RADIUS_PX
  for (let index = 0; index < bones.length; index += 1) {
    const point = bonePixel(bones[index] as Live2dBone, box)
    const distance = Math.hypot(px - point.x, py - point.y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  }
  return best === -1 ? undefined : best
}

/** 屏幕坐标 → 关节的 uv（夹进 [0,1]）：落关节与拖动共用这一副换算。 */
export function boneUVFromPoint(px: number, py: number, box: ContainBox): { x: number; y: number } {
  const clamp = (value: number): number => Math.min(1, Math.max(0, value))
  return {
    x: Math.round(clamp((px - box.left) / Math.max(1, box.width)) * 1000) / 1000,
    y: Math.round(clamp((py - box.top) / Math.max(1, box.height)) * 1000) / 1000,
  }
}

/** 下一根骨骼的名字：`b1`、`b2`…取最小的空号（删过骨骼也不重名）。 */
export function nextBoneName(existing: readonly Live2dBone[]): string {
  const used = new Set(existing.map((bone) => bone.name))
  for (let index = 1; index <= existing.length + 1; index += 1) {
    if (!used.has(`b${index}`)) return `b${index}`
  }
  return `b${existing.length + 1}`
}

/**
 * 画骨架叠层：父→子的连线 + 关节点（选中的亮环、根骨空心的区分一眼能读）。
 * 画布尺寸与编辑台一致；`box` 是贴合盒（与动画画布的 contain 同一句算术）。
 */
export function drawBonesOverlay(
  ctx: CanvasRenderingContext2D,
  box: ContainBox,
  bones: readonly Live2dBone[],
  selected: number | undefined,
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  if (box.width <= 0 || box.height <= 0) return
  // 连线：父 → 子。
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.75)'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let index = 0; index < bones.length; index += 1) {
    const bone = bones[index] as Live2dBone
    if (bone.parent === undefined) continue
    const parentIndex = bones.findIndex((entry) => entry.name === bone.parent)
    if (parentIndex < 0) continue
    const from = bonePixel(bones[parentIndex] as Live2dBone, box)
    const to = bonePixel(bone, box)
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
  }
  ctx.stroke()
  // 关节点。
  for (let index = 0; index < bones.length; index += 1) {
    const { x, y } = bonePixel(bones[index] as Live2dBone, box)
    const isSelected = index === selected
    ctx.beginPath()
    ctx.arc(x, y, isSelected ? 7 : 5, 0, Math.PI * 2)
    ctx.fillStyle = isSelected ? 'rgba(96, 165, 250, 0.95)' : 'rgba(96, 165, 250, 0.6)'
    ctx.fill()
    if (isSelected) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, 10, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 1
    }
  }
}
