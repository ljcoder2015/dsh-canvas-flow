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
 * 除这两支自带字面之外，**这台机器装了的字体也能用**（v1.89）：core 在找不到字面时会问
 * `fontManager.setHostFontLoader` 那个口子，`design-host-fonts.ts` 把它接到宿主的
 * `/dsh-canvas/fonts` 路由上（宿主读盘、`.ttc` 拆出一张脸、只按族名查表）。稿子里写
 * 「PingFang SC」的那段文字因此画的是苹方，而不是退回 Inter 之后整段空白。
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
import { installHostFonts } from './design-host-fonts.ts'
import { createFontProgressTracker, type DesignFontProgress, type FontProgressTracker } from './design-font-progress.ts'
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
/** 中文那一趟有没有跑完（成功或失败）。进度清单要靠它区分「在途」与「已收尾」。 */
let cjkFontSettled = false

// ── 字体加载进度（v1.88） ──────────────────────────────────────────────────
//
// 进度只有**一份**，因为字体加载本身只有一份：`preloadCoreFonts` / `preloadCJKFont` 是
// 页面级单飞，四个设计卡同时开也只会取一遍。所以这里也是一枚模块级的 tracker + 一张订阅表，
// 而不是「每台引擎各带一份」——每台一份的话，第二台拿到的永远是「已缓存、无进度」。
//
// 为什么展示它：中文字面 17.7MB 是**首帧之后**才到货的（见 `preloadCJKFont` 的注释），
// 到货前含中文的文字整段空白。没有进度，用户看到的是「打开就坏了」。

const fontListeners = new Set<(progress: DesignFontProgress | null) => void>()
let fontTracker: FontProgressTracker | null = null

function publishFontProgress(progress: DesignFontProgress | null): void {
  for (const listener of fontListeners) listener(progress)
}

/**
 * 订阅字体加载进度（预览器用）。
 *
 * `null` 的意义是「现在没有字面在路上」——已缓存、或这一轮不取字体。订阅时**立刻**交一份
 * 现状：订阅者挂上来时第一块字节可能已经到过了（chunk 加载与 React 挂载不是一个节拍），
 * 只等下一次回调会让进度条晚一格才出现。
 */
export function subscribeDesignFonts(listener: (progress: DesignFontProgress | null) => void): () => void {
  fontListeners.add(listener)
  listener(fontTracker?.snapshot() ?? null)
  return () => {
    fontListeners.delete(listener)
  }
}

/**
 * 这一轮**真要发请求**的那几支。
 *
 * 已缓存的不进清单：分母里躺着永远不动的一格，进度条会先跳到 80% 再干等（中文那 17.7MB
 * 正是这么骗人的）。判断依据就是加载器自己的账——`coreFontsPreloaded` 有没有、字体管理器里
 * 有没有那一支的字节。
 */
function pendingFontFiles(): string[] {
  const files: string[] = []
  if (coreFontsPreloaded === undefined) for (const [, , file] of CORE_FONTS) files.push(file)
  // 中文：内存里没有、而且**没有一趟在跑**，才会真发请求。在途的那一趟仍要算进来
  // （第二张卡同时打开时，进度条接着上一轮的走），已跑完却没取到的则不算。
  const cjkMissing = fontManager.loadedData(CJK_TEXT_FAMILY, 'Regular') === null
  if (cjkMissing && !cjkFontSettled) files.push(CJK_FONT_FILE)
  return files
}

/**
 * 建引擎前把进度表摆好。**必须早于 `preloadCoreFonts()`**：那一跑起来，`pendingFontFiles`
 * 就再也算不出「这一轮要取什么」了。
 *
 * 三条规矩：
 * - 这一轮没有要取的（全在内存里）→ 置 `null` 并通知，界面把上一轮残留的那条进度收掉。
 * - 上一轮还在路上（`done < total`）→ **沿用**，别重建：重建会把已经读过的字节与响应头
 *   一起丢掉，进度条会退回起点再追一遍。
 * - 其余（首次，或上一轮已收尾）→ 按这一轮的清单新建。
 */
function watchFontProgress(): void {
  const pending = pendingFontFiles()
  if (pending.length === 0) {
    if (fontTracker !== null) {
      fontTracker = null
      publishFontProgress(null)
    }
    return
  }
  const current = fontTracker?.snapshot()
  if (current !== undefined && current.done < current.total) return
  fontTracker = createFontProgressTracker(pending, (progress) => publishFontProgress(progress))
  publishFontProgress(fontTracker.snapshot())
}

/**
 * 把一份字面读进内存，**顺路报字节**。
 *
 * 走流而不是 `response.arrayBuffer()`：后者要等整支到齐才返回，17.7MB 在慢网下是一段纯黑箱
 * ——这正是「字体进度」想照亮的地方。拼字节的方式是先收块、最后一次性铺进一段连续内存
 * （逐块 `concat` 是 O(n²)，17MB 下会明显卡主线程）。
 */
async function readFontBody(response: Response, file: string): Promise<ArrayBuffer> {
  const body = response.body
  if (body === null) {
    // 老宿主/被拦过的响应可能没有流；退回去等整份，进度就只报一次「到了」。
    const buffer = await response.arrayBuffer()
    fontTracker?.read(file, buffer.byteLength)
    fontTracker?.finish(file)
    return buffer
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value === undefined || value.byteLength === 0) continue
    chunks.push(value)
    total += value.byteLength
    fontTracker?.read(file, value.byteLength)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  fontTracker?.finish(file)
  return merged.buffer as ArrayBuffer
}

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
      // 失败也算「这一支结束了」：进度条不该为一条永远不来的请求停在半路。
      fontTracker?.finish(file)
      return null
    }
    // 响应头一到就有总长（宿主路由不压缩，`content-length` 就是字节数）——分母从这一刻起是
    // 真的，百分比才敢往字节上算。
    fontTracker?.measure(file, Number(response.headers.get('content-length') ?? 0))
    const data = await readFontBody(response, file)
    fontManager.markLoaded(family, style, data)
    return data
  } catch (error) {
    // Offline or route missing — the font resolver's remote path is next.
    console.warn(`[dsh-canvas] 字体加载失败：${file}`, error)
    fontTracker?.finish(file)
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
  if (cjkFontPreloaded !== undefined) return cjkFontPreloaded
  cjkFontPreloaded = loadFontFile(CJK_TEXT_FAMILY, 'Regular', CJK_FONT_FILE).finally(() => {
    // 只有「这一趟跑完了」才知道它不会再来（成功与否都记上）。进度表要的正是这一位：
    // 在途的那一趟算进本轮清单，已收尾却没落到内存里的（失败）不算——否则进度条会为一条
    // 永远不会再发的请求停在半路。
    cjkFontSettled = true
  })
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
 * 本机字体那条通路装一次（v1.89）。
 *
 * 装在**引擎创建**这一侧而不是模块加载时：`fontManager` 是页面级单例，但这条加载器只在
 * 真的要画字时才被问；早装没有任何成本，晚装会让第一帧去等一次没必要的 404。
 * 预览与导出都走这里——两边少装一次，导出的字就换了（不报错的那一类）。
 */
let hostFontsInstalled = false

function ensureHostFonts(): void {
  if (hostFontsInstalled) return
  hostFontsInstalled = true
  installHostFonts((loader) => fontManager.setHostFontLoader(loader))
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
  // 本机字体先接上：稿子里写的是作者机器上的族名，能不能画出字全看这条通路。
  ensureHostFonts()
  // 进度表要早于任何一次取字体（见 watchFontProgress）。
  watchFontProgress()
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
    paint(viewport, width, height, dpr, selectedIds, sceneVersion, currentPageId, hoveredId, preview) {
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
      // 拖画橡皮筋与钢笔预览同走 overlays（v1.99）：penState 是引擎侧的
      // 顶点账本（渲染器原生认这份形状），marquee 是 viewer 拖画中的矩形。
      renderer.render(graph, selectedIds as Set<string>, {
        hoveredNodeId: hoveredId,
        ...(preview?.marquee != null ? { marquee: { ...preview.marquee } } : {}),
        ...(preview?.pen != null ? { penState: preview.pen } : {}),
      }, sceneVersion, 'full')
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
  // 导出与预览用同一批字面（含本机字体），否则「预览对、导出的字换了」不会报错。
  ensureHostFonts()
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
