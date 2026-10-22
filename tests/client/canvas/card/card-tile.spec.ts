/**
 * 卡面把媒体产物画出来（F2.7）的接线判据。
 *
 * 用户的报障：「音频卡片就直接是音频播放器，图片，视频同理」。真因是卡面的预览分派表
 * 里**没有媒体这一支**——一张 PNG 的 `outline` 是空的（字节不是文本），于是它落到最后
 * 那条大纲行上，画布上只剩「图片」两个字。
 *
 * `card-tile.tsx` **import 不了**（React 组件 + 卡片的指针捕获），所以这里读**源码文本**。
 * 但读的不是「出现了某个词」那种形似，而是几条一改就静默的接线：
 *
 * 1. **媒体那一支得是这条分派链上的一条真分支**（由形态表把关、真的把元素画出来）。
 *    缺了它就是这个 bug 本身：媒体卡落到最后那条大纲行上，而一张 PNG 的 `outline` 是空的，
 *    于是卡上只剩「图片」两个字——不报错、什么都不发生。
 *    （首版把这条写成「媒体支要排在回退行之前」，**被变异测试证伪了**：三支互斥，位置无关，
 *    排在哪都是对的；真正会少的是**那一条分支**。）
 * 2. **`empty` 那一路要退回大纲行**，不能顶掉它——「这张卡还没有东西」本来就该是那个样子。
 * 3. **有控件的元素要自己吃掉 pointerdown**。不吃的话按播放键会变成拖卡片、拖进度条会把
 *    这张卡从画布上拽走（卡片的指针是拖拽把柄）——手不试一遍看不出来的那一类。
 * 4. **卡面里不许再写一份媒体形态清单**。形态只有 `media-face.ts` 一份；`kind === 'image'`
 *    这种字面量出现在卡面上，就是下一个 `CLAIMABLE` 漏 `audio`（同类漏网今天已经撞过一次）。
 * 5. **字节上限只有 host 一处**（`VIEW_BYTES_CAP`）。客户端抄一份＝第二个来源，两边早晚
 *    有一个是错的；卡面该做的是「要一次，然后读 host 的 `truncated`」。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MEDIA_KINDS } from '../../../../src/core/artifact/kind/kind-registry.ts'

/** 读一份源码文本（接线那几条读不了组件，只能读字）。 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
const TILE = '../../../../src/client/canvas/card/card-tile.tsx'

/** 预览分派里媒体那一支的条件式，从它开头到那条大纲行回退为止。 */
function mediaClause(): string {
  const source = read(TILE)
  const at = source.indexOf('media !== undefined && mediaFace !== undefined')
  if (at === -1) throw new Error('媒体分支不见了或换了写法，这条判据要跟着改')
  const end = source.indexOf('lines.map(', at)
  if (end === -1) throw new Error('找不到大纲行那条回退——预览分派的形状变了')
  return source.slice(at, end)
}

/** `MediaPreview` 的函数体（内层大括号都缩进，所以第一个顶格的 `}` 就是它的收尾）。 */
function mediaPreviewBody(): string {
  const source = read(TILE)
  const at = source.indexOf('function MediaPreview(')
  if (at === -1) throw new Error('`MediaPreview` 不见了，这条判据要跟着改')
  return source.slice(at, source.indexOf('\n}', at))
}

describe('卡面的预览分派', () => {
  it('媒体那一支得是这条分派链上的一条真分支', () => {
    const source = read(TILE)
    const textBranch = source.indexOf("mdHtml !== '' ?")
    const media = source.indexOf('media !== undefined && mediaFace !== undefined')

    expect(textBranch, '找不到文本那一支——预览分派的形状变了').toBeGreaterThan(-1)
    expect(media, '分派链上没有媒体这一支：媒体卡会落到大纲行，而一张图的 outline 是空的').toBeGreaterThan(textBranch)
    // 把关的是形态表（不是这里再判一次 kind），画的是 `MediaPreview`（不是大纲行）。
    expect(mediaClause()).toContain('mediaFace !== undefined')
    expect(source).toContain('<MediaPreview')
    // 而那张形态表来自唯一的那个出处。
    expect(source).toContain('mediaFaceOf(kind)')
  })

  it('没有东西可画时退回大纲行，而不是顶掉它', () => {
    // `empty` 是「产物在、里面什么都没有」（空文件、读不出来）——那句话不该占据卡面；
    // 只有 `absent` / `too-large` 值得说出来（见 media-face.ts 的四态）。
    expect(mediaClause()).toContain("media.status !== 'empty'")
    expect(mediaPreviewBody()).toContain("canvas.viewer.absent")
    expect(mediaPreviewBody()).toContain("canvas.viewer.tooLarge")
  })
})

describe('媒体元素与指针', () => {
  it('有控件的元素自己吃掉 pointerdown，图片不吃', () => {
    const body = mediaPreviewBody()

    expect(body).toContain('<video')
    expect(body).toContain('<audio')
    expect(body, '控件的判断要来自那张形态表（face.controls），不是在这里再写一遍').toMatch(
      /face\.controls[\s\S]{0,200}stopPropagation/,
    )
    expect(body, 'video 要挂上「吃掉指针」那一段').toMatch(/<video[^>]*\{\.\.\.hold\}/)
    expect(body, 'audio 要挂上「吃掉指针」那一段').toMatch(/<audio[^>]*\{\.\.\.hold\}/)
    // 图片没有控件，于是指针让给卡片：点它＝选中、拖它＝拖卡（与别的卡手感一致）。
    expect(body).toMatch(/<img[^>]*\/>/)
    expect(body.slice(body.indexOf('<img')), '图片不该吃掉指针').not.toContain('{...hold}')
  })
})

describe('卡面里的两份「不许有第二个来源」', () => {
  it('媒体形态清单只有 media-face.ts 一份', () => {
    const source = read(TILE)
    for (const kind of MEDIA_KINDS) {
      expect(source, `卡面里不该拿 kind 比 '${kind}'——形态清单只有 media-face.ts 一份`).not.toContain(`kind === '${kind}'`)
      expect(source).not.toContain(`kind !== '${kind}'`)
    }
  })

  it('字节上限只有 host 一处，客户端不许抄', () => {
    for (const file of ['card-tile.tsx', 'card-media.ts', 'media-face.ts']) {
      const text = read(`../../../../src/client/canvas/card/${file}`)
      expect(text, `${file} 里不该出现 VIEW_BYTES_CAP`).not.toContain('VIEW_BYTES_CAP')
      expect(text, `${file} 里不该写死 16MB`).not.toMatch(/16_?000_?000/)
    }
  })

  it('卡面读的就是全屏预览那条读法', () => {
    // 同一条 `readArtifact`：同一份 wire 上限、同一副 data URL 形状、同一套「还没生成」
    // 的语义。卡面另开一条读法，「卡上能看、点进去看不到」迟早会出现。
    expect(read('../../../../src/client/canvas/card/card-media.ts')).toMatch(/bridge\s*\.\s*readArtifact\(/)
  })
})
