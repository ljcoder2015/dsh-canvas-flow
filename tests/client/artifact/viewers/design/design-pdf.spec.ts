/**
 * PDF 那条出路（v1.61）：**字体必须注册在正要写的那一份文档上**。
 *
 * 这一组钉的是真机报的「导出 PDF…文字渲染不正确」——解开产物看到 42 个 `/Type1`（jsPDF 的
 * 标准字体，一支汉字字形都没有）、每页一个 `Tj`，参数是中文原始字节被当单字节写出来的
 * `(N;ÆÉÿO`Y}ÿ¾`。根因是 svg2pdf 拿 `<text font-family>` 去 `pdf.getFontList()` 里查，
 * 查不到**一律回落 `times`**。
 *
 * 两条面分着测：
 *  - **纯函数**（`binaryStringOf`）真跑——它是 17.7MB 字面进产物之前唯一被我们自己碰过的
 *    一环，错一位字符就是一份坏字体；
 *  - **接线**读源码文本、不 import（`jspdf` 与 `svg2pdf.js` 都是动态 import 的重家伙，而
 *    真产物由 `.workbuddy/repro/design-export` 那份真浏览器探针解 `/Type0` / `/FontFile2`
 *    / `/ToUnicode` 判）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PDF_FONT_FILE, binaryStringOf } from '../../../../../src/client/artifact/viewers/design/design-pdf.ts'

const source = readFileSync(
  new URL('../../../../../src/client/artifact/viewers/design/design-pdf.ts', import.meta.url),
  'utf8',
)

describe('binaryStringOf', () => {
  it('一个字符恰好一个字节，一个不多一个不少', () => {
    const bytes = new Uint8Array([0, 1, 0x7f, 0x80, 0xcf, 0xff, 0x41])
    const binary = binaryStringOf(bytes)
    expect(binary).toHaveLength(bytes.length)
    for (const [index, byte] of bytes.entries()) expect(binary.charCodeAt(index)).toBe(byte)
  })

  it('大于 127 的字节原样保留：这不是 UTF-8 编码，多走一趟就毁字体', () => {
    // 头四字节是 OpenType 的 `00 01 00 00`（jsPDF 靠它判断「已经是二进制、不必 atob」），
    // 后面那些高位字节如果被当文本编码过，字体表整张就烂了。
    expect(binaryStringOf(new Uint8Array([0x00, 0x01, 0x00, 0x00, 0xde, 0xad]))).toBe(
      '\x00\x01\x00\x00\xde\xad',
    )
  })

  it('跨过 16KB 的分块边界也不掉字节（`String.fromCharCode` 一次铺开整份 17.7MB 会爆栈）', () => {
    const size = 0x4000 * 2 + 7
    const bytes = new Uint8Array(size)
    for (let index = 0; index < size; index += 1) bytes[index] = index % 256
    const binary = binaryStringOf(bytes)
    expect(binary).toHaveLength(size)
    expect(binary.charCodeAt(0x3fff)).toBe(0xff)
    expect(binary.charCodeAt(0x4000)).toBe(0x00)
    expect(binary.charCodeAt(size - 1)).toBe((size - 1) % 256)
  })

  it('空字节串就是空串（不抛，也不编出一个字符来）', () => {
    expect(binaryStringOf(new Uint8Array(0))).toBe('')
  })
})

describe('renderPdfDocument 的接线', () => {
  it('自己建一份文档，只建这一处（字体必须注册在正要写的那一份上）', () => {
    // 钉的是**构造**那一行，不是散文里提了几次这个名字。
    expect(source.match(/=\s*new jsPDF\(/g)).toHaveLength(1)
  })

  it('子集化那格必须显式开着：默认 false 会把注册过的每一支字面整个嵌进产物', () => {
    // 又是一个静默失败——开着与关着都「导出成功」，差别是 0.05MB 与 0.18MB（实测），
    // 而四个样式就是四份 17.7MB。
    //
    // 锚在**真代码那一行**（`^\s*…,$`）而不是一个裸子串：文件头那段注释里也写着这个名字
    // （`` `putOnlyUsedFonts: true` ``），裸子串会被注释命中而永远绿——这一条是验红时抓出来的。
    expect(source).toMatch(/^\s*putOnlyUsedFonts: true,$/m)
    expect(source).not.toContain('putOnlyUsedFonts: false')
  })

  it('注册用的字体名是 SVG 里要写的那个 id，不是字面量', () => {
    // 两处（注册 + SVG 的 font-family）必须是同一个常量。谁手写一个字符串，svg2pdf 就
    // 按名字查不到而回落 `times`——事故原样复现。
    expect(source).toContain('doc.addFont(PDF_FONT_FILE, PDF_TEXT_FAMILY, style)')
  })

  it('先把字体塞进虚拟文件系统，再按它注册', () => {
    const put = source.indexOf('doc.addFileToVFS(')
    const register = source.indexOf('doc.addFont(')
    expect(put).toBeGreaterThan(-1)
    expect(register).toBeGreaterThan(-1)
    expect(put).toBeLessThan(register)
    expect(source.match(/addFileToVFS\(/g)).toHaveLength(1)
  })

  it('字体文件在虚拟文件系统里那个名字只出现一处交接（写死在一格常量里）', () => {
    expect(PDF_FONT_FILE).toBe('NotoSansSC-Regular.ttf')
    expect(source.match(/'NotoSansSC-Regular\.ttf'/g)).toHaveLength(1)
  })

  it('一容器一页：第一页用文档自己的格式，后面每页都显式带尺寸重新开一页', () => {
    expect(source).toContain('if (index > 0) doc.addPage(')
    expect(source.match(/doc\.addPage\(/g)).toHaveLength(1)
  })

  it('顶层只有那一格常量的 import：`jspdf` / `svg2pdf.js` 一律动态 import', () => {
    // 顶层纯净是这一组判据能跑的前提（node 里没有 `DOMParser`，也不该为一份源码文本判据
    // 把两个重家伙拉起来）。
    expect(/^import .*['"](?:jspdf|svg2pdf\.js)['"]/m.test(source)).toBe(false)
    expect(source).toContain("await Promise.all([import('jspdf'), import('svg2pdf.js')])")
  })
})
