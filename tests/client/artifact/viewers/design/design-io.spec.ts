/**
 * `design-io.ts` 的接线：**交出去之前要换字体名，PDF 那条自己建文档**（v1.60 起，v1.61 补齐）。
 *
 * 这一组读源码文本、不 import：那个模块拉着 `@open-pencil/core/io` 与 CanvasKit
 * （经 `design-skia.ts`），node 里 import 即死。能钉住的只是「这一步被接上了」——
 * 「哪些格式换到哪个名字」由 `tests/core/artifact/design.spec.ts` 那组真图判、「PDF 文档
 * 里到底嵌没嵌字体」由 `.workbuddy/repro/design-export` 那份真浏览器探针判（它会解开产物
 * 看 `/Type0` / `/FontFile2`）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../../../../src/client/artifact/viewers/design/design-io.ts', import.meta.url),
  'utf8',
)

/**
 * 取出某个顶层函数的**函数体**文本（`async function name(` 到下一个顶格的 `}`）。
 *
 * 有几个形状在四个函数里重样（`units: [{ name: '', bytes }]` 就是），整份源码里 `toContain`
 * 等于什么都没测。收窄到那个函数自己，断言才有指向。
 */
function bodyOf(name: string): string {
  const start = source.indexOf(`async function ${name}(`)
  if (start < 0) throw new Error(`源码里没有 ${name}`)
  const end = source.indexOf('\n}\n', start)
  if (end < 0) throw new Error(`${name} 找不到收尾的顶格 }`)
  return source.slice(start, end)
}

/** 同上，给**非 async** 的顶层函数用（`splitFigLines` / `replaceWithLines` 是同步的）。 */
function fnBodyOf(name: string): string {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`源码里没有 ${name}`)
  const end = source.indexOf('\n}\n', start)
  if (end < 0) throw new Error(`${name} 找不到收尾的顶格 }`)
  return source.slice(start, end)
}

describe('design-io 的导出接线', () => {
  it('判断与动作各一次：一张表说了算，没有第二条路也在换字体', () => {
    // 一条查表挡在四条路前面、一处调用改图——多出来的一次调用就是「有另一条路也在换」。
    expect(source.match(/exportTextRetarget\(request\.format\)/g)).toHaveLength(1)
    expect(source.match(/retargetTextFonts\(graph, retarget\)/g)).toHaveLength(1)
  })

  it('换字体挡在渲染器之前：它动的是交给对方的那份数据，与画法无关', () => {
    const retarget = source.indexOf('retargetTextFonts(graph, retarget)')
    const renderer = source.indexOf('await createExportRenderer()')
    expect(retarget).toBeGreaterThan(-1)
    expect(renderer).toBeGreaterThan(-1)
    expect(retarget).toBeLessThan(renderer)
  })

  it('PDF 那条自己建文档，并且只交回**一件**（页在文档里面，客户端不必再合并）', () => {
    // v1.64 起签名多了第一个 `graph`：交出去之前要在 SVG 上修三处（折行 / 裁剪的圆角 /
    // 圆角的夹法），那三件都要读图（见 `pdf-svg.ts`）。
    expect(source.match(/renderPdfDocument\(graph, pages, pdfTextStyles\(graph\), font\)/g)).toHaveLength(1)
    // 断言收进 `pdfDocument` 的**函数体**里：这个文件里有四个出口，整份源码上的 `toContain`
    // 挡不住「PDF 这条改成了多件、而别的函数里恰好还留着同样一行」。一件 → 名字空串；多件才
    // 会走到客户端那条打包成 zip 的路（`client/canvas/design-export.ts`）。
    const body = bodyOf('pdfDocument')
    expect(body).toContain('renderPdfDocument(')
    expect(body.match(/units: \[\{ name: '', bytes \}\]/g) ?? []).toHaveLength(1)
  })

  it('字体先取到、再画：取不到就拒导，不交一份没有字的 PDF', () => {
    // v1.65 起 `ensureCJKFont()` 有**两个**正当调用点（fig 那条按样式名登记字面、PDF 这条要字节
    // 嵌进文档），所以这条按 `pdfDocument` 的**函数体**收窄——整份源码上的计数挡不住「取了却没用」。
    const body = bodyOf('pdfDocument')
    const font = body.indexOf('await ensureCJKFont()')
    const render = body.indexOf('renderPdfDocument(')
    expect(font).toBeGreaterThan(-1)
    expect(render).toBeGreaterThan(-1)
    expect(font).toBeLessThan(render)
    // 拒导不是「静默少字」：这条路上取不到字面必须报出来——报的是**码**（文案由
    // `locales.ts` 按码出双语，这个 chunk 不知道界面语言）。
    expect(body).toContain("new DesignExportFailure('cjk-font-missing')")
  })

  it('PDF 不再借客户端的手合并：这一层不认识 pdf-lib', () => {
    expect(source).not.toContain('mergePdf')
  })
})

/**
 * fig 那条**交出去之前改写文本**的接线（v1.65）。
 *
 * 这里能钉的只有顺序与形状——「改写出来的坐标对不对」由 `tests/core/artifact/design/fig-text.spec.ts`
 * 那组纯函数判、「真产物里字形烘在哪儿」由 `.workbuddy/repro/design-export` 那份真浏览器探针判
 * （它会摊开原始 kiwi 载荷逐字段看）。
 */
describe('fig 那条：交出去之前改写文本', () => {
  it('两件事都在 `writeDocument` 之前，各只接一次', () => {
    expect(source.match(/registerFigFontStyles\(graph\)/g)).toHaveLength(1)
    expect(source.match(/splitFigLines\(graph, canvas\.renderer\)/g)).toHaveLength(1)
    const body = bodyOf('figDocument')
    const write = body.indexOf('IO.writeDocument')
    expect(write).toBeGreaterThan(-1)
    expect(body.indexOf('registerFigFontStyles(graph)')).toBeGreaterThan(-1)
    expect(body.indexOf('registerFigFontStyles(graph)')).toBeLessThan(write)
    expect(body.indexOf('splitFigLines(graph, canvas.renderer)')).toBeLessThan(write)
  })

  it('先登记字面、再量折行：量行用的尺子就是写器取字形的同一支', () => {
    // 反了的话，700 号字在量的时候还没有字面，`LineMetrics` 与写器后来烘出来的不是一回事。
    const font = source.indexOf('registerFigFontStyles(graph)')
    const split = source.indexOf('splitFigLines(graph, canvas.renderer)')
    expect(font).toBeGreaterThan(-1)
    expect(split).toBeGreaterThan(-1)
    expect(font).toBeLessThan(split)
  })

  it('替换出来的节点是「写器烘得对的那一种形状」：贴内容、左上对齐、旧烘焙全清', () => {
    const body = fnBodyOf('replaceWithLines')
    // 锚到代码行（`^\s+…,$`）：这些字面在注释里也出现过，纯 `toContain` 会被自己的注释骗过。
    expect(body).toMatch(/^\s+textAutoResize: 'WIDTH_AND_HEIGHT',$/m)
    expect(body).toMatch(/^\s+textAlignHorizontal: 'LEFT',$/m)
    expect(body).toMatch(/^\s+textAlignVertical: 'TOP',$/m)
    expect(body).toMatch(/^\s+textPathData: null,$/m)
    expect(body).toMatch(/^\s+textPathBox: null,$/m)
    expect(body).toMatch(/^\s+textPicture: null,$/m)
    expect(body).toMatch(/^\s+derivedTextGlyphs: null,$/m)
    // 一行一个节点摆到画布上那一行的位置——写器的字形坐标从节点原点起算，**只能**靠摆节点补。
    expect(body).toMatch(/x: plan\.x,/)
    expect(body).toMatch(/y: plan\.y,/)
  })

  it('用上游的 `cloneTree` 复制，不手抄字段名单：上游加字段时这里不会静默少一个', () => {
    expect(fnBodyOf('replaceWithLines')).toMatch(/graph\.cloneTree\(/)
  })

  it('自动布局的父容器下不拆：拆出来的兄弟会参与流式排布，叠起来还把父框撑开', () => {
    const body = fnBodyOf('splitFigLines')
    expect(body).toMatch(/parent\.layoutMode !== 'NONE'/)
    expect(body).toMatch(/parent\.layoutMode !== 'GRID'/)
  })
})
