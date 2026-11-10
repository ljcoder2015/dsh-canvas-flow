/**
 * dsh-canvas — 发布适配器（v1.93）：把一份 markdown 文本卡适配成各内容平台
 * 吃得下的格式。
 *
 * 平台清单对着 crebee.cn 的图文/文章那一档（公众号、知乎、头条号、百家号、
 * 小红书、微博）；v2.06 追加国外四家（Medium、X、LinkedIn、Dev.to）——都有
 * 公开的创作入口页，路数与国内平台一致：复制 → 跳 `publishUrl` → 自己粘贴。这里的「发布」是**一键生成每个平台的适配格式**，然后复制——
 * 真正的发由用户自己完成：跳到 `publishUrl`（各平台的发布文章页）粘贴。那些
 * 平台的发布 API 都要账号凭证，一个本地插件不该先要这些（v2.04 前试过账号
 * 绑定 + 真 Cookie 投递，用户拍板拆掉，回这条轻路）。
 *
 * 三个格式档：
 *
 * - `html`（公众号 / 头条号 / 百家号）：这些编辑器是富文本的，**不吃外部
 *   CSS**——所以每个标签都要带内联 `style`。渲染走 `renderMarkdown`（转义
 *   纪律那一套不在这里重写），再按 class→样式映射逐个换成内联属性。
 * - `markdown`（知乎）：知乎的编辑器直接吃 markdown 源。
 * - `text`（小红书 / 微博）：纯文本正文，markdown 语法剥掉；图片不是正文
 *   的一部分（平台单独传图），落成〔配图：说明〕占位。
 *
 * 纯函数、零 React 依赖，node 判据可直接钉（`tests/client/artifact/publish.spec.ts`）。
 *
 * v2.00 加了一条**读者版式**（`reader`）：每个平台一套阅读页排版（宽度、字体栈、
 * 字号、行距、段距、链接色），预览按它排——「读者看到的样子」与「粘进编辑器里的
 * 样子」不是同一件事，前者才是发布预览该对的东西。v2.01 给版式加了**帖子形态**
 * （`layout`）：小红书那种信息流笔记是「图片在上、标题、作者、正文」，不是文章页，
 * 于是它多一个 `noteOf` 把一页拆成封面 / 标题 / 正文。
 */
import { renderMarkdown } from '../viewers/markdown.ts'

/** 交付格式档。 */
export type PublishFormat = 'html' | 'markdown' | 'text'

/** 帖子形态：`note` 图在上（信息流笔记），`article` 标题加正文（文章页）。 */
export type PublishReaderLayout = 'note' | 'article'

/**
 * 平台的**读者版式**（v2.00）：预览要长得跟「读者在那家平台上看到的」一样，而
 * 读者看到的那一版跟「粘进编辑器里的那一版」不是同一件事——前者是平台自己的
 * 正文样式（宋体/苹方字号、行距、段距、链接色各不相同），后者是我们塞进剪贴板
 * 的内联样式。所以版式做成**每个平台一条数据**，预览按它排、粘贴产物不掺和。
 *
 * 这些数不是「随便好看」的：宽度＝那家平台正文栏的实际阅读宽度（手机端按手机
 * 视口），字号/行距/段距照各自的阅读页。判据钉得住的是**结构**（手机端窄、桌面
 * 端宽、字号落在人类可读区、颜色是显式色），钉不住「像不像」——那是产品判断。
 */
export interface PublishReader {
  /** 正文列宽（px）：手机端平台按手机阅读宽度，桌面端平台按正文栏宽。 */
  readonly width: number
  /** 阅读形态：只影响留白与纸张形状（手机端是窄栏白页，桌面端是一栏正文）。 */
  readonly device: 'phone' | 'desktop'
  /**
   * 帖子形态（v2.01）：**结构**差异，不是样式差异——同一个 `PublishReader` 排不出来，
   * 所以单开一档。
   *
   * - `note`：图片在**正文之上**（小红书这类信息流笔记）——封面铺顶、标题紧随、作者
   *   一行、正文在下面；读者先看图，再看字。
   * - `article`：标题 + 正文的文章页（其余五家）。
   */
  readonly layout: PublishReaderLayout
  /** 正文字体栈（平台自己那套；这是**平台事实**，所以写在数据里而不是 styles.ts）。 */
  readonly font: string
  /** 正文字号（px）。 */
  readonly size: number
  /** 行高（倍数）。 */
  readonly line: number
  /** 段距（px）。 */
  readonly gap: number
  /** 正文色。 */
  readonly color: string
  /** 标题色（阅读页的标题几乎都比正文深一档）。 */
  readonly heading: string
  /** 链接色（各平台自己的蓝 / 红 / 橙——这是最容易一眼认出「哪家」的一处）。 */
  readonly link: string
  /** 引用块：底色 / 左侧线 / 文字色。 */
  readonly quoteBg: string
  readonly quoteEdge: string
  readonly quoteText: string
  /** 代码块底色。 */
  readonly codeBg: string
  /** 插图圆角（px）：公众号多是直角，小红书那种信息流卡偏圆。 */
  readonly imageRadius: number
}

/**
 * 读者版式 → 一组 `--rd-*` CSS 变量。预览容器把变量挂在**舞台**上、正文纸继承，
 * 于是「换平台换一套排版」只是换一层变量，`styles.ts` 里只有一份正文规则。
 *
 * 键名与 `styles.ts` 的 `var(--rd-…)` 一一对应——判据扫样式表里用到的名字来对，
 * 写错一个不会报错、只会静默回落到兜底值（当年那类事故），所以必须双向钉住。
 */
export function readerVars(reader: PublishReader): Readonly<Record<string, string>> {
  return {
    '--rd-width': `${String(reader.width)}px`,
    '--rd-font': reader.font,
    '--rd-size': `${String(reader.size)}px`,
    '--rd-line': String(reader.line),
    '--rd-gap': `${String(reader.gap)}px`,
    // 半档段距（标题下、列表项间）：由主段距派生，别让每个平台各写一个数。
    '--rd-gap-sm': `${String(Math.round(reader.gap * 0.55))}px`,
    // 手机端阅读页的左右留白比桌面端窄得多——这是「像不像」的一半。
    '--rd-pad': reader.device === 'phone' ? '20px 16px 28px' : '30px 32px 34px',
    '--rd-color': reader.color,
    '--rd-heading': reader.heading,
    '--rd-link': reader.link,
    '--rd-quote-bg': reader.quoteBg,
    '--rd-quote-edge': reader.quoteEdge,
    '--rd-quote-text': reader.quoteText,
    '--rd-code-bg': reader.codeBg,
    '--rd-image-radius': `${String(reader.imageRadius)}px`,
  }
}

/** 一个内容平台的适配定义。 */
export interface PublishPlatform {
  /** 平台 id（zh/en 文案、面板 key 共用）。 */
  readonly id: string
  /** 显示名。 */
  readonly name: string
  /** 产出格式档。 */
  readonly format: PublishFormat
  /** 写进剪贴板时的 mime：富文本平台 `text/html`，其余 `text/plain`。 */
  readonly mime: 'text/html' | 'text/plain'
  /**
   * 平台的**发布文章页**（v2.04）：发布这件事由用户自己完成——这边复制，跳到
   * 这个地址粘贴。指向的是各家创作后台里「新建文章 / 发布笔记」那一页，没登录时
   * 平台自己会先跳登录页，所以不需要额外的登录入口。
   */
  readonly publishUrl: string
  /** 「拿到结果之后怎么用」的一句话。 */
  readonly hint: string
  /**
   * 读者版式（v2.00）：预览按它排——见 `PublishReader`。放在平台定义里是刻意的：
   * 新增一个平台时 TypeScript 就要求给出它的阅读版式，不会出现「新平台偷偷用
   * 别人家的字号」那种两个来源。
   */
  readonly reader: PublishReader
  /** 正文字数上限（text 档的平台有）；超了在面板上提醒，不拦。 */
  readonly maxChars?: number
  /**
   * 适配本身。`images` 是「源里的图片地址 → 已取回的 dataURI」映射——html 档
   * 的平台图片必须内联（公众号对外链图防盗链），字节由 UI 取回后传进来；
   * markdown / text 档用不上。
   */
  readonly convert: (source: string, images?: ReadonlyMap<string, string>) => string
}

/** markdown 图片引用的 src 抽取（收集用，跟渲染器同一套宽规则）。 */
const IMAGE_SRC = /!\[[^\]]*\]\(((?:[^()\n]|\([^()\n]*\))*)\)/g

/** 带 alt 捕获的那一支：纯文本档要把「图片」落成一行可读的占位。 */
const IMAGE_WITH_ALT = /!\[([^\]]*)\]\(((?:[^()\n]|\([^()\n]*\))*)\)/g

/**
 * 收集一份 markdown 里的全部图片地址（按出现顺序，去重）。
 *
 * UI 层拿它预取字节：对工作区路由的地址 fetch → blob → dataURI，喂给
 * `convert` 的 `images` 映射。http(s) 地址也收集——内联与防盗链无关，但
 * 「粘贴过去图就还在」只有内联做得到，UI 决定取不取。
 */
export function collectImageUrls(source: string): string[] {
  const seen = new Set<string>()
  for (const match of source.matchAll(IMAGE_SRC)) {
    const src = (match[1] ?? '').trim()
    if (src !== '') seen.add(src)
  }
  return [...seen]
}

// ── html 档：内联样式 ─────────────────────────────────────────────────────────
//
// 映射的键是「渲染器产出的每一个带样式的形态」。渲染器的 class 清单是封闭的
// （`dsh-md-*` 六枚，见 markdown.ts），映射表缺一个不会报错、只会让那一块在
// 公众号里素着——所以判据逐个形态验过（tests/client/artifact/publish.spec.ts）。

/** 各标签的内联样式（公众号正文那套：行距放宽、字号压一档、代码块上底色）。 */
const HTML_STYLES: Readonly<Record<string, string>> = {
  h1: 'margin:0 0 16px;font-size:20px;font-weight:600;line-height:1.5;color:#1f2328;',
  h2: 'margin:24px 0 12px;font-size:17px;font-weight:600;line-height:1.5;color:#1f2328;',
  h3: 'margin:20px 0 10px;font-size:15px;font-weight:600;line-height:1.5;color:#1f2328;',
  h4: 'margin:16px 0 8px;font-size:14px;font-weight:600;line-height:1.5;color:#1f2328;',
  p: 'margin:0 0 16px;font-size:15px;line-height:1.8;color:#333333;letter-spacing:0.5px;',
  ul: 'margin:0 0 16px;padding-left:24px;font-size:15px;line-height:1.8;color:#333333;',
  ol: 'margin:0 0 16px;padding-left:24px;font-size:15px;line-height:1.8;color:#333333;',
  li: 'margin:0 0 6px;',
  blockquote: 'margin:0 0 16px;padding:8px 14px;border-left:3px solid #42b883;background:#f7f7f7;color:#555555;font-size:14px;line-height:1.8;',
  pre: 'margin:0 0 16px;padding:12px 14px;background:#282c34;border-radius:6px;overflow-x:auto;',
  'pre-code': 'font-family:Consolas,Menlo,monospace;font-size:13px;line-height:1.6;color:#abb2bf;background:none;',
  'code-inline': 'font-family:Consolas,Menlo,monospace;font-size:13px;background:#f0f0f0;border-radius:3px;padding:2px 5px;color:#c7254e;',
  img: 'display:block;max-width:100%;height:auto;margin:0 auto 16px;border-radius:6px;',
  a: 'color:#576b95;text-decoration:none;',
  hr: 'margin:24px 0;border:none;border-top:1px solid #e5e5e5;',
  strong: 'font-weight:600;color:#1f2328;',
  em: 'font-style:italic;',
}

/** 单个带 class 的标签 → 内联样式版。按**标签名**查表；没有映射就不动它。 */
function inlineOne(tag: string, className: string, html: string): string {
  const style = HTML_STYLES[tag]
  if (style === undefined) return html
  return html.replaceAll(`<${tag} class="${className}"`, `<${tag} style="${style}"`)
}

/**
 * markdown → 带内联样式的 HTML（公众号那一路）。
 *
 * `images` 里有的 src 一律换成映射值（dataURI）；没有的字节，html 里留原
 * 地址——粘贴后能不能显示是平台的事，但至少不假装图没了。
 */
export function markdownToRichHtml(source: string, images?: ReadonlyMap<string, string>): string {
  let html = renderMarkdown(source, { imageSrc: (src) => (images?.get(src) ?? src) })
  // 先带 class 的六个形态，再是渲染器没给 class 的行内标签。
  html = inlineOne('pre', 'dsh-md-code', html)
  html = inlineOne('hr', 'dsh-md-hr', html)
  html = inlineOne('img', 'dsh-md-img', html)
  html = inlineOne('blockquote', 'dsh-md-quote', html)
  html = inlineOne('ul', 'dsh-md-list', html)
  html = inlineOne('ol', 'dsh-md-list', html)
  html = html.replaceAll('<code class="dsh-md-inline">', `<code style="${HTML_STYLES['code-inline']}">`)
  // pre 里的 code 在 pre 的样式之后补一遍（渲染器给 pre>code 是无 class 的）。
  html = html.replaceAll(/<pre style="[^"]*"><code>/g, `<pre style="${HTML_STYLES.pre}"><code style="${HTML_STYLES['pre-code']}">`)
  for (const [tag, style] of [
    ['h1', HTML_STYLES.h1],
    ['h2', HTML_STYLES.h2],
    ['h3', HTML_STYLES.h3],
    ['h4', HTML_STYLES.h4],
    ['p', HTML_STYLES.p],
    ['li', HTML_STYLES.li],
    ['strong', HTML_STYLES.strong],
    ['em', HTML_STYLES.em],
  ] as const) {
    if (style !== undefined) html = html.replaceAll(`<${tag}>`, `<${tag} style="${style}">`)
  }
  // 链接带着 href 等属性，前插而不是整标签替换。
  html = html.replaceAll('<a ', `<a style="${HTML_STYLES.a}" `)
  return html
}

// ── text 档：剥语法 ───────────────────────────────────────────────────────────

/** 行内记号（链接 / 强调 / 行内代码）→ 文字。正文与笔记标题共用这一份，别抄两遍。 */
function stripInlineMarks(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)\s]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
}

/**
 * markdown → 纯文本**行**（`markdownToPlainText` 与笔记正文共用这一份）。
 *
 * 规则只有一条：**信息留下来，记号拆掉**。标题降成「■ 前缀行」，列表换 `·`，
 * 图片不是正文（平台单独传图）落成〔配图：说明〕，链接留文字——URL 在社交
 * 正文里常常是干扰。
 */
function plainLines(source: string): string[] {
  const lines: string[] = []
  let inFence = false
  for (const raw of source.split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      lines.push(raw)
      continue
    }
    let line = raw
      .replace(IMAGE_WITH_ALT, (_whole, alt: string, src: string) => {
        const name =
          alt !== ''
            ? alt
            : (src.trim().split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '')
        return name !== '' ? `〔配图：${name}〕` : '〔配图〕'
      })
      .replace(/^#{1,6}\s+/, '■ ')
      .replace(/^>\s?/, '')
      .replace(/^[-*]\s+/, '· ')
    line = stripInlineMarks(line)
    // 小红书/微博的正文不认 markdown 表格；管道保留会碎成竖线串，压成空格分列。
    if (/^\s*\|.*\|\s*$/.test(line)) line = line.replace(/\s*\|\s*/g, '  ').replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '')
    lines.push(line)
  }
  return lines
}

/** markdown → 纯文本（小红书 / 微博那一路的复制产物）。 */
function markdownToPlainText(source: string): string {
  return plainLines(source).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** 独立成行的图片（笔记里它归封面，不进正文）。 */
const IMAGE_LINE = /^\s*!\[[^\]]*\]\(((?:[^()\n]|\([^()\n]*\))*)\)\s*$/

/** 笔记形态的一页：封面图、标题、正文。 */
export interface PublishNote {
  /** 标题：正文第一行就是标题时才取（不拿文中的小节标题冒充笔记标题）。 */
  readonly title: string
  /** 图片地址（按出现顺序，去重）——第一张作封面，其余横向排在它后面。 */
  readonly images: readonly string[]
  /** 正文：标题行与独立图片行已摘掉，其余按纯文本那套剥语法。 */
  readonly body: string
}

/**
 * markdown → **笔记形态**（v2.01，小红书）。
 *
 * 为什么不能直接拿 `markdownToPlainText` 的产物摆出来：笔记的读者第一眼看到的是
 * **一张封面图**，图片在正文之上（还常常是多图横滑），文字里只剩标题与正文。把
 * 〔配图：…〕当一行正文排在纸中间，谁都不认得那是小红书。
 *
 * 拆法与复制产物**同源**（`plainLines` 一份）：预览里看到的字，就是复制出去的字，
 * 只是封面被提到了顶上。标题只认「正文第一行」——文中的小节标题不是笔记标题。
 */
export function noteOf(source: string): PublishNote {
  const lines = source.split(/\r?\n/)
  const firstIndex = lines.findIndex((line) => line.trim() !== '')
  let title = ''
  if (firstIndex >= 0) {
    const heading = /^#{1,6}\s+(.*)$/.exec(lines[firstIndex] ?? '')
    if (heading !== null) title = stripInlineMarks((heading[1] ?? '').trim())
  }
  const rest: string[] = []
  let inFence = false
  for (const [index, line] of lines.entries()) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      rest.push(line)
      continue
    }
    if (!inFence) {
      if (index === firstIndex && title !== '') continue
      if (IMAGE_LINE.test(line)) continue
    }
    rest.push(line)
  }
  return { title, images: collectImageUrls(source), body: markdownToPlainText(rest.join('\n')) }
}

/** 平台注册表：顺序即面板里的展示顺序（公众号最先——图文创作的第一落点）。 */
export const PUBLISH_PLATFORMS: readonly PublishPlatform[] = [
  {
    id: 'wechat',
    name: '公众号',
    format: 'html',
    publishUrl: 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&lang=zh_CN&type=77',
    mime: 'text/html',
    hint: '复制后直接粘贴进公众号编辑器，样式随文走；图片已内联，不受外链限制。',
    // 公众号阅读页：苹方 17px、行高 1.75、段距宽，链接是微信蓝 #576b95。
    reader: {
      width: 375,
      device: 'phone',
      layout: 'article',
      font: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
      size: 17,
      line: 1.75,
      gap: 22,
      color: '#3e3e3e',
      heading: '#1a1a1a',
      link: '#576b95',
      quoteBg: '#f7f7f7',
      quoteEdge: '#42b883',
      quoteText: '#6b6b6b',
      codeBg: '#f3f3f3',
      imageRadius: 4,
    },
    convert: markdownToRichHtml,
  },
  {
    id: 'zhihu',
    name: '知乎',
    format: 'markdown',
    publishUrl: 'https://zhuanlan.zhihu.com/write',
    mime: 'text/plain',
    hint: '复制后在知乎回答/文章编辑器里直接粘贴，markdown 会被识别。',
    // 知乎阅读页：桌面一栏 690，正文 15px/1.68，链接是知乎蓝 #175199。
    reader: {
      width: 690,
      device: 'desktop',
      layout: 'article',
      font: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif',
      size: 15,
      line: 1.68,
      gap: 16,
      color: '#121212',
      heading: '#121212',
      link: '#175199',
      quoteBg: '#f6f6f6',
      quoteEdge: '#d3d3d3',
      quoteText: '#646464',
      codeBg: '#f6f8fa',
      imageRadius: 4,
    },
    convert: (source) => source,
  },
  {
    id: 'toutiao',
    name: '头条号',
    format: 'html',
    publishUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish',
    mime: 'text/html',
    hint: '复制后粘贴进头条号图文编辑器，样式随文走。',
    // 头条阅读页：正文 17px/1.8，链接是头条红 #f04142，插图不留圆角。
    reader: {
      width: 660,
      device: 'desktop',
      layout: 'article',
      font: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
      size: 17,
      line: 1.8,
      gap: 20,
      color: '#222222',
      heading: '#1a1a1a',
      link: '#f04142',
      quoteBg: '#f7f8fa',
      quoteEdge: '#f04142',
      quoteText: '#666666',
      codeBg: '#f5f5f5',
      imageRadius: 0,
    },
    convert: markdownToRichHtml,
  },
  {
    id: 'baijiahao',
    name: '百家号',
    format: 'html',
    publishUrl: 'https://baijiahao.baidu.com/builder/rc/edit',
    mime: 'text/html',
    hint: '复制后粘贴进百家号图文编辑器，样式随文走。',
    // 百家号阅读页：正文 16px/1.9（行距最松的一个），链接是百度蓝 #4e6ef2。
    reader: {
      width: 700,
      device: 'desktop',
      layout: 'article',
      font: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
      size: 16,
      line: 1.9,
      gap: 20,
      color: '#333333',
      heading: '#222222',
      link: '#4e6ef2',
      quoteBg: '#fafafa',
      quoteEdge: '#d9d9d9',
      quoteText: '#666666',
      codeBg: '#f5f5f5',
      imageRadius: 2,
    },
    convert: markdownToRichHtml,
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    format: 'text',
    publishUrl: 'https://creator.xiaohongshu.com/publish/publish?source=official',
    mime: 'text/plain',
    hint: '纯文本正文，先复制文字，再在发布页单独添加图片。',
    // 小红书笔记阅读页：手机窄栏、15px/1.7、留白松，图片偏圆角；形态是**图在上**
    // 的笔记（封面 → 标题 → 作者 → 正文），正文没有排版可言、只有断行。
    reader: {
      width: 375,
      device: 'phone',
      layout: 'note',
      font: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
      size: 15,
      line: 1.7,
      gap: 18,
      color: '#333333',
      heading: '#1a1a1a',
      link: '#13386c',
      quoteBg: '#f5f5f5',
      quoteEdge: '#e0e0e0',
      quoteText: '#666666',
      codeBg: '#f5f5f5',
      imageRadius: 8,
    },
    maxChars: 1000,
    convert: markdownToPlainText,
  },
  {
    id: 'weibo',
    name: '微博',
    format: 'text',
    publishUrl: 'https://weibo.com/compose/post',
    mime: 'text/plain',
    hint: '纯文本正文；超过 2000 字会被截断，建议精简后发头条文章。',
    // 微博正文：手机窄栏、16px/1.65，链接是微博橙 #eb7350。
    reader: {
      width: 375,
      device: 'phone',
      layout: 'article',
      font: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
      size: 16,
      line: 1.65,
      gap: 16,
      color: '#333333',
      heading: '#1a1a1a',
      link: '#eb7350',
      quoteBg: '#f7f7f7',
      quoteEdge: '#eb7350',
      quoteText: '#666666',
      codeBg: '#f2f2f2',
      imageRadius: 4,
    },
    maxChars: 2000,
    convert: markdownToPlainText,
  },
  {
    id: 'medium',
    name: 'Medium',
    format: 'html',
    publishUrl: 'https://medium.com/new-story',
    mime: 'text/html',
    hint: '复制后粘贴进 Medium 故事编辑器，样式随文走。',
    // Medium 阅读页：桌面 680 一栏、衬线体 20px/1.58、段距最松；链接是 Medium 绿 #1a8917。
    reader: {
      width: 680,
      device: 'desktop',
      layout: 'article',
      font: 'Georgia, "Source Serif Pro", "Times New Roman", serif',
      size: 20,
      line: 1.58,
      gap: 24,
      color: '#292929',
      heading: '#242424',
      link: '#1a8917',
      quoteBg: '#f2f2f2',
      quoteEdge: '#292929',
      quoteText: '#757575',
      codeBg: '#f2f2f2',
      imageRadius: 0,
    },
    convert: markdownToRichHtml,
  },
  {
    id: 'x',
    name: 'X',
    format: 'text',
    publishUrl: 'https://x.com/compose/post',
    mime: 'text/plain',
    hint: '短帖形态：280 字上限，超长会被截断；图片在发布页单独添加。',
    // X 帖子：手机窄栏、15px/1.5、段距最紧；链接是 X 蓝 #1d9bf0。
    reader: {
      width: 375,
      device: 'phone',
      layout: 'article',
      font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      size: 15,
      line: 1.5,
      gap: 12,
      color: '#0f1419',
      heading: '#0f1419',
      link: '#1d9bf0',
      quoteBg: '#f7f9f9',
      quoteEdge: '#1d9bf0',
      quoteText: '#536471',
      codeBg: '#f7f9f9',
      imageRadius: 16,
    },
    maxChars: 280,
    convert: markdownToPlainText,
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    format: 'text',
    publishUrl: 'https://www.linkedin.com/feed/?shareActive=true',
    mime: 'text/plain',
    hint: '复制后粘贴进 LinkedIn 动态编辑器；3000 字上限，图片在发布页单独添加。',
    // LinkedIn 动态：桌面 600 一栏、15px/1.6；链接是领英蓝 #0a66c2。
    reader: {
      width: 600,
      device: 'desktop',
      layout: 'article',
      font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      size: 15,
      line: 1.6,
      gap: 16,
      color: '#191919',
      heading: '#000000',
      link: '#0a66c2',
      quoteBg: '#f3f2ef',
      quoteEdge: '#0a66c2',
      quoteText: '#666666',
      codeBg: '#f3f2ef',
      imageRadius: 4,
    },
    maxChars: 3000,
    convert: markdownToPlainText,
  },
  {
    id: 'devto',
    name: 'Dev.to',
    format: 'markdown',
    publishUrl: 'https://dev.to/enter',
    mime: 'text/plain',
    hint: '复制后在 dev.to 文章编辑器里直接粘贴，markdown 会被识别。',
    // dev.to 阅读页：桌面 710 一栏（最宽的一栏）、17px/1.6；链接是 dev.to 紫 #3b49df。
    reader: {
      width: 710,
      device: 'desktop',
      layout: 'article',
      font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      size: 17,
      line: 1.6,
      gap: 18,
      color: '#202020',
      heading: '#0d0d0d',
      link: '#3b49df',
      quoteBg: '#f5f6f7',
      quoteEdge: '#3b49df',
      quoteText: '#404040',
      codeBg: '#f6f7f8',
      imageRadius: 4,
    },
    convert: (source) => source,
  },
]

/** 按平台 id 找适配器；未知 id 交回 `undefined`（调用方不猜）。 */
export function publishPlatformOf(id: string): PublishPlatform | undefined {
  return PUBLISH_PLATFORMS.find((platform) => platform.id === id)
}
