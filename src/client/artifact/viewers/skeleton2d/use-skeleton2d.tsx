/**
 * dsh-canvas — skeleton2d 卡的「读模型 + 动起来」两件事（F2.7 的第四种「产物自己就是画面」）。
 *
 * 与媒体三态（`card-media.ts` / `media-face.ts`）同一个构图，但分岔点不同：skeleton2d 的
 * 产物是 **JSON 文本**，卡面画的是「贴图 + 变形网格」，所以——
 *
 * - 模型不走字节通道：`readArtifact` 读回来的 `text` 就是产物本体，归一交给
 *   `core/skeleton2d/model.ts`（唯一真源）；
 * - 贴图不走 data URL：它本来就是项目里的一份图片文件，走工作区路由
 *   （`markdownImageSrc` 的相对引用规则，卡面与全屏预览同一条路）；
 * - 动画只有一套循环：卡面的小画布与全屏的大画布都跑 {@link Skeleton2dAnimation}，
 *   「卡上能看、点进去看不到」这类不一致因此没有栖身之地。
 */

import { useEffect, useRef, useState } from 'react'
import type { ArtifactView } from '../../../../types.ts'
import { cachedFetch } from '../../../canvas/asset/asset-cache.ts'
import { markdownImageSrc } from '../markdown-image.ts'
import { normalizeSkeleton2dModel, type Skeleton2dModel } from '../../../../core/skeleton2d/model.ts'
import { createSkeleton2dStage } from './skeleton2d-stage.ts'

/**
 * 读模型只需要的那一条缝（与 `seed-blank.ts` 同一条手法）：卡面拿的是整座 `CanvasBridge`，
 * 全屏预览拿的是弹窗的 `ArtifactModalBridge`——两个都长着这一个成员，窄接口让两边都能
 * 递进来，而不必谁迁就谁的完整形状。
 */
export interface Skeleton2dReader {
  readArtifact(projectId: string, cardId: string): Promise<ArtifactView>
}

/** 读一份模型的结果——四态与媒体卡同构，坏 JSON 单独一态（它是一句能修的话）。 */
export type Skeleton2dLoad =
  | { status: 'ready'; model: Skeleton2dModel }
  | { status: 'absent' }
  | { status: 'empty' }
  | { status: 'bad' }

const LOAD_MAX = 6

const models = new Map<string, Promise<Skeleton2dLoad>>()

/** 读一次模型；读失败归到 `bad`（退回占位，跟媒体读失败归 `empty` 同一条纪律）。 */
function loadModel(reader: Skeleton2dReader, projectId: string, cardId: string, bytes: number): Promise<Skeleton2dLoad> {
  return cachedFetch(models, `${projectId}/${cardId}@${bytes}`, LOAD_MAX, () =>
    reader
      .readArtifact(projectId, cardId)
      .then((view) => {
        if (!view.present) return { status: 'absent' } as Skeleton2dLoad
        if (view.text === '') return view.truncated ? ({ status: 'absent' } as Skeleton2dLoad) : ({ status: 'empty' } as Skeleton2dLoad)
        try {
          const model = normalizeSkeleton2dModel(JSON.parse(view.text) as Record<string, unknown>)
          return model === undefined ? ({ status: 'bad' } as Skeleton2dLoad) : ({ status: 'ready', model } as Skeleton2dLoad)
        } catch {
          return { status: 'bad' } as Skeleton2dLoad
        }
      })
      .catch((): Skeleton2dLoad => ({ status: 'empty' })),
  )
}

/** 模型读取 hook；`enabled` 为假、或产物还没写盘（bytes 0）时不发请求。 */
export function useSkeleton2dModel(
  reader: Skeleton2dReader,
  projectId: string,
  cardId: string,
  bytes: number,
  enabled: boolean,
): Skeleton2dLoad | undefined {
  const [load, setLoad] = useState<Skeleton2dLoad | undefined>(undefined)
  useEffect(() => {
    if (!enabled || bytes <= 0) return
    let cancelled = false
    void loadModel(reader, projectId, cardId, bytes).then((next) => {
      if (!cancelled) setLoad(next)
    })
    return () => {
      cancelled = true
    }
  }, [reader, cardId, enabled, bytes, projectId])
  return load
}

/**
 * 一次写入落地后把这张卡的模型缓存作废。
 *
 * 缓存键是 `bytes`——**字节长度相同的两次改动是不同的内容**（相位 0.25 → 0.75 一个字
 * 都不多），只按长度判新旧会把旧模型永远发给读的人。编辑器写完必须叫这一下：下一次
 * 读取（不管 bytes 变没变）都真读盘。
 */
export function invalidateSkeleton2dModel(projectId: string, cardId: string): void {
  const prefix = `${projectId}/${cardId}@`
  for (const key of [...models.keys()]) {
    if (key.startsWith(prefix)) models.delete(key)
  }
}

/** 贴图引用 → 能加载的 URL（工作区路由；拒绝穿越与外来协议，与插图同一道闸）。 */
export function skeleton2dTextureUrl(projectId: string, artifactFile: string, texture: string): string | undefined {
  return markdownImageSrc(projectId, artifactFile, texture)
}

/**
 * 一块会动的 skeleton2d 画布。
 *
 * 循环从挂载那一刻起算（t 随墙钟走，循环长度是模型自己的 `loop`）；贴图没加载完、
 * WebGL 不可用时退回一张静态贴图——「少一段动画」永远好过「一块黑布」。
 *
 * `onAspect`：贴图加载完量一次真实比例（宽 ÷ 高）报给调用方——卡面那侧拿它写回宿主
 * （F3.11 的六处消费者），全屏那侧不传就是了。
 *
 * `clockRef`：可选。动画循环每帧把当前 t（秒）写进去——时间线的播放头靠它和画面
 * 同步，走 ref 是因为每帧一次 setState 等于每帧一次重渲染，谁也受不了。
 *
 * `timeRef`：可选。给了非 `undefined` 的值就用它当 t（定格在那一帧，编辑器拖播放头 /
 * 进入网格模式时冻结画面用）；`undefined` 就回到墙钟循环。
 */
export function Skeleton2dAnimation(props: {
  model: Skeleton2dModel
  textureUrl: string
  className?: string
  onAspect?: (aspect: number) => void
  clockRef?: { current: number }
  timeRef?: { current: number | undefined }
}): React.JSX.Element {
  const { model, textureUrl, className, onAspect, clockRef, timeRef } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [image, setImage] = useState<HTMLImageElement | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  // 贴图加载与量比例。失败是「这张贴图不在了」（上游被删、引用写错），退回静态占位。
  useEffect(() => {
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      setImage(image)
      setFailed(false)
      const aspect = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : undefined
      if (aspect !== undefined) onAspect?.(aspect)
    }
    image.onerror = () => {
      if (!cancelled) setFailed(true)
    }
    image.src = textureUrl
    return () => {
      cancelled = true
      setImage(undefined)
    }
    // onAspect 不进依赖：它是调用方的回调，每次渲染都可能是新的引用，而它只该在贴图
    // 加载完的那一刻被叫一次。
  }, [textureUrl])

  // 舞台 + 动画循环。舞台只随**贴图**重建；模型经 ref 每帧现读——编辑器拖一根滑条
  // 就是换一次模型对象，要是它也进依赖表，拖一下就拆一次 WebGL 舞台（上下文重建
  // 在拖动中看得见抖动）。参数改了、画面下一帧就变，这正是编辑器要的实时性。
  const modelRef = useRef(model)
  modelRef.current = model
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || image === undefined) return
    const stage = createSkeleton2dStage(canvas)
    if (stage === undefined) {
      setFailed(true)
      return
    }
    const started = performance.now()
    let raf = 0
    const tick = (): void => {
      const held = timeRef?.current
      const t = held === undefined ? (performance.now() - started) / 1000 : held
      if (clockRef !== undefined) clockRef.current = t
      stage.resize(canvas.clientWidth, canvas.clientHeight)
      stage.draw(modelRef.current, image, t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      stage.dispose()
    }
    // clockRef 是调用方自己造的 ref，引用稳定；onAspect/clockRef 都不进依赖表。
  }, [image])

  if (failed) {
    // 静态退路：一张会动的卡不该因为 WebGL 缺席变成一句报错——贴图还在，画它。
    return <img className={className} src={textureUrl} alt="" draggable={false} />
  }
  return <canvas ref={canvasRef} className={className} />
}
