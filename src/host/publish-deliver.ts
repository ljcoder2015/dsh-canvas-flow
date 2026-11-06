/**
 * dsh-canvas — 平台投递的宿主半（v1.98）。
 *
 * `POST /dsh-canvas/publish-deliver/`，JSON body 是 {@link DeliverPayload}（体积可能
 * 到兆级——正文带内联样式——所以走 open-in-app 同款的有界流式读法，`req` 在 webServer
 * 那侧就是一条可异步迭代的 Node 流）。宿主按平台 id 查表挑上游，**带着账号的 Cookie
 * 串调平台自己的 Web 接口**；cookie 只在这次请求的内存里流动，不落日志、不写盘。
 *
 * 三个上游（其余平台没有通道，`core/publish/upstream.ts` 的表是唯一真源）：
 *
 * - **微博** `ajax/statuses/update`：表单正文 + `x-xsrf-token`（从 Cookie 里的
 *   `XSRF-TOKEN` 解回来）。`ok:1` 即上线。
 * - **知乎** 专栏三步：建草稿 → 写内容 → 发布。csrf 取 `XSRF-TOKEN`（取不到用
 *   `d_c0` 兜底）。任何一步非 2xx 都带着平台的原话报错——平台校验收紧是常态，
 *   报错比硬装成功诚实。
 * - **公众号** 两步：先 GET 后台首页从 HTML 里挖 CSRF token（挖不到 = 登录态失效，
 *   明说「请重新绑定」），再 `appmsg?action=add_ex` 写**草稿箱**。「发表」是平台
 *   强制的最后一步，返回结果里明说，不冒充已发布。
 *
 * 收不到、超时、非 2xx、响应形状认不出——一律 200 + `{ok:false, message}` 回客户端
 * （失败是发布这件事的常规结果之一，不是协议错误）。唯一 500 的是宿主自己读不动请求。
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  PUBLISH_DELIVER_ROUTE,
  cookieValueOf,
  upstreamOf,
  weixinTokenFromHtml,
  type DeliverPayload,
  type DeliverResult,
} from '../core/publish/upstream.ts'
import { registerRoute, type RouteRequest, type RouteResponse } from './web-server.ts'

/** 请求体上限 8MB：正文带内联样式与图片引用，几 MB 是合理余量。 */
const MAX_DELIVER_BYTES = 8 * 1024 * 1024

/** 有界流式读 body；超限交回 `null`（流排干）。open-in-app 同款。 */
async function readBoundedBody(req: RouteRequest): Promise<string | null> {
  const stream = req as unknown as AsyncIterable<Uint8Array>
  if (typeof (stream as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== 'function') return null
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.byteLength
    if (size > MAX_DELIVER_BYTES) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

function reply(res: RouteResponse, payload: DeliverResult | { ok: boolean; message: string }): void {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function fail(res: RouteResponse, message: string): void {
  reply(res, { ok: false, message })
}

/** 解析并验证请求体；不合规交回 `undefined`（由调用方回 400）。 */
function parsePayload(text: string): DeliverPayload | undefined {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof body !== 'object' || body === null) return undefined
  const payload = body as Record<string, unknown>
  if (
    typeof payload.platformId !== 'string' ||
    typeof payload.credential !== 'string' ||
    typeof payload.title !== 'string' ||
    typeof payload.html !== 'string' ||
    typeof payload.text !== 'string' ||
    payload.credential.trim() === '' ||
    upstreamOf(payload.platformId) === undefined
  ) {
    return undefined
  }
  return { platformId: payload.platformId, credential: payload.credential, title: payload.title, html: payload.html, text: payload.text }
}

/** 上游 HTTP 调用的公共头：Cookie 是唯一身份。 */
function baseHeaders(credential: string, origin: string): Record<string, string> {
  return { cookie: credential, origin, referer: `${origin}/` }
}

/** 上游答不上来时给的那句统一话术：状态码 + 平台返回的前一段（认得出就带上）。 */
async function upstreamError(scope: string, response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim()
  return `${scope}失败（HTTP ${String(response.status)}）${snippet === '' ? '' : `：${snippet}`}`
}

/** 微博：发正文。 */
async function deliverWeibo(payload: DeliverPayload): Promise<DeliverResult> {
  const origin = 'https://weibo.com'
  const xsrf = cookieValueOf(payload.credential, 'XSRF-TOKEN')
  const response = await fetch(`${origin}/ajax/statuses/update`, {
    method: 'POST',
    headers: {
      ...baseHeaders(payload.credential, origin),
      'content-type': 'application/x-www-form-urlencoded',
      'x-xsrf-token': xsrf,
    },
    body: new URLSearchParams({ content: payload.text }).toString(),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) return { ok: false, message: await upstreamError('微博', response) }
  const data = (await response.json().catch(() => undefined)) as { ok?: number; data?: { id?: string } } | undefined
  if (data === undefined || data.ok !== 1) {
    return { ok: false, message: `微博返回了认不出的答复${JSON.stringify(data).slice(0, 200)}` }
  }
  return { ok: true, message: '已发布到微博。', url: 'https://weibo.com/' }
}

/** 知乎：建草稿 → 写内容 → 发布；任何一步失败都带着哪一步报错。 */
async function deliverZhihu(payload: DeliverPayload): Promise<DeliverResult> {
  const origin = 'https://zhuanlan.zhihu.com'
  const csrf = cookieValueOf(payload.credential, 'XSRF-TOKEN') || cookieValueOf(payload.credential, 'd_c0')
  const headers = {
    ...baseHeaders(payload.credential, origin),
    'content-type': 'application/json',
    'x-csrftoken': csrf,
    'x-requested-with': 'fetch',
  }
  const create = await fetch(`${origin}/api/articles/drafts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: payload.title }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!create.ok) return { ok: false, message: await upstreamError('知乎（创建草稿）', create) }
  const draft = (await create.json().catch(() => undefined)) as { id?: unknown } | undefined
  const id = draft === undefined ? undefined : (Array.isArray(draft.id) ? draft.id[0] : draft.id)
  if (typeof id !== 'number' && typeof id !== 'string') {
    return { ok: false, message: '知乎没有交回草稿 id，发布中止。' }
  }
  const write = await fetch(`${origin}/api/articles/${String(id)}/drafts`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ title: payload.title, content: payload.html }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!write.ok) return { ok: false, message: await upstreamError('知乎（写入正文）', write) }
  const publish = await fetch(`${origin}/api/articles/${String(id)}/publish`, {
    method: 'POST',
    headers,
    body: '{}',
    signal: AbortSignal.timeout(20_000),
  })
  if (!publish.ok) return { ok: false, message: await upstreamError('知乎（发布）', publish) }
  return { ok: true, message: '已发布到知乎专栏。', url: `https://zhuanlan.zhihu.com/p/${String(id)}` }
}

/** 公众号：挖后台 token → 写草稿箱。发表是平台强制的最后一步，在后台点。 */
async function deliverWeixin(payload: DeliverPayload): Promise<DeliverResult> {
  const origin = 'https://mp.weixin.qq.com'
  const home = await fetch(`${origin}/`, {
    headers: baseHeaders(payload.credential, origin),
    signal: AbortSignal.timeout(20_000),
  })
  if (!home.ok) return { ok: false, message: await upstreamError('公众号（打开后台）', home) }
  const token = weixinTokenFromHtml(await home.text())
  if (token === '') {
    return { ok: false, message: '公众号后台没有返回 token，登录态可能已失效——请重新绑定该账号再试。' }
  }
  const articleList = [
    {
      aid: '',
      auto_gen_type: 1,
      title: payload.title,
      author: '',
      digest: '',
      content: payload.html,
      content_html: payload.html,
      tag_list: [],
    },
  ]
  const form = new URLSearchParams({
    token,
    lang: 'zh_CN',
    f: 'json',
    ajax: '1',
    count: '1',
    AppMsgId: '',
    data_seq: '2',
    operate_from: 'AppMsgPublish',
    article_list: JSON.stringify(articleList),
  })
  const draft = await fetch(
    `${origin}/cgi-bin/appmsg?action=add_ex&t=ajax-editor&lang=zh_CN&f=json&token=${token}`,
    {
      method: 'POST',
      headers: { ...baseHeaders(payload.credential, origin), 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!draft.ok) return { ok: false, message: await upstreamError('公众号（写入草稿）', draft) }
  const data = (await draft.json().catch(() => undefined)) as
    | { base_resp?: { ret?: number; err_msg?: string } }
    | undefined
  if (data === undefined || (data.base_resp?.ret !== undefined && data.base_resp.ret !== 0)) {
    const code = data?.base_resp?.ret
    const msg = data?.base_resp?.err_msg ?? ''
    return { ok: false, message: `公众号拒绝了草稿（${msg === '' ? `ret=${String(code)}` : msg}）。` }
  }
  return {
    ok: true,
    message: '已写入公众号草稿箱；「发表」是平台强制的最后一步，请在公众号后台完成。正文里的图片如显示异常，需在后台编辑器里补传。',
    url: `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=list&type=77&token=${token}&lang=zh_CN`,
  }
}

const DELIVERERS = {
  weibo: deliverWeibo,
  zhihu: deliverZhihu,
  wechat: deliverWeixin,
} as const

/** 挂路由。失败回复 200 + ok:false 的纪律见文件头；唯一 500 是 body 读不动。 */
export function registerPublishDeliverRoute(ctx: Context): void {
  registerRoute(ctx, {
    path: PUBLISH_DELIVER_ROUTE,
    label: 'dsh-canvas: publish deliver route',
    handler: (req, res) => {
      void (async () => {
        let text: string | null
        try {
          text = await readBoundedBody(req)
        } catch {
          fail(res, '请求体读不动，发布中止。')
          return
        }
        if (text === null) {
          fail(res, `正文超过了 ${Math.round(MAX_DELIVER_BYTES / 1024 / 1024)}MB 的上限，发布中止。`)
          return
        }
        const payload = parsePayload(text)
        if (payload === undefined) {
          fail(res, '请求体不是一份合法的投递载荷（缺字段 / 平台没有投递通道）。')
          return
        }
        const deliver = DELIVERERS[upstreamOf(payload.platformId) ?? 'weibo']
        try {
          reply(res, await deliver(payload))
        } catch (error) {
          fail(res, error instanceof Error ? error.message : String(error))
        }
      })()
    },
  })
}
