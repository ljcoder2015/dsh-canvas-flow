/**
 * 平台真实绑定的公共底座判据（v1.97）。
 *
 * 这里最要紧的一族判据是**域匹配的白名单纪律**：宿主只按这份表里的 Cookie 域收
 * 登录态，匹配函数宽一寸（比如 `endsWith` 不带点、大小写不归一）就是给「任意网站
 * 登录态提取器」开门。序列化的判据盯「同名 Cookie 父子域并存」这一个真实会发生的
 * 形状——公众号的 `sessionid` 常在 `.qq.com` 与 `mp.weixin.qq.com` 各一枚。
 */
import { describe, expect, it } from 'vitest'
import {
  PUBLISH_BIND_ROUTE,
  PUBLISH_BIND_TARGETS,
  bindTargetOf,
  cookieDomainMatches,
  cookieHeaderOf,
} from '../../../src/core/publish/bind.ts'
import { PUBLISH_PLATFORMS } from '../../../src/client/artifact/publish/platforms.ts'

describe('PUBLISH_BIND_ROUTE / 目标表', () => {
  it('路由前缀两头带斜杠（客户端拼 `<前缀>start`、宿主按前缀挂路由，两边拼同一个地址）', () => {
    expect(PUBLISH_BIND_ROUTE.startsWith('/')).toBe(true)
    expect(PUBLISH_BIND_ROUTE.endsWith('/')).toBe(true)
  })

  it('发布注册表里的每个平台都有一个绑定目标——按钮不该出现「点进去没有」的平台', () => {
    for (const platform of PUBLISH_PLATFORMS) {
      expect(bindTargetOf(platform.id)).toBeDefined()
    }
    expect(bindTargetOf('no-such')).toBeUndefined()
  })

  it('目标表自身：id 唯一、登录页全是 https、Cookie 域不带前导点也不为空', () => {
    const ids = PUBLISH_BIND_TARGETS.map((target) => target.platformId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const target of PUBLISH_BIND_TARGETS) {
      expect(target.loginUrl.startsWith('https://')).toBe(true)
      expect(target.cookieDomain.startsWith('.')).toBe(false)
      expect(target.cookieDomain).not.toBe('')
    }
  })
})

describe('cookieDomainMatches：白名单域匹配', () => {
  it('等于目标域、或目标域的子域，都命中', () => {
    expect(cookieDomainMatches('qq.com', 'qq.com')).toBe(true)
    expect(cookieDomainMatches('mp.weixin.qq.com', 'qq.com')).toBe(true)
    expect(cookieDomainMatches('.qq.com', 'qq.com')).toBe(true)
    expect(cookieDomainMatches('.mp.weixin.qq.com', 'qq.com')).toBe(true)
  })

  it('仅仅是后缀像不行：evilqq.com 不命中 qq.com（少了点的分隔就是另一个域）', () => {
    expect(cookieDomainMatches('evilqq.com', 'qq.com')).toBe(false)
    expect(cookieDomainMatches('notzhihu.com', 'zhihu.com')).toBe(false)
  })

  it('大小写与空串不假装命中', () => {
    expect(cookieDomainMatches('QQ.COM', 'qq.com')).toBe(true)
    expect(cookieDomainMatches('', 'qq.com')).toBe(false)
    expect(cookieDomainMatches('com', 'qq.com')).toBe(false)
  })
})

describe('cookieHeaderOf：序列化成 Cookie 头形状', () => {
  it('基础形状 `name=value`，分号加空格相连', () => {
    expect(
      cookieHeaderOf([
        { name: 'sess', value: 'abc', domain: 'qq.com' },
        { name: 'uin', value: 'oX987', domain: 'mp.weixin.qq.com' },
      ]),
    ).toBe('sess=abc; uin=oX987')
  })

  it('同名 Cookie 保留域更具体的那一枚（浏览器发请求时更具体的域覆盖宽域）', () => {
    const header = cookieHeaderOf([
      { name: 'sessionid', value: 'wide', domain: '.qq.com' },
      { name: 'sessionid', value: 'specific', domain: 'mp.weixin.qq.com' },
    ])
    expect(header).toBe('sessionid=specific')
    expect(header).not.toContain('wide')
  })

  it('空名与空值丢弃；没有域信息也能序列化', () => {
    expect(cookieHeaderOf([{ name: '', value: 'x' }, { name: 'a', value: '' }, { name: 'k', value: 'v' }])).toBe('k=v')
  })
})
