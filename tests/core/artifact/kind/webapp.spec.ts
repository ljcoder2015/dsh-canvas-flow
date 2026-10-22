import { describe, expect, it } from 'vitest'
import { detectKind, outlineOf, type KindProbe } from '../../../../src/core/artifact/kind/kind-registry.ts'
import {
  PREVIEW_CHANNEL,
  PREVIEW_GUARD_ID,
  PREVIEW_GUARD_SOURCE,
  WEBAPP_MANIFEST,
  injectPreviewLinkGuard,
  inlineWebAppAssets,
  webAppAssetRefs,
  webappFiles,
} from '../../../../src/core/artifact/kind/webapp.ts'

const directoryProbe = (children: string[]): KindProbe => ({
  path: 'app',
  directory: true,
  basename: 'app',
  extension: '',
  head: '',
  children,
})

describe('webapp kind detection', () => {
  it('reads a directory with the manifest as an app', () => {
    expect(detectKind(directoryProbe([WEBAPP_MANIFEST, 'index.html', 'app.js', 'styles.css']))).toBe('app')
  })

  it('reads a manifest-less entry folder as an app too', () => {
    // 归并后不再区分站点与应用：有入口页的目录就是 app。
    expect(detectKind(directoryProbe(['index.html', WEBAPP_MANIFEST]))).toBe('app')
    expect(detectKind(directoryProbe(['index.html']))).toBe('app')
  })

  it('leaves other directories as folders', () => {
    expect(detectKind(directoryProbe(['a.css', 'b.js']))).toBe('folder')
  })

  it('outlines an app by its entry title', () => {
    const html = '<html><head><title>我的应用</title></head></html>'
    expect(outlineOf('app', html)).toEqual(['我的应用'])
  })
})

describe('webapp scaffold files', () => {
  const files = webappFiles('看板')

  it('writes the manifest first, then entry, tokens, components', () => {
    expect(files.map((file) => file.path)).toEqual([WEBAPP_MANIFEST, 'index.html', 'styles.css', 'app.js'])
  })

  it('declares the web component + shadcn pairing in the manifest', () => {
    const manifest = JSON.parse(files[0]!.content) as Record<string, unknown>
    expect(manifest).toMatchObject({ name: '看板', entry: 'index.html', framework: 'web-components', ui: 'shadcn' })
  })

  it('references only local assets from the entry page', () => {
    const html = files[1]!.content
    expect(webAppAssetRefs(html)).toEqual(['styles.css', 'app.js'])
  })

  it('components read the shadcn tokens through CSS variables', () => {
    const css = files[2]!.content
    const js = files[3]!.content
    expect(css).toContain('--primary')
    expect(css).toContain('prefers-color-scheme: dark')
    expect(js).toContain('customElements.define')
    expect(js).toContain('var(--radius)')
  })
})

describe('webAppAssetRefs', () => {
  it('collects stylesheet links and script sources in order, deduplicated', () => {
    const html = [
      '<link rel="stylesheet" href="a.css">',
      '<link rel="icon" href="favicon.ico">',
      '<script type="module" src="a.js"></script>',
      '<script type="module" src="a.css"></script>',
      '<link rel="stylesheet" href="a.css">',
    ].join('\n')
    expect(webAppAssetRefs(html)).toEqual(['a.css', 'a.js'])
  })

  it('ignores absolute, protocol and protocol-relative references', () => {
    const html = [
      '<link rel="stylesheet" href="/root.css">',
      '<link rel="stylesheet" href="https://cdn.example.com/x.css">',
      '<script src="//cdn.example.com/y.js"></script>',
      '<script src="data:text/javascript,1"></script>',
    ].join('\n')
    expect(webAppAssetRefs(html)).toEqual([])
  })
})

describe('inlineWebAppAssets', () => {
  const page = (href: string, src: string): string =>
    `<link rel="stylesheet" href="${href}"><script type="module" src="${src}"></script>`

  it('replaces resolvable local references with inline style and script', () => {
    const out = inlineWebAppAssets(page('styles.css', 'app.js'), (ref) => `/* ${ref} */`)
    expect(out).toContain('<style>\n/* styles.css */\n</style>')
    expect(out).toContain('type="module"')
    expect(out).not.toContain('src=')
  })

  it('leaves references the resolver cannot answer', () => {
    const original = page('styles.css', 'app.js')
    expect(inlineWebAppAssets(original, () => undefined)).toBe(original)
  })

  it('leaves absolute and protocol references untouched even when resolvable', () => {
    const original = page('/styles.css', 'https://cdn.example.com/app.js')
    expect(inlineWebAppAssets(original, () => 'x')).toBe(original)
  })

  it('escapes a closing script tag inside inlined script content', () => {
    const out = inlineWebAppAssets(page('a.css', 'b.js'), (ref) =>
      ref === 'b.js' ? 'const s = "</script>";' : '',
    )
    expect(out).toContain('<\\/script>')
  })

  it('returns a page without local references unchanged', () => {
    const original = '<p>没有引用</p>'
    expect(inlineWebAppAssets(original, () => 'x')).toBe(original)
  })
})

/**
 * The preview's link guard (F3.8).
 *
 * The guard ships as a *string* the host pastes into the page, so a test that
 * only read the string would pin nothing. This one runs it — `new Function`
 * with the four globals the guard touches handed in — and drives it with
 * synthetic clicks. That is what makes the table below a measurement rather
 * than a restatement: `#bottom`, `https://…` and `child.html` must come out
 * three different ways, and only executing the shipped code can show that.
 *
 * Why the branches exist: a `srcdoc` document has no address of its own, so its
 * base URL is the *host page's* URL — a relative link therefore resolves into
 * the host application and clicking one navigates the preview there (a 401
 * page, in the deployment). Measured in `.workbuddy/repro/link-probe.cjs`.
 */
describe('preview link guard', () => {
  interface Acted {
    prevented: boolean
    opened: string[]
    reported: string[]
    hash: string[]
  }

  /**
   * Run the shipped guard against one click on one anchor.
   *
   * @param href - the anchor's `href` attribute; null for an anchor without one.
   * @param options - how the click arrives.
   * @returns what the guard did.
   */
  const click = (
    href: string | null,
    options: { button?: number; prevented?: boolean; onAnchor?: boolean } = {},
  ): Acted => {
    const acted: Acted = { prevented: false, opened: [], reported: [], hash: [] }
    let captured: ((event: unknown) => void) | undefined
    const document = {
      addEventListener: (type: string, handler: (event: unknown) => void): void => {
        if (type === 'click') captured = handler
      },
    }
    const window = { open: (url: string): void => { acted.opened.push(url) } }
    const location = {
      get hash(): string { return '' },
      set hash(value: string) { acted.hash.push(value) },
    }
    const parent = { postMessage: (data: { href: string }): void => { acted.reported.push(data.href) } }
    // The guard is a plain script: these four are its entire outside world.
    const install = new Function('window', 'document', 'location', 'parent', PREVIEW_GUARD_SOURCE)
    install(window, document, location, parent)

    const anchor = { getAttribute: (name: string): string | null => (name === 'href' ? href : null) }
    const event = {
      defaultPrevented: options.prevented ?? false,
      button: options.button ?? 0,
      target: { closest: (): unknown => ((options.onAnchor ?? true) ? anchor : null) },
      preventDefault: (): void => { acted.prevented = true },
    }
    const handler = captured as ((event: unknown) => void) | undefined
    if (handler === undefined) throw new Error('闸门没有注册 click 监听')
    handler(event)
    return acted
  }

  it('keeps an in-page anchor in the page, through location.hash', () => {
    const acted = click('#bottom')
    expect(acted.hash).toEqual(['#bottom'])
    expect(acted.prevented).toBe(true)
    // 关键：不 window.open、也不上报——它本来就是同文档跳转。
    expect(acted.opened).toEqual([])
    expect(acted.reported).toEqual([])
  })

  it('treats a bare # and an empty href as the same in-page jump', () => {
    // 两者都交给 location.hash：'#' 落到 about:srcdoc#（回顶部），'' 等于没设。
    expect(click('#').hash).toEqual(['#'])
    expect(click('').hash).toEqual([''])
  })

  it('opens an absolute address in a real window', () => {
    const acted = click('https://github.com/ljcoder2015/dsh-canvas')
    expect(acted.opened).toEqual(['https://github.com/ljcoder2015/dsh-canvas'])
    expect(acted.prevented).toBe(true)
    expect(acted.reported).toEqual([])
  })

  it('opens protocol-relative, mailto and tel addresses too', () => {
    expect(click('//example.com/x').opened).toEqual(['//example.com/x'])
    expect(click('mailto:a@b.c').opened).toEqual(['mailto:a@b.c'])
  })

  it('blocks an address that only resolves against the host page', () => {
    for (const href of ['child.html', './child.html', '/', '/page/two.html', '?x=1', '  child.html  ']) {
      const acted = click(href)
      expect(acted.prevented, href).toBe(true)
      expect(acted.opened, href).toEqual([])
      expect(acted.reported, href).toEqual([href.trim()])
    }
  })

  it('leaves the page own machinery alone', () => {
    for (const href of ['javascript:go()', 'data:text/html,<b>x</b>', 'blob:https://x/y']) {
      const acted = click(href)
      expect(acted.prevented, href).toBe(false)
      expect(acted.opened, href).toEqual([])
      expect(acted.reported, href).toEqual([])
    }
  })

  it('stands down on a non-primary button, a taken click and a non-anchor', () => {
    expect(click('child.html', { button: 1 }).reported).toEqual([])
    expect(click('https://example.com', { button: 2 }).opened).toEqual([])
    expect(click('child.html', { prevented: true }).reported).toEqual([])
    expect(click('child.html', { onAnchor: false }).reported).toEqual([])
  })

  it('installs itself at the end of the page, where it cannot break a script', () => {
    const out = injectPreviewLinkGuard('<!doctype html><html><body><p>hi</p></body></html>')
    expect(out).toContain(`id="${PREVIEW_GUARD_ID}"`)
    expect(out.startsWith('<!doctype html>')).toBe(true)
    expect(out.indexOf(PREVIEW_GUARD_ID)).toBeGreaterThan(out.indexOf('</html>'))
    // 页面自己脚本文里带 </body> 是真事（探针量过）：追加到文末，原文一字不动，
    // 外层脚本也就不会被提前闭合。
    const risky = '<script>var s = "</body>";run()</script>'
    expect(injectPreviewLinkGuard(risky).startsWith(risky)).toBe(true)
  })

  it('is idempotent', () => {
    const once = injectPreviewLinkGuard('<p>x</p>')
    expect(injectPreviewLinkGuard(once)).toBe(once)
  })

  it('speaks the channel the viewer listens on', () => {
    // 闸门里那条 postMessage 与预览弹窗的收件判断必须是同一句话。
    expect(PREVIEW_GUARD_SOURCE).toContain(PREVIEW_CHANNEL)
    expect(injectPreviewLinkGuard('<p>x</p>')).toContain(PREVIEW_CHANNEL)
  })
})
