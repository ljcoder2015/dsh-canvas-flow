/**
 * The node-type model memory: which key a card is filed under, that a stale
 * catalog entry never resurfaces, and that a browser without storage degrades
 * to "no memory" instead of breaking the composer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nodeTypeOf, recallModel, rememberModel, selectionOf } from '../../../src/client/wire/model-memory.ts'
import type { ModelCatalog } from '../../../src/client/wire/bridge.ts'
import type { BoardCard, CardSummary } from '../../../src/types.ts'

/** A minimal in-memory stand-in for `window.localStorage`. */
function installStorage(): void {
  const entries = new Map<string, string>()
  const store = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
  }
  vi.stubGlobal('window', { localStorage: store })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const catalog: ModelCatalog = {
  default: { provider: 'deepseek', model: 'chat' },
  groups: [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reasoner', name: 'Reasoner' }] },
    { id: 'anthropic', name: 'Anthropic', models: [] },
  ],
}

/** 同一份目录，外加一条 doubao 路线：生成模型与对话模型混在一起——真实部署的样子。 */
const withMedia: ModelCatalog = {
  default: { provider: 'deepseek', model: 'chat' },
  groups: [
    ...catalog.groups,
    {
      id: 'doubao',
      name: 'doubao',
      models: [
        { id: 'doubao-seedance-2-0-mini', name: 'Seedance' },
        { id: 'doubao-seedream-5-0-pro-260628', name: 'Seedream pro' },
        { id: 'doubao-seed-1-6-250615', name: 'Seed 1.6' },
      ],
    },
  ],
}

/** A card with only the fields the memory reads. */
function card(kind: string): BoardCard {
  return {
    id: 'untitled.md',
    file: 'untitled.md',
    name: 'untitled',
    project: 'p',
    kind,
    kindLabel: kind,
    position: { x: 0, y: 0 },
    sessionId: 's-1',
    missing: false,
  }
}

/** A digest with only the kind read. */
function summary(kind: string): CardSummary {
  return { cardId: 'untitled.md', kind, path: '/p/untitled.md', summary: '', outline: [], head: '', bytes: 0, updatedAt: 0 }
}

describe('node-type model memory', () => {
  it('files a card under its recognized kind, falling back to the seated one', () => {
    expect(nodeTypeOf(card('markdown'), summary('app'))).toBe('app')
    expect(nodeTypeOf(card('markdown'), undefined)).toBe('markdown')
    // A digest whose kind came back empty must not blank the key.
    expect(nodeTypeOf(card('image'), summary(''))).toBe('image')
  })

  it('carries a pick from one node type to the next, and only for that type', () => {
    installStorage()
    rememberModel('markdown', { provider: 'deepseek', model: 'reasoner' })
    expect(recallModel('markdown', catalog)).toEqual({ provider: 'deepseek', model: 'reasoner' })
    expect(recallModel('image', catalog)).toBeUndefined()
  })

  it('ignores a remembered model the current catalog no longer offers', () => {
    installStorage()
    rememberModel('markdown', { provider: 'deepseek', model: 'retired' })
    expect(recallModel('markdown', catalog)).toBeUndefined()

    rememberModel('markdown', { provider: 'removed-provider', model: 'chat' })
    expect(recallModel('markdown', catalog)).toBeUndefined()
  })

  it('needs a catalog to verify against, so an unavailable one recalls nothing', () => {
    installStorage()
    rememberModel('markdown', { provider: 'deepseek', model: 'chat' })
    expect(recallModel('markdown', undefined)).toBeUndefined()
  })

  /**
   * 记忆是**菜单之外的第二条通路**（v1.73）。
   *
   * 菜单上的过滤只在用户点选那一刻生效；而 v1.73 之前媒体模型本来就在菜单里，用户点过
   * 一次就写下了一条记忆（按节点类型）。补种那一步读的正是这条记忆——不过滤的话，新建的
   * 视频卡就会继承一个视频生成模型，下一次请求 400，而症状（报错）与原因（一条几天前
   * 写下的记忆）隔着十万八千里。同一条判据要在两条通路上都成立。
   */
  it('never recalls a media-generation model for a conversation card', () => {
    installStorage()
    rememberModel('video', { provider: 'doubao', model: 'doubao-seedance-2-0-mini' })
    expect(recallModel('video', withMedia)).toBeUndefined()
    // 同一路线里真正的对话模型照旧召得回来：判据不是「带媒体模型的路线一律作废」。
    rememberModel('video', { provider: 'doubao', model: 'doubao-seed-1-6-250615' })
    expect(recallModel('video', withMedia)).toEqual({ provider: 'doubao', model: 'doubao-seed-1-6-250615' })
  })

  /**
   * 媒体卡读的是同一条记忆，但**只认生成模型**（v1.76）。
   *
   * 用户在一张图片卡上选了 pro，下一张图片卡默认还该是 pro——那是「按类型记住」这件事
   * 在媒体这一侧的意义。反过来，一条给对话卡写下的记忆（`seed-1-6`）不能被图片卡继承：
   * 那会让图片卡拿着一个不能出图的模型去生成。
   *
   * 两个方向都要判：只判一个方向的话，「两边都接受」那种写法（`isMediaModel(...) || true`
   * 之类）会一路绿着，而它的症状是图片卡永远在用一个对话模型出图。
   */
  it('recalls a generation model for a media card, and only that', () => {
    installStorage()
    rememberModel('image', { provider: 'doubao', model: 'doubao-seedream-5-0-pro-260628' })
    // 同一个 key，按对话卡的语义读：不认（那是生成模型）。
    expect(recallModel('image', withMedia)).toBeUndefined()
    // 按媒体卡的语义读：认。
    expect(recallModel('image', withMedia, { media: true })).toEqual({
      provider: 'doubao',
      model: 'doubao-seedream-5-0-pro-260628',
    })

    // 反过来：一条对话模型的记忆不能被图片卡继承。
    rememberModel('image', { provider: 'doubao', model: 'doubao-seed-1-6-250615' })
    expect(recallModel('image', withMedia, { media: true })).toBeUndefined()
    expect(recallModel('image', withMedia)).toEqual({ provider: 'doubao', model: 'doubao-seed-1-6-250615' })
  })

  it('treats unreadable storage as "no memory" rather than failing', () => {
    installStorage()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => '{ not json',
        setItem: () => {
          throw new Error('quota exceeded')
        },
      },
    })
    expect(recallModel('markdown', catalog)).toBeUndefined()
    expect(() => rememberModel('markdown', { provider: 'deepseek', model: 'chat' })).not.toThrow()
  })

  it('reads the pending selection first, then what the last request used', () => {
    expect(selectionOf(undefined)).toBeUndefined()
    expect(selectionOf({ lastUsed: null, next: null })).toBeUndefined()
    expect(selectionOf({ lastUsed: { provider: 'deepseek', model: 'chat' }, next: null })).toEqual({
      provider: 'deepseek',
      model: 'chat',
    })
    expect(
      selectionOf({
        lastUsed: { provider: 'deepseek', model: 'chat' },
        next: { provider: 'deepseek', model: 'reasoner' },
      }),
    ).toEqual({ provider: 'deepseek', model: 'reasoner' })
  })
})
