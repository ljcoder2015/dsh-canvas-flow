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
      [/async generateImageArtifact\(/, '`generateImageArtifact`'],
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

describe('媒体编辑台参数写下来的那一笔', () => {
  const setter = (): string => bodyOf(/async setMediaParams\(/, '`setMediaParams`')

  it('归一在写入口：空对象是「清除全部」（字段删掉），不是存一包空参数', () => {
    // 对象参数没有「空串」：`normalizeMediaParams` 收敛成 undefined 即整字段不写——
    // 「没设过」与「一包空参数」在记录里必须是同一种状态，否则板面文件里会留一堆 {}。
    expect(setter()).toContain('normalizeMediaParams(params)')
    expect(setter()).toContain('delete next.mediaParams')
  })

  it('不校验路径、不校验档位组合——那是生成时才该说的话', () => {
    // 蒙版还在不在、模型支不支持 inpaint，答案在 `missingModelReason` 或服务端那句；
    // 在这张卡上拒绝写入只会让用户看见一枚按不动的开关。（回报里那一下 presenceOf
    // 是 `missing` 判定用的，与 setMediaModel 同一笔，不是在验蒙版。）
    const body = setter()
    expect(body).not.toContain('isMediaModel')
    expect(body).not.toContain('readBytes')
    expect(body).not.toContain('maskPath')
  })

  it('回报的是改完之后的那一份', () => {
    const body = setter()
    expect(body).toContain('...paramsSlotOf(next)')
    expect(body).not.toContain('...paramsSlotOf(record)')
  })
})

describe('编辑台参数真的会走进生成请求', () => {
  it('生图把编辑模式、蒙版与画幅交给能力，三类导演指令都追加进 prompt', () => {
    const body = bodyOf(/async generateImageArtifact\(/, '`generateImage`')
    expect(body).toContain('imageEditPromptOf(params)')
    // 画质与背景在协议里没有字段，去向是 prompt 末尾的导演指令——漏拼就是「设了没效果」。
    expect(body).toContain('imageQualityPromptOf(params?.quality)')
    expect(body).toContain('imageBackgroundPromptOf(params?.background)')
    expect(body).toContain('editMode: params.editMode')
    expect(body).toContain('maskPath: params.maskPath')
    // 画幅两个来源冲突时扩图尺寸赢（更具体的意图）。
    expect(body).toContain('params?.outpaintSize ?? imageSizeOf(params?.resolution, params?.ratio)')
    expect(body).toContain('editSize: size')
  })

  it('生成数量在宿主循环兑现：第一张落卡片，第 2..N 张写兄弟路径，失败即停', () => {
    const body = bodyOf(/async generateImageArtifact\(/, '`generateImage`')
    // 协议一次一张——「4 张」必须是真的发起 4 次生成，而不是把数字存起来就算数。
    expect(body).toContain('params?.count ?? 1')
    expect(body).toContain('siblingPathOf(file, index)')
    expect(body).toContain('index <= count')
    // 连续失败通常是同一个原因；把剩下的张数再打一遍只是把同一条错重复 N 遍。
    expect(body).toContain('break')
  })

  it('生视频把尾帧与固定机位交给能力，运镜写成 prompt 的导演指令', () => {
    const body = bodyOf(/async generateVideo\(/, '`generateVideo`')
    expect(body).toContain('cameraPromptOf(params?.camera)')
    expect(body).toContain('lastFramePath: params.lastFramePath')
    expect(body).toContain(`params?.camera === 'fixed'`)
  })

  it('首帧的合并规则：调用方当次给的参考图赢，没给才落到面板设的那张', () => {
    const body = bodyOf(/async generateVideo\(/, '`generateVideo`')
    // `??` 的方向就是这条规则：先看当次调用，再看常设参数。反过来会让模型刚听用户说的
    // 那张参考图被面板上一张旧图顶掉。
    expect(body).toContain('options.referencePath ?? params?.firstFramePath')
  })

  it('四条 BoardCard 回报都摊开 paramsSlotOf——少一处就是某个入口之后参数忽然消失', () => {
    // 与 card-fields.spec 的纪律判据同源：这个字段是四处各自拼 BoardCard 的，编译期
    // 挡不住「漏展开」（可选字段），只能靠源码扫描兜。
    const spreads = RUNTIME.match(/\.\.\.paramsSlotOf\(/g) ?? []
    expect(spreads.length).toBeGreaterThanOrEqual(4)
  })
})

describe('wire 五处注册面齐全（setMediaParams）', () => {
  // 与 model-seat.spec 对 model-picker 的做法同源：五处少一处，编译期只有类型能挡一部分
  // （contract 与 typert 有 parity 判据，client 的 remote/bridge 没有），漏了就是运行期才崩。
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

  it('contract 有 descriptor、typert 有成员、host 有实现、client 有 face 与桥', () => {
    const contract = read('../../../src/contract.ts')
    const typert = read('../../../src/typert.ts')
    const remote = read('../../../src/client/wire/remote.ts')
    const bridge = read('../../../src/client/wire/bridge.ts')
    expect(contract).toContain("id: 'dsh-canvas-flow#card/set_media_params'")
    expect(contract).toContain('method: \'setMediaParams\'')
    expect(typert).toContain("member('setMediaParams'")
    expect(RUNTIME).toContain('async setMediaParams(')
    expect(remote).toContain('setMediaParams(')
    expect(remote).toContain("'card/setMediaParams'")
    expect(bridge).toContain('setMediaParams(')
  })
})
