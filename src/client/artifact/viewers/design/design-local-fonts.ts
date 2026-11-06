/**
 * dsh-canvas — 面板里那张「本机装的字体」清单（F2.6，v1.89）。
 *
 * 与引擎那半的分工：这条模块**不碰引擎**（不 import `@open-pencil/core`——那会把场景图的类
 * 拉进 client.js，类身份立刻变两份）。它只做三件事：问宿主要一张族名清单、缓存住、转成
 * 下拉框的选项与字重档。
 *
 * 为什么要问宿主：浏览器里没有「这台机器装了哪些字体」这个能力（`queryLocalFonts()` 在
 * webview 里不存在，就算有也要用户点一次授权）。宿主能读盘，所以清单从 `/dsh-canvas/fonts`
 * 那条路由来——和预览器取字面字节是**同一条路由的两个口子**。
 *
 * **清单是分批长出来的**（v1.89 实测的代价）：宿主那边开一个字体文件约 40ms（安全扫描拦在
 * `open` 上，`stat` 只要 0.06ms），扫完 789 个文件要半分钟。所以第一趟最多等 600ms，宿主
 * 回 `pending: true` 就隔 1.5 秒再问，每问一次多一批——用户先看到十来支常用族，再慢慢补全，
 * 而不是对着空下拉框等半分钟。**取字面不等这条清单**（宿主那边按文件名预筛，40–240ms 一张）。
 */
import { TEXT_FAMILIES } from '../../../../core/artifact/design/node-props.ts'
import { FONT_LIST_URL } from '../../../../core/font/route.ts'

/** 一个本机族：名字 + 它真有的字重（面板的字重下拉按这个列）。 */
export interface LocalFontFamily {
  family: string
  weights: number[]
}

/** 一次清单请求的答案：`pending` 说明宿主还在后台扫，过一会儿会有更多。 */
export interface LocalFontCatalog {
  families: LocalFontFamily[]
  pending: boolean
}

/** 轮询的节奏：第一趟多等一会儿（省一次往返），之后每 1.5 秒问一次，最多问 40 次（约一分钟）。 */
const FIRST_WAIT_MS = 600
const POLL_INTERVAL_MS = 1500
const MAX_ROUNDS = 40

let snapshot: LocalFontFamily[] = []
/** 宿主说「扫完了」：之后不再发请求。 */
let complete = false
let inflight: Promise<LocalFontFamily[]> | undefined
const listeners = new Set<(families: LocalFontFamily[]) => void>()

/** 已经知道的清单；一次都没问到过是 `null`（面板据此区分「没有本地字体」与「还不知道」）。 */
export function localFontFamiliesSnapshot(): LocalFontFamily[] | null {
  return snapshot.length === 0 && !complete ? null : snapshot
}

export function subscribeLocalFontFamilies(listener: (families: LocalFontFamily[]) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function publish(families: LocalFontFamily[]): void {
  for (const listener of listeners) listener(families)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 只认形状对得上的行：宿主回什么都影响不了画布，但坏数据不该流进下拉框。 */
export function parseFontCatalog(body: unknown): LocalFontCatalog {
  if (typeof body !== 'object' || body === null) return { families: [], pending: false }
  const families = (body as { families?: unknown }).families
  const pending = (body as { pending?: unknown }).pending === true
  if (!Array.isArray(families)) return { families: [], pending }
  const out: LocalFontFamily[] = []
  const seen = new Set<string>()
  for (const row of families) {
    if (typeof row !== 'object' || row === null) continue
    const family = (row as { family?: unknown }).family
    if (typeof family !== 'string' || family.trim() === '') continue
    const key = family.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const weights = (row as { weights?: unknown }).weights
    const list = Array.isArray(weights)
      ? weights.filter((weight): weight is number => typeof weight === 'number' && Number.isFinite(weight))
      : []
    out.push({ family: family.trim(), weights: list.length > 0 ? [...new Set(list)].sort((a, b) => a - b) : [400] })
  }
  return { families: out, pending }
}

async function fetchCatalog(fetchImpl: typeof fetch, waitMs: number): Promise<LocalFontCatalog | null> {
  try {
    const response = await fetchImpl(`${FONT_LIST_URL}?wait=${Math.max(0, Math.round(waitMs))}`)
    if (!response.ok) return null
    return parseFontCatalog(await response.json())
  } catch {
    return null
  }
}

/**
 * 问到宿主说「扫完了」为止，每一批都**立刻**告诉订阅者。
 *
 * 失败（宿主没起来、路由还没挂上）**不留档**：这一轮就此打住，下次打开面板再问——把
 * 「暂时问不到」记成「没有本地字体」，会让这一页从此只剩 Inter。
 */
export function loadLocalFontFamilies(
  fetchImpl: typeof fetch = fetch,
  options: { firstWaitMs?: number; intervalMs?: number; rounds?: number } = {},
): Promise<LocalFontFamily[]> {
  if (complete) return Promise.resolve(snapshot)
  if (inflight !== undefined) return inflight
  const firstWaitMs = options.firstWaitMs ?? FIRST_WAIT_MS
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS
  const rounds = options.rounds ?? MAX_ROUNDS
  inflight = (async () => {
    for (let round = 0; round < rounds; round += 1) {
      const catalog = await fetchCatalog(fetchImpl, round === 0 ? firstWaitMs : 0)
      if (catalog === null) return snapshot
      // 只前进不后退：后台扫是单调的，但两趟响应可能乱序回来（第二趟先到）；拿短的那份
      // 覆盖长的会让下拉框里的族「消失又出现」。
      if (catalog.families.length >= snapshot.length) {
        snapshot = catalog.families
        publish(snapshot)
      }
      if (!catalog.pending) {
        complete = true
        return snapshot
      }
      if (round + 1 < rounds) await delay(intervalMs)
    }
    return snapshot
  })().finally(() => {
    inflight = undefined
  })
  return inflight
}

/**
 * 字体下拉的选项：内置的两支在前（它们是**一定画得出来**的兜底），本机的按名字排在后。
 *
 * 当前值不在任何一份清单里时也要列出来（标「本机未安装」）：文档写着一支这台机器没有的
 * 字体时，若这一格显示空着，用户既看不出真值，也分不清「字体丢了」与「控件坏了」。
 */
export function buildFontFamilyOptions(
  current: string,
  local: readonly LocalFontFamily[],
): { value: string; label: string }[] {
  const options = TEXT_FAMILIES.map((family) => ({ value: family.id, label: family.label }))
  const known = new Set(options.map((option) => option.value.toLowerCase()))
  for (const family of local) {
    const key = family.family.toLowerCase()
    if (known.has(key)) continue
    known.add(key)
    options.push({ value: family.family, label: family.family })
  }
  const wanted = current.trim()
  if (wanted !== '' && !known.has(wanted.toLowerCase())) {
    options.push({ value: current, label: `${current}（本机未安装）` })
  }
  return options
}

/**
 * 某支字面真有的字重档：内置的按 `TEXT_FAMILIES`，本机的按宿主报的那份。
 *
 * 认不出来的族退回 `[400]`——面板因此只会列出一个档（不显示下拉），而不是列一排选不中的档。
 */
export function weightsForFamily(family: string, local: readonly LocalFontFamily[]): readonly number[] {
  const hit = local.find((entry) => entry.family.toLowerCase() === family.trim().toLowerCase())
  if (hit !== undefined && hit.weights.length > 0) return hit.weights
  const builtin = TEXT_FAMILIES.find((entry) => entry.id.toLowerCase() === family.trim().toLowerCase())
  return builtin?.weights ?? [400]
}
