/**
 * 本仓唯一那份 ZIP 写入器的判据（`core/artifact/zip.ts`）。
 *
 * 它有两个用户，用途完全不同：`.docx`（一个 OOXML 包，Word 要打开它）与应用节点的
 * `.zip`（用户要解压它）。它们对「包对不对」的答案来自**别人的解压器**，所以这里不
 * 回读自己的写器，而是：
 *
 * 1. 用 `tests/core/artifact/zip-reader.ts`（另一套解析，不回用写入侧任何一行）把包拆开；
 * 2. 再交给系统的 `/usr/bin/unzip` 列清单、校验 CRC、把内容打出来——真机上的那个解压器。
 *
 * 压缩那一档另有两条边界要钉：**压不动就退回 stored**（zip 的方法 8 有块级开销，已经压过
 * 的东西压完反而更大），以及**压缩器抛异常等于没有压缩器**——两条都不能变成一个坏包。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync, crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { zipBytes, zipDeflated } from '../../../../src/core/artifact/io/zip.ts'
import { readZip, readZipText } from './zip-reader.ts'

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/** 一份 `deflate-raw` 压缩器，用 node 自己的 zlib（与写入器没有共享代码）。 */
const nodeDeflate = async (bytes: Uint8Array): Promise<Uint8Array | undefined> =>
  new Uint8Array(deflateRawSync(bytes))

/** macOS 自带的那把 `unzip`，判据拿它当「别人的解压器」。 */
const SYSTEM_UNZIP = '/usr/bin/unzip'

/** macOS 的归档实用工具——用户双击一个 zip 时真正跑的那个实现。 */
const DITTO = '/usr/bin/ditto'

describe('zipBytes：stored 的包', () => {
  it('拆开之后还是那些文件，方法写的是 stored', () => {
    const archive = zipBytes([
      { name: '应用1/index.html', data: utf8('<!doctype html>') },
      { name: '应用1/styles.css', data: utf8('h1 { color: red; }') },
    ])

    const entries = readZip(archive)

    expect(entries.map((entry) => entry.name)).toEqual(['应用1/index.html', '应用1/styles.css'])
    expect(entries.map((entry) => entry.method)).toEqual([0, 0])
    expect(new TextDecoder().decode(entries[0]?.bytes)).toBe('<!doctype html>')
    expect(new TextDecoder().decode(entries[1]?.bytes)).toBe('h1 { color: red; }')
  })

  it('同一份输入永远得到同一份字节', () => {
    const entries = [{ name: 'a.txt', data: utf8('甲') }]

    expect(zipBytes(entries)).toEqual(zipBytes(entries))
  })

  it('空目录也能成为一个（空）包，而不是一个坏包', () => {
    expect(readZip(zipBytes([]))).toEqual([])
  })

  it('条目名按 UTF-8 写，中文名回来还是中文名', () => {
    expect(readZipText(zipBytes([{ name: '设计/草稿.md', data: utf8('# 草稿') }]))).toEqual({
      '设计/草稿.md': '# 草稿',
    })
  })
})

describe('zipDeflated：压得动就压，压不动就存', () => {
  it('压缩器给出的更小流会被用上，内容解回原文', async () => {
    const body = 'console.log("hello")\n'.repeat(200)
    const archive = await zipDeflated([{ name: 'app.js', data: utf8(body) }], nodeDeflate)

    const [entry] = readZip(archive)

    expect(entry?.method).toBe(8)
    // `storedBytes` is what the archive holds; `bytes` is what comes back out.
    expect(entry?.storedBytes).toBeLessThan(entry?.bytes.byteLength ?? 0)
    expect(new TextDecoder().decode(entry?.bytes)).toBe(body)
  })

  it('压缩条目的校验和算的是**原文**，不是压出来的那一段', async () => {
    // The bug this pins: a checksum computed over the *payload* is right for
    // stored entries (payload === content) and wrong for deflated ones, which
    // produces an archive that lists its files and then fails each of them
    // with a bad CRC. The expected value comes from `node:zlib`, a different
    // implementation from the one in `core/artifact/zip.ts`.
    const body = 'const x = 1\n'.repeat(50)
    const archive = await zipDeflated([{ name: 'app.js', data: utf8(body) }, { name: 'raw.txt', data: utf8('甲') }], nodeDeflate)

    const entries = readZip(archive)

    expect(entries[0]?.method).toBe(8)
    expect(entries[0]?.crc).toBe(crc32(Buffer.from(body)))
    expect(entries[1]?.crc).toBe(crc32(Buffer.from('甲')))
  })

  it('压缩器说「没有」（平台没有 CompressionStream）时按 stored 落包', async () => {
    const archive = await zipDeflated([{ name: 'a.txt', data: utf8('甲') }], async () => undefined)

    expect(readZip(archive).map((entry) => entry.method)).toEqual([0])
  })

  it('压缩器抛异常时按 stored 落包，不把整次导出带下水', async () => {
    const archive = await zipDeflated([{ name: 'a.txt', data: utf8('甲') }], async () => {
      throw new Error('no deflate here')
    })

    expect(readZipText(archive)).toEqual({ 'a.txt': '甲' })
  })

  it('压完反而更大时按 stored 落包（块级开销是真的会顶上去）', async () => {
    const archive = await zipDeflated([{ name: 'tiny.txt', data: utf8('甲') }], async (bytes) => {
      // 一个诚实的、但不划算的压缩器：无论输入都给一段更长的流。
      return new Uint8Array(bytes.byteLength + 16)
    })

    const [entry] = readZip(archive)

    expect(entry?.method).toBe(0)
    expect(new TextDecoder().decode(entry?.bytes)).toBe('甲')
  })
})

describe.skipIf(!existsSync(DITTO))('别人的解压器认得这个包', () => {
  it('macOS 的归档实用工具（双击解压）解出那个文件夹、那些文件和那份内容', async () => {
    // 这条判据问的是用户真会走的那一步：把包双击解开。`ditto -x -k` 就是它背后的那个
    // 实现，而它认条目名上的 UTF-8 标志位——`应用1/` 解出来仍是 `应用1/`。
    const dir = mkdtempSync(join(tmpdir(), 'dsh-canvas-zip-'))
    const path = join(dir, '应用1.zip')
    const html = '<!doctype html>\n<h1>你好</h1>\n'
    writeFileSync(
      path,
      await zipDeflated(
        [
          { name: '应用1/index.html', data: utf8(html) },
          { name: '应用1/styles.css', data: utf8('h1 { color: red; }') },
          { name: '应用1/big.js', data: utf8('const x = 1\n'.repeat(400)) },
        ],
        nodeDeflate,
      ),
    )
    const out = join(dir, 'out')
    mkdirSync(out)

    execFileSync(DITTO, ['-x', '-k', path, out])

    expect(readFileSync(join(out, '应用1/index.html'), 'utf8')).toBe(html)
    expect(readFileSync(join(out, '应用1/styles.css'), 'utf8')).toBe('h1 { color: red; }')
    expect(readFileSync(join(out, '应用1/big.js'), 'utf8')).toBe('const x = 1\n'.repeat(400))
    rmSync(dir, { recursive: true, force: true })
  })

  it('unzip -t 逐条校验通过（每条的长度与 CRC 都是对的）', async () => {
    // 这是抓到「校验和算的是压缩后那段」的那条判据：它另算一遍 CRC，于是压缩条目会在这里
    // 报 bad CRC，而包本身照样能列出文件名、解开 stored 的条目——正是最难发现的那种坏。
    const dir = mkdtempSync(join(tmpdir(), 'dsh-canvas-zip-'))
    const path = join(dir, 'app.zip')
    writeFileSync(
      path,
      await zipDeflated(
        [
          { name: 'app/index.html', data: utf8('<!doctype html>') },
          { name: 'app/big.js', data: utf8('const x = 1\n'.repeat(400)) },
        ],
        nodeDeflate,
      ),
    )

    const tested = execFileSync(SYSTEM_UNZIP, ['-t', path], { encoding: 'utf8' })

    expect(tested).toContain('No errors detected')
    // 条目名在这把 2009 年的 Info-ZIP 上会显示成乱码（它的显示编码），与包无关：名字
    // 是否正确的判据在 `readZip` 那几条，以及上面归档实用工具解出来的目录名。
    expect(execFileSync(SYSTEM_UNZIP, ['-p', path, 'app/index.html'], { encoding: 'utf8' })).toBe('<!doctype html>')
    rmSync(dir, { recursive: true, force: true })
  })
})
