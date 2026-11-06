/**
 * dsh-canvas — 让预览器“认识”这台电脑上装的字体（F2.6，v1.89）。
 *
 * 一条通路：`@open-pencil/core` 的 `fontManager` 在找不到字面时会问一个**宿主字体加载器**
 * （`setHostFontLoader`，上游给桌面版留的口子）；我们把它接到插件自己的路由上，于是
 * 文档里写「PingFang SC」「Helvetica Neue」「微软雅黑」的那几段文字，用的是**这台机器真的
 * 装了的**那张脸，而不是退回 Inter 之后中文整段空白。
 *
 * 为什么这个文件不 import `fontManager`：它要能在 node 里被单独判据跑。装法由调用方给
 * （`installHostFonts((loader) => fontManager.setHostFontLoader(loader))`），这里只负责
 * 「问一句、拿字节、答 null」——判别逻辑与引擎装配分开，判据才不用把 CanvasKit 拖进 node。
 *
 * 失败的处理分两种，这是**有意的**：
 * - **404 记下来**：这台机器上没有这一族，问一次就够了，别每次重排都再问一遍。
 * - **网络错/5xx 不记**：宿主可能刚好在重启、路由还没挂上——把它记成「没有」就等于这一页
 *   再也用不上本地字体了（资产加载器踩过同一个坑：失败被钉死在缓存里）。
 */
import { fontFileUrl } from '../../../../core/font/route.ts'

/** 核心那个口子的形状（`HostFontLoader`，见 `@open-pencil/core` 的 `text/font/sources`）。 */
export type HostFontLoader = (family: string, style: string) => Promise<ArrayBuffer | null>

/** 一条可以交给 `fontManager.setHostFontLoader` 的加载器。 */
export function createHostFontLoader(
  fetchImpl: typeof fetch = fetch,
  log: (message: string) => void = (message) => console.info(message),
): HostFontLoader {
  /** 这台机器上**确定没有**的族（404）。网络类失败不进这里。 */
  const missing = new Set<string>()
  /** 同一族同一字重的并发请求并成一趟（解析器会把同一张脸问两三次）。 */
  const inflight = new Map<string, Promise<ArrayBuffer | null>>()

  return async (family, style) => {
    const key = `${family}\u0000${style}`
    if (missing.has(key)) return null
    const running = inflight.get(key)
    if (running !== undefined) return running
    const attempt = (async (): Promise<ArrayBuffer | null> => {
      try {
        const response = await fetchImpl(fontFileUrl(family, style))
        if (response.status === 404) {
          missing.add(key)
          return null
        }
        if (!response.ok) return null
        const data = await response.arrayBuffer()
        if (data.byteLength < 12) return null
        log(`[dsh-canvas] 本地字体：${family} ${style}（${(data.byteLength / 1048576).toFixed(1)}MB）`)
        return data
      } catch {
        return null
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, attempt)
    return attempt
  }
}

/**
 * 把宿主字体加载器装上。**幂等**：`fontManager` 是页面级的单例，装两遍只是写同一个值。
 *
 * 装法由调用方给（`setLoader`），本模块因此不依赖引擎：预览（`design-skia.ts`）与导出
 * （`createExportRenderer`）各自装一次，同一条通路——导出里的文字也必须是本地那支字体，
 * 否则「预览对、导出里的字换了」这种失败连报错都没有。
 */
export function installHostFonts(setLoader: (loader: HostFontLoader) => void): void {
  setLoader(createHostFontLoader())
}
