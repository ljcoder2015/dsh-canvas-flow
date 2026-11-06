/**
 * dsh-canvas — 一个字面文件里「这张脸叫什么」（F2.6 排版，v1.89）。
 *
 * 「读电脑本地字体」听起来像一句 `readFile`，实际要回答的是**三件不同的事**：
 *
 * 1. **这份文件里有哪些脸**。`.ttc`（字体集合）一个文件装几十张脸：本机 `PingFang.ttc`
 *    有 36 张，第 0 张是 `PingFang HK`、第 2 张才是 `PingFang SC`。只按文件名猜，
 *    「苹方 简体」会拿到港版字形——笔画写法不一样，而且**不报错**。
 * 2. **每张脸自称什么、什么字重**。这些只写在 `name` 表里（ID 1/2 老式，ID 16/17 有则
 *    更准），文件名能骗人（`Helvetica.ttc` 里还有 `Helvetica Light`）。
 * 3. **要交给 CanvasKit 的是哪一段字节**。它只认单张脸的文件（`TypefaceFontProvider`
 *    没有 TTC 索引参数），所以集合必须**拆出那一张**——见 `extractFace`。
 *
 * 这个模块只跟字节打交道：不读磁盘、不认路径，宿主那边给什么读什么（`FontRead`）。这样
 * 判据能用一段内存里的字节把三件事全走一遍，不必依赖这台机器装了哪些字体。
 *
 * 「读一点就够」是刻意的：一个 74MB 的 TTC 只为了知道族名就整份读进内存，扫一遍字体目录
 * 就是几个 GB。`readFontFaces` 只取文件头（表目录所在）与 `name` 表那几 KB。
 */

/** 一张脸的自我介绍。`index` 是它在集合里的序号（单张文件恒为 0）。 */
export interface FontFaceInfo {
  index: number
  /** 族名（`name` ID 16，没有则 ID 1）。空字符串的脸不返回。 */
  family: string
  /** 字重名（`name` ID 17，没有则 ID 2）：`Regular` / `Bold` / `Light Oblique`… */
  style: string
  /** 由 `style` 折出来的字重数值（400、700…）。CanvasKit 不读它，面板的字重档用。 */
  weight: number
  italic: boolean
  /** 带 `fvar` 表＝可变字体：一支文件涵盖整条字重轴。 */
  variable: boolean
}

/**
 * 「读文件某一段」的能力。
 *
 * 参数是**绝对偏移与长度**，返回的字节数组 `[0]` 必须对应 `offset` —— 宿主那边就是
 * `fh.read(buf, 0, length, offset)`，判据那边是一段内存的 `subarray`。这个约定不写清楚，
 * 表目录一落到「已经读进内存的文件头里」就会整体错位（读到的 `numTables` 是隔壁表的值）。
 */
export type FontRead = (offset: number, length: number) => Promise<Uint8Array>

/** 文件头读这么多：TTC 的 36 个表目录（每个 12 + 16×表数）也在这个范围里。 */
const HEAD_BYTES = 64 * 1024

/** 表数的上限：真字体最复杂的也就几十张表，超了就是文件坏了（别让一个坏头把内存吃光）。 */
const MAX_TABLES = 512

/** 集合里最多认这么多张脸：本机最大的 TTC 是 36 张，64 已经很宽松了。 */
const MAX_FACES = 64

interface TableRecord {
  tag: string
  /** 原表自带的校验和：拆表时表内容一字不改，这个值仍然成立（重算要读整张表，没必要）。 */
  checksum: number
  /** 相对**文件开头**的偏移（sfnt 里存的就是绝对值，拆表时直接照抄）。 */
  offset: number
  length: number
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function u16(bytes: Uint8Array, at: number): number {
  return viewOf(bytes).getUint16(at)
}

function u32(bytes: Uint8Array, at: number): number {
  return viewOf(bytes).getUint32(at)
}

function tagAt(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0)
}

/**
 * 「第 offset 段字节，长度 length」——落在已经读进来的文件头里就直接切，否则去问读取器。
 *
 * 返回值的下标 0 **永远**是 `offset`（见 `FontRead` 的注释）。文件头那条捷径必须切成
 * `subarray(offset, …)`，直接把 `head` 递出去的话，表目录里的相对下标会整体偏 `offset`。
 */
interface ReadWindow {
  at(offset: number, length: number): Promise<Uint8Array>
}

function windowOf(read: FontRead, head: Uint8Array): ReadWindow {
  return {
    async at(offset: number, length: number): Promise<Uint8Array> {
      if (offset < 0 || length <= 0) return new Uint8Array(0)
      if (offset + length <= head.length) return head.subarray(offset, offset + length)
      return read(offset, length)
    },
  }
}

/**
 * 各张脸的表目录在哪：单张文件就是 0，集合（`ttcf`）按头部那张偏移表逐个给。
 *
 * 只看头 12 字节 + 偏移表，所以再大的 TTC 这一步也是常数开销。
 */
function faceOffsets(head: Uint8Array): number[] | null {
  if (head.length < 12) return null
  if (tagAt(head, 0) !== 'ttcf') {
    // 单张文件的 sfnt 版本有四种写法：0x00010000（TrueType）、`true`、`OTTO`（CFF）、
    // `typ1`（老 PostScript）。认不出就别猜——猜错的表现是「这个族在列表里不见了」。
    const tag = tagAt(head, 0)
    if (tag !== 'true' && tag !== 'OTTO' && tag !== 'typ1' && u32(head, 0) !== 0x00010000) return null
    return [0]
  }
  const count = u32(head, 8)
  if (count === 0 || count > MAX_FACES) return null
  if (12 + count * 4 > head.length) return null
  const offsets: number[] = []
  for (let i = 0; i < count; i += 1) offsets.push(u32(head, 12 + i * 4))
  return offsets
}

async function tableRecords(window: ReadWindow, dirOffset: number): Promise<TableRecord[] | null> {
  const head = await window.at(dirOffset, 12)
  if (head.length < 12) return null
  const count = u16(head, 4)
  if (count === 0 || count > MAX_TABLES) return null
  const dir = await window.at(dirOffset, 12 + count * 16)
  if (dir.length < 12 + count * 16) return null
  const records: TableRecord[] = []
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16
    records.push({
      tag: tagAt(dir, at),
      checksum: u32(dir, at + 4),
      offset: u32(dir, at + 8),
      length: u32(dir, at + 12),
    })
  }
  return records
}

/**
 * `name` 表里那几行字。
 *
 * 编码：平台 3（Windows）与平台 0（Unicode）都是 UTF-16BE；平台 1（Macintosh）是单字节
 * 编码，按 Latin-1 解——本机的拉丁字体全是平台 3，平台 1 只在很老的文件里出现，解成 Latin-1
 * 已经够认出族名（真要用非拉丁的 Mac 编码，那支字体的族名本来就认不出来，退回文件名更好）。
 *
 * **英语优先**：同一张表里往往同时有 ja/zh/ko 的名字（本机 `PingFang.ttc` 就有「苹方-简」），
 * 谁先到谁赢的话，面板上会出现本地化写法，而文档里记的族名是英文——两者对不上就等于选不中。
 */
function parseNames(table: Uint8Array): Map<number, string> {
  const names = new Map<number, string>()
  const english = new Set<number>()
  if (table.length < 6) return names
  const count = u16(table, 2)
  const storage = u16(table, 4)
  for (let i = 0; i < count; i += 1) {
    const rec = 6 + i * 12
    if (rec + 12 > table.length) break
    const platform = u16(table, rec)
    const language = u16(table, rec + 4)
    const nameId = u16(table, rec + 6)
    const length = u16(table, rec + 8)
    const offset = u16(table, rec + 10)
    const start = storage + offset
    if (start + length > table.length) continue
    const text = decodeName(table, start, length, platform)
    if (text === null) continue
    const isEnglish = platform === 3 && language === 0x409
    if (!names.has(nameId) || (isEnglish && !english.has(nameId))) {
      names.set(nameId, text)
      if (isEnglish) english.add(nameId)
      else english.delete(nameId)
    }
  }
  return names
}

/**
 * 一条名字记录 → 字符串。
 *
 * 编码：平台 3（Windows）与平台 0（Unicode）都是 UTF-16BE；平台 1（Macintosh）是单字节
 * 编码，按 Latin-1 解——本机的拉丁字体全是平台 3，平台 1 只在很老的文件里出现，解成 Latin-1
 * 已经够认出族名（真要用非拉丁的 Mac 编码，那支字体的族名本来就认不出来，退回文件名更好）。
 */
function decodeName(bytes: Uint8Array, start: number, length: number, platform: number): string | null {
  let text = ''
  if (platform === 0 || platform === 3) {
    for (let p = 0; p + 1 < length; p += 2) text += String.fromCharCode(u16(bytes, start + p))
  } else if (platform === 1) {
    for (let p = 0; p < length; p += 1) text += String.fromCharCode(bytes[start + p] ?? 0)
  } else {
    return null
  }
  // 有些写器把 UTF-16 的结尾 0 也算进长度里（`PingFang.ttc` 就是）。不用正则：`\u0000`
  // 在 lint 里算控制字符，而这里要的只是「从末尾去掉那几个 0」。
  let end = text.length
  while (end > 0 && text.charCodeAt(end - 1) === 0) end -= 1
  const trimmed = text.slice(0, end).trim()
  return trimmed === '' ? null : trimmed
}

/** 字重名折数值。顺序要紧：`ExtraBold` 里也有 `Bold`，先认长的。 */
const WEIGHT_TOKENS: readonly (readonly [RegExp, number])[] = [
  [/thin/i, 100],
  [/extra\s*light|ultra\s*light/i, 200],
  [/semi\s*light|demi\s*light/i, 350],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi\s*bold|demi\s*bold/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
]

/** `Regular` / `Bold` / `Light Oblique` → 400 / 700 / 300。认不出就是 400。 */
export function styleWeight(style: string): number {
  for (const [pattern, weight] of WEIGHT_TOKENS) if (pattern.test(style)) return weight
  return 400
}

/** `Italic` 与 `Oblique` 是同一种倾斜，CanvasKit 只吃「斜不斜」这一位。 */
export function styleItalic(style: string): boolean {
  return /italic|oblique/i.test(style)
}

/**
 * 一个字体文件里有哪些脸（只读文件头与 `name` 表）。
 *
 * 读不出来（不是字体、表目录越界、`name` 表缺失）就返回空数组：**不抛**。字体目录里躺着
 * 半截下载的文件、`.ttf` 后缀的别的东西（本机 `Supplemental` 里真有），一个坏文件不该让
 * 整份列表消失。
 */
export async function readFontFaces(read: FontRead, size: number): Promise<FontFaceInfo[]> {
  if (size <= 0) return []
  const head = await read(0, Math.min(size, HEAD_BYTES))
  const offsets = faceOffsets(head)
  if (offsets === null) return []
  const window = windowOf(read, head)
  const faces: FontFaceInfo[] = []
  for (const [index, dirOffset] of offsets.entries()) {
    const records = await tableRecords(window, dirOffset)
    if (records === null) continue
    const nameRecord = records.find((record) => record.tag === 'name')
    if (nameRecord === undefined) continue
    if (nameRecord.offset + nameRecord.length > size) continue
    let names = new Map<number, string>()
    try {
      names = parseNames(await window.at(nameRecord.offset, nameRecord.length))
    } catch {
      continue
    }
    const family = names.get(16) ?? names.get(1) ?? ''
    const style = names.get(17) ?? names.get(2) ?? 'Regular'
    if (family === '') continue
    faces.push({
      index,
      family,
      style,
      weight: styleWeight(style),
      italic: styleItalic(style),
      variable: records.some((record) => record.tag === 'fvar'),
    })
  }
  return faces
}

/** 4 字节对齐：sfnt 的每张表都从 4 的倍数开始。 */
function pad4(value: number): number {
  return (value + 3) & ~3
}

/**
 * 从（可能是集合的）字体文件里**拆出一张脸**，产出一份能直接交给 CanvasKit 的独立文件。
 *
 * 为什么非拆不可：`TypefaceFontProvider.registerFont(bytes, family)` 没有「第几张」这个
 * 参数，整份 TTC 递进去 Skia 只认第 0 张。而 `PingFang.ttc` 的第 0 张是 **PingFang HK**
 * ——用户在文档里写的是「PingFang SC」，拿到的是港版字形（笔画写法不同，且不报错）。
 * 拆出来还顺带把 74MB 变成 10MB 左右：预览要的是**一种**字形，不是整个字族。
 *
 * 做法是标准的「按表目录重排」：新文件头 + 原表数据（内容一字不改，表内偏移都是表内相对
 * 的），最后修 `head.checkSumAdjustment`（不修也能画，但坏了规矩的字体文件会在别处被拒）。
 */
export function extractFace(bytes: Uint8Array, index: number): Uint8Array | null {
  const offsets = faceOffsets(bytes.subarray(0, Math.min(bytes.length, 12 + MAX_FACES * 4)))
  if (offsets === null || index < 0 || index >= offsets.length) return null
  const dirOffset = offsets[index] ?? 0
  if (dirOffset + 12 > bytes.length) return null
  const count = u16(bytes, dirOffset + 4)
  if (count === 0 || count > MAX_TABLES) return null
  if (dirOffset + 12 + count * 16 > bytes.length) return null

  const records: TableRecord[] = []
  for (let i = 0; i < count; i += 1) {
    const at = dirOffset + 12 + i * 16
    records.push({
      tag: tagAt(bytes, at),
      checksum: u32(bytes, at + 4),
      offset: u32(bytes, at + 8),
      length: u32(bytes, at + 12),
    })
  }
  for (const record of records) {
    if (record.offset + record.length > bytes.length) return null
  }
  records.sort((left, right) => (left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0))

  let total = 12 + count * 16
  const placement = records.map((record) => {
    const at = total
    total += pad4(record.length)
    return at
  })

  const out = new Uint8Array(total)
  const outView = viewOf(out)
  // 版本头照抄那张脸的（集合里每张脸都有自己的 sfntVersion）。
  outView.setUint32(0, u32(bytes, dirOffset))
  outView.setUint16(4, count)
  const entrySelector = Math.floor(Math.log2(count))
  const searchRange = 16 * 2 ** entrySelector
  outView.setUint16(6, searchRange)
  outView.setUint16(8, entrySelector)
  outView.setUint16(10, count * 16 - searchRange)

  let headAt = -1
  records.forEach((record, i) => {
    const rec = 12 + i * 16
    for (let p = 0; p < 4; p += 1) out[rec + p] = record.tag.charCodeAt(p)
    // 校验和照抄原表：表内容一字未改，原值仍然成立。
    outView.setUint32(rec + 4, record.checksum)
    outView.setUint32(rec + 8, placement[i] ?? 0)
    outView.setUint32(rec + 12, record.length)
    const at = placement[i] ?? 0
    out.set(bytes.subarray(record.offset, record.offset + record.length), at)
    if (record.tag === 'head') headAt = at
  })

  if (headAt >= 0) {
    // checkSumAdjustment 是「整份文件（含这一格置 0）按 u32 求和」的补数。
    outView.setUint32(headAt + 8, 0)
    let sum = 0
    for (let at = 0; at + 4 <= out.length; at += 4) sum = (sum + outView.getUint32(at)) >>> 0
    outView.setUint32(headAt + 8, (0xb1b0afba - sum) >>> 0)
  }
  return out
}
