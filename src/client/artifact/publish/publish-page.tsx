/**
 * dsh-canvas — 发布页（v1.95）。
 *
 * 从 v1.93 的浮层面板改成**独立页面**：左栏平台、右栏编辑器、顶部一条导航。
 * 导航里的两件事是这一版的重点：
 *
 * - **账号**：当前平台用哪个账号（一个平台可绑多个，账号池在 `accounts.ts`），
 *   以及「账号管理」——满屏一层的管理面。绑定是**真实绑定**（v1.97）：点「绑定账号」
 *   宿主拉起登录浏览器进入平台登录页，登录后经 CDP 自动抓取该平台的真 Cookie 落表
 *   （轮询在 `real-bind.ts` 那条 HTTP 通道上），登录本身永远是人做的。已绑账号可
 *   编辑（改名 / 手动换凭证）、可解绑。凭证只存本机浏览器。
 * - **交付**：复制 / 下载。复制时把图片取成 dataURI 内联（公众号对外链图防盗链），
 *   下载给一份自足的 `.html`。**发布到平台**（v1.98）：选中账号后一键投递——正文
 *   交宿主，宿主带账号的真 Cookie 调平台接口；微博 / 知乎直接上线，公众号写入
 *   草稿箱（发表是平台强制的最后一步），其余平台没有通道，按钮按平台隐藏。
 *
 * 编辑器两档：**预览**按当前平台的适配结果渲染（HTML 档落白纸、知乎渲染 markdown、
 * 纯文本逐字看），**源文**改 markdown 原文——原文是所有平台适配的共同来源，改一次
 * 六个平台一起变。适配本身仍是 `platforms.ts` 的纯函数，这里只喂字节与状态。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ArtifactModalBridge } from '../chrome.tsx'
import type { Translate } from '../../ui/locales.ts'
import { useArtifactPayload } from '../use-artifact-payload.ts'
import { markdownImageSrc } from '../viewers/markdown-image.ts'
import { renderMarkdown } from '../viewers/markdown.ts'
import {
  accountById,
  accountsOf,
  bindAccount,
  loadAccounts,
  maskCredential,
  removeAccount,
  saveAccounts,
  updateAccount,
  type PublishAccount,
} from './accounts.ts'
import { PUBLISH_PLATFORMS, collectImageUrls, markdownToRichHtml, publishPlatformOf } from './platforms.ts'
import { checkRealBind, deliverPost, startRealBind } from './real-bind.ts'
import { upstreamOf, type DeliverPayload } from '../../../core/publish/upstream.ts'

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
  const [delivering, setDelivering] = useState(false)
  const [deliverNote, setDeliverNote] = useState<{ ok: boolean; message: string; url?: string } | undefined>(undefined)

  // ── 账号池 ────────────────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<readonly PublishAccount[]>(() => loadAccounts(window.localStorage))
  // 轮询回调里要用当下这份账号表铸新账号，经 ref 读（闭包里的 state 会过期）。
  const accountsRef = useRef(accounts)
  accountsRef.current = accounts
  const [selectedBy, setSelectedBy] = useState<Record<string, string>>({})
  const [manageOpen, setManageOpen] = useState(false)
  const [bindingFor, setBindingFor] = useState('')
  const [editingAccount, setEditingAccount] = useState('')
  const [bindName, setBindName] = useState('')
  const [bindCredential, setBindCredential] = useState('')
  /** 真实绑定进行中：哪个平台、浏览器是否已就绪、给用户看的一句话（错误 / 超时）。 */
  const [binding, setBinding] = useState<{ platformId: string; waiting: boolean; message: string } | undefined>(undefined)

  const platform = publishPlatformOf(platformId) ?? PUBLISH_PLATFORMS[0]!
  const platformAccounts = accountsOf(accounts, platform.id)
  const currentAccount =
    accountById(platformAccounts, selectedBy[platform.id] ?? '') ?? platformAccounts[0]
  /** 这个平台有没有真实投递通道（微博 / 知乎 / 公众号有，其余藏按钮明示走复制粘贴）。 */
  const upstream = upstreamOf(platform.id)

  const commitAccounts = (next: readonly PublishAccount[]) => {
    setAccounts(next)
    saveAccounts(window.localStorage, next)
  }

  const openBindForm = (id: string, account: PublishAccount) => {
    setBindingFor(id)
    setEditingAccount(account.id)
    setBindName(account.name)
    setBindCredential(account.credential)
  }

  const closeBindForm = () => {
    setBindingFor('')
    setEditingAccount('')
    setBindName('')
    setBindCredential('')
  }

  /** 编辑已绑账号的备注与凭证（一键绑定不走表单，这是它唯一的用途）。 */
  const submitEdit = () => {
    if (editingAccount === '') return
    commitAccounts(updateAccount(accounts, editingAccount, { name: bindName, credential: bindCredential }))
    closeBindForm()
  }

  /**
   * 真实绑定：让宿主打开登录浏览器，登录态一到就自动落表。
   *
   * 「自动」到什么程度：start（开浏览器）→ 每 2.5 秒 check 一次目标平台的 Cookie
   * 域 → 检测到登录态即 `bindAccount` 落表并选中——中间只有「登录」这一步是人做的。
   * 轮询上限 96 次（约四分钟）：超过就停下来给一句人话，别让一轮无声的轮询挂着。
   */
  const startBind = useCallback((id: string) => {
    setBinding({ platformId: id, waiting: false, message: '' })
    void startRealBind(id)
      .then(() => setBinding({ platformId: id, waiting: true, message: '' }))
      .catch((error: unknown) => {
        setBinding({
          platformId: id,
          waiting: false,
          message: error instanceof Error ? error.message : String(error),
        })
      })
  }, [])

  const cancelBind = useCallback(() => setBinding(undefined), [])

  useEffect(() => {
    const id = binding?.platformId
    if (binding === undefined || !binding.waiting || id === undefined) return
    let attempts = 0
    let stopped = false
    const timer = window.setInterval(() => {
      attempts += 1
      if (stopped) return
      void checkRealBind(id)
        .then((check) => {
          if (stopped) return
          if (check.count > 0 && check.cookie !== '') {
            const next = bindAccount(accountsRef.current, id, check.cookie, Date.now())
            commitAccounts(next)
            const added = next[next.length - 1]
            if (added !== undefined) setSelectedBy((current) => ({ ...current, [id]: added.id }))
            setBinding(undefined)
          } else if (attempts >= 96) {
            setBinding({ platformId: id, waiting: false, message: t('canvas.publish.page.bindTimeout') })
          }
        })
        .catch(() => undefined)
    }, 2_500)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [binding?.platformId, binding?.waiting])

  const unbind = (id: string) => {
    commitAccounts(removeAccount(accounts, id))
    if (editingAccount === id) closeBindForm()
  }

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

  /** 当前平台、当前原文的适配结果（预览用）。 */
  const adapted = useMemo(
    () => (source === undefined ? '' : platform.convert(source, previewImages)),
    [platform, source, previewImages],
  )

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

  const download = useCallback(async () => {
    if (source === undefined || platform.format !== 'html') return
    setBusy(true)
    const { images } = await inlineAllImages(source, projectId, file)
    const text = platform.convert(source, images)
    const blob = new Blob([text], { type: platform.mime })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    // 文件名跟卡片名词干走，保留大小写——与媒体导出同一条规矩。
    anchor.download = `${file.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '') ?? 'publish'}-${platform.id}.html`
    anchor.click()
    URL.revokeObjectURL(url)
    setBusy(false)
  }, [source, platform, projectId, file])

  /**
   * 一键发布（v1.98）：把当前平台、当前账号的适配正文交给宿主，宿主带账号的真
   * Cookie 调平台接口。正文按上游要的形状备两份：微博要纯文本；知乎与公众号要
   * HTML（知乎的转换器本就是富文本那一路）。结果（成功带地址、失败带平台原话）
   * 落在编辑器下方那行。
   */
  const deliver = useCallback(async () => {
    if (source === undefined || currentAccount === undefined || upstream === undefined) return
    setDelivering(true)
    setDeliverNote(undefined)
    // 文件名跟卡片名词干走，与下载同一条规矩。
    const title = file.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '') ?? '发布'
    const html = platform.format === 'html' ? platform.convert(source, new Map()) : markdownToRichHtml(source)
    const payload: DeliverPayload = {
      platformId: platform.id,
      credential: currentAccount.credential,
      title,
      html,
      text: upstream === 'weibo' ? platform.convert(source, new Map()) : '',
    }
    try {
      setDeliverNote(await deliverPost(payload))
    } catch (error) {
      setDeliverNote({ ok: false, message: error instanceof Error ? error.message : String(error) })
    }
    setDelivering(false)
  }, [source, currentAccount, upstream, platform, file])

  // Esc 逐层退：先关账号管理，再关页面。发布页盖在画布上，这条键得在这里接住，
  // 不能让画布那边同时收到（弹窗已经关了，那边没有「上一层」可退）。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (manageOpen) {
        setManageOpen(false)
        setBindingFor('')
        setEditingAccount('')
        setBindName('')
        setBindCredential('')
        setBinding(undefined)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [manageOpen, onClose])

  const chars = adapted.length
  const overLimit = platform.maxChars !== undefined && chars > platform.maxChars

  /** 编辑区按平台格式分流：html 白纸、markdown 渲染、纯文本逐字。 */
  const body = editingSource ? (
    <textarea
      className="dsh-canvas-publish-source"
      value={source ?? ''}
      spellCheck={false}
      onChange={(event) => setSource(event.target.value)}
    />
  ) : platform.format === 'html' ? (
    // 这份 HTML 出自自家渲染器（转义纪律同一套，markdown.ts），与预览器同级的信任。
    <div className="dsh-canvas-publish-sheet" dangerouslySetInnerHTML={{ __html: adapted }} />
  ) : platform.format === 'markdown' ? (
    <div className="dsh-canvas-publish-sheet">
      <div className="dsh-canvas-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(adapted) }} />
    </div>
  ) : (
    <pre className="dsh-canvas-publish-sheet dsh-canvas-publish-plain">{adapted}</pre>
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
        <label className="dsh-canvas-publish-account-pick">
          {t('canvas.publish.page.account')}
          {platformAccounts.length === 0 ? (
            <span className="dsh-canvas-publish-account-state">{t('canvas.publish.page.noAccount')}</span>
          ) : (
            <select
              className="dsh-canvas-publish-select"
              value={currentAccount?.id ?? ''}
              onChange={(event) => setSelectedBy((current) => ({ ...current, [platform.id]: event.target.value }))}
            >
              {platformAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          )}
        </label>
        <button type="button" className="dsh-canvas-chipbtn" onClick={() => setManageOpen(true)}>
          {t('canvas.publish.page.manage')}
        </button>
        <button type="button" className="dsh-canvas-chipbtn" data-primary="true" disabled={busy || source === undefined} onClick={() => void copy()}>
          {busy ? t('canvas.publish.imageBusy') : copied ? t('canvas.publish.copied') : t('canvas.publish.copy')}
        </button>
        {platform.format === 'html' ? (
          <button type="button" className="dsh-canvas-chipbtn" disabled={busy || source === undefined} onClick={() => void download()}>
            {t('canvas.publish.download')}
          </button>
        ) : null}
        {upstream !== undefined ? (
          <button
            type="button"
            className="dsh-canvas-chipbtn"
            data-primary="true"
            disabled={delivering || source === undefined || currentAccount === undefined}
            onClick={() => void deliver()}
          >
            {delivering ? t('canvas.publish.delivering') : t('canvas.publish.deliver')}
          </button>
        ) : null}
      </header>

      <div className="dsh-canvas-publish-body">
        <aside className="dsh-canvas-publish-side">
          <div className="dsh-canvas-publish-side-title">{t('canvas.publish.page.platforms')}</div>
          {PUBLISH_PLATFORMS.map((entry) => {
            const bound = accountsOf(accounts, entry.id).length
            return (
              <button
                key={entry.id}
                type="button"
                className={entry.id === platform.id ? 'dsh-canvas-publish-side-item is-on' : 'dsh-canvas-publish-side-item'}
                aria-pressed={entry.id === platform.id}
                onClick={() => setPlatformId(entry.id)}
              >
                <span>{entry.name}</span>
                <span className="dsh-canvas-spacer" />
                {bound > 0 ? (
                  <span className="dsh-canvas-publish-side-count">{t('canvas.publish.page.accountCount', { count: bound })}</span>
                ) : null}
              </button>
            )
          })}
        </aside>

        <main className="dsh-canvas-publish-main">
          <div className="dsh-canvas-publish-toolbar">
            <span className="dsh-canvas-publish-platform-name">{platform.name}</span>
            <span className="dsh-canvas-publish-chars">{t('canvas.publish.chars', { count: chars })}</span>
            {overLimit ? <span className="dsh-canvas-publish-over">{t('canvas.publish.tooLong', { max: platform.maxChars })}</span> : null}
            {upstream === undefined ? <span className="dsh-canvas-publish-chars">{t('canvas.publish.page.deliverUnsupported')}</span> : null}
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
          <div className="dsh-canvas-publish-editor">
            {error !== '' ? <p className="dsh-canvas-publish-note">{error}</p> : source === undefined ? <p className="dsh-canvas-publish-note">{t('canvas.publish.page.loading')}</p> : body}
          </div>
          {imagesNote > 0 ? <p className="dsh-canvas-publish-note dsh-canvas-publish-foot-note">{t('canvas.publish.imagesFailed', { count: imagesNote })}</p> : null}
          {copyFailed ? <p className="dsh-canvas-publish-note dsh-canvas-publish-foot-note">{t('canvas.publish.failed')}</p> : null}
          {deliverNote !== undefined ? (
            <p className={deliverNote.ok ? 'dsh-canvas-publish-note is-ok' : 'dsh-canvas-publish-note dsh-canvas-publish-foot-note'}>
              {deliverNote.message}
              {deliverNote.url !== undefined ? (
                <>
                  {' '}
                  <a href={deliverNote.url} target="_blank" rel="noreferrer">
                    {t('canvas.publish.deliverOpen')}
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </main>
      </div>

      {manageOpen ? (
        <div className="dsh-canvas-publish-manage" role="dialog" aria-label={t('canvas.publish.page.manage')}>
          <div className="dsh-canvas-publish-manage-card">
            <div className="dsh-canvas-publish-manage-head">
              <span className="dsh-canvas-publish-nav-title">{t('canvas.publish.page.manage')}</span>
              <span className="dsh-canvas-spacer" />
              <button type="button" className="dsh-canvas-chipbtn" onClick={() => { closeBindForm(); setManageOpen(false) }}>
                {t('canvas.publish.close')}
              </button>
            </div>
            <p className="dsh-canvas-publish-accounts-hint">{t('canvas.publish.page.managedHint')}</p>
            {PUBLISH_PLATFORMS.map((entry) => {
              const bound = accountsOf(accounts, entry.id)
              return (
                <section className="dsh-canvas-publish-manage-section" key={entry.id}>
                  <div className="dsh-canvas-publish-manage-name">
                    <span>{entry.name}</span>
                    <span className="dsh-canvas-spacer" />
                    <button
                      type="button"
                      className="dsh-canvas-chipbtn"
                      disabled={binding?.platformId === entry.id && binding.waiting}
                      onClick={() => startBind(entry.id)}
                    >
                      {t('canvas.publish.page.addAccount')}
                    </button>
                  </div>
                  {binding?.platformId === entry.id ? (
                    <p className="dsh-canvas-publish-accounts-hint">
                      {binding.message !== ''
                        ? binding.message
                        : t('canvas.publish.page.bindWaiting')}
                      {binding.message !== '' || binding.waiting ? (
                        <>
                          {' '}
                          <button type="button" className="dsh-canvas-chipbtn" onClick={cancelBind}>
                            {t('canvas.publish.cancel')}
                          </button>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  {bound.length === 0 ? <p className="dsh-canvas-publish-account-state">{t('canvas.publish.page.noAccount')}</p> : null}
                  {bound.map((account) => (
                    <div className="dsh-canvas-publish-account" key={account.id}>
                      <span className="dsh-canvas-publish-account-name">{account.name}</span>
                      <span className="dsh-canvas-publish-chars">{maskCredential(account.credential)}</span>
                      <span className="dsh-canvas-spacer" />
                      <button type="button" className="dsh-canvas-chipbtn" onClick={() => openBindForm(entry.id, account)}>
                        {t('canvas.publish.page.edit')}
                      </button>
                      <button type="button" className="dsh-canvas-chipbtn" onClick={() => unbind(account.id)}>
                        {t('canvas.publish.unbind')}
                      </button>
                    </div>
                  ))}
                  {bindingFor === entry.id ? (
                    <div className="dsh-canvas-publish-account-form">
                      <label className="dsh-canvas-publish-inline">
                        {t('canvas.publish.accountName')}
                        <input
                          type="text"
                          className="dsh-canvas-publish-input"
                          value={bindName}
                          placeholder={entry.name}
                          onChange={(event) => setBindName(event.target.value)}
                        />
                      </label>
                      <label className="dsh-canvas-publish-inline">
                        {t('canvas.publish.credential')}
                        <input
                          type="password"
                          className="dsh-canvas-publish-input"
                          value={bindCredential}
                          autoComplete="off"
                          onChange={(event) => setBindCredential(event.target.value)}
                        />
                      </label>
                      <div className="dsh-canvas-publish-account-form-actions">
                        <span className="dsh-canvas-spacer" />
                        <button type="button" className="dsh-canvas-chipbtn" onClick={closeBindForm}>
                          {t('canvas.publish.cancel')}
                        </button>
                        <button
                          type="button"
                          className="dsh-canvas-chipbtn"
                          data-primary="true"
                          disabled={bindName.trim() === '' || bindCredential.trim() === ''}
                          onClick={submitEdit}
                        >
                          {t('canvas.publish.save')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
