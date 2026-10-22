/**
 * 模型席位的判据（v1.71 起；v1.73 加「谁能进对话下拉」；v1.76 按卡片形态分成两件事）。
 *
 * 三半，各答一个问题：
 *
 * 1. **落点规则**（`model-seat.ts`，零依赖，直接 import）：对话卡已经有会话就用它，还没有
 *    而卡片定位得到就先开一个；**媒体卡的落点是卡片记录本身**（`card`），与有没有会话
 *    无关。最后这一条是 v1.76 的要害——用户原话「图片和视频模型的选择，只是选择图片模型
 *    和视频模型，不是选择对话模型」，所以那张卡上选的东西根本不该写进会话。
 * 2. **候选规则**：对话卡滤掉生成模型（选它 = 下一次请求 400）；媒体卡**只列**这一族的
 *    模型（图片卡列 seedream、视频卡列 seedance、音频卡列 tts）。
 * 3. **接线**（读 `model-picker.tsx` 的源码文本）：这个文件引了宿主 UI 原语，node 下
 *    import 不了（同 `canvas-tab.spec.ts` 的理由），所以只能读字。读的不是「出现过某个
 *    词」，而是几件**会咬人**的事实：按钮的禁用判据不是「有没有会话」、对话卡在写选择前
 *    真的会去开会话、**媒体卡在开会话之前就 return 了**、落点不可达时不静默。
 *
 * 从前两个形状都在真机上出过事：`disabled={sessionId === ''}` 让新建的媒体卡上那颗下拉框
 * 永远灰着（v1.71）；把生成模型选进会话让下一次对话请求 400（v1.73）；而为了躲那个 400
 * 把生成模型整个从菜单里删掉，又让图片卡**没法选图片模型**（v1.76 修的就是它）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  isMediaSeat,
  mediaCapabilityOf,
  mediaSeatCandidates,
  seatCandidates,
  seatTarget,
  seatUsable,
} from '../../../../src/client/ui/model/model-seat.ts'
import { MEDIA_CAPABILITIES } from '../../../../src/core/media/routes.ts'
import { MEDIA_KINDS } from '../../../../src/core/artifact/kind/kind-registry.ts'

/** 读一份源码文本（接线那几条读不了模块，只能读字）。 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

const PICKER = '../../../../src/client/ui/model/model-picker.tsx'

/** `pick` 那一段的函数体**原文**——写选择的整条路都在里面。 */
function pickBody(): string {
  const match = /const pick = \([\s\S]*?\n {2}\}/.exec(read(PICKER))
  if (match === null) throw new Error('`pick` 的形状变了，这条判据要跟着改')
  return match[0]
}

/** 模型那颗按钮上 `disabled={…}` 里的表达式原文。 */
function seatDisabled(): string {
  const match = /className="dsh-canvas-modelbtn"[\s\S]*?disabled=\{([^}]*)\}/.exec(read(PICKER))
  if (match === null) throw new Error('席位按钮的形状变了，这条判据要跟着改')
  return match[1]!.trim()
}

describe('模型席位的落点', () => {
  it('已经有会话就直接写进它', () => {
    expect(seatTarget({ sessionId: 'cv-1', projectId: 'p', cardId: 'abc123' })).toBe('session')
  })

  it('还没有会话、但卡片定位得到，就先开一个再写', () => {
    expect(seatTarget({ sessionId: '', projectId: 'flow-test-wf1lug', cardId: 'fmsegf' })).toBe('open-first')
  })

  it('连卡片都定位不到才禁用，且只有这一种答复算不能用', () => {
    expect(seatTarget({ sessionId: '', projectId: '', cardId: 'fmsegf' })).toBe('unreachable')
    expect(seatTarget({ sessionId: '', projectId: 'p', cardId: '' })).toBe('unreachable')
    expect(seatUsable('session')).toBe(true)
    expect(seatUsable('open-first')).toBe(true)
    expect(seatUsable('card')).toBe(true)
    expect(seatUsable('unreachable')).toBe(false)
  })

  it('已有会话时不被「缺项目 / 缺卡片」拖累——那两栏本就不参与', () => {
    expect(seatTarget({ sessionId: 'cv-1', projectId: '', cardId: '' })).toBe('session')
  })
})

/**
 * 媒体卡的落点是**卡片记录**（v1.76）。
 *
 * 这一条与「对话卡怎么落点」是两件事，故意分开写：把媒体卡也塞进 `session` 那条路，
 * 就是 v1.73 那场 400 —— 用户给视频卡选了个生成模型，选择写进了会话，下一次对话请求
 * 打到方舟，换回 `max_completion_tokens … <= 12288`。
 */
describe('媒体卡的落点与会话无关', () => {
  const media = { media: true, projectId: 'flow-test-wf1lug', cardId: 'fmsegf' } as const

  it('有会话也还是写卡片记录——那张卡选的是生成模型，不是这段对话的模型', () => {
    expect(seatTarget({ ...media, sessionId: 'cv-1' })).toBe('card')
    expect(seatTarget({ ...media, sessionId: '' })).toBe('card')
  })

  it('卡片定位不到才禁用（媒体卡不靠会话，缺会话不是问题）', () => {
    expect(seatTarget({ ...media, sessionId: '', projectId: '', cardId: '' })).toBe('unreachable')
  })

  it('形态 → 能力的映射只认媒体那三族', () => {
    expect(mediaCapabilityOf('image')).toBe('image')
    expect(mediaCapabilityOf('video')).toBe('video')
    expect(mediaCapabilityOf('audio')).toBe('audio')
    expect(mediaCapabilityOf('markdown')).toBeUndefined()
    expect(mediaCapabilityOf('design')).toBeUndefined()
  })

  it('能力清单与 kind 表的媒体清单是同一批——两份名单迟早有一份会漏', () => {
    expect([...MEDIA_CAPABILITIES].sort()).toEqual([...MEDIA_KINDS].sort())
  })

  /**
   * **接线**：形态映射的输出直接决定落点。
   *
   * 上面几条分开测「映射对不对」与「落点规则对不对」，都绿也说明不了两处接对了——
   * 把 `mediaCapabilityOf` 改成恒 `undefined` 时，上面每一条映射断言会响，但「落点是
   * 卡片」那几条**照样绿**（它们直接传 `media: true`，绕过了映射）。真机上那一步的后果
   * 是：图片卡上选了个图片模型，选择写进了会话 —— 正是 v1.73 那场 400。
   *
   * 所以这一条故意走**真机那条路**：先问形态，再拿答案问落点。
   */
  it('形态说的那件事自己决定落点——两半各自对不算，接起来得对', () => {
    const seatOf = (kind: string): string =>
      seatTarget({
        sessionId: 'cv-1',
        projectId: 'flow-test-wf1lug',
        cardId: 'fmsegf',
        media: mediaCapabilityOf(kind) !== undefined,
      })
    for (const kind of MEDIA_KINDS) expect(seatOf(kind), kind).toBe('card')
    // 有会话也一样：媒体卡的落点与会话无关。
    for (const kind of ['markdown', 'design', 'app']) expect(seatOf(kind), kind).toBe('session')
  })
})

describe('席位接在真机上', () => {
  it('禁用判据读的是落点，不是「有没有会话」', () => {
    const disabled = seatDisabled()
    expect(disabled).toContain('seatUsable(')
    // 从前那一条：还没有会话的卡片因此永远灰着（新建的图片 / 视频 / 音频卡片）。
    expect(disabled).not.toContain("sessionId === ''")
  })

  it('媒体卡在开会话之前就 return 了——它压根不需要会话', () => {
    const body = pickBody()
    const recorded = body.indexOf('setMediaModel(')
    const opened = body.indexOf('openSession(')
    expect(recorded, '`pick` 不再给媒体卡写记录').toBeGreaterThan(-1)
    expect(opened).toBeGreaterThan(-1)
    // 顺序即语义：媒体那一支写完就 return，走不到下面开会话那一段。
    expect(recorded, '媒体那一支要排在开会话之前').toBeLessThan(opened)
    const mediaBranch = body.slice(recorded, opened)
    expect(mediaBranch, '媒体那一支必须自己收尾，不能漏到开会话去').toContain('return')
  })

  it('对话卡写选择之前先开会话，且开在 selectModel 之前', () => {
    const body = pickBody()
    const opened = body.indexOf('openSession(')
    const selected = body.indexOf('selectModel(')
    expect(selected, '`pick` 不再写会话选择').toBeGreaterThan(-1)
    expect(opened, '会话要先开出来，选择才有地方落').toBeLessThan(selected)
  })

  it('落点不可达时不静默——不写记忆、不假装选中', () => {
    const body = pickBody()
    expect(body).toContain('seatUsable(')
    // 记忆只在真的写成功之后才落：它是「用户选过」这句话，不是一次试探。
    expect(body.indexOf('rememberModel(')).toBeGreaterThan(body.indexOf('.then('))
  })
})

/**
 * 下拉里能列哪些模型。
 *
 * 宿主的模型目录是「这个部署配了哪些模型」，**不是**「哪些能当这类卡的模型」。两种卡因此
 * 各要一份过滤，而两份都读同一份模型族指纹（`core/media/routes.ts`）。
 */
describe('席位的候选模型', () => {
  const models = [
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
    { id: 'doubao-seedance-2-0-mini-260615', name: 'Seedance mini' },
    { id: 'doubao-seedance-2-5-260628', name: 'Seedance 2.5' },
    { id: 'doubao-seedream-5-0-flash-260915', name: 'Seedream flash' },
    { id: 'doubao-seedream-5-0-pro-260628', name: 'Seedream pro' },
    { id: 'doubao-seed-1-6-250615', name: 'Seed 1.6' },
  ]

  it('对话卡：媒体生成模型不列，对话模型一个不少（含同一 route 下的 doubao 对话模型）', () => {
    expect(seatCandidates(models).map((model) => model.id)).toEqual([
      'deepseek-v4-flash',
      'doubao-seed-1-6-250615',
    ])
  })

  it('对话卡：过滤不改变剩下的对象（显示名等原样带着走）', () => {
    expect(seatCandidates(models)[1]).toBe(models[5])
  })

  it('图片卡只列图片模型，视频卡只列视频模型', () => {
    expect(mediaSeatCandidates('image', models).map((model) => model.id)).toEqual([
      'doubao-seedream-5-0-flash-260915',
      'doubao-seedream-5-0-pro-260628',
    ])
    expect(mediaSeatCandidates('video', models).map((model) => model.id)).toEqual([
      'doubao-seedance-2-0-mini-260615',
      'doubao-seedance-2-5-260628',
    ])
  })

  it('音频卡没有 tts 模型时列表为空——调用方显示「该提供方没有这一类的模型」', () => {
    expect(mediaSeatCandidates('audio', models)).toEqual([])
  })

  it('非媒体卡问这一族得到空数组：那是问错了问题，不是「全都不要」', () => {
    expect(mediaSeatCandidates('markdown', models)).toEqual([])
    expect(mediaSeatCandidates('design', models)).toEqual([])
  })

  it('认出「对话卡上选到了生成模型」的历史遗留', () => {
    expect(isMediaSeat('doubao-seedance-2-0-mini-260615')).toBe(true)
    expect(isMediaSeat('deepseek-v4-flash')).toBe(false)
    // 还没读出选择（`undefined`）不是「选错了」：那只是还没读到。
    expect(isMediaSeat(undefined)).toBe(false)
  })
})

describe('过滤接在真机上', () => {
  it('落点那行的 media 一栏读的是形态映射，不是写死的 true / false', () => {
    // 写死 `media: true` = 每张卡都去写记录（对话卡的模型选择就没地方落了）；
    // 写死 `false` = 媒体卡又回去开会话。两种都是「映射白写」。
    expect(read(PICKER)).toMatch(/seatTarget\(\{[^}]*media:\s*isMedia/)
    expect(read(PICKER)).toMatch(/const isMedia = capability !== undefined/)
    expect(read(PICKER)).toMatch(/const capability = mediaCapabilityOf\(kind\)/)
  })

  it('两种卡各走各的候选，不是把目录原样铺进下拉', () => {
    const text = read(PICKER)
    expect(text).toContain('mediaSeatCandidates(kind, group.models)')
    expect(text).toContain('seatCandidates(group.models)')
    // 直接把目录铺进下拉 = 过滤白写。
    expect(text).not.toMatch(/group\.models\.map/)
  })

  it('媒体卡的「自动」是个词，不是空白——它说的是「生成时按模型族去配置里挑」', () => {
    const text = read(PICKER)
    expect(text).toContain("t('canvas.composer.modelAuto')")
    // 没有选择时不能回落到会话那套标签：那会把「部署默认的对话模型」写在图片卡上。
    expect(text).toMatch(/isMedia\s*\?\s*chosenMedia === undefined/)
  })

  it('对话卡选错时不静默：读得出来，也说得出口', () => {
    const text = read(PICKER)
    // 读的是「按当前席位算出来的那一个判断」，不是文件里出现过 `isMediaSeat` 这个词：
    // 把这一行改成 `false` 就等于悄悄不提示了，而症状与原因还隔着一整个下拉框。
    expect(text).toMatch(/const mediaSeat = !isMedia && [^\n]*isMediaSeat\(shown\.model\)/)
    expect(text).toContain("t('canvas.composer.modelMediaSeat')")
  })

  it('媒体卡的菜单顶部说明这里选的是什么——这一版的核心就是这句话', () => {
    expect(read(PICKER)).toContain("t('canvas.composer.modelMediaNote')")
  })
})
