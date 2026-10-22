/**
 * 文本节点的本地导出（`client/canvas/text-export.ts`）——纯函数那一半。
 *
 * 下载与打印碰 DOM，跑不进 node 环境的单测（这个仓库的测试环境没有 DOM），所以这里钉的
 * 是**一改就静默坏掉**的几件事：
 *
 * 1. **docx 是一份 ZIP**：CRC32 错一个字节，Word 直接说文件损坏；条目名少一个，打开就是
 *    空白文档。所以这里把归档拆回来——走本地文件头，逐个条目对 CRC 与结构。
 * 2. **样式不是「加粗的大字」**：标题是 Word 的内建标题样式（`w:name="heading N"` +
 *    `w:outlineLvl`，导航窗格认得出）；列表是真项目符号（`numbering.xml`，不再是行首的
 *    `-` 字符）；粗斜体、行内代码是 run 级 `w:rPr`。
 * 3. **非 markdown 的产物一个字都不动**：`.py` 行首的 `#` 是注释，被当成标题剥掉的后果
 *    不是报错，是导出的文件少了几行。
 * 4. **markdown 的块级标记要去干净**：txt 那里留一个 `##` 就是没做这件事。
 * 5. **格式表与文案表同进同出**：加一种格式忘了加一行文案，菜单上就会出现空按钮。
 */
import { describe, expect, it } from 'vitest'
import {
  docxBytes,
  exportFileName,
  markdownToPlainText,
  textBlocksOf,
  TEXT_EXPORT_FORMATS,
  TEXT_EXPORT_LABEL,
  utf8Bytes,
} from '../../../../src/client/canvas/export/text-export.ts'
import { en, zh } from '../../../../src/client/ui/locales.ts'

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const EOCD = 0x06054b50

/** CRC-32（逐位版，与模块里那张查表法是两条路）。 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** 把归档拆回来：走本地文件头，名字 → (CRC, 内容)；`end` 是本地条目区之后的位置。 */
function readZip(bytes: Uint8Array): { entries: Map<string, { crc: number; data: Uint8Array }>; end: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  const entries = new Map<string, { crc: number; data: Uint8Array }>()
  let at = 0
  while (view.getUint32(at, true) === LOCAL_HEADER) {
    const crc = view.getUint32(at + 14, true)
    const size = view.getUint32(at + 18, true)
    const nameLength = view.getUint16(at + 26, true)
    const extraLength = view.getUint16(at + 28, true)
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength))
    const start = at + 30 + nameLength + extraLength
    entries.set(name, { crc, data: bytes.subarray(start, start + size) })
    at = start + size
  }
  return { entries, end: at }
}

function textOf(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

/** 从归档里取某个部件（缺了就 fail）。 */
function partOf(archive: { entries: Map<string, { crc: number; data: Uint8Array }> }, name: string): string {
  const entry = archive.entries.get(name)
  expect(entry, `缺部件 ${name}`).toBeDefined()
  return textOf(entry!.data)
}

/** 一份样例文档，把 docx 的每个样式分支都踩到。 */
function sampleDocx() {
  const source = [
    '# 一级',
    '## 二级',
    '### 三级',
    '#### 四级',
    '##### 五级',
    '###### 六级',
    '',
    '这是 **粗体** 与 *斜体* 与 `行内码` 混着的正文。',
    '',
    '> 这是一段引用。',
    '',
    '- 无序甲',
    '  - 无序乙',
    '- 无序丙',
    '',
    '1. 有序甲',
    '2. 有序乙',
    '',
    // 空行**不**切断一张表（markdown 里空行两边的项仍属同一张「松散表」），所以这里用一段
    // 正文把两张表分开——那才是「另一段表」，编号才会从 1 重数。
    '中间的一句话。',
    '',
    '1. 另一段有序（该从 1 重新数）',
    '',
    '```python',
    'def f():',
    '    return 1',
    '```',
  ].join('\n')
  return docxBytes({ title: '样式样例', blocks: textBlocksOf(source, true) })
}

describe('格式表', () => {
  it('四种格式，按 md / txt / docx / pdf 排', () => {
    expect(TEXT_EXPORT_FORMATS).toEqual(['md', 'txt', 'docx', 'pdf'])
  })

  it('每种格式都有中英文两行文案', () => {
    for (const format of TEXT_EXPORT_FORMATS) {
      const key = TEXT_EXPORT_LABEL[format]
      expect(zh[key], `中文缺 ${key}`).toBeTruthy()
      expect(en[key], `英文缺 ${key}`).toBeTruthy()
    }
  })
})

describe('markdown 去标记（txt 的底料）', () => {
  it('站点标记与行内标记都剥掉', () => {
    const source = ['# 标题', '', '> 引用', '', '- 甲', '- 乙', '', '**粗** 与 *斜* 与 `码`'].join('\n')
    expect(markdownToPlainText(source)).toBe(
      ['标题', '', '引用', '', '- 甲', '- 乙', '', '粗 与 斜 与 码'].join('\n'),
    )
  })

  it('链接留可见文字，地址附在后面', () => {
    expect(markdownToPlainText('[文档](https://example.com/a)')).toBe('文档 (https://example.com/a)')
    expect(markdownToPlainText('![图](https://example.com/a.png)')).toBe('图 (https://example.com/a.png)')
  })

  it('围栏代码里的字原样留下，只有围栏本身被吃掉', () => {
    const source = ['前文', '```python', '# 这是注释，不是标题', 'print("hi")', '```', '后文'].join('\n')
    const plain = markdownToPlainText(source)
    expect(plain).toContain('# 这是注释，不是标题')
    expect(plain).not.toContain('```')
  })

  it('标题级别与列表都成了行首的普通字', () => {
    expect(markdownToPlainText('### 三级')).toBe('三级')
    expect(markdownToPlainText('1. 甲\n2. 乙')).toBe('1. 甲\n2. 乙')
  })
})

describe('块（docx 的底料）', () => {
  it('标题带上级别，正文是 paragraph', () => {
    expect(textBlocksOf('# 一\n## 二\n正文', true)).toEqual([
      { kind: 'heading', level: 1, runs: [{ text: '一' }] },
      { kind: 'heading', level: 2, runs: [{ text: '二' }] },
      { kind: 'paragraph', runs: [{ text: '正文' }] },
    ])
  })

  it('列表带层次，有序无序分得开', () => {
    expect(textBlocksOf('- 甲\n  - 乙\n\n1. 丙\n2. 丁', true)).toEqual([
      { kind: 'bullet', depth: 0, runs: [{ text: '甲' }] },
      { kind: 'bullet', depth: 1, runs: [{ text: '乙' }] },
      { kind: 'ordered', depth: 0, runs: [{ text: '丙' }] },
      { kind: 'ordered', depth: 0, runs: [{ text: '丁' }] },
    ])
  })

  it('粗斜体与行内代码是带标记的 run', () => {
    expect(textBlocksOf('**粗** *斜* `码`', true)).toEqual([
      { kind: 'paragraph', runs: [{ text: '粗', bold: true }, { text: ' ', }, { text: '斜', italic: true }, { text: ' ', }, { text: '码', code: true }] },
    ])
  })

  it('围栏代码是一整块，行间的空行也不动', () => {
    const source = ['```', '', 'x', '', '```'].join('\n')
    expect(textBlocksOf(source, true)).toEqual([{ kind: 'code', lines: ['x'] }])
  })

  it('非 markdown：一个字都不动——行首的 `#` 是注释，不是标题', () => {
    const source = ['#!/usr/bin/env python', '# 注释', 'x = 1 * 2', ''].join('\n')
    expect(textBlocksOf(source, false)).toEqual([
      { kind: 'paragraph', runs: [{ text: '#!/usr/bin/env python' }] },
      { kind: 'paragraph', runs: [{ text: '# 注释' }] },
      { kind: 'paragraph', runs: [{ text: 'x = 1 * 2' }] },
      { kind: 'paragraph', runs: [{ text: '' }] },
    ])
  })
})

describe('导出文件名', () => {
  it('把扩展名换成目标格式的', () => {
    expect(exportFileName('notes/readme.md', 'docx')).toBe('readme.docx')
    expect(exportFileName('readme.md', 'txt')).toBe('readme.txt')
  })

  it('原本没有扩展名也能补上', () => {
    expect(exportFileName('notes/draft', 'md')).toBe('draft.md')
  })

  it('路径为空时给一个站得住的默认名', () => {
    expect(exportFileName('', 'txt')).toBe('text.txt')
  })

  it('点开头的隐藏文件不被当成扩展名', () => {
    expect(exportFileName('.gitignore', 'txt')).toBe('.gitignore.txt')
  })
})

describe('docx：包结构', () => {
  const bytes = sampleDocx()
  const archive = readZip(bytes)

  it('是 ZIP，条目齐七份', () => {
    expect(archive.entries.size).toBe(7)
    for (const name of [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
      'word/numbering.xml',
      'docProps/core.xml',
    ]) {
      expect(archive.entries.has(name), `缺条目 ${name}`).toBe(true)
    }
  })

  it('每个条目的 CRC 都对得上（错一个字节 Word 就说文件坏了）', () => {
    // 先证这把 CRC 是对的：标准向量 "123456789" → 0xCBF43926。
    expect(crc32(utf8Bytes('123456789'))).toBe(0xcbf43926)
    for (const [name, entry] of archive.entries) {
      expect(entry.crc, `${name} 的 CRC 不对`).toBe(crc32(entry.data))
      expect(entry.data.byteLength, `${name} 是空的`).toBeGreaterThan(0)
    }
  })

  it('结构收得干净：本地条目区之后是中央目录，末尾是 EOCD，偏移自洽', () => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(view.getUint32(archive.end, true)).toBe(CENTRAL_HEADER)
    expect(view.getUint32(bytes.byteLength - 22, true)).toBe(EOCD)
    expect(view.getUint16(bytes.byteLength - 22 + 10, true)).toBe(archive.entries.size)
    const centralSize = view.getUint32(bytes.byteLength - 22 + 12, true)
    const centralOffset = view.getUint32(bytes.byteLength - 22 + 16, true)
    expect(centralOffset).toBe(archive.end)
    expect(centralOffset + centralSize).toBe(bytes.byteLength - 22)
  })
})

describe('docx：标题是真正的 Word 标题样式', () => {
  const archive = readZip(sampleDocx())
  const document = partOf(archive, 'word/document.xml')
  const styles = partOf(archive, 'word/styles.xml')

  it('六级标题各自引自己的段落样式', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(document, `缺 Heading${level} 段落`).toContain(`<w:pStyle w:val="Heading${level}"/>`)
    }
  })

  it('样式表里六级标题用的是内建名字（导航窗格认得出的那种）', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(styles, `缺 heading ${level} 名称`).toContain(`<w:name w:val="heading ${level}"/>`)
      expect(styles, `缺 Heading${level} 的大纲层级`).toContain(`<w:outlineLvl w:val="${level - 1}"/>`)
    }
  })

  it('标题级字号递减（一级最大、六级最小）', () => {
    const sizes = [1, 2, 3, 4, 5, 6].map((level) => {
      const match = new RegExp(
        `<w:style w:type="paragraph" w:styleId="Heading${level}">[\\s\\S]*?<w:sz w:val="(\\d+)"/>`,
      ).exec(styles)
      expect(match, `Heading${level} 缺字号`).not.toBeNull()
      return Number(match![1])
    })
    for (let index = 1; index < sizes.length; index += 1) {
      expect(sizes[index]).toBeLessThan(sizes[index - 1])
    }
  })
})

describe('docx：列表是真项目符号 / 自动编号', () => {
  const archive = readZip(sampleDocx())
  const document = partOf(archive, 'word/document.xml')
  const numbering = partOf(archive, 'word/numbering.xml')
  const documentRels = partOf(archive, 'word/_rels/document.xml.rels')

  it('正文引 numbering 与 styles 两个部件（缺了关系 Word 找不到编号定义）', () => {
    expect(documentRels).toContain('Target="styles.xml"')
    expect(documentRels).toContain('Target="numbering.xml"')
  })

  it('无序表段落挂 w:numPr，引项目符号那张号', () => {
    // 三段无序 + 两段有序（2 + 1 项），一共六段列表；且表里没有 `- ` 字符冒充符号。
    expect(document.match(/<w:numPr>/g) ?? []).toHaveLength(6)
    expect(document).not.toContain('<w:t>- ')
  })

  it('无序表是 bullet 编号，有序表是 decimal 编号', () => {
    expect(numbering).toContain('<w:numFmt w:val="bullet"/>')
    expect(numbering).toContain('<w:numFmt w:val="decimal"/>')
    // 编号文字是「取第 N 层的计数」，不是写死的 1.
    expect(numbering).toContain('<w:lvlText w:val="%1."/>')
  })

  it('两段不相邻的有序表各领一张号（第二段从 1 重新数）', () => {
    // numId 在 `w:pPr` 里、比文字靠前，所以按段取——截文字位置会截在 numPr 之后。
    const paragraphs = document.split('</w:p>')
    const numIdOf = (text: string): string => {
      const paragraph = paragraphs.find((chunk) => chunk.includes(text))
      expect(paragraph, `找不到段落：${text}`).not.toBeNull()
      const numId = /<w:numId w:val="(\d+)"\/>/.exec(paragraph!)![1]
      return numId
    }
    // 同一段表里两项共用一张号；换了段表就换号。
    expect(numIdOf('有序甲')).toBe(numIdOf('有序乙'))
    expect(numIdOf('另一段有序')).not.toBe(numIdOf('有序甲'))
    // 编号表里正好三张号：项目符号一张 + 两段有序表各一张。
    expect(numbering.match(/<w:num w:numId="\d+">/g) ?? []).toHaveLength(3)
  })
})

describe('docx：行内样式与正文', () => {
  const archive = readZip(sampleDocx())
  const document = partOf(archive, 'word/document.xml')

  it('粗体是 <w:b/> 的 run，斜体是 <w:i/>，行内代码是字符样式', () => {
    expect(document).toContain('<w:rPr><w:b/></w:rPr>')
    expect(document).toContain('<w:rPr><w:i/></w:rPr>')
    expect(document).toContain('<w:rStyle w:val="CodeChar"/>')
  })

  it('引用与代码块各挂自己的段落样式', () => {
    expect(document).toContain('<w:pStyle w:val="Quote"/>')
    expect(document).toContain('<w:pStyle w:val="CodeBlock"/>')
  })

  it('代码块保持行间的换行（<w:br/>），灰底连成一片', () => {
    const code = /<w:p><w:pPr><w:pStyle w:val="CodeBlock"\/><\/w:pPr>[\s\S]*?<\/w:p>/.exec(document)
    expect(code, '没有代码块段落').not.toBeNull()
    expect(code![0]).toContain('<w:br/>')
    expect(code![0]).toContain('def f():')
    // 缩进是代码的一部分，`xml:space="preserve"` 让它留得住。
    expect(code![0]).toContain('<w:t xml:space="preserve">    return 1</w:t>')
    expect(partOf(archive, 'word/styles.xml')).toContain('<w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/>')
  })

  it('正文里的 XML 特殊字符转义掉', () => {
    const escaped = docxBytes({ title: '笔记', blocks: textBlocksOf('A & B < C > D "引号"', true) })
    const doc = partOf(readZip(escaped), 'word/document.xml')
    expect(doc).toContain('A &amp; B &lt; C &gt; D &quot;引号&quot;')
    expect(doc).not.toContain('A & B < C')
  })

  it('文档标题落在 core.xml 里', () => {
    expect(partOf(archive, 'docProps/core.xml')).toContain('<dc:title>样式样例</dc:title>')
  })
})

describe('导出格式表', () => {
  it('四种格式各有文案，两种语言都不缺', () => {
    for (const format of TEXT_EXPORT_FORMATS) {
      expect(zh[TEXT_EXPORT_LABEL[format]]).toBeTruthy()
      expect(en[TEXT_EXPORT_LABEL[format]]).toBeTruthy()
    }
  })

  it('PDF 那一行不再提「打印另存」——它现在是直接落字节', () => {
    expect(zh['canvas.export.pdf']).not.toContain('打印')
    expect(en['canvas.export.pdf']).not.toContain('print')
  })
})