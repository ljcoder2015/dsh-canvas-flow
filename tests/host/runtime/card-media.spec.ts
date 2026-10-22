/**
 * 「这张卡选定的生成模型」真的会走到生成请求里（v1.76，F2.7）。
 *
 * 用户原话：「图片和视频模型的选择，只是选择图片模型和视频模型，不是选择对话模型」。
 * 这句话在代码里有三段路，任何一段断了，现象都一样：**卡片上选好的模型没生效**，而且
 * 不报错——生成照旧按「配置里第一个对得上族的模型」去跑，用户只会觉得「我选了 pro 怎么
 * 还是 flash」。
 *
 * 三段是：
 *
 * 1. 席位把选择写进卡片记录（`setMediaModel`；空串回到「自动」= 字段删掉）；
 * 2. `runGeneration` 从记录里把它读出来，交给能力；
 * 3. 三个 `generateXxx` 把它原样透传给能力接口（缺了就是 undefined，不能写成 null）。
 *
 * 这三段都在 `card-runtime.ts` 里，而它构造起来要拖 Cordova 上下文、存储域与假的
 * `io`——判据会变成为难而难。所以这里读**源码文本**，与 `tests/client/ui/model-seat.spec.ts`
 * 对 `model-picker.tsx` 的做法同源：读的不是「出现过某个词」，而是「这一段真的把那个值
 * 递下去了」。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const RUNTIME = readFileSync(new URL('../../../src/host/runtime/card-runtime.ts', import.meta.url), 'utf8')

/** 抓一个方法的函数体（从签名到同级的收尾大括号）。 */
function bodyOf(signature: RegExp, what: string): string {
  const match = signature.exec(RUNTIME)
  if (match === null) throw new Error(`${what} 的形状变了，这条判据要跟着改`)
  const start = match.index
  const end = RUNTIME.indexOf('\n  }', start)
  if (end === -1) throw new Error(`${what} 的收尾大括号找不到，这条判据要跟着改`)
  return RUNTIME.slice(start, end)
}

const runGeneration = (): string => bodyOf(/private async runGeneration\(/, '`runGeneration`')

describe('生成时用的模型来自这张卡的记录', () => {
  it('按卡记录里的 mediaModel 生成，而不是只看配置', () => {
    const body = runGeneration()
    // 「记录里那个字段」必须出现在交给能力的那一句里；只读 record 不传，等于选了白选。
    expect(body).toMatch(/produce\([^)]*mediaModel/)
  })

  it('记录里没有这个字段就交 undefined —— 那是「自动挑」，不是「用空模型」', () => {
    const body = runGeneration()
    // `record?.mediaModel` 比 `record.mediaModel` 更严：卡片记录本身可能不存在（旧卡），
    // 而那条路必须先保住「没有记录」这件事，不能顺带把 undefined 变成一次解引用崩溃。
    expect(body).toContain('record?.mediaModel')
  })

  it('三条生成能力都把模型透传下去', () => {
    for (const [signature, what] of [
      [/async generateImage\(/, '`generateImage`'],
      [/async generateVideo\(/, '`generateVideo`'],
      [/async generateAudio\(/, '`generateAudio`'],
    ] as const) {
      const body = bodyOf(signature, what)
      expect(body, `${what} 没有把选定模型交给能力`).toContain('model === undefined ? {} : { model }')
    }
  })
})

describe('席位写下来的那一笔', () => {
  const setter = (): string => bodyOf(/async setMediaModel\(/, '`setMediaModel`')

  it('空串是「回到自动」：字段删掉，而不是存一个空字符串', () => {
    const body = setter()
    expect(body).toContain('delete next.mediaModel')
    expect(body).toMatch(/trimmed === ''/)
  })

  it('不碰会话——那条线是这段对话用哪个模型，与生成无关', () => {
    const body = setter()
    expect(body).not.toContain('selectModel')
    expect(body).not.toContain('sessionId =')
    // 会话 id 只被原样带出去（板面回报），不该被写。
    expect(body).not.toMatch(/sessionId:\s*trimmed/)
  })

  it('不校验这个模型还在不在配置里——那是生成时才该说的话', () => {
    const body = setter()
    // 配置是别人的，此刻在、下次打开可能就没了；在这张卡上拒绝写入只会让用户看见一枚
    // 按不动的选项，而真正的答案在 `missingModelReason` 那句。
    expect(body).not.toContain('isMediaModel')
    expect(body).not.toContain('mediaCapabilitiesOf')
  })
})

describe('产物比例写下来的那一笔（F3.11）', () => {
  const setter = (): string => bodyOf(/async setAspect\(/, '`setAspect`')

  it('归一在写入口：四舍五入到 4 位，不让小数尾巴进板面文件', () => {
    expect(setter()).toContain('Math.round(aspect * 10_000) / 10_000')
  })

  it('只写这一张卡的记录，不碰会话、不碰产物', () => {
    const body = setter()
    expect(body).not.toContain('selectModel')
    expect(body).not.toContain('sessionId =')
    // 宿主不读产物字节：解码宽高是浏览器的事（`card-media.ts` 的 `measureAspect`）。
    expect(body).not.toContain('readArtifact')
    expect(body).not.toContain('readBytes')
  })

  it('回报的是改完之后的那一份——不量比例的卡不该被顺手补上一个比例', () => {
    const body = setter()
    expect(body).toContain('...aspectSlotOf(next)')
    expect(body).not.toContain('...aspectSlotOf(record)')
  })
})
