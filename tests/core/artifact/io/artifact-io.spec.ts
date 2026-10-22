/**
 * The write path's sandbox boundary.
 *
 * A project root is chosen by the user in the folder picker, and it *is* the
 * workspace this plugin writes into — so a mutation must carry that root as its
 * `workspace-write` boundary rather than inherit the standing one. The standing
 * policy holds the deployment fallback root (or a calling session's cwd), and a
 * canvas opened anywhere else is refused outright by the seam's fence
 * (`FS_SANDBOX_DENIED`, "file access denied under workspace-write mode"). A dock
 * click is an agentless write, so it has no session cwd to inherit and hits that
 * refusal every time.
 *
 * The MODE must travel untouched: this layer resolves no escalations, so a
 * `read-only` composition keeps refusing and `danger-full-access` keeps
 * delegating unfenced. `ArtifactIo` is the single junction every write goes
 * through, so the whole policy decision is pinned here rather than at callers.
 *
 * The second half pins the *read* side of the same junction: which artifacts
 * get their local assets inlined before their text becomes a `srcDoc`. That
 * decision used to name one kind instead of the whole HTML family, so a page
 * whose kind came out `site` rather than `webapp` reached the iframe with a
 * `styles.css` it had no way to resolve — rendered unstyled, with nothing in
 * the payload saying why.
 *
 * The third is the one operation that does *not* go through the seam at all
 * (F1.12): `renameEntry` hands the OS a path, so the two guards that make that
 * safe — "this process provably names the same file" and "this deployment
 * permits a mutation here" — are what get pinned, along with the refusal that
 * fires instead of moving somebody else's file.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FsVersion } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { ArtifactIo, VIEW_BYTES_CAP } from '../../../../src/core/artifact/io/artifact-io.ts'
import { PREVIEW_PICKER_ID } from '../../../../src/core/artifact/kind/preview-picker.ts'

/** A project root the user picked outside the agent's own workspace. */
const PROJECT_ROOT = '/projects/flow-test'

/** What a confined composition resolves for an agentless call. */
const STANDING: SandboxExecutionPolicy = { mode: 'workspace-write', workspaceRoot: '/agent/workspace' }

/** One `writeText` call, as the seam saw it. */
interface WriteCall {
  content: string
  intent: unknown
  policy: SandboxExecutionPolicy | undefined
}

/**
 * An `ArtifactIo` over a stub seam that records the policy each write carried.
 *
 * `sandboxPolicy` is resolved by name, so passing `undefined` models a
 * composition whose filesystem does not confine at all.
 */
function harness(standing: SandboxExecutionPolicy | undefined) {
  const calls: WriteCall[] = []
  const ctx = {
    fs: {
      resolve: (path: string) => Promise.resolve({ targetKey: `/resolved/${path}`, displayPath: `/resolved/${path}` }),
      writeText: (
        _target: unknown,
        content: string,
        intent: unknown,
        _signal: unknown,
        policy: SandboxExecutionPolicy | undefined,
      ) => {
        calls.push({ content, intent, policy })
        return Promise.resolve({ operation: 'create' as const, version: FsVersion('v1'), before: null })
      },
    },
    get: (name: string) =>
      name === 'sandboxPolicy' && standing !== undefined ? { resolve: () => standing } : undefined,
  } as unknown as Context
  return { io: new ArtifactIo(ctx), calls }
}

describe('artifact write sandbox policy', () => {
  it('stamps the project root as the workspace-write boundary', async () => {
    const { io, calls } = harness(STANDING)

    await io.write(PROJECT_ROOT, 'untitled.md', '# 未命名\n')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.policy).toEqual({ mode: 'workspace-write', workspaceRoot: PROJECT_ROOT })
  })

  it('leaves the standing root alone when the mode does not read one', async () => {
    for (const mode of ['read-only', 'danger-full-access'] as const) {
      const { io, calls } = harness({ mode, workspaceRoot: '/agent/workspace' })

      await io.write(PROJECT_ROOT, 'untitled.md', '')

      expect(calls[0]?.policy).toEqual({ mode, workspaceRoot: '/agent/workspace' })
    }
  })

  it('passes no policy at all when the composition does not confine', async () => {
    const { io, calls } = harness(undefined)

    await io.write(PROJECT_ROOT, 'untitled.md', '')

    expect(calls[0]?.policy).toBeUndefined()
  })

  it('forwards the version guard and the outcome alongside the policy', async () => {
    const { io, calls } = harness(STANDING)

    const result = await io.write('/proj', 'a.md', 'body', { version: FsVersion('v7') })

    expect(calls[0]?.intent).toEqual({ kind: 'replaceIfVersion', version: 'v7' })
    expect(result).toEqual({ operation: 'create', version: 'v1', before: null })
  })
})

/** The two fields `ArtifactIo` reads off a resolved path. */
interface StubTarget {
  targetKey: string
  displayPath: string
}

/**
 * An `ArtifactIo` over a stub seam backed by an in-memory tree.
 *
 * `view()` classifies *and* reads, so a real seam means files. A tree keyed by
 * card-relative path keeps the test about the inlining decision instead of
 * about a fixture directory, and the directory/entry-page split stays visible
 * in the keys (`site/index.html` beside `site/styles.css`).
 *
 * 值可以是**文本也可以是字节**：媒体产物在磁盘上就是字节，而 seam 的 `readText`
 * 拿到它会解出替换字符（这正是「谁都不该拿文本口读媒体」那条判据要复现的东西）。
 */
function viewHarness(files: Record<string, string | Uint8Array>) {
  const keys = Object.keys(files)
  const target = (key: string): StubTarget => ({ targetKey: key, displayPath: `/root/${key}` })
  const sizeOf = (key: string): number => {
    const value = files[key]
    if (value === undefined) return 0
    return typeof value === 'string' ? value.length : value.byteLength
  }
  const statOf = (key: string) =>
    files[key] === undefined
      ? keys.some((candidate) => candidate.startsWith(`${key}/`))
        ? { type: 'directory' as const, size: 0, version: FsVersion('v1') }
        : undefined
      : { type: 'file' as const, size: sizeOf(key), version: FsVersion('v1') }

  const ctx = {
    fs: {
      resolve: (path: string) => Promise.resolve(target(path)),
      stat: (resolved: StubTarget) => Promise.resolve(statOf(resolved.targetKey)),
      processPath: (resolved: StubTarget) => resolved.displayPath,
      listDir: (resolved: StubTarget) =>
        Promise.resolve(
          keys
            .filter((key) => key.startsWith(`${resolved.targetKey}/`))
            .map((key) => ({ name: key.slice(resolved.targetKey.length + 1).split('/')[0] ?? '' })),
        ),
      readText: (resolved: StubTarget) => {
        const value = files[resolved.targetKey]
        if (value === undefined) return Promise.reject(new Error('FS_NOT_FOUND'))
        // 字节走文本口就是这条路：非致命解码，读得出来、读出来是替换字符（真 seam 同此）。
        return Promise.resolve(typeof value === 'string' ? value : new TextDecoder().decode(value))
      },
      readBytes: (resolved: StubTarget) => {
        const value = files[resolved.targetKey]
        if (value === undefined) return Promise.reject(new Error('FS_NOT_FOUND'))
        return Promise.resolve(typeof value === 'string' ? new TextEncoder().encode(value) : value)
      },
    },
    get: () => undefined,
  } as unknown as Context

  return new ArtifactIo(ctx)
}

describe('artifact view inlining', () => {
  const PAGE = `<!doctype html>
<html>
<head><link rel="stylesheet" href="styles.css"></head>
<body><h1>站点</h1><script src="app.js"></script></body>
</html>`

  it('inlines an app entry page’s own stylesheet and script', async () => {
    const io = viewHarness({
      'site/index.html': PAGE,
      'site/styles.css': 'h1 { color: red; }',
      'site/app.js': 'console.log(1)',
    })

    const view = await io.view('/root', 'site/index.html')

    expect(view.kind).toBe('app')
    expect(view.text).toContain('<style>\nh1 { color: red; }\n</style>')
    expect(view.text).toContain('console.log(1)')
    expect(view.text).not.toContain('href="styles.css"')
  })

  it('resolves a deck’s assets against the deck’s own directory', async () => {
    const io = viewHarness({
      'decks/talk.html': '<section class="slide">一</section><link rel="stylesheet" href="talk.css">',
      'decks/talk.css': '.slide { font-size: 40px; }',
      'talk.css': '.slide { font-size: 1px; }',
    })

    const view = await io.view('/root', 'decks/talk.html')

    expect(view.kind).toBe('app')
    expect(view.text).toContain('font-size: 40px')
    expect(view.text).not.toContain('font-size: 1px')
  })

  it('leaves a page alone when it references nothing local', async () => {
    const remote = '<link rel="stylesheet" href="https://cdn.example.com/x.css">'

    const view = await viewHarness({ 'a.html': remote }).view('/root', 'a.html')

    expect(view.kind).toBe('app')
    // The page's own markup survives untouched — nothing remote is fetched,
    // rewritten or inlined — while the preview link guard is still installed:
    // a relative *link* resolves against the host page in a `srcdoc` iframe
    // exactly as a relative stylesheet reference does, so a page with no local
    // asset can still have a local link to intercept.
    expect(view.text.startsWith(remote)).toBe(true)
    expect(view.text.match(/id="dsh-canvas-link-guard"/g)).toHaveLength(1)
    expect(view.text.trimEnd().endsWith('</script>')).toBe(true)
  })

  it('installs the element probe into the page, after the link guard', async () => {
    // 元素选择（F3.14）要的是「鼠标底下是谁」，而沙箱帧是不透明源——浏览器这半
    // 边看不见帧里的 DOM，只有 host 注入进页面的那段探针看得见。所以它必须出现在
    // 预览文本里，且**在闸门之后**（两段都追加在文末，先闸门后探针）。
    const view = await viewHarness({ 'site/index.html': PAGE }).view('/root', 'site/index.html')

    expect(view.text.match(new RegExp(`id="${PREVIEW_PICKER_ID}"`, 'g'))).toHaveLength(1)
    expect(view.text.indexOf(PREVIEW_PICKER_ID)).toBeGreaterThan(view.text.indexOf('dsh-canvas-link-guard'))
    // 页面自己的字一个字不动，探针也不改动它的开头。
    expect(view.text.startsWith('<!doctype html>')).toBe(true)
  })

  it('does not touch a kind the iframe does not render', async () => {
    const io = viewHarness({ 'notes.md': '# 标题\n\n<link rel="stylesheet" href="s.css">' })

    const view = await io.view('/root', 'notes.md')

    expect(view.kind).toBe('markdown')
    expect(view.text).toContain('href="s.css"')
  })
})

// ── 媒体产物：走二进制通道，并且谁都不许拿文本口读它（F2.7）───────────────────

/** 一段真 mp3 的开头：ID3 头 + 一帧同步字——非 UTF-8 字节，文本口读出来是替换字符。 */
const MP3_HEAD = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x76, 0xff, 0xfb, 0x90, 0x00])

describe('artifact view of a media artifact', () => {
  it('hands the bytes over as a data URL an element can draw', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])

    const view = await viewHarness({ 'hero.png': bytes }).view('/root', 'hero.png')

    expect(view.kind).toBe('image')
    expect(view.text).toBe('')
    expect(view.dataUrl).toBe(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`)
    expect(view.truncated).toBe(false)
  })

  it('refuses past the wire cap instead of sending half a video', async () => {
    // 卡面据此把「太大」当成一**句答案**（`mediaAssetOf` 的 `too-large`），而不是当异常：
    // 半段视频画出来是坏画面，而「太大」至少能让人去别处打开它。
    const view = await viewHarness({ 'clip.mp4': new Uint8Array(VIEW_BYTES_CAP + 1) }).view('/root', 'clip.mp4')

    expect(view.kind).toBe('video')
    expect(view.truncated).toBe(true)
    expect(view.dataUrl).toBe('')
    expect(view.bytes).toBe(VIEW_BYTES_CAP + 1)
  })
})

describe('artifact digest of a media artifact', () => {
  it('never reads a media file through the text channel', async () => {
    // 点在这里：**形态清单只有 `MEDIA_KINDS` 一份**。这句判断原先手写了 image / video
    // 两个名字，加音频时漏了它，于是 mp3 被当文本读——读得出来（非致命解码），读出来是
    // 替换字符，而那串字符会顺着 digest 一路进下游卡片的提示词（F5.2）。不报错，只是脏。
    const summary = await viewHarness({ 'voice.mp3': MP3_HEAD }).summarize('/root', 'voice.mp3', 400)

    expect(summary.kind).toBe('audio')
    expect(summary.summary).not.toContain('ID3')
    expect(summary.summary).not.toContain('\uFFFD')
    expect(summary.outline).toEqual([])
  })

  it('keeps the same promise for the two media kinds that always had it', async () => {
    const summary = await viewHarness({ 'hero.png': MP3_HEAD }).summarize('/root', 'hero.png', 400)

    expect(summary.kind).toBe('image')
    expect(summary.summary).toBe('')
  })
})

// ── renameEntry：唯一一次绕开 seam 的调用（F1.12）─────────────────────────────

/** The `FsError` code a rejected call carried, or `'no error'`. */
async function refusalOf(call: Promise<unknown>): Promise<string> {
  try {
    await call
    return 'no error'
  } catch (error) {
    return String((error as { code?: unknown }).code)
  }
}

/**
 * An `ArtifactIo` over a real temp directory.
 *
 * The rename cannot be faked: its whole point is that a *path* leaves the
 * process, so the only honest test moves a real file. The stub seam mimics the
 * local backend — targets are absolute paths in that directory, and the host
 * path round trip is the identity — which is exactly the composition the
 * guards are calibrated against.
 */
function renameHarness(options: { readonly readOnly?: boolean; readonly mapped?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-canvas-rename-'))
  const local = (path: string, cwd?: string): string => normalize(isAbsolute(path) ? path : join(cwd ?? root, path))
  const ctx = {
    fs: {
      resolve: (path: string, opts?: { cwd?: string }) => {
        const key = local(path, opts?.cwd)
        return Promise.resolve({ targetKey: key, displayPath: key })
      },
      contains: (parent: { targetKey: string }, child: { targetKey: string }) =>
        child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`),
      processPath: (target: { targetKey: string }) => target.targetKey,
      // A backend that serves another execution world answers `undefined` here
      // — which is what the base class itself does, and what the refusal is for.
      processPathFromHostPath: (path: string) =>
        options.mapped === false || !isAbsolute(path) ? undefined : path,
    },
    get: (name: string) =>
      name === 'sandboxPolicy' && options.readOnly === true ? { resolve: () => ({ mode: 'read-only', workspaceRoot: root }) } : undefined,
  } as unknown as Context
  return { io: new ArtifactIo(ctx), root, clean: () => rmSync(root, { recursive: true, force: true }) }
}

describe('artifact rename', () => {
  it('moves a file, extension and all, inside the project root', async () => {
    const h = renameHarness()
    writeFileSync(join(h.root, 'brief.md'), '# 简报\n')

    await h.io.renameEntry(h.root, 'brief.md', '市场分析.md')

    expect(existsSync(join(h.root, 'brief.md'))).toBe(false)
    expect(readFileSync(join(h.root, '市场分析.md'), 'utf8')).toBe('# 简报\n')
    h.clean()
  })

  it('moves a whole app folder, entry page and all', async () => {
    const h = renameHarness()
    mkdirSync(join(h.root, 'myapp'))
    writeFileSync(join(h.root, 'myapp/index.html'), '<!doctype html>')
    writeFileSync(join(h.root, 'myapp/styles.css'), 'h1{}')

    await h.io.renameEntry(h.root, 'myapp', '市场分析')

    expect(existsSync(join(h.root, 'myapp'))).toBe(false)
    expect(readFileSync(join(h.root, '市场分析/index.html'), 'utf8')).toBe('<!doctype html>')
    expect(existsSync(join(h.root, '市场分析/styles.css'))).toBe(true)
    h.clean()
  })

  it('refuses to touch a path when this process cannot prove it names the same file', async () => {
    // A backend serving another execution world: the path it reports belongs to
    // that world, and handing it to this OS would rename whatever sits there.
    const h = renameHarness({ mapped: false })
    writeFileSync(join(h.root, 'brief.md'), '# 简报\n')

    expect(await refusalOf(h.io.renameEntry(h.root, 'brief.md', '市场分析.md'))).toBe('FS_NOT_OBSERVED')
    expect(existsSync(join(h.root, 'brief.md'))).toBe(true)
    h.clean()
  })

  it('refuses to leave the project root', async () => {
    const h = renameHarness()
    writeFileSync(join(h.root, 'brief.md'), '# 简报\n')

    expect(await refusalOf(h.io.renameEntry(h.root, 'brief.md', '../escaped.md'))).toBe('FS_PERMISSION_DENIED')
    expect(existsSync(join(h.root, 'brief.md'))).toBe(true)
    h.clean()
  })

  it('refuses under a read-only deployment, exactly as a write is refused', async () => {
    const h = renameHarness({ readOnly: true })
    writeFileSync(join(h.root, 'brief.md'), '# 简报\n')

    expect(await refusalOf(h.io.renameEntry(h.root, 'brief.md', '市场分析.md'))).toBe('FS_SANDBOX_DENIED')
    expect(existsSync(join(h.root, 'brief.md'))).toBe(true)
    h.clean()
  })

  it('reports a missing source in the seam’s own vocabulary', async () => {
    const h = renameHarness()

    expect(await refusalOf(h.io.renameEntry(h.root, 'gone.md', '市场分析.md'))).toBe('FS_NOT_FOUND')
    h.clean()
  })
})
