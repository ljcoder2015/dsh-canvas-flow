/**
 * dsh-canvas — the plugin's one ZIP writer.
 *
 * Two features need an archive, for the same reason: a container their consumer
 * already understands. The text export builds `.docx` — an OOXML package, which
 * *is* a ZIP — and the app export builds a `.zip` of an application folder. Both
 * are the same exercise (local file headers, a central directory, an EOCD), so
 * there is one implementation here rather than one per caller: two writers would
 * eventually disagree about the same archive, and the caller that hit the
 * disagreement would be the user opening the file.
 *
 * {@link zipBytes} stores (method 0) and is synchronous, which is what `.docx`
 * wants: Word reads stored entries perfectly, and byte-for-byte determinism
 * keeps the export testable. {@link zipDeflated} adds method 8 for the caller
 * that is handing a person an archive they will actually mail around — and it
 * takes the compressor as an argument, because the two halves of this plugin
 * deflate with different tools (a browser `CompressionStream` on the client, an
 * optional `node:zlib` on the host). The container knows the format; the caller
 * knows the platform.
 */

/** One entry of an archive: a path inside it, and the bytes it carries. */
export interface ZipEntry {
  /** Path inside the archive, `/`-joined and without a leading slash. */
  name: string
  data: Uint8Array
}

/**
 * A compressor, as the platform can offer one.
 *
 * Returns `undefined` when this platform has none, or when the attempt failed.
 * Either way the entry is stored instead: an archive that is larger than it
 * could have been is still an archive, while a failed export is not.
 */
export type ZipDeflate = (bytes: Uint8Array) => Promise<Uint8Array | undefined>

/** ZIP compression methods this writer emits. */
const METHOD_STORE = 0
const METHOD_DEFLATE = 8

/** An entry after its payload has been decided: what lands in the archive. */
interface SealedEntry {
  /** UTF-8 bytes of the entry name, as they are written into both headers. */
  name: Uint8Array
  method: number
  /** The payload as stored — identical to the content when the method is 0. */
  payload: Uint8Array
  /** Uncompressed size, which `zip` records even for a deflated entry. */
  size: number
  /** CRC of the **uncompressed** content — see {@link seal}. */
  crc: number
}

/**
 * Pack entries into an archive, storing every one of them.
 *
 * Entries keep the order they are given, so the same input always yields the
 * same bytes — an export one can assert on rather than merely inspect.
 */
export function zipBytes(entries: readonly ZipEntry[]): Uint8Array {
  return assemble(entries.map((entry) => seal(entry.name, METHOD_STORE, entry.data, entry.data)))
}

/**
 * Pack entries into an archive, deflating what the compressor can shrink.
 *
 * An entry is stored when the compressor has nothing to offer for it — no
 * compressor on this platform, a failure, or a payload that did not get
 * smaller. That last case is not hypothetical: deflate has per-block framing,
 * so a handful of already-compressed bytes comes back *larger*, and an archive
 * that grew would be a worse answer than the one that did not.
 *
 * Entries are still offered to the compressor one at a time rather than in
 * parallel: a directory of app assets is a few hundred files at most, and
 * sequential keeps the archive's byte order — and therefore the export — the
 * same on every run.
 */
export async function zipDeflated(
  entries: readonly ZipEntry[],
  deflate: ZipDeflate,
): Promise<Uint8Array> {
  const sealed: SealedEntry[] = []
  for (const entry of entries) {
    let method = METHOD_STORE
    let payload = entry.data
    try {
      const smaller = await deflate(entry.data)
      if (smaller !== undefined && smaller.byteLength < entry.data.byteLength) {
        method = METHOD_DEFLATE
        payload = smaller
      }
    } catch {
      // A compressor that throws is a compressor this platform does not really
      // have. Store the entry and let the export succeed.
    }
    sealed.push(seal(entry.name, method, payload, entry.data))
  }
  return assemble(sealed)
}

/**
 * Fix one entry's payload, method and checksum.
 *
 * `content` and `payload` are separate because **the CRC belongs to the
 * content, not to the payload**: a deflated entry's checksum is computed over
 * the bytes *before* compression, and so is the size the header records.
 * Getting that wrong produces the worst kind of archive — one that lists its
 * entries, unzips its stored ones, and fails its deflated ones with a bad CRC.
 * (Found exactly that way: `/usr/bin/unzip -t`, see `tests/core/artifact/zip.spec.ts`.)
 */
function seal(name: string, method: number, payload: Uint8Array, content: Uint8Array): SealedEntry {
  return { name: utf8(name), method, payload, size: content.byteLength, crc: crc32(content) }
}

/**
 * Write the three structures a ZIP is: local file headers with their data, the
 * central directory, and the end-of-central-directory record.
 *
 * Every offset in the archive is accumulated here rather than passed in, which
 * is the only thing that makes the format easy to get wrong — a central
 * directory entry pointing at the wrong byte is a file that opens and then
 * refuses one member.
 */
function assemble(entries: readonly SealedEntry[]): Uint8Array {
  const local: Uint8Array[] = []
  const directory: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const { name, payload, crc, size } = entry

    // Local file header: 0x04034b50.
    const head = new Uint8Array(30 + name.byteLength + payload.byteLength)
    const h = new DataView(head.buffer)
    h.setUint32(0, 0x04034b50, true)
    h.setUint16(4, 20, true) // version needed to extract
    h.setUint16(6, 0x0800, true) // general purpose flags: the name is UTF-8
    h.setUint16(8, entry.method, true)
    h.setUint32(10, 0, true) // modification time / date, left zero
    h.setUint32(14, crc, true)
    h.setUint32(18, payload.byteLength, true)
    h.setUint32(22, size, true)
    h.setUint16(26, name.byteLength, true)
    h.setUint16(28, 0, true) // extra field length
    head.set(name, 30)
    head.set(payload, 30 + name.byteLength)
    local.push(head)

    // Central directory entry: 0x02014b50, ending with this entry's offset.
    const item = new Uint8Array(46 + name.byteLength)
    const d = new DataView(item.buffer)
    d.setUint32(0, 0x02014b50, true)
    d.setUint16(4, 20, true) // version made by
    d.setUint16(6, 20, true) // version needed to extract
    d.setUint16(8, 0x0800, true)
    d.setUint16(10, entry.method, true)
    d.setUint32(12, 0, true) // modification time / date
    d.setUint32(16, crc, true)
    d.setUint32(20, payload.byteLength, true)
    d.setUint32(24, size, true)
    d.setUint16(28, name.byteLength, true)
    d.setUint16(30, 0, true) // extra field
    d.setUint16(32, 0, true) // comment
    d.setUint16(34, 0, true) // disk number start
    d.setUint16(36, 0, true) // internal attributes
    d.setUint32(38, 0, true) // external attributes
    d.setUint32(42, offset, true)
    item.set(name, 46)
    directory.push(item)

    offset += head.byteLength
  }

  const directorySize = directory.reduce((sum, item) => sum + item.byteLength, 0)
  // End of central directory: 0x06054b50.
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(4, 0, true)
  e.setUint16(6, 0, true)
  e.setUint16(8, entries.length, true)
  e.setUint16(10, entries.length, true)
  e.setUint32(12, directorySize, true)
  e.setUint32(16, offset, true)
  e.setUint16(20, 0, true)

  return concat([...local, ...directory, end])
}

/** UTF-8 encode a name (node and the browser both have `TextEncoder`). */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Join byte ranges end to end, allocating once rather than copying repeatedly. */
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

/** CRC-32 (IEEE 802.3, the checksum ZIP entries carry). Table built once at load. */
const crc32 = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let value = n
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[n] = value >>> 0
  }
  return (data: Uint8Array): number => {
    let crc = 0xffffffff
    for (let at = 0; at < data.byteLength; at += 1) crc = table[(crc ^ data[at]) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
  }
})()
