/**
 * dsh-canvas — 卡面预览的第三种素材：媒体产物自己（F2.7）。
 *
 * `card-shot.ts` 那两种是「把渲染之后的东西拍下来」（设计拍成 PNG、应用装进迷你帧），
 * 媒体这一类不用拍：产物就是一张图 / 一段视频 / 一段音频，浏览器自己会画。所以这里
 * 只做一件事——取一次字节，交给 `media-face.ts` 判断「有没有东西可画」。
 *
 * 读法与全屏预览**是同一条**（`readArtifact`）：同一份 wire 上限、同一副
 * `data:<mime>;base64,…` 形状、同一套「产物还没生成」的语义。卡面不另开一条读法，
 * 否则「卡上能看、点进去看不到」（反过来也一样）这类不一致迟早会出现。
 */
import { useEffect, useRef, useState } from 'react'
import type { CanvasBridge } from '../../wire/bridge.ts'
import { cachedFetch } from '../asset/asset-cache.ts'
import { mediaAssetOf, type MediaAsset, type MediaFace } from './media-face.ts'

/**
 * 媒体缓存的容量上限比截图那两张表小得多：一条记录**可能是一段十几兆的视频**
 * （截图是几百 KB 的 PNG，缓存 32 张也只是几兆）。这里按「同时看得见几张」定。
 */
const MEDIA_CACHE_MAX = 6

const media = new Map<string, Promise<MediaAsset>>()

/** 读一次媒体产物并把答案翻成「有没有东西可画」；读失败归到 `empty`（退回大纲行）。 */
function mediaAsset(bridge: CanvasBridge, projectId: string, cardId: string, bytes: number): Promise<MediaAsset> {
  return cachedFetch(media, `${projectId}/${cardId}@${bytes}`, MEDIA_CACHE_MAX, () =>
    bridge
      .readArtifact(projectId, cardId)
      .then((view) => mediaAssetOf(view))
      .catch((): MediaAsset => ({ status: 'empty' })),
  )
}

/** 媒体载荷的读取 hook；`enabled` 为假时不发起任何请求，`bytes` 为 0（还没写盘）时同。 */
export function useMediaAsset(
  bridge: CanvasBridge,
  projectId: string,
  cardId: string,
  bytes: number,
  enabled: boolean,
): MediaAsset | undefined {
  const [asset, setAsset] = useState<MediaAsset | undefined>(undefined)
  useEffect(() => {
    if (!enabled || bytes <= 0) return
    let cancelled = false
    void mediaAsset(bridge, projectId, cardId, bytes).then((next) => {
      if (!cancelled) setAsset(next)
    })
    return () => {
      cancelled = true
    }
  }, [bridge, cardId, enabled, bytes, projectId])
  return asset
}

/** 宽高比差多少才值得写一次。0.5% 是肉眼看不见的；比它小就是同一个比例。 */
const ASPECT_EPSILON = 0.005

/**
 * 量一份媒体载荷的真实宽高比。
 *
 * 用浏览器自己量（`naturalWidth` ／ `videoWidth`），**不解析字节**：宿主去读 PNG 的 IHDR、
 * JPEG 的 SOF、MP4 的 tkhd，等于把浏览器已经做过一遍的事再做一遍，还只认得自己实现过的
 * 那几种容器。这里拿到的是一个 `data:` URL，交给 `Image` / `video` 就行。
 *
 * 量不到（解码失败、宽或高为 0）就答 `undefined`：卡片按默认 16:9 坐，而不是按一个
 * 猜出来的比例。
 */
function measureAspect(asset: MediaAsset, face: MediaFace): Promise<number | undefined> {
  if (asset.status !== 'ready') return Promise.resolve(undefined)
  // 音频没有画面，比例对它没有意义——它的卡面是一条播放条。
  if (face.element === 'audio') return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const settle = (width: number, height: number): void => {
      resolve(width > 0 && height > 0 ? width / height : undefined)
    }
    if (face.element === 'img') {
      const image = new Image()
      image.onload = () => settle(image.naturalWidth, image.naturalHeight)
      image.onerror = () => resolve(undefined)
      image.src = asset.dataUrl
      return
    }
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => settle(video.videoWidth, video.videoHeight)
    video.onerror = () => resolve(undefined)
    video.src = asset.dataUrl
  })
}

/**
 * 产物加载完就把它的真实宽高比报回宿主（F3.11）。
 *
 * 为什么由客户端报：**解码器就在手上**。而为什么必须报回宿主、而不是只在卡面里用一次——
 * 尺寸有六处消费者（卡面、引用线锚点、命中矩形、取景、排位、控制带），排位与板面文件都在
 * 宿主那一侧；只有写进记录，六处才读得到同一个数，换台机器打开也不会跳一下。
 *
 * 只在**量到的比例与记录不同**时才写：这个 effect 每次板面刷新都会跑一遍，而绝大多数时候
 * 答案与记录一模一样。写失败就安静地放着——下一次加载会再试一次，比在卡面上挂一条错误
 * 提示有用得多（用户看的是图，不是日志）。
 *
 * @param asset - 已经读回来的媒体载荷（`undefined` = 还没读到）。
 * @param face - 这个形态画哪个元素；不是媒体就传 `undefined`。
 * @param known - 记录里已有的比例，用来决定「要不要再写一次」。
 */
export function useAspectReport(
  bridge: CanvasBridge,
  projectId: string,
  cardId: string,
  asset: MediaAsset | undefined,
  face: MediaFace | undefined,
  known: number | undefined,
): void {
  // 写入是副作用，不该因为一次重渲染再跑一遍：记住「这张卡 + 这一份载荷」报过没有。
  const reported = useRef<string>('')
  useEffect(() => {
    if (asset === undefined || face === undefined) return
    const stamp = `${cardId}@${asset.status === 'ready' ? asset.dataUrl.length : asset.status}`
    if (reported.current === stamp) return
    let cancelled = false
    void measureAspect(asset, face).then((aspect) => {
      if (cancelled || aspect === undefined) return
      reported.current = stamp
      if (known !== undefined && Math.abs(aspect - known) <= ASPECT_EPSILON) return
      void bridge.setAspect(projectId, cardId, aspect).catch(() => undefined)
    })
    return () => {
      cancelled = true
    }
  }, [asset, bridge, cardId, face, known, projectId])
}
