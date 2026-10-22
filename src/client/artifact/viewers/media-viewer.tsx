/**
 * dsh-canvas — 图片、视频与音频预览器。
 *
 * 三者共用同一块媒体面板，差别只有那一个元素：二进制内容不走文本通道，host 把它
 * 读成 data URL 随 payload 一起送来（`ArtifactView.dataUrl`），所以这里只负责铺开。
 * 它们各自是一个文件里的三个导出，而不是三个文件——分开也不会有第二个读者。
 *
 * 音频与另外两个有一处**形态上的**不同，值得写在这里而不是留给读者去猜：一段音频没有
 * 「画面」，铺满那块面板只会得到一片空白，所以它给的是 `width: 100%` 的播放条加一行
 * 文件名——用户看的是「这是哪一段、多长、放到哪儿了」，不是一张图。
 */
import type { ViewerProps, ViewerRegistration } from './types.ts'

/** The image viewer: the artifact, letterboxed on a plain surface. */
export function ImageViewer({ view }: ViewerProps) {
  return (
    <div className="dsh-canvas-media">
      <img src={view.dataUrl} alt={view.file} />
    </div>
  )
}

/** The video viewer: native controls, keep it that way. */
export function VideoViewer({ view }: ViewerProps) {
  return (
    <div className="dsh-canvas-media">
      <video src={view.dataUrl} controls />
    </div>
  )
}

/**
 * The audio viewer: native controls, and the file's own name under them.
 *
 * The name is not decoration — an audio panel is otherwise a bare transport bar
 * with nothing on it saying which take this is, which is exactly the question a
 * board full of audio nodes raises.
 */
export function AudioViewer({ view }: ViewerProps) {
  return (
    <div className="dsh-canvas-media dsh-canvas-media-audio">
      <audio src={view.dataUrl} controls />
      <div className="dsh-canvas-media-label">{view.file}</div>
    </div>
  )
}

/**
 * 三条注册项：图片、视频、音频各认领一个 kind，都不声明 `editable` / `pickable` ——
 * 它们的 payload 是二进制，没有「文件自己的文本」可写，也没有页面帧可选。
 */
export const imageViewer: ViewerRegistration = {
  id: 'image',
  component: ImageViewer,
  claims: (kind) => kind === 'image',
}

export const videoViewer: ViewerRegistration = {
  id: 'video',
  component: VideoViewer,
  claims: (kind) => kind === 'video',
}

export const audioViewer: ViewerRegistration = {
  id: 'audio',
  component: AudioViewer,
  claims: (kind) => kind === 'audio',
}
