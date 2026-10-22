/**
 * 浏览器这半的打包判据（F10.1）。
 *
 * 这一层做两件事：把清单里的两形态（文本 / base64）还原成字节，把它们装进一个 zip，再
 * 交给「保存」那一步。第一件与第三件都在这里钉住；真正把字节存下来的那一步是注入的
 * （`BundleSaver`），所以整个文件在 node 里跑得动——判据是「包里的字节对不对」，那件事
 * 不需要一个浏览器。
 *
 * 压缩那一档连的是**平台**：`CompressionStream('deflate-raw')`。判据在这里核对它给出的
 * 流能被 `node:zlib` 解回原文——两个实现互不相识，对上了才算数。
 */
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { BundleView } from '../../../../src/types.ts'
import { ZIP_MIME, bundleFileBytes, exportBundle, platformDeflate } from '../../../../src/client/canvas/export/bundle-export.ts'
import { readZip, readZipText } from '../../../core/artifact/io/zip-reader.ts'

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/** 一张应用卡片的清单，按判据要的样子改。 */
function bundleView(over: Partial<BundleView> = {}): BundleView {
  return {
    cardId: 'qkxwvd',
    file: '应用1/index.html',
    name: '应用1',
    kind: 'app',
    present: true,
    directory: true,
    files: [
      { path: 'dsh.webapp.json', text: '{"name":"应用1"}', base64: '', bytes: 16 },
      { path: 'index.html', text: '<!doctype html>', base64: '', bytes: 15 },
      // PNG 的完整签名：一个真的二进制条目，不是「看起来像文本的东西」。
      { path: 'logo.png', text: '', base64: 'iVBORw0KGgo=', bytes: 8 },
    ],
    skipped: [],
    bytes: 39,
    truncated: false,
    ...over,
  }
}

/** 一次「保存」，把交出来的字节记下来。 */
function saver() {
  const saved: { name: string; bytes: Uint8Array; mime: string }[] = []
  return {
    saved,
    save: (name: string, bytes: Uint8Array, mime: string) => {
      saved.push({ name, bytes, mime })
    },
  }
}

describe('bundleFileBytes：两个形态各还原成字节', () => {
  it('文本自己编一趟 UTF-8', () => {
    expect(Array.from(bundleFileBytes({ path: 'a.md', text: '你好', base64: '', bytes: 6 }))).toEqual([
      0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd,
    ])
  })

  it('base64 解回原字节（不是「先转成字符串再编一遍」）', () => {
    const raw = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff])

    const round = bundleFileBytes({
      path: 'logo.png',
      text: '',
      base64: Buffer.from(raw).toString('base64'),
      bytes: raw.byteLength,
    })

    expect(Array.from(round)).toEqual(Array.from(raw))
  })
})

describe('exportBundle：出包与拒出包', () => {
  it('目录形态的包住在同名文件夹里，MIME 是 application/zip', async () => {
    const { saved, save } = saver()

    const result = await exportBundle(bundleView(), save)

    expect(result).toEqual({ kind: 'done', name: '应用1.zip', files: 3, bytes: saved[0]?.bytes.byteLength })
    expect(saved[0]?.name).toBe('应用1.zip')
    expect(saved[0]?.mime).toBe(ZIP_MIME)
    const entries = readZip(saved[0]?.bytes ?? new Uint8Array())
    expect(entries.map((entry) => entry.name)).toEqual([
      '应用1/dsh.webapp.json',
      '应用1/index.html',
      '应用1/logo.png',
    ])
    expect(new TextDecoder().decode(entries[1]?.bytes)).toBe('<!doctype html>')
    // 二进制那一条的判据看**字节**：它进包时没有经过任何文本解码。
    expect(Array.from(entries[2]?.bytes ?? new Uint8Array())).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })

  it('单文件形态不套文件夹：包里就是那一个文件', async () => {
    const { saved, save } = saver()

    await exportBundle(
      bundleView({
        file: 'decks/talk.html',
        name: 'talk',
        directory: false,
        files: [{ path: 'talk.html', text: '<!doctype html>', base64: '', bytes: 15 }],
      }),
      save,
    )

    expect(readZipText(saved[0]?.bytes ?? new Uint8Array())).toEqual({ 'talk.html': '<!doctype html>' })
    expect(saved[0]?.name).toBe('talk.zip')
  })

  it('产物还没写就不出包，也不假装出过', async () => {
    const { saved, save } = saver()

    expect(await exportBundle(bundleView({ present: false, files: [] }), save)).toEqual({
      kind: 'refused',
      reason: 'absent',
    })
    expect(saved).toEqual([])
  })

  it('目录里没有可打包的东西时拒出包', async () => {
    const { saved, save } = saver()

    expect(await exportBundle(bundleView({ files: [] }), save)).toEqual({ kind: 'refused', reason: 'empty' })
    expect(saved).toEqual([])
  })

  it('有文件没装下时拒出包——半份不叫导出', async () => {
    const { saved, save } = saver()

    expect(await exportBundle(bundleView({ truncated: true, skipped: ['huge.bin'] }), save)).toEqual({
      kind: 'refused',
      reason: 'truncated',
    })
    expect(saved).toEqual([])
  })

  it('中文内容进了包还是中文（压缩那一路也一样）', async () => {
    const { saved, save } = saver()
    const html = '<h1>你好，世界</h1>\n'.repeat(40)

    await exportBundle(
      bundleView({ files: [{ path: 'index.html', text: html, base64: '', bytes: utf8(html).byteLength }] }),
      save,
    )

    expect(readZipText(saved[0]?.bytes ?? new Uint8Array())).toEqual({ '应用1/index.html': html })
  })
})

describe('platformDeflate：平台的 deflate-raw', () => {
  it('给出的流能被另一个实现解回原文', async () => {
    const body = utf8('const x = 1\n'.repeat(200))

    const compressed = await platformDeflate()(body)

    expect(compressed).toBeDefined()
    expect(new TextDecoder().decode(new Uint8Array(inflateRawSync(compressed ?? new Uint8Array())))).toBe(
      'const x = 1\n'.repeat(200),
    )
  })

  it('平台没有 CompressionStream 时如实说「没有」，而不是给一段坏数据', async () => {
    const original = globalThis.CompressionStream
    // @ts-expect-error 这一条判的就是它不存在时的那条路。
    delete globalThis.CompressionStream
    try {
      expect(await platformDeflate()(utf8('甲'))).toBeUndefined()
    } finally {
      globalThis.CompressionStream = original
    }
  })
})
