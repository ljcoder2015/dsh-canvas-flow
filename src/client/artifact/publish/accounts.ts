/**
 * dsh-canvas — 平台账号绑定（v1.95：一个平台可绑多个账号）。
 *
 * 「绑定」在这里意味着：给某个平台留一份**本机的**登录凭证（Cookie / Token）
 * 与一个备注名。v1.94 是「一平台一号」，这一版放开成**账号池**：同一个人常常
 * 主号与矩阵号一起发，绑定表于是按**账号 id** 索引，平台只是它的一列。
 *
 * 存储位是**浏览器 localStorage**，是刻意选的：凭证是设备本地的敏感数据——
 * 不进产物目录（画布文件可能被分享）、不进宿主的存储域（`~/.dsh` 会被备份与
 * 同步）、不上传任何地方。换浏览器 / 清数据 = 解绑，这是「本机凭证」的正确语义。
 *
 * 键带版本号（`.v2`）：v1 的「一平台一条」读得出来（每条补一个 id），第一次
 * 保存就落成 v2——**迁移发生在读**，不写回旧键、不做原地改写。
 *
 * 读写都收一个 `Storage` 参数而不是直接摸 `window.localStorage`：纯函数才进
 * 得了 node 判据（`tests/client/artifact/publish-accounts.spec.ts`），UI 传入
 * 真存储。**读进来的每一份都不可信**——localStorage 用户可以随手改，坏形状
 * 一律当作没绑过，绝不抛错卡住发布页。
 */
import { PUBLISH_PLATFORMS } from './platforms.ts'

/** 一个平台的绑定记录。 */
export interface PublishAccount {
  /** 账号 id（同一平台可有多个），`<platformId>-<boundAt>`，加号时保证唯一。 */
  readonly id: string
  /** 平台 id，必须是 `PUBLISH_PLATFORMS` 里的一个。 */
  readonly platformId: string
  /** 账号备注名（用户起给多账号池用的可读名，如「主号」「矩阵 2」）。 */
  readonly name: string
  /** 登录凭证：Cookie 或 Token，原样保存（本机明文，界面只回显掩码）。 */
  readonly credential: string
  /** 绑定时间戳。 */
  readonly boundAt: number
}

/** 新增账号时用户填的那两格（id 与时间戳由 `addAccount` 铸）。 */
export interface PublishAccountDraft {
  readonly platformId: string
  readonly name: string
  readonly credential: string
}

/** localStorage 键。带版本号：形状变了换键，v1 由 `loadAccounts` 顺带迁移。 */
const STORAGE_KEY = 'dsh-canvas.publish.accounts.v2'

/** v1.94 的键：一平台一条、没有 id 字段。只读不写。 */
const LEGACY_KEY = 'dsh-canvas.publish.accounts.v1'

/** 平台存在吗（注册表是平台 id 的唯一真源）。 */
function knownPlatform(platformId: string): boolean {
  return PUBLISH_PLATFORMS.some((platform) => platform.id === platformId)
}

/** 最小形状守卫：够格当一份绑定记录才收。 */
function isAccount(value: unknown): value is PublishAccount {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' && record.id !== '' &&
    typeof record.platformId === 'string' && knownPlatform(record.platformId) &&
    typeof record.name === 'string' && record.name.trim() !== '' &&
    typeof record.credential === 'string' && record.credential.trim() !== '' &&
    typeof record.boundAt === 'number' && Number.isFinite(record.boundAt)
  )
}

/** 读一条原始 JSON 串；坏的、空的、非数组一律交回 `undefined`。 */
function parseList(raw: string | null): readonly unknown[] | undefined {
  if (raw === null) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  return Array.isArray(parsed) ? parsed : undefined
}

/** v1 的一条旧记录：没有 id，按 `<platformId>-<boundAt>` 补一个。 */
function upgradeLegacy(value: unknown): PublishAccount | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const candidate = {
    id: `${String(record.platformId)}-${String(record.boundAt)}`,
    platformId: record.platformId,
    name: record.name,
    credential: record.credential,
    boundAt: record.boundAt,
  }
  return isAccount(candidate) ? candidate : undefined
}

/** 读全部账号。存储空的、坏的、被手改过的——一律交回空表，不抛。 */
export function loadAccounts(storage: Pick<Storage, 'getItem'>): readonly PublishAccount[] {
  let raw: string | null
  let legacy: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
    legacy = storage.getItem(LEGACY_KEY)
  } catch {
    return []
  }
  const fresh = parseList(raw)
  if (fresh !== undefined) return dedupe(fresh.filter(isAccount))
  // v2 还没写过：读 v1 的形状，顺手迁移（下一次保存自然落成 v2）。
  const old = parseList(legacy)
  if (old === undefined) return []
  return dedupe(old.map(upgradeLegacy).filter((entry): entry is PublishAccount => entry !== undefined))
}

/** 同 id 只认第一条：写入端保证唯一，读端只是兜底不放大。 */
function dedupe(accounts: readonly PublishAccount[]): readonly PublishAccount[] {
  const seen = new Set<string>()
  return accounts.filter((account) => {
    if (seen.has(account.id)) return false
    seen.add(account.id)
    return true
  })
}

/** 写全部账号。空表删除 v2 键，不留空壳（v1 键不碰）。 */
export function saveAccounts(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  accounts: readonly PublishAccount[],
): void {
  const unique = dedupe(accounts)
  try {
    if (unique.length === 0) storage.removeItem(STORAGE_KEY)
    else storage.setItem(STORAGE_KEY, JSON.stringify(unique))
  } catch {
    // 配额满 / 隐私模式拒绝写入：绑定功能静默失效，不拦住发布本身。
  }
}

/** 某平台下的全部账号（绑定顺序即加入顺序）。 */
export function accountsOf(
  accounts: readonly PublishAccount[],
  platformId: string,
): readonly PublishAccount[] {
  return accounts.filter((account) => account.platformId === platformId)
}

/** 按 id 找账号；没有交回 `undefined`。 */
export function accountById(
  accounts: readonly PublishAccount[],
  id: string,
): PublishAccount | undefined {
  return accounts.find((account) => account.id === id)
}

/**
 * 往账号池里加一个。备注名与凭证空白即拒绝（原表原样回）；未知平台拒绝。
 *
 * id 由 `<platformId>-<now>` 铸：同一毫秒里连加两个会撞，撞了就顺延 `-2`、`-3`
 * ——**id 的唯一性是写入端的责任**，读端那份去重只是兜底。
 */
export function addAccount(
  accounts: readonly PublishAccount[],
  draft: PublishAccountDraft,
  now: number,
): readonly PublishAccount[] {
  if (draft.name.trim() === '' || draft.credential.trim() === '') return accounts
  if (!knownPlatform(draft.platformId)) return accounts
  const base = `${draft.platformId}-${now}`
  let id = base
  let suffix = 2
  while (accounts.some((account) => account.id === id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return [
    ...accounts,
    {
      id,
      platformId: draft.platformId,
      name: draft.name.trim(),
      credential: draft.credential.trim(),
      boundAt: now,
    },
  ]
}

/**
 * 真实绑定的落表动作（v1.97）：凭证来自**真实的登录抓取**（宿主经 CDP 从登录
 * 浏览器里收到的该平台域下 Cookie，`Cookie:` 头形状），这里只负责铸账号名与 id。
 * 账号名按「账号N」顺延（同平台第几个就是几）；id 铸造复用 `addAccount`，不抄
 * 第二份。未知平台或空凭证原表回（空凭证就是没抓到，不该落一条壳）。
 */
export function bindAccount(
  accounts: readonly PublishAccount[],
  platformId: string,
  credential: string,
  now: number,
): readonly PublishAccount[] {
  const trimmed = credential.trim()
  if (!knownPlatform(platformId) || trimmed === '') return accounts
  const serial = accountsOf(accounts, platformId).length + 1
  return addAccount(accounts, { platformId, name: `账号${serial}`, credential: trimmed }, now)
}

/**
 * 改一个账号的备注与凭证（id 与绑定时间不变）。
 *
 * 空白即拒绝（原表原样回）——「清空凭证」不是一个可表达的动作，要清就解绑。
 */
export function updateAccount(
  accounts: readonly PublishAccount[],
  id: string,
  patch: { readonly name: string; readonly credential: string },
): readonly PublishAccount[] {
  if (patch.name.trim() === '' || patch.credential.trim() === '') return accounts
  return accounts.map((account) =>
    account.id === id
      ? { ...account, name: patch.name.trim(), credential: patch.credential.trim() }
      : account,
  )
}

/** 解绑一个账号（按 id）；不存在原表回。 */
export function removeAccount(accounts: readonly PublishAccount[], id: string): readonly PublishAccount[] {
  return accounts.filter((account) => account.id !== id)
}

/**
 * 凭证的展示掩码：界面永不回显原文。
 *
 * 长的露头尾各 4 位（操作者认得出是哪把钥匙），短的整串打点——短串露头尾
 * 等于没掩。空串原样回（调用方不会拿它渲染，但纯函数不假装收不到）。
 */
export function maskCredential(credential: string): string {
  if (credential === '') return ''
  if (credential.length <= 8) return '•'.repeat(credential.length)
  return `${credential.slice(0, 4)}••••${credential.slice(-4)}`
}
