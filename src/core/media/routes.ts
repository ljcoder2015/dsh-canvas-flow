/**
 * dsh-canvas — 媒体生成**从哪条路线走**（F2.7）。
 *
 * 这个模块只回答一个问题，而且是纯函数地回答它：**手上这份 DSH 模型配置里，有没有
 * 一条能服务图片 / 视频 / 音频的路线？** 它不读设置、不发请求、不知道 Ark 是什么——
 * 那些都在 host 侧的 provider 里（`host/media-provider.ts`），因为只有那里才有
 * `ctx.settings` 与 `ctx.credentials`。
 *
 * ## 为什么路线要从别人的配置里挑，而不是自己声明一套
 *
 * 媒体模型的地址、模型名、以及**它用哪个环境变量当 API Key**，在这个部署里已经有一份
 * 权威声明：DSH 模型配置（`llm-pi-ai` 那条设置段的 `providers` 字典）。用户加一个
 * doubao 路线就能让 seedream / seedance 可用，插件这边**一行都不用改**——那正是
 * 「稍后我加配置就能用」这句话的全部实现。
 *
 * 自建一套配置的代价不是多一份 YAML，是**同一个东西有了两个来源**：用户在 DSH 设置里
 * 改 key 或换网关，插件还照着自己那份旧配置打；而这两份配置谁都不会报错，只会有一个
 * 悄悄是错的。
 *
 * ## 只认读得懂的
 *
 * {@link readProviderRoutes} 对着一份 `unknown` 干活，因为它拿到的正是设置段的 `value`：
 * 形状由别人的 schema 决定，可以是任何东西。每一个字段都**先验后用**，读不懂的路线整条
 * 丢掉而不是猜一个默认值——一条 baseURL 猜错的路线会去一个不相干的域名上要视频，
 * 那比「没找到路线」难查得多（这与板面投影那条「读不懂的绝不覆盖」是同一条纪律）。
 */
import type { MediaCapability } from './types.ts'

/**
 * Ark 的公开端点。
 *
 * 这个默认值之所以站得住，是因为**我们只挑 Ark 自己的模型族**（`seedream` / `seedance`，
 * 见 {@link MEDIA_FAMILIES}）：那些模型就住在火山方舟上，所以「路线没写 baseURL」时
 * 落到这里不是猜测，是那族模型的唯一产地。用户若把请求引到自建中转，route 上会写着
 * `baseURL`（他的 LLM 也正靠着它跑），那时以 route 为准。
 */
export const ARK_DEFAULT_BASE = 'https://ark.cn-beijing.volces.com/api/v3'

/**
 * 音频那条的默认端点：豆包语音。
 *
 * 方舟那台主机上**没有**音频生成接口——它的多模态生成 API 只有图片、视频、3D 三类。
 * `doubao-seed-audio-1-0` 挂在方舟的模型广场上，但接口、鉴权、计费都在豆包语音那边。
 * 所以音频请求不能跟着一条「按方舟写的」路线走，见 {@link audioBaseURLOf}。
 */
export const SPEECH_DEFAULT_BASE = 'https://openspeech.bytedance.com/api/v3'

/**
 * 这条路线上的音频请求**实际该发到哪儿**。
 *
 * 一条 provider 路线通常是为方舟写的（`baseURL: https://ark.cn-beijing.volces.com/api/v3`），
 * 而它同时声明了图片、视频、音频三种模型是完全合理的配置——用户只是在同一个 key 下加了
 * 一个模型。但**同一个地址服务不了音频**：`ark.*` 上没有 `/tts/create`，照 baseURL 发出去
 * 只会换回一个 404，而错误信息不会告诉你「是你发错主机了」。
 *
 * 两条规则，都能指着文档说清楚：
 *
 * - 主机以 `ark.` 开头 → 换到语音那条。国内方舟对国内语音（`openspeech.bytedance.com`）；
 *   海外（BytePlus）对同一个区域的 `voice.<region>.bytepluses.com`，区域从主机名里带过去，
 *   不硬编一个 cn。
 * - 其余一律照旧。自建中转、代理、或者用户**直接写了**语音地址的路线，都在这一支——
 *   猜一个更「对」的地址会把一条本来能用的路线改坏。
 */
export function audioBaseURLOf(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '')
  if (trimmed === '') return SPEECH_DEFAULT_BASE
  let host: string
  try {
    host = new URL(trimmed).host.toLowerCase()
  } catch {
    // 读不懂的地址**不改**：去一个猜出来的域名上要音频，比让这条路线自己失败难查得多。
    return trimmed
  }
  if (!host.startsWith('ark.')) return trimmed
  const tail = host.slice('ark.'.length)
  return tail.endsWith('bytepluses.com') ? `https://voice.${tail}/api/v3` : SPEECH_DEFAULT_BASE
}

/**
 * 一种媒体能力的**模型族指纹**：模型 id 里出现这些片段之一，就是这条路线的活。
 *
 * 按「含片段」而不是按前缀匹配，因为真实的 id 带着自己的前缀与日期：官方是
 * `doubao-seedream-4-0-250828` / `doubao-seedance-2-0-260128`，而 BytePlus 那边叫
 * `dreamina-seedance-…`。按前缀写，跨区就失效。
 */
const MEDIA_FAMILIES: Readonly<Record<MediaCapability, readonly string[]>> = {
  image: ['seedream'],
  video: ['seedance'],
  audio: ['seed-tts', 'tts', 'audio-generation', 'seed-audio'],
}

/** 一条从模型配置里读出来的路线：地址、key 的环境变量名、它声明的模型。 */
export interface ProviderRoute {
  /** `providers` 字典的键 —— 只用于诊断，不发请求。 */
  readonly route: string
  /** 该路线的端点；缺省时调用方按 {@link ARK_DEFAULT_BASE} 兜。 */
  readonly baseURL: string
  /** 该路线用哪个环境变量名当 key（`CredentialRef`），缺省即「没有可解析的凭证」。 */
  readonly apiKeyEnv: string
  /** 该路线声明的模型 id，按配置顺序。 */
  readonly models: readonly string[]
}

/** 挑中的一条媒体路线：能力、落定后的地址与凭证名、以及具体用哪个模型。 */
export interface MediaRoute {
  readonly capability: MediaCapability
  /** 来源路线的键，进日志与错误文案 —— 用户要知道去 DSH 设置的哪一条里改。 */
  readonly route: string
  readonly baseURL: string
  readonly apiKeyEnv: string
  readonly model: string
}

/** 用户对某一种能力的显式指定，压过自动挑选。 */
export interface MediaRouteOverride {
  /** 指定路线键；缺省即在所有路线里按模型族找。 */
  readonly route?: string
  /** 指定模型 id；缺省即用该路线里第一个命中的模型。 */
  readonly model?: string
  readonly baseURL?: string
  readonly apiKeyEnv?: string
}

/** 一个非空字符串，否则 `undefined`。 */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * 读一份设置段的值，取出其中的 provider 路线。
 *
 * 接受的形状是 DSH `llm-pi-ai` 那条设置段的 `value`：
 * `{ providers: { <route>: { baseURL?, apiKeyEnv?, models?: [{ id }] } } }`。
 *
 * 其他一切——没有 `providers`、`providers` 不是对象、某条路线的 `models` 不是数组——
 * 都是「读不懂」，按空处理。调用方因此永远拿到一个可用的数组，不必区分「配置不存在」
 * 与「配置长得不像」：两者对使用者的意义相同（没有可用路线），而它们的区别只该出现在
 * 日志里，不该变成一条分支。
 */
export function readProviderRoutes(value: unknown): readonly ProviderRoute[] {
  if (typeof value !== 'object' || value === null) return []
  const providers = (value as Record<string, unknown>)['providers']
  if (typeof providers !== 'object' || providers === null) return []

  const routes: ProviderRoute[] = []
  for (const [route, raw] of Object.entries(providers as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue
    const profile = raw as Record<string, unknown>
    const models = Array.isArray(profile['models'])
      ? profile['models']
          .map((entry) =>
            typeof entry === 'object' && entry !== null ? text((entry as Record<string, unknown>)['id']) : undefined,
          )
          .filter((id): id is string => id !== undefined)
      : []
    routes.push({
      route,
      baseURL: text(profile['baseURL']) ?? ARK_DEFAULT_BASE,
      // 没有 apiKeyEnv 是一条**合法**的路线形状（pi-ai 允许「靠自己的环境发现鉴权」），
      // 所以这里不丢它 —— 丢在挑选那一步、并且给出能读懂的原因。
      apiKeyEnv: text(profile['apiKeyEnv']) ?? '',
      models,
    })
  }
  return routes
}

/** 模型 id 是不是这一族。 */
export function modelMatchesFamily(capability: MediaCapability, model: string): boolean {
  const lowered = model.toLowerCase()
  return MEDIA_FAMILIES[capability].some((family) => lowered.includes(family))
}

/**
 * 三种能力的固定顺序：不读 `Object.keys`，那顺序取决于字面量怎么写。
 *
 * 导出，是因为**客户端席位也要这份名单**（媒体卡的菜单只列该能力族的模型）。名单抄两份
 * 就会有「加了一种媒体形态、某处菜单不出现」的老剧本，所以这里是唯一真源。
 */
export const MEDIA_CAPABILITIES: readonly MediaCapability[] = ['image', 'video', 'audio']

/**
 * 这个模型 id 是哪些能力的生成模型。
 *
 * 一个 id 通常只命中一种，但**不假设只命中一种**：断言「一个 id 恰好一种能力」的实现在
 * 遇到 `seedream-tts` 这种复合名时会漏掉一种，而漏掉的那次提问永远没人问。
 */
export function mediaCapabilitiesOf(model: string): readonly MediaCapability[] {
  return MEDIA_CAPABILITIES.filter((capability) => modelMatchesFamily(capability, model))
}

/**
 * 这个模型 id 是不是**媒体生成**模型。
 *
 * 它回答的是与「挑路线」无关、却同样要紧的另一个问题：**它能不能当会话席位？** 不能。
 * `doubao-seedance-2-0-mini` 是视频生成模型，不是对话模型——把它选成某个会话的模型，
 * 那个会话下一次请求就会以 `POST /chat/completions` 打到方舟，换回一句
 * `max_completion_tokens … expected a value <= 12288, but got 32768`（那个 32768 是模型
 * 配置里没写 `maxTokens` 时的部署默认，媒体模型自然没写）。
 *
 * 这两件事必须分清：**席位选的是「这段会话下一次请求用哪个模型」，出图 / 出视频用哪个
 * 模型由能力指纹从同一份配置里挑**（{@link pickMediaRoute}）。所以媒体模型出现在对话
 * 模型列表里是纯粹的噪音，而选中它是一次必崩的选择——崩在下一次请求上，与出图无关。
 */
export function isMediaModel(model: string): boolean {
  return mediaCapabilitiesOf(model).length > 0
}

/**
 * 挑一条能服务某种能力的路线。
 *
 * 顺序是**具体压过一般**，而且每一步都只说一件事：
 *
 * 1. 调用方显式点名的那条路线 / 那个模型（{@link MediaRouteOverride}）——用户说了算；
 * 2. 否则在全部路线里按模型族找，**按配置顺序取第一个命中的模型**；
 * 3. 都没有就是 `undefined`。
 *
 * `undefined` 不是错误，是一个**要如实报出去的状态**：调用方会把它变成一句「DSH 模型配置
 * 里没有能找到 seedream 模型的路线」并带上候选路线名，用户据此才知道该往哪儿加配置。
 * 编一个默认模型在这里返回，会让那句诊断永远不出现，而请求打在别处失败。
 */
export function pickMediaRoute(
  routes: readonly ProviderRoute[],
  capability: MediaCapability,
  override?: MediaRouteOverride,
): MediaRoute | undefined {
  const named = override?.route
  const candidates = named === undefined ? routes : routes.filter((entry) => entry.route === named)

  for (const entry of candidates) {
    const model =
      text(override?.model) ??
      entry.models.find((id) => modelMatchesFamily(capability, id)) ??
      // 路线被显式点名、却没写 `models` 时，允许调用方给出模型名（`override.model`
      // 上一行已经接住了）。两者都没有就跳过 —— 不知道打哪个模型的请求不该发出去。
      undefined
    if (model === undefined) continue
    return {
      capability,
      route: entry.route,
      baseURL: text(override?.baseURL) ?? entry.baseURL,
      apiKeyEnv: text(override?.apiKeyEnv) ?? entry.apiKeyEnv,
      model,
    }
  }
  return undefined
}

/**
 * 按**模型 id** 找它属于哪条路线（卡片上选定生成模型之后走这一条）。
 *
 * 与 {@link pickMediaRoute} 是分工而不是重复：那个答「这种能力该用哪个模型」，这个答
 * 「用户点的**这个**模型该从哪儿发」。卡片席位选下来的就是模型 id，而地址与凭证名不在
 * 模型上、在它所属的路线里，所以生成时必须先把它认回路线。
 *
 * **刻意不校验这个 id 属不属于该能力的模型族**：族判定是按名字含片段猜的（`seedream`、
 * `seedance`），而配置里可能出现族外的新名字；在「用户明确点了它」这件事上，猜错的代价
 * 是拒绝一个本来能用的模型，而多信一次的代价只是服务端回一句原话（我们会原样带出来）。
 * 换句话说：**名单归名单，明说归明说**，明说压过名单。
 */
export function findModelRoute(
  routes: readonly ProviderRoute[],
  capability: MediaCapability,
  modelId: string,
): MediaRoute | undefined {
  const wanted = modelId.trim()
  if (wanted === '') return undefined
  for (const entry of routes) {
    if (!entry.models.includes(wanted)) continue
    return {
      capability,
      route: entry.route,
      baseURL: entry.baseURL,
      apiKeyEnv: entry.apiKeyEnv,
      model: wanted,
    }
  }
  return undefined
}

/**
 * 卡片上选定的模型**已经不在配置里**时，那句能让人动手的话。
 *
 * 它是「配置改了、卡片还记着旧模型」这个必然会发生的情况的出路：要么把模型加回去，要么
 * 在这张卡上重选一个。所以这句话要同时给出**那个 id**、**去哪儿改**、以及**现在有什么
 * 可选**——只说「模型不存在」等于让用户自己去猜。
 */
export function missingModelReason(
  capability: MediaCapability,
  modelId: string,
  routes: readonly ProviderRoute[],
): string {
  const available = routes
    .flatMap((entry) => entry.models.filter((id) => modelMatchesFamily(capability, id)))
    .join('、')
  const options = available === '' ? '当前配置里没有任何模型命中这一族' : `现在可选：${available}`
  return `这张卡选的${CAPABILITY_LABELS[capability]}模型「${modelId}」已经不在 DSH 模型配置里了——${options}。请在卡片底栏的模型席位上重新选一个。`
}

/**
 * 没挑到路线时，那句**能让人行动**的话。
 *
 * 它必须同时说出三件事，缺一件用户就得去读代码：**想要哪种能力**、**按什么找的**、
 * **去哪儿加**。所以它带上模型族指纹与候选路线名——「配置里没有 seedream 模型」比
 * 「未配置媒体生成」有用得多，而后者正是这类消息最常见的写法。
 */
export function noRouteReason(capability: MediaCapability, routes: readonly ProviderRoute[]): string {
  const families = MEDIA_FAMILIES[capability].join(' / ')
  const known = routes.map((entry) => entry.route).join('、')
  const where = known === '' ? 'DSH 模型配置里没有任何 provider 路线' : `现有路线：${known}`
  return `没有能找到${CAPABILITY_LABELS[capability]}模型的路线（按模型名含 ${families} 找）——${where}`
}

/** 三种能力的中文名，只用于拼给人看的那句话。 */
const CAPABILITY_LABELS: Readonly<Record<MediaCapability, string>> = {
  image: '图片',
  video: '视频',
  audio: '音频',
}
