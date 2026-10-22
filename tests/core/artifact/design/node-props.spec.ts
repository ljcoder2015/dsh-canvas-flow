/**
 * 设计属性面板判据表（F2.6，`src/core/artifact/design/node-props.ts`）的判据。
 *
 * 三件事各钉一组：
 * 1. **纯判据本身**——夹取、就近取字重、形状 traits、弧的换算。这些是面板与引擎都要用的
 *    事实，算错了会静默写出画不出来的值。
 * 2. **与真源对账**——混合模式的取值集合与 `@open-pencil/scene-graph` 的类型声明逐字相同；
 *    可选字重档与 `design-skia.ts` 真注册的字面份数相同。这两张表是手写的，手写的表就会漂移，
 *    而漂移的后果都不是报错：列一个场景图不认的模式、或列一档没有字面的字重（文字画成空白）。
 * 3. **接线**——面板与引擎真的用了这张表。接线长在 JSX / 引擎里，node 下 import 不了
 *    （`design-panels.tsx` 一进来就碰宿主 UI 原语），所以读源码文本判。
 *
 * 读源码文本这一路的纪律（v1.61 验红抓出来的两条）：断言要**锚到代码行**上——`toContain`
 * 会被文件头注释命中（注释里恰好写着那个名字的教训已经有过一次），也不许拿「同文件别处恰好
 * 还有一行一样的」来兜住一条已经坏掉的接线。所以下面一律用带缩进/完整调用形状的正则。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BLEND_MODES,
  LATIN_TEXT_FAMILY,
  POINT_COUNT_MAX,
  POINT_COUNT_MIN,
  TEXT_ALIGNMENTS,
  TEXT_AUTO_RESIZE,
  TEXT_FAMILIES,
  arcAngles,
  arcSweep,
  clampPointCount,
  clampRatio,
  hasStarInnerRadius,
  settleWeight,
  shapeTraitsOf,
  weightLabel,
  weightsOf,
} from '../../../../src/core/artifact/design/node-props.ts'
import { CJK_TEXT_FAMILY } from '../../../../src/core/artifact/design/export-font.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** scene-graph 的类型声明——BlendMode 的真源。 */
const sceneTypes = read('../../../../node_modules/@open-pencil/scene-graph/dist/types.d.ts')
/** 真注册字面的那份文件。 */
const skiaSource = read('../../../../src/client/artifact/viewers/design/design-skia.ts')
const panelSource = read('../../../../src/client/artifact/viewers/design/design-panels.tsx')
const engineSource = read('../../../../src/client/artifact/viewers/design/design-engine.ts')

/** 从类型声明里抠一个字符串字面量联合（`type X = 'A' | 'B';`）。 */
function unionOf(source: string, name: string): string[] {
  const line = new RegExp(`type ${name} = ([^;]+);`).exec(source)?.[1] ?? ''
  return [...line.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1])
}

/** 同上，但取接口里某一格的内联联合（`textAlignHorizontal: 'LEFT' | …;`）。 */
function fieldUnion(source: string, field: string): string[] {
  const line = new RegExp(`\\n\\s*${field}: ([^;]+);`).exec(source)?.[1] ?? ''
  return [...line.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1])
}

describe('混合模式表', () => {
  it('与场景图的 BlendMode 逐字同集（不多一个、也不少一个）', () => {
    const truth = unionOf(sceneTypes, 'BlendMode')
    // 真源先得找得到：抠不出来说明这份类型声明换形状了，那时这条对账得跟着改，不能算过。
    expect(truth.length).toBeGreaterThan(10)
    expect([...BLEND_MODES.map((mode) => mode.id)].sort()).toEqual([...truth].sort())
  })

  it('每一格都有自己的中文名，且没有重复项', () => {
    const labels = BLEND_MODES.map((mode) => mode.label)
    expect(labels.every((label) => label.length > 0)).toBe(true)
    expect(new Set(labels).size).toBe(labels.length)
    expect(BLEND_MODES[0].id).toBe('NORMAL')
  })
})

describe('可选字体与字重', () => {
  it('列的就是真注册的那几支字面（族名与 design-skia 同源，不是各写一份字符串）', () => {
    expect(TEXT_FAMILIES.map((family) => family.id)).toEqual([LATIN_TEXT_FAMILY, CJK_TEXT_FAMILY])
    // 两个名字都得是**从本模块/app 导出常量导入来的标识符**，而不是那边手写的 'Inter' 字面——
    // 手写的字符串正是「同一个东西两个来源」，漂移之后下拉里选得中、画布上画不出。
    expect(skiaSource).toMatch(
      /import \{ LATIN_TEXT_FAMILY \} from '(?:\.\.\/)+core\/artifact\/design\/node-props\.ts'/,
    )
    expect(skiaSource).toMatch(
      /import \{ CJK_TEXT_FAMILY \} from '(?:\.\.\/)+core\/artifact\/design\/export-font\.ts'/,
    )
    // 中文字面确实以这个名字注册进 fontManager（面板列它才有意义）。
    expect(skiaSource).toMatch(/loadFontFile\(CJK_TEXT_FAMILY, 'Regular', CJK_FONT_FILE\)/)
  })

  it('每支字面的字重档数 = 那边真注册的字面份数', () => {
    const registered = skiaSource.match(/\[LATIN_TEXT_FAMILY, '/g)?.length ?? 0
    expect(registered).toBeGreaterThan(1)
    expect(weightsOf(LATIN_TEXT_FAMILY)).toHaveLength(registered)
    // 中文只有 Regular 一支（17.7MB 一份，别指望有粗体）。
    expect(weightsOf(CJK_TEXT_FAMILY)).toEqual([400])
  })

  it('换字体族时字重落到新字面真有的那一档（并列取小的）', () => {
    expect(settleWeight(CJK_TEXT_FAMILY, 700)).toBe(400)
    expect(settleWeight(CJK_TEXT_FAMILY, 400)).toBe(400)
    // 300 与 400/500 的距离是 100 与 200 → 400。
    expect(settleWeight(LATIN_TEXT_FAMILY, 300)).toBe(400)
    // 650 到 600 与 700 一样近 → 取小的那个。
    expect(settleWeight(LATIN_TEXT_FAMILY, 650)).toBe(600)
    expect(settleWeight(LATIN_TEXT_FAMILY, 600)).toBe(600)
  })

  it('不认识的族退回 Regular；表外的字重原样回显（不偷偷改用户的旧值）', () => {
    expect(weightsOf('Comic Sans MS')).toEqual([400])
    expect(weightLabel(500)).toBe('中等 Medium')
    expect(weightLabel(300)).toBe('300')
  })
})

describe('文本对齐与尺寸行为', () => {
  it('取值与场景图同一组', () => {
    const truth = fieldUnion(sceneTypes, 'textAlignHorizontal')
    expect(truth.length).toBeGreaterThan(2)
    expect([...TEXT_ALIGNMENTS.map((align) => align.id)].sort()).toEqual([...truth].sort())
  })

  it('尺寸行为与场景图同一组', () => {
    const truth = unionOf(sceneTypes, 'TextAutoResize')
    expect(truth.length).toBeGreaterThan(2)
    expect([...TEXT_AUTO_RESIZE.map((mode) => mode.id)].sort()).toEqual([...truth].sort())
  })
})

describe('形状特有属性按类型分', () => {
  it('多边形给边数、星形给角数+内径、椭圆给弧，别的类型什么都不给', () => {
    expect(shapeTraitsOf('polygon')).toEqual({ title: '多边形', pointCountLabel: '边数', arc: false })
    expect(shapeTraitsOf('star')).toEqual({ title: '星形', pointCountLabel: '角数', arc: false })
    expect(shapeTraitsOf('ellipse')).toEqual({ title: '', pointCountLabel: '', arc: true })
    for (const type of ['rectangle', 'frame', 'text', 'vector', 'group']) {
      expect(shapeTraitsOf(type)).toEqual({ title: '', pointCountLabel: '', arc: false })
      expect(hasStarInnerRadius(type)).toBe(false)
    }
    expect(hasStarInnerRadius('star')).toBe(true)
  })

  it('边数夹在 3–60 且取整（半个角画不出来）', () => {
    expect(clampPointCount(2)).toBe(POINT_COUNT_MIN)
    expect(clampPointCount(3.4)).toBe(3)
    expect(clampPointCount(61)).toBe(POINT_COUNT_MAX)
    expect(clampPointCount(Number.NaN)).toBe(POINT_COUNT_MIN)
  })

  it('比例夹在 0–1（星形内径、椭圆内径）', () => {
    expect(clampRatio(-1)).toBe(0)
    expect(clampRatio(2)).toBe(1)
    expect(clampRatio(Number.NaN)).toBe(0)
    expect(clampRatio(0.35)).toBe(0.35)
  })

  it('弧：起点 + 扫过角 ↔ 起点/终点角，往返不丢信息', () => {
    expect(arcAngles(30, 90)).toEqual({ startingAngle: 30, endingAngle: 120 })
    expect(arcAngles(30, -90)).toEqual({ startingAngle: 30, endingAngle: -60 })
    expect(arcSweep(arcAngles(30, -90))).toBe(-90)
    // 整圈：写成 360 读回来还是 360（不归一化，用户输入不被吃掉）。
    expect(arcSweep(arcAngles(0, 360))).toBe(360)
  })
})

describe('面板接线', () => {
  it('形状特有一律问 traits，面板里没有按形状类型分叉', () => {
    expect(panelSource).toMatch(/const traits = shapeTraitsOf\(read\.type\)/)
    expect(panelSource).toMatch(/traits\.title === '' \? null/)
    expect(panelSource).toMatch(/\{traits\.pointCountLabel\}/)
    expect(panelSource).toMatch(/hasStarInnerRadius\(read\.type\)/)
    // 这三种写法都是「按形状类型自己判」——出现任何一个就说明判据长了第二处。
    for (const type of ['polygon', 'star', 'ellipse']) {
      expect(panelSource).not.toContain(`read.type === '${type}'`)
    }
  })

  it('换字体时把字重一起落下（一次编辑一笔 undo，不留取不到字面的中间态）', () => {
    expect(panelSource).toMatch(/commit\(\{ fontFamily, fontWeight: settleWeight\(fontFamily, read\.fontWeight\) \}\)/)
  })

  it('混合模式/对齐/尺寸行为的下拉都直接读表，不另抄一份取值', () => {
    expect(panelSource).toMatch(/options=\{BLEND_MODES\.map\(/)
    expect(panelSource).toMatch(/options=\{TEXT_ALIGNMENTS\.map\(/)
    expect(panelSource).toMatch(/options=\{TEXT_AUTO_RESIZE\.map\(/)
  })

  it('引擎侧认得这三个新字段，并且边数/内径在写下去之前夹过', () => {
    expect(engineSource).toMatch(/\n\s+const next = clampPointCount\(props\.pointCount\)/)
    expect(engineSource).toMatch(/\n\s+const next = clampRatio\(props\.starInnerRadius\)/)
    expect(engineSource).toMatch(/\n\s+if \(props\.arc !== undefined\) \{/)
    // 排版那几项走同一条标量节律（旧值先记下、再提交一笔 undo）。
    expect(engineSource).toMatch(/\n\s+'textAlignHorizontal',/)
    expect(engineSource).toMatch(/\n\s+'fontFamily',/)
  })
})
