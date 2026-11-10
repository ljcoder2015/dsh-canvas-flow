/**
 * 发布阅读预览判据（v2.00）。
 *
 * 用户的原话是「预览样式要跟平台用户看到的一致」。这一条拆成两半：
 *
 * - **版式是数据**：每个平台一套阅读页排版（宽度、字体栈、字号、行距、段距、链接色）
 *   长在 `PublishPlatform.reader` 上——新增平台时 TypeScript 就要求给出它，不会出现
 *   「新平台偷偷用别人家的字号」那种两个来源。
 * - **样式只有一份**：`styles.ts` 只描述「正文怎么排」，值全走 `--rd-*` 变量。变量名
 *   写错**不会报错**、只会静默回落到兜底值（当年那是整张画布花掉的那类事故），所以
 *   这里双向钉住：样式表用到的每个 `--rd-*` 都要被 `readerVars` 产出来，产出来的每个
 *   也都要真的被用上。
 *
 * 另外两条是「预览不许偷偷退回粘贴产物」：html 档的内联样式是给编辑器吃的，摆出来
 * 只能看见我们自己的排版意图，看不见读者那一版。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PUBLISH_PLATFORMS, noteOf, readerVars, type PublishPlatform } from '../../../src/client/artifact/publish/platforms.ts'
import { css } from '../../../src/client/ui/styles.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** 把注释剥掉：注释里写着 `platform.convert` 这类词，不能让它们当成代码证据。 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 测试里要的是确定的那一个；类型层面「可能没有」的答案在这里收口成显式抛错。 */
function platformOf(id: string): PublishPlatform {
  const platform = PUBLISH_PLATFORMS.find((entry) => entry.id === id)
  if (platform === undefined) throw new Error(`unknown platform: ${id}`)
  return platform
}

const HEX = /^#[0-9a-f]{6}$/

describe('读者版式：每个平台一套', () => {
  it('十家平台各带版式，宽度 / 字号 / 行距 / 段距都落在人类可读区', () => {
    expect(PUBLISH_PLATFORMS).toHaveLength(10)
    for (const platform of PUBLISH_PLATFORMS) {
      const reader = platform.reader
      expect(reader.width, `${platform.id} 正文宽`).toBeGreaterThanOrEqual(320)
      expect(reader.width, `${platform.id} 正文宽`).toBeLessThanOrEqual(760)
      expect(reader.size, `${platform.id} 字号`).toBeGreaterThanOrEqual(14)
      expect(reader.size, `${platform.id} 字号`).toBeLessThanOrEqual(20)
      expect(reader.line, `${platform.id} 行高`).toBeGreaterThanOrEqual(1.5)
      expect(reader.line, `${platform.id} 行高`).toBeLessThanOrEqual(2)
      expect(reader.gap, `${platform.id} 段距`).toBeGreaterThanOrEqual(12)
      // 衬线与无衬线都收（Medium 的正文是衬线体）：结尾是 serif 系即合格。
      expect(reader.font, `${platform.id} 字体栈`).toMatch(/serif$/)
      expect(['phone', 'desktop'], `${platform.id} 形态`).toContain(reader.device)
    }
  })

  it('手机端窄、桌面端宽：两档不许各写各的', () => {
    const phones = PUBLISH_PLATFORMS.filter((platform) => platform.reader.device === 'phone')
    const desktops = PUBLISH_PLATFORMS.filter((platform) => platform.reader.device === 'desktop')
    // 两端都要有：只剩一种形态说明 device 这个字段没起作用。
    expect(phones.length).toBeGreaterThan(0)
    expect(desktops.length).toBeGreaterThan(0)
    const widestPhone = Math.max(...phones.map((platform) => platform.reader.width))
    const narrowestDesktop = Math.min(...desktops.map((platform) => platform.reader.width))
    expect(widestPhone).toBeLessThanOrEqual(414)
    expect(narrowestDesktop).toBeGreaterThanOrEqual(600)
    expect(widestPhone).toBeLessThan(narrowestDesktop)
  })

  it('链接色是各家的那一个：十平台两两不同（抄一个就出现两家同色）', () => {
    const links = PUBLISH_PLATFORMS.map((platform) => platform.reader.link)
    for (const link of links) expect(link).toMatch(HEX)
    expect(new Set(links).size).toBe(links.length)
    // 认得出的六枚（微信蓝 / 头条红 / 微博橙 / Medium 绿 / X 蓝 / 领英蓝）钉成事实。
    expect(platformOf('wechat').reader.link).toBe('#576b95')
    expect(platformOf('toutiao').reader.link).toBe('#f04142')
    expect(platformOf('weibo').reader.link).toBe('#eb7350')
    expect(platformOf('medium').reader.link).toBe('#1a8917')
    expect(platformOf('x').reader.link).toBe('#1d9bf0')
    expect(platformOf('linkedin').reader.link).toBe('#0a66c2')
  })

  it('颜色全是不带透明度的显式色，插图圆角是整数', () => {
    for (const platform of PUBLISH_PLATFORMS) {
      const reader = platform.reader
      const colours = {
        color: reader.color,
        heading: reader.heading,
        link: reader.link,
        quoteBg: reader.quoteBg,
        quoteEdge: reader.quoteEdge,
        quoteText: reader.quoteText,
        codeBg: reader.codeBg,
      }
      for (const [name, value] of Object.entries(colours)) {
        expect(value, `${platform.id}.${name}`).toMatch(HEX)
      }
      expect(Number.isInteger(reader.imageRadius), `${platform.id} 插图圆角`).toBe(true)
      expect(reader.imageRadius, `${platform.id} 插图圆角`).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('readerVars：版式 → 一组 CSS 变量', () => {
  const vars = readerVars(platformOf('wechat').reader)

  it('长度带 px、行高是纯数字、留白是三段', () => {
    expect(vars['--rd-width']).toBe('375px')
    expect(vars['--rd-size']).toBe('17px')
    expect(vars['--rd-gap']).toBe('22px')
    // 半档段距由主段距派生（不是每个平台各写一个数）：round(22 × 0.55) = 12。
    expect(vars['--rd-gap-sm']).toBe('12px')
    expect(vars['--rd-line']).toMatch(/^\d+(?:\.\d+)?$/)
    expect(vars['--rd-pad']).toMatch(/^\d+px \d+px \d+px$/)
    expect(vars['--rd-font']).toBe(platformOf('wechat').reader.font)
  })

  it('手机端左右留白比桌面端窄（窄栏纸的边距再套桌面那套就挤不出字了）', () => {
    const sidePad = (pad: string): number => Number((pad.split(' ')[1] ?? '').replace('px', ''))
    const phone = vars['--rd-pad'] ?? ''
    const desktop = readerVars(platformOf('zhihu').reader)['--rd-pad'] ?? ''
    expect(sidePad(phone)).toBeLessThan(sidePad(desktop))
  })

  it('每个平台每个键都是非空字符串（undefined 挂到 style 上会静默丢掉整条声明）', () => {
    for (const platform of PUBLISH_PLATFORMS) {
      for (const [name, value] of Object.entries(readerVars(platform.reader))) {
        expect(typeof value, `${platform.id} ${name}`).toBe('string')
        expect(value, `${platform.id} ${name}`).not.toBe('')
      }
    }
  })
})

describe('样式表 ↔ 版式数据：变量名双向对齐', () => {
  // 名字写错不会报错，只会让那条声明在计算值阶段被丢掉——看着像接了平台、其实是写死的一档。
  const used = [...new Set([...css.matchAll(/var\((--rd-[a-z0-9-]+)/g)].map((match) => match[1] ?? ''))]
  const produced = Object.keys(readerVars(PUBLISH_PLATFORMS[0]!.reader))

  it('样式表确实在吃这套变量（守卫不许空转）', () => {
    expect(used.length).toBeGreaterThanOrEqual(12)
  })

  it('样式表用到的每个 --rd-* 都真的被产出来', () => {
    expect(used.filter((name) => !produced.includes(name))).toEqual([])
  })

  it('产出来的每个 --rd-* 都真的被用上（数据加了样式没接＝白加）', () => {
    expect(produced.filter((name) => !used.includes(name))).toEqual([])
  })

  it('正文纸有自己的一条规则块，且挂在平台上而不是主题上', () => {
    expect(css).toContain('.dsh-canvas-publish-read{')
    expect(css).toContain('.dsh-canvas-publish-stage{')
    // 白纸是文档预览语义：纸底色写死白，不许跟主题令牌走（暗色下也该是白的）。
    expect(css).toMatch(/\.dsh-canvas-publish-read\{[^}]*background:#ffffff/)
  })
})

describe('笔记形态（v2.01）：小红书是「图在上」', () => {
  it('小红书是 note，其余九家是文章页（形态是结构，不是样式）', () => {
    expect(platformOf('xiaohongshu').reader.layout).toBe('note')
    const articles = PUBLISH_PLATFORMS.filter((platform) => platform.reader.layout === 'article')
    expect(articles.map((platform) => platform.id).sort()).toEqual([
      'baijiahao',
      'devto',
      'linkedin',
      'medium',
      'toutiao',
      'wechat',
      'weibo',
      'x',
      'zhihu',
    ])
  })

  describe('noteOf：一页拆成封面 / 标题 / 正文', () => {
    const doc = [
      '# 一条笔记的标题',
      '',
      '![](images/cover.png)',
      '',
      '第一段，正文从这里开始，**加粗**要拆掉。',
      '',
      '![](images/second.png)',
      '',
      '第二段。',
    ].join('\n')

    it('标题取正文第一行的标题，图片按出现顺序收集', () => {
      const note = noteOf(doc)
      expect(note.title).toBe('一条笔记的标题')
      expect(note.images).toEqual(['images/cover.png', 'images/second.png'])
    })

    it('正文摘掉标题行与独立图片行，行内记号照纯文本那套剥', () => {
      const note = noteOf(doc)
      expect(note.body).toBe('第一段，正文从这里开始，加粗要拆掉。\n\n第二段。')
      // 图片归封面，不许在正文里留〔配图：…〕——那一行在笔记里读起来像乱码。
      expect(note.body).not.toContain('〔配图')
    })

    it('标题只认第一行：文中的小节标题不许冒充笔记标题', () => {
      const note = noteOf('开头一句。\n\n## 小节标题\n\n正文。')
      expect(note.title).toBe('')
      // 没有标题就空着，不拿正文第一句凑。
      expect(note.body).toContain('开头一句。')
      expect(note.body).toContain('■ 小节标题')
    })

    it('正文中间的行内图片仍留在正文里（只有独立成行的才归封面）', () => {
      const note = noteOf('看这张：![](a.png) 是流程图。')
      expect(note.images).toEqual(['a.png'])
      expect(note.body).toContain('〔配图：a〕')
    })

    it('没有图就没有封面（不画空框），空文档也不炸', () => {
      expect(noteOf('# 只有字\n\n正文。').images).toEqual([])
      expect(noteOf('')).toEqual({ title: '', images: [], body: '' })
    })
  })

  it('样式表有一套笔记规则，封面贴纸边（不留 --rd-pad 那圈留白）', () => {
    expect(css).toContain('.dsh-canvas-publish-read.dsh-canvas-publish-note{')
    expect(css).toMatch(/\.dsh-canvas-publish-read\.dsh-canvas-publish-note\{padding:8px/)
    // 多图横滑：吸附滚动，跟手机上翻笔记一致。
    expect(css).toMatch(/\.dsh-canvas-publish-note-gallery\{[^}]*scroll-snap-type:x mandatory/)
    expect(css).toMatch(/\.dsh-canvas-publish-note-cover\{[^}]*scroll-snap-align:start/)
  })

  it('页面里封面排在正文之前（图在上），且由 reader.layout 分流', () => {
    const page = code(read('../../../src/client/artifact/publish/publish-page.tsx'))
    expect(page).toMatch(/platform\.reader\.layout === 'note'/)
    const gallery = page.indexOf('dsh-canvas-publish-note-gallery"')
    const body = page.indexOf('dsh-canvas-publish-note-body"')
    expect(gallery).toBeGreaterThan(-1)
    expect(body).toBeGreaterThan(gallery)
    // 封面走预览用的工作区地址（与正文插图同一个解析器），不另开一条取图路径。
    expect(page).toMatch(/previewImages\.get\(src\) \?\? src/)
  })
})

describe('预览走渲染器的语义标签，不复用粘贴产物', () => {
  const page = code(read('../../../src/client/artifact/publish/publish-page.tsx'))

  it('纸里的 HTML 是 renderMarkdown 的产出，不是 platform.convert 的内联样式版', () => {
    const start = page.indexOf('const readable')
    expect(start).toBeGreaterThan(-1)
    const definition = page.slice(start, page.indexOf('const copy'))
    expect(definition).toMatch(/renderMarkdown\(/)
    expect(definition, '预览不该用适配产物——那是给编辑器吃的内联样式').not.toMatch(/platform\.convert/)
    expect(page).toMatch(/dangerouslySetInnerHTML=\{\{ __html: readable \}\}/)
  })

  it('阅读纸挂的是当前平台的版式变量', () => {
    expect(page).toMatch(/dsh-canvas-publish-stage" style=\{readerVars\(platform\.reader\)/)
    expect(page).toMatch(/className="dsh-canvas-publish-read"/)
  })

  it('纯文本档按空行切段（逐字摆 <pre> 不像任何平台的正文）', () => {
    expect(page).toMatch(/split\(\/\\n\{2,\}\//)
    expect(page).toMatch(/dsh-canvas-publish-para/)
  })

  it('字数按「读者看到的字」数：纯文本档数适配产物，其余数原文', () => {
    expect(page).toMatch(/platform\.format === 'text' \? adapted\.length : \(source\?\.length \?\? 0\)/)
  })
})
