/**
 * dsh-canvas — live2d 编辑器的**纯算术**（零依赖、零 React）。
 *
 * 两件事：
 *
 * - **contain 贴合布局**：画布比例与贴图比例不一致时，画面按贴图比例缩放居中。这段算术
 *   与舞台（`live2d-stage.ts` 的 draw）是同一个公式的两份表达——舞台那份在 GL uniform
 *   里，这份给 DOM 用（锚点标记的定位、点击坐标的换算）。改贴合规则要两处一起改：
 *   它们都从「装进盒子、按比例、居中」这一句话来。
 * - **点击 → 锚点**：编辑器里「点画面把锚点放那里」，屏幕坐标减去贴合偏移、除以贴合
 *   大小，夹进 0–1。y 向下与模型 uv 同向（`core/live2d/rig.ts` 的约定），不翻转。
 */

/** 一块 contain 贴合出来的矩形（相对画布左上角，像素）。 */
export interface ContainBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 贴图比例 `aspect`（宽 ÷ 高）的画布装进 `width × height` 的盒子——与舞台 draw 里
 * 的 contain 是同一句话。
 */
export function containLayout(aspect: number, width: number, height: number): ContainBox {
  const safeAspect = aspect > 0 ? aspect : 1
  const boxAspect = width / Math.max(1, height)
  let drawWidth = width
  let drawHeight = width / safeAspect
  if (boxAspect > safeAspect) {
    drawHeight = height
    drawWidth = height * safeAspect
  }
  return {
    left: (width - drawWidth) / 2,
    top: (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  }
}

/** 把一个数夹进 [0, 1]。 */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * 画布上的一次点击 → 贴图 uv（0–1，y 向下）锚点。点击落在贴合之外（letterbox 区）
 * 时夹到边缘——锚点不许跑出贴图。
 */
export function anchorFromPoint(
  px: number,
  py: number,
  width: number,
  height: number,
  aspect: number,
): { x: number; y: number } {
  const box = containLayout(aspect, width, height)
  return {
    x: clamp01((px - box.left) / Math.max(1, box.width)),
    y: clamp01((py - box.top) / Math.max(1, box.height)),
  }
}
