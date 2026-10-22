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

let inflight: Promise<CanvasKitRuntime | null> | undefined

/**
 * Load and initialize CanvasKit once per page; `null` when unavailable.
 *
 * Single-flight: several design viewers opening at once share one attempt.
 * The result is not cached negatively forever — a retry on the next viewer
 * open is cheap and honest (the assets may have appeared after an upgrade).
 */
export function loadCanvasKit(): Promise<CanvasKitRuntime | null> {
  if (inflight !== undefined) return inflight
  inflight = attemptLoad().catch(() => null)
  return inflight
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
