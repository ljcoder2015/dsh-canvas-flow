/**
 * 一个最小的 zip 读器，只给判据用。
 *
 * 导出那一侧写的是字节，而「写出来的字节是不是一个**能被解开的**包」不能靠回读自己的
 * 写器来证明——同一处误解放进读器里，判据就会对错的东西点两次头。所以这里的读法是
 * 按规范从**结尾**开始：先在尾部找 EOCD（`0x06054b50`），顺着它给的偏移读中央目录，
 * 再由每个条目的本地头偏移取数据；deflate 的条目用 `node:zlib` 的 `inflateRawSync` 解
 * ——那是**另一个实现**，与 `core/artifact/zip.ts` 的写入侧没有共享的代码。
 *
 * 真机上还有一层：`tests/core/artifact/zip.spec.ts` 里有一条判据把包交给系统的
 * `/usr/bin/unzip`，让它自己列清单、校验 CRC、把内容打出来。
 */
import { inflateRawSync } from 'node:zlib'

/** One entry as it comes back out of an archive. */
export interface ReadEntry {
  name: string
  /** The compression method the archive recorded. */
  method: number
  /** How many bytes the archive actually stores for this entry. */
  storedBytes: number
  /** The checksum the central directory recorded for this entry. */
  crc: number
  /** The entry's content, decompressed. */
  bytes: Uint8Array
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

/** Find the byte offset of the end-of-central-directory record. */
function eocdOffset(view: DataView): number {
  for (let at = view.byteLength - 22; at >= 0; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at
  }
  throw new Error('no end-of-central-directory record: not a ZIP')
}

/** Parse an archive into its entries, in the order the central directory lists them. */
export function readZip(archive: Uint8Array): ReadEntry[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const end = eocdOffset(view)
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const entries: ReadEntry[] = []

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new Error(`central directory corrupt at ${String(at)}`)
    const method = view.getUint16(at + 10, true)
    const crc = view.getUint32(at + 16, true)
    const compressed = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const localAt = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(archive.subarray(at + 46, at + 46 + nameLength))

    if (view.getUint32(localAt, true) !== LOCAL_SIGNATURE) throw new Error(`local header missing for ${name}`)
    const localName = view.getUint16(localAt + 26, true)
    const localExtra = view.getUint16(localAt + 28, true)
    const dataAt = localAt + 30 + localName + localExtra
    const payload = archive.subarray(dataAt, dataAt + compressed)

    entries.push({
      name,
      method,
      storedBytes: compressed,
      crc,
      bytes: method === 8 ? new Uint8Array(inflateRawSync(payload)) : new Uint8Array(payload),
    })
    at += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

/** The entries as a name → text map, for archives of text files. */
export function readZipText(archive: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readZip(archive)) out[entry.name] = new TextDecoder().decode(entry.bytes)
  return out
}
