/**
 * dsh-canvas — 图片字节的 base64 编解码（零依赖）。
 *
 * 两侧共用：`document.ts` 把 `graph.images` 写进 `.design` 信封（v1.96 图片图层），设计
 * 预览把生成图的字节解回 `File` 落图层。单独成文件而不是住在 document.ts 里，是因为
 * document.ts 按 value import 场景图——client.js 不许碰场景图（类身份唯一，见
 * `design-engine.ts` 头注），而预览这一侧只要这几行。
 *
 * **不用 Buffer**：core 半在浏览器里跑，那边的等价物是 `btoa`/`atob`——Node ≥16 也有
 * 同名全局，单测照样跑。编码按 0x8000 分块拼二进制串，一次
 * `String.fromCharCode(...bytes)` 在几 MB 上会撞调用栈上限。
 */

/** 图片字节 → base64。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk))
  }
  return btoa(binary)
}

/** base64 → 图片字节；`btoa` 的逆。解不开让异常往上走（调用方各有各的收场）。 */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at)
  return bytes
}
