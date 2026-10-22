/**
 * dsh-canvas — 设计预览的 Skia 后端（F2.6，P3 保真路径）。
 *
 * 渲染引擎是 `@open-pencil/core` 的 `SkiaRenderer`（CanvasKit on WebGL2，
 * CPU raster 兜底）——OpenPencil 换底座后，命中/文本/图形保真都长在它身上，
 * 预览直接复用，不再自维护一套 painter。2D canvas 后端（`design-render.ts`）
 * 仍是降级路径：本模块任何一步失败都返回 `null`，viewer 原地用 2D 画。
 *
 * 字体：core 的 bundled 字体走根路径 `/Inter-Regular.ttf`，宿主路由下必然
 * 404；这里改从插件资产路由预载并通过 `fontManager.markLoaded` 注入。
 * 在线回落这条后路在宿主里是不通的（浏览器侧 WebFontResolver 无 remoteFetch），
 * 所以中文只能靠仓库 vendored 的 Noto Sans SC 兜住——它 17.7MB，按「首帧必需
 * 的字面」与「后台到货的回落字面」两档分开加载，见 preloadCoreFonts/preloadCJKFont。
 *
 * 本文件与加载器（`design-canvaskit.ts`）一样「optional by construction」：
 * 不 throw，失败即降级。
 */
import { SkiaRenderer } from '@open-pencil/core/canvas'
import { fontManager } from '@open-pencil/core/text'
import type { CanvasKit, Surface } from 'canvaskit-wasm'
import type { SceneGraph } from '@open-pencil/scene-graph'
import { CJK_TEXT_FAMILY } from '../../../../core/artifact/design/export-font.ts'
import { LATIN_TEXT_FAMILY } from '../../../../core/artifact/design/node-props.ts'
import { assetUrl, loadCanvasKit } from './design-canvaskit.ts'
import { type CanvasKitRuntime, type DesignBackend } from './design-engine-types.ts'

/** The page backdrop behind the containers — matches `.dsh-canvas-design` CSS. */
const CANVAS_COLOR = { r: 233 / 255, g: 235 / 255, b: 239 / 255, a: 1 }

/**
 * 默认字面四档——排版的地基，首帧之前必须就位（合计约 1.3MB）。
 *
 * 族名从 `node-props.ts` 读：属性面板的「字体」下拉里列的就是**这里注册的**那几支字面，
 * 两处各写一份字符串迟早会漂移，而漂移的后果是「下拉里选得中、画布上画不出」（静默空白）。
 */
const CORE_FONTS = [
  [LATIN_TEXT_FAMILY, 'Regular', 'Inter-Regular.ttf'],
  [LATIN_TEXT_FAMILY, 'Medium', 'Inter-Medium.ttf'],
  [LATIN_TEXT_FAMILY, 'SemiBold', 'Inter-SemiBold.ttf'],
  [LATIN_TEXT_FAMILY, 'Bold', 'Inter-Bold.ttf'],
] as const

/**
 * 中文字面（17.7MB）：只做回落，绝不参与首帧门禁——晚到再补画。
 *
 * **名字从 core 读**（`export-font.ts` 的 `CJK_TEXT_FAMILY`）而不是在这里写一遍：fig 与 PDF
 * 两条导出路是按这个名字去 `fontManager` 取字面/字形轮廓的，两处各写一份字符串就会漂移，
 * 而漂移的后果是「导出里的中文不见了」这种什么都不报的失败。注册名与消费名必须是同一个。
 */
const CJK_FONT_FILE = 'NotoSansSC-Regular.ttf'

let coreFontsPreloaded: Promise<void> | undefined
let cjkFontPreloaded: Promise<ArrayBuffer | null> | undefined

/**
 * Inject the bundled faces from the plugin's asset route into core's font
 * manager, once per page. Best effort: a 404 (assets not shipped) just leaves
 * the resolver's remote path as the second chance — but shout about it, since
 * a missing default face paints text as blank with no other symptom.
 */
async function loadFontFile(family: string, style: string, file: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(assetUrl(file))
    if (!response.ok) {
      console.warn(`[dsh-canvas] 字体资产缺失：${file}（HTTP ${response.status}），文字可能不显示。`)
      return null
    }
    const data = await response.arrayBuffer()
    fontManager.markLoaded(family, style, data)
    return data
  } catch (error) {
    // Offline or route missing — the font resolver's remote path is next.
    console.warn(`[dsh-canvas] 字体加载失败：${file}`, error)
    return null
  }
}

/** 默认字面（Inter）：首帧的硬依赖，等它只是等 1.3MB。 */
function preloadCoreFonts(): Promise<void> {
  coreFontsPreloaded ??= Promise.all(
    CORE_FONTS.map(([family, style, file]) => loadFontFile(family, style, file)),
  ).then(() => undefined)
  return coreFontsPreloaded
}

/**
 * 中文字面：core 的 bundled 字体没有中文字形，它自己的 CJK 回落走 Google
 * Fonts——宿主环境不可达，中文会渲染成空白。这里取仓库 vendored 的
 * Noto Sans SC（build.mjs 拷进资产路由），把数据交回去由调用方在
 * provider 就绪之后注入。
 *
 * 为什么单列而不并进 Inter 那一批：它 17.7MB，是这批资源里唯一的大件。
 * 早先它和 Inter 一起被 `await` 在引擎创建的最前面，首帧（连图形带文字）
 * 都被它按住——网络一慢，卡片就是长时间空白。现在它退成回落字面，首帧
 * 不等它，到货后补画一次即可。
 */
function preloadCJKFont(): Promise<ArrayBuffer | null> {
  cjkFontPreloaded ??= loadFontFile(CJK_TEXT_FAMILY, 'Regular', CJK_FONT_FILE)
  return cjkFontPreloaded
}

/**
 * 中文字面的**字节**——这一趟没有人在画图也拿得到。
 *
 * PDF 那条导出路要的不是「画得出来」，而是那支字体本身（要嵌进文档里），而这件事与
 * CanvasKit 无关：这台机器上取不到 CanvasKit 时 PDF 照样该导得出来，只要字面到货。所以这个
 * 口子单开在预载函数旁边、不经过任何渲染器。同页取过一次之后就是内存里那一份
 * （`markLoaded` 之后 `loadedData` 直接命中），17.7MB 只走一次网络。
 *
 * 返回 `null` 是**答案**：资产路由没装上或离线——调用方那边有「取不到中文字面」这句话。
 */
export async function ensureCJKFont(): Promise<ArrayBuffer | null> {
  return fontManager.loadedData(CJK_TEXT_FAMILY, 'Regular') ?? (await preloadCJKFont())
}

/**
 * 中文回落就位：先注册进**当前** provider，再声明进排版回落链。顺序不能反——
 * `setCJKFallbackFamily` 只是让段落把 'Noto Sans SC' 写进 fontFamilies，
 * 真正出字形的是 provider 里那一枚 typeface；先声明后注册的话，中间那段
 * 时间排版拿不到字形，缺字判定会把文字判成 exhausted 而整段不画。
 *
 * 返回「字面这一趟有没有真变」——重画与否由调用方决定（预览要补一帧，导出不用）。
 * 预览与导出共用这一步，正是「一份」的意思：中文在设计稿里画得出来，导出也不会变空白。
 */
function declareCJKFallback(data: ArrayBuffer): boolean {
  const before = fontManager.generation()
  fontManager.markLoaded(CJK_TEXT_FAMILY, 'Regular', data)
  fontManager.setCJKFallbackFamily(CJK_TEXT_FAMILY)
  return fontManager.generation() !== before
}

/**
 * Build the Skia backend for one canvas element. Resolves `null` when the
 * engine cannot take the element (no WebGL2 *and* no CPU surface) — the
 * viewer keeps its 2D picture in that case.
 *
 * `onRepaint` fires when async font work settles (fallback fonts arriving),
 * so late-arriving glyphs trigger one extra frame instead of staying blank.
 */
export async function createSkiaBackend(
  canvas: HTMLCanvasElement,
  runtime: CanvasKitRuntime,
  graph: SceneGraph,
  onRepaint: () => void,
): Promise<DesignBackend | null> {
  await preloadCoreFonts()
  const ck = runtime as unknown as CanvasKit
  const webgl = runtime.MakeWebGLCanvasSurface?.(canvas) ?? null
  const surface = (webgl ?? runtime.MakeCanvasSurface?.(canvas) ?? null) as unknown as Surface | null
  if (surface === null) return null
  const gl = webgl !== null ? (canvas.getContext('webgl2') as WebGL2RenderingContext | null) : null

  const renderer = new SkiaRenderer(ck, surface, gl)
  renderer.showRulers = false
  renderer.pageColor = CANVAS_COLOR
  renderer.pageId = graph.getPages()[0]?.id ?? ''
  let disposed = false

  /**
   * 字面到货/回落到位后的一次收口：作废已录画面（core 的 settleFontDemand
   * 只作废单节点画面，场景画面靠 fontGeneration 变化才重录——字面只被声明、
   * 没真注册时 generation 不动，缺字的画面就会一直复用到重建引擎，这正是
   * 「关掉卡片重开才有文字」），再补一帧。
   */
  const repaintAfterFontChange = (): void => {
    if (disposed || renderer.isDestroyed()) return
    renderer.invalidateAllPictures()
    onRepaint()
  }

  /**
   * 中文回落就位：先注册进**当前** provider，再声明进排版回落链。顺序不能反——
   * `setCJKFallbackFamily` 只是让段落把 'Noto Sans SC' 写进 fontFamilies，
   * 真正出字形的是 provider 里那一枚 typeface；先声明后注册的话，中间那段
   * 时间排版拿不到字形，缺字判定会把文字判成 exhausted 而整段不画。
   */
  const registerCJKFallback = (data: ArrayBuffer): void => {
    if (disposed || renderer.isDestroyed()) return
    if (declareCJKFallback(data)) repaintAfterFontChange()
  }

  try {
    await renderer.loadFonts(repaintAfterFontChange)
  } catch {
    // Fonts failed: shapes still draw; text falls to the resolver's remote path.
  }
  if (disposed) {
    renderer.destroy()
    return null
  }

  // 中文字面：同页已经握在手里就直接补齐（这张卡的首帧就有中文）；否则后台
  // 到货再补——首帧只欠图形与拉丁文，不被 17.7MB 按住。
  const cachedCJK = fontManager.loadedData(CJK_TEXT_FAMILY, 'Regular')
  if (cachedCJK !== null) {
    registerCJKFallback(cachedCJK)
  } else {
    void preloadCJKFont().then((data) => {
      if (data !== null) registerCJKFallback(data)
    })
  }

  let activeSurface = surface
  return {
    paint(viewport, width, height, dpr, selectedIds, sceneVersion, currentPageId, hoveredId) {
      if (disposed) return
      const deviceWidth = Math.round(width * dpr)
      const deviceHeight = Math.round(height * dpr)
      // The surface is bound to the element at creation: a resize invalidates
      // it, so rebuild the surface and hand it to the renderer.
      if (activeSurface.width() !== deviceWidth || activeSurface.height() !== deviceHeight) {
        const next = (webgl !== null
          ? runtime.MakeWebGLCanvasSurface?.(canvas)
          : runtime.MakeCanvasSurface?.(canvas)) as unknown as Surface | null
        if (next === null) return
        // `replaceSurface` deletes the outgoing surface itself — deleting it
        // here too throws "Surface instance already deleted" on the next swap.
        activeSurface = next
        renderer.replaceSurface(next)
      }
      renderer.viewportWidth = width
      renderer.viewportHeight = height
      renderer.dpr = dpr
      renderer.panX = viewport.x
      renderer.panY = viewport.y
      renderer.zoom = viewport.scale
      // 渲染器按 pageId 圈定要画的页面——面板切页后每帧同步当前页。
      renderer.pageId = currentPageId
      // 选中框与悬停高亮由渲染器原生画（overlays 每帧叠加，不进场景
      // picture）；sceneVersion 来自 editor 的变更计数——图没变时 picture
      // cache 逐帧重放，变了才重录。
      renderer.render(graph, selectedIds as Set<string>, { hoveredNodeId: hoveredId }, sceneVersion, 'full')
    },
    dispose() {
      if (disposed) return
      disposed = true
      renderer.destroy()
    },
  }
}

// ── 导出用的离屏渲染器（F10.1，v1.59） ──────────────────────────────────────

/**
 * 一台可以画到「内存里的画布」上的渲染器，专供导出。
 *
 * 为什么不复用预览那一台：导出可以不经过预览器（胶囊上的导出钮在画布上就能点，卡片
 * 没有被打开过），而且预览器迟早要销毁——导出不该握着一台别人的、随时可能没了的
 * 渲染器。所以这里新起一台：离屏 surface、没有 GL 上下文（`MakeSurface` 就是
 * open-pencil 自己 headless 那条路的做法），画完即弃。
 *
 * **它必须走浏览器这条路，不能走 headless**：open-pencil 的 `headlessRenderNodes`
 * 用 `import.meta.resolve` 去找 `canvaskit-wasm/full`——那是 node/bun 的 API，浏览器里
 * 没有它（`import.meta.resolve` 是 undefined，调用即 TypeError）。所以导出这一侧一律把
 * `{ canvasKit, renderer }` 作为 `context` 递进去，让它在需要降级栅格化时用我们这一台。
 *
 * 字体与预览共用同一套预载（`preloadCoreFonts` / `preloadCJKFont` /
 * `declareCJKFallback`）——**这是必须的**：导出里的文字要过渲染器的排版，字面没进
 * provider 就画不出字形，中文会整段空白；而「导出比预览少一个字体」这种事不会报错，
 * 只会让产物看起来像设计错了。中文那 17.7MB 在这里**要等**（预览可以不等，导出不能
 * 交一份缺字的图）。
 *
 * 取不到 CanvasKit（资产没到，或这台机器上没装）时返回 `null`——那是「这次没导成」的
 * 一种原因（见 `DesignExportRefusal` 的 `no-engine`），不是异常。
 */
export interface ExportRenderer {
  ck: CanvasKit
  renderer: SkiaRenderer
  dispose: () => void
}

export async function createExportRenderer(): Promise<ExportRenderer | null> {
  const runtime = await loadCanvasKit()
  if (runtime === null) return null
  await preloadCoreFonts()
  const cjk = fontManager.loadedData(CJK_TEXT_FAMILY, 'Regular') ?? (await preloadCJKFont())
  if (cjk !== null) declareCJKFallback(cjk)

  const ck = runtime as unknown as CanvasKit
  const surface = ck.MakeSurface(1, 1)
  if (!surface) return null
  const renderer = new SkiaRenderer(ck, surface)
  renderer.showRulers = false
  renderer.pageColor = CANVAS_COLOR
  // headless 那台是这么起手的（1×1 的视口、dpr 1）：绘制时各自另开 surface，这一台只
  // 负责「有渲染器可用」这件事。
  renderer.viewportWidth = 1
  renderer.viewportHeight = 1
  renderer.dpr = 1
  try {
    await renderer.loadFonts()
  } catch {
    // 字面没全装上：图形照画，文字回落——与预览同一条降级（不 throw）。
  }
  let disposed = false
  return {
    ck,
    renderer,
    dispose: () => {
      if (disposed) return
      disposed = true
      renderer.destroy()
    },
  }
}
