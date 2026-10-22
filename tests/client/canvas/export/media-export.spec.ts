/**
 * 媒体卡（图片 / 视频 / 音频）的导出（F10.1，v1.83）。
 *
 * 这一份判据全是纯函数：命名（卡片名 + 产物扩展名）、data URL 的解码、以及「这次能不能
 * 导」。它刻意**不碰**「下载怎么发生」——那是 `download.ts` 里一句 `a[download]`，也是别的
 * 三条导出通道共用的；这里只钉「交给它的东西对不对」。
 *
 * 三条东西值得单独记下来，因为它们各自都曾经是别处的 bug：
 *
 * 1. **文件名跟卡片走，扩展名跟产物走**。卡片改名之后（「海边日落」→「海边日落 终稿」），
 *    产物还是 `海边日落.jpg`；把旧文件名原样塞回去，用户会以为改名没生效。
 * 2. **`truncated` 举旗时一份都不导**。`readArtifact` 超上限时不给字节、只举旗；把空数组
 *    交给下载，用户会得到一个 0 字节的文件，而提示条写着「已导出」。
 * 3. **客户端不抄那个上限**。这里只读 `truncated`，不出现 `VIEW_BYTES_CAP`，也不写死
 *    16MB——两个来源迟早有一个是错的（同一件事在 `card-tile.spec.ts` 第 5 条已经钉过）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ArtifactView } from '../../../../src/types.ts'
import { mediaExportNameOf, mediaExportPlanOf } from '../../../../src/client/canvas/export/media-export.ts'
import { mediaExportNotice, type NoticeTranslate } from '../../../../src/client/canvas/asset/notice.ts'
import { zh, type CanvasKey } from '../../../../src/client/ui/locales.ts'

/** 一份 `readArtifact` 的答案，只写这一组判据关心的字段。 */
function viewOf(overrides: Partial<ArtifactView> = {}): ArtifactView {
  return {
    cardId: 'c1',
    file: 'images/海边日落.jpg',
    name: '海边日落',
    kind: 'image',
    present: true,
    text: '',
    dataUrl: dataUrlOf('image/jpeg', new Uint8Array([1, 2, 3])),
    truncated: false,
    bytes: 3,
    updatedAt: 0,
    ...overrides,
  }
}

/** `data:<mime>;base64,…`，与宿主 `ArtifactIo.view()` 拼出来的形状一致。 */
function dataUrlOf(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}

describe('导出时叫什么：卡片名的词干 + 产物的扩展名', () => {
  it('卡片名就是下载名，扩展名取产物自己的', () => {
    expect(mediaExportNameOf('海边日落', 'images/海边日落.jpg')).toBe('海边日落.jpg')
  })

  it('卡片改过名——下载名跟着卡片走，不跟着旧文件名走', () => {
    expect(mediaExportNameOf('海边日落 终稿', 'images/海边日落.jpg')).toBe('海边日落-终稿.jpg')
  })

  it('卡片名清不出东西时退回产物的词干', () => {
    expect(mediaExportNameOf('', 'images/海边日落.jpg')).toBe('海边日落.jpg')
    // 全是分隔符与空白：清完什么都不剩，与空名字同一条回落。
    expect(mediaExportNameOf('///  ', 'clips/intro.mp4')).toBe('intro.mp4')
  })

  it('文件名不能带的东西换成连字符，与控制带那条命名同一条规矩', () => {
    expect(mediaExportNameOf('a/b:c?d*e', 'x.png')).toBe('a-b-c-d-e.png')
  })

  it('产物没有扩展名时，名字就只有词干', () => {
    expect(mediaExportNameOf('录音', 'notes/录音')).toBe('录音')
  })

  it('两边都清不出东西时还有一个兜底名——文件总得有个名字', () => {
    expect(mediaExportNameOf('', '')).toBe('artifact')
  })

  it('扩展名保留磁盘上的大小写：那是用户自己的习惯', () => {
    expect(mediaExportNameOf('照片', 'IMG_0042.JPG')).toBe('照片.JPG')
  })
})

describe('这次能不能导：读到的整份才导', () => {
  it('整份读到了：字节原样解出来，MIME 从 data URL 头里取', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255])
    const plan = mediaExportPlanOf(viewOf({ dataUrl: dataUrlOf('video/mp4', bytes) }), '海边日落')

    expect(plan.kind).toBe('ready')
    if (plan.kind !== 'ready') return
    // 逐字节比：`atob` + `charCodeAt` 那条路最容易在 0x80 以上出错，而 mp4 里到处是它们。
    expect(Array.from(plan.bytes)).toEqual(Array.from(bytes))
    expect(plan.mime).toBe('video/mp4')
    expect(plan.name).toBe('海边日落.jpg')
  })

  it('产物还没生成：说「没有可导出的内容」，而不是导一个空文件', () => {
    expect(mediaExportPlanOf(viewOf({ present: false, dataUrl: '' }), '海边日落')).toEqual({ kind: 'absent' })
  })

  it('宿主举了 `truncated`：一份都不导（半份 mp4 配「已导出」比不导更坏）', () => {
    // 夹具里**故意带着字节**：真实的宿主超上限时只举旗不给字节，但这一条要挡的正是
    // 「举了旗却还有半份字节」——那时信字节就会导出半个 mp4。旗比字节可信。
    const half = dataUrlOf('video/mp4', new Uint8Array([1, 2, 3]))
    expect(mediaExportPlanOf(viewOf({ truncated: true, dataUrl: half }), '海边日落')).toEqual({ kind: 'truncated' })
  })

  it('举旗与空 dataUrl 是同一件事的两面：没有字节就是不导', () => {
    // 宿主超上限时只举旗、不给字节；万一哪一版只做了其中一半，这条会响。
    expect(mediaExportPlanOf(viewOf({ dataUrl: '' }), '海边日落')).toEqual({ kind: 'truncated' })
  })

  it('卡片名为空时，文件名用 view 里那份（宿主戳的名字）', () => {
    const plan = mediaExportPlanOf(viewOf({ name: '海边日落' }), '')
    expect(plan.kind).toBe('ready')
    if (plan.kind === 'ready') expect(plan.name).toBe('海边日落.jpg')
  })

  it('data URL 不是那个形状：照实说读不出来，不猜一份字节出来', () => {
    for (const dataUrl of ['javascript:void 0', 'data:image/png,rawbytes', 'data:image/png;base64,***']) {
      const plan = mediaExportPlanOf(viewOf({ dataUrl }), '海边日落')
      expect(plan.kind, dataUrl).toBe('failed')
    }
  })

  it('MIME 头是空的（或没有）时退到 octet-stream：下载照样成立', () => {
    const plan = mediaExportPlanOf(viewOf({ dataUrl: dataUrlOf('', new Uint8Array([9])) }), 'x')
    expect(plan.kind).toBe('ready')
    if (plan.kind === 'ready') expect(plan.mime).toBe('application/octet-stream')
  })
})

describe('收场怎么说：三档口气', () => {
  // 真读中文字典，而不是「把键原样吐回来」：这一档判的正是**用户看到的那句话**，
  // 键对句子错（比如把「太大」接到「还没生成」那一句上）在键原样回显的假 t 里看不出来。
  const translate = (key: CanvasKey, vars?: Record<string, string>): string =>
    String(zh[key]).replace(/\{(\w+)\}/g, (_, name: string) => vars?.[name] ?? `{${name}}`)
  const t = translate as unknown as NoticeTranslate

  it('成了：一句「已导出 x」（与文本导出共用那一句）', () => {
    const notice = mediaExportNotice({ kind: 'ready', name: '海边日落.jpg', bytes: new Uint8Array(), mime: 'image/jpeg' }, t)
    expect(notice).toEqual({ text: '已导出 海边日落.jpg', tone: 'ok' })
  })

  it('还没生成 / 太大：都是「这次没导成」，不是出错', () => {
    expect(mediaExportNotice({ kind: 'absent' }, t).tone).toBe('warn')
    expect(mediaExportNotice({ kind: 'truncated' }, t).tone).toBe('warn')
    expect(mediaExportNotice({ kind: 'truncated' }, t).text).toContain('画布目录')
  })

  it('内容读不出来才是 error，而且带上原因', () => {
    const notice = mediaExportNotice({ kind: 'failed', reason: '形状不认识' }, t)
    expect(notice.tone).toBe('error')
    expect(notice.text).toContain('形状不认识')
  })
})

describe('两件事不许发生在这一层', () => {
  const source = readFileSync(new URL('../../../../src/client/canvas/export/media-export.ts', import.meta.url), 'utf8')

  it('不抄字节上限——只读宿主回的 `truncated`', () => {
    expect(source).not.toContain('VIEW_BYTES_CAP')
    expect(source).not.toMatch(/16_?000_?000/)
    expect(source).toContain('view.truncated')
  })

  it('不做格式转换：这一层不认识任何「导出成什么格式」', () => {
    // 媒体导出是原样拿走。出现一张「目标格式」表，就意味着有人在猜用户要哪一种转换。
    expect(source).not.toContain('ExportFormat')
    expect(source).not.toMatch(/toPng|convert|transcode/i)
  })
})
