/**
 * 媒体卡面画什么（F2.7）。
 *
 * 用户的报障是一句话：「音频卡片就直接是音频播放器，图片，视频同理」。真因不是播放器
 * 没接上——全屏预览早就有三个预览器了——而是**卡面不画产物**：卡片的预览按 kind 分派，
 * 而媒体这一支根本不在那张分派表里，于是它落到最后那条大纲行上。而一张 PNG 的 `outline`
 * 是空的（字节不是文本），所以一张图片卡在画布上只剩「图片」两个字。
 *
 * 这个文件钉住三件事，每件都对应一处「看着能跑、其实少了东西」的失败：
 *
 * 1. **形态表要覆盖全部 `MEDIA_KINDS`**，且不许把别的 kind 卷进来——`MEDIA_KINDS` 那份
 *    真源在 core，这张表在 client，谁都 import 不到对方的语义，只能靠判据钉住（与
 *    `media-kinds.spec.ts` 里 `MEDIA_EXTENSIONS` ↔ `MEDIA_KINDS` 那条同一个手法）。
 * 2. **谁吃指针**跟着控件走：有控件的元素自己吃掉 pointerdown，图片把指针让给卡片。
 * 3. **载荷四态**各自对应一句不同的话，尤其「太大」与「空」不许合并——前者要在卡面上
 *    说出来，后者退回大纲行。
 */
import { describe, expect, it } from 'vitest'
import { mediaAssetOf, mediaFaceOf } from '../../../../src/client/canvas/card/media-face.ts'
import { MEDIA_KINDS } from '../../../../src/core/artifact/kind/kind-registry.ts'

/** 一份产物视图，只写判据关心的三个字段。 */
function viewOf(fields: { present?: boolean; truncated?: boolean; dataUrl?: string }) {
  return { present: fields.present ?? true, truncated: fields.truncated ?? false, dataUrl: fields.dataUrl ?? '' }
}

describe('the media face table', () => {
  it('draws one element per media kind, and nothing for anything else', () => {
    // 点 1 的正向：真源里每一种媒体形态都得有一张面。少一张的后果不是报错，是那张卡
    // 退到大纲行——用户在画布上看到「图片」两个字，而磁盘上就有那张图。
    expect(MEDIA_KINDS.map((kind) => mediaFaceOf(kind)?.element)).toEqual(['img', 'video', 'audio'])
  })

  it('never claims a kind the media pointer does not', () => {
    // 点 1 的反向：不许顺手认领别的形态（图片那一支若写成 kind !== 'markdown'，
    // 设计卡与应用卡的预览就会被媒体分支整段吃掉）。
    for (const kind of ['markdown', 'app', 'design', 'data', 'folder', 'file', 'audiofile', '']) {
      expect(mediaFaceOf(kind), `${kind} 不该有媒体卡面`).toBeUndefined()
    }
  })

  it('answers "not media" for keys that only look like a lookup', () => {
    // 形态名从盘面证据来，但这条守的是**查表本身**：若这张表哪天被写成对象字面量
    // （`FACES[kind]`），`'constructor'` / `'toString'` 这些会顺着原型链返回一个函数。
    // 返回真值的那一步不会报错——它只会让一张卡画出 `<img src="data:…">` 之外的
    // 一个空元素（或崩在 `face.element` 上）。Map 没有这条路。
    for (const kind of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(mediaFaceOf(kind), `${kind} 不该有媒体卡面`).toBeUndefined()
    }
  })

  it('gives the pointer to the element exactly when the element has controls', () => {
    // 点 2：这不是风格问题——卡片的指针是拖拽把柄（setPointerCapture），播放条若不吃掉
    // pointerdown，按一下播放键就会把这台播放器从画布上拖走。反过来，图片若吃了指针，
    // 点它就不再是选中这张卡（与别的卡手感不一致）。
    expect(mediaFaceOf('image')?.controls).toBe(false)
    expect(mediaFaceOf('video')?.controls).toBe(true)
    expect(mediaFaceOf('audio')?.controls).toBe(true)
  })
})

describe('what the face got to draw with', () => {
  it('hands the data URL straight over when there is one', () => {
    expect(mediaAssetOf(viewOf({ dataUrl: 'data:image/png;base64,AA' }))).toEqual({
      status: 'ready',
      dataUrl: 'data:image/png;base64,AA',
    })
  })

  it('says the artifact is not there when the host says it is not', () => {
    expect(mediaAssetOf(viewOf({ present: false }))).toEqual({ status: 'absent' })
  })

  it('keeps "too large" apart from "nothing in it"', () => {
    // 点 3：两种情况 host 都答「present、没有载荷」，但话不一样——一个是文件太大
    // （值得在卡面上说，人可以去别处打开），一个是空的（退回大纲行就够了）。
    expect(mediaAssetOf(viewOf({ truncated: true }))).toEqual({ status: 'too-large' })
    expect(mediaAssetOf(viewOf({}))).toEqual({ status: 'empty' })
  })
})
