/**
 * PDF 端「矢量图修整」的判据（F10.1，v1.64）。
 *
 * 这一组对应真机报的那句话：「导出 PDF，文本换行，和圆角矩形渲染不正确」。三处毛病都在
 * **上游那张 SVG 与画布不一致**上，而 PDF 只是把它逐元素转写（svg2pdf 忠实，所以错的东西
 * 也忠实）：①整段文字只有一个 `<text>`、不折行；②`clipPath` 是直角 `<rect>`、把容器的
 * 圆角填平；③圆角按 `rx`/`ry` **各自**夹到半轴，而画布（skia 的 `RRect`）是**整体按比例缩**。
 *
 * 折行与夹取在 `pdf-svg.ts` 里是**注入测量器**的纯函数，所以这里给一个「一字 10pt」的假
 * 尺子就能把断行边界、回退、硬断、截断逐条点名验——不必起浏览器。顺序那两条要一张**真图**
 * （它们读的就是 `SceneGraph`），另外拿**上游源码**对一次账：我们复刻的那条遍历条件必须与
 * 上游那句字面一致，否则上游一升级，配对全错而这里静悄悄。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SceneGraph } from '@open-pencil/scene-graph'
import {
  DEFAULT_LINE_HEIGHT,
  clampRadius,
  clipOrder,
  lineHeightOf,
  textOrder,
  wrapTextLines,
} from '../../../../src/core/artifact/design/pdf-svg.ts'

/** 一把假尺子：每个字符 `unit` pt。折行的边界于是能手算。 */
const ruler = (unit: number) => (slice: string) => slice.length * unit

/** 区间数组 → 取出来的行文本（判据里读起来更像那行字）。 */
const textsOf = (source: string, lines: { start: number; end: number }[]): string[] =>
  lines.map((line) => source.slice(line.start, line.end))

/** 读源码文本（跨文件对账用）。 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

describe('折行：按宽度断，中日韩逐字、西文按词', () => {
  it('中文逐字断（宽 30、每字 10 ⇒ 每行 3 字）', () => {
    const source = '中文折行测试'
    expect(wrapTextLines(source, 30, ruler(10))).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
    ])
  })

  it('放得下就不折（一行）', () => {
    const source = '短'
    expect(wrapTextLines(source, 100, ruler(10))).toEqual([{ start: 0, end: 1 }])
  })

  it('西文按词断，词中间的空白留给下一行行首', () => {
    const source = 'hello world'
    const lines = wrapTextLines(source, 60, ruler(10))
    expect(textsOf(source, lines)).toEqual(['hello', 'world'])
  })

  it('一个词本身就超宽 ⇒ 硬断（不能原地打转）', () => {
    const source = 'abcdefghij'
    const lines = wrapTextLines(source, 35, ruler(10))
    expect(textsOf(source, lines)).toEqual(['abc', 'def', 'ghi', 'j'])
  })

  it('行内不留尾随空白（否则画出来尾上多一截）', () => {
    const source = 'ab   cd'
    const lines = wrapTextLines(source, 45, ruler(10))
    expect(textsOf(source, lines)).toEqual(['ab', 'cd'])
  })

  it('`\\n` 是硬换行，与宽度无关；连续换行留一个空行', () => {
    const source = 'ab\n\ncd'
    const lines = wrapTextLines(source, 100, ruler(10))
    expect(lines).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 3 },
      { start: 4, end: 6 },
    ])
    expect(textsOf(source, lines)).toEqual(['ab', '', 'cd'])
  })

  it('`maxLines` 是 TRUNCATE 用的：放不下的行干脆不生成', () => {
    const source = '中文折行测试'
    expect(wrapTextLines(source, 30, ruler(10), { maxLines: 2 })).toHaveLength(2)
    expect(wrapTextLines(source, 30, ruler(10), { maxLines: 1 })).toEqual([{ start: 0, end: 3 }])
  })

  it('每一行都真的放得下（不是断在放不下的地方）', () => {
    const source = '导出 PDF 的时候这段中文说明文字应当按容器宽度折成好几行'
    const measure = (slice: string) => slice.length * 10
    for (const line of wrapTextLines(source, 120, measure)) {
      expect(measure(source.slice(line.start, line.end))).toBeLessThanOrEqual(120)
    }
  })
})

describe('圆角：夹成画布那个值，行高按节点', () => {
  it('超半轴按画布夹（200×140 给 100 ⇒ 70，不是 SVG 那对 rx=100 / ry=70）', () => {
    expect(clampRadius(100, 200, 140)).toBe(70)
  })

  it('没超就原样', () => {
    expect(clampRadius(28, 200, 140)).toBe(28)
  })

  it('负数与零都归零', () => {
    expect(clampRadius(-5, 200, 140)).toBe(0)
    expect(clampRadius(0, 200, 140)).toBe(0)
  })

  it('行高：节点写了就用它，没写按字号估', () => {
    expect(lineHeightOf({ fontSize: 24, lineHeight: 36 })).toBe(36)
    expect(lineHeightOf({ fontSize: 24, lineHeight: null })).toBe(
      Math.round(24 * DEFAULT_LINE_HEIGHT),
    )
  })
})

describe('顺序：给 SVG 里那些无名元素找到主', () => {
  /** 一张有嵌套的图：外层容器 → 内层容器 → 叶子；另有一个文本与一个没子的容器。 */
  function sample(): { graph: SceneGraph; board: string; inner: string; text: string } {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]!
    const board = graph.createNode('FRAME', page.id, {
      name: '容器',
      width: 200,
      height: 100,
      clipsContent: true,
    })
    const inner = graph.createNode('FRAME', board.id, {
      name: '内层',
      width: 100,
      height: 50,
      clipsContent: true,
    })
    graph.createNode('RECTANGLE', inner.id, { name: '叶子', width: 10, height: 10 })
    const text = graph.createNode('TEXT', board.id, { name: '文字', text: '你好' })
    return { graph, board: board.id, inner: inner.id, text: text.id }
  }

  it('裁剪按先序：容器自己在前，内层在后', () => {
    const { graph, board, inner } = sample()
    expect(clipOrder(graph, [board])).toEqual([board, inner])
  })

  it('文本也走同一套先序', () => {
    const { graph, board, text } = sample()
    expect(textOrder(graph, [board])).toEqual([text])
  })

  it('不可见的整棵跳过（上游那句 `if (!node.visible) return null` 在生成裁剪之前）', () => {
    const { graph, board, inner } = sample()
    graph.updateNode(inner, { visible: false })
    expect(clipOrder(graph, [board])).toEqual([board])
    graph.updateNode(board, { visible: false })
    expect(clipOrder(graph, [board])).toEqual([])
    expect(textOrder(graph, [board])).toEqual([])
  })

  it('没子节点的容器不生成裁剪（上游要 `childIds.length > 0`）', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]!
    const bare = graph.createNode('FRAME', page.id, { name: '空容器', clipsContent: true })
    expect(clipOrder(graph, [bare.id])).toEqual([])
  })

  it('子节点不可见但存在，仍算「有子」——clipPath 已经进了 defs，用不用是另一回事', () => {
    const { graph, board, inner } = sample()
    for (const child of graph.getChildren(inner)) graph.updateNode(child.id, { visible: false })
    expect(clipOrder(graph, [board])).toEqual([board, inner])
  })
})

describe('与上游对账：这条遍历是复刻来的', () => {
  const upstream = read('../../../../node_modules/@open-pencil/core/dist/io/formats/svg/export.js')

  it('上游生成裁剪的条件就是「clipsContent 且子节点数 > 0」', () => {
    expect(upstream).toContain('if (node.clipsContent && node.childIds.length > 0) {')
  })

  it('上游的裁剪矩形是**直角**的（没有 rx/ry）——这正是要补的那一处', () => {
    const clip = /ctx\.defs\.push\(svg\("clipPath", \{ id: clipId \}, svg\("rect", \{([^}]*)\}\)/.exec(
      upstream,
    )
    expect(clip).not.toBeNull()
    expect(clip?.[1]).not.toContain('rx')
  })

  it('上游的文本是**一个** `<text>`，不折行', () => {
    // `renderTextNode` 只吐一个元素：没有 tspan 时直接给整段 `node.text`。
    expect(upstream).toContain('}, node.text);')
    expect(upstream).not.toContain('wrapText')
  })

  it('裁剪是**先序**生成的（节点自己先于子树——配对顺序按的就是这个）', () => {
    const body = /function renderNode\(node, ctx\) \{[\s\S]*?\n\}/.exec(upstream)?.[0] ?? ''
    const clip = body.indexOf('buildGroupAttrs(node, ctx)')
    const children = body.indexOf('renderNode(child, ctx)')
    expect(clip).toBeGreaterThanOrEqual(0)
    expect(children).toBeGreaterThan(clip)
  })
})

describe('接线：三件事都得在交给 svg2pdf 之前真的被调到', () => {
  const pdf = read('../../../../src/client/artifact/viewers/design/design-pdf.ts')
  const io = read('../../../../src/client/artifact/viewers/design/design-io.ts')

  it('修整函数把三件事都串上了', () => {
    const body = /function repairPdfSvg\([\s\S]*?\n\}/.exec(pdf)?.[0] ?? ''
    expect(body).toContain('restoreClipRadii(')
    expect(body).toContain('clampRectRadii(')
    expect(body).toContain('wrapTextElements(')
  })

  it('修整在 `svg2pdf` **之前**（之后做等于白做）', () => {
    expect(pdf.indexOf('repairPdfSvg(parsed.documentElement')).toBeGreaterThanOrEqual(0)
    expect(pdf.indexOf('repairPdfSvg(parsed.documentElement')).toBeLessThan(pdf.indexOf('svg2pdf(parsed.documentElement'))
  })

  it('折行用的是 jsPDF 自己的字表（边界必须与真画出来的那支字面一致）', () => {
    expect(pdf).toContain('getStringUnitWidth')
    expect(pdf).toContain('wrapTextLines')
  })

  it('每一页都把容器 id 带上了（没有它，元素与节点配不上对）', () => {
    expect(io).toContain('containerId: container.id')
    expect(io).toContain('renderPdfDocument(graph, pages,')
  })
})
