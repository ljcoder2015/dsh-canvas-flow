/**
 * dsh-canvas — skeleton2d 卡的卡面：动起来的贴图（F2.7 第四种「产物自己就是画面」）。
 *
 * 与媒体三态（`media-face.ts`）分家的理由在那里说过了：产物是 JSON + 贴图两份东西，
 * 不是一段字节。卡面画的是 {@link Skeleton2dAnimation}（与全屏预览同一套循环）——「卡上
 * 会动、点进去不会」这类不一致因此没有栖身之地。
 *
 * 指针不挂控件：这块画布上没有任何按钮，所以指针照旧让给卡片（点＝选中、拖＝拖卡、
 * 双击＝开全屏），与图片卡同一条规矩。
 */

import { useRef } from 'react'
import type { BoardCard } from '../../../types.ts'
import type { CanvasBridge } from '../../wire/bridge.ts'
import type { Translate } from '../../ui/locales.ts'
import { Skeleton2dAnimation, skeleton2dTextureUrl, useSkeleton2dModel } from '../../artifact/viewers/skeleton2d/use-skeleton2d.tsx'

/** 宽高比差多少才值得写一次（与 `card-media.ts` 的 ASPECT_EPSILON 同一个数——它是
 * 「肉眼看不见的最小差」，抄成两份就是两个阈值，早晚不等）。 */
const ASPECT_EPSILON = 0.005

/** 一张 skeleton2d 卡的卡面。 */
export function Skeleton2dCardFace(props: {
  bridge: CanvasBridge
  card: BoardCard
  /** 画布所在项目（贴图走工作区路由要它）。 */
  projectId: string
  /** 产物摘要的字节数：0 ＝ 还没写盘，不发请求。 */
  bytes: number
  /** 摘要读到了才取模型（与媒体卡同一条闸）。 */
  enabled: boolean
  t: Translate
}): React.JSX.Element {
  const { bridge, card, projectId, bytes, enabled, t } = props
  const load = useSkeleton2dModel(bridge, projectId, card.id, bytes, enabled)

  // 比例只报一次：贴图换了（重新生成）才会再量。真正的写入守卫（与记录不同的才写）
  // 在回调里判，与 `useAspectReport` 同一条纪律。
  const reported = useRef('')
  if (load !== undefined && load.status === 'ready') {
    const textureUrl = skeleton2dTextureUrl(projectId, card.file, load.model.texture)
    if (textureUrl !== undefined) {
      return (
        <Skeleton2dAnimation
          model={load.model}
          textureUrl={textureUrl}
          className="dsh-canvas-card-media"
          onAspect={(aspect) => {
            const stamp = `${card.id}@${textureUrl}`
            if (reported.current === stamp) return
            reported.current = stamp
            if (card.aspect !== undefined && Math.abs(aspect - card.aspect) <= ASPECT_EPSILON) return
            void bridge.setAspect(projectId, card.id, aspect).catch(() => undefined)
          }}
        />
      )
    }
  }
  // v3 外壳（Rigby2D 改道）：轻模型的参数化渲染吃不了 rigby 数据，卡面退**静态贴图**
  // （比例照报——贴图没变，卡片的宽高比语义不变）。轻量播放器是下一步（RI4）。
  if (load !== undefined && load.status === 'ready-shell') {
    const textureUrl = skeleton2dTextureUrl(projectId, card.file, load.shell.texture)
    if (textureUrl !== undefined) {
      return (
        <img
          className="dsh-canvas-card-media"
          src={textureUrl}
          alt=""
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget
            if (image.naturalWidth === 0 || image.naturalHeight === 0) return
            const aspect = image.naturalWidth / image.naturalHeight
            const stamp = `${card.id}@${textureUrl}`
            if (reported.current === stamp) return
            reported.current = stamp
            if (card.aspect !== undefined && Math.abs(aspect - card.aspect) <= ASPECT_EPSILON) return
            void bridge.setAspect(projectId, card.id, aspect).catch(() => undefined)
          }}
        />
      )
    }
  }
  // 还没有产物、读不懂、贴图不在：卡面说一句人话——与媒体卡的 absent/too-large 用
  // 同一批键。empty（0 字节）退给大纲行这件事在这里做不了（这个组件只占一个分支），
  // 统一说「产物不存在」是它的诚实下限。
  return <div className="dsh-canvas-card-note">{t('canvas.viewer.absent')}</div>
}
