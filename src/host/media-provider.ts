/**
 * dsh-canvas — 媒体生成的默认实现：按 DSH 自己的模型配置去调即梦（F2.7）。
 *
 * 这一层是**胶水，不是逻辑**：协议里的字段名与响应形状在 `core/media/ark.ts`（纯，
 * 可穷举验），路线怎么挑在 `core/media/routes.ts`（纯，可穷举验）。这里只做三件纯函数
 * 做不到的事——**读设置、解析凭证、发请求并落盘**。
 *
 * ## 端点与密钥都是别人已经声明过的东西
 *
 * 不新增一份「插件自己的媒体配置」。地址、模型、以及**用哪个环境变量当密钥**，这个部署
 * 已经有一份权威声明：DSH 模型配置里 `llm-pi-ai` 那条设置段的 `providers` 字典。用户往
 * 那儿加一条 doubao 路线，seedream / seedance 就有活干了 —— 插件这边一个字都不用改。
 *
 * 两条服务都按 `ctx.get('<名>')` + **形状校验**取，不进 `inject`：
 *
 * - `settings`（`@deepseek-ai/dsh-settings` 的 `SettingsForms`，运行时名见它自己那句
 *   `super(ownerContext, "settings")`）—— `describe()` 给每个设置段一个 `{ ns, value }`。
 * - `credentials`（`@deepseek-ai/dsh-credentials` 的 `CredentialProvider`，`super(ctx,
 *   "credentials")`）—— `resolve(ref)` 把「环境变量名」解成值。
 *
 * 不 inject 的理由与 `agent-preset.ts` 那次事故同源：inject 一个这个部署没挂的服务，
 * 插件会**整个加载失败**，而缺这两个服务的部署（裸 harness、单测）本该照常跑，只是媒体
 * 生成落到「没有可用路线」那句诚实的诊断上。
 *
 * ![危险] 这两条声明**只能按上游自己发布过的成员写**。上一回猜一个不存在的成员
 * （`standingKeyFor`）让每个卡片会话都死在 `face.standingKeyFor is not a function` 上，
 * 而类型系统看不见这个错——服务是运行时按名取的。所以下面每个成员都能在上游的
 * `lib/types/index.d.ts` 里逐字指出来，且**没有多一个**。
 *
 * ## 二进制落盘为什么要绕开 fs 缝
 *
 * `ctx.fs` 那次缝上只有 `writeText`，没有 `writeBytes`（`@deepseek-ai/dsh-fs` 的
 * `FileSystem` 抽象方法表就是那十四行）。一张 PNG 或一段 MP4 从 `writeText` 走会被当成
 * UTF-8 文本写下去——那不会报错，只会写出一个**打不开的文件**，这是最难查的一类失败。
 *
 * 所以这里走 `artifact-io.ts` 已经立下的同一条先例：路径仍由缝解析（`resolve` 知道沙箱
 * 根在哪儿），落字节则交给 OS。`processPath(target)` 正是为这件事存在的——它的文档写着
 * 「consumers may pass this value to another OS capability」。
 */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname } from 'node:path'
import type {
  CanvasCapabilities,
  GenerateAudioRequest,
  GenerateImageRequest,
  GenerateVideoRequest,
} from '../capabilities.ts'
import type { MediaCapability } from '../core/media/types.ts'
import {
  arkAudioBody,
  arkAudioModelOf,
  arkImageBody,
  arkVideoBody,
  audioFormatOf,
  isTerminalStatus,
  readAudioResult,
  readImageResult,
  readTaskId,
  readTaskResult,
} from '../core/media/ark.ts'
import {
  audioBaseURLOf,
  findModelRoute,
  missingModelReason,
  noRouteReason,
  pickMediaRoute,
  readProviderRoutes,
  type MediaRoute,
  type MediaRouteOverride,
} from '../core/media/routes.ts'
import { mediaMimeOf } from '../core/artifact/io/artifact-io.ts'

/**
 * 这个模块用到的 `ctx.settings` 的那一面。
 *
 * 逐个成员对着 `@deepseek-ai/dsh-settings@0.2.0-rc.2` 的 `lib/types/index.d.ts` 抄的：
 * `describe(options?)` 返回 `SettingsDescriptor[]`，每项 `{ ns, value, … }`。**只有
 * `describe` 一个成员**——这条路径只读，写设置是设置面板的事，这里手伸过去没有理由。
 */
interface SettingsFace {
  describe(options?: { redactSecrets?: boolean }): readonly SettingsDescriptorShape[]
}

/** 一条设置段里这个模块会读的字段。其余（schema、revision、base…）留给别人。 */
interface SettingsDescriptorShape {
  ns: string
  value: unknown
}

/**
 * 这个模块用到的 `ctx.credentials` 的那一面。
 *
 * 同样逐字对着 `@deepseek-ai/dsh-credentials@0.2.0-rc.2` 的 `lib/types/index.d.ts`：
 * `resolve(ref)` 收一个 `CredentialRef`（一个 POSIX 环境变量名）返回
 * `{ value, source }` 或 `undefined`。**只 `resolve` 一个成员** —— describe / set /
 * readRecord 都是别的用途（配置界面、写入、授权 grant），在这里是无关的能力。
 */
interface CredentialsFace {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
}

/** 媒体生成的可调项，来自插件 Config。 */
export interface MediaOptions {
  /** 图片走哪条 provider 路线；空 = 在所有路线里按模型族自动找。 */
  readonly imageRoute: string
  readonly videoRoute: string
  readonly audioRoute: string
  /** 轮询间隔与总超时，毫秒。视频任务按分钟计，所以两个都不是小数字。 */
  readonly pollMs: number
  readonly timeoutMs: number
}

/** 上游返回的一句失败，原样带到调用方。 */
class MediaError extends Error {}

export class MediaProvider {
  constructor(
    private readonly ctx: Context,
    private readonly options: MediaOptions,
  ) {}

  /**
   * 三条生成能力，形状与 {@link CanvasCapabilities} 一致。
   *
   * 装配时按成员与部署已有的能力合并（`src/index.ts`），所以这里永远返回完整三条——
   * 「哪条该由谁服务」是装配那一处的一次判断，不是运行时的每个调用点各判一次。
   */
  capabilities(): Pick<CanvasCapabilities, 'generateImage' | 'generateVideo' | 'generateAudio'> {
    return {
      generateImage: (request, signal) => this.generateImage(request, signal),
      generateVideo: (request, signal) => this.generateVideo(request, signal),
      generateAudio: (request, signal) => this.generateAudio(request, signal),
    }
  }

  private async generateImage(request: GenerateImageRequest, signal?: AbortSignal): Promise<{ path: string }> {
    const route = await this.routeFor('image', request.model)
    const key = await this.keyFor(route)
    const body = arkImageBody({
      model: route.model,
      prompt: request.prompt,
      format: imageFormatOf(request.file),
      referenceUrl: await this.referenceUrl(request.referencePath, request.project.root, signal),
    })
    const json = await this.postJson(`${route.baseURL}/images/generations`, body, key, signal)
    const result = readImageResult(json)
    if (result.reason !== undefined) throw new MediaError(`生图失败：${result.reason}`)
    const bytes =
      result.base64 !== undefined
        ? new Uint8Array(Buffer.from(result.base64, 'base64'))
        : await this.download(result.url as string, signal)
    return { path: await this.save(request.project.root, request.file, bytes, signal) }
  }

  private async generateVideo(request: GenerateVideoRequest, signal?: AbortSignal): Promise<{ path: string }> {
    const route = await this.routeFor('video', request.model)
    const key = await this.keyFor(route)
    const body = arkVideoBody({
      model: route.model,
      prompt: request.prompt,
      ratio: request.ratio,
      duration: request.duration,
      resolution: request.resolution,
      referenceUrl: await this.referenceUrl(request.referencePath, request.project.root, signal),
      referenceRole: request.referenceRole,
    })
    const created = await this.postJson(`${route.baseURL}/contents/generations/tasks`, body, key, signal)
    const taskId = readTaskId(created)
    if (taskId === undefined) throw new MediaError('生视频失败：创建任务后没有拿到任务 id')

    const url = await this.awaitVideo(route, key, taskId, signal)
    const bytes = await this.download(url, signal)
    return { path: await this.save(request.project.root, request.file, bytes, signal) }
  }

  /**
   * 生成一段音频（F2.7）。
   *
   * 与图片、视频不同的不是流程，是**产地**：`doubao-seed-audio-1-0` 的接口在豆包语音
   * （`/tts/create`），鉴权是 `X-Api-Key`，与方舟的 `Bearer` 不是同一个密钥体系。三处
   * 差异各自都有一次机会把一个「看起来对」的实现做坏，所以三处都显式写出来：
   *
   * 1. **地址**走 `audioBaseURLOf`——一条为方舟写的路线，音频请求不能跟着它的 baseURL 去
   *    方舟那台主机（那里没有 `/tts/create`）。
   * 2. **请求头**换成语音那套（`X-Api-Key` + `X-Api-Request-Id`），不夹杂 Bearer。
   * 3. **模型名**过 `arkAudioModelOf`——广场 id 与接口认的 id 是两副名字。
   * 4. **格式**跟着产物扩展名走（`audio_config.format`）：服务端默认 `wav`，不写它就会把
   *    wav 字节写进一个叫 `.mp3` 的文件里。
   *
   * 响应是同步的（不是视频那种任务轮询），音频以 base64 回来，另有一个两小时过期的地址。
   */
  private async generateAudio(request: GenerateAudioRequest, signal?: AbortSignal): Promise<{ path: string }> {
    const route = await this.routeFor('audio', request.model)
    const key = await this.keyFor(route)
    const body = arkAudioBody({
      model: arkAudioModelOf(route.model),
      prompt: request.prompt,
      format: audioFormatOf(extname(request.file).slice(1)),
    })
    const url = `${audioBaseURLOf(route.baseURL)}/tts/create`
    const json = await this.postSpeech(url, body, key, route, signal)
    const result = readAudioResult(json)
    if (result.reason !== undefined) throw new MediaError(`生音频失败：${result.reason}`)
    const bytes =
      result.base64 !== undefined
        ? new Uint8Array(Buffer.from(result.base64, 'base64'))
        : await this.download(result.url as string, signal)
    return { path: await this.save(request.project.root, request.file, bytes, signal) }
  }

  /**
   * 轮询到成片地址。
   *
   * 三重退出，缺一个都会变成「永远转下去的等待」：**终态**（含 cancelled / expired，
   * 见 `isTerminalStatus`）、**超时**、以及**取消**。取消单独判而不是被超时吸收——用户
   * 按了停，不该等九分钟再被告知超时。
   */
  private async awaitVideo(route: MediaRoute, key: string, taskId: string, signal?: AbortSignal): Promise<string> {
    const started = Date.now()
    for (;;) {
      if (signal?.aborted === true) throw new MediaError('已取消')
      const json = await this.getJson(`${route.baseURL}/contents/generations/tasks/${taskId}`, key, signal)
      const result = readTaskResult(json)
      if (result.videoUrl !== undefined) return result.videoUrl
      if (result.status !== undefined && isTerminalStatus(result.status)) {
        throw new MediaError(`生视频失败（${result.status}）：${result.reason ?? '服务端没有给出原因'}`)
      }
      if (Date.now() - started > this.options.timeoutMs) {
        throw new MediaError(`生视频超时：任务 ${taskId} 在 ${Math.round(this.options.timeoutMs / 1000)} 秒内没有结束`)
      }
      await pause(this.options.pollMs, signal)
    }
  }

  /**
   * 挑一条能服务这种能力的路线，挑不到就报出**为什么挑不到**。
   *
   * 两种问法，两个答案：
   *
   * - `model` 没给 —— 「这种能力该用哪个模型」，按模型族在所有路线里挑（`pickMediaRoute`）。
   * - `model` 给了 —— 「用户点的这个模型从哪儿发」，先把它认回所属路线（`findModelRoute`）。
   *   认不回来就**如实报错**，不回退：用户选了 pro 而插件悄悄换成 flash，会让「我明明选了
   *   pro」变成一句无法验证的怀疑，而两张图看起来都"差不多"。
   */
  private async routeFor(capability: MediaCapability, model?: string): Promise<MediaRoute> {
    const routes = await this.providerRoutes()
    const named = model?.trim() ?? ''
    if (named !== '') {
      const found = findModelRoute(routes, capability, named)
      if (found === undefined) throw new MediaError(missingModelReason(capability, named, routes))
      return found
    }
    const override = this.overrideFor(capability)
    const route = pickMediaRoute(routes, capability, override)
    if (route === undefined) throw new MediaError(noRouteReason(capability, routes))
    return route
  }

  private overrideFor(capability: MediaCapability): MediaRouteOverride | undefined {
    const named = { image: this.options.imageRoute, video: this.options.videoRoute, audio: this.options.audioRoute }[
      capability
    ].trim()
    return named === '' ? undefined : { route: named }
  }

  /**
   * 读这个部署的 provider 路线。
   *
   * 在**每一条**设置段里找那个带 `providers` 字典的，优先 `llm-pi-ai` 那条：设置段的 `ns`
   * 是 profile 的条目 id，而条目 id 与包名之间没有解析关系（本项目自己就踩过这个——
   * `dsh-canvas` 这个短词与包名无关），所以按名字找是**首选**而不是唯一依据，真正认下来
   * 的还是「它长得像不像一份 provider 配置」。
   */
  private async providerRoutes() {
    const face = this.settings()
    if (face === undefined) return []
    let descriptors: readonly SettingsDescriptorShape[]
    try {
      descriptors = face.describe({ redactSecrets: true })
    } catch {
      return []
    }
    const candidates = descriptors.filter((entry) => readProviderRoutes(entry.value).length > 0)
    if (candidates.length === 0) return []
    const preferred = candidates.find((entry) => entry.ns === 'llm-pi-ai') ?? candidates[0]
    return readProviderRoutes(preferred.value)
  }

  /**
   * 解析某条路线的密钥。
   *
   * 每次调用现解一次，**不缓存**：上游那条规矩是「consumers re-resolve at each operation
   * and must not cache across operations」，为的是换掉密钥后下一个操作就用上新的，而不必
   * 重启插件。缓存一行看起来无害，代价是用户改了密钥之后不知道要重启。
   */
  private async keyFor(route: MediaRoute): Promise<string> {
    if (route.apiKeyEnv === '') {
      throw new MediaError(
        `模型路线「${route.route}」没有声明 apiKeyEnv，无法解析密钥——请在 DSH 模型配置里给它补一个环境变量名`,
      )
    }
    const face = this.credentials()
    if (face === undefined) {
      throw new MediaError('这个部署没有凭证服务（ctx.credentials），无法解析媒体生成的密钥')
    }
    const resolved = await face.resolve(route.apiKeyEnv)
    if (resolved === undefined || resolved.value === '') {
      throw new MediaError(`凭证 ${route.apiKeyEnv} 没有配置——可在 DSH 设置里填，或设成同名环境变量`)
    }
    return resolved.value
  }

  /** 设置服务，缺了就当「没有可用路线」。 */
  private settings(): SettingsFace | undefined {
    const face = this.ctx.get('settings') as SettingsFace | undefined
    return face !== undefined && typeof face.describe === 'function' ? face : undefined
  }

  /** 凭证服务，缺了就当「密钥解不出来」。 */
  private credentials(): CredentialsFace | undefined {
    const face = this.ctx.get('credentials') as CredentialsFace | undefined
    return face !== undefined && typeof face.resolve === 'function' ? face : undefined
  }

  private async postJson(url: string, body: unknown, key: string, signal?: AbortSignal): Promise<unknown> {
    return this.send(url, 'POST', body, bearerAuth(key), signal)
  }

  private async getJson(url: string, key: string, signal?: AbortSignal): Promise<unknown> {
    return this.send(url, 'GET', undefined, bearerAuth(key), signal)
  }

  /**
   * 一次**豆包语音**往返。
   *
   * 与 {@link postJson} 只差两件事，而两件都是硬性的：鉴权头是 `X-Api-Key`（不是 Bearer），
   * 每个请求要带一个 `X-Api-Request-Id`（服务端用它串日志，出问题时客服会问你要它）。
   *
   * 失败时补一句**为什么这个 401 与别处的 401 不同**：同一个部署里，方舟的 key 与语音的
   * key 是两套，而两边都叫「API Key」。不点破，用户会拿方舟那把 key 反复重试。
   */
  private async postSpeech(
    url: string,
    body: unknown,
    key: string,
    route: MediaRoute,
    signal?: AbortSignal,
  ): Promise<unknown> {
    try {
      return await this.send(url, 'POST', body, {
        'x-api-key': key,
        'x-api-request-id': randomUUID(),
      }, signal)
    } catch (error) {
      throw speechFailure(error, url, route)
    }
  }

  /**
   * 一次 JSON 往返。
   *
   * 非 2xx 也把**响应体**读出来带上：方舟的错误就写在体里（`{"error":{"message":…}}`），
   * 只报状态码会让「这一版模型不支持这个 resolution」变成一句无从下手的 `HTTP 400`。
   *
   * 请求头由调用方给：图片与视频是 `Authorization: Bearer`，音频是语音那套 `X-Api-Key`。
   * 把鉴权写死在这里，等于让「这条通路属于哪个服务体系」这件事只能有一个答案。
   */
  private async send(
    url: string,
    method: string,
    body: unknown,
    headers: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new MediaError(`请求 ${url} 失败（HTTP ${String(response.status)}）：${excerpt(text)}`)
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new MediaError(`请求 ${url} 的响应不是 JSON：${excerpt(text)}`)
    }
  }

  /** 把成片/图片的字节取回来。地址是**签名的临时链接**，所以必须在拿到它的当场就下。 */
  private async download(url: string, signal?: AbortSignal): Promise<Uint8Array> {
    const response = await fetch(url, signal === undefined ? {} : { signal })
    if (!response.ok) {
      throw new MediaError(`下载产物失败（HTTP ${String(response.status)}）：${url}`)
    }
    return new Uint8Array(await response.arrayBuffer())
  }

  /**
   * 把参考图变成服务端取得到的地址。
   *
   * 三种输入，三种处理，**没有第四种**：
   *
   * - `http(s)://…` 原样给出（用户自己发布过的链接）；
   * - `data:…` 原样给出（调用方已经内联好了）；
   * - 其余**当作项目相对路径**，读字节、拼成 `data:` URL。
   *
   * 第三种是本机唯一现实的路：Ark 是拿着地址自己去下载的，一个 `/Users/…` 在它那边
   * 等于 404；而把卡片产物发到公网需要部署有发布能力。两个生成接口都明确接受 data URL，
   * 于是「引用一张本地图片」不需要任何外部条件。
   *
   * 上限按文档写（单张 < 30 MB，视频那条请求体 ≤ 64 MB）：超了就在这里报，别让服务端
   * 回一句笼统的失败——base64 膨胀之后请求体会更大，而错误里不会告诉你「是你那张图太大」。
   */
  private async referenceUrl(
    referencePath: string | undefined,
    root: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const value = referencePath?.trim() ?? ''
    if (value === '') return undefined
    if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value

    const target = await this.ctx.fs.resolve(value, { cwd: root, signal })
    const path = this.ctx.fs.processPath(target)
    const bytes = await readFile(path)
    if (bytes.byteLength > REFERENCE_MAX_BYTES) {
      throw new MediaError(
        `参考图 ${value} 有 ${Math.round(bytes.byteLength / 1024 / 1024)}MB，超过服务端允许的 30MB——请先压小这张图`,
      )
    }
    const mime = mediaMimeOf(extname(path).slice(1).toLowerCase()) ?? 'application/octet-stream'
    return `data:${mime};base64,${bytes.toString('base64')}`
  }

  /**
   * 把一个产物文件写到项目目录里。
   *
   * 路径仍由 fs 缝解析（它知道沙箱根、也知道这个部署的执行世界在哪儿），字节交给 OS：
   * `processPath` 给的就是「另一个 OS 能力能打开的那个绝对路径」。
   */
  private async save(root: string, file: string, bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
    const target = await this.ctx.fs.resolve(file, { cwd: root, signal })
    const path = this.ctx.fs.processPath(target)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
    return path
  }
}

/**
 * 参考图的字节上限，与文档一致：单张图片 < 30 MB（视频那条请求体还要 ≤ 64 MB）。
 *
 * 常量放在这里而不是做成配置项：它是**服务端的硬约束**，不是用户的偏好。做成可调的，
 * 只会让人把它调大，然后收到一句看不出原因的失败。
 */
const REFERENCE_MAX_BYTES = 30 * 1024 * 1024

/**
 * 产物路径声明的图片格式，用来对齐服务端的 `output_format`。
 *
 * 只有 `png` / `jpeg` 两种：那是 Ark 认的值，也是这个插件会落的那两种。别的扩展名
 * （webp / avif…）不表态——让服务端用它自己的默认，比自己猜一个它不认的名字好。
 */
function imageFormatOf(file: string): string | undefined {
  const extension = extname(file).slice(1).toLowerCase()
  if (extension === 'png') return 'png'
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg'
  return undefined
}

/** 方舟那两个接口的鉴权头。 */
function bearerAuth(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` }
}

/**
 * 语音接口的失败，该多说一句的时候就说。
 *
 * 只有 401 / 403 值得补话，而且补的是**具体的下一步**：语音的 API Key 在另一个控制台，
 * 与方舟那把不是同一个东西。普通的 400（格式不支持、prompt 太长）原样带出去——那时服务端
 * 说的就是全部有用的信息，插件再补一句只会把它埋起来。
 */
function speechFailure(error: unknown, url: string, route: MediaRoute): MediaError {
  const message = error instanceof Error ? error.message : String(error)
  const own = error instanceof MediaError ? error : new MediaError(message)
  if (!/HTTP 40[13]/.test(message)) return own
  const env = route.apiKeyEnv === '' ? '（这条路线没声明 apiKeyEnv）' : route.apiKeyEnv
  return new MediaError(
    `${message}——音频走的是豆包语音（${url}），鉴权头是 X-Api-Key，与方舟的 Bearer 不是同一个密钥体系。` +
      `请在 DSH 模型配置里给音频单独一条路线，把 apiKeyEnv 指向语音控制台的 API Key（路线「${route.route}」现在解的是 ${env}）。`,
  )
}

/** 把一段响应文本收敛到能进错误消息的长度。 */
function excerpt(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > 500 ? `${collapsed.slice(0, 500)}…` : collapsed
}

/** 可取消的等待。 */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new MediaError('已取消'))
    }
    if (signal?.aborted === true) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}
