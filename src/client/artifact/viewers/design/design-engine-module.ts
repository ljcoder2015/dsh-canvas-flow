/**
 * dsh-canvas — 设计引擎 chunk 的加载器（**只此一份**）。
 *
 * `lib/assets/design-engine.js` 是按 URL 动态 import 的一份 ESM chunk（为什么非得分两半
 * 见 `design-engine.ts` 开头那两条理由）。这个加载器的存在只为三件事：
 *
 * 1. **单飞**：几次调用共用同一次 fetch。浏览器自己有模块缓存，但那是它的事；这里要的是
 *    「不重复发起、失败也只有一个结果」这个语义。
 * 2. **失败即 `null`**：chunk 取不到（资产没发布、路由不认）是一条降级路径，不是异常——
 *    预览器退成报错面板、导出退成「这次没导成」。
 * 3. **形状不对也算取不到**（v1.59 补）：拿回来的东西里没有我们这版客户端要的那两个函数，
 *    那就是**另一份 chunk**，不是这一份。从前这里是一句盲目的类型断言，于是这件事要到调用
 *    那一刻才以一句 `n.designExport is not a function` 现身——那句话对用户没有任何下一步。
 *
 * 它原先躲在预览器里（`design-viewer.tsx` 的两行）。导出也要用同一份 chunk 之后就必须
 * 挪出来：**两份加载器 = 两份「加载失败怎么办」**，而这两个调用点对失败的处理恰恰不同
 * （一个要报错面板，一个要一句提示）。加载这件事让这里管，怎么处理各自决定。
 */
import { assetUrl, withParam } from './design-canvaskit.ts'
import type {
  CreateDesignEngineArgs,
  DesignExportOutcome,
  DesignExportRequest,
  EngineOutcome,
} from './design-engine-types.ts'

/** 那份 chunk 的文件名（`lib/assets/design-engine.js`，build 第三步）。 */
const ENGINE_CHUNK = 'design-engine.js'

/** The engine chunk's shape — the module is loaded by URL, typed here. */
export interface DesignEngineModule {
  createDesignEngine(args: CreateDesignEngineArgs): Promise<EngineOutcome>
  designExport(request: DesignExportRequest): Promise<DesignExportOutcome>
}

/** 按 URL 取一份模块。抽成接缝是为了能在 node 里判「形状不对会怎样」。 */
export type ModuleImporter = (url: string) => Promise<unknown>

const importByUrl: ModuleImporter = (url) => import(url)

/**
 * 取回来的东西**对得上形状才算数**。
 *
 * 两个函数都要有：预览器要 `createDesignEngine`、导出要 `designExport`，而它们出自同一份
 * chunk（同一次构建）——只有一个是「这一份 chunk 跟这版客户端不是一回事」，与「取不到」
 * 走同一条降级路。
 */
export function designEngineOf(module: unknown): DesignEngineModule | null {
  if (typeof module !== 'object' || module === null) return null
  const candidate = module as Partial<DesignEngineModule>
  const shaped =
    typeof candidate.createDesignEngine === 'function' && typeof candidate.designExport === 'function'
  return shaped ? (candidate as DesignEngineModule) : null
}

/**
 * 取一次；形状不对就**换一个全新的 URL 再取一次**。
 *
 * 这是**第二道**防线。第一道在 `assetUrl`：取资产一律挂着那一格 `?v=`，于是旧策略
 * （`immutable` + 一年）发出去的那些条目根本不会被用上——那才是真机那次
 * `n.designExport is not a function` 的正解。这一道留在这里，是因为「缓存里躺着一份不是
 * 我们的 chunk」这件事**任何一层都可能再犯一次**（谁少写一个 `assetUrl`、策略以后再改），
 * 而加载失败的正确收场是一条降级路，不是一句 `is not a function`。
 *
 * 只绕一次：再不对说明这台机器上的资产确实不对劲，照实降级（`null`），让调用方去说
 * 「这次没导成」。
 */
export async function loadDesignEngineFrom(
  importer: ModuleImporter = importByUrl,
  url: string = assetUrl(ENGINE_CHUNK),
  stamp: number = Date.now(),
): Promise<DesignEngineModule | null> {
  const first = designEngineOf(await attempt(importer, url))
  if (first !== null) return first
  return designEngineOf(await attempt(importer, withParam(url, `t=${stamp}`)))
}

/** 取一次；抛异常（404、语法错、路由不认）一律当成「没取到」。 */
async function attempt(importer: ModuleImporter, url: string): Promise<unknown> {
  try {
    return await importer(url)
  } catch {
    return null
  }
}

/** Single-flight module load by URL; `null` when the chunk cannot be fetched. */
let engineModule: Promise<DesignEngineModule | null> | undefined

export function loadDesignEngine(): Promise<DesignEngineModule | null> {
  engineModule ??= loadDesignEngineFrom()
  return engineModule
}
