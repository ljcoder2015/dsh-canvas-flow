/**
 * dsh-canvas — 发布适配器（v1.93）：把一份 markdown 文本卡适配成各内容平台
 * 吃得下的格式。
 *
 * 平台清单对着 crebee.cn 的图文/文章那一档（公众号、知乎、头条号、百家号、
 * 小红书、微博），但**交付方式与它不同**：那些平台的发布 API 都要账号凭证
 * （crebee 是靠托管 Cookie 才做到真「分发」的），一个本地插件不该先要这些。
 * 这里的「发布」是**一键生成每个平台的适配格式**，然后复制/下载——粘贴进
 * 对应平台的编辑器，格式与样式就是对的。账号通道留给以后（`PublishPlatform`
 * 的形状留得住）。
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
 */
import { renderMarkdown } from '../viewers/markdown.ts'

/** 交付格式档。 */
export type PublishFormat = 'html' | 'markdown' | 'text'

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
   * 平台的**官网 / 创作后台**地址（v1.95）：账号绑定时「打开官网登录」跳这里。
   *
   * 这里刻意没有「一键登录回调」——各平台的开放平台都要备案主体与 IP 白名单，
   * 一个本地插件拿不到；能给的是一条**正确的一跳**：到官方页面登录，登录后把
   * 凭证（Cookie / Token）粘回发布页完成绑定。
   */
  readonly siteUrl: string
  /** 「拿到结果之后怎么用」的一句话。 */
  readonly hint: string
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

/**
 * markdown → 纯文本（小红书 / 微博那一路）。
 *
 * 规则只有一条：**信息留下来，记号拆掉**。标题降成「■ 前缀行」，列表换 `·`，
 * 图片不是正文（平台单独传图）落成〔配图：说明〕，链接留文字——URL 在社交
 * 正文里常常是干扰。
 */
function markdownToPlainText(source: string): string {
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
      .replace(/\[([^\]]+)\]\([^)\s]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
    // 小红书/微博的正文不认 markdown 表格；管道保留会碎成竖线串，压成空格分列。
    if (/^\s*\|.*\|\s*$/.test(line)) line = line.replace(/\s*\|\s*/g, '  ').replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '')
    lines.push(line)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** 平台注册表：顺序即面板里的展示顺序（公众号最先——图文创作的第一落点）。 */
export const PUBLISH_PLATFORMS: readonly PublishPlatform[] = [
  {
    id: 'wechat',
    name: '公众号',
    format: 'html',
    siteUrl: 'https://mp.weixin.qq.com/',
    mime: 'text/html',
    hint: '复制后直接粘贴进公众号编辑器，样式随文走；图片已内联，不受外链限制。',
    convert: markdownToRichHtml,
  },
  {
    id: 'zhihu',
    name: '知乎',
    format: 'markdown',
    siteUrl: 'https://www.zhihu.com/',
    mime: 'text/plain',
    hint: '复制后在知乎回答/文章编辑器里直接粘贴，markdown 会被识别。',
    convert: (source) => source,
  },
  {
    id: 'toutiao',
    name: '头条号',
    format: 'html',
    siteUrl: 'https://mp.toutiao.com/',
    mime: 'text/html',
    hint: '复制后粘贴进头条号图文编辑器，样式随文走。',
    convert: markdownToRichHtml,
  },
  {
    id: 'baijiahao',
    name: '百家号',
    format: 'html',
    siteUrl: 'https://baijiahao.baidu.com/',
    mime: 'text/html',
    hint: '复制后粘贴进百家号图文编辑器，样式随文走。',
    convert: markdownToRichHtml,
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    format: 'text',
    siteUrl: 'https://creator.xiaohongshu.com/',
    mime: 'text/plain',
    hint: '纯文本正文，先复制文字，再在发布页单独添加图片。',
    maxChars: 1000,
    convert: markdownToPlainText,
  },
  {
    id: 'weibo',
    name: '微博',
    format: 'text',
    siteUrl: 'https://weibo.com/',
    mime: 'text/plain',
    hint: '纯文本正文；超过 2000 字会被截断，建议精简后发头条文章。',
    maxChars: 2000,
    convert: markdownToPlainText,
  },
]

/** 按平台 id 找适配器；未知 id 交回 `undefined`（调用方不猜）。 */
export function publishPlatformOf(id: string): PublishPlatform | undefined {
  return PUBLISH_PLATFORMS.find((platform) => platform.id === id)
}
