/**
 * dsh-canvas — 平台真实绑定的宿主半（v1.97）。
 *
 * 路由两条动作（`POST /dsh-canvas/publish-bind/start|check`，前缀真源在
 * `core/publish/bind.ts`）：
 *
 * - **start**：找到这台机器上的 Chrome / Edge / Chromium / Brave，用**独立的
 *   user-data-dir**（不碰用户自己的浏览器配置）与**随机调试端口**拉起来，打开
 *   平台的登录页。独立 profile 还带来一个副产品：登录态留在这份 profile 里，
 *   下一次绑同平台不用重新登录。
 * - **check**：连 CDP（`/json/list` 找一个页面 target，走它的 WebSocket 发
 *   `Network.getAllCookies`），按目标平台的 Cookie 域白名单过滤，序列化成
 *   `Cookie:` 头形状交回去。count > 0 即「这个域下有登录态」——由客户端轮询，
 *   检测到即自动落表。
 *
 * 纪律：
 * - **请求里永远不收域名或 URL**——平台目标只按 id 从共享白名单现查（那份表的
 *   注释里写了为什么）。这条路由有 spawn 与读登录态两样重能力，开口子就是给
 *   别的本地页面当任意 Cookie 提取器。
 * - 任何一步失败都是 500 + 一句人话，绝不抛到调用方之外；浏览器没找到、CDP 没就绪
 *   都只是「绑定这一下没成」，画布照常。
 * - 路由处理函数本身是同步形状（`webServer` 的接口如此），但 `res` 在连接开着期间
 *   一直有效——异步工作在 handler 里 await 完再 `end` 即可（与 `open-in-app` 那条
 *   宿主路由同一姿势）。
 *
 * 零新依赖：CDP 的 HTTP 面用 Node 自带 `fetch`，WebSocket 用 Node 22 的原生全局
 * `WebSocket`（宿主跑在 Node ≥22 上，见 §10 的 CI 版本）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import {
  PUBLISH_BIND_ROUTE,
  bindTargetOf,
  cookieDomainMatches,
  cookieHeaderOf,
  type BindCookie,
} from '../core/publish/bind.ts'
import { registerRoute, type RouteRequest, type RouteResponse } from './web-server.ts'

/** 用户可以用环境变量钦定浏览器（非标准安装位置的唯一出路）。 */
const BROWSER_OVERRIDE = process.env.DSH_CANVAS_BROWSER

/** 各平台常见的 Chromium 系浏览器位置；按序找到第一个存在的。 */
const CHROME_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${homedir()}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
}

/** 登录态的 user-data-dir：放 tmp 下（每次开机清空一次，代价是重启后重新登录）。 */
function profileDir(): string {
  return join(tmpdir(), 'dsh-canvas-publish-profile')
}

/** 按候选表找浏览器；环境变量钦定优先。找到交回路径，没有交回 `undefined`。 */
function findBrowserBinary(): string | undefined {
  if (BROWSER_OVERRIDE !== undefined && BROWSER_OVERRIDE !== '' && existsSync(BROWSER_OVERRIDE)) {
    return BROWSER_OVERRIDE
  }
  for (const path of CHROME_CANDIDATES[process.platform] ?? []) {
    if (existsSync(path)) return path
  }
  return undefined
}

/** 找一个当下空闲的本机回环端口（bind 到 0 再关掉——有竞态，但窗口极窄且后果只是重来）。 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/** CDP 的 HTTP 面活着吗（1 秒超时；没活/没开都是 false）。 */
async function cdpAlive(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1_000) })
    return response.ok
  } catch {
    return false
  }
}

function reply(res: RouteResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function fail(res: RouteResponse, message: string): void {
  reply(res, 500, { ok: false, message })
}

/** 读查询串里的 platformId；缺了交回空串（由调用方拒绝）。刻意不收 POST body——webServer 的 req 不承诺有已解析的 body。 */
function platformIdOf(req: RouteRequest): string {
  const url = req.url ?? ''
  const at = url.indexOf('?')
  if (at === -1) return ''
  try {
    return new URLSearchParams(url.slice(at + 1)).get('platformId') ?? ''
  } catch {
    return ''
  }
}

/**
 * 挂路由，管住浏览器进程的一生。
 *
 * 进程句柄与调试端口是**模块级单例**——同一时刻只养一份登录浏览器，绑哪个平台
 * 都是往同一份 profile 里加登录态；插件卸载时浏览器留着（用户可能正在里面登录），
 * 只是不再接新请求。
 */
export function registerPublishBindRoute(ctx: Context): void {
  let browser: ChildProcess | undefined
  let port = 0

  /** 浏览器在跑且 CDP 活着吗；退了进程的句柄顺带清掉。 */
  const alive = async (): Promise<boolean> => {
    if (browser === undefined || port === 0) return false
    if (!(await cdpAlive(port))) {
      if (browser.exitCode !== null || browser.killed) browser = undefined
      return false
    }
    return true
  }

  /** CDP HTTP 面上开一个指向 loginUrl 的标签页（浏览器已在跑时的复用路）。 */
  const openTab = async (url: string): Promise<void> => {
    await fetch(`http://127.0.0.1:${port}/json/new?url=${encodeURIComponent(url)}`, {
      method: 'PUT',
      signal: AbortSignal.timeout(3_000),
    }).catch(() => undefined)
  }

  registerRoute(ctx, {
    path: PUBLISH_BIND_ROUTE,
    label: 'dsh-canvas: publish bind route',
    handler: (req, res) => {
      const action = (req.url ?? '').slice(PUBLISH_BIND_ROUTE.length).split('?')[0] ?? ''
      const platformId = platformIdOf(req)
      const target = bindTargetOf(platformId)
      if (!['start', 'check'].includes(action) || target === undefined) {
        fail(res, `dsh-canvas: 未知的绑定目标「${platformId || '(缺 platformId)'}」`)
        return
      }
      void (async () => {
        try {
          if (action === 'start') {
            if (await alive()) {
              await openTab(target.loginUrl)
              reply(res, 200, { ok: true })
              return
            }
            const binary = findBrowserBinary()
            if (binary === undefined) {
              fail(res, '这台机器上没有找到 Chrome / Edge / Chromium，无法打开登录页；可在「编辑」里手动粘贴 Cookie。')
              return
            }
            port = await freePort()
            const dir = profileDir()
            mkdirSync(dir, { recursive: true })
            browser = spawn(
              binary,
              [
                `--user-data-dir=${dir}`,
                `--remote-debugging-port=${port}`,
                '--no-first-run',
                '--no-default-browser-check',
                target.loginUrl,
              ],
              { stdio: 'ignore' },
            )
            browser.once('exit', () => {
              browser = undefined
            })
            // CDP 面就绪为止：给 15 秒（冷启动的开销全在这一段），轮不上就是失败。
            let up = false
            for (let waited = 0; waited < 15_000; waited += 500) {
              await new Promise((resolve) => setTimeout(resolve, 500))
              if (await cdpAlive(port)) {
                up = true
                break
              }
            }
            if (!up) {
              fail(res, '调试端口没有就绪，浏览器可能被占用或被安全软件拦截；可稍后重试。')
              return
            }
            reply(res, 200, { ok: true })
            return
          }
          // check：CDP 不在（没 start 过 / 浏览器关了）不是错——就是「还没有登录态」。
          if (!(await alive())) {
            reply(res, 200, { ok: true, count: 0, cookie: '' })
            return
          }
          const cookie = await collectCookies(port, target.cookieDomain)
          reply(res, 200, { ok: true, count: cookie === '' ? 0 : cookie.split('; ').length, cookie })
        } catch (error) {
          fail(res, error instanceof Error ? error.message : String(error))
        }
      })()
    },
  })
}

/** 连一个页面 target 的 WebSocket，把全部 Cookie 收回来。 */
async function collectCookies(port: number, cookieDomain: string): Promise<string> {
  const pages = (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3_000) }).then(
    (response) => (response.ok ? (response.json() as Promise<Array<{ type?: string; webSocketDebuggerUrl?: string }>>) : []),
  ).catch(() => [])) as Array<{ type?: string; webSocketDebuggerUrl?: string }>
  const wsUrl = pages.find((page) => page.type === 'page' && typeof page.webSocketDebuggerUrl === 'string')
    ?.webSocketDebuggerUrl
  if (typeof wsUrl !== 'string' || wsUrl === '') return ''

  const socket = new WebSocket(wsUrl)
  const cookies = await new Promise<BindCookie[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP 调试连接超时')), 8_000)
    const done = (value: BindCookie[] | Error): void => {
      clearTimeout(timer)
      socket.close()
      if (value instanceof Error) reject(value)
      else resolve(value)
    }
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Network.enable' }))
      socket.send(JSON.stringify({ id: 2, method: 'Network.getAllCookies' }))
    })
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      let message: { id?: number; result?: { cookies?: BindCookie[] } }
      try {
        message = JSON.parse(event.data) as { id?: number; result?: { cookies?: BindCookie[] } }
      } catch {
        return
      }
      if (message.id === 2) {
        const list = message.result?.cookies
        done(Array.isArray(list) ? list : [])
      }
    })
    socket.addEventListener('error', () => done(new Error('CDP 调试连接失败')))
  })

  const ours = cookies.filter((cookie) => cookieDomainMatches(cookie.domain ?? '', cookieDomain))
  return cookieHeaderOf(ours)
}
