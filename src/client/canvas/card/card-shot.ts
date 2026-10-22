/**
 * dsh-canvas — 卡片预览的两种「截图」素材。
 *
 * 画布卡片是 200×140 的静物，而设计与应用两类产物都活在「渲染之后」：设计是场景图，
 * 应用是跑起来的页面。卡片手里没有 CanvasKit 也没有浏览器，这里用两条最省的路径各拿一张：
 *
 * - **设计卡**：`.design` 信封在客户端解码（`decodeDesignFile`，core 里的纯函数），
 *   经 `paintDocument` 的 2D 后端画进一张离屏 canvas，`toDataURL` 成 PNG。这不是
 *   CanvasKit 的保真画质，但与全屏预览的降级路径同源——引擎换了，画面不换。
 * - **应用卡**：入口页的 HTML（host 已内联本地样式与脚本）装进卡片上的迷你 iframe
 *   跑起来。它不是死的截图而是活的缩比页面：脚手架的 web components 在 shadow root
 *   里渲染，任何「序列化 DOM 再转图片」的方案都会把它们拍成空壳，真帧不会。帧不接
 *   指针、不进 Tab 序；座法与入口解析见 `webAppHtml`。
 *
 * 两类素材都按 `bytes` 缓存，取用方式（单飞 + 有界）见 `./asset-cache.ts`。
 */
import { useEffect, useState } from 'react'
import type { CanvasBridge } from '../../wire/bridge.ts'
import { decodeDesignFile, firstPageId } from '../../../core/artifact/design/document.ts'
import { canvas2dBackend, documentBounds, paintDocument } from '../../artifact/viewers/design/design-render.ts'
import { cachedFetch } from '../asset/asset-cache.ts'

/** 设计截图的离屏画布尺寸：预览区约 200×114，按 2x 画，缩放板上看不糊。 */
const SHOT_WIDTH = 400
const SHOT_HEIGHT = 240

/** 两类缓存的容量上限（取用方式见 `./asset-cache.ts`）。 */
const SHOT_CACHE_MAX = 32
const FRAME_CACHE_MAX = 6

const shots = new Map<string, Promise<string | undefined>>()
const frames = new Map<string, Promise<string | undefined>>()

/** 设计卡的离屏截图（PNG data URL）；产物缺失、解码失败都归一成 `undefined`，卡片退回文字预览。 */
function designShot(bridge: CanvasBridge, projectId: string, cardId: string, bytes: number): Promise<string | undefined> {
  return cachedFetch(shots, `${projectId}/${cardId}@${bytes}`, SHOT_CACHE_MAX, () =>
    bridge
      .readArtifact(projectId, cardId)
      .then((view) => {
        if (!view.present || view.text === '') return undefined
        const graph = decodeDesignFile(view.text)
        const canvas = document.createElement('canvas')
        canvas.width = SHOT_WIDTH
        canvas.height = SHOT_HEIGHT
        const context = canvas.getContext('2d')
        if (context === null) return undefined
        // 卡片缩略图画的是**第一页**（`firstPageId`：离屏这侧没有「当前页」，与 fig 写器的
        // 缩略图同一口径）；一页都没有的图（坏文档）就不给缩略图。
        const pageId = firstPageId(graph)
        if (pageId === undefined) return undefined
        // 缩放封顶在 1：小文档放大到糊不如留白，与全屏预览的 zoom-to-fit 同一约定。
        const bounds = documentBounds(graph, pageId)
        const scale = Math.min(SHOT_WIDTH / bounds.width, SHOT_HEIGHT / bounds.height, 1)
        paintDocument(
          graph,
          canvas2dBackend(context),
          {
            x: (SHOT_WIDTH - bounds.width * scale) / 2,
            y: (SHOT_HEIGHT - bounds.height * scale) / 2,
            scale,
          },
          pageId,
        )
        return canvas.toDataURL('image/png')
      })
      .catch(() => undefined),
  )
}

/**
 * 应用入口页的内联 HTML（host 已注入链接闸与选择探针，探针默认是死的）；失败归一成 `undefined`。
 *
 * 应用卡有两种座法：坐在 `<folder>/index.html` 入口文件上（scaffold 盖的章），
 * 或坐在文件夹本身上。后者 `readArtifact` 读目录必然失败，所以按候选依次试——
 * 卡片 id 本身先试，不是入口文件就再试 `<id>/index.html`；哪种座法都收敛到
 * 同一个入口页（host 对入口文件的相对引用，恰好按所属文件夹内联）。
 */
function webAppHtml(bridge: CanvasBridge, projectId: string, cardId: string, bytes: number): Promise<string | undefined> {
  return cachedFetch(frames, `${projectId}/${cardId}@${bytes}`, FRAME_CACHE_MAX, async () => {
    const candidates = /\/index\.html?$/.test(cardId)
      ? [cardId]
      : [cardId, `${cardId.replace(/\/+$/, '')}/index.html`]
    for (const id of candidates) {
      try {
        const view = await bridge.readArtifact(projectId, id)
        if (view.present && view.text !== '') return view.text
      } catch {
        // 目录座法的第一候选会在这里失败——换下一个候选，不声张。
      }
    }
    return undefined
  })
}

/** 设计卡截图的读取 hook；`enabled` 为假时不发起任何请求。 */
export function useDesignShot(
  bridge: CanvasBridge,
  projectId: string,
  cardId: string,
  bytes: number,
  enabled: boolean,
): string | undefined {
  const [shot, setShot] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!enabled || bytes <= 0) return
    let cancelled = false
    void designShot(bridge, projectId, cardId, bytes).then((url) => {
      if (!cancelled) setShot(url)
    })
    return () => {
      cancelled = true
    }
  }, [bridge, cardId, enabled, bytes, projectId])
  return shot
}

/** 应用卡内联 HTML 的读取 hook。目录座法的 `bytes` 是 0（probe 不数目录），这里不拿它当闸。 */
export function useWebAppHtml(
  bridge: CanvasBridge,
  projectId: string,
  cardId: string,
  bytes: number,
  enabled: boolean,
): string | undefined {
  const [html, setHtml] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void webAppHtml(bridge, projectId, cardId, bytes).then((text) => {
      if (!cancelled) setHtml(text)
    })
    return () => {
      cancelled = true
    }
  }, [bridge, cardId, enabled, bytes, projectId])
  return html
}
