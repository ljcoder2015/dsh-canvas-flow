/**
 * dsh-canvas — deployment capabilities the plugin does not own.
 *
 * Three product features cannot be implemented from the packages the harness
 * base actually ships: rendering an artifact to PDF/PPTX/PNG, publishing it to
 * a subdomain, and generating an image. They are deployment concerns — the
 * backend that can rasterise a page and the one that can publish a site live
 * outside this plugin — so the plugin declares the *shape* of the capability
 * and looks it up at runtime instead of inventing a fake implementation.
 *
 * This is an honest seam, not a stub: when nothing provides it, the operation
 * fails with `card/unsupported` and a reason the UI can show, and the moment a
 * deployment (or a sibling plugin) provides it under
 * {@link CAPABILITIES_SERVICE_KEY}, every code path starts working with no
 * change to the wire contract or the tools.
 *
 * ## 三条生成缝与那个「默认实现」（F2.7）
 *
 * 图片 / 视频 / 音频这三条，这个插件**自己有**一份默认实现
 * （`host/media-provider.ts`）。它不违反上面那段：媒体模型在哪儿、用哪个密钥，已经是
 * 这个部署自己的声明（DSH 模型配置的 `providers` 字典 + `ctx.credentials`），所以
 * 「按部署已有的声明去调它」是插件做得到的，不需要另起一个后端。装配时按**成员**合并
 * （`src/index.ts`）：部署提供了哪几条就用哪几条，缺的由这份默认实现补上——于是
 * 一个自己实现了 `generateVideo` 的部署不会被插件抢走这个位置。
 *
 * 音频那一条的默认实现**只在配置里真有音频模型路线时才成立**；没有时它如实报「没有能
 * 找到音频模型的路线」，与「部署未提供该能力」是两句不同的话，各自指向不同的修法。
 * 注意它不是图片 / 视频那条通路的兄弟：`doubao-seed-audio-1-0` 的接口在豆包语音
 * （`/tts/create`、`X-Api-Key`），地址与鉴权都另成一套（见 `core/media/routes.ts` 的
 * `audioBaseURLOf`）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CardId, ExportFormat, Project, PublishResult } from './types.ts'

/** Cordis service key a deployment provides the canvas capability under. */
export const CAPABILITIES_SERVICE_KEY = 'dsh-canvas.capabilities'

/** One artifact about to be turned into another representation. */
export interface ArtifactRef {
  project: Project
  cardId: CardId
  /** Kind id resolved by the plugin's kind registry. */
  kind: string
  /** Absolute path of the artifact in the deployment's execution world. */
  path: string
}

/** A request to render or archive one artifact. */
export interface ExportRequest extends ArtifactRef {
  format: ExportFormat
}

/** A request to make one artifact reachable at a URL. */
export interface PublishRequest extends ArtifactRef {
  /** Human-facing name of the card, used when the backend needs one. */
  title: string
}

/** A request to generate an image artifact. */
export interface GenerateImageRequest {
  project: Project
  /** Project-relative path the generated artifact should be written to. */
  file: string
  prompt: string
  /**
   * 参考图：项目相对路径（`图片.png`）、`https://…` 或 `data:…`。
   *
   * 三种都给得进，因为「这张图在哪」对调用方与对服务端是两件事：卡片产物是项目里的一份
   * 文件，而 Ark 取的是地址。把本地路径变成地址是提供实现那一侧的事（`media-provider.ts`
   * 读字节拼 data URL）——能力接口只负责把「用户给了哪张图」原样交下去。
   */
  referencePath?: string
  /**
   * 这张卡选定的生成模型（`doubao-seedream-5-0-pro-260628` 这种 id）。
   *
   * 空 = 没选过，交给配置里第一个对得上模型族的模型（`pickMediaRoute`）。给了就必须
   * 用这个：用户在卡片上选的是**生成模型**，替它换一个会让「我明明选了 pro」变成
   * 一句无法验证的怀疑。实现侧找不到这个 id 时应当**如实报错**，而不是悄悄回退。
   */
  model?: string
}

/**
 * A request to generate a video artifact (F2.7).
 *
 * 比例、时长、分辨率**不是**必填：它们各有服务端默认，而这里的默认值一旦写死就会
 * 变成一条硬约束（比如「时长默认 5 秒」会让每一次「生成 10 秒的片子」多绕一圈）。
 * 给定才传，不给就交给模型——调用方（卡片会话）在提示词里把用户说的那几个值说出来。
 */
export interface GenerateVideoRequest {
  project: Project
  file: string
  prompt: string
  /** `16:9` / `9:16` / `1:1` / `adaptive`. */
  ratio?: string
  /** Duration in seconds — also the cost unit, which is why it is never guessed. */
  duration?: number
  /** `480p` / `720p` / `1080p`. */
  resolution?: string
  /** 参考图（首帧 / 参考图）：项目相对路径、`https://…` 或 `data:…`。 */
  referencePath?: string
  /** 那张图在这一次生成里的角色：`first_frame`（默认）/ `last_frame` / `reference_image`。 */
  referenceRole?: string
  /** 这张卡选定的生成模型；空 = 交给配置里第一个对得上模型族的模型。 */
  model?: string
}

/**
 * A request to generate an audio artifact (F2.7).
 *
 * 字段叫 `prompt` 而不是 `text`：`doubao-seed-audio-1-0` 这一族收的是**导演指令**——
 * 一条 prompt 里可以同时有多角色对白、音效、配乐与环境声，要念的台词也只是其中一种写法。
 * 叫 `text` 会把调用方（和卡片会话里的模型）引向「朗读稿」这一种最窄的用法。
 */
export interface GenerateAudioRequest {
  project: Project
  file: string
  /** 要生成什么声音：自然语言描述，或直接是要念出来的台词。 */
  prompt: string
  /** 这张卡选定的生成模型；空 = 交给配置里第一个对得上模型族的模型。 */
  model?: string
}

/** What a deployment may provide. Every member is optional. */
export interface CanvasCapabilities {
  /** Produce one derived file and return its absolute path. */
  export?(request: ExportRequest, signal?: AbortSignal): Promise<{ path: string }>
  /** Publish one artifact and return its URL. */
  publish?(request: PublishRequest, signal?: AbortSignal): Promise<PublishResult>
  /** Generate an image and write it to `request.file`, returning its path. */
  generateImage?(request: GenerateImageRequest, signal?: AbortSignal): Promise<{ path: string }>
  /** Generate a video and write it to `request.file`, returning its path. */
  generateVideo?(request: GenerateVideoRequest, signal?: AbortSignal): Promise<{ path: string }>
  /** Generate audio and write it to `request.file`, returning its path. */
  generateAudio?(request: GenerateAudioRequest, signal?: AbortSignal): Promise<{ path: string }>
}

/**
 * Read the deployment's capabilities, if any.
 *
 * `strict: true` means only a capability whose providing fiber is currently
 * active is returned, so a plugin that loaded and then unloaded cannot leave a
 * dead backend behind — the calls correctly fall back to `card/unsupported`.
 */
export function resolveCapabilities(ctx: Context): CanvasCapabilities | undefined {
  const provided = ctx.get(CAPABILITIES_SERVICE_KEY, true) as CanvasCapabilities | undefined
  return provided
}

/**
 * 部署已有的能力与插件那份默认实现，**按成员**合并。
 *
 * 按成员而不是整包覆盖，是因为这两种情况都真实存在：一个部署可能只实现了 `export`
 * （它有渲染服务，没有媒体模型），另一个可能只实现了 `generateVideo`（它接了自家的
 * 视频后端，图片仍想用默认那条）。整包覆盖会让前者丢掉插件补的媒体能力、让后者丢掉
 * 插件补的导出——两者都不报错，只是**那些功能在那一台机器上不出现**。
 *
 * 优先级是**部署说了算**：`deployed` 有就用它，缺的那条由 `fallback` 补。反过来会让
 * 插件抢走部署明确实现过的位置，而用户升级插件时不会预期到这件事。
 *
 * 用 `??` 而不是展开，是因为「成员存在但值是 `undefined`」在 JS 里会**静默覆盖**——一份
 * 由 `{ generateImage: maybe }` 拼出来的能力对象，展开之后会把默认实现抹成 `undefined`。
 */
export function mergeCapabilities(
  deployed: CanvasCapabilities | undefined,
  fallback: CanvasCapabilities,
): CanvasCapabilities {
  const pick = <K extends keyof CanvasCapabilities>(key: K): CanvasCapabilities[K] =>
    deployed?.[key] ?? fallback[key]
  return {
    export: pick('export'),
    publish: pick('publish'),
    generateImage: pick('generateImage'),
    generateVideo: pick('generateVideo'),
    generateAudio: pick('generateAudio'),
  }
}
