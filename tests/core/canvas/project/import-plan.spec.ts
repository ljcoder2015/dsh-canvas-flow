/**
 * 「导入本地文件当产物」的判据（F2.7，v1.81）。
 *
 * 用户原话：「卡片操作栏添加导入功能，可以上传本地的图片和视频当做产物」。
 *
 * 这件事的规矩全在一个纯模块里（`core/canvas/import-plan.ts`），因为**两边都要判**：
 * 客户端要赶在编码之前拦掉一个 80MB 的视频，宿主仍是最终那一关（客户端可以被绕过，磁盘
 * 上的真相也只有它知道）。两边判同一件事，如果各写一份，就是「同一个东西两个来源」——
 * 这一次的表现会是「界面说能导，导进去报错」或者反过来。
 *
 * 四组：
 *
 * 1. **名字**：浏览器给的文件名可以带目录、可以带控制字符、可以没有扩展名。这里验它被收成
 *    一个**不能逃出文件夹**的路径段，而不是原样拼进路径。
 * 2. **拒绝**：三种拒绝各有各的下一步（换文件 / 压小 / 挑错了），所以是三种理由而不是一句
 *    「失败」。
 * 3. **落点**：同目录、同名覆盖自己、撞了别人加 `-2`。
 * 4. **两个数之间的关系**：搬得进来的必须看得见（`IMPORT_MAX_BYTES <= VIEW_BYTES_CAP`），
 *    而且协议层给 base64 留的长度必须容得下最大的那一份。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { IMPORT_MAX_BYTES, IMPORT_REFUSAL_TEXT, importNameOf, importPlanOf } from '../../../../src/core/canvas/project/import-plan.ts'
import { VIEW_BYTES_CAP } from '../../../../src/core/artifact/io/artifact-io.ts'
import { MEDIA_ACCEPT, mediaMimeOf } from '../../../../src/core/media/mime.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** 一个「磁盘上已经有这些文件」的 `taken`；顺带记下问过哪些名字。 */
function diskWith(files: readonly string[]): { taken: (file: string) => Promise<boolean>; asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    taken: async (file) => {
      asked.push(file)
      return files.includes(file)
    },
  }
}

describe('文件名收成一个不会逃出文件夹的路径段', () => {
  it('丢掉目录，只留 basename——浏览器给的名字可能带一长串相对路径', () => {
    expect(importNameOf('../../etc/passwd.png').file).toBe('passwd.png')
    expect(importNameOf('a/b/c/照片.jpg').file).toBe('照片.jpg')
  })

  it('反斜杠也当分隔符：Windows 上传来的名字不该把整串当成一个文件名', () => {
    expect(importNameOf('C:\\Users\\me\\海边 日落.JPG').file).toBe('海边-日落.JPG')
    expect(importNameOf('C:\\Users\\me\\海边 日落.JPG').extension).toBe('jpg')
  })

  it('文件名不能带的字符换成连字符，控制字符直接删掉', () => {
    expect(importNameOf('a:b*c?d"e<f>g|h.png').file).toBe('a-b-c-d-e-f-g-h.png')
    expect(importNameOf('照\u0000片.png').file).toBe('照片.png')
  })

  it('开头结尾的点被去掉：一个点开头的名字是隐藏文件，不该这么落盘', () => {
    expect(importNameOf('...photo.png').file).toBe('photo.png')
  })

  it('扩展名认大小写，落盘时保留用户原来的写法', () => {
    const upper = importNameOf('IMG_0042.PNG')
    expect(upper.extension).toBe('png')
    expect(upper.file).toBe('IMG_0042.PNG')
  })

  it('名字里全是点、或者干脆没有名字，就什么都留不下来（由调用方判「不是媒体」）', () => {
    expect(importNameOf('...').file).toBe('')
    expect(importNameOf('   ').extension).toBe('')
  })
})

describe('三种拒绝，三种下一步', () => {
  const plan = (input: { name: string; size: number }): ReturnType<typeof importPlanOf> =>
    importPlanOf({ ...input, current: '', taken: async () => false })

  it('不是媒体扩展名就拒——画布上的产物该是能画、能放、能听的东西', async () => {
    for (const name of ['报告.pdf', 'readme.md', 'archive.zip', 'photo.heic', 'noextension']) {
      const outcome = await plan({ name, size: 10 })
      expect(outcome, `${name} 不该被放进来`).toEqual({ kind: 'refused', reason: 'unsupported' })
    }
  })

  it('媒体表的每一族都放行：图片、视频、音频', async () => {
    for (const [name, mime] of [
      ['a.png', 'image/png'],
      ['a.mp4', 'video/mp4'],
      ['a.mp3', 'audio/mpeg'],
    ] as const) {
      expect(mediaMimeOf(name.split('.')[1] ?? '')).toBe(mime)
      expect(await plan({ name, size: 10 })).toEqual({ kind: 'write', file: name, replaced: false })
    }
  })

  it('0 字节拒：导进去卡片上也没有东西可显示', async () => {
    expect(await plan({ name: 'a.png', size: 0 })).toEqual({ kind: 'refused', reason: 'empty' })
  })

  it('超过上限就拒，正好等于上限则放行（边界不是「小于」）', async () => {
    expect(await plan({ name: 'a.mp4', size: IMPORT_MAX_BYTES })).toEqual({
      kind: 'write',
      file: 'a.mp4',
      replaced: false,
    })
    expect(await plan({ name: 'a.mp4', size: IMPORT_MAX_BYTES + 1 })).toEqual({
      kind: 'refused',
      reason: 'too-large',
    })
  })

  it('三种理由各有各的一句话（合成一句就等于让用户自己猜下一步）', () => {
    expect(new Set(Object.values(IMPORT_REFUSAL_TEXT)).size).toBe(3)
    for (const text of Object.values(IMPORT_REFUSAL_TEXT)) expect(text.length).toBeGreaterThan(8)
  })
})

describe('落在哪个路径', () => {
  it('跟着卡片现产物所在的目录走：一张 decks/ 里的卡导进一张图，图也进 decks/', async () => {
    const disk = diskWith([])
    const outcome = await importPlanOf({ name: '封面.png', size: 10, current: 'decks/slide.md', taken: disk.taken })
    expect(outcome).toEqual({ kind: 'write', file: 'decks/封面.png', replaced: false })
  })

  it('撞上别人的文件就加序号，从 -2 起（同一个规矩：撞名判在磁盘上）', async () => {
    const disk = diskWith(['封面.png', '封面-2.png'])
    const outcome = await importPlanOf({ name: '封面.png', size: 10, current: 'slide.md', taken: disk.taken })
    expect(outcome).toEqual({ kind: 'write', file: '封面-3.png', replaced: false })
    expect(disk.asked).toEqual(['封面.png', '封面-2.png', '封面-3.png'])
  })

  it('撞的是**自己**算替换，不加序号：再导一次同一张图不该变成两个文件', async () => {
    const disk = diskWith(['封面.png'])
    const outcome = await importPlanOf({ name: '封面.png', size: 10, current: '封面.png', taken: disk.taken })
    expect(outcome).toEqual({ kind: 'write', file: '封面.png', replaced: true })
    // 一次都不问磁盘：它就是这张卡自己的文件，没有撞名这回事。
    expect(disk.asked).toEqual([])
  })

  it('替换也发生在子目录里：decks/封面.png 导同一张，仍然是那一个路径', async () => {
    const disk = diskWith([])
    const outcome = await importPlanOf({
      name: '封面.png',
      size: 10,
      current: 'decks/封面.png',
      taken: disk.taken,
    })
    expect(outcome).toEqual({ kind: 'write', file: 'decks/封面.png', replaced: true })
    expect(disk.asked).toEqual([])
  })
})

describe('两个数之间的关系', () => {
  it('搬得进来的必须看得见：导入上限不得超过全屏预览的读取上限', () => {
    expect(
      IMPORT_MAX_BYTES,
      '导入的东西必须也读得回来，否则用户会导进来一个点开就报「产物过大」的文件',
    ).toBeLessThanOrEqual(VIEW_BYTES_CAP)
  })

  it('协议层给 base64 留的长度容得下最大的那一份（16MB 编成 base64 是 4/3）', () => {
    const needed = Math.ceil(IMPORT_MAX_BYTES / 3) * 4
    const contract = read('../../../../src/contract.ts')
    // 注意别写成 `[^)]*`：那一行里 `z.string()` 自带一个右括号，字符类会在那里截断。
    const declared = /fileData: json\(.*?\.max\(([\d_]+)\)/.exec(contract)?.[1]
    expect(declared, '`P.fileData` 的形状变了，这条判据要跟着改').toBeDefined()
    expect(Number((declared ?? '').replace(/_/g, ''))).toBeGreaterThanOrEqual(needed)
  })

  it('accept 是从媒体表推出来的，不是另写一份通配符', () => {
    expect(MEDIA_ACCEPT).toBe('image/*,video/*,audio/*')
    // 表的每一族都该出现在 accept 里——加一种格式时它自己会跟上。
    for (const mime of ['image/png', 'video/mp4', 'audio/mpeg']) {
      expect(MEDIA_ACCEPT).toContain(`${mime.split('/')[0] ?? ''}/*`)
    }
  })
})

describe('纯：一次导入只问磁盘「几次」，不读内容', () => {
  it('判这几件事不需要碰文件字节——`taken` 之外一个 IO 都没有', async () => {
    const taken = vi.fn(async () => false)
    await importPlanOf({ name: 'a.png', size: 1024, current: 'x.md', taken })
    expect(taken).toHaveBeenCalledTimes(1)
  })
})
