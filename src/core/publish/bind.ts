/**
 * dsh-canvas — 平台真实绑定的公共底座（v1.97）。
 *
 * 绑定要拿的是**真凭证**，不是本地编的令牌：宿主在这台机器上拉起一个带独立调试
 * 端口（CDP）的浏览器，打开平台的登录页；用户在那个窗口里扫码 / 登录之后，宿主
 * 通过 CDP 把该平台域下的 Cookie 读出来，存成本机凭证。「自动」指的是**抓取**这
 * 一步——点一下绑定、登录完成即自动落表；登录本身永远只能是用户本人。
 *
 * 这份模块是两个半边共同的那一小块：路由前缀（客户端拼请求、宿主挂路由，两边要
 * 拼出同一个地址，与 `core/font/route.ts` 的 `FONT_ROUTE` 同一条先例）、平台目标
 * 表（登录页与 Cookie 域）。**Cookie 域是一份白名单**：宿主的 check 动作只按这份
 * 表过滤 Cookie，请求里永远不收域名——否则任何本地页面都能拿这条路由当「任意
 * 网站登录态的提取器」，那不是插件该附送的能力。
 */

/** 宿主路由前缀：`POST <前缀>start`（拉起浏览器进登录页）/ `<前缀>check`（收 Cookie）。 */
export const PUBLISH_BIND_ROUTE = '/dsh-canvas/publish-bind/'

/** 一个平台的真实绑定目标：从哪儿登录、认哪个域下的 Cookie。 */
export interface PublishBindTarget {
  /** 平台 id，与发布适配注册表（`client/artifact/publish/platforms.ts`）同一个 id 空间。 */
  readonly platformId: string
  /** 登录页地址——浏览器窗口打开的第一个页面。 */
  readonly loginUrl: string
  /**
   * Cookie 域后缀（不带前导点）。过滤按「等于或以此结尾」判——平台 Cookie 常落在
   * 比登录页更宽的域上（公众号的落在 `.qq.com`），按登录页域过滤会两手空空。
   */
  readonly cookieDomain: string
}

/**
 * 六个平台的绑定目标。登录页选的是**稳定入口**（创作后台首页——未登录访问它会
 * 自己弹登录，比直接拼各平台登录页的深层地址经得起改版）。
 */
export const PUBLISH_BIND_TARGETS: readonly PublishBindTarget[] = [
  { platformId: 'wechat', loginUrl: 'https://mp.weixin.qq.com/', cookieDomain: 'qq.com' },
  { platformId: 'zhihu', loginUrl: 'https://www.zhihu.com/signin?next=%2F', cookieDomain: 'zhihu.com' },
  { platformId: 'toutiao', loginUrl: 'https://mp.toutiao.com/', cookieDomain: 'toutiao.com' },
  { platformId: 'baijiahao', loginUrl: 'https://baijiahao.baidu.com/', cookieDomain: 'baidu.com' },
  { platformId: 'xiaohongshu', loginUrl: 'https://creator.xiaohongshu.com/', cookieDomain: 'xiaohongshu.com' },
  { platformId: 'weibo', loginUrl: 'https://weibo.com/login.php', cookieDomain: 'weibo.com' },
]

/** 按 id 找绑定目标；未知平台交回 `undefined`（调用方不猜）。 */
export function bindTargetOf(platformId: string): PublishBindTarget | undefined {
  return PUBLISH_BIND_TARGETS.find((target) => target.platformId === platformId)
}

/**
 * 一枚 CDP Cookie 的域落在目标平台上吗。
 *
 * CDP 给的 `domain` 可能带前导点（`.qq.com`），剥掉再判；「等于目标域」与「是目标
 * 域的子域」都算命中——`mp.weixin.qq.com` 命中 `qq.com`，`evilqq.com` 不命中。
 */
export function cookieDomainMatches(cookieDomain: string, target: string): boolean {
  const domain = cookieDomain.replace(/^\./, '').toLowerCase()
  return domain === target || domain.endsWith(`.${target}`)
}

/** CDP 递回来的一枚 Cookie 里，序列化用得到的那几个成员。 */
export interface BindCookie {
  readonly name: string
  readonly value: string
  readonly domain?: string
}

/**
 * 把抓到的 Cookie 序列化成 `Cookie:` 头的形状（`name=value; name=value`）。
 *
 * 同名 Cookie 可能在父子域各一枚（`.qq.com` 与 `mp.weixin.qq.com` 各一份
 * `sessionid`），头形状里没有域的位置——保留**域更具体**（更长）的那一枚：浏览器
 * 真发请求时更具体的域覆盖宽域，这里照它的答案落。空名与空值丢弃。
 */
export function cookieHeaderOf(cookies: readonly BindCookie[]): string {
  const byName = new Map<string, BindCookie>()
  for (const cookie of cookies) {
    if (cookie.name === '' || cookie.value === '') continue
    const held = byName.get(cookie.name)
    const score = (cookie.domain ?? '').replace(/^\./, '').length
    const heldScore = held === undefined ? -1 : (held.domain ?? '').replace(/^\./, '').length
    if (held === undefined || score > heldScore) byName.set(cookie.name, cookie)
  }
  return [...byName.values()].map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}
