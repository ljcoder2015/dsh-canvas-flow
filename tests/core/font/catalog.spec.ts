/**
 * 「文档要的那一族，在这台机器的哪份文件第几张脸」——纯匹配。
 *
 * 挑错的代价比挑不到大：挑不到会退回默认字面（用户看得见「这不是我要的字体」），挑错则是
 * **画出来了但长得不对**——港版字形、别的语种、别的字重，全都不报错。所以规则刻意保守：
 * 只认族名相等与「去掉空格/连字符后相等」两档，不做模糊相似。
 */
import { describe, expect, it } from 'vitest'
import { fontFamilyList, normalizeFamily, pickFontFace, type FontFileInfo } from '../../../src/core/font/catalog.ts'
import type { FontFaceInfo } from '../../../src/core/font/sfnt.ts'

function face(family: string, style: string, index = 0, weight = 400, italic = false): FontFaceInfo {
  return { index, family, style, weight, italic, variable: false }
}

function file(path: string, faces: FontFaceInfo[], collection = false): FontFileInfo {
  return { path, size: 1024, collection, faces }
}

describe('normalizeFamily', () => {
  it('空格、连字符、下划线都归一：`PingFang SC` 与 `PingFangSC` 是同一族', () => {
    expect(normalizeFamily('PingFang SC')).toBe('pingfangsc')
    expect(normalizeFamily(' PingFang-SC ')).toBe('pingfangsc')
    expect(normalizeFamily('Helvetica_Neue')).toBe('helveticaneue')
  })

  it('不越过语种那一步：`Noto Sans SC` 与 `Noto Sans TC` 归一后仍不同', () => {
    expect(normalizeFamily('Noto Sans SC')).not.toBe(normalizeFamily('Noto Sans TC'))
  })
})

describe('pickFontFace', () => {
  const files = [
    file('/System/Library/Fonts/PingFang.ttc', [
      face('PingFang HK', 'Regular', 0),
      face('PingFang SC', 'Regular', 2),
      face('PingFang SC', 'Medium', 5, 500),
      face('PingFang SC', 'Semibold', 8, 600),
    ], true),
    file('/Library/Fonts/Helvetica.ttf', [face('Helvetica', 'Regular'), face('Helvetica', 'Bold', 0, 700)]),
  ]

  it('集合里挑的是**那一张**，不是第 0 张', () => {
    const hit = pickFontFace(files, 'PingFang SC', 'Regular')
    expect(hit?.file.path).toBe('/System/Library/Fonts/PingFang.ttc')
    expect(hit?.face.index).toBe(2)
  })

  it('字重名一字不差优先；要的那档没有就取最近的', () => {
    expect(pickFontFace(files, 'PingFang SC', 'Medium')?.face.style).toBe('Medium')
    // 要 Bold（700）：最近的是 Semibold（600），不是 Regular。
    expect(pickFontFace(files, 'PingFang SC', 'Bold')?.face.style).toBe('Semibold')
  })

  it('族名一字不差的赢过归一形态：`PingFangSC` 与 `PingFang SC` 同时存在时各就各位', () => {
    const both = [
      ...files,
      file('/Users/me/Library/Fonts/PingFangSC.ttf', [face('PingFangSC', 'Regular')]),
    ]
    expect(pickFontFace(both, 'PingFang SC', 'Regular')?.file.path).toBe('/System/Library/Fonts/PingFang.ttc')
    expect(pickFontFace(both, 'PingFangSC', 'Regular')?.file.path).toBe('/Users/me/Library/Fonts/PingFangSC.ttf')
  })

  it('只差空格/连字符时也认得出（文档里两种写法都见过）', () => {
    const spaced = [file('/f/HelveticaNeue.ttf', [face('HelveticaNeue', 'Regular')])]
    expect(pickFontFace(spaced, 'Helvetica Neue', 'Regular')?.face.family).toBe('HelveticaNeue')
  })

  it('正体与斜体不混：要斜体时不会拿正体顶上', () => {
    const withItalic = [file('/f/Inter.ttf', [face('Inter', 'Regular'), face('Inter', 'Italic', 0, 400, true)])]
    expect(pickFontFace(withItalic, 'Inter', 'Italic')?.face.italic).toBe(true)
    expect(pickFontFace(withItalic, 'Inter', 'Regular')?.face.italic).toBe(false)
  })

  it('同分时优先非集合文件（74MB 与 10MB 的差别在每次读盘上）', () => {
    const pool = [
      file('/f/Helvetica.ttc', [face('Helvetica', 'Regular')], true),
      file('/f/Helvetica.ttf', [face('Helvetica', 'Regular')]),
    ]
    expect(pickFontFace(pool, 'Helvetica', 'Regular')?.file.path).toBe('/f/Helvetica.ttf')
    // 顺序反过来结论一样：挑的是**非集合**，不是「先看到的那个」。
    expect(pickFontFace([...pool].reverse(), 'Helvetica', 'Regular')?.file.path).toBe('/f/Helvetica.ttf')
  })

  it('挑不到就是 null：空族名、这台机器没有的族', () => {
    expect(pickFontFace(files, '', 'Regular')).toBeNull()
    expect(pickFontFace(files, '   ', 'Regular')).toBeNull()
    expect(pickFontFace(files, 'Comic Sans MS', 'Regular')).toBeNull()
    expect(pickFontFace([], 'Inter', 'Regular')).toBeNull()
  })
})

describe('fontFamilyList', () => {
  it('按族聚合字重：去重、升序，族名按字母排', () => {
    const files = [
      file('/a.ttc', [face('Songti SC', 'Regular'), face('Songti SC', 'Bold', 0, 700), face('Songti SC', 'Regular')], true),
      file('/b.ttf', [face('Arial', 'Regular')]),
    ]
    expect(fontFamilyList(files)).toEqual([
      { family: 'Arial', weights: [400] },
      { family: 'Songti SC', weights: [400, 700] },
    ])
  })

  it('一个字体都没有时是空清单，不是 undefined', () => {
    expect(fontFamilyList([])).toEqual([])
  })

  it('以 `.` 开头的系统内部别名不列（本机 393 支里有近二十支这种）', () => {
    const files = [
      file('/s.ttc', [
        face('.Al Bayan PUA', 'Regular'),
        face('.Apple Color Emoji UI', 'Regular'),
        face('Helvetica', 'Regular'),
      ], true),
    ]
    expect(fontFamilyList(files).map((entry) => entry.family)).toEqual(['Helvetica'])
    // 清单里没有 ≠ 挑不到：只写这些名字的文档仍旧要能画出字。
    expect(pickFontFace(files, '.Apple Color Emoji UI', 'Regular')?.face.family).toBe('.Apple Color Emoji UI')
  })
})
