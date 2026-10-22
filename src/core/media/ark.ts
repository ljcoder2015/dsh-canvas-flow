/**
 * dsh-canvas — 火山方舟（Ark）媒体接口的请求体与响应（F2.7）。
 *
 * 纯函数：拼 JSON、认 JSON。不拿 ctx、不发请求、不认识 fetch —— 网络与落盘都在
 * `host/media-provider.ts`。这样切的理由很实际：**协议里最容易写错的东西是字段名与
 * 响应形状，而它们恰恰是最不需要真机就能验的部分**。四样出路（图片的同步返回、视频的
 * 异步任务、任务的终态判定、成片地址的两种长相）因此全部可以在单测里穷举。
 *
 * ## 图片与视频的形态差在哪
 *
 * 图片是**同步**的：一次 POST 回来就是图片本身（一个 URL，或者一段 base64）。
 * 视频是**异步任务**：POST 只换回一个 id，真正的片子要轮询到 `succeeded` 才拿到，
 * 而且那个地址是**签名的、约 24 小时过期**的临时链接——所以调用方必须在拿到它的那一刻
 * 把字节取回来，不能把 URL 存起来当产物。这一条不写下来，最自然的实现（把 URL 记进卡里）
 * 会做出一个「今天能看、明天打不开」的产物。
 */
import type { MediaCapability } from './types.ts'

/** 一张图片的生成请求。 */
export interface ImageRequestInput {
  readonly model: string
  readonly prompt: string
  /** `2K` 这样的档位，或 `2048x1024` 这样的像素值；缺省交给模型自己的默认。 */
  readonly size?: string
  /**
   * 期望的图片格式（`png` / `jpeg`）。产物路径已经声明了扩展名，所以这个值不是偏好，
   * 是**对齐**：`output_format` 在服务端默认 `jpeg`，不写它就会把 jpeg 字节写进一个
   * 叫 `.png` 的文件里（不报错、浏览器多半也能显示，但 MIME 与字节对不上）。
   *
   * 只传认得的两种；其他扩展名不传（让服务端用它自己的默认，而不是替它猜）。
   */
  readonly format?: string
  /**
   * 参考图的地址（图生图）。
   *
   * Ark 是**拿着这个地址自己去下载的**，所以它必须是服务端取得到的：一个
   * `https://…`，或者一份内联的 `data:image/png;base64,…`（两个 API 都明确支持）。
   * 本地绝对路径在这里没有意义——那一步由 host 侧读字节、拼 data URL（`media-provider.ts`）。
   */
  readonly referenceUrl?: string
}

/**
 * Ark 图片请求体。
 *
 * 显式要 `response_format: 'url'`，而不是吃默认值：默认值会随部署与版本变（有的默认
 * 返回 base64），而两种形状的**取用方式完全不同**（下载 vs 直接解码）。写死一个自己不
 * 是想让服务端少点自由，是想让自己只有一条路要处理。
 *
 * **`watermark` 必须显式写成 `false`**：这个字段在服务端默认是 `true`，也就是每张图
 * 右下角都会带一枚「AI 生成」角标。画布上的产物是用户的素材，不该带着别人的标——这是
 * 产品决定，不是可调参数，所以它和视频那条一样写死（视频那条一开始就写了，图片这条
 * 是照着文档核对时才发现的漏）。
 */
export function arkImageBody(input: ImageRequestInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    response_format: 'url',
    watermark: false,
  }
  if (input.size !== undefined && input.size.trim() !== '') body['size'] = input.size
  const format = input.format?.trim().toLowerCase() ?? ''
  if (format === 'png' || format === 'jpeg') body['output_format'] = format
  if (input.referenceUrl !== undefined && input.referenceUrl.trim() !== '') {
    // 4.0 起文生图与图生图是同一个模型，参考图就放在 `image` 上（单图给字符串，
    // 多图给数组）—— 给字符串让这条请求在最老的形态上也成立。
    body['image'] = input.referenceUrl
  }
  return body
}

/** 从一次图片响应里读出来的东西。 */
export interface ImageResult {
  /** 要下载的临时地址。 */
  readonly url?: string
  /** 直接内联回来的图片字节（当服务端无视了 `response_format` 时）。 */
  readonly base64?: string
  /** 读不出图片时的原因，直接来自服务端。 */
  readonly reason?: string
}

/**
 * 读一次图片响应。
 *
 * `data` 是数组但这个插件只取**第一张**：一次请求要一张，是接口默认，也是卡片的语义
 * （一张卡一个产物）。要四张就发四次，让四张图各自成为一张卡——那才是这个画布想要的结果，
 * 而不是把四张塞进一个文件里。
 */
export function readImageResult(json: unknown): ImageResult {
  const failure = serverReason(json)
  if (failure !== undefined) return { reason: failure }
  if (typeof json !== 'object' || json === null) return { reason: '响应不是 JSON 对象' }
  const data = (json as Record<string, unknown>)['data']
  if (!Array.isArray(data) || data.length === 0) return { reason: '响应里没有 data 数组' }
  const first = data[0]
  if (typeof first !== 'object' || first === null) return { reason: 'data[0] 不是对象' }
  const entry = first as Record<string, unknown>
  const url = nonEmpty(entry['url'])
  if (url !== undefined) return { url }
  const base64 = nonEmpty(entry['b64_json'])
  if (base64 !== undefined) return { base64 }
  return { reason: 'data[0] 里既没有 url 也没有 b64_json' }
}

/** 一段视频的生成请求。 */
export interface VideoRequestInput {
  readonly model: string
  readonly prompt: string
  /** `16:9` / `9:16` / `1:1` / `adaptive`。 */
  readonly ratio?: string
  /** 秒数。Ark 按秒计费，所以这个值同时是**成本**参数。 */
  readonly duration?: number
  /** `480p` / `720p` / `1080p`。 */
  readonly resolution?: string
  /** 首帧参考图的公网地址（图生视频）。 */
  readonly referenceUrl?: string
  /**
   * 参考图在这一次生成里扮演的角色。
   *
   * 取值按 Ark 的约定：`first_frame`（图生视频首帧）、`last_frame`（首尾帧两图时的
   * 尾帧）、`reference_image`（全模态参考生视频）。三种场景**互斥**。
   *
   * 不填时按 `first_frame` 处理，而且这个默认**由这里补上、不交给服务端**：文档给的
   * role 取值里没有「空」这一档，一张图不给角色会被当成什么、2.5 的教程里没写。
   * 「把一张图变成一段片子」是这个画布上「视频引用图片」的默认读法，所以由我们说明白，
   * 而不是发一个语义未定的请求然后猜结果。
   */
  readonly referenceRole?: string
  /** 是否让模型顺带生成音轨。 */
  readonly generateAudio?: boolean
  /** 固定种子，用于复现同一条片子。 */
  readonly seed?: number
}

/**
 * **首帧 / 尾帧场景下 `ratio` 只能是 `adaptive`** —— 这不是偏好，是 Seedance 2.5
 * 文档写明的组合约束：`content.role` 为 `first_frame` / `last_frame` 时，输出比例
 * **自动跟随首帧**，另给一个 `16:9` 会被服务端判成 `InvalidParameter.TaskTypeConstraint`。
 *
 * 所以这条不是「我们替用户改参数」，而是**把一句自相矛盾的请求改成它唯一成立的写法**：
 * 首帧已经决定了比例，那个 `ratio` 本来就不会生效。`reference_image`（全模态参考）不受
 * 这条限制，用户要什么比例就还是什么比例。
 */
const FRAME_ROLES: readonly string[] = ['first_frame', 'last_frame']

/**
 * Ark 视频任务请求体。
 *
 * 只写调用方真的给了的字段：这些参数**互相约束**（分辨率上限随模型与时长变、比例受模型
 * 支持集限制），而服务端对不合规的组合给的是一句笼统的失败。少写一个字段、让服务端用它
 * 自己的默认，比自己填一个猜的值更容易成功——猜错的那个值会以「任务失败」的形式回来，
 * 而失败信息不会告诉你「是你那个 resolution 猜错了」。
 *
 * 两个例外，都是协议硬性的：
 *
 * 1. **有参考图就写 `role`**（缺省 `first_frame`）——见 `VideoRequestInput.referenceRole`。
 * 2. **首帧 / 尾帧场景 `ratio` 归一为 `adaptive`**——见 `FRAME_ROLES`。
 */
export function arkVideoBody(input: VideoRequestInput): Record<string, unknown> {
  const content: Record<string, unknown>[] = [{ type: 'text', text: input.prompt }]
  const referenceUrl = input.referenceUrl?.trim() ?? ''
  const role = referenceRoleOf(referenceUrl, input.referenceRole)
  if (role !== undefined) {
    content.push({ type: 'image_url', image_url: { url: referenceUrl }, role })
  }
  const body: Record<string, unknown> = { model: input.model, content }
  const ratio = FRAME_ROLES.includes(role ?? '') ? 'adaptive' : input.ratio
  if (ratio !== undefined && ratio.trim() !== '') body['ratio'] = ratio
  if (input.duration !== undefined) body['duration'] = input.duration
  if (input.resolution !== undefined && input.resolution.trim() !== '') body['resolution'] = input.resolution
  if (input.generateAudio !== undefined) body['generate_audio'] = input.generateAudio
  if (input.seed !== undefined) body['seed'] = input.seed
  // 水印是产品决定，不是用户参数：画布上的产物是用户的素材，不该带着别人的角标。
  body['watermark'] = false
  return body
}

/**
 * 这一次请求里参考图的角色；没有参考图就是 `undefined`。
 *
 * 单独抽出来的理由：`ratio` 的取值依赖它，两处各判一次必然会分叉（一处认为「没给角色」、
 * 另一处认为「是首帧」），而分叉的表现是「同样的请求有时 400 有时不 400」。
 */
function referenceRoleOf(url: string, named: string | undefined): string | undefined {
  if (url === '') return undefined
  const trimmed = named?.trim() ?? ''
  return trimmed === '' ? 'first_frame' : trimmed
}

/**
 * 视频任务的终态。
 *
 * `cancelled` 与 `expired` 在这里与 `failed` **同级**，因为对调用方它们的意思完全一样：
 * 不会再有片子了。把这两个漏掉的实现会一直轮询下去——一个排了两小时被回收的任务，
 * 会变成一个永远转不完的等待。
 */
export type VideoTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired'

/** 一次任务查询读出来的东西。 */
export interface VideoTaskResult {
  /** 认得出的状态；认不出时为 `undefined`（调用方据此报「响应读不懂」而不是「还在跑」）。 */
  readonly status?: VideoTaskStatus
  /** 成片地址，只在 `succeeded` 时出现。 */
  readonly videoUrl?: string
  /** 失败原因，或读不懂时的说明。 */
  readonly reason?: string
}

const TERMINAL: readonly VideoTaskStatus[] = ['succeeded', 'failed', 'cancelled', 'expired']

/** 这个状态还会不会变。**终态判定只此一处** —— 轮询循环与判据都读它。 */
export function isTerminalStatus(status: VideoTaskStatus): boolean {
  return TERMINAL.includes(status)
}

/** 新建任务后从响应里读出的任务 id。 */
export function readTaskId(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null) return undefined
  return nonEmpty((json as Record<string, unknown>)['id'])
}

/**
 * 读一次任务查询响应。
 *
 * 成片地址有两副长相，两种都要接住：老形态是 `content.video_url` 直接给字符串，新形态是
 * `content[0].video_url.url`（或者 `content.video_url.url`）。这不是「防御性编程」——
 * 是按文档抄一份就会漏掉另一种的**真实差异**，而漏掉的那种表现为「任务明明成功了，
 * 插件说读不出地址」。
 */
export function readTaskResult(json: unknown): VideoTaskResult {
  if (typeof json !== 'object' || json === null) return { reason: '响应不是 JSON 对象' }
  const record = json as Record<string, unknown>
  const status = videoStatus(record['status'])
  if (status === undefined) {
    return { reason: `认不出的任务状态：${String(record['status'])}` }
  }
  if (status !== 'succeeded') {
    const reason = serverReason(json)
    return reason === undefined ? { status } : { status, reason }
  }
  const url = videoUrlOf(record['content'])
  return url === undefined ? { status, reason: '任务已成功，但响应里找不到视频地址' } : { status, videoUrl: url }
}

/** 把服务端的字符串收敛到已知状态上；认不出就 `undefined`。 */
function videoStatus(value: unknown): VideoTaskStatus | undefined {
  if (typeof value !== 'string') return undefined
  const lowered = value.trim().toLowerCase()
  return (['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired'] as const).find(
    (candidate) => candidate === lowered,
  )
}

/** 成片地址的两副长相。 */
function videoUrlOf(content: unknown): string | undefined {
  if (Array.isArray(content)) return content.length === 0 ? undefined : videoUrlOf(content[0])
  if (typeof content !== 'object' || content === null) return undefined
  const raw = (content as Record<string, unknown>)['video_url']
  if (typeof raw === 'string') return nonEmpty(raw)
  if (typeof raw === 'object' && raw !== null) return nonEmpty((raw as Record<string, unknown>)['url'])
  return undefined
}

/**
 * 服务端自己给的原因，原样带出来。
 *
 * 不翻译、不改写：方舟的失败消息里常常就是唯一有用的那句话（哪一个参数不被这个模型支持），
 * 而插件能补的只有上下文，不能替它说话。
 */
function serverReason(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null) return undefined
  const error = (json as Record<string, unknown>)['error']
  if (typeof error === 'string') return nonEmpty(error)
  if (typeof error !== 'object' || error === null) return undefined
  return nonEmpty((error as Record<string, unknown>)['message'])
}

/** 一个非空字符串。 */
function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/*
 * ## 音频：第三个产地
 *
 * 图片和视频都在方舟（`ark.*`），一套 Bearer、一个 `/api/v3`。音频不是：`doubao-seed-audio-1-0`
 * 挂在方舟的模型广场上，但**接口住在豆包语音**（`openspeech.bytedance.com/api/v3/tts/create`），
 * 鉴权换成 `X-Api-Key`。这是同一个厂商的两套服务体系，不是笔误——方舟的多模态生成 API
 * 只有图片、视频、3D 三类，没有音频。
 *
 * 三处差异各自会以不同方式咬人，所以都收敛到这里：
 *
 * 1. **端点**（`routes.ts` 的 `audioBaseURLOf`）：照路线的 baseURL 发，会打到一台没有这个
 *    接口的主机上，回 404。
 * 2. **模型名**（{@link arkAudioModelOf}）：广场上是 `doubao-seed-audio-1-0`，语音接口只认
 *    `seed-audio-1.0`。不换，回一句「模型不存在」。
 * 3. **响应**（{@link readAudioResult}）：同步返回 JSON，音频在 `audio` 里是 base64，另有
 *    一个两小时过期的 `url`；HTTP 200 也可能是失败，错误码在 `code` 上。
 */

/**
 * 一段音频的生成请求。
 *
 * 字段叫 `prompt` 而不是 `text`，因为 `seed-audio` 这一族收的是**导演指令**：`text_prompt`
 * 里可以写「雨夜便利店，两个人压低声音争吵，背景有收银机滴滴声」，也可以直接写要念的
 * 台词——模型自己判断怎么编排。叫 `text` 会把调用方引向「朗读稿」这一种读法，而那是这个
 * 模型最窄的用法。
 */
export interface AudioRequestInput {
  readonly model: string
  readonly prompt: string
  /**
   * 产物路径声明的扩展名（`mp3` / `wav` / …），用来对齐 `audio_config.format`。
   *
   * 与图片的 `output_format` 同一个道理：服务端默认是 `wav`，不写它就会把 wav 字节写进
   * 一个叫 `.mp3` 的文件里——不报错，浏览器多半也能放，但 MIME 与字节对不上。
   */
  readonly format?: string
  /** 采样率（Hz）。不传就用服务端默认（24000）。 */
  readonly sampleRate?: number
}

/**
 * 扩展名 → `audio_config.format` 的取值。
 *
 * 只有服务端认的四种（`wav` / `mp3` / `pcm` / `ogg_opus`）。`opus` 也映射到 `ogg_opus`：
 * 那是同一个容器，而 `.opus` 是常见写法。认不出的扩展名**不表态**，让服务端用自己的默认
 * ——比自己编一个它不认的名字好。
 */
const AUDIO_FORMATS: Readonly<Record<string, string>> = {
  mp3: 'mp3',
  wav: 'wav',
  pcm: 'pcm',
  ogg: 'ogg_opus',
  opus: 'ogg_opus',
}

/** 这个扩展名对应的输出格式；认不出就是 `undefined`。 */
export function audioFormatOf(extension: string | undefined): string | undefined {
  const key = extension?.trim().toLowerCase() ?? ''
  return AUDIO_FORMATS[key]
}

/**
 * 豆包语音的音频生成请求体。
 *
 * `audio_config` 只在真有一个字段要写时才挂上去：`audio_config: {}` 与「不说」在服务端
 * 是两件事，前者可能把默认格式盖成空值。
 */
export function arkAudioBody(input: AudioRequestInput): Record<string, unknown> {
  const body: Record<string, unknown> = { model: input.model, text_prompt: input.prompt }
  const config: Record<string, unknown> = {}
  const format = audioFormatOf(input.format)
  if (format !== undefined) config['format'] = format
  if (input.sampleRate !== undefined && Number.isFinite(input.sampleRate) && input.sampleRate > 0) {
    config['sample_rate'] = input.sampleRate
  }
  if (Object.keys(config).length > 0) body['audio_config'] = config
  return body
}

/** 从一次音频响应里读出来的东西：一段 base64，或一个临时地址，或一句原因。 */
export interface AudioResult {
  /** 直接内联回来的音频字节。 */
  readonly base64?: string
  /** 两小时过期的下载地址（`audio` 为空时的那条后路）。 */
  readonly url?: string
  /** 读不出音频时的原因，直接来自服务端。 */
  readonly reason?: string
}

/**
 * 读一次音频响应。
 *
 * 三样东西按顺序认：**错误码**、**内联字节**、**临时地址**。顺序不能反——`code` 非零时
 * 响应体里常常仍带着一个空的 `audio` 字段，先读字节会拿一段空字符串去解码，落一个 0
 * 字节的文件，而表面上「成功」。
 *
 * `data` 那一层嵌套是给另一种包装留的后路（有的网关会把同样的字段塞进 `data`），两级都
 * 只认 `audio` / `url` 这两个名字，不额外发明。
 */
export function readAudioResult(json: unknown): AudioResult {
  if (typeof json !== 'object' || json === null) return { reason: '响应不是 JSON 对象' }
  const record = json as Record<string, unknown>
  const failure = speechReason(record)
  if (failure !== undefined) return { reason: failure }
  const direct = audioPayloadOf(record)
  if (direct !== undefined) return direct

  const nested = record['data']
  if (typeof nested === 'object' && nested !== null) {
    const inner = nested as Record<string, unknown>
    const innerFailure = speechReason(inner)
    if (innerFailure !== undefined) return { reason: innerFailure }
    const wrapped = audioPayloadOf(inner)
    if (wrapped !== undefined) return wrapped
  }
  return { reason: '响应里既没有 audio 也没有 url' }
}

/** 一层对象里的音频载荷：先 base64，后临时地址。 */
function audioPayloadOf(record: Record<string, unknown>): AudioResult | undefined {
  const base64 = nonEmpty(record['audio'])
  if (base64 !== undefined) return { base64 }
  const url = nonEmpty(record['url'])
  if (url !== undefined) return { url }
  return undefined
}

/**
 * 语音接口自己那套错误码。
 *
 * 它可以在 HTTP 200 里表示失败（`code` 非零 + `message`），所以只看 `response.ok` 会把
 * 「这个模型不支持这个格式」当成成功。这与方舟的 `{"error":{"message":…}}` 是两套写法，
 * 不能共用 {@link serverReason}。
 */
function speechReason(record: Record<string, unknown>): string | undefined {
  const code = record['code']
  if (typeof code !== 'number' || code === 0) return undefined
  const message = nonEmpty(record['message']) ?? nonEmpty(record['msg'])
  return message === undefined ? `接口返回了错误码 ${String(code)}` : `${String(code)}：${message}`
}

/**
 * 模型配置里写的 id，换成**语音接口认的那个**。
 *
 * 同一个模型有两副名字：方舟模型广场上是 `doubao-seed-audio-1-0`（市场 id），语音接口的
 * `model` 字段只认 `seed-audio-1.0`。用户在 DSH 模型配置里抄的是广场上那个——于是发请求
 * 前必须换一次。不换，服务端回「模型不存在」，而那句话离「你抄的是市场 id」很远。
 *
 * 只对 `seed-audio` 这一族动手：图片 / 视频两族的接口直接吃市场 id（`doubao-seedream-…`
 * 原样发出去就是对的），去改它们等于把一条本来能用的请求改坏。
 */
export function arkAudioModelOf(model: string): string {
  const trimmed = model.trim()
  const stripped = trimmed.startsWith('doubao-') ? trimmed.slice('doubao-'.length) : trimmed
  // 整串锚定，不做「末尾两个数字就当版本号」的替换：`…-1-0-260628` 是带日期后缀的 id，
  // 那样替换会把它改成 `…-1.0.260628` ——一个谁都没见过的名字，报错也看不出是这儿弄的。
  const version = /^seed-audio-(\d+)-(\d+)$/.exec(stripped)
  return version === null ? trimmed : `seed-audio-${version[1]}.${version[2]}`
}

/** 各能力的产物扩展名 —— 生成物落盘时用它拼文件名，与 kind 表的判据同一套扩展名。 */
export const MEDIA_EXTENSIONS: Readonly<Record<MediaCapability, string>> = {
  image: 'png',
  video: 'mp4',
  audio: 'mp3',
}
