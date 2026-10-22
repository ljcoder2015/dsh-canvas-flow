/**
 * 媒体路线怎么从 DSH 模型配置里挑出来（F2.7）。
 *
 * 这个文件守的是**一条纪律**：那份 `value` 的形状归别人所有（DSH 的 `llm-pi-ai` 设置段
 * 的 schema），我们只读不猜。所以判据分两半：
 *
 * - **读得懂的要读对**：真实的 provider 配置读出来是三条路线，地址、凭证名、模型都在。
 * - **读不懂的整条丢掉**：缺 `providers`、`providers` 不是对象、某条路线的 `models` 不是
 *   数组、模型条目没有 id——每一样都要变成「没有这条路线」，而不是一个默认值。一条
 *   baseURL 猜错的路线会去一个不相干的域名上要视频，比「没找到路线」难查得多。
 */
import { describe, expect, it } from 'vitest'
import {
  ARK_DEFAULT_BASE,
  audioBaseURLOf,
  findModelRoute,
  isMediaModel,
  mediaCapabilitiesOf,
  missingModelReason,
  modelMatchesFamily,
  noRouteReason,
  pickMediaRoute,
  readProviderRoutes,
  SPEECH_DEFAULT_BASE,
} from '../../../src/core/media/routes.ts'

/** 一份照 DSH 设置段形状写的 provider 配置。 */
const SETTINGS_VALUE = {
  providers: {
    gw: {
      apiKeyEnv: 'GW_API_KEY',
      api: 'openai-responses',
      baseURL: 'https://gw.example.test/openapi/cllm',
      models: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }],
    },
    ark: {
      apiKeyEnv: 'ARK_API_KEY',
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      models: [{ id: 'doubao-seedream-4-0-250828' }, { id: 'doubao-seedance-2-0-260128' }],
    },
  },
}

describe('reading provider routes out of the model configuration', () => {
  it('reads every route the settings schema actually writes', () => {
    expect(readProviderRoutes(SETTINGS_VALUE)).toEqual([
      {
        route: 'gw',
        baseURL: 'https://gw.example.test/openapi/cllm',
        apiKeyEnv: 'GW_API_KEY',
        models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      },
      {
        route: 'ark',
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKeyEnv: 'ARK_API_KEY',
        models: ['doubao-seedream-4-0-250828', 'doubao-seedance-2-0-260128'],
      },
    ])
  })

  it('returns nothing for anything it cannot read, rather than guessing', () => {
    expect(readProviderRoutes(undefined)).toEqual([])
    expect(readProviderRoutes(null)).toEqual([])
    expect(readProviderRoutes('nope')).toEqual([])
    expect(readProviderRoutes({})).toEqual([])
    expect(readProviderRoutes({ providers: 'nope' })).toEqual([])
    // 形状像但不是：整条路线丢掉，不是因为缺一个字段就补一个默认值。
    expect(readProviderRoutes({ providers: { broken: 'nope' } })).toEqual([])
    expect(readProviderRoutes({ providers: { partial: { baseURL: 'https://x.test' } } })).toEqual([
      { route: 'partial', baseURL: 'https://x.test', apiKeyEnv: '', models: [] },
    ])
    expect(readProviderRoutes({ providers: { odd: { models: 'nope' } } })[0].models).toEqual([])
    // 模型条目里没有 id 的，跳过那一条而不是塞一个空字符串进去。
    expect(readProviderRoutes({ providers: { odd: { models: [{}, { id: 'a' }, { id: '  ' }] } } })[0].models).toEqual([
      'a',
    ])
  })

  it('falls back to the Ark endpoint only when the route names none', () => {
    expect(readProviderRoutes({ providers: { bare: {} } })[0].baseURL).toBe(ARK_DEFAULT_BASE)
  })
})

describe('picking a route for one capability', () => {
  const routes = readProviderRoutes(SETTINGS_VALUE)

  it('matches each capability by model family, not by route name', () => {
    expect(pickMediaRoute(routes, 'image')).toMatchObject({ route: 'ark', model: 'doubao-seedream-4-0-250828' })
    expect(pickMediaRoute(routes, 'video')).toMatchObject({ route: 'ark', model: 'doubao-seedance-2-0-260128' })
  })

  it('does not match an id that merely resembles a family', () => {
    expect(modelMatchesFamily('image', 'doubao-seedream-4-0-250828')).toBe(true)
    expect(modelMatchesFamily('image', 'deepseek-v4-flash')).toBe(false)
    // 跨区命名的同一族模型也算：按前缀写会漏掉这一种。
    expect(modelMatchesFamily('video', 'dreamina-seedance-2-0')).toBe(true)
  })

  it('has nothing to offer for a capability no route serves', () => {
    expect(pickMediaRoute(routes, 'audio')).toBeUndefined()
  })

  it('lets an explicit route override the automatic pick, and only that route', () => {
    expect(pickMediaRoute(routes, 'image', { route: 'gw' })).toBeUndefined()
    expect(pickMediaRoute(routes, 'image', { route: 'ark', model: 'custom-model' })).toMatchObject({
      route: 'ark',
      model: 'custom-model',
    })
    expect(pickMediaRoute(routes, 'image', { route: 'ark', apiKeyEnv: 'OTHER_KEY' })).toMatchObject({
      apiKeyEnv: 'OTHER_KEY',
    })
  })

  it('skips a named route that has no model for the capability', () => {
    expect(pickMediaRoute(routes, 'video', { route: 'gw' })).toBeUndefined()
  })
})

describe('the sentence a missing route produces', () => {
  it('names what was wanted, how it looked, and where to fix it', () => {
    const reason = noRouteReason('video', readProviderRoutes(SETTINGS_VALUE))
    // 想要什么
    expect(reason).toContain('视频')
    // 按什么找的
    expect(reason).toContain('seedance')
    // 去哪儿加：现有路线名要报出来
    expect(reason).toContain('gw')
    expect(reason).toContain('ark')
  })

  it('says so plainly when there is no provider configuration at all', () => {
    expect(noRouteReason('audio', [])).toContain('没有任何 provider 路线')
  })
})

/**
 * 「这个模型能不能当会话席位」（v1.73）。
 *
 * 起因是一次真机 400：用户把视频生成模型 `doubao-seedance-2-0-mini` 选成了某张卡片的
 * 会话模型，那个会话的下一次请求以 `POST /chat/completions` 打到方舟，换回一句
 * `max_completion_tokens … expected a value <= 12288, but got 32768`。32768 是模型配置
 * 里没声明输出上限时的部署默认——媒体模型当然没声明。
 *
 * 判据因此要守住正反两面：真实 id 认得出来（三种能力、跨区命名），而**对话模型一个都
 * 不能被误伤**（误伤 = 用户突然在下拉里看不到自己天天用的模型，比多列几个更糟）。
 */
describe('telling a media model from a chat model', () => {
  it('recognises the media families this deployment actually configures', () => {
    expect(isMediaModel('doubao-seedance-2-0-mini-260615')).toBe(true)
    expect(isMediaModel('doubao-seedream-5-0-flash-260915')).toBe(true)
    expect(isMediaModel('dreamina-seedance-2-0-260128')).toBe(true)
    expect(isMediaModel('doubao-seed-tts-1-0')).toBe(true)
    // 大小写不敏感：配置里写的是 id 原文，不是规范化过的东西。
    expect(isMediaModel('DOUBAO-SEEDREAM-4-0')).toBe(true)
  })

  it('leaves every chat model alone', () => {
    for (const id of ['deepseek-v4-flash', 'deepseek-v4-pro', 'doubao-seed-1-6-250615', 'gpt-4o', 'claude-sonnet-4']) {
      expect(isMediaModel(id), `${id} 被当成媒体模型了`).toBe(false)
    }
  })

  it('reports every capability an id serves instead of assuming exactly one', () => {
    expect(mediaCapabilitiesOf('doubao-seedance-2-0-mini')).toEqual(['video'])
    expect(mediaCapabilitiesOf('doubao-seedream-5-0-flash')).toEqual(['image'])
    expect(mediaCapabilitiesOf('deepseek-v4-flash')).toEqual([])
    // 复合名：漏掉一种能力的实现在这里露馅。
    expect(mediaCapabilitiesOf('seedream-seedance-combo')).toEqual(['image', 'video'])
  })
})

/**
 * 按**模型 id** 找路线（v1.76）：卡片上选定生成模型之后，那一笔要落到具体哪条路线。
 *
 * 与 `pickMediaRoute` 的分工是这一组判据的核心：**那个答「这种能力该用哪个模型」，这个答
 * 「用户点的这个模型从哪儿发」**。混成一个的话，「用户选了 pro」与「配置里第一条 seedream」
 * 会变成同一个答案，而两者在真机上差别就是「pro 还是 flash」。
 */
describe('resolving a model id the card picked', () => {
  const routes = readProviderRoutes({
    providers: {
      gw: {
        apiKeyEnv: 'GW_API_KEY',
        baseURL: 'https://gw.example.test/openllm',
        models: [{ id: 'deepseek-v4-flash' }],
      },
      doubao: {
        apiKeyEnv: 'DOUBAO_API_KEY',
        baseURL: 'https://ark.example.test/api/v3',
        models: [
          { id: 'doubao-seedream-5-0-pro-260628' },
          { id: 'doubao-seedream-5-0-flash-260915' },
          { id: 'doubao-seedance-2-5-260628' },
        ],
      },
    },
  })

  it('finds the route that declares the id, and keeps the id exactly as the user picked it', () => {
    const route = findModelRoute(routes, 'image', 'doubao-seedream-5-0-pro-260628')
    expect(route).toEqual({
      capability: 'image',
      route: 'doubao',
      baseURL: 'https://ark.example.test/api/v3',
      apiKeyEnv: 'DOUBAO_API_KEY',
      model: 'doubao-seedream-5-0-pro-260628',
    })
    // 关键：**不是** pro 排在前面才拿到 pro —— 是用户点的那个。把 flash 也点一次。
    expect(findModelRoute(routes, 'image', 'doubao-seedream-5-0-flash-260915')?.model).toBe(
      'doubao-seedream-5-0-flash-260915',
    )
  })

  it('answers undefined for an id the config no longer has, rather than falling back', () => {
    // 悄悄回退到「自动挑」会让「我明明选了 pro」变成一句无法验证的怀疑。
    expect(findModelRoute(routes, 'image', 'doubao-seedream-9-9-999999')).toBeUndefined()
    expect(findModelRoute(routes, 'image', '  ')).toBeUndefined()
    expect(findModelRoute([], 'video', 'doubao-seedance-2-5-260628')).toBeUndefined()
  })

  it('says what is missing, where to fix it, and what is available now', () => {
    const reason = missingModelReason('image', 'doubao-seedream-9-9-999999', routes)
    expect(reason).toContain('doubao-seedream-9-9-999999')
    expect(reason).toContain('DSH 模型配置')
    // 现有同族候选要报出来，否则用户只知道「没了」，不知道能换哪个。
    expect(reason).toContain('doubao-seedream-5-0-pro-260628')
    expect(reason).toContain('重新选')
  })

  it('says so plainly when nothing in the config serves that family at all', () => {
    const empty = readProviderRoutes({ providers: { gw: { models: [{ id: 'deepseek-v4-flash' }] } } })
    expect(missingModelReason('video', 'doubao-seedance-2-5-260628', empty)).toContain('没有任何模型命中这一族')
  })
})

describe('where an audio request actually has to go', () => {
  it('never posts to the Ark host, which serves images, video and 3D but no audio at all', () => {
    // 一条为方舟写的路线同时声明音频模型是很自然的配置（同一个 key 下多加一个模型），
    // 而那个地址上没有 `/tts/create`。照 baseURL 发就是一个 404，且看不出是发错主机。
    expect(audioBaseURLOf('https://ark.cn-beijing.volces.com/api/v3')).toBe(SPEECH_DEFAULT_BASE)
    // 末尾斜杠不该造成两个不同的端点。
    expect(audioBaseURLOf('https://ark.cn-beijing.volces.com/api/v3/')).toBe(SPEECH_DEFAULT_BASE)
  })

  it('keeps the region when the route is a BytePlus one, instead of sending it to China', () => {
    expect(audioBaseURLOf('https://ark.ap-southeast-1.bytepluses.com/api/v3')).toBe(
      'https://voice.ap-southeast-1.bytepluses.com/api/v3',
    )
  })

  it('honours every other host — a speech endpoint, a proxy, a self-hosted relay', () => {
    for (const url of [
      'https://openspeech.bytedance.com/api/v3',
      'https://voice.ap-southeast-1.bytepluses.com/api/v3',
      'https://relay.example.test/doubao',
    ]) {
      expect(audioBaseURLOf(url)).toBe(url)
    }
  })

  it('falls back to the speech endpoint when a route names no address at all', () => {
    expect(audioBaseURLOf('')).toBe(SPEECH_DEFAULT_BASE)
    expect(audioBaseURLOf('   ')).toBe(SPEECH_DEFAULT_BASE)
  })

  it('leaves an address it cannot parse alone, rather than guessing a domain', () => {
    expect(audioBaseURLOf('not a url')).toBe('not a url')
  })
})
