/**
 * dsh-canvas — 工作区图片路由（v1.92 图文并茂）。
 *
 * markdown 产物里的 `![插图](相对路径)` 在浏览器里没有基准 URL 可言：预览是弹窗里的
 * 一个 DOM，相对地址会落到宿主页面的路径上去，结果永远是破图。这条路由给那些路径一个
 * 真正的产地——`/dsh-canvas/workspace/<projectId>/<项目内相对路径>`，按 projectId 取
 * 项目根，把项目里的**图片文件**交给浏览器。
 *
 * 与 {@link ./assets.ts} 那条资产路由同一条先例、同一个纪律：
 *
 * - `webServer` 按**名字结构化解析**（`web-server.ts`），没有 HTTP 面的部署静默跳过——
 *   markdown 预览里相对图片退回「原文照抄」（渲染器那条纪律），画布功能本身照常能跑。
 * - 只放行**图片扩展名**（`MEDIA_MIME` 里 `image/*` 的那几行）。产物是模型写的，模型
 *   可能引任何东西；这条路由存在的理由是「预览里的插图」，不是「项目文件的下载口」。
 * - 防穿越在**每一段**上判：`..`、`.`、反斜杠、空段统统 404，`normalize` 之后再验一次
 *   仍在根内——两层里漏一层就是一次任意文件读。
 * - ETag（长度 + mtime）+ `no-cache`，与资产路由同一套回验：图片可能被重新生成，
 *   「存一年」的策略在产物上永远不对。
 *
 * 路由处理函数是**同步**的（`webServer` 的接口形状如此），所以项目根由装配处注入一个
 * 同步的 `rootOf`——`CanvasRuntime.rootOf`，读的是存储域的内存表，不为一张图去拉板面。
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { ASSET_CACHE_CONTROL, entityTagOf, isNotModified } from './assets.ts'
import { registerRoute, type RouteRequest, type RouteResponse } from './web-server.ts'
import { MEDIA_MIME } from '../core/media/mime.ts'
// 前缀的真源在契约上（两个半边要拼出同一个地址），这里只带过来用。
import { WORKSPACE_ROUTE } from '../contract.ts'

/**
 * 这条路由放行的图片扩展名：从 `MEDIA_MIME` 里按 `image/*` 现挑，不另抄一份清单。
 *
 * **刻意排除 `svg`**：SVG 在 `<img>` 里不执行脚本，但直接导航到这条 URL 时它是一份
 * 文档、脚本是会跑的——而这条路由的 URL 是用户可能点开的地址，同源脚本执行不是
 * 「预览里的插图」该附送的礼物。markdown 里引一张 SVG 会退回原文降级；要画矢量图
 * 走设计节点那条路。
 */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MEDIA_MIME).filter(([extension, mime]) => mime.startsWith('image/') && extension !== 'svg'),
)

/** 图片扩展名 → MIME。没有命中（可执行文件、脚本、任何不是图的东西）就是 404。 */
function imageContentType(path: string): string | undefined {
  const at = path.lastIndexOf('.')
  return at === -1 ? undefined : IMAGE_EXTENSIONS[path.slice(at + 1).toLowerCase()]
}

/**
 * Register the workspace route for the lifetime of the plugin.
 *
 * `rootOf` answers「这个 projectId 的画布根在哪儿」，未知 id 交回 `undefined`——
 * 由这里 404，而不是让装配处为了一个目录读一次板面。注册本身与资产路由同一条
 * best-effort：没有 HTTP 面的部署静默跳过。
 */
export function registerWorkspaceRoute(
  ctx: Context,
  rootOf: (projectId: string) => string | undefined,
): void {
  registerRoute(ctx, {
    path: WORKSPACE_ROUTE,
    label: 'dsh-canvas: workspace route',
    handler: (req, res) => serveWorkspace(req, res, rootOf),
  })
}

/** Serve one image from a project root, or 404 anything else. */
function serveWorkspace(
  req: RouteRequest,
  res: RouteResponse,
  rootOf: (projectId: string) => string | undefined,
): void {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain' })
    res.end('method not allowed')
    return
  }
  const url = req.url ?? '/'
  const pathname = url.slice(WORKSPACE_ROUTE.length).split('?')[0]
  // 路径形状：`/<projectId>/<项目内相对路径>`。projectId 是六个字母（老记录可能是
  // 路径形 id），但无论哪种，「第一段之后至少还有一段」都是一条图片引用的最低要求。
  const segments = pathname.replace(/^\/+/, '').split('/').filter((segment) => segment !== '')
  if (segments.length < 2) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  const [projectId, ...rest] = segments
  const root = rootOf(decodeURIComponent(projectId ?? ''))
  if (root === undefined) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  // 每段先验后拼：URL 编码过的 `..%2F..` 在这里解开后就是字面的 `..`，所以**解开后**
  // 这一遍才是真闸。第二道闸在 normalize 之后——拼出来的相对路径必须仍在根内。
  const decoded = rest.map((segment) => decodeURIComponent(segment))
  if (decoded.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.includes('\\'))) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  const relative = normalize(decoded.join('/'))
  if (relative.startsWith('..') || relative === '') {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  const path = join(root, relative)
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  const contentType = imageContentType(path)
  if (contentType === undefined || !existsSync(path)) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  const stat = statSync(path)
  if (!stat.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  const etag = entityTagOf(stat.size, stat.mtimeMs)
  if (isNotModified(req.headers?.['if-none-match'], etag)) {
    res.writeHead(304, { etag, 'cache-control': ASSET_CACHE_CONTROL })
    res.end()
    return
  }
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': String(stat.size),
    etag,
    'cache-control': ASSET_CACHE_CONTROL,
  })
  if (method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(path).pipe(res as never)
}
