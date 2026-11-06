/**
 * The workspace image route (v1.92 图文并茂): registration mirrors the asset
 * route's best-effort rule, and the security gates are pinned because their
 * failure mode is silent — a traversal that serves `~/.ssh/id_rsa` does not
 * throw, it just serves the wrong file to a browser.
 *
 * 两条锚在真磁盘上的判据组（缓存与内容）照 `assets.spec.ts` 的先例：ETag 与 MIME
 * 都与文件本身有关，内存桩答不了。
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { Writable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { ASSET_CACHE_CONTROL, entityTagOf } from '../../src/host/assets.ts'
import { registerWorkspaceRoute } from '../../src/host/workspace-assets.ts'
import { WORKSPACE_ROUTE } from '../../src/contract.ts'

/** The route shape the module hands to the webServer's `register`. */
interface RegisteredRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: unknown, res: unknown) => void
}

/** The slice of the webServer face the module uses. */
interface FakeServer {
  register(route: RegisteredRoute): () => void
}

function fakeCtx(webServer?: FakeServer) {
  const registered: RegisteredRoute[] = []
  const labels: string[] = []
  const ctx = {
    get(name: string) {
      return name === 'webServer' ? webServer : undefined
    },
    inject(_deps: readonly string[], callback: (host: unknown) => void) {
      callback(ctx)
    },
    effect(fn: () => () => void, label: string) {
      labels.push(label)
      return fn()
    },
  }
  return { ctx: ctx as unknown as Context, registered, labels }
}

const recordingServer = (registered: RegisteredRoute[]): FakeServer => ({
  register(route) {
    registered.push(route)
    return () => {}
  },
})

describe('registerWorkspaceRoute', () => {
  it('registers exactly one prefix route when the deployment has a webServer', () => {
    const registered: RegisteredRoute[] = []
    const { ctx, labels } = fakeCtx(recordingServer(registered))
    expect(() => registerWorkspaceRoute(ctx, () => undefined)).not.toThrow()
    expect(registered).toHaveLength(1)
    expect(registered[0]?.kind).toBe('prefix')
    expect(registered[0]?.path).toBe(WORKSPACE_ROUTE)
    expect(labels).toEqual(['dsh-canvas: workspace route'])
  })

  it('waits on inject instead of throwing when there is no webServer yet', () => {
    const { ctx, registered } = fakeCtx()
    expect(() => registerWorkspaceRoute(ctx, () => undefined)).not.toThrow()
    expect(registered).toEqual([])
  })
})

/**
 * 一份真磁盘上的画布项目：`rootOf` 按内存表现查，正好模拟 `CanvasRuntime.rootOf`
 * 的形状——同步、未知 id 交回 `undefined`。
 */
function realProject(projectId: string, files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-workspace-'))
  for (const [name, body] of Object.entries(files)) {
    const path = join(root, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, body)
  }
  const registered: RegisteredRoute[] = []
  const { ctx } = fakeCtx(recordingServer(registered))
  const roots = new Map<string, string>([[projectId, root]])
  registerWorkspaceRoute(ctx, (id) => roots.get(id))
  return { handler: registered[0]?.handler, root }
}

class FakeResponse extends Writable {
  status = 0
  headers: Record<string, string | number> = {}
  private readonly chunks: Buffer[] = []

  writeHead(status: number, headers: Record<string, string | number> = {}): this {
    this.status = status
    Object.assign(this.headers, headers)
    return this
  }

  override _write(chunk: Buffer, _encoding: string, done: () => void): void {
    this.chunks.push(Buffer.from(chunk))
    done()
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8')
  }
}

async function request(
  handler: RegisteredRoute['handler'] | undefined,
  req: { method?: string; url?: string; headers?: Record<string, string> },
): Promise<FakeResponse> {
  const res = new FakeResponse()
  handler?.(req, res)
  await once(res, 'finish')
  return res
}

describe('workspace route: 取图', () => {
  it('serves an image from the project root as its image MIME', async () => {
    const { handler } = realProject('abcdef', { 'images/cover.png': 'PNG-BYTES' })
    const res = await request(handler, { url: `${WORKSPACE_ROUTE}/abcdef/images/cover.png` })
    expect(res.status).toBe(200)
    expect(res.text()).toBe('PNG-BYTES')
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe(ASSET_CACHE_CONTROL)
  })

  it('resolves a reference into a nested folder, URL-decoded', async () => {
    const { handler } = realProject('abcdef', { 'docs/assets/fig 1.jpg': 'JPG-BYTES' })
    const res = await request(handler, { url: `${WORKSPACE_ROUTE}/abcdef/docs/assets/fig%201.jpg` })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
  })

  it('answers 304 on a revalidation hit, and a new ETag when the image is regenerated', async () => {
    const { handler, root } = realProject('abcdef', { 'images/cover.png': 'PNG-BYTES' })
    const first = await request(handler, { url: `${WORKSPACE_ROUTE}/abcdef/images/cover.png` })
    const revalidated = await request(handler, {
      url: `${WORKSPACE_ROUTE}/abcdef/images/cover.png`,
      headers: { 'if-none-match': String(first.headers.etag) },
    })
    expect(revalidated.status).toBe(304)
    expect(revalidated.text()).toBe('')

    writeFileSync(join(root, 'images', 'cover.png'), 'PNG-BYTES-v2')
    const later = new Date(Date.now() + 2000)
    utimesSync(join(root, 'images', 'cover.png'), later, later)
    const again = await request(handler, {
      url: `${WORKSPACE_ROUTE}/abcdef/images/cover.png`,
      headers: { 'if-none-match': String(first.headers.etag) },
    })
    expect(again.status).toBe(200)
    expect(String(again.headers.etag)).not.toBe(String(first.headers.etag))
    expect(again.text()).toBe('PNG-BYTES-v2')
    // ETag 真源就是那两个数：这条判据钉住两边同源，改公式时两处一起变红。
    const { statSync } = await import('node:fs')
    const stat = statSync(join(root, 'images', 'cover.png'))
    expect(again.headers.etag).toBe(entityTagOf(stat.size, stat.mtimeMs))
  })

  it('answers HEAD with headers but no body', async () => {
    const { handler } = realProject('abcdef', { 'cover.png': 'PNG-BYTES' })
    const res = await request(handler, { method: 'HEAD', url: `${WORKSPACE_ROUTE}/abcdef/cover.png` })
    expect(res.status).toBe(200)
    expect(res.text()).toBe('')
    expect(res.headers['content-length']).toBe(String('PNG-BYTES'.length))
  })
})

describe('workspace route: 安检', () => {
  it('refuses non-image extensions, unknown projects, and malformed paths', async () => {
    const { handler } = realProject('abcdef', {
      'secret.txt': 'ROOTED',
      'script.js': 'alert(1)',
      'vector.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    })
    // 非图片扩展名：这条路由是「预览里的插图」，不是项目文件的下载口。
    expect((await request(handler, { url: `${WORKSPACE_ROUTE}/abcdef/secret.txt` })).status).toBe(404)
    expect((await request(handler, { url: `${WORKSPACE_ROUTE}/abcdef/script.js` })).status).toBe(404)
    // SVG 直接导航时是一份会执行脚本的文档：同源 XSS 通道，整族拒绝。
    expect((await request(handler, { url: `${WORKSPACE_ROUTE}/abcdef/vector.svg` })).status).toBe(404)
    // 未知项目、缺段、空段。
    expect((await request(handler, { url: `${WORKSPACE_ROUTE}/zzzzzz/cover.png` })).status).toBe(404)
    expect((await request(handler, { url: `${WORKSPACE_ROUTE}/abcdef` })).status).toBe(404)
    expect((await request(handler, { url: `${WORKSPACE_ROUTE}/` })).status).toBe(404)
  })

  it('refuses traversal in every encoding it can arrive in', async () => {
    const { handler, root } = realProject('abcdef', { 'cover.png': 'PNG-BYTES' })
    // 真根外放一张「秘密」（tmpdir 本身就在根的上一层），穿出去就算失败。
    writeFileSync(join(root, '..', 'secret.png'), 'SECRET')
    for (const url of [
      `${WORKSPACE_ROUTE}/abcdef/../secret.png`,
      `${WORKSPACE_ROUTE}/abcdef/%2e%2e/secret.png`,
      `${WORKSPACE_ROUTE}/abcdef/docs/../../secret.png`,
      `${WORKSPACE_ROUTE}/abcdef/docs/%2e%2e/%2e%2e/secret.png`,
      `${WORKSPACE_ROUTE}/abcdef/..%2fsecret.png`,
    ]) {
      expect((await request(handler, { url })).status).toBe(404)
    }
    // 反斜杠在 POSIX 上是合法文件名，但在 Windows 语义里是分隔符：一并拒绝。
    expect((await request(handler, { url: `${WORKSPACE_ROUTE}/abcdef/docs\\secret.png` })).status).toBe(404)
  })

  it('refuses non-GET methods', async () => {
    const { handler } = realProject('abcdef', { 'cover.png': 'PNG-BYTES' })
    expect((await request(handler, { method: 'PUT', url: `${WORKSPACE_ROUTE}/abcdef/cover.png` })).status).toBe(405)
    expect((await request(handler, { method: 'DELETE', url: `${WORKSPACE_ROUTE}/abcdef/cover.png` })).status).toBe(405)
  })
})
