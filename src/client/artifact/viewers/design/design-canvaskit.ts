/**
 * dsh-canvas — CanvasKit loader (design node, §渲染层).
 *
 * CanvasKit is Skia compiled to WASM — the engine Figma's web renderer uses.
 * The plugin ships its files in `lib/assets/` (copied at build time when the
 * `canvaskit-wasm` package is present) and serves them through the host's
 * own `/dsh-canvas/assets` route, because the harness's `/plugins` route only
 * serves composed bundles.
 *
 * The load is *optional by construction*: the design viewer works without it
 * (a plain 2D-canvas backend draws the same shape set), so every failure here
 * — no webServer, files not shipped, script error, init timeout — resolves to
 * `null` and the viewer degrades. Nothing in this file may throw.
 */

/** The UMD global the shipped `canvaskit.js` defines. */
interface CanvasKitInitGlobal {
  (options: { locateFile?: (file: string) => string }): Promise<CanvasKitRuntime>
}
export type { CanvasKitRuntime, SurfaceLike } from './design-engine-types.ts'

import { type CanvasKitRuntime } from './design-engine-types.ts'

/** The route the host's asset module serves (`src/host/assets.ts`). */
export const ASSET_BASE = '/dsh-canvas/assets'

/**
 * 资产 URL 上挂的那一格参数（v1.59）。
 *
 * 它**不是版本号**，是**换一格缓存键**。这条路由从前发 `immutable` + 一年，而资产的名字跨
 * 构建一字不变——那些响应在浏览器里再也不会回来问服务器，缓存头改了也管不到它们（真机上
 * 撞过一次：新的客户端配着缓存的旧引擎 chunk，报 `n.designExport is not a function`）。
 * 把 URL 换一格，这台机器就会按新策略（`no-cache` + ETag）重新取一次，之后日常都是 304。
 *
 * 所以它跟着**缓存策略**变，不跟着构建变——策略再改一次才动它。
 */
const ASSET_QUERY = '?v=2'

/** 一条资产 URL。**取资产一律走这里**，别自己拼 `${ASSET_BASE}/…`：拼两处就是两套规矩。 */
export function assetUrl(name: string): string {
  return `${ASSET_BASE}/${name}${ASSET_QUERY}`
}

/** 在一个可能已经带 query 的 URL 上再挂一格参数（`&` 还是 `?` 由它决定）。 */
export function withParam(url: string, param: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${param}`
}

/** Script-init timeout: an asset route that answers but never inits must not hang the viewer. */
const INIT_TIMEOUT_MS = 15_000

/**
 * 首帧硬依赖的四支默认字面（与 `design-skia.ts` 的 `CORE_FONTS` 同一批文件）。
 *
 * 名字写两遍是**有意的重复**，不是漏了共享常量：这里是**取缓存**，那边是**注册进
 * CanvasKit**，两件事恰好用同一批文件。把清单挪进 client 半会逼着 `design-skia.ts`
 * 反向依赖它——那个文件住在引擎 chunk 里，import 它就会把 `@open-pencil/core` 拉进
 * client.js，场景图的类身份立刻变成两份。
 */
const PREFETCH_FONTS = ['Inter-Regular.ttf', 'Inter-Medium.ttf', 'Inter-SemiBold.ttf', 'Inter-Bold.ttf'] as const

let fontsPrefetched = false

/**
 * 先把四支字面拉进 HTTP 缓存（**不注册**，注册是引擎 chunk 的事）。
 *
 * 用途只有一个：**预热**（`canvas/card/design-warmup.ts`）。放在打开预览的那一刻没有意义
 * ——实测那 4×330KB 会与 8MB 的 wasm 抢那 6 条连接，wasm 初始化从 300ms 拖到 600ms，
 * 「建引擎」省下的 240ms 又被吐回去（净收益 0）。而在预热那一趟里它们本来就不挡任何人：
 * 用户还在看画布，等点开时三个大件都已经在缓存里。
 *
 * 命中之后 chunk 那边再取是**回验**（路由回 `no-cache` + ETag，本地 304 只要 2–4ms）。
 */
export function prefetchDesignFonts(): void {
  if (fontsPrefetched || typeof document === 'undefined') return
  fontsPrefetched = true
  for (const file of PREFETCH_FONTS) {
    // **不带 `cache` 选项**：与 chunk 内部那次 `fetch` 用同一种模式，浏览器才会命中同一条
    // 缓存条目。写成 `force-cache` 时实测分成了两趟下载（335KB × 4 走两遍）。
    void fetch(assetUrl(file)).catch(() => undefined)
  }
}

let inflight: Promise<CanvasKitRuntime | null> | undefined

/**
 * Load and initialize CanvasKit once per page; `null` when unavailable.
 *
 * Single-flight: several design viewers opening at once share one attempt.
 * 失败**不留档**：成功那一份按页缓存，失败的那一趟下次重来（资产可能在升级之后才到位）。
 * 从前这里把 `null` 也钉在了 `inflight` 上，于是第一次取失败之后，这张页面上的每个设计卡
 * 都直接拿到那个 `null` 走降级路——注释写着「不永久缓存」，代码却永久缓存了。
 */
export function loadCanvasKit(): Promise<CanvasKitRuntime | null> {
  if (inflight !== undefined) return inflight
  const attempt = attemptLoad().catch(() => null)
  inflight = attempt
  void attempt.then((runtime) => {
    // 只清自己这一趟（等它回来时可能已经有更新的一趟在飞了）。
    if (runtime === null && inflight === attempt) inflight = undefined
  })
  return attempt
}

async function attemptLoad(): Promise<CanvasKitRuntime | null> {
  if (typeof document === 'undefined') return null
  if (document.querySelector(`script[data-dsh-canvas-canvaskit]`) === null) {
    await injectScript(assetUrl('canvaskit.js'))
  }
  const init = (window as unknown as { CanvasKitInit?: CanvasKitInitGlobal }).CanvasKitInit
  if (init === undefined) return null
  const runtime = await withTimeout(
    init({
      // CanvasKit 自己去找的 wasm 也要走同一条 URL（它按文件名拼，我们给它成品 URL）。
      locateFile: (file: string) => assetUrl(file),
    }),
    INIT_TIMEOUT_MS,
  )
  return runtime ?? null
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.dataset['dshCanvasCanvaskit'] = ''
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`canvaskit script failed: ${src}`))
    document.head.appendChild(script)
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('canvaskit init timed out')), ms)
    void promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
