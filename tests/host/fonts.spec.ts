/**
 * 本地字体那条路由（v1.89）：扫盘、拆集合、按族名取字节。
 *
 * 三条判据是这一层的全部理由：
 * - **扫描走真磁盘**：读什么目录、认哪些后缀、坏文件怎么跳过，内存桩答不了。
 * - **请求里的字符串永远不变成路径**：路由只认 `?family=` / `?style=` 两个键去查扫描时
 *   建好的表；`family=../../etc/passwd` 的答案是 404，而不是「去读那个文件」。
 * - **没有 HTTP 面的部署不炸**：与资产路由同一条规矩（`ctx.get` 而不是属性访问，
 *   没有服务就等 `inject`）——这条曾经让 `dsh web` 在加载期整棵插件树没了。
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FONT_ROUTE } from '../../src/core/font/route.ts'
import { createFontLibrary, filenameCandidates, registerFontRoute, serveFontRequest, systemFontDirs } from '../../src/host/fonts.ts'
import type { RouteRequest, RouteResponse, WebServerFace } from '../../src/host/web-server.ts'
import { buildFontFile } from '../fixtures/font.ts'

interface RegisteredRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: RouteRequest, res: RouteResponse) => void
}

function fakeCtx(webServer?: WebServerFace) {
  const registered: RegisteredRoute[] = []
  const labels: string[] = []
  const ctx = {
    get: (name: string) => (name === 'webServer' ? webServer : undefined),
    inject: (_deps: readonly string[], callback: (host: unknown) => void) => callback(ctx),
    effect: (fn: () => () => void, label: string) => {
      labels.push(label)
      return fn()
    },
  }
  return { ctx: ctx as unknown as Context, registered, labels }
}

const recordingServer = (registered: RegisteredRoute[]): WebServerFace => ({
  register(route) {
    registered.push(route as RegisteredRoute)
    return () => {}
  },
})

/** 一个能收 body 的假响应：`end` 到了就算这一趟完了（处理函数是异步的）。 */
interface FakeRes {
  status: number
  headers: Record<string, string | number>
  writeHead(status: number, headers?: Record<string, string | number>): FakeRes
  end(body?: unknown): FakeRes
}

function fakeResponse() {
  const chunks: (string | Uint8Array)[] = []
  let release: () => void = () => {}
  const done = new Promise<void>((resolve) => {
    release = resolve
  })
  const res: FakeRes = {
    status: 0,
    headers: {},
    writeHead(status, headers = {}) {
      res.status = status
      Object.assign(res.headers, headers)
      return res
    },
    end(body) {
      if (body !== undefined) chunks.push(body as string | Uint8Array)
      release()
      return res
    },
  }
  const text = (): string =>
    chunks.map((chunk) => (typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))).join('')
  const bytes = (): Uint8Array => {
    const parts = chunks.filter((chunk): chunk is Uint8Array => typeof chunk !== 'string')
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
    const merged = new Uint8Array(total)
    let at = 0
    for (const part of parts) {
      merged.set(part, at)
      at += part.byteLength
    }
    return merged
  }
  return { res, done, text, bytes }
}

async function request(handler: RegisteredRoute['handler'], url: string, method = 'GET') {
  const fake = fakeResponse()
  handler({ method, url } as RouteRequest, fake.res)
  await fake.done
  return fake
}

/** 一份真磁盘字体目录：`<tmp>/fonts/`（外加一层子目录，扫盘要能进得去）。 */
function tempFontDir(files: Record<string, Uint8Array>) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fonts-'))
  for (const [name, bytes] of Object.entries(files)) {
    const path = join(root, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, bytes)
  }
  return root
}

const pingfang = (): Uint8Array =>
  buildFontFile([
    { family: 'PingFang HK', style: 'Regular', padding: 40_000 },
    { family: 'PingFang TC', style: 'Regular', padding: 40_000 },
    { family: 'PingFang SC', style: 'Regular', padding: 40_000 },
  ])

describe('systemFontDirs', () => {
  it('macOS：系统目录 + Supplemental + 用户目录', () => {
    const dirs = systemFontDirs('darwin', {}, '/Users/me')
    expect(dirs).toContain('/System/Library/Fonts')
    expect(dirs).toContain('/System/Library/Fonts/Supplemental')
    expect(dirs).toContain('/Users/me/Library/Fonts')
  })

  it('Windows：跟着 SystemRoot 与 LOCALAPPDATA 走（不写死 C 盘）', () => {
    const dirs = systemFontDirs('win32', { SystemRoot: 'D:\\Win', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'C:\\Users\\me')
    expect(dirs[0]?.replace(/\\/g, '/')).toContain('D:/Win/Fonts')
    expect(dirs.some((dir) => dir.replace(/\\/g, '/').includes('Microsoft/Windows/Fonts'))).toBe(true)
  })

  it('Linux：/usr/share/fonts 与用户目录', () => {
    const dirs = systemFontDirs('linux', {}, '/home/me')
    expect(dirs).toContain('/usr/share/fonts')
    expect(dirs).toContain('/home/me/.local/share/fonts')
  })
})

describe('createFontLibrary', () => {
  it('扫两层目录，认 ttf/ttc，跳过 woff 与隐藏文件', async () => {
    const root = tempFontDir({
      'PingFang.ttc': pingfang(),
      'sub/Helvetica.ttf': buildFontFile([{ family: 'Helvetica', style: 'Bold' }]),
      'Web.woff': new Uint8Array(64),
      '.hidden.ttf': buildFontFile([{ family: 'Hidden', style: 'Regular' }]),
    })
    const library = createFontLibrary([root])
    await library.ready()
    const snapshot = await library.families()
    expect(snapshot.pending).toBe(false)
    expect(snapshot.families.map((entry) => entry.family)).toEqual(['Helvetica', 'PingFang HK', 'PingFang SC', 'PingFang TC'])
  })

  it('清单是分批长出来的：第一次问带 `pending`，后台扫完再问就齐了', async () => {
    const root = tempFontDir({ 'Helvetica.ttf': buildFontFile([{ family: 'Helvetica', style: 'Regular' }]) })
    const library = createFontLibrary([root])
    const first = await library.families()
    // 第一次问就把后台那一趟发出去：要么已经扫完（快机器），要么明确说还在扫。
    expect(first.pending || first.families.length === 1).toBe(true)
    await library.ready()
    expect((await library.families()).pending).toBe(false)
  })

  it('取一张脸：集合会拆开（拿到的是简体那张，不是第 0 张）', async () => {
    const root = tempFontDir({ 'PingFang.ttc': pingfang() })
    const library = createFontLibrary([root])
    const found = await library.read('PingFang SC', 'Regular')
    expect(found?.face.index).toBe(2)
    expect(found?.face.family).toBe('PingFang SC')
    // 拆过的字节：比原文件小（三张脸变一张），且不再是集合。
    const fileSize = pingfang().length
    expect(found?.bytes.byteLength).toBeLessThan(fileSize)
    expect(String.fromCharCode(...(found?.bytes.subarray(0, 4) ?? []))).not.toBe('ttcf')
  })

  it('取脸**不等**后台扫（走文件名预筛）：新建的库第一次取就已经能用', async () => {
    const root = tempFontDir({
      'PingFang.ttc': pingfang(),
      'Other.ttf': buildFontFile([{ family: 'Other', style: 'Regular' }]),
    })
    const library = createFontLibrary([root])
    // 没调用过 families()/ready()：索引根本没开始建。
    const found = await library.read('PingFang SC', 'Regular')
    expect(found?.face.family).toBe('PingFang SC')
  })

  it('取不到就是 null：这台机器没有的族、空族名', async () => {
    const root = tempFontDir({ 'Helvetica.ttf': buildFontFile([{ family: 'Helvetica', style: 'Regular' }]) })
    const library = createFontLibrary([root])
    expect(await library.read('Comic Sans MS', 'Regular')).toBeNull()
    expect(await library.read('', 'Regular')).toBeNull()
  })

  it('目录不存在也不抛（Linux 上那条 ~/.fonts 常常没有）', async () => {
    const library = createFontLibrary([join(tmpdir(), 'dsh-fonts-does-not-exist-xyz')])
    await library.ready()
    expect((await library.families()).families).toEqual([])
  })
})

describe('取脸的代价（真机踩出来的两条）', () => {
  it('同一个文件不会被开两次：后台扫描与一次取脸撞上时共享在飞的那一支', async () => {
    const root = tempFontDir({ 'PingFang.ttc': pingfang() })
    const opened: string[] = []
    const library = createFontLibrary([root], {
      scan: async (path) => {
        opened.push(path)
        // 慢一点，好让「取脸」与「后台扫」真的重叠（真机上这两件事就是重叠的）。
        await new Promise((resolve) => setTimeout(resolve, 20))
        return {
          path,
          size: 1,
          collection: true,
          faces: [{ index: 2, family: 'PingFang SC', style: 'Regular', weight: 400, italic: false, variable: false }],
        }
      },
    })
    const [found, all] = await Promise.all([library.read('PingFang SC', 'Regular'), library.files()])
    expect(found?.face.family).toBe('PingFang SC')
    expect(all).toHaveLength(1)
    expect(opened).toHaveLength(1)
  })

  it('以 `.` 开头的系统内部别名不进下拉框', async () => {
    const root = tempFontDir({
      'System.ttc': buildFontFile([
        { family: '.Apple Color Emoji UI', style: 'Regular' },
        { family: 'Helvetica', style: 'Regular' },
      ]),
    })
    const library = createFontLibrary([root])
    await library.ready()
    const families = (await library.families()).families.map((entry) => entry.family)
    expect(families).toEqual(['Helvetica'])
    // 「不显示」不等于「取不到」：文档里真写了这个名字，照样能把那张脸给出去。
    expect((await library.read('.Apple Color Emoji UI', 'Regular'))?.face.family).toBe('.Apple Color Emoji UI')
  })
})

describe('filenameCandidates', () => {
  const paths = [
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/Helvetica.ttc',
    '/Library/Fonts/HelveticaNeue.ttf',
    '/Library/Fonts/Songti.ttc',
    '/Library/Fonts/ComicSansMS.ttf',
  ]

  it('文件名主干是族名的一部分：`PingFang.ttc` ↔ `PingFang SC`', () => {
    expect(filenameCandidates(paths, 'PingFang SC')[0]).toBe('/System/Library/Fonts/PingFang.ttc')
    expect(filenameCandidates(paths, 'Songti SC')[0]).toBe('/Library/Fonts/Songti.ttc')
  })

  it('文件名比族名更具体时也能挑出来（`Helvetica Neue` → HelveticaNeue）', () => {
    const found = filenameCandidates(paths, 'Helvetica Neue')
    // 归一后相等的那个排第一，而不是先开 Helvetica.ttc。
    expect(found[0]).toBe('/Library/Fonts/HelveticaNeue.ttf')
  })

  it('不相关的一律不进候选（预筛只决定开哪几个文件，答案仍由族名比对给）', () => {
    expect(filenameCandidates(paths, 'Inter')).toEqual([])
    expect(filenameCandidates(paths, '')).toEqual([])
  })
})

describe('本地字体路由', () => {
  const setup = () => {
    const root = tempFontDir({
      'PingFang.ttc': pingfang(),
      'Helvetica.ttf': buildFontFile([{ family: 'Helvetica', style: 'Regular' }]),
    })
    const registered: RegisteredRoute[] = []
    const { ctx, labels } = fakeCtx(recordingServer(registered))
    registerFontRoute(ctx, createFontLibrary([root]))
    return { registered, labels, handler: registered[0]?.handler }
  }

  it('挂一条前缀路由，标签与路径都对', () => {
    const { registered, labels } = setup()
    expect(registered).toHaveLength(1)
    expect(registered[0]?.kind).toBe('prefix')
    expect(registered[0]?.path).toBe(FONT_ROUTE)
    expect(labels).toEqual(['dsh-canvas: local font route'])
  })

  it('没有 webServer 的部署：等 inject，不抛', () => {
    const { ctx, registered } = fakeCtx()
    expect(() => registerFontRoute(ctx)).not.toThrow()
    expect(registered).toEqual([])
  })

  it('`/list` 回族名与字重（`?wait=` 让宿主等一会儿后台扫描）', async () => {
    const { handler } = setup()
    // 不带 `wait` 时路由**立即**回答（那时清单可能还是空的）——这是有意的：面板不能等；
    // 它带着 `wait` 来问第一趟，之后按 `pending` 轮询。
    const response = await request(handler as RegisteredRoute['handler'], `${FONT_ROUTE}/list?wait=3000`)
    expect(response.res.status).toBe(200)
    const body = JSON.parse(response.text()) as {
      families: { family: string; weights: number[] }[]
      pending: boolean
    }
    expect(body.families).toContainEqual({ family: 'Helvetica', weights: [400] })
    expect(body.families.find((entry) => entry.family === 'PingFang SC')?.weights).toEqual([400])
    expect(body.pending).toBe(false)
  })

  it('`/file` 回一张脸的字节，MIME 与长度都对', async () => {
    const { handler } = setup()
    const response = await request(
      handler as RegisteredRoute['handler'],
      `${FONT_ROUTE}/file?family=PingFang%20SC&style=Regular`,
    )
    expect(response.res.status).toBe(200)
    expect(response.res.headers['content-type']).toBe('font/ttf')
    expect(Number(response.res.headers['content-length'])).toBe(response.bytes().byteLength)
    expect(response.bytes().byteLength).toBeGreaterThan(0)
  })

  it('没有这一族就 404；没带族名就 400', async () => {
    const { handler } = setup()
    const missing = await request(handler as RegisteredRoute['handler'], `${FONT_ROUTE}/file?family=Nope`)
    expect(missing.res.status).toBe(404)
    const empty = await request(handler as RegisteredRoute['handler'], `${FONT_ROUTE}/file?style=Regular`)
    expect(empty.res.status).toBe(400)
  })

  it('请求里的字符串不会变成路径：`family=../../etc/passwd` 是 404', async () => {
    const { handler } = setup()
    const traversal = await request(handler as RegisteredRoute['handler'], `${FONT_ROUTE}/file?family=../../etc/passwd`)
    expect(traversal.res.status).toBe(404)
    // 路径式的子路由也不认（这条路由只有 `/list` 与 `/file`）。
    const pathish = await request(handler as RegisteredRoute['handler'], `${FONT_ROUTE}/file/../../etc/passwd`)
    expect(pathish.res.status).toBe(404)
  })

  it('别的方法 405', async () => {
    const { handler } = setup()
    const response = await request(handler as RegisteredRoute['handler'], `${FONT_ROUTE}/list`, 'PUT')
    expect(response.res.status).toBe(405)
  })

  it('HEAD 只回头不回正文', async () => {
    const fake = fakeResponse()
    serveFontRequest({ method: 'HEAD', url: `${FONT_ROUTE}/list` }, fake.res, createFontLibrary([]))
    await fake.done
    expect(fake.res.status).toBe(200)
    expect(fake.text()).toBe('')
  })
})
