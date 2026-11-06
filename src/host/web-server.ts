/**
 * dsh-canvas — 宿主 HTTP 服务那点面的取法（v1.89 抽出）。
 *
 * 这个文件存在只是为了**一件事只有一份**：`ctx.get('webServer')` 而不是 `ctx.webServer`。
 * 那条教训是真的死过一次的——cordis 对「声明了但没 inject 的服务」在属性访问时直接抛，
 * 整棵插件树在加载期就没了（见 `tests/host/assets.spec.ts` 开头）。现在有两条路由要挂
 * （资产、本地字体），照抄两遍就会有一遍抄漏 `typeof register === 'function'` 那道检查。
 *
 * 服务按**名字**结构化解析，不 import 宿主那半的包：本插件要能跑在有 HTTP 面的装配里，
 * 也要能跑在没有的那种里。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 一条路由的处理函数。`req`/`res` 只取本插件真用到的那几个成员。 */
export interface RouteRequest {
  method?: string
  url?: string
  headers?: Readonly<Record<string, string | string[] | undefined>>
}

export interface RouteResponse {
  writeHead(status: number, headers: Record<string, string | number>): unknown
  end(body?: unknown): unknown
}

/** 本插件用到的那一片 webServer。 */
export interface WebServerFace {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: RouteRequest, res: RouteResponse) => void
  }): () => void
}

/** 取到就返回，取不到（没有这个服务，或形状不对）返回 `undefined`。**永不抛。** */
export function webServerFace(ctx: Context): WebServerFace | undefined {
  const face = ctx.get('webServer') as WebServerFace | undefined
  return face !== undefined && typeof face.register === 'function' ? face : undefined
}

/**
 * 把一条前缀路由挂到插件的生命周期上。
 *
 * 装配里已经有 `webServer` 就直接挂；还没有就等 `inject`（宿主可能晚一步把这个服务装上来）。
 * 两种情形都**不抛**：没有 HTTP 面的部署只是少了这两条路由，画布功能本身一样能用。
 */
export function registerRoute(
  ctx: Context,
  route: { path: string; label: string; handler: (req: RouteRequest, res: RouteResponse) => void },
): void {
  const register = (host: Context): void => {
    const server = webServerFace(host)
    if (server === undefined) return
    host.effect(() => {
      const dispose = server.register({ kind: 'prefix', path: route.path, handler: route.handler })
      return () => dispose()
    }, route.label)
  }
  if (webServerFace(ctx) !== undefined) {
    register(ctx)
  } else {
    ctx.inject(['webServer'], register as never)
  }
}
