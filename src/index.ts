/**
 * dsh-canvas — Host plugin entry.
 *
 * The Node half opens the canvas storage domain, starts the two Remote
 * services, registers the agent tools and the prompt contributions, and
 * publishes the Typert manifest so the model layer can see the services.
 *
 * Registration order matters in one place only: the domain is opened *before*
 * either runtime is constructed, because a runtime's constructor registers a
 * Cordis service whose lifetime must be covered by a live domain.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { CANVAS_DOMAIN } from './domain.ts'
import { ArtifactIo } from './core/artifact/io/artifact-io.ts'
import { SessionManager } from './core/session/session-manager.ts'
import { ModelRouting, modelFaces } from './core/session/model-routing.ts'
import { CanvasRuntime } from './host/runtime/canvas-runtime.ts'
import { CardRuntime } from './host/runtime/card-runtime.ts'
import { BoardFile } from './host/runtime/board-file.ts'
import { registerTools } from './host/tools.ts'
import { registerAssetRoute } from './host/assets.ts'
import { registerGlobalPrompt, PLUGIN_ID } from './host/prompt.ts'
import { MediaProvider } from './host/media-provider.ts'
import { mergeCapabilities, resolveCapabilities } from './capabilities.ts'
import { TYPERT_MANIFEST } from './typert.ts'
import { PACKAGE_NAME } from './contract.ts'
import type { ResolvedConfig, UpstreamPolicy } from './types.ts'

/**
 * Cordis plugin name. Must match `package.json` `name` and `cordis.patch.yml`
 * (the module specifier that row loads). `PLUGIN_ID` stays the short label the
 * logs, prompt sections and error prefixes use — that is a different thing.
 */
export const name = PACKAGE_NAME

/** Services required before anything here can run. */
export const inject = ['typert', 'tools', 'fs', 'sessions', 'agents', 'storageDomain', 'systemPrompt']

/** Plugin configuration. Keys are overridable from `cordis.patch.yml`. */
export interface Config {
  /** Directory the folder picker opens at. Empty means the user's home directory. */
  pickerRoot: string
  /** Horizontal gap used when arranging cards, in canvas px. */
  arrangeGap: number
  /** Character budget of one artifact digest injected into a card session. */
  summaryBudget: number
  /**
   * How many hops the **chain view** resolves (F4.7).
   *
   * Only the graph view is configurable: what a card may read as material is
   * one hop by rule (`core/canvas/source-store.ts` `materialUpstreams`), not by
   * configuration.
   */
  sourceDepth: number
  /** What happens to a downstream card's session when its material changes (F5.7). */
  upstreamPolicy: UpstreamPolicy
  /**
   * 媒体生成走哪条 provider 路线（F2.7）。
   *
   * 留空即**自动按模型族找**：在所有 provider 路线里找模型名含 `seedream` 的当图片、
   * 含 `seedance` 的当视频、含 `tts` 的当音频。三个空着就能覆盖绝大多数部署——用户往
   * DSH 模型配置里加一条 doubao 路线，这里什么都不用改。
   *
   * 要显式指定的场合只有一种：**两条路线都带同一族的模型**，自动挑会挑错那条。那时在这里
   * 写上路线键（`providers` 字典的键），压过自动挑选。
   */
  mediaImageRoute: string
  mediaVideoRoute: string
  mediaAudioRoute: string
  /**
   * 视频任务的轮询间隔与总超时，毫秒。
   *
   * 两个都不是小数字，因为它们量的东西就是慢的：一条 5 秒 1080p 的片子在一两分钟量级，
   * 而调小超时不会让它变快，只会把「还在跑」读成失败。
   */
  mediaPollMs: number
  mediaTimeoutMs: number
}

/** Configuration schema with defaults, validated at plugin load. */
// 显式标注为 Schema<Partial<Config>, Config>：留空时推断类型的泛型会引用依赖树里
// 另一份 schemastery 副本（.pnpm 路径），declaration 模式下 tsc 无法可移植地命名它
// （TS2883）。第一位是调用入参（字段全有默认值，允许整包省略），第二位是校验产出。
export const Config: z<Partial<Config>, Config> = z.object({
  pickerRoot: z.string().default(''),
  arrangeGap: z.number().min(8).max(400).default(88),
  summaryBudget: z.number().min(200).max(200_000).default(4000),
  sourceDepth: z.number().min(1).max(16).default(3),
  upstreamPolicy: z.union(['silent', 'notify', 'pull']).default('notify'),
  mediaImageRoute: z.string().default(''),
  mediaVideoRoute: z.string().default(''),
  mediaAudioRoute: z.string().default(''),
  mediaPollMs: z.number().min(500).max(60_000).default(5000),
  mediaTimeoutMs: z.number().min(10_000).max(3_600_000).default(900_000),
})

/**
 * Resolve the validated config into the shape the runtimes consume.
 *
 * The picker's default root is the user's home rather than the process
 * working directory: a canvas project is something the user chooses from their
 * own files, and a browser started in an unrelated directory would otherwise
 * open the picker somewhere meaningless.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    pickerRoot: config.pickerRoot.trim() === '' ? (process.env['HOME'] ?? process.cwd()) : config.pickerRoot,
    arrangeGap: config.arrangeGap,
    summaryBudget: config.summaryBudget,
    sourceDepth: config.sourceDepth,
    upstreamPolicy: config.upstreamPolicy,
  }
}

/** Start the canvas: domain, runtimes, tools, prompt, manifest. */
export async function apply(ctx: Context, config?: Config): Promise<void> {
  // 校验产出留一份：`ResolvedConfig` 是运行时要的那几个字段的投影，而媒体那几个可调项
  // 只被 `MediaProvider` 一个人读——为它们再扩一次 `ResolvedConfig` 会让那份类型多出
  // 五个只有一处消费者的字段。
  const validated = Config(config ?? {}) as Config
  const resolved = resolveConfig(validated)

  const domain = await ctx.storageDomain.open(CANVAS_DOMAIN)
  ctx.effect(() => () => domain.close(), `${PLUGIN_ID}: storage domain`)

  const io = new ArtifactIo(ctx)
  const sessions = new SessionManager(ctx)
  // Card conversations are created by this plugin rather than by the session
  // controller, so the model policy they normally inherit is read once here and
  // applied to every agent this plugin opens (`core/model-routing.ts`).
  const routing = new ModelRouting(modelFaces(ctx))
  // 媒体生成的**默认实现**（F2.7）：按 DSH 自己的模型配置去调即梦（方舟）。它读设置与
  // 凭证两条服务，所以是 host 侧的东西——`core/media/` 那两个模块只有纯逻辑。
  // 装配时才合并（下面 `mergeCapabilities`）：部署实现了哪几条就用哪几条，缺的由它补。
  const media = new MediaProvider(ctx, {
    imageRoute: validated.mediaImageRoute,
    videoRoute: validated.mediaVideoRoute,
    audioRoute: validated.mediaAudioRoute,
    pollMs: validated.mediaPollMs,
    timeoutMs: validated.mediaTimeoutMs,
  })
  // 板面文件（F1.9/F1.10）：目录自己带一份可迁移的板面投影。两个 Remote 服务都要写它
  // （canvas 管座次与关系、card 管上下卡），所以共用一件实例——它自带「内容没变就不写」
  // 的记忆，分成两件会让同一次改动写两遍。
  const board = new BoardFile({
    domain,
    io,
    log: (message, error) => ctx.logger(PLUGIN_ID).warn(message, error),
  })

  const canvas = new CanvasRuntime(ctx, {
    domain,
    io,
    sessions,
    board,
    arrangeGap: resolved.arrangeGap,
    sourceDepth: resolved.sourceDepth,
    pickerRoot: resolved.pickerRoot,
  })
  const card = new CardRuntime(ctx, {
    domain,
    io,
    sessions,
    board,
    summaryBudget: resolved.summaryBudget,
    upstreamPolicy: resolved.upstreamPolicy,
    routing,
    capabilities: mergeCapabilities(resolveCapabilities(ctx), media.capabilities()),
  })

  registerTools(ctx, { domain, canvas, card, sessions })
  registerGlobalPrompt(ctx)
  // Runtime assets for the design previewer (CanvasKit WASM, fonts) — a no-op
  // on deployments without an HTTP surface.
  registerAssetRoute(ctx)

  ctx.effect(() => {
    const dispose = ctx.typert.register(TYPERT_MANIFEST)
    return () => {
      void dispose()
    }
  }, `${PLUGIN_ID}: typert manifest`)

  // Card conversations are owned by this fiber; unloading the plugin must
  // release them before the domain closes, so the durable logs stay on disk
  // while their live agents stop.
  ctx.effect(() => () => {
    void sessions.releaseAll()
  }, `${PLUGIN_ID}: card sessions`)
}
