/**
 * 宿主字体加载器（v1.89）：core 的 `fontManager` 找不到字面时会问它一句。
 *
 * 两种失败**必须**区别对待，这是这个文件存在的理由：
 * - **404**：这台机器上没有这一族 —— 记下来，别每次重排都再问一遍。
 * - **网络错/5xx**：宿主可能刚好在重启 —— **不许**记，否则这一页从此用不上本地字体
 *   （资产加载器踩过同一个坑：失败的 `null` 被钉死在缓存里，一次抖动＝永久降级）。
 *
 * 另外一条是**接线**：`design-skia.ts` 里预览与导出两条路都要装这条加载器。少装一处，
 * 导出的字就换了，而且不报错。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createHostFontLoader,
  installHostFonts,
  type HostFontLoader,
} from '../../../../../src/client/artifact/viewers/design/design-host-fonts.ts'

/** 一个假 fetch：按 URL 回指定的状态，并记下被问了几次。 */
function fakeFetch(handler: (url: string) => { status: number; bytes?: Uint8Array } | Error) {
  const urls: string[] = []
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input)
    urls.push(url)
    const answer = handler(url)
    if (answer instanceof Error) throw answer
    const body = answer.bytes ?? new Uint8Array(0)
    return {
      status: answer.status,
      ok: answer.status >= 200 && answer.status < 300,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    } as unknown as Response
  }
  return { fetch: impl as unknown as typeof fetch, urls }
}

const LOG = (): void => {}

describe('createHostFontLoader', () => {
  it('200：把字节交出去，URL 上带的是族名与字重（不是路径）', async () => {
    const bytes = new Uint8Array(64).fill(1)
    const fake = fakeFetch(() => ({ status: 200, bytes }))
    const load = createHostFontLoader(fake.fetch, LOG)
    const data = await load('PingFang SC', 'Semibold')
    expect(data?.byteLength).toBe(64)
    expect(fake.urls[0]).toContain('/dsh-canvas/fonts/file?family=PingFang%20SC&style=Semibold')
  })

  it('404 记下来：第二次不再发请求', async () => {
    const fake = fakeFetch(() => ({ status: 404 }))
    const load = createHostFontLoader(fake.fetch, LOG)
    expect(await load('Comic Sans MS', 'Regular')).toBeNull()
    expect(await load('Comic Sans MS', 'Regular')).toBeNull()
    expect(fake.urls).toHaveLength(1)
  })

  it('网络错**不**记：下一次还要试（宿主重启只是暂时的）', async () => {
    const fake = fakeFetch(() => new Error('ECONNREFUSED'))
    const load = createHostFontLoader(fake.fetch, LOG)
    expect(await load('Helvetica', 'Regular')).toBeNull()
    expect(await load('Helvetica', 'Regular')).toBeNull()
    expect(fake.urls).toHaveLength(2)
  })

  it('5xx 也不记：那是宿主的问题，不是「这台机器没这支字体」', async () => {
    const fake = fakeFetch(() => ({ status: 500 }))
    const load = createHostFontLoader(fake.fetch, LOG)
    await load('Helvetica', 'Regular')
    await load('Helvetica', 'Regular')
    expect(fake.urls).toHaveLength(2)
  })

  it('200 但字节太少（不是字体）：当没取到，不抛', async () => {
    const fake = fakeFetch(() => ({ status: 200, bytes: new Uint8Array(4) }))
    expect(await createHostFontLoader(fake.fetch, LOG)('Arial', 'Regular')).toBeNull()
  })

  it('同一族同一字重的并发请求并成一趟', async () => {
    const fake = fakeFetch(() => ({ status: 200, bytes: new Uint8Array(32) }))
    const load = createHostFontLoader(fake.fetch, LOG)
    await Promise.all([load('Arial', 'Regular'), load('Arial', 'Regular'), load('Arial', 'Regular')])
    expect(fake.urls).toHaveLength(1)
  })

  it('不同字重是两条请求（Regular 与 Bold 是两张脸）', async () => {
    const fake = fakeFetch(() => ({ status: 200, bytes: new Uint8Array(32) }))
    const load = createHostFontLoader(fake.fetch, LOG)
    await load('Arial', 'Regular')
    await load('Arial', 'Bold')
    expect(fake.urls).toHaveLength(2)
  })
})

describe('installHostFonts', () => {
  it('把加载器交给调用方（装法由引擎那侧给，这个模块不认识 fontManager）', () => {
    let installed: HostFontLoader | null = null
    installHostFonts((loader) => {
      installed = loader
    })
    expect(typeof installed).toBe('function')
  })
})

describe('接线：预览与导出都装', () => {
  const skia = readFileSync(
    new URL('../../../../../src/client/artifact/viewers/design/design-skia.ts', import.meta.url),
    'utf8',
  )

  it('`createSkiaBackend` 与 `createExportRenderer` 各装一次（同一个幂等入口）', () => {
    // 引擎创建那条路：先 ensureHostFonts() 再 watchFontProgress()。
    expect(skia).toMatch(/ensureHostFonts\(\)\s*\n\s*\/\/ 进度表要早于任何一次取字体/)
    // 导出那条路：createExportRenderer 里也要有。
    const exportBody = skia.slice(skia.indexOf('export async function createExportRenderer'))
    expect(exportBody).toContain('ensureHostFonts()')
    // 只装一次的地方：真正调 setHostFontLoader 的只有 ensureHostFonts。
    expect((skia.match(/installHostFonts\(/g) ?? []).length).toBe(1)
  })
})
