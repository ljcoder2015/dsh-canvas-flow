/**
 * 判据用的字体文件：**在内存里现造一份**，不读本机装了什么。
 *
 * 为什么不用真字体：判据要断言的正是「集合里第 3 张脸叫什么」「拆出来的字节能不能再读回来」
 * 这种事——用本机的 `PingFang.ttc` 等于把结论绑在这台机器与这个 macOS 版本上（换台机器就红，
 * 或者更糟：绿着但什么都没验）。所以这里按 sfnt 的规矩拼字节，形状与真文件一致：
 * `ttcf` 头 + 每张脸的表目录 + 表数据，`name` 表里写族名与字重名。
 */

/** 一张脸的设定。 */
export interface FixtureFace {
  family: string
  style: string
  /** 带一张 `fvar` 表（可变字体）。 */
  variable?: boolean
  /** 这批表之后塞这么多 0 字节（用来造一个「很大但只读了几 KB」的文件）。 */
  padding?: number
}

function pad4(value: number): number {
  return (value + 3) & ~3
}

function utf16be(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    bytes[i * 2] = code >> 8
    bytes[i * 2 + 1] = code & 0xff
  }
  return bytes
}

/** 名字表：两条平台 3（Windows，UTF-16BE，英文）的记录，一条给 ID 1/2，一条给 16/17。 */
function nameTable(entries: readonly (readonly [number, string])[]): Uint8Array {
  const headerSize = 6 + entries.length * 12
  const encoded = entries.map(([, text]) => utf16be(text))
  const storageSize = encoded.reduce((total, bytes) => total + bytes.length, 0)
  const table = new Uint8Array(headerSize + storageSize)
  const view = new DataView(table.buffer)
  view.setUint16(0, 0)
  view.setUint16(2, entries.length)
  view.setUint16(4, headerSize)
  let storage = 0
  entries.forEach(([nameId], i) => {
    const rec = 6 + i * 12
    const bytes = encoded[i] as Uint8Array
    view.setUint16(rec, 3)
    view.setUint16(rec + 2, 1)
    view.setUint16(rec + 4, 0x409)
    view.setUint16(rec + 6, nameId)
    view.setUint16(rec + 8, bytes.length)
    view.setUint16(rec + 10, storage)
    table.set(bytes, headerSize + storage)
    storage += bytes.length
  })
  return table
}

/** 一张 54 字节的 `head`：第 8 字节起是 `checkSumAdjustment`（拆表时要重算）。 */
function headTable(): Uint8Array {
  const table = new Uint8Array(54)
  const view = new DataView(table.buffer)
  view.setUint32(0, 0x00010000)
  view.setUint32(12, 0x5f0f3cf5)
  return table
}

interface FaceTable {
  tag: string
  data: Uint8Array
}

function tablesOf(face: FixtureFace): FaceTable[] {
  const tables: FaceTable[] = [
    { tag: 'head', data: headTable() },
    {
      tag: 'name',
      data: nameTable([
        [1, face.family],
        [2, face.style],
        [16, face.family],
        [17, face.style],
      ]),
    },
  ]
  if (face.variable === true) tables.push({ tag: 'fvar', data: new Uint8Array(16) })
  if (face.padding !== undefined) tables.push({ tag: 'zzzz', data: new Uint8Array(face.padding) })
  return tables.sort((left, right) => (left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0))
}

/**
 * 拼一份字体文件：一张脸就是普通 sfnt，多张就是 `ttcf` 集合（与真文件一样，每张脸各有
 * 自己的表目录与表数据）。
 */
export function buildFontFile(faces: readonly FixtureFace[]): Uint8Array {
  if (faces.length === 0) throw new Error('至少要一张脸')
  const perFace = faces.map(tablesOf)
  const dirStart = faces.length > 1 ? 12 + faces.length * 4 : 0
  const dirSizes = perFace.map((tables) => 12 + tables.length * 16)
  const dataStart = dirStart + dirSizes.reduce((total, size) => total + size, 0)

  // 先算每张表的落点。
  let cursor = dataStart
  const placements = perFace.map((tables) =>
    tables.map((table) => {
      const at = cursor
      cursor += pad4(table.data.length)
      return at
    }),
  )
  const total = cursor
  const file = new Uint8Array(total)
  const view = new DataView(file.buffer)

  if (faces.length > 1) {
    const magic = 'ttcf'
    for (let i = 0; i < 4; i += 1) file[i] = magic.charCodeAt(i)
    view.setUint32(4, 0x00010000)
    view.setUint32(8, faces.length)
    let dirAt = dirStart
    perFace.forEach((tables, faceIndex) => {
      view.setUint32(12 + faceIndex * 4, dirAt)
      dirAt += 12 + tables.length * 16
    })
  }

  perFace.forEach((tables, faceIndex) => {
    const dirOffset = faces.length > 1 ? (view.getUint32(12 + faceIndex * 4) as number) : 0
    view.setUint32(dirOffset, 0x00010000)
    view.setUint16(dirOffset + 4, tables.length)
    const entrySelector = Math.floor(Math.log2(tables.length))
    const searchRange = 16 * 2 ** entrySelector
    view.setUint16(dirOffset + 6, searchRange)
    view.setUint16(dirOffset + 8, entrySelector)
    view.setUint16(dirOffset + 10, tables.length * 16 - searchRange)

    tables.forEach((table, tableIndex) => {
      const rec = dirOffset + 12 + tableIndex * 16
      for (let p = 0; p < 4; p += 1) file[rec + p] = table.tag.charCodeAt(p)
      // 校验和留 0：判据不看它（拆表时是照抄的，两边一致就够）。
      view.setUint32(rec + 4, 0)
      view.setUint32(rec + 8, placements[faceIndex]?.[tableIndex] ?? 0)
      view.setUint32(rec + 12, table.data.length)
      file.set(table.data, placements[faceIndex]?.[tableIndex] ?? 0)
    })
  })

  return file
}

/** 一份「读文件某一段」的能力，并且**记下都读了哪些段**（判「只读了几 KB」用）。 */
export function memoryReader(file: Uint8Array): {
  read: (offset: number, length: number) => Promise<Uint8Array>
  reads: { offset: number; length: number }[]
  bytesRead: () => number
} {
  const reads: { offset: number; length: number }[] = []
  return {
    reads,
    read: async (offset, length) => {
      reads.push({ offset, length })
      const end = Math.min(file.length, offset + length)
      return file.subarray(Math.max(0, offset), Math.max(0, end))
    },
    bytesRead: () => reads.reduce((total, entry) => total + entry.length, 0),
  }
}
