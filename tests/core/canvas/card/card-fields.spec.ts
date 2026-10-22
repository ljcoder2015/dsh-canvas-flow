/**
 * 卡片记录上「只存差异」的字段摊开之后长什么样（F2.7）。
 *
 * 这个函数本身只有一行，但它守着一条纪律：`undefined` 意味着「没选过」，而「没选过」在
 * JSON 里应当是**字段不出现**，不是一个空值。四个拼 `BoardCard` 的地方都写
 * `...mediaSlotOf(record)`，就是为了让这条纪律只有一份实现——抄四遍的话，某一天会有
 * 一个入口把 `undefined` 当成 `null` 写出去，而那之后「有没有选过」就再也分不清了。
 */
import { describe, expect, it } from 'vitest'
import { aspectSlotOf, mediaSlotOf } from '../../../../src/core/canvas/card/card-fields.ts'

describe('把卡片记录里的生成模型摊成可展开的片段', () => {
  it('没选过就什么都不出现', () => {
    expect(mediaSlotOf({})).toEqual({})
    expect(mediaSlotOf({ mediaModel: undefined })).toEqual({})
    // 展开之后不会把已有的值覆盖成 undefined —— 这正是「用展开而不是三元赋值」的理由。
    expect({ ...{ mediaModel: 'keep' }, ...mediaSlotOf({}) }).toEqual({ mediaModel: 'keep' })
  })

  it('选过就原样带出来（不 trim、不改写）', () => {
    expect(mediaSlotOf({ mediaModel: 'doubao-seedream-5-0-pro-260628' })).toEqual({
      mediaModel: 'doubao-seedream-5-0-pro-260628',
    })
  })
})

describe('把卡片记录里的宽高比摊成可展开的片段（F3.11）', () => {
  it('没量过就什么都不出现——与「比例是 0」是两件事', () => {
    expect(aspectSlotOf({})).toEqual({})
    expect(aspectSlotOf({ aspect: undefined })).toEqual({})
    expect({ ...{ aspect: 1.5 }, ...aspectSlotOf({}) }).toEqual({ aspect: 1.5 })
  })

  it('量过就原样带出来（归一在写入口做，这里不重复）', () => {
    expect(aspectSlotOf({ aspect: 0.5625 })).toEqual({ aspect: 0.5625 })
    // 0 是**有值**：它在 `cardSizeFor` 里会被当成说不通的值退回默认，但「摊开」这一步
    // 不替它做决定——两处各判一次，就是两个会漂移的答案。
    expect(aspectSlotOf({ aspect: 0 })).toEqual({ aspect: 0 })
  })

  it('两个片段各管各的：一张卡可以选了模型、却还没量过比例', () => {
    const record = { mediaModel: 'doubao-seedance-2-5', aspect: undefined }
    expect({ ...mediaSlotOf(record), ...aspectSlotOf(record) }).toEqual({ mediaModel: 'doubao-seedance-2-5' })
  })
})
