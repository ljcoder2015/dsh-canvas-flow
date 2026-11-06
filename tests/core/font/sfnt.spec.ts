/**
 * 「一个字面文件里有哪些脸」——纯字节，判据自带夹具（`tests/fixtures/font.ts`）。
 *
 * 这一组盯的是三件在真机上**都不会报错**的事：
 * 1. **集合里的第几张**。`PingFang.ttc` 有 36 张脸，第 0 张是港版、第 2 张才是简体；只读
 *    第 0 张就等于「简体稿子用港版字形画」——错得不响。
 * 2. **只读该读的那几 KB**。字体目录扫一遍是五百个文件，其中最大的一个 74MB；为了知道族名
 *    整份读进内存，打开画布时要读几个 GB。夹具里塞一段 1MB 的填充表，断言总读取量远小于文件。
 * 3. **坏文件不许把整份清单带走**。字体目录里真的躺着半截下载与改错后缀的东西。
 */
import { describe, expect, it } from 'vitest'
import { extractFace, readFontFaces, styleItalic, styleWeight } from '../../../src/core/font/sfnt.ts'
import { buildFontFile, memoryReader } from '../../fixtures/font.ts'

/** 读一遍：文件字节 → 脸列表。 */
async function facesOf(file: Uint8Array) {
  const reader = memoryReader(file)
  const faces = await readFontFaces(reader.read, file.length)
  return { faces, reader }
}

describe('readFontFaces', () => {
  it('单张文件：族名、字重名、字重值与斜体都读得出来', async () => {
    const file = buildFontFile([{ family: 'Inter', style: 'SemiBold' }])
    const { faces } = await facesOf(file)
    expect(faces).toHaveLength(1)
    expect(faces[0]).toMatchObject({ index: 0, family: 'Inter', style: 'SemiBold', weight: 600, italic: false, variable: false })
  })

  it('集合文件：每张脸各自一个 index，族名不串（第 0 张不是第 2 张）', async () => {
    const file = buildFontFile([
      { family: 'PingFang HK', style: 'Regular' },
      { family: 'PingFang TC', style: 'Regular' },
      { family: 'PingFang SC', style: 'Regular' },
      { family: 'PingFang SC', style: 'Medium' },
    ])
    const { faces } = await facesOf(file)
    expect(faces.map((face) => `${face.index}:${face.family}/${face.style}`)).toEqual([
      '0:PingFang HK/Regular',
      '1:PingFang TC/Regular',
      '2:PingFang SC/Regular',
      '3:PingFang SC/Medium',
    ])
  })

  it('不带 `fvar` 的固定字重文件与可变字体分得开', async () => {
    const file = buildFontFile([
      { family: 'Inter', style: 'Regular' },
      { family: 'Inter Var', style: 'Regular', variable: true },
    ])
    const { faces } = await facesOf(file)
    expect(faces[0]?.variable).toBe(false)
    expect(faces[1]?.variable).toBe(true)
  })

  it('只读文件头与名字表：1MB 的文件读不到 70KB', async () => {
    const file = buildFontFile([{ family: 'Songti SC', style: 'Regular', padding: 1024 * 1024 }])
    expect(file.length).toBeGreaterThan(1024 * 1024)
    const { faces, reader } = await facesOf(file)
    expect(faces).toHaveLength(1)
    // 上限是「文件头 64KB + 名字表几 KB」；整份读会等于文件长度。
    expect(reader.bytesRead()).toBeLessThan(70 * 1024)
  })

  it('坏文件回空数组，不抛：半截文件、随机字节、表数爆掉', async () => {
    const empty = await readFontFaces(memoryReader(new Uint8Array(0)).read, 0)
    expect(empty).toEqual([])

    const random = new Uint8Array(256).fill(7)
    expect(await readFontFaces(memoryReader(random).read, random.length)).toEqual([])

    const broken = buildFontFile([{ family: 'Inter', style: 'Regular' }])
    // 把 numTables 改成一个荒唐的值：真实文件里不会有 65535 张表。
    new DataView(broken.buffer).setUint16(4, 0xffff)
    expect(await readFontFaces(memoryReader(broken).read, broken.length)).toEqual([])
  })
})

describe('extractFace', () => {
  it('从集合里拆出第 2 张：族名对得上，字节数小得多，且能再读回来', async () => {
    const file = buildFontFile([
      { family: 'PingFang HK', style: 'Regular', padding: 200_000 },
      { family: 'PingFang TC', style: 'Regular', padding: 200_000 },
      { family: 'PingFang SC', style: 'Regular', padding: 200_000 },
    ])
    const face = extractFace(file, 2)
    expect(face).not.toBeNull()
    const bytes = face as Uint8Array
    // 拆出来的是**一张脸**：比整份文件小一个数量级（原文件三份表数据）。
    expect(bytes.length).toBeLessThan(file.length / 2)
    const { faces } = await facesOf(bytes)
    expect(faces).toHaveLength(1)
    expect(faces[0]).toMatchObject({ index: 0, family: 'PingFang SC', style: 'Regular' })
  })

  it('拆出来的文件校验和是合规的（`head.checkSumAdjustment` 重算过）', () => {
    const file = buildFontFile([{ family: 'Inter', style: 'Bold' }, { family: 'Inter', style: 'Light' }])
    const bytes = extractFace(file, 1) as Uint8Array
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let sum = 0
    for (let at = 0; at + 4 <= bytes.length; at += 4) sum = (sum + view.getUint32(at)) >>> 0
    expect(sum).toBe(0xb1b0afba)
  })

  it('序号越界、或根本不是字体，都回 null（不抛）', () => {
    const file = buildFontFile([{ family: 'Inter', style: 'Regular' }])
    expect(extractFace(file, 3)).toBeNull()
    expect(extractFace(file, -1)).toBeNull()
    expect(extractFace(new Uint8Array(32), 0)).toBeNull()
  })
})

describe('字重名折数值', () => {
  it('长的名字先认：ExtraBold 不是 Bold，UltraLight 不是 Light', () => {
    expect(styleWeight('Thin')).toBe(100)
    expect(styleWeight('UltraLight')).toBe(200)
    expect(styleWeight('Light')).toBe(300)
    expect(styleWeight('Regular')).toBe(400)
    expect(styleWeight('Medium')).toBe(500)
    expect(styleWeight('SemiBold')).toBe(600)
    expect(styleWeight('Bold')).toBe(700)
    expect(styleWeight('ExtraBold')).toBe(800)
    expect(styleWeight('Black')).toBe(900)
    expect(styleWeight('Heavy')).toBe(900)
  })

  it('认不出来的名字退回 400（别猜成 0：0 会让「就近取档」全挑到最细那一档）', () => {
    expect(styleWeight('Display')).toBe(400)
    expect(styleWeight('')).toBe(400)
  })

  it('斜体：`Italic` 与 `Oblique` 都算', () => {
    expect(styleItalic('Italic')).toBe(true)
    expect(styleItalic('Bold Oblique')).toBe(true)
    expect(styleItalic('Bold')).toBe(false)
  })
})
