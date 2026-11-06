/**
 * dsh-canvas — 平台投递（一键发布）的公共底座（v1.98）。
 *
 * v1.97 的真实绑定把各平台的**真实 Cookie** 攥在了手里；这一版让它们干活：客户端
 * 把适配好的正文 POST 给宿主（`PUBLISH_DELIVER_ROUTE`），宿主带着账号的 Cookie 调
 * 平台自己的 Web 接口。各平台的诚实边界（v1.98 实况）：
 *
 * - **微博**：`ajax/statuses/update` 发正文——Cookie + XSRF 头就够，直接上线。
 * - **知乎**：专栏「建草稿 → 写内容 → 发布」三步——Cookie + csrf 头，直接上线。
 * - **公众号**：后台接口强制 token + 自己的表单形状，能走到的是**写入草稿箱**；
 *   「发表」是平台强制的最后一步，只能在公众号后台点（这是平台规矩，不是插件偷懒）。
 * - **头条号 / 百家号 / 小红书**：接口都要额外签名或资质，v1.98 不开放——发布按钮
 *   按平台隐藏，文案明示走复制粘贴。
 *
 * 纪律与 `bind.ts` 一致：请求里不收「发到哪个域」——平台接口地址只由宿主按 id 查
 * 表；cookie 串只在宿主内存里流动，不落日志。纯函数（Cookie 取值、token 挖掘）放
 * 这里，判据可直接跑。
 */

/** 宿主投递路由前缀：`POST <前缀>` 一次调用发一份。 */
export const PUBLISH_DELIVER_ROUTE = '/dsh-canvas/publish-deliver/'

/** 有真实投递通道的平台的上游实现标识。 */
export type PublishUpstreamId = 'weibo' | 'zhihu' | 'wechat'

/** 平台 → 上游实现。不在表里的平台没有投递通道（客户端藏按钮、宿主拒绝）。 */
export const PUBLISH_UPSTREAMS: readonly { readonly platformId: string; readonly upstream: PublishUpstreamId }[] = [
  { platformId: 'weibo', upstream: 'weibo' },
  { platformId: 'zhihu', upstream: 'zhihu' },
  { platformId: 'wechat', upstream: 'wechat' },
]

/** 按平台 id 查投递通道；没有交回 `undefined`。 */
export function upstreamOf(platformId: string): PublishUpstreamId | undefined {
  return PUBLISH_UPSTREAMS.find((entry) => entry.platformId === platformId)?.upstream
}

/**
 * 从 Cookie 头形状的串里取一枚的值。
 *
 * `XSRF-TOKEN` 这类 token 在 Cookie 里是 URL 编码的（`%2F`），这里解回来——上游要
 * 的头值是原始 token。找不到交回空串，调用方不猜。
 */
export function cookieValueOf(cookie: string, name: string): string {
  for (const part of cookie.split(';')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    if (part.slice(0, at).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(at + 1).trim())
    } catch {
      return part.slice(at + 1).trim()
    }
  }
  return ''
}

/**
 * 从公众号后台的 HTML 里挖 CSRF token（调 `cgi-bin/*` 接口都要带上）。
 *
 * 页面上 token 出现的形状不止一种（URL 参数 `?token=123`、内联变量
 * `data.t="123"`），按候选顺序认第一处。挖不到交回空串——那就是「Cookie 失效 /
 * 后台没让进」，由调用方说「请重新绑定」，不拿空 token 去撞接口。
 */
export function weixinTokenFromHtml(html: string): string {
  for (const pattern of [
    /data\.t\s*=\s*['"](\d+)['"]/,
    /window\.wx\.commonData\.data\.t\s*=\s*['"]?(\d+)/,
    /[?&]token=(\d+)/,
  ]) {
    const hit = html.match(pattern)
    if (hit !== null) return hit[1] ?? ''
  }
  return ''
}

/** 客户端 → 宿主的投递请求体。正文按上游要的形状两份都带，宿主各取所需。 */
export interface DeliverPayload {
  /** 平台 id，必须是 `PUBLISH_UPSTREAMS` 里的一个。 */
  readonly platformId: string
  /** 该账号的真实凭证（`Cookie:` 头形状，来自 v1.97 的真实绑定或手动编辑）。 */
  readonly credential: string
  /** 文章标题（发布页用产物名）。 */
  readonly title: string
  /** HTML 正文（知乎 / 公众号）。 */
  readonly html: string
  /** 纯文本（微博）。 */
  readonly text: string
}

/** 宿主 → 客户端的投递结果。失败时 `message` 是给人看的那句话。 */
export interface DeliverResult {
  readonly ok: boolean
  readonly message: string
  /** 发布成功后可打开的地址（文章页 / 草稿箱）。 */
  readonly url?: string
}
