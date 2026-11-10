/**
 * dsh-canvas — live2d-lite 的渲染舞台（WebGL1，零 React、零依赖）。
 *
 * 它只做一件事：**把一张贴图按网格顶点的位移画到一块画布上**。变形算术全在
 * `core/live2d/rig.ts`（纯），这里只是把算出来的顶点喂给 GPU——渲染器自己不算位移，
 * 是因为导出器要用同一份算术逐帧出图：两处各写一遍位移，早晚一边改了参数形状另一边
 * 还在算旧版。
 *
 * 三个使用者，同一条 API：
 * - 卡面（`client/canvas/card/live2d-face.tsx`）：398×224 的小画布，跟着板面一直播；
 * - 全屏预览（`live2d-viewer.tsx`）：大画布，同一份循环；
 * - 帧序列导出（`client/canvas/export/live2d-export.ts`）：离屏画布 + `preserveDrawingBuffer`，
 *   逐帧读像素拼雪碧图。
 *
 * 贴合规则是 `object-fit: contain` 的语义：画布比例与贴图比例不一致时，画面按贴图比例
 * 缩放居中，多余的部分透出底色（透明）。卡面上底色就是卡片的面板色。
 */

import { GRID_COLS, GRID_ROWS, baseGrid, gridIndices, poseGridAt, type GridVertex } from '../../../../core/live2d/rig.ts'
import type { Live2dModel } from '../../../../core/live2d/model.ts'

/** 建舞台的可选项。 */
export interface Live2dStageOptions {
  /**
   * 保留绘图缓冲。默认关（板面上反复重绘，不保留省显存）；导出端逐帧 `toDataURL` /
   * `drawImage` 读像素，必须开——否则读到的可能是下一帧擦干净的缓冲。
   */
  preserveDrawingBuffer?: boolean
}

/** 一块已经装配好的渲染舞台。 */
export interface Live2dStage {
  /** 画布尺寸变了（卡面固定一档，全屏会跟着窗口变）之后调一次。 */
  resize(width: number, height: number): void
  /** 画出时刻 t 的一帧。`image` 必须已经加载完（`naturalWidth > 0`）。 */
  draw(model: Live2dModel, image: TexImageSource & { width: number; height: number }, t: number): void
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
    console.error('dsh-canvas live2d shader:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return undefined
  }
  return shader
}

/** 共享的网格与三角索引：形状永远一样，算一次就够。 */
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

/**
 * 建一块舞台；WebGL 不可用（软件渲染被禁、上下文丢失）时返回 `undefined`——调用方
 * 退回一张静态贴图占位，而不是一块黑布。
 */
export function createLive2dStage(canvas: HTMLCanvasElement, options: Live2dStageOptions = {}): Live2dStage | undefined {
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
    console.error('dsh-canvas live2d program:', gl.getProgramInfoLog(program))
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
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  let width = 0
  let height = 0

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
      // 位移在 CPU 侧算（纯函数，卡面与导出同一份），每帧上传一次顶点——625 个顶点，
      // 每帧两万字节，远不到需要 GPU 参与变形的量。
      const vertices = BASE_GRID as GridVertex[]
      poseGridAt(vertices, model, t)
      for (let index = 0; index < vertices.length; index += 1) {
        FRAME_POSITIONS[index * 2] = vertices[index]!.u
        FRAME_POSITIONS[index * 2 + 1] = vertices[index]!.v
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, FRAME_POSITIONS, gl.DYNAMIC_DRAW)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer)
      gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)

      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)

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
      gl.drawElements(gl.TRIANGLES, GRID_INDEX.length, gl.UNSIGNED_SHORT, 0)
    },
    dispose(): void {
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
