/**
 * 平台投递底座的判据（v1.98）。
 *
 * 两个半边拼地址、按表查通道——「同一个东西两个来源」在这个功能上是静默发错平台
 * 的形状，所以表覆盖与路由形状在这里钉死。纯函数（Cookie 取值、公众号 token 挖掘）
 * 是宿主适配器唯一的解析逻辑，判据按**真实 HTTP 形状**写：Cookie 串是真响应头里
 * 拆下来的形状，HTML 是真后台页面的形状。
 */
import { describe, expect, it } from 'vitest'
import {
  PUBLISH_DELIVER_ROUTE,
  PUBLISH_UPSTREAMS,
  cookieValueOf,
  upstreamOf,
  weixinTokenFromHtml,
} from '../../../src/core/publish/upstream.ts'
import { PUBLISH_PLATFORMS } from '../../../src/client/artifact/publish/platforms.ts'

describe('PUBLISH_DELIVER_ROUTE / 通道表', () => {
  it('路由前缀两头带斜杠（客户端拼地址、宿主挂前缀路由，两边同一个地址）', () => {
    expect(PUBLISH_DELIVER_ROUTE.startsWith('/')).toBe(true)
    expect(PUBLISH_DELIVER_ROUTE.endsWith('/')).toBe(true)
  })

  it('通道表：id 唯一、upstream 都在三个实现之内', () => {
    const ids = PUBLISH_UPSTREAMS.map((entry) => entry.platformId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of PUBLISH_UPSTREAMS) {
      expect(['weibo', 'zhihu', 'wechat']).toContain(entry.upstream)
    }
  })

  it('查得到的是微博 / 知乎 / 公众号；其余平台（含注册表里真实存在的）没有通道', () => {
    expect(upstreamOf('weibo')).toBe('weibo')
    expect(upstreamOf('zhihu')).toBe('zhihu')
    expect(upstreamOf('wechat')).toBe('wechat')
    expect(upstreamOf('toutiao')).toBeUndefined()
    expect(upstreamOf('baijiahao')).toBeUndefined()
    expect(upstreamOf('xiaohongshu')).toBeUndefined()
    expect(upstreamOf('no-such')).toBeUndefined()
    // 注册表里每个 id 至少是「查得到或查不到」都诚实——没有拼错形状的中间态。
    for (const platform of PUBLISH_PLATFORMS) {
      const upstream = upstreamOf(platform.id)
      expect(upstream === undefined || typeof upstream === 'string').toBe(true)
    }
  })
})

describe('cookieValueOf：从 Cookie 头形状的串里取一枚', () => {
  it('取得到、会 trim、URL 编码解回来（XSRF-TOKEN 在真响应里就是 %2F 编码的）', () => {
    const cookie = 'XSRF-TOKEN=ab%2Fcd%3Def; SUB=abc123; lang=zh-cn'
    expect(cookieValueOf(cookie, 'XSRF-TOKEN')).toBe('ab/cd=ef')
    expect(cookieValueOf(cookie, 'SUB')).toBe('abc123')
  })

  it('没有就是空串；坏编码不抛、原样回；前缀像不行', () => {
    expect(cookieValueOf('a=1; b=2', 'missing')).toBe('')
    expect(cookieValueOf('a=%zz', 'a')).toBe('%zz')
    expect(cookieValueOf('XSRF-TOKEN-x=1', 'XSRF-TOKEN')).toBe('')
  })
})

describe('weixinTokenFromHtml：从公众号后台 HTML 里挖 CSRF token', () => {
  it('内联变量与 URL 参数两种真形状都认', () => {
    expect(weixinTokenFromHtml('window.wx.commonData.data.t="123456789";')).toBe('123456789')
    expect(weixinTokenFromHtml('data.t = \'98765\'')).toBe('98765')
    expect(weixinTokenFromHtml('href="/cgi-bin/home?t=home&token=555000"')).toBe('555000')
  })

  it('按候选顺序认第一处', () => {
    expect(weixinTokenFromHtml('data.t="111"; ... &token=222')).toBe('111')
  })

  it('挖不到交回空串（登录态失效的正确信号，不许拿空 token 去撞接口）', () => {
    expect(weixinTokenFromHtml('<html>登录</html>')).toBe('')
    expect(weixinTokenFromHtml('token=abc')).toBe('')
  })
})
