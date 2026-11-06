/**
 * dsh-canvas — 一小段 markdown 渲染成 HTML（纯，零依赖）。
 *
 * 从 `artifact-view.tsx` 搬出来单独成文件，因为它碰的是**不可信内容**：这里是
 * 全插件唯一一处把产物文本变成 DOM 的地方，把这件事从组件文件里拎出来，读的人
 * 才能一眼看全「逃逸在前、建标签在后」这条纪律，测试也能只 import 它而不连带
 * 把 React 组件树拖进 node 环境。
 *
 * 支持的子集是刻意的：围栏代码、标题、hr、引用、有序/无序列表、粗斜体、行内
 * 代码、链接、段落，以及图片（v1.92，图文并茂）。子集本身由
 * `tests/client/artifact/artifact-view.spec.ts` 钉住。
 *
 * ## 图片为什么走解析器，而不是直接渲染 src
 *
 * `![说明](路径)` 里的**相对路径**（`cover.png`、`../images/fig-1.png`）在浏览器里
 * 没有基准 URL 可言——预览是弹窗里的一个 DOM，相对地址会落到宿主页面的路径上去，
 * 结果永远是破图。所以「src 原样上屏」从来不是正确答案，唯一的问题是**谁把它换写成
 * 能加载的地址**：全屏预览知道 projectId 与产物路径，能换成工作区路由的那条 URL；
 * 卡片小图两边都不知道，只能不渲染。把这件事做成参数（{@link MarkdownImageOptions.imageSrc}）
 * 而不是写死，就是让「谁有上下文谁出 URL」，纯函数这边不猜。
 *
 * 解析器返回 `undefined` 意思是「这张图渲染不了」：不画破图，也不静默吞掉——原文
 * `![…](…)` 照样以文字出现，写文档的人看得见是引用没落上，而不是少了一段。
 *
 * **安全边界不变**：标签只由本函数构造，alt 与换写后的 src 都过 {@link escapeHtml}；
 * 换写结果里出现引号、尖括号、控制字符或 `javascript:` 一类协议一律拒绝——解析器是
 * 我们自己写的，但产物内容不是，两道闸都留在构造之前。
 */

/** Escape a string into text that cannot open or close a tag. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 图片引用的换写参数（见文件头「为什么走解析器」）。 */
export interface MarkdownImageOptions {
  /**
   * 把一个图片引用的 src 换写成可加载的地址；返回 `undefined` = 这张图不渲染。
   *
   * `http(s)://` 与 `data:image/` 的 src 也会经过它——调用方通常原样放行，但**由它
   * 决定**，这里不替它开特例：特例写在两处就是「同一个东西两个来源」。
   */
  readonly imageSrc?: (src: string) => string | undefined
}

/** 没有解析器时的兜底政策：远端与内联图直接放行，相对路径没有基准 URL，不渲染。 */
function inlineFallbackSrc(src: string): string | undefined {
  return /^(https?:\/\/|data:image\/)/iu.test(src) ? src : undefined
}

/**
 * 剥掉 markdown 图片语法里那个可选的标题：`![a](cover.png "封面")` 的地址只有
 * `cover.png`。
 *
 * **只认带引号的形态**：不带引号的 `(1)` 是文件名的一部分（`fig (1).png` 是一张
 * 真图，不是标题）。剥错的代价是把一条真地址变成 404。
 */
function stripImageTitle(src: string): string {
  const trimmed = src.trim()
  const at = trimmed.search(/\s+(?:"[^"]*"|'[^']*')$/u)
  return at === -1 ? trimmed : trimmed.slice(0, at)
}

/**
 * 换写结果安检 + 构造标签。渲染不了返回 `null`，调用方把原文留作文字。
 *
 * 一条产物可以伪造出 `\u0001` 控制字符（图片占位符的哨兵，见 {@link renderMarkdown}
 * 的行内替换），安检把它连同其余控制字符一起挡下——宁可少一张图，不能让产物借
 * 解析器的手插进一个不在它引用位置上的标签。
 */
function imageTag(alt: string, src: string, options: MarkdownImageOptions | undefined): string | null {
  const resolved = (options?.imageSrc ?? inlineFallbackSrc)(src)
  if (resolved === undefined || resolved === '') return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008"<>\r\n]/u.test(resolved)) return null
  if (/^\s*(?:javascript|vbscript):/iu.test(resolved)) return null
  // data: 只认图片那一族——`data:text/html` 一类是脚本信道，不是插图。
  if (/^\s*data:/iu.test(resolved) && !/^data:image\//iu.test(resolved)) return null
  return `<img class="dsh-md-img" src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}" loading="lazy">`
}

/**
 * Render a bounded markdown subset to HTML.
 *
 * The input is artifact content — model-written, user-written, never trusted —
 * so the first transformation escapes *everything*, and every tag in the output
 * is one this function built. Supported: fenced code, headings, hr, blockquote,
 * ordered/unordered lists, bold / italic / inline code / links, paragraphs.
 * The exact subset is pinned by `tests/client/artifact/artifact-view.spec.ts`.
 *
 * @param source - the markdown text.
 * @param options - image resolution (see {@link MarkdownImageOptions}); omitted,
 *   only remote (`http(s)`) and inline (`data:image/`) images render.
 * @returns an HTML fragment, safe by construction.
 */
export function renderMarkdown(source: string, options?: MarkdownImageOptions): string {
  const stash: string[] = []
  // Fenced code goes into placeholders first, so nothing inside a fence can be
  // re-interpreted as structure. A placeholder is only honoured once and only
  // while its slot exists, so artifact content cannot forge or replay one.
  const withFences = source.replace(/```[^\n]*\n[\s\S]*?```/g, (block) => {
    const inner = block.replace(/^```[^\n]*\n/, '').replace(/```\s*$/, '')
    stash.push(`<pre class="dsh-md-code"><code>${escapeHtml(inner.replace(/\n$/, ''))}</code></pre>`)
    return `\u0000${stash.length - 1}\u0000`
  })

  // 图片引用在**转义之前**摘出来：src 里的 `&` 一旦先被转成 `&amp;`，解析器拿到的就
  // 不是调用方写的那条地址了（带查询串的 URL 会整条换错）。摘出的图片以哨兵占位，
  // 占位符同样「只兑现一次」，产物内容伪造的哨兵解不出一张真图。
  const images: string[] = []
  const imageConsumed = new Set<number>()
  // src 允许空格（中文文档里 `fig 1.png` 很常见），也允许**一层**成对括号
  // （`fig (1).png` 是一张真图）；但遇到不配对的 `)` 就收尾——一行里连着写两张图时，
  // 简单贪婪会把第二张也吃进第一张的 src。带引号的标题（`(a.png "说明")`）剥掉。
  const withImages = withFences.replace(
    /!\[([^\]]*)\]\(((?:[^()\n]|\([^()\n]*\))*)\)/g,
    (whole, alt: string, raw: string) => {
      const tag = imageTag(alt, stripImageTitle(raw), options)
      // 渲染不了也要**占一个槽**（槽里放转义后的原文）：留在原地会被后面的链接规则
      // 二次加工成 `![<a …>`，那既不是图也不是原文。
      images.push(tag ?? escapeHtml(whole))
      return `\u0001${images.length - 1}\u0001`
    },
  )

  const inline = (text: string): string =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code class="dsh-md-inline">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      // 占位符替换在转义**之后**：哨兵不受 escapeHtml 影响，标签原样落地。
      // 与围栏同一条纪律——每个槽位只兑现一次，伪造的槽号解出空 `undefined` 时原样留下。
      // eslint-disable-next-line no-control-regex
      .replace(/\u0001(\d+)\u0001/g, (slot, index: string) => {
        const at = Number(index)
        if (imageConsumed.has(at) || at >= images.length) return slot
        imageConsumed.add(at)
        return images[at] ?? slot
      })

  const out: string[] = []
  let list: 'ul' | 'ol' | undefined
  let paragraph: string[] = []
  // Each stash slot is consumed once: artifact content cannot forge a second
  // reference to a real fence, and a forged slot number resolves to nothing.
  const consumed = new Set<number>()
  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }
  const closeList = (): void => {
    if (list !== undefined) {
      out.push(`</${list}>`)
      list = undefined
    }
  }

  for (const raw of withImages.split(/\r?\n/)) {
    const line = raw.trimEnd()
    // The sentinel is NUL — a character real prose never starts a line with,
    // and one this function consumes exactly once per fence (see `consumed`).
    // eslint-disable-next-line no-control-regex
    const fence = /^\u0000(\d+)\u0000$/.exec(line)
    if (fence !== null && !consumed.has(Number(fence[1])) && Number(fence[1]) < stash.length) {
      consumed.add(Number(fence[1]))
      flushParagraph()
      closeList()
      out.push(stash[Number(fence[1])])
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      flushParagraph()
      closeList()
      const level = Math.min(heading[1].length, 4)
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushParagraph()
      closeList()
      out.push('<hr class="dsh-md-hr">')
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote !== null) {
      flushParagraph()
      closeList()
      out.push(`<blockquote class="dsh-md-quote">${inline(quote[1])}</blockquote>`)
      continue
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet !== null) {
      flushParagraph()
      if (list !== 'ul') {
        closeList()
        out.push('<ul class="dsh-md-list">')
        list = 'ul'
      }
      out.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line)
    if (ordered !== null) {
      flushParagraph()
      if (list !== 'ol') {
        closeList()
        out.push('<ol class="dsh-md-list">')
        list = 'ol'
      }
      out.push(`<li>${inline(ordered[1])}</li>`)
      continue
    }
    if (line.trim() === '') {
      flushParagraph()
      closeList()
      continue
    }
    paragraph.push(line.trim())
  }
  flushParagraph()
  closeList()
  return out.join('\n')
}
