/**
 * dsh-canvas — design document renderers (design node, §渲染层; v2 底座).
 *
 * Two backends behind one painter: **CanvasKit** (Skia on WASM — the fidelity
 * path, loaded lazily from the plugin's asset route) and a plain **2D canvas**
 * (always available, the degradation when the WASM is not shipped or fails to
 * init). Both draw the same scene graph through the same viewport, so a
 * fallback changes the engine, not the picture.
 *
 * The painter walks each container's subtree in z-order (`SceneGraph.getChildren`
 * carries the order), resolving solid fills/strokes to css for the 2D backend.
 * Gradients, images and vector networks render on the CanvasKit path (M2+);
 * on 2D they fall back to the first solid paint or nothing — visible
 * degradation, never a silent wrong color.
 *
 * Hit-testing lives on the graph itself (`graph.hitTest`); selection and
 * editing UI are later milestones. This module only answers "what does the
 * document look like".
 */
import { containersIn, colorToCss, type DesignGraph, type SceneNode } from '../../../../core/artifact/design/document.ts'

/** The gutter between containers when the zoom-to-fit needs a target box. */
export const ARTBOARD_GUTTER = 64

/** One drawing primitive the backends implement. Coordinates are screen-space. */
export interface DesignPaintOps {
  /** Apply an opacity to every call until the next one (1 = reset). */
  opacity(alpha: number): void
  /**
   * The container backdrop: a white sheet with a soft drop shadow, drawn under
   * the board's own fill so a document reads as sheets on a canvas, not rects
   * on a void. Optional — a backend without it just skips the dressing.
   */
  shadowRect?(x: number, y: number, width: number, height: number, radius: number): void
  rect(x: number, y: number, width: number, height: number, radius: number, fill: string | null, stroke: string | null, strokeWidth: number): void
  ellipse(cx: number, cy: number, rx: number, ry: number, fill: string | null, stroke: string | null, strokeWidth: number): void
  /**
   * One text node: `lines` already split on '\n', anchored per the node's
   * `align` **inside the node's width** (left → node left edge, center →
   * midpoint, right → node right edge) — the anchor x the caller passes is
   * already resolved, the backend only sets `textAlign`.
   */
  text(lines: readonly string[], x: number, y: number, size: number, family: string, align: 'left' | 'center' | 'right', fill: string, lineHeight: number): void
  /**
   * Clip everything painted between this and the matching {@link popClip} to a
   * rounded rect (screen-space). Calls nest strictly (tree recursion), like
   * canvas save/restore — a frame pushes before its children paint and pops
   * after, so content that overflows the frame simply does not show.
   */
  pushClip(x: number, y: number, width: number, height: number, radius: number): void
  /** End the innermost {@link pushClip} (restores the enclosing clip and opacity). */
  popClip(): void
}

/**
 * 一页里所有容器的包围盒，文档单位。
 *
 * `pageId` 是**必填**的：一次只画一页，贴合也得只按这一页算。传 `''`（还没定页）时
 * 退回 1×1 的空框——比「把全文档的容器一起框进来」安全得多，后者在多页之后会把镜头
 * 拉到一屏装下所有页。
 */
export function documentBounds(graph: DesignGraph, pageId: string): { x: number; y: number; width: number; height: number } {
  let right = 1
  let bottom = 1
  for (const board of containersIn(graph, pageId)) {
    // 区域里的容器，坐标是**相对区域**的——取绝对原点才是一份文档里的位置。
    const origin = graph.getAbsolutePosition(board.id)
    right = Math.max(right, origin.x + board.width)
    bottom = Math.max(bottom, origin.y + board.height)
  }
  return { x: 0, y: 0, width: right, height: bottom }
}

/** The zoom-to-fit transform for a page inside a viewport of the given size. */
export function fitTransform(graph: DesignGraph, pageId: string, viewportWidth: number, viewportHeight: number): { x: number; y: number; scale: number } {
  const bounds = documentBounds(graph, pageId)
  const scale = Math.min((viewportWidth - ARTBOARD_GUTTER) / bounds.width, (viewportHeight - ARTBOARD_GUTTER) / bounds.height, 1)
  const safe = Math.max(scale, 0.01)
  return {
    x: (viewportWidth - bounds.width * safe) / 2,
    y: (viewportHeight - bounds.height * safe) / 2,
    scale: safe,
  }
}

/** 把**这一页**的容器画进 `ops`。屏幕原点 = transform + 容器的绝对原点·scale。 */
export function paintDocument(graph: DesignGraph, ops: DesignPaintOps, transform: { x: number; y: number; scale: number }, pageId: string): void {
  for (const board of containersIn(graph, pageId)) {
    if (!board.visible) continue
    // 与 documentBounds 同一口径：区域里的容器要按绝对原点落笔。
    const origin = graph.getAbsolutePosition(board.id)
    const px = transform.x + origin.x * transform.scale
    const py = transform.y + origin.y * transform.scale
    ops.shadowRect?.(px, py, board.width * transform.scale, board.height * transform.scale, board.cornerRadius * transform.scale)
    paintNode(graph, board, ops, transform, px, py, true)
  }
}

function paintNode(
  graph: DesignGraph,
  node: SceneNode,
  ops: DesignPaintOps,
  transform: { x: number; y: number; scale: number },
  px: number,
  py: number,
  isBoard: boolean,
): void {
  ops.opacity(clamp01(node.opacity))
  paintOne(node, ops, px, py, transform.scale)
  // 容器默认裁切溢出内容（一页一容器：文本页面 / App 页面 / PPT 页面 / 海报……）；
  // 其余容器按自己的 clipsContent 走——新建的容器默认就是 true（Figma 的 frame
  // 语义），最顶这一枚另按身份兜底，老文档里没带这一位的容器照旧裁。
  // 区域不裁，与 Figma 一致：元素可以溢出模块照常显示，只要不出容器。容器自己的
  // 填充与描边先画，不被自己的裁切削掉半根边。
  const clips = node.type === 'FRAME' && (isBoard || node.clipsContent)
  if (clips) {
    ops.pushClip(px, py, node.width * transform.scale, node.height * transform.scale, node.cornerRadius * transform.scale)
  }
  for (const child of graph.getChildren(node.id)) {
    if (child.visible) {
      paintNode(graph, child, ops, transform, px + child.x * transform.scale, py + child.y * transform.scale, false)
    }
  }
  if (clips) {
    ops.popClip()
  }
  ops.opacity(1)
}

function paintOne(node: SceneNode, ops: DesignPaintOps, px: number, py: number, s: number): void {
  const width = node.width * s
  const height = node.height * s
  const fill = solidCss(node, 'fills')
  const stroke = solidCss(node, 'strokes')
  const strokeWidth = (node.strokes.find((paint) => paint.visible)?.weight ?? 0) * s
  switch (node.type) {
    case 'FRAME':
    case 'RECTANGLE':
    case 'ROUNDED_RECTANGLE':
    case 'GROUP':
    case 'SECTION':
      ops.rect(px, py, width, height, node.cornerRadius * s, fill, stroke, strokeWidth)
      return
    case 'ELLIPSE':
      ops.ellipse(px + width / 2, py + height / 2, width / 2, height / 2, fill, stroke, strokeWidth)
      return
    case 'TEXT': {
      if (node.text === '') return
      const anchorX = node.textAlignHorizontal === 'CENTER' ? px + width / 2 : node.textAlignHorizontal === 'RIGHT' ? px + width : px
      const size = Math.max(node.fontSize * s, 1)
      const align = node.textAlignHorizontal === 'JUSTIFIED' ? 'left' : node.textAlignHorizontal.toLowerCase() as 'left' | 'center' | 'right'
      ops.text(node.text.split('\n'), anchorX, py, size, node.fontFamily, align, fill ?? '#000000', size * 1.4)
      return
    }
    default:
      // LINE / VECTOR / shapes the 2D fallback does not draw yet: CanvasKit
      // (M2+) renders them; here they degrade to their bounding box outline.
      if (fill !== null || stroke !== null) {
        ops.rect(px, py, width, height, 0, fill, stroke, strokeWidth)
      }
      return
  }
}

function solidCss(node: SceneNode, which: 'fills' | 'strokes'): string | null {
  if (which === 'fills') {
    const paint = node.fills.find((entry) => entry.visible && entry.type === 'SOLID')
    return paint === undefined ? null : colorToCss(paint.color)
  }
  const stroke = node.strokes.find((entry) => entry.visible)
  return stroke === undefined ? null : colorToCss(stroke.color)
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

/** The 2D-canvas backend: the always-available picture. */
export function canvas2dBackend(context: CanvasRenderingContext2D): DesignPaintOps {
  return {
    opacity(alpha) {
      context.globalAlpha = alpha
    },
    shadowRect(x, y, width, height, radius) {
      context.save()
      context.shadowColor = 'rgba(15, 23, 42, 0.16)'
      context.shadowBlur = 20
      context.shadowOffsetY = 3
      context.beginPath()
      context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2))
      context.fillStyle = '#ffffff'
      context.fill()
      context.restore()
    },
    rect(x, y, width, height, radius, fill, stroke, strokeWidth) {
      context.beginPath()
      const r = Math.min(radius, width / 2, height / 2)
      context.roundRect(x, y, width, height, r)
      if (fill !== null) {
        context.fillStyle = fill
        context.fill()
      }
      if (stroke !== null) {
        context.strokeStyle = stroke
        context.lineWidth = strokeWidth
        context.stroke()
      }
    },
    ellipse(cx, cy, rx, ry, fill, stroke, strokeWidth) {
      context.beginPath()
      context.ellipse(cx, cy, Math.max(rx, 0), Math.max(ry, 0), 0, 0, Math.PI * 2)
      if (fill !== null) {
        context.fillStyle = fill
        context.fill()
      }
      if (stroke !== null) {
        context.strokeStyle = stroke
        context.lineWidth = strokeWidth
        context.stroke()
      }
    },
    text(lines, x, y, size, family, align, fill, lineHeight) {
      context.font = `400 ${size}px ${family === '' ? 'sans-serif' : family}`
      context.textAlign = align
      context.textBaseline = 'top'
      context.fillStyle = fill
      lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight))
    },
    pushClip(x, y, width, height, radius) {
      context.save()
      context.beginPath()
      context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2))
      context.clip()
    },
    popClip() {
      context.restore()
    },
  }
}
