/**
 * dsh-canvas — skeleton2d 的渲染舞台（WebGL1，零 React、零依赖）。
 *
 * 它只做一件事：**把贴图按网格顶点的位移画到一块画布上**——分层模型就一层画一遍。
 * 变形算术全在 `core/skeleton2d/rig.ts`（纯），这里只是把算出来的顶点喂给 GPU——渲染器
 * 自己不算位移，是因为导出器要用同一份算术逐帧出图：两处各写一遍位移，早晚一边改了
 * 参数形状另一边还在算旧版。
 *
 * 分层是**客户端现切**的：模型里只存「矩形 + 游程掩码 + 网格密度」，不存切好的层图。
 * 好处是少一份来源就少一份漂移——改一个矩形不必重写一堆 PNG，整套产物仍旧是「一份 JSON
 * ＋一张原图」；代价是每次模型里那几样变了要重切一次（几毫秒，一张贴图几层而已）。
 *
 * 三个使用者，同一条 API：
 * - 卡面（`client/canvas/card/skeleton2d-face.tsx`）：小画布，跟着板面一直播；
 * - 全屏预览（`skeleton2d-viewer.tsx`）：大画布，同一份循环；
 * - 帧序列导出（`client/canvas/export/skeleton2d-export.ts`）：离屏画布 +
 *   `preserveDrawingBuffer`，逐帧读像素拼雪碧图。
 *
 * 贴合规则是 `object-fit: contain` 的语义：画布比例与贴图比例不一致时，画面按贴图比例
 * 缩放居中，多余的部分透出底色（透明）。卡面上底色就是卡片的面板色。
 */

import {
  GRID_COLS,
  GRID_ROWS,
  baseGrid,
  baseLayerGrid,
  gridIndices,
  poseGridAt,
  type GridVertex,
} from '../../../../core/skeleton2d/rig.ts'
import { decodeMask } from '../../../../core/skeleton2d/layerize.ts'
import type { Skeleton2dLayer, Skeleton2dModel } from '../../../../core/skeleton2d/model.ts'

/** 建舞台的可选项。 */
export interface Skeleton2dStageOptions {
  /**
   * 保留绘图缓冲。默认关（板面上反复重绘，不保留省显存）；导出端逐帧 `toDataURL` /
   * `drawImage` 读像素，必须开——否则读到的可能是下一帧擦干净的缓冲。
   */
  preserveDrawingBuffer?: boolean
}

/** 一块已经装配好的渲染舞台。 */
export interface Skeleton2dStage {
  /** 画布尺寸变了（卡面固定一档，全屏会跟着窗口变）之后调一次。 */
  resize(width: number, height: number): void
  /** 画出时刻 t 的一帧。`image` 必须已经加载完（`naturalWidth > 0`）。 */
  draw(model: Skeleton2dModel, image: TexImageSource & { width: number; height: number }, t: number): void
  /** 释放 GL 资源。画布元素本身由调用方卸载。 */
  dispose(): void
}

/** 顶点着色器：位移后的 uv（0–1，y 向下）→ 裁剪空间，贴合用 uniform 传进来的缩放。 */
const VERTEX_SHADER = `
attribute vec2 aPos;
attribute vec2 aTex;
uniform vec2 uScale;
uniform vec2 uOffset;
varying vec2 vTex;
void main() {
  vTex = aTex;
  vec2 centered = vec2((aPos.x - 0.5) * uScale.x, (0.5 - aPos.y) * uScale.y);
  gl_Position = vec4(centered + uOffset, 0.0, 1.0);
}
`

/** 片元着色器：直接采样原图。透明像素透出底色，混合交给 WebGL 的 premultiplied alpha。 */
const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vTex;
uniform sampler2D uImage;
void main() {
  gl_FragColor = texture2D(uImage, vTex);
}
`

/** 编译一枚着色器；失败在控制台说一声并让建舞台整体失败（调用方退回占位）。 */
function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | undefined {
  const shader = gl.createShader(type)
  if (shader === null) return undefined
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('dsh-canvas skeleton2d shader:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return undefined
  }
  return shader
}

/** 共享的整幅网格与三角索引：形状永远一样，算一次就够。 */
const BASE_GRID = baseGrid()
const GRID_INDEX = gridIndices()
/** 每帧上传的顶点缓冲（位移后的 uv，两个浮点一个顶点）。 */
const FRAME_POSITIONS = new Float32Array(BASE_GRID.length * 2)
/** 采样坐标缓冲（原始 uv，永远不变）。 */
const TEX_COORDS = (() => {
  const coords = new Float32Array(BASE_GRID.length * 2)
  BASE_GRID.forEach((vertex, index) => {
    coords[index * 2] = vertex.su
    coords[index * 2 + 1] = vertex.sv
  })
  return coords
})()

/** 一串文本的短指纹（缓存键用：掩码可能有几万字符，不能直接拼进键里）。 */
function digest(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** 一层的缓存键：矩形、掩码、网格密度、源图尺寸，任何一样变了都得重切。 */
function layerKeyOf(layers: readonly Skeleton2dLayer[], image: { width: number; height: number }): string {
  const parts = layers.map((layer) => {
    const rect = layer.rect
    const mask = layer.mask === undefined ? '-' : `${layer.mw ?? 0}x${layer.mh ?? 0}:${digest(layer.mask)}`
    return `${layer.name}:${rect.x},${rect.y},${rect.w},${rect.h}:${mask}:${layer.cols}x${layer.rows}`
  })
  return `${image.width}x${image.height}|${parts.join('|')}`
}

/**
 * 把一层从整幅贴图上切下来：矩形裁一块，掩码把不属于这层的像素擦成透明。
 *
 * 掩码栅格与裁图尺寸常常不整除（掩码是整数像素，矩形是千分位 uv），按最近邻取样——
 * 边界差半个像素，肉眼看不出来，也不必为它引入双线性。
 */
function cutLayer(image: TexImageSource & { width: number; height: number }, layer: Skeleton2dLayer): HTMLCanvasElement {
  const width = Math.max(1, Math.round(layer.rect.w * image.width))
  const height = Math.max(1, Math.round(layer.rect.h * image.height))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) return canvas
  context.drawImage(image as CanvasImageSource, layer.rect.x * image.width, layer.rect.y * image.height, width, height, 0, 0, width, height)
  if (layer.mask === undefined) return canvas
  const mw = Math.max(1, layer.mw ?? width)
  const mh = Math.max(1, layer.mh ?? height)
  const bits = decodeMask(layer.mask, mw * mh)
  const pixels = context.getImageData(0, 0, width, height)
  for (let y = 0; y < height; y += 1) {
    const my = Math.min(mh - 1, Math.floor((y * mh) / height))
    for (let x = 0; x < width; x += 1) {
      const mx = Math.min(mw - 1, Math.floor((x * mw) / width))
      if (bits[my * mw + mx] === 1) continue
      pixels.data[(y * width + x) * 4 + 3] = 0
    }
  }
  context.putImageData(pixels, 0, 0)
  return canvas
}

/**
 * 建一块舞台；WebGL 不可用（软件渲染被禁、上下文丢失）时返回 `undefined`——调用方
 * 退回一张静态贴图占位，而不是一块黑布。
 */
export function createSkeleton2dStage(
  canvas: HTMLCanvasElement,
  options: Skeleton2dStageOptions = {},
): Skeleton2dStage | undefined {
  const gl = (canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    preserveDrawingBuffer: options.preserveDrawingBuffer === true,
  }) ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
  if (gl === null) return undefined

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (vertex === undefined || fragment === undefined) return undefined
  const program = gl.createProgram()
  if (program === null) return undefined
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('dsh-canvas skeleton2d program:', gl.getProgramInfoLog(program))
    return undefined
  }
  gl.useProgram(program)

  const positionBuffer = gl.createBuffer()
  const texBuffer = gl.createBuffer()
  const indexBuffer = gl.createBuffer()
  if (positionBuffer === null || texBuffer === null || indexBuffer === null) return undefined

  const aPos = gl.getAttribLocation(program, 'aPos')
  const aTex = gl.getAttribLocation(program, 'aTex')
  gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, TEX_COORDS, gl.STATIC_DRAW)
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, GRID_INDEX, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(aPos)
  gl.enableVertexAttribArray(aTex)
  const uScale = gl.getUniformLocation(program, 'uScale')
  const uOffset = gl.getUniformLocation(program, 'uOffset')

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  gl.clearColor(0, 0, 0, 0)

  const texture = gl.createTexture()
  if (texture === null) return undefined
  const configure = (): void => {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  }
  gl.bindTexture(gl.TEXTURE_2D, texture)
  configure()

  let width = 0
  let height = 0

  // 分层缓存：键一变就重切（矩形、掩码、网格密度、源图尺寸任一变了）。
  let layeredKey = ''
  let layered: Array<{ texture: WebGLTexture; grid: GridVertex[]; cols: number; rows: number; layer: Skeleton2dLayer }> = []
  const indicesCache = new Map<string, Uint16Array>()
  const indicesOf = (cols: number, rows: number): Uint16Array => {
    const key = `${cols}x${rows}`
    const cached = indicesCache.get(key)
    if (cached !== undefined) return cached
    const next = gridIndices(cols, rows)
    indicesCache.set(key, next)
    return next
  }

  const clearLayered = (): void => {
    for (const entry of layered) gl.deleteTexture(entry.texture)
    layered = []
    layeredKey = ''
  }

  /** 按当前模型把层图切好、传成纹理；同一份分层只切一次。 */
  const ensureLayered = (
    model: Skeleton2dModel,
    image: TexImageSource & { width: number; height: number },
  ): typeof layered => {
    const layers = model.layers ?? []
    const key = layerKeyOf(layers, image)
    if (key === layeredKey) return layered
    clearLayered()
    layeredKey = key
    for (const layer of layers) {
      const cut = cutLayer(image, layer)
      const next = gl.createTexture()
      if (next === null) continue
      gl.bindTexture(gl.TEXTURE_2D, next)
      configure()
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cut)
      layered.push({
        texture: next,
        grid: baseLayerGrid(layer.rect, layer.cols, layer.rows),
        cols: layer.cols,
        rows: layer.rows,
        layer,
      })
    }
    return layered
  }

  return {
    resize(nextWidth: number, nextHeight: number): void {
      width = nextWidth
      height = nextHeight
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth
        canvas.height = nextHeight
      }
      gl.viewport(0, 0, nextWidth, nextHeight)
    },
    draw(model, image, t): void {
      // contain 贴合：画面按贴图比例缩放到「恰好装进画布」，居中。
      const imageAspect = image.width / image.height
      const canvasAspect = width / Math.max(1, height)
      let drawWidth = width
      let drawHeight = width / imageAspect
      if (canvasAspect > imageAspect) {
        drawHeight = height
        drawWidth = height * imageAspect
      }
      gl.uniform2f(uScale, drawWidth / Math.max(1, width), drawHeight / Math.max(1, height))
      gl.uniform2f(uOffset, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)

      const layers = ensureLayered(model, image)
      if (layers.length === 0) {
        // 没分层：整幅一张网格（24×24），与分层之前的行为逐位一致。
        const vertices = BASE_GRID as GridVertex[]
        poseGridAt(vertices, model, t)
        for (let index = 0; index < vertices.length; index += 1) {
          FRAME_POSITIONS[index * 2] = (vertices[index] as GridVertex).u
          FRAME_POSITIONS[index * 2 + 1] = (vertices[index] as GridVertex).v
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, FRAME_POSITIONS, gl.DYNAMIC_DRAW)
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer)
        gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 0, 0)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
        gl.drawElements(gl.TRIANGLES, GRID_INDEX.length, gl.UNSIGNED_SHORT, 0)
        return
      }

      // 分层：一层一遍。顶点仍是整幅 uv，采样坐标是层内 0–1（层图就是那一块）。
      for (const entry of layers) {
        const { cols, rows, grid } = entry
        poseGridAt(grid, model, t, cols, rows, entry.layer)
        const positions = new Float32Array(grid.length * 2)
        const coords = new Float32Array(grid.length * 2)
        for (let index = 0; index < grid.length; index += 1) {
          const point = grid[index] as GridVertex
          positions[index * 2] = point.u
          positions[index * 2 + 1] = point.v
          coords[index * 2] = (point.u - entry.layer.rect.x) / Math.max(1e-6, entry.layer.rect.w)
          coords[index * 2 + 1] = (point.v - entry.layer.rect.y) / Math.max(1e-6, entry.layer.rect.h)
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, coords, gl.DYNAMIC_DRAW)
        gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 0, 0)
        const indices = indicesOf(cols, rows)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW)
        gl.bindTexture(gl.TEXTURE_2D, entry.texture)
        gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0)
      }
    },
    dispose(): void {
      clearLayered()
      gl.deleteTexture(texture)
      gl.deleteBuffer(positionBuffer)
      gl.deleteBuffer(texBuffer)
      gl.deleteBuffer(indexBuffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
    },
  }
}

/** 网格密度导出给导出端（雪碧图的说明里要写网格参数）。 */
export { GRID_COLS, GRID_ROWS }
