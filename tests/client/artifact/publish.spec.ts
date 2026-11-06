/**
 * 发布适配器判据（v1.93）。这里钉的每一条都对应一次「粘贴出去之后的样子」：
 * 公众号编辑器不吃外部 CSS（内联样式缺一块就是那一块素着）、小红书正文不认
 * markdown（记号留着就是给读者的乱码）、图片内联的键必须与源里的 src 一致。
 */
import { describe, expect, it } from 'vitest'
import {
  PUBLISH_PLATFORMS,
  collectImageUrls,
  publishPlatformOf,
  type PublishPlatform,
} from '../../../src/client/artifact/publish/platforms.ts'

/** 测试里要的是确定的那一个；类型层面「可能没有」的答案在这里收口成显式抛错。 */
function platformOf(id: string): PublishPlatform {
  const platform = publishPlatformOf(id)
  if (platform === undefined) throw new Error(`unknown platform: ${id}`)
  return platform
}

describe('平台注册表', () => {
  it('covers the platforms the reference product lists for articles and posts', () => {
    // crebee.cn 明示的图文/文章档：公众号、知乎、头条号、百家号、小红书、微博。
    expect(PUBLISH_PLATFORMS.map((platform) => platform.id)).toEqual([
      'wechat',
      'zhihu',
      'toutiao',
      'baijiahao',
      'xiaohongshu',
      'weibo',
    ])
  })

  it('assigns the clipboard mime the target editor expects', () => {
    // 富文本编辑器吃 text/html（粘贴带样式），源码编辑器吃 text/plain。
    for (const platform of PUBLISH_PLATFORMS) {
      expect(platform.mime).toBe(platform.format === 'html' ? 'text/html' : 'text/plain')
    }
  })

  it('states a char budget only where the platform enforces one', () => {
    expect(platformOf('weibo').maxChars).toBe(2000)
    expect(platformOf('xiaohongshu').maxChars).toBe(1000)
    expect(platformOf('wechat').maxChars).toBeUndefined()
  })

  it('answers undefined for an unknown id instead of guessing', () => {
    expect(publishPlatformOf('douyin')).toBeUndefined()
  })
})

describe('collectImageUrls', () => {
  it('collects every image src in order, deduplicated', () => {
    const source = '![a](images/a.png)\n正文\n![b](b.png)\n![a 又一次](images/a.png)'
    expect(collectImageUrls(source)).toEqual(['images/a.png', 'b.png'])
  })

  it('tolerates a filename with spaces and parentheses', () => {
    expect(collectImageUrls('![图](fig (1).png)')).toEqual(['fig (1).png'])
  })

  it('collects nothing when there are no images', () => {
    expect(collectImageUrls('只有文字\n\n- 一条\n')).toEqual([])
  })
})

describe('html 档（公众号 / 头条 / 百家）', () => {
  const wechat = platformOf('wechat')

  it('inlines a style on every styled shape the renderer can produce', () => {
    // 六个带 class 的形态 + 行内的 p/h/strong/a/code，缺一个在编辑器里就素一块。
    const source = [
      '# 标题一',
      '一段**加粗**、*斜体*、`行内码`与[链接](https://example.com)。',
      '> 引用一句',
      '',
      '- 第一条',
      '- 第二条',
      '',
      '```js',
      'const a = 1',
      '```',
      '',
      '![图](images/fig.png)',
      '---',
    ].join('\n')
    const html = wechat.convert(source)
    for (const shape of [
      '<h1 style="',
      '<p style="',
      '<strong style="',
      '<em style="',
      '<code style="',
      '<a style="',
      '<blockquote style="',
      '<ul style="',
      '<li style="',
      '<pre style="',
      '<img style="',
      '<hr style="',
    ]) {
      expect(html).toContain(shape)
    }
    // 转义纪律不因换目标而放松：产物是模型写的。
    expect(html).not.toContain('<b>')
  })

  it('replaces image srcs from the map and leaves unknown ones alone', () => {
    const source = '![甲](images/a.png)\n\n![乙](https://example.com/b.png)'
    const html = wechat.convert(source, new Map([['images/a.png', 'data:image/png;base64,AAAA']]))
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).toContain('src="https://example.com/b.png"')
  })

  it('emits no stylesheet dependency — every declaration rides the tag', () => {
    const html = wechat.convert('# 标\n\n一段话')
    expect(html).not.toContain('class=')
    expect(html).not.toContain('<style')
  })
})

describe('markdown 档（知乎）', () => {
  it('hands over the source verbatim', () => {
    const source = '# 题\n\n**加粗** 与 ![图](a.png)'
    expect(platformOf('zhihu').convert(source)).toBe(source)
  })
})

describe('text 档（小红书 / 微博）', () => {
  const xhs = platformOf('xiaohongshu')

  it('strips every markdown mark but keeps the information', () => {
    const text = xhs.convert([
      '# 大标题',
      '- 要点一',
      '- 要点二',
      '正文里**强调**与[链接文字](https://example.com)。',
      '> 引用',
      '```',
      '代码行',
      '```',
    ].join('\n'))
    expect(text).toContain('■ 大标题')
    expect(text).toContain('· 要点一')
    expect(text).toContain('正文里强调与链接文字。')
    expect(text).toContain('引用')
    expect(text).toContain('代码行')
    for (const mark of ['#', '**', '](', '>', '```', '- ']) {
      expect(text).not.toContain(mark)
    }
  })

  it('turns an image reference into a readable placeholder, not a url', () => {
    // 社交正文里图是单独传的：留 alt 让作者知道这里该配哪张图。
    expect(xhs.convert('![一张画布上的完整工作流](../images/flow-overview.png)')).toContain('〔配图：一张画布上的完整工作流〕')
    expect(xhs.convert('![](images/flow-overview.png)')).toContain('〔配图：flow-overview〕')
    expect(xhs.convert('前文\n![图](a.png)\n后文')).not.toContain('a.png')
  })

  it('flattens a table into space-separated columns', () => {
    const text = xhs.convert('| 平台 | 格式 |\n|------|------|\n| 公众号 | html |')
    expect(text).toContain('平台  格式')
    expect(text).not.toContain('|')
  })

  it('keeps fenced code lines and drops only the fences', () => {
    const text = xhs.convert('```\n某行\n```\n之后')
    expect(text).toContain('某行')
    expect(text).not.toContain('```')
  })
})

describe('平台注册表：官网地址（v1.95 账号绑定的一跳）', () => {
  it('每个平台都有 https 的官网 / 创作后台地址', () => {
    // 绑定的第一步是「打开官网登录」——没有地址，那条路就断了。
    for (const platform of PUBLISH_PLATFORMS) {
      expect(platform.siteUrl.startsWith('https://')).toBe(true)
    }
  })

  it('地址各不相同：六个平台六条正路，不是抄一行的占位', () => {
    const urls = PUBLISH_PLATFORMS.map((platform) => platform.siteUrl)
    expect(new Set(urls).size).toBe(urls.length)
  })
})
