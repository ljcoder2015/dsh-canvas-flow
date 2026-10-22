/**
 * dsh-canvas — the webapp scaffold, and the preview inlining HTML pages share (应用节点).
 *
 * A webapp card is a *directory*: a manifest (`dsh.webapp.json`), an entry
 * `index.html`, and the app's own source beside it — web components for the
 * component model, shadcn design tokens for the UI. Both halves of that pair
 * are deliberate:
 *
 * - **Web components** need no build step and no framework runtime, so the
 *   scaffolded folder runs as it is — in the sandboxed artifact preview, from
 *   a static host, or under an agent's plain file tools.
 * - **shadcn** contributes its design system rather than its React packages:
 *   the CSS custom properties (`--background`, `--card`, `--primary`, …) and
 *   the component visual language the tokens drive. Tokens are variables, so
 *   they reach into shadow roots without hand-copied values.
 *
 * The preview path is the reason {@link inlineWebAppAssets} exists: the
 * fullscreen viewer renders one `srcDoc`, and a `srcdoc` document cannot
 * resolve `styles.css` or `app.js` relative to anything. So the host inlines
 * the entry's local stylesheet and script references before the text crosses
 * the wire — the folder keeps its multi-file shape on disk, and the preview
 * still shows the running app.
 *
 * The same missing base URL is why {@link injectPreviewLinkGuard} exists. An
 * asset reference that cannot resolve leaves a broken asset; a *link* that
 * cannot resolve leaves a click that navigates the preview into the host
 * application — the one outcome a preview must never have. So the page also
 * leaves here with a guard that owns its clicks.
 *
 * The inlining serves every kind in `HTML_KINDS` (exactly one: `app` — a single
 * page or an app entry previews as the same `srcDoc` and loses its local
 * styles without it). This module owns the *mechanism*; the kind list lives in
 * `kind-registry.ts`, so the preview's kind table and the host's inlining gate
 * read the same source.
 */

/** The manifest file that marks a directory as a webapp (kind evidence, F2.2). */
export const WEBAPP_MANIFEST = 'dsh.webapp.json'

/** One scaffold file: a path relative to the app folder, and its content. */
export interface WebAppFile {
  path: string
  content: string
}

/** The shadcn token block shared by the stylesheet and the components. */
const SHADCN_TOKENS = `:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.141 0.005 285.823);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.141 0.005 285.823);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.141 0.005 285.823);
  --primary: oklch(0.21 0.006 285.885);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.967 0.001 286.375);
  --secondary-foreground: oklch(0.21 0.006 285.885);
  --muted: oklch(0.967 0.001 286.375);
  --muted-foreground: oklch(0.552 0.016 285.938);
  --accent: oklch(0.967 0.001 286.375);
  --accent-foreground: oklch(0.21 0.006 285.885);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.92 0.004 286.32);
  --input: oklch(0.92 0.004 286.32);
  --ring: oklch(0.705 0.015 286.067);
  --radius: 0.625rem;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: oklch(0.141 0.005 285.823);
    --foreground: oklch(0.985 0 0);
    --card: oklch(0.21 0.006 285.885);
    --card-foreground: oklch(0.985 0 0);
    --popover: oklch(0.21 0.006 285.885);
    --popover-foreground: oklch(0.985 0 0);
    --primary: oklch(0.92 0.004 286.32);
    --primary-foreground: oklch(0.21 0.006 285.885);
    --secondary: oklch(0.274 0.006 286.033);
    --secondary-foreground: oklch(0.985 0 0);
    --muted: oklch(0.274 0.006 286.033);
    --muted-foreground: oklch(0.705 0.015 286.067);
    --accent: oklch(0.274 0.006 286.033);
    --accent-foreground: oklch(0.985 0 0);
    --destructive: oklch(0.704 0.191 22.216);
    --destructive-foreground: oklch(0.985 0 0);
    --border: oklch(1 0 0 / 10%);
    --input: oklch(1 0 0 / 15%);
    --ring: oklch(0.552 0.016 285.938);
  }
}`

/** The entry page: markup only — every behaviour lives in the components. */
function entryHtml(title: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="app">
    <header class="app-head">
      <wc-badge>Web Component</wc-badge>
      <wc-badge variant="secondary">shadcn tokens</wc-badge>
      <h1>${title}</h1>
      <p class="app-sub">一个跑在画布上的 web 应用：组件是原生 Custom Elements，配色来自 shadcn 设计令牌。让卡片会话直接改这里的文件。</p>
    </header>

    <wc-card>
      <span slot="title">任务清单</span>
      <div class="row">
        <wc-input id="task-input" placeholder="要做什么？"></wc-input>
        <wc-button id="task-add">添加</wc-button>
      </div>
      <ul id="tasks" class="tasks"></ul>
      <p class="tasks-empty" id="tasks-empty">还没有任务，添加第一条试试。</p>
    </wc-card>
  </main>

  <script type="module" src="app.js"></script>
</body>
</html>
`
}

/** The stylesheet: tokens first, then the page's own layout. */
function stylesCss(): string {
  return `/* shadcn 设计令牌 + 页面布局。组件自己的样式在 app.js 的 shadow DOM 里。 */
${SHADCN_TOKENS}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  background: var(--background);
  color: var(--foreground);
  font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Noto Sans SC", sans-serif;
  line-height: 1.6;
  display: flex;
  justify-content: center;
}

.app {
  width: min(680px, calc(100vw - 48px));
  padding: 48px 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.app-head h1 { margin: 12px 0 4px; font-size: 28px; letter-spacing: -0.02em; }
.app-sub { margin: 0; color: var(--muted-foreground); font-size: 14px; }

.row { display: flex; gap: 8px; }
.row wc-input { flex: 1; }

.tasks { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.tasks li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) - 4px);
  background: var(--secondary);
  font-size: 14px;
}
.tasks li .done { flex: 1; text-decoration: line-through; color: var(--muted-foreground); }
.tasks li .todo { flex: 1; }
.tasks-empty { margin: 16px 0 0; color: var(--muted-foreground); font-size: 13px; }
`
}

/**
 * The components: native Custom Elements styled from the shadcn tokens.
 *
 * Each element renders into a shadow root and reads the page-level CSS
 * variables — custom properties inherit through shadow boundaries, which is
 * what makes one token set drive every component without theming code.
 */
function appJs(title: string): string {
  return `/* ${title} — web components。加新界面就照这个样子再定义一个 custom element。 */

/** wc-button：shadcn 的 Button。variant=default|secondary|outline|destructive。 */
class WcButton extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return
    const label = this.textContent.trim()
    const variant = this.getAttribute('variant') ?? 'default'
    this.attachShadow({ mode: 'open' }).innerHTML = \`
      <style>
        :host { display: inline-block; }
        button {
          font: inherit; font-size: 14px; font-weight: 500;
          padding: 8px 16px; border-radius: calc(var(--radius) - 4px);
          border: 1px solid transparent; cursor: pointer;
          background: var(--\${variant === 'default' ? 'primary' : variant});
          color: var(--\${variant === 'default' ? 'primary-foreground' : variant + '-foreground'});
          \${variant === 'outline' ? 'border-color: var(--input); background: transparent; color: var(--foreground);' : ''}
          transition: opacity .15s;
        }
        button:hover { opacity: .9; }
        button:active { opacity: .75; }
      </style>
      <button part="button">\${label}</button>
    \`
    this.shadowRoot.querySelector('button').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('wc-click', { bubbles: true, composed: true }))
    })
  }
}

/** wc-input：shadcn 的 Input。value 属性与输入框双向。 */
class WcInput extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return
    this.attachShadow({ mode: 'open' }).innerHTML = \`
      <style>
        input {
          font: inherit; font-size: 14px; width: 100%;
          padding: 8px 12px; border-radius: calc(var(--radius) - 4px);
          border: 1px solid var(--input); background: transparent; color: var(--foreground);
          outline: none;
        }
        input:focus { border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 30%, transparent); }
        input::placeholder { color: var(--muted-foreground); }
      </style>
      <input type="text" placeholder="\${this.getAttribute('placeholder') ?? ''}" />
    \`
    const input = this.shadowRoot.querySelector('input')
    input.addEventListener('input', () => { this.value = input.value })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.dispatchEvent(new CustomEvent('wc-submit', { bubbles: true, composed: true }))
    })
  }
}

/** wc-card：shadcn 的 Card，标题走 slot="title"。 */
class WcCard extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return
    this.attachShadow({ mode: 'open' }).innerHTML = \`
      <style>
        :host { display: block; }
        .card {
          background: var(--card); color: var(--card-foreground);
          border: 1px solid var(--border); border-radius: var(--radius);
          padding: 20px; box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
        }
        .title { font-weight: 600; font-size: 16px; margin-bottom: 12px; }
        .body { font-size: 14px; }
      </style>
      <div class="card">
        <div class="title"><slot name="title"></slot></div>
        <div class="body"><slot></slot></div>
      </div>
    \`
  }
}

/** wc-badge：shadcn 的 Badge。variant=default|secondary|outline。 */
class WcBadge extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return
    const variant = this.getAttribute('variant') ?? 'default'
    this.attachShadow({ mode: 'open' }).innerHTML = \`
      <style>
        span {
          display: inline-block; font-size: 12px; font-weight: 500;
          padding: 2px 10px; border-radius: 999px;
          background: var(--\${variant}); color: var(--\${variant}-foreground);
          \${variant === 'outline' ? 'border: 1px solid var(--input); background: transparent; color: var(--foreground);' : ''}
        }
      </style>
      <span><slot></slot></span>
    \`
  }
}

customElements.define('wc-button', WcButton)
customElements.define('wc-input', WcInput)
customElements.define('wc-card', WcCard)
customElements.define('wc-badge', WcBadge)

// ── 一个最小的演示：任务清单 ────────────────────────────────────────────────

const input = document.getElementById('task-input')
const list = document.getElementById('tasks')
const empty = document.getElementById('tasks-empty')

function addTask(text) {
  const value = text.trim()
  if (value === '') return
  input.value = ''
  input.shadowRoot.querySelector('input').focus()
  const item = document.createElement('li')
  const check = document.createElement('wc-button')
  check.setAttribute('variant', 'outline')
  check.textContent = '完成'
  const label = document.createElement('span')
  label.className = 'todo'
  label.textContent = value
  item.append(check, label)
  list.append(item)
  empty.hidden = true
  check.addEventListener('wc-click', () => {
    label.className = label.className === 'todo' ? 'done' : 'todo'
  })
}

document.getElementById('task-add').addEventListener('wc-click', () => addTask(input.value ?? ''))
input.addEventListener('wc-submit', () => addTask(input.value ?? ''))
`
}

/**
 * The webapp scaffold: the manifest, the entry page, the tokens, the components.
 *
 * Four files, in write order. The manifest is written first so a crash mid-
 * scaffold still leaves kind evidence behind (the folder reads as an app,
 * not as a half-built folder); `title` feeds the page heading and the manifest's
 * `name`.
 *
 * @param title - the app's display name; may be any text, it lands in HTML and JSON.
 */
export function webappFiles(title: string): WebAppFile[] {
  const manifest = {
    name: title,
    entry: 'index.html',
    framework: 'web-components',
    ui: 'shadcn',
    version: 1,
  }
  return [
    { path: WEBAPP_MANIFEST, content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: 'index.html', content: entryHtml(title) },
    { path: 'styles.css', content: stylesCss() },
    { path: 'app.js', content: appJs(title) },
  ]
}

/**
 * The local assets an entry page references, in order, deduplicated.
 *
 * Only *relative* references count — `styles.css`, `js/app.js` — because those
 * are the ones a `srcdoc` preview cannot resolve. Absolute paths, protocol
 * URLs and data URLs are left alone: they either need a real origin (which the
 * preview does not have) or carry their own content.
 */
export function webAppAssetRefs(html: string): string[] {
  const refs: string[] = []
  const consider = (candidate: string | undefined): void => {
    if (candidate === undefined || candidate === '') return
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(candidate)) return
    if (!refs.includes(candidate)) refs.push(candidate)
  }
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(tag[0])) continue
    consider(/\bhref\s*=\s*["']([^"']+)["']/i.exec(tag[0])?.[1])
  }
  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi)) {
    consider(match[1])
  }
  return refs
}

/**
 * Inline an entry page's local assets into itself, for the sandboxed preview.
 *
 * `<link rel="stylesheet" href="styles.css">` becomes `<style>…</style>` and
 * `<script src="app.js">…</script>` becomes an inline script with the same
 * attributes minus `src`. A reference the `resolve` callback cannot answer
 * (missing file, unreadable) is left as it is — a broken preview that says
 * nothing is worse than one that shows the page as it is. Script content is
 * escaped against premature `</script>` termination the standard way.
 *
 * Pure: {@link webAppAssetRefs} tells the caller what to read; the resolved
 * contents arrive through `resolve`. The whole text is returned unchanged when
 * it references nothing local.
 *
 * @param html - the entry page's text.
 * @param resolve - relative reference to file content, or `undefined` when absent.
 */
export function inlineWebAppAssets(html: string, resolve: (ref: string) => string | undefined): string {
  let inlined = html

  inlined = inlined.replace(/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi, (tag) => {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (href === undefined || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(href)) return tag
    const content = resolve(href)
    if (content === undefined) return tag
    return `<style>\n${content}\n</style>`
  })

  inlined = inlined.replace(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*?)>\s*<\/script>/gi, (tag, before: string, src: string, after: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(src)) return tag
    const content = resolve(src)
    if (content === undefined) return tag
    const attrs = `${before}${after}`.replace(/\s+/g, ' ').trim()
    const escaped = content.replace(/<\/(script)/gi, '<\\/$1')
    return `<script${attrs === '' ? '' : ` ${attrs}`}>\n${escaped}\n</script>`
  })

  return inlined
}

// ── the preview's link guard ────────────────────────────────────────────────

/**
 * The `postMessage` channel the guard reports blocked links on.
 *
 * Shared by both halves — the guard (host-side text) and the viewer that shows
 * the notice — so the two cannot drift into speaking different dialects.
 */
export const PREVIEW_CHANNEL = 'dsh-canvas.preview'

/** The guard script's own id, so injecting it twice is a no-op. */
export const PREVIEW_GUARD_ID = 'dsh-canvas-link-guard'

/**
 * What a click on a link inside a preview should do.
 *
 * Every branch exists because the *default* is wrong in a `srcdoc` preview, and
 * the reason is one line of URL semantics: a `srcdoc` document has no address of
 * its own, so its `baseURI` is the **host page's** URL. Every relative address
 * therefore resolves against the host application — `#bottom` becomes
 * `http://127.0.0.1:3080/#bottom`, `child.html` becomes
 * `http://127.0.0.1:3080/child.html`. Clicking one navigates the preview frame
 * to the host app: the user loses the preview, and the request arrives without
 * the credentials the app needs, so it lands on a 401 page. Measured, not
 * guessed — see `.workbuddy/repro/link-probe.cjs`.
 *
 * So the guard takes the click before the browser resolves it, and sends each
 * shape where it can actually go:
 *
 * - `#anchor` → in-place. `location.hash` is a same-document navigation in a
 *   `srcdoc` frame (the fragment resolves against the document's own URL, not
 *   the base), so the jump works, the `hashchange` event still fires — a
 *   hash-routing app keeps working — and no request leaves the frame.
 * - Absolute (`https://…`, `//…`, `mailto:…`) → a real new window. Asserted
 *   with `noopener`: the popup must not hold a handle back into the preview
 *   (its `location` would be writable from the frame). Without this branch a
 *   link with no `target` navigates the *frame* to the far site, which for most
 *   sites ends as a refused frame — the preview gone, nothing gained.
 * - Anything relative (and `""`) → blocked, and reported to the viewer, which
 *   says so in words. A silent no-op would be worse than the breakage: the
 *   address genuinely cannot resolve, and the user needs to know that the file
 *   exists somewhere reachable (a card, or the folder in the file manager).
 * - `javascript:` / `data:` / `blob:` → left entirely alone. These are the
 *   page's own machinery; stepping in would break working apps to fix nothing.
 *
 * The listener is on `document` in the capture phase, so it also covers links
 * an app adds later, and it stands down on a non-primary button or on a click
 * some other handler already took.
 */
export const PREVIEW_GUARD_SOURCE = `(function () {
  var ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\\/\\/)/i
  var OURS = /^(?:javascript|data|blob):/i
  function report(href) {
    try { parent.postMessage({ channel: '${PREVIEW_CHANNEL}', kind: 'local-link', href: href }, '*') } catch (error) {}
  }
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0) return
    var node = event.target
    var anchor = node && node.closest ? node.closest('a[href]') : null
    if (anchor === null) return
    var href = anchor.getAttribute('href')
    if (href === null) return
    var raw = href.trim()
    if (OURS.test(raw)) return
    if (raw === '' || raw.charAt(0) === '#') {
      event.preventDefault()
      try { location.hash = raw } catch (error) {}
      return
    }
    event.preventDefault()
    if (ABSOLUTE.test(raw)) { window.open(raw, '_blank', 'noopener'); return }
    report(raw)
  }, true)
})()`

/**
 * Put the link guard into a page that is about to be previewed.
 *
 * Appended at the very end of the text, deliberately, and *not* spliced in
 * before `</body>`: a page whose own script contains the string `</body>` is a
 * real thing (measured — `.workbuddy/repro/tail-script-probe.cjs`), and a tag
 * injected at the wrong `</body>` would close that script early and break the
 * app. The tail has no such hazard. It also costs nothing: the HTML parser
 * hoists trailing content into the body and runs it (measured in the same
 * probe), and the guard listens in the capture phase on `document`, so it is
 * registered before any click can arrive.
 *
 * Idempotent — a page that already carries the guard comes back unchanged.
 * Pure: text in, text out; the caller does the reading and the asset inlining.
 *
 * @param html - the entry page's text.
 * @returns the same page with the guard installed.
 */
export function injectPreviewLinkGuard(html: string): string {
  if (html.includes(PREVIEW_GUARD_ID)) return html
  return `${html}\n<script id="${PREVIEW_GUARD_ID}">\n${PREVIEW_GUARD_SOURCE}\n</script>`
}
