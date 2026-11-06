/**
 * dsh-canvas — 真实绑定的客户端半（v1.97）。
 *
 * 三个动作，与宿主路由（`core/publish/bind.ts` 与 `core/publish/upstream.ts` 的
 * 路由常量）对齐：
 *
 * - `startRealBind`：让宿主拉起登录浏览器。宿主找到浏览器并就绪才回 200；找不到
 *   浏览器、端口没就绪都带着一句人话回来（调用点放进错误行）。
 * - `checkRealBind`：问「目标平台的域下有登录态了吗」。count > 0 即已登录，cookie
 *   就是抓到的真凭证（`Cookie:` 头形状）。轮询节奏归发布页——这里只发一次、答一次。
 *
 * 与 `open-folder.ts` 同一条纪律：这一层是纯策略与一条 HTTP 通道，单测可以直接跑。
 */
import { PUBLISH_BIND_ROUTE } from '../../../core/publish/bind.ts'
import { PUBLISH_DELIVER_ROUTE, type DeliverPayload, type DeliverResult } from '../../../core/publish/upstream.ts'
import { hostBase } from '../../canvas/project/open-folder.ts'

/** check 动作的答案：`count` 是命中目标域的 Cookie 枚数，`cookie` 是序列化好的凭证。 */
export interface RealBindCheck {
  readonly count: number
  readonly cookie: string
}

async function callBind(action: 'start' | 'check', platformId: string): Promise<Record<string, unknown>> {
  const url = `${PUBLISH_BIND_ROUTE}${action}?platformId=${encodeURIComponent(platformId)}`
  const response = await fetch(new URL(url, hostBase()), {
    method: 'POST',
    headers: { accept: 'application/json' },
  })
  const payload = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined
  if (!response.ok) {
    const message = payload !== undefined && typeof payload.message === 'string' ? payload.message : `HTTP ${String(response.status)}`
    throw new Error(message)
  }
  return payload ?? {}
}

/** 让宿主打开登录浏览器（失败抛宿主给的那句话）。 */
export async function startRealBind(platformId: string): Promise<void> {
  await callBind('start', platformId)
}

/** 问目标平台的登录态；宿主答不上来时算作「还没有」（绑定流程不该被一次抖动打断）。 */
export async function checkRealBind(platformId: string): Promise<RealBindCheck> {
  const payload = await callBind('check', platformId)
  const count = typeof payload.count === 'number' ? payload.count : 0
  const cookie = typeof payload.cookie === 'string' ? payload.cookie : ''
  return { count, cookie }
}

/**
 * 一键发布（v1.98）：把适配好的正文交给宿主，宿主带账号的真 Cookie 调平台接口。
 * 失败抛宿主给的那句人话（哪一步、平台回了什么，原样上来）；成功交回结果
 * （message + 可打开的地址）。
 */
export async function deliverPost(payload: DeliverPayload): Promise<DeliverResult> {
  const response = await fetch(new URL(PUBLISH_DELIVER_ROUTE, hostBase()), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined
  if (!response.ok) {
    const message = typeof body?.message === 'string' ? body.message : `HTTP ${String(response.status)}`
    throw new Error(message)
  }
  if (body === undefined || typeof body.ok !== 'boolean' || typeof body.message !== 'string') {
    throw new Error('宿主返回了认不出的投递答复。')
  }
  return {
    ok: body.ok,
    message: body.message,
    url: typeof body.url === 'string' && body.url !== '' ? body.url : undefined,
  }
}
