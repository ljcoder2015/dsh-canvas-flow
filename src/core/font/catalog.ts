/**
 * dsh-canvas — 从「这台机器上有哪些字体文件」里挑出文档要的那一张脸（v1.89）。
 *
 * 只做匹配，不碰磁盘：宿主把扫出来的 `FontFileInfo[]` 递进来，这里回答「`PingFang SC`
 * 的 Regular 在哪份文件的第几张」。
 *
 * 匹配刻意**保守**（只认族名相等与「去掉空格/连字符后相等」两档），不做模糊相似：
 * 挑错字体的表现是「字都画出来了，但长得不对」，比挑不到（退回默认字面）难查得多——
 * 而挑不到至少用户能看见「这不是我要的字体」。
 */
import type { FontFaceInfo } from './sfnt.ts'
import { styleItalic, styleWeight } from './sfnt.ts'

/** 一个字体文件，以及它里面读出来的那几张脸。 */
export interface FontFileInfo {
  path: string
  size: number
  /** `.ttc` / `.otc` 集合：交给 CanvasKit 之前必须先 `extractFace`。 */
  collection: boolean
  faces: FontFaceInfo[]
}

/** 一次命中的结果：哪个文件、第几张脸。 */
export interface FontFaceMatch {
  file: FontFileInfo
  face: FontFaceInfo
}

/**
 * 族名的比较形态：小写、去掉空格与 `-` / `_`。
 *
 * `PingFang SC` 与 `PingFangSC` 是同一个族（文档里两种写法都见过），`Helvetica Neue` 与
 * `HelveticaNeue` 同理。只在这一层归一，**不**去掉别的字符——`Noto Sans SC` 与
 * `Noto Sans TC` 的差别正是那几个字母，模糊到那一步就会挑错语种。
 */
export function normalizeFamily(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

/** 某张脸的「像不像要的那个样式」：越小越像。 */
function styleRank(face: FontFaceInfo, weight: number, italic: boolean, style: string): number {
  if (face.style.trim().toLowerCase() === style.trim().toLowerCase()) return -1
  // 倾斜与否是硬条件（斜体字面画正体要假斜，反而不对），字重按差的档数排。
  const slant = face.italic === italic ? 0 : 1000
  return slant + Math.abs(face.weight - weight) / 100
}

/**
 * 挑一张脸。挑不到就 `null`（调用方退回默认字面，这是**答案**不是异常）。
 *
 * 同分时优先**非集合**文件：集合里那一张拆出来虽然一样能画，但 74MB 与 10MB 的差别在
 * 「每次打开都要读一遍盘」这件事上是能感觉到的。
 */
export function pickFontFace(
  files: readonly FontFileInfo[],
  family: string,
  style: string,
): FontFaceMatch | null {
  const wanted = family.trim()
  if (wanted === '') return null
  const weight = styleWeight(style)
  const italic = styleItalic(style)

  const exact: FontFaceMatch[] = []
  const normalized: FontFaceMatch[] = []
  const key = normalizeFamily(wanted)
  for (const file of files) {
    for (const face of file.faces) {
      if (face.family === wanted) exact.push({ file, face })
      else if (normalizeFamily(face.family) === key) normalized.push({ file, face })
    }
  }
  // 族名一字不差的优先；一个都没有才退到归一形态（`PingFangSC` ⇄ `PingFang SC`）。
  const pool = exact.length > 0 ? exact : normalized
  if (pool.length === 0) return null

  let best: FontFaceMatch | null = null
  let bestRank = Number.POSITIVE_INFINITY
  for (const match of pool) {
    const rank = styleRank(match.face, weight, italic, style) * 2 + (match.file.collection ? 1 : 0)
    if (rank < bestRank) {
      best = match
      bestRank = rank
    }
  }
  return best
}

/**
 * 这支族该不该出现在下拉框里。
 *
 * 以 `.` 开头的是**系统的内部别名**：本机 `PingFang.ttc` 之外，macOS 还在 `name` ID 16 里
 * 挂着 `.Al Bayan PUA`、`.Apple Color Emoji UI`、`.Arial Hebrew Desk Interface` 这类
 * 名字（本机 393 支里有近二十支是这样）。它们能用，但**不是给人选的字体**——真列出来，
 * 下拉框一打开就是一串点开头的东西排在前面（`.` 的排序在字母之前）。
 *
 * 判据在 core 这一层（不认平台）：Windows 的字体里没有这个约定，也就没有东西被误伤。
 */
export function listedFamily(family: string): boolean {
  const name = family.trim()
  return name !== '' && !name.startsWith('.')
}

/** 面板要的那张清单：族 → 它真有的字重（排序去重）。族名保持字体自己写的大小写。 */
export function fontFamilyList(files: readonly FontFileInfo[]): { family: string; weights: number[] }[] {
  const byFamily = new Map<string, Set<number>>()
  for (const file of files) {
    for (const face of file.faces) {
      if (!listedFamily(face.family)) continue
      const weights = byFamily.get(face.family) ?? new Set<number>()
      weights.add(face.weight)
      byFamily.set(face.family, weights)
    }
  }
  return [...byFamily.entries()]
    .map(([family, weights]) => ({ family, weights: [...weights].sort((a, b) => a - b) }))
    .sort((left, right) => left.family.localeCompare(right.family))
}
