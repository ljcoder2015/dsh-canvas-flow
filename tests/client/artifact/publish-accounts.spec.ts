/**
 * 平台账号绑定的数据层判据（v1.95：一平台多账号）。
 *
 * localStorage 里存的是用户手边可改的字符串，所以这里最重要的一族判据是
 * 「**坏形状一律当作没绑过**」：不是 throw，是交回空表——绑定功能坏了自己，
 * 不能连累发布页。另有两条这一版新增的纪律：**同平台多账号**（id 唯一）与
 * **v1 旧键的读时迁移**。
 */
import { describe, expect, it } from 'vitest'
import {
  accountById,
  accountsOf,
  addAccount,
  bindAccount,
  loadAccounts,
  maskCredential,
  removeAccount,
  saveAccounts,
  updateAccount,
  type PublishAccount,
} from '../../../src/client/artifact/publish/accounts.ts'

const KEY = 'dsh-canvas.publish.accounts.v2'
const LEGACY = 'dsh-canvas.publish.accounts.v1'

/** 内存 Storage：只实现判据用得到的两个面。 */
function fakeStorage(initial: Record<string, string> = {}): Storage & { written: Map<string, string>; removed: Set<string> } {
  const written = new Map<string, string>()
  const removed = new Set<string>()
  const store = {
    getItem: (key: string) => (key in initial ? initial[key]! : written.get(key) ?? null),
    setItem: (key: string, value: string) => {
      written.set(key, value)
      removed.delete(key)
    },
    removeItem: (key: string) => {
      written.delete(key)
      removed.add(key)
    },
  }
  return Object.assign(store, { written, removed }) as never
}

const wechat: PublishAccount = {
  id: 'wechat-1700000000000',
  platformId: 'wechat',
  name: '主号',
  credential: 'sess=abc123; uin=oX987',
  boundAt: 1_700_000_000_000,
}

const wechat2: PublishAccount = {
  id: 'wechat-1700000000001',
  platformId: 'wechat',
  name: '矩阵 2',
  credential: 'sess=def456',
  boundAt: 1_700_000_000_001,
}

describe('loadAccounts：坏形状一律当作没绑过', () => {
  it('空存储、null、坏 JSON、非数组都交回空表', () => {
    expect(loadAccounts(fakeStorage())).toEqual([])
    expect(loadAccounts(fakeStorage({ [KEY]: 'null' }))).toEqual([])
    expect(loadAccounts(fakeStorage({ [KEY]: '{oops' }))).toEqual([])
    expect(loadAccounts(fakeStorage({ [KEY]: '{"id":"wechat-1"}' }))).toEqual([])
  })

  it('合格的记录收进来；字段缺一不可', () => {
    const raw = JSON.stringify([
      wechat,
      { ...wechat, id: 'x1', name: '' },
      { ...wechat, id: 'x2', credential: '' },
      { ...wechat, id: 'x3', boundAt: 'yesterday' },
      { ...wechat, id: 'x4', platformId: 'no-such-platform' },
      { ...wechat, id: '' },
      'a bare string',
      null,
    ])
    expect(loadAccounts(fakeStorage({ [KEY]: raw }))).toEqual([wechat])
  })

  it('同平台可以有多条（这一版的核心变化）', () => {
    const raw = JSON.stringify([wechat, wechat2])
    const accounts = loadAccounts(fakeStorage({ [KEY]: raw }))
    expect(accountsOf(accounts, 'wechat').map((account) => account.name)).toEqual(['主号', '矩阵 2'])
  })

  it('同 id 重复只认第一条', () => {
    const raw = JSON.stringify([wechat, { ...wechat, name: '后写的' }])
    expect(loadAccounts(fakeStorage({ [KEY]: raw })).map((account) => account.name)).toEqual(['主号'])
  })

  it('v2 没写过时读 v1 的旧形状，并按 <平台>-<时间> 补 id', () => {
    const legacy = JSON.stringify([{ platformId: 'wechat', name: '旧号', credential: 'ck', boundAt: 123 }])
    const accounts = loadAccounts(fakeStorage({ [LEGACY]: legacy }))
    expect(accounts).toEqual([{ id: 'wechat-123', platformId: 'wechat', name: '旧号', credential: 'ck', boundAt: 123 }])
  })

  it('v2 存在时不再看 v1（迁移只发生一次）', () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify([wechat]), [LEGACY]: JSON.stringify([{ platformId: 'wechat', name: '旧号', credential: 'ck', boundAt: 123 }]) })
    expect(loadAccounts(storage)).toEqual([wechat])
  })
})

describe('saveAccounts / addAccount / updateAccount / removeAccount', () => {
  it('保存成 JSON，读回相等', () => {
    const storage = fakeStorage()
    saveAccounts(storage, [wechat])
    expect(storage.written.get(KEY)).toContain('主号')
    expect(loadAccounts(storage)).toEqual([wechat])
  })

  it('空表删除 v2 键，不留空壳，也不碰 v1 键', () => {
    const storage = fakeStorage({ [KEY]: '[]', [LEGACY]: '[]' })
    saveAccounts(storage, [])
    expect(storage.removed.has(KEY)).toBe(true)
    expect(storage.removed.has(LEGACY)).toBe(false)
  })

  it('addAccount 铸 id 并 trim；同毫秒连加两个不撞 id', () => {
    const first = addAccount([], { platformId: 'wechat', name: ' 主号 ', credential: ' ck ' }, 1000)
    expect(first[0]).toEqual({ id: 'wechat-1000', platformId: 'wechat', name: '主号', credential: 'ck', boundAt: 1000 })
    const second = addAccount(first, { platformId: 'wechat', name: '二号', credential: 'ck2' }, 1000)
    expect(second.map((account) => account.id)).toEqual(['wechat-1000', 'wechat-1000-2'])
  })

  it('addAccount 拒绝空白与未知平台', () => {
    expect(addAccount([], { platformId: 'wechat', name: ' ', credential: 'ck' }, 1)).toEqual([])
    expect(addAccount([], { platformId: 'wechat', name: 'n', credential: '' }, 1)).toEqual([])
    expect(addAccount([], { platformId: 'no-such', name: 'n', credential: 'ck' }, 1)).toEqual([])
  })

  it('updateAccount 改备注与凭证、不动 id 与绑定时间', () => {
    const next = updateAccount([wechat], wechat.id, { name: ' 新名 ', credential: ' token9 ' })
    expect(next[0]).toEqual({ ...wechat, name: '新名', credential: 'token9' })
  })

  it('updateAccount 空白即拒绝（清空不是可表达的动作）', () => {
    expect(updateAccount([wechat], wechat.id, { name: ' ', credential: 'x' })).toEqual([wechat])
    expect(updateAccount([wechat], wechat.id, { name: 'n', credential: '' })).toEqual([wechat])
  })

  it('removeAccount 只摘目标 id，同平台另一个还在', () => {
    expect(removeAccount([wechat, wechat2], wechat.id)).toEqual([wechat2])
    expect(removeAccount([wechat], 'ghost')).toEqual([wechat])
  })

  it('accountById / accountsOf', () => {
    expect(accountById([wechat, wechat2], wechat2.id)).toEqual(wechat2)
    expect(accountById([wechat], 'ghost')).toBeUndefined()
    expect(accountsOf([wechat, wechat2], 'wechat')).toHaveLength(2)
    expect(accountsOf([wechat], 'zhihu')).toEqual([])
  })
})

describe('bindAccount：真实绑定的落表动作（v1.97）', () => {
  it('真凭证原样入表；账号名按「账号N」顺延；id 照 addAccount 的规矩铸', () => {
    const next = bindAccount([], 'wechat', 'sess=abc123; uin=oX987', 1000)
    expect(next).toHaveLength(1)
    const account = next[0]!
    expect(account.platformId).toBe('wechat')
    expect(account.name).toBe('账号1')
    expect(account.credential).toBe('sess=abc123; uin=oX987')
    expect(account.boundAt).toBe(1000)
    expect(account.id).toBe('wechat-1000')
  })

  it('同平台连绑序号顺延；同毫秒连绑 id 不撞', () => {
    const first = bindAccount([], 'wechat', 'a=1', 1000)
    const second = bindAccount(first, 'wechat', 'a=2', 1000)
    expect(second.map((account) => account.name)).toEqual(['账号1', '账号2'])
    expect(new Set(second.map((account) => account.id)).size).toBe(2)
  })

  it('空凭证（没抓到登录态）与未知平台都原表回', () => {
    expect(bindAccount([], 'wechat', '   ', 1)).toEqual([])
    expect(bindAccount([], 'no-such', 'a=1', 1)).toEqual([])
  })
})

describe('maskCredential：界面永不回显原文', () => {
  it('长的露头尾各 4 位', () => {
    const masked = maskCredential('abcdefghijklmnop')
    expect(masked).toBe('abcd••••mnop')
    expect(masked).not.toContain('efghijk')
  })

  it('短的整串打点', () => {
    expect(maskCredential('token')).toBe('•••••')
    expect(maskCredential('12345678')).toBe('••••••••')
    expect(maskCredential('')).toBe('')
  })
})
