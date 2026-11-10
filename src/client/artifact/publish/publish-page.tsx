/**
 * dsh-canvas — 发布页（v1.95 独立页面，v2.04 回到轻路）。
 *
 * 从 v1.93 的浮层面板改成**独立页面**：左栏平台、右栏编辑器、顶部一条导航。
 * 页面只做三件事：
 *
 * - **适配**：一份 markdown 原文，按当前平台转换成它编辑器吃得下的格式（纯函数
 *   全在 `platforms.ts`，这里只喂字节与状态）。
 * - **预览**：按那家平台的**读者版式**渲染（`platform.reader`：宽度、字体栈、
 *   字号、行距、链接色都是它阅读页的那一套——预览对的是「读者看到的那一版」，
 *   不是「粘进编辑器的内联样式版」；小红书那类笔记的形态是**图在上**，由
 *   `reader.layout === 'note'` 分出来：封面 → 标题 → 正文）。
 * - **交付**：复制；真正的「发」由用户自己完成——点「前往平台
 *   发布」跳到 `platform.publishUrl`（那家平台的发布文章页），粘贴即可。账号绑定
 *   与真 Cookie 投递（v1.96–v1.99）按用户要求整体拆除（v2.04）：那两件事要么要
 *   凭证、要么踩在平台内部接口上，换来的自动化撑不住平台收紧校验，不值。
 *
 * 源文档改的是 markdown 原文——原文是所有平台适配的共同来源，改一次六个平台
 * 一起变。
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ArtifactModalBridge } from '../chrome.tsx'
import type { Translate } from '../../ui/locales.ts'
import { useArtifactPayload } from '../use-artifact-payload.ts'
import { markdownImageSrc } from '../viewers/markdown-image.ts'
import { renderMarkdown } from '../viewers/markdown.ts'
import { PUBLISH_PLATFORMS, collectImageUrls, noteOf, publishPlatformOf, readerVars } from './platforms.ts'

/** 取一张图：工作区路由（或外链）→ dataURI。失败交回 `undefined`，由调用方计数。 */
async function fetchAsDataUri(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url)
    if (!response.ok) return undefined
    const blob = await response.blob()
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined)
      reader.onerror = () => resolve(undefined)
      reader.readAsDataURL(blob)
    })
  } catch {
    return undefined
  }
}

/**
 * 任意位图 → PNG（canvas 一遍，保住透明度）。
 *
 * 只给剪贴板不直认的类型兜底用——**GIF 绝不能走这里**：canvas 画的是当前帧，
 * 动画会成静帧（v2.05 第一版统一转 PNG，用户立刻报「GIF 变静态」）。
 */
function blobToPng(blob: Blob): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')?.drawImage(img, 0, 0)
      canvas.toBlob((out) => resolve(out ?? undefined), 'image/png')
      URL.revokeObjectURL(objectUrl)
    }
    img.onerror = () => resolve(undefined)
    img.src = objectUrl
  })
}

/** 把一份 markdown 里的图片全部取成 dataURI；返回映射与取不到的张数。 */
async function inlineAllImages(
  source: string,
  projectId: string,
  file: string,
): Promise<{ images: ReadonlyMap<string, string>; missed: number }> {
  const images = new Map<string, string>()
  let missed = 0
  for (const src of collectImageUrls(source)) {
    const url = markdownImageSrc(projectId, file, src)
    if (url === undefined) continue
    if (url.startsWith('data:image/')) {
      images.set(src, url)
      continue
    }
    const dataUri = await fetchAsDataUri(url)
    if (dataUri === undefined) missed += 1
    else images.set(src, dataUri)
  }
  return { images, missed }
}

export interface PublishPageProps {
  readonly projectId: string
  readonly cardId: string
  readonly bridge: ArtifactModalBridge
  readonly t: Translate
  /** 回到画布。 */
  readonly onClose: () => void
}

/** 发布页：左平台、右编辑器、顶部导航。 */
export function PublishPage({ projectId, cardId, bridge, t, onClose }: PublishPageProps) {
  const { view, error } = useArtifactPayload({ projectId, cardId, bridge, t })
  const file = view?.file ?? ''

  // 原文（markdown 草稿）：payload 到了才填；之后归编辑器自己。
  const [source, setSource] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (view !== undefined) setSource(view.text)
  }, [view])

  const [platformId, setPlatformId] = useState('wechat')
  const [editingSource, setEditingSource] = useState(false)
  const [inlineImages, setInlineImages] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [imagesNote, setImagesNote] = useState(0)

  const platform = publishPlatformOf(platformId) ?? PUBLISH_PLATFORMS[0]!

  // ── 适配与预览 ────────────────────────────────────────────────────────────
  // 预览用工作区 URL（图能直接显示）；复制 / 下载另取一次 dataURI（自足）。
  const previewImages = useMemo(() => {
    const map = new Map<string, string>()
    if (source === undefined) return map
    for (const src of collectImageUrls(source)) {
      map.set(src, markdownImageSrc(projectId, file, src) ?? src)
    }
    return map
  }, [source, projectId, file])

  /** 当前平台、当前原文的适配结果（复制 / 下载 / 投递用，不是预览用）。 */
  const adapted = useMemo(
    () => (source === undefined ? '' : platform.convert(source, previewImages)),
    [platform, source, previewImages],
  )

  /**
   * 预览正文（v2.00）：走渲染器的**语义标签**，样式全交给平台皮肤。
   *
   * 刻意不用 `adapted`——html 档的产物是「塞进公众号编辑器的内联样式」，把它原样
   * 摆出来只是把我们自己的排版意图再念一遍；读者看到的是平台**用自己的样式**再排
   * 一遍的那一版（字号、行距、链接色都换成它的）。预览要对的正是后者。
   */
  const readable = useMemo(
    () => (source === undefined ? '' : renderMarkdown(source, { imageSrc: (src) => previewImages.get(src) ?? src })),
    [source, previewImages],
  )

  /**
   * 笔记形态（v2.01）：小红书这类信息流笔记的读者先看到**封面图**，再看到标题与正文。
   * 拆页交给 `noteOf`（纯函数，与复制产物同源），这里只管把三段摆对位置。
   */
  const note = useMemo(() => (source === undefined ? undefined : noteOf(source)), [source])

  const copy = useCallback(async () => {
    if (source === undefined) return
    setBusy(true)
    setCopyFailed(false)
    setImagesNote(0)
    let text = platform.convert(source, previewImages)
    if (inlineImages) {
      const { images, missed } = await inlineAllImages(source, projectId, file)
      text = platform.convert(source, images)
      setImagesNote(missed)
    }
    try {
      if (platform.mime === 'text/html') {
        // 富文本剪贴板：同时给一份纯文本兜底（编辑器不收 html 时也不至于空手）。
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([text], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ])
      } else {
        await navigator.clipboard.writeText(text)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopyFailed(true)
    }
    setBusy(false)
  }, [source, platform, previewImages, inlineImages, projectId, file])

  /** 前往平台的发布文章页（v2.04）：复制的事用户自己做，这边把路铺到编辑器门口。 */
  const goPublish = useCallback(() => {
    window.open(platform.publishUrl, '_blank', 'noopener,noreferrer')
  }, [platform])

  // ── 正文图片条（v2.05）────────────────────────────────────────────────────
  // 平台编辑器的粘贴白名单**不收正文内嵌的图片**（data: URI 一律剥掉），所以复制的
  // 正文带不过去图是平台的规矩、不是复制环节的错。位图粘贴是另一条路：把图片当成
  // 一次独立的图片粘贴写进剪贴板，所有编辑器都收，平台会自己传进自家图床。这里给
  // 每张图一枚复制钮，用户去编辑器对应位置贴。
  const [imageCopied, setImageCopied] = useState<string | undefined>(undefined)
  const copyImage = useCallback(async (src: string) => {
    const url = markdownImageSrc(projectId, file, src) ?? src
    if (url === '') return
    const write = async (payload: Blob, mime: string): Promise<boolean> => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ [mime]: payload })])
        return true
      } catch {
        return false
      }
    }
    try {
      const response = await fetch(url)
      if (!response.ok) return
      const blob = await response.blob()
      // png / jpeg / gif 是剪贴板**原类型直写**的三档——gif 直写才留得住动画。其余
      // 类型（webp 等）转 PNG 兜底；直写被环境拒了也退回 PNG 再试一次。
      const direct =
        blob.type === 'image/png' || blob.type === 'image/gif' || blob.type === 'image/jpeg'
      let wrote = direct ? await write(blob, blob.type) : false
      if (!wrote) {
        const png = await blobToPng(blob)
        if (png !== undefined) wrote = await write(png, 'image/png')
      }
      if (!wrote) return
      setImageCopied(src)
      window.setTimeout(() => setImageCopied(undefined), 1600)
    } catch {
      // 取图失败：按钮停在原样，用户可以再点（与正文复制的失败路径不同，
      // 这里没有全局提示条——单张图的事不值得打断整页）。
    }
  }, [projectId, file])

  // Esc 关页面。发布页盖在画布上，这条键得在这里接住，不能让画布那边同时收到
  // （发布页底下没有别的层可退）。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // 字数：纯文本档数的是**适配产物**（剥完语法就是读者看到的字数）；html 档数原文
  // ——数 HTML 长度会把标签与内联样式算进去，那个数没有意义。
  const chars = platform.format === 'text' ? adapted.length : (source?.length ?? 0)
  const overLimit = platform.maxChars !== undefined && chars > platform.maxChars
  // 正文里的图片（按出现顺序、已去重）：图片条的来源。与平台无关——知乎的 markdown
  // 原样档、小红书的笔记封面，图同样要靠逐张粘贴进编辑器。
  const docImages = useMemo(() => (source === undefined ? [] : collectImageUrls(source)), [source])

  /**
   * 预览纸：一个舞台（挂 `--rd-*` 变量）+ 一张正文纸。
   *
   * 三档：**笔记**（v2.01，图在上——封面 → 标题 → 作者 → 正文）、纯文本（按空行切段，
   * 让读者那一版也像样；`<pre>` 逐字摆出来的是一坨等宽字，不像任何平台的正文）、
   * 语义标签（渲染器的 HTML，样式全交给平台皮肤）。`white-space:pre-wrap` 保住段内的
   * 单换行。
   */
  const paragraphs = (text: string) =>
    text
      .split(/\n{2,}/)
      .filter((para) => para.trim() !== '')
      .map((para, index) => (
        <p className="dsh-canvas-publish-para" key={String(index)}>
          {para}
        </p>
      ))

  const paper =
    platform.reader.layout === 'note' && note !== undefined ? (
      <div className="dsh-canvas-publish-read dsh-canvas-publish-note">
        {note.images.length > 0 ? (
          <div className="dsh-canvas-publish-note-gallery-wrap">
            <div className="dsh-canvas-publish-note-gallery">
              {note.images.map((src) => (
                <img key={src} className="dsh-canvas-publish-note-cover" src={previewImages.get(src) ?? src} alt="" />
              ))}
            </div>
            {note.images.length > 1 ? (
              <span className="dsh-canvas-publish-note-count">
                {t('canvas.publish.page.noteImages', { count: note.images.length })}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="dsh-canvas-publish-note-body">
          {note.title !== '' ? <h1 className="dsh-canvas-publish-note-title">{note.title}</h1> : null}
          {paragraphs(note.body)}
        </div>
      </div>
    ) : platform.format === 'text' ? (
      <div className="dsh-canvas-publish-read">{paragraphs(adapted)}</div>
    ) : (
      // 这份 HTML 出自自家渲染器（转义纪律同一套，markdown.ts），与预览器同级的信任。
      <div className="dsh-canvas-publish-read" dangerouslySetInnerHTML={{ __html: readable }} />
    )

  /** 编辑区两档：源文（textarea）／阅读预览（按平台版式排的那张纸）。 */
  const body = editingSource ? (
    <textarea
      className="dsh-canvas-publish-source"
      value={source ?? ''}
      spellCheck={false}
      onChange={(event) => setSource(event.target.value)}
    />
  ) : (
    <div className="dsh-canvas-publish-stage" style={readerVars(platform.reader) as CSSProperties}>
      <p className="dsh-canvas-publish-skin">
        {platform.reader.device === 'phone'
          ? t('canvas.publish.page.skinPhone', { width: platform.reader.width })
          : t('canvas.publish.page.skinDesktop', { width: platform.reader.width })}
      </p>
      {paper}
    </div>
  )

  return (
    <div className="dsh-canvas-publish-page" role="dialog" aria-label={t('canvas.publish.page.title')}>
      <header className="dsh-canvas-publish-nav">
        <button type="button" className="dsh-canvas-chipbtn" onClick={onClose}>
          ← {t('canvas.publish.page.back')}
        </button>
        <span className="dsh-canvas-publish-nav-title">{t('canvas.publish.page.title')}</span>
        <span className="dsh-canvas-publish-nav-file">{file}</span>
        <span className="dsh-canvas-spacer" />
        <button type="button" className="dsh-canvas-chipbtn" data-primary="true" disabled={busy || source === undefined} onClick={() => void copy()}>
          {busy ? t('canvas.publish.imageBusy') : copied ? t('canvas.publish.copied') : t('canvas.publish.copy')}
        </button>
        <button type="button" className="dsh-canvas-chipbtn" data-primary="true" onClick={goPublish}>
          {t('canvas.publish.page.goPublish')}
        </button>
      </header>

      <div className="dsh-canvas-publish-body">
        <aside className="dsh-canvas-publish-side">
          <div className="dsh-canvas-publish-side-title">{t('canvas.publish.page.platforms')}</div>
          {PUBLISH_PLATFORMS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === platform.id ? 'dsh-canvas-publish-side-item is-on' : 'dsh-canvas-publish-side-item'}
              aria-pressed={entry.id === platform.id}
              onClick={() => setPlatformId(entry.id)}
            >
              <span>{entry.name}</span>
            </button>
          ))}
        </aside>

        <main className="dsh-canvas-publish-main">
          <div className="dsh-canvas-publish-toolbar">
            <span className="dsh-canvas-publish-platform-name">{platform.name}</span>
            <span className="dsh-canvas-publish-chars">{t('canvas.publish.chars', { count: chars })}</span>
            {overLimit ? <span className="dsh-canvas-publish-over">{t('canvas.publish.tooLong', { max: platform.maxChars })}</span> : null}
            <span className="dsh-canvas-publish-hint">{t('canvas.publish.page.goPublishHint')}</span>
            <span className="dsh-canvas-spacer" />
            {platform.format === 'html' ? (
              <label className="dsh-canvas-publish-inline">
                <input type="checkbox" checked={inlineImages} onChange={(event) => setInlineImages(event.target.checked)} />
                {t('canvas.publish.inlineImages')}
              </label>
            ) : null}
            <button
              type="button"
              className="dsh-canvas-chipbtn"
              data-primary={editingSource ? undefined : 'true'}
              aria-pressed={!editingSource}
              onClick={() => setEditingSource(false)}
            >
              {t('canvas.publish.preview')}
            </button>
            <button
              type="button"
              className="dsh-canvas-chipbtn"
              data-primary={editingSource ? 'true' : undefined}
              aria-pressed={editingSource}
              onClick={() => setEditingSource(true)}
            >
              {t('canvas.publish.page.source')}
            </button>
          </div>
          {docImages.length > 0 ? (
            <div className="dsh-canvas-publish-images">
              <span className="dsh-canvas-publish-images-hint">{t('canvas.publish.page.imagesHint')}</span>
              <div className="dsh-canvas-publish-images-row">
                {docImages.map((src) => (
                  <figure key={src} className="dsh-canvas-publish-image">
                    <img src={previewImages.get(src) ?? src} alt="" />
                    <button type="button" className="dsh-canvas-chipbtn" onClick={() => void copyImage(src)}>
                      {imageCopied === src ? t('canvas.publish.copied') : t('canvas.publish.page.imageCopy')}
                    </button>
                  </figure>
                ))}
              </div>
            </div>
          ) : null}
          <div className="dsh-canvas-publish-editor">
            {error !== '' ? <p className="dsh-canvas-publish-note">{error}</p> : source === undefined ? <p className="dsh-canvas-publish-note">{t('canvas.publish.page.loading')}</p> : body}
          </div>
          {imagesNote > 0 ? <p className="dsh-canvas-publish-note dsh-canvas-publish-foot-note">{t('canvas.publish.imagesFailed', { count: imagesNote })}</p> : null}
          {copyFailed ? <p className="dsh-canvas-publish-note dsh-canvas-publish-foot-note">{t('canvas.publish.failed')}</p> : null}
        </main>
      </div>

    </div>
  )
}
