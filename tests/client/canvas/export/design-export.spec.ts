/**
 * 设计稿导出的客户端一半（F10.1，v1.59）。
 *
 * 画的那一步（fig / PNG / PDF / PPT 到底怎么画出来）在引擎 chunk 里，浏览器之外跑不动；
 * 这一份判据钉的是**它的外面**：产物读没读全、引擎在不在、一件还是多件、多件怎么装、
 * 落盘叫什么、被拒时是哪一种拒绝。引擎与「保存」都是注入的，所以整个文件在 node 里跑得动
 * ——而**包里的字节是对的**这件事不靠回读自己的写器来证明：装出来的那个 zip 交给
 * `tests/core/artifact/zip-reader.ts`（按规范从尾部读中央目录，deflate 用 `node:zlib`），
 * 两个实现互不相识。
 */
import { describe, expect, it } from 'vitest'
import type { ArtifactView } from '../../../../src/types.ts'
import type {
  DesignExportOutcome as EngineOutcome,
  DesignExportRequest,
} from '../../../../src/client/artifact/viewers/design/design-engine-types.ts'
import {
  DESIGN_EXPORT_FORMATS,
  DESIGN_EXPORT_LABEL,
  DESIGN_EXPORT_MIME,
  designArchiveName,
  designEntryStem,
  designExportName,
  designUnitStems,
  exportDesign,
  type DesignExportEngine,
} from '../../../../src/client/canvas/export/design-export.ts'
import { ZIP_MIME } from '../../../../src/client/canvas/export/bundle-export.ts'
import { readZip } from '../../../core/artifact/io/zip-reader.ts'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

/** 一张设计卡片的产物视图，按判据要的样子改。 */
function view(over: Partial<ArtifactView> = {}): ArtifactView {
  return {
    cardId: 'qkxwvd',
    file: '设计1.design',
    name: '设计1',
    kind: 'design',
    present: true,
    text: '{"v":2,"nodes":[]}',
    dataUrl: '',
    truncated: false,
    bytes: 16,
    updatedAt: 0,
    ...over,
  }
}

/** 一台假引擎：照本宣科地给一份收场（也能给一个会抛的）。 */
function engineOf(outcome: EngineOutcome | Error): DesignExportEngine {
  return {
    designExport: async () => {
      if (outcome instanceof Error) throw outcome
      return outcome
    },
  }
}

/** 一次「保存」，把交出来的字节记下来。 */
function saver() {
  const saved: { name: string; bytes: Uint8Array; mime: string }[] = []
  return {
    saved,
    save: (name: string, data: Uint8Array, mime: string) => {
      saved.push({ name, bytes: data, mime })
    },
  }
}

/** 一次导出所需的全部注入，只改要测的那一样。 */
function input(over: Partial<Parameters<typeof exportDesign>[0]> = {}) {
  const { saved, save } = saver()
  const requests: DesignExportRequest[] = []
  const base: Parameters<typeof exportDesign>[0] = {
    view: view(),
    format: 'fig',
    title: '设计1',
    engine: {
      designExport: async (request) => {
        requests.push(request)
        return { kind: 'done', units: [{ name: '', bytes: bytes('FIG') }] }
      },
    },
    save,
    ...over,
  }
  return { saved, requests, input: base }
}

describe('exportDesign：四样出路各自的收场', () => {
  it('产物还没写就不导——说是没有产物，不是导出失败', async () => {
    const { saved, input: given } = input({ view: view({ present: false, text: '' }) })

    expect(await exportDesign(given)).toEqual({ kind: 'refused', reason: 'absent' })
    expect(saved).toEqual([])
  })

  it('只读到半份也不导：设计稿是个 JSON 快照，切一半连解都解不开', async () => {
    const { saved, input: given } = input({ view: view({ truncated: true }) })

    expect(await exportDesign(given)).toEqual({ kind: 'refused', reason: 'truncated' })
    expect(saved).toEqual([])
  })

  it('引擎 chunk 取不到时如实说「这台机器上没有引擎」，不装作导过', async () => {
    const { saved, input: given } = input({ engine: null })

    expect(await exportDesign(given)).toEqual({ kind: 'refused', reason: 'no-engine' })
    expect(saved).toEqual([])
  })

  it('引擎说文档解不开 / 一个容器都没有，照它说的传下去', async () => {
    for (const reason of ['broken', 'empty'] as const) {
      const { input: given } = input({ engine: engineOf({ kind: 'refused', reason }) })

      expect(await exportDesign(given)).toEqual({ kind: 'refused', reason })
    }
  })

  it('引擎给「画不出来」时码与名字要原样带回去：文案由提示条按码出，不在这里丢', async () => {
    const { saved, input: given } = input({
      engine: engineOf({
        kind: 'error',
        message: 'design export failed: unrenderable (主视觉)',
        code: 'unrenderable',
        unit: '主视觉',
      }),
    })

    expect(await exportDesign(given)).toEqual({
      kind: 'failed',
      reason: {
        kind: 'error',
        message: 'design export failed: unrenderable (主视觉)',
        code: 'unrenderable',
        unit: '主视觉',
      },
    })
    expect(saved).toEqual([])
  })

  it('引擎自己抛了异常才算 failed——那是真的出错了，不是被拒', async () => {
    const { input: given } = input({ engine: engineOf(new Error('CanvasKit 没起来')) })

    expect(await exportDesign(given)).toEqual({ kind: 'failed', reason: new Error('CanvasKit 没起来') })
  })

  it('引擎给了零件也算「空的」——不会导出一个空包', async () => {
    const { saved, input: given } = input({ engine: engineOf({ kind: 'done', units: [] }) })

    expect(await exportDesign(given)).toEqual({ kind: 'refused', reason: 'empty' })
    expect(saved).toEqual([])
  })
})

describe('exportDesign：一件与多件', () => {
  it('一件就直接给那个文件，名字是卡片名加扩展名', async () => {
    const { saved, input: given } = input()

    expect(await exportDesign(given)).toEqual({ kind: 'done', name: '设计1.fig', files: 1 })
    expect(saved[0]?.name).toBe('设计1.fig')
    expect(new TextDecoder().decode(saved[0]?.bytes)).toBe('FIG')
  })

  it('四样各自的 MIME：fig 按二进制、png 按图片、pdf 按 PDF、pptx 按 OOXML 的包', () => {
    expect(DESIGN_EXPORT_MIME.fig).toBe('application/octet-stream')
    expect(DESIGN_EXPORT_MIME.png).toBe('image/png')
    expect(DESIGN_EXPORT_MIME.pdf).toBe('application/pdf')
    expect(DESIGN_EXPORT_MIME.pptx).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    )
  })

  it('多张图打成一个 zip：里面一层同名文件夹，解压出来是一个完整的文件夹', async () => {
    const { saved, input: given } = input({
      format: 'png',
      engine: engineOf({
        kind: 'done',
        units: [
          { name: '主视觉', bytes: bytes('PNG-A') },
          { name: '细节', bytes: bytes('PNG-B') },
        ],
      }),
    })

    const outcome = await exportDesign(given)

    expect(outcome).toEqual({ kind: 'done', name: '设计1.zip', files: 2 })
    expect(saved[0]?.name).toBe('设计1.zip')
    expect(saved[0]?.mime).toBe(ZIP_MIME)
    // 包交给**另一个**实现去解：manifest 里那两张图必须原样在里面。
    const entries = readZip(saved[0]?.bytes ?? new Uint8Array())
    expect(entries.map((entry) => entry.name)).toEqual(['设计1/主视觉.png', '设计1/细节.png'])
    expect(entries.map((entry) => new TextDecoder().decode(entry.bytes))).toEqual(['PNG-A', 'PNG-B'])
  })

  it('PPT 也一样：一页器一份幻灯片序列，多页就打成包', async () => {
    const { saved, input: given } = input({
      format: 'pptx',
      engine: engineOf({
        kind: 'done',
        units: [
          { name: '页面 1', bytes: bytes('PPT-1') },
          { name: '页面 2', bytes: bytes('PPT-2') },
        ],
      }),
    })

    await exportDesign(given)

    expect(readZip(saved[0]?.bytes ?? new Uint8Array()).map((entry) => entry.name)).toEqual([
      '设计1/页面 1.pptx',
      '设计1/页面 2.pptx',
    ])
  })

  it('PDF 是**一件**：一容器一页全写在同一份文档里，直接给，不打包也不合并', async () => {
    // v1.61 之前这里是「一容器一份单页 PDF，客户端用 pdf-lib 并起来」。现在引擎自己建文档
    // （要嵌字体，就得够得着那句 `new jsPDF(...)`），页在文档里面——于是这一条的契约变成
    // 「一件就是一份多页 PDF」，客户端不必再认识 pdf-lib。
    const { saved, input: given } = input({
      format: 'pdf',
      engine: engineOf({ kind: 'done', units: [{ name: '', bytes: bytes('%PDF-1.7 三页') }] }),
    })

    expect(await exportDesign(given)).toEqual({ kind: 'done', name: '设计1.pdf', files: 1 })
    expect(saved[0]?.name).toBe('设计1.pdf')
    expect(saved[0]?.mime).toBe('application/pdf')
    expect(new TextDecoder().decode(saved[0]?.bytes)).toBe('%PDF-1.7 三页')
  })

  it('装包那一步抛了异常照实说，不假装导出成功', async () => {
    const { input: given } = input({
      format: 'png',
      engine: engineOf({
        kind: 'done',
        units: [
          { name: 'A', bytes: bytes('A') },
          { name: 'B', bytes: bytes('B') },
        ],
      }),
      save: () => {
        throw new Error('磁盘满了')
      },
    })

    expect(await exportDesign(given)).toEqual({ kind: 'failed', reason: new Error('磁盘满了') })
  })

  it('格式与倍率原样交给引擎（倍率在引擎那一侧定，这里不掺和）', async () => {
    const { requests, input: given } = input({ format: 'png' })

    await exportDesign(given)

    expect(requests).toEqual([{ envelope: '{"v":2,"nodes":[]}', format: 'png' }])
    expect(DESIGN_EXPORT_FORMATS).toEqual(['fig', 'png', 'pdf', 'pptx'])
  })
})

describe('落盘名：用户起的名字 → 一段合法的路径段', () => {
  it('四样各带自己的扩展名', () => {
    expect(designExportName('市场分析', 'fig')).toBe('市场分析.fig')
    expect(designExportName('市场分析', 'png')).toBe('市场分析.png')
    expect(designExportName('市场分析', 'pdf')).toBe('市场分析.pdf')
    expect(designExportName('市场分析', 'pptx')).toBe('市场分析.pptx')
    expect(designArchiveName('市场分析')).toBe('市场分析.zip')
  })

  it('名字里的路径分隔符与控制字符进不去（它会变成用户磁盘上的一个文件名）', () => {
    expect(designExportName('a/b\\c', 'fig')).toBe('a-b-c.fig')
    expect(designExportName('设计\u0000x', 'fig')).toBe('设计x.fig')
  })

  it('清光了退回「设计」——一个叫 .fig 的文件几乎打不开', () => {
    expect(designExportName('///', 'fig')).toBe('设计.fig')
    expect(designArchiveName('...')).toBe('设计.zip')
  })

  it('装包那层文件夹与包名同一个基名', async () => {
    const { saved, input: given } = input({
      format: 'png',
      title: '市场分析',
      engine: engineOf({
        kind: 'done',
        units: [
          { name: 'A', bytes: bytes('A') },
          { name: 'B', bytes: bytes('B') },
        ],
      }),
    })

    await exportDesign(given)

    expect(saved[0]?.name).toBe('市场分析.zip')
    expect(readZip(saved[0]?.bytes ?? new Uint8Array()).map((entry) => entry.name)).toEqual([
      '市场分析/A.png',
      '市场分析/B.png',
    ])
  })
})

describe('条目名：容器名 / 页面名（文档给的，不是用户起的）', () => {
  it('路径分隔符与控制字符换成下划线，首尾的空白与点去掉', () => {
    expect(designEntryStem('a/b', '图')).toBe('a_b')
    expect(designEntryStem('a\\b', '图')).toBe('a_b')
    expect(designEntryStem(' a:b*c?d"e<f>g|h ', '图')).toBe('a_b_c_d_e_f_g_h')
    // 末尾的点在 Windows 上会被静默吃掉，`.git` 这种名字更不能进包。
    expect(designEntryStem('  .git.  ', '图')).toBe('git')
  })

  it('路径不许从名字里爬出去', () => {
    // 换掉 `/` 与 `.` 之后还要剥掉开头那些点，`../evil` 于是只是一个普通基名。
    expect(designEntryStem('../evil', '图')).toBe('_evil')
    expect(designEntryStem('..', '图')).toBe('图')
  })

  it('分隔符是被**换掉**而不是删掉的：一个全是分隔符的名字也还留得下自己的身份', () => {
    // 换而不是删，为的是两个不同的破名字仍然是两个不同的名字——删光的话它们都变成兜底名，
    // 再靠 `-2` 去重，等于替文档掩饰它取过这种名字。真正什么都不剩的（空串、纯空白、
    // 只剩点）才回落到兜底名。
    expect(designEntryStem('///', '图')).toBe('___')
    expect(designEntryStem('', '幻灯片')).toBe('幻灯片')
    expect(designEntryStem('   ', '幻灯片')).toBe('幻灯片')
    expect(designUnitStems(['///', ''], '图')).toEqual(['___', '图'])
  })

  it('重名补 -2、-3——zip 里两条同名条目会让一部分解压器静默覆盖', () => {
    expect(designUnitStems(['容器', '容器', '容器', '别的'], '图')).toEqual(['容器', '容器-2', '容器-3', '别的'])
  })

  it('去重是**清完之后**比的：`a/b` 与 `a_b` 会撞在一起', () => {
    expect(designUnitStems(['a/b', 'a_b'], '图')).toEqual(['a_b', 'a_b-2'])
  })

  it('兜底名一样时也去重', () => {
    expect(designUnitStems(['', ''], '图')).toEqual(['图', '图-2'])
  })
})

describe('格式表与它的文案表', () => {
  it('每一样都有菜单里那行的字典键（表的两半分不开）', () => {
    for (const format of DESIGN_EXPORT_FORMATS) {
      expect(DESIGN_EXPORT_LABEL[format], format).toMatch(/^canvas\.export\./)
    }
    expect(DESIGN_EXPORT_FORMATS).toEqual(['fig', 'png', 'pdf', 'pptx'])
  })
})
