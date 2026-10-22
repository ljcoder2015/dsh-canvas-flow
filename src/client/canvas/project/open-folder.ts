/**
 * dsh-canvas — 「把这张画布的目录交给系统文件管理器」这一条路（F1.5 修订）。
 *
 * 走的是宿主的**「在应用中打开」路由**（`/open-in-app/*`，见
 * `@deepseek-ai/dsh-host-open-in-app` 的 shared）：宿主自己那套探测（哪个应用在这台
 * 机器上真的存在、按平台过滤）已经做好了，插件再走一遍 `spawn` 是重复劳动，也没有
 * 必要自己判断当前是 macOS 还是 Windows。
 *
 * 代价是这条路由**可能不存在**（裸组合、没装 `dsh-host-open-in-app` 的部署），所以
 * 那是一次探测：探测不到就报出「没有可用的文件管理器」，由调用点把那一整行动作藏掉
 * ——而不是给出一枚点下去只会报错的按钮。
 *
 * 单独一个模块、不碰任何宿主 UI 原语，理由与 `row-actions.ts` 同：这一层是纯策略与
 * 一条 HTTP 通道，单测可以直接跑它。
 */

/** 宿主「在应用中打开」路由（见 `@deepseek-ai/dsh-host-open-in-app` 的 shared）。 */
const OPEN_IN_APP_APPS = '/open-in-app/apps'
const OPEN_IN_APP_OPEN = '/open-in-app/open'

/**
 * 「文件管理器」在各平台的目录标识。
 *
 * 宿主只报出与自己平台相符的那一个（darwin/finder、win32/explorer、linux/
 * filemanager），所以这里是一位候选表而不是一张平台表——插件不需要知道自己是
 * 跑在哪个系统上，问宿主要答案比猜平台稳。
 */
export const FILE_MANAGER_APPS = ['finder', 'explorer', 'filemanager'] as const

/**
 * 这份可用应用清单里的文件管理器；一个都没有时返回空串。
 *
 * 空串是「这台部署打不开目录」（路由不在、或系统里连 xdg-open 都没有），调用点
 * 据此把「打开画布目录」整条藏掉。
 *
 * @param apps - 宿主报出的可用应用标识。
 * @returns 可用的文件管理器标识，没有则 `''`。
 */
export function fileManagerOf(apps: readonly string[]): string {
  return FILE_MANAGER_APPS.find((id) => apps.includes(id)) ?? ''
}

/**
 * 页面的基准地址。
 *
 * 与宿主自己的客户端同一条规矩：来自 `file:` 之类的嵌入上下文里 `origin` 是字符串
 * `"null"`，那时 `new URL('/open-in-app/apps', 'null')` 会抛错，所以退到一个固定的
 * 主机名——这条路径只在嵌入场景里走，相对地址在那里本来也没有意义。
 */
function hostBase(): string {
  const origin = globalThis.location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

/** 本页读到过的可用应用；探测在宿主侧要跑一遍应用定位，每页读一次就够。 */
let applications: Promise<readonly string[]> | undefined

/** 宿主这台机器上可用的应用标识（读不到时是空表，不是异常）。 */
export function availableApps(): Promise<readonly string[]> {
  applications ??= fetch(new URL(OPEN_IN_APP_APPS, hostBase()), { headers: { accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : undefined))
    .then((payload: unknown) => {
      const apps = (payload as { apps?: unknown } | undefined)?.apps
      return Array.isArray(apps) ? apps.filter((id): id is string => typeof id === 'string') : []
    })
    // 探测失败与「一个都没装」在调用点是一件事：没有可用的应用。
    .catch((): readonly string[] => [])
  return applications
}

/**
 * 在一个应用里打开一个目录。
 *
 * 失败时抛出宿主给的那句话（目录不存在、应用启动失败都是它说的，插件编不出更准
 * 的），调用点把它放进错误行。
 *
 * @param app - 宿主报出的应用标识（这里总是文件管理器）。
 * @param path - 要在那个应用里打开的目录。
 */
export async function openInApp(app: string, path: string): Promise<void> {
  const response = await fetch(new URL(OPEN_IN_APP_OPEN, hostBase()), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app, path }),
  })
  if (response.ok) return
  const payload = (await response.json().catch(() => undefined)) as { message?: unknown } | undefined
  throw new Error(typeof payload?.message === 'string' ? payload.message : `HTTP ${String(response.status)}`)
}
