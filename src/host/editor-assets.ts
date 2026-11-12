/**
 * dsh-canvas — Rigby2D 编辑器嵌入包的静态路由（骨骼动画卡 v2.08 改道）。
 *
 * 与 `assets.ts` 的差别只有一个：**允许多段路径**。设计预览器的资产是扁平目录（单段文件
 * 名就能定位），Rigby2D 的 vite 产物是带 chunk 子目录的常规前端包（`assets/xxx.js`、
 * 字体、wasm 各归其位）——按单段放行等于让整包 404。安全纪律不变：归一后不许 `..`、
 * 必须落在 `lib/assets/rigby2d-editor/` 之内，这条路由是插件自己的构建产物，不是用户
 * 产物，工作区的接缝照旧不碰。
 *
 * 服务解析（`webServer` 按名取、缺席即 no-op）与缓存策略（no-cache + ETag 304）都照抄
 * `assets.ts`——那两条Route的教训（v1.59）直接继承，不重复踩。
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { registerRoute, type RouteRequest, type RouteResponse } from './web-server.ts'

/** 浏览器取编辑器嵌入包的路由前缀。 */
export const EDITOR_ASSET_ROUTE = '/dsh-canvas/rigby2d-editor'

/** 嵌入包在 `lib/assets/` 下的子目录（`rigby2d-build.mjs` 的产出）。 */
export const EDITOR_ASSET_SUBDIR = 'rigby2d-editor'

type EditorAssetRequest = RouteRequest
type EditorAssetResponse = RouteResponse

/** 嵌入包会出现的扩展名（vite 产物：html/js/css/wasm/字体/图）。 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

/** ETag 与回验逻辑与 `assets.ts` 共用同一条纪律（长度 + mtime；三种 If-None-Match 都认）。 */
const entityTagOf = (size: number, mtimeMs: number): string => `"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`

function isNotModified(ifNoneMatch: string | string[] | undefined, etag: string): boolean {
  const raw = Array.isArray(ifNoneMatch) ? ifNoneMatch.join(',') : ifNoneMatch
  if (raw === undefined || raw === '') return false
  return raw.split(',').some((candidate) => {
    const value = candidate.trim().replace(/^W\//, '')
    return value === '*' || value === etag
  })
}

/** 嵌入包目录（`lib/assets/rigby2d-editor/`）；测试缝与 `assets.ts` 的 `assetsDir` 同理。 */
export function editorAssetsDir(from: string = import.meta.url): string {
  return fileURLToPath(new URL('./assets/rigby2d-editor/', from))
}

/** 解析请求里的相对路径到嵌入包内的真实文件；越界/可疑一律 `undefined`（调用方 404）。 */
export function editorAssetFilePath(rel: string, from: string = import.meta.url): string | undefined {
  const root = resolve(editorAssetsDir(from))
  const cleaned = normalize(rel).replace(/^([/\\])+/, '')
  if (cleaned === '' || cleaned.startsWith('.')) return undefined
  const full = resolve(root, cleaned)
  if (!full.startsWith(root + sep)) return undefined
  return full
}

/** 注册路由；宿主没有 HTTP 面时是 no-op（与 `registerAssetRoute` 同一条 best-effort 纪律）。 */
export function registerEditorAssetRoute(ctx: Context, from: string = import.meta.url): void {
  registerRoute(ctx, {
    path: EDITOR_ASSET_ROUTE,
    label: 'dsh-canvas: rigby2d editor route',
    handler: (req, res) => serveEditorAsset(req, res, from),
  })
}

function serveEditorAsset(req: EditorAssetRequest, res: EditorAssetResponse, from: string): void {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain' })
    res.end('method not allowed')
    return
  }
  const url = req.url ?? '/'
  const pathname = decodeURIComponent(url.slice(EDITOR_ASSET_ROUTE.length).split('?')[0])
  const path = editorAssetFilePath(pathname, from)
  if (path === undefined || !existsSync(path) || !statSync(path).isFile()) {
    // 入口缺省补 index.html：iframe 挂的是路由根。
    if (pathname === '/' || pathname === '') {
      const fallback = editorAssetFilePath('index.html')
      if (fallback !== undefined && existsSync(fallback)) return send(req, res, method, fallback)
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  send(req, res, method, path)
}

function send(req: EditorAssetRequest, res: EditorAssetResponse, method: string, path: string): void {
  const stat = statSync(path)
  const etag = entityTagOf(stat.size, stat.mtimeMs)
  if (isNotModified(req.headers?.['if-none-match'], etag)) {
    res.writeHead(304, { etag, 'cache-control': 'no-cache' })
    res.end()
    return
  }
  const contentType = CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': String(stat.size),
    etag,
    'cache-control': 'no-cache',
  })
  if (method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(path).pipe(res as never)
}
