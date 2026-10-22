/**
 * 卡面素材的取用方式（F2.7 / `card-shot.ts` 与 `card-media.ts` 共用）。
 *
 * 这是一段**没有界面**的逻辑，但它决定了画布上同时能有多少张卡在吃内存，所以三条
 * 行为都要钉住：同键单飞、满员淘汰最老、淘汰**不取消**已经交出去的请求。
 *
 * 它从 `card-shot.ts` 里搬出来并泛型化，是因为媒体卡面也要用它——同一件事写两遍，
 * 早晚有一遍先被改（本项目第三次撞这类「一个东西两个来源」）。搬家后判据也跟着有了
 * 落点：原先它只能靠设计卡截图那条路间接跑到。
 */
import { describe, expect, it } from 'vitest'
import { cachedFetch } from '../../../../src/client/canvas/asset/asset-cache.ts'

/** 一个记账用的取数器：记下每次**真的**发起请求的键。 */
function recorder() {
  const calls: string[] = []
  const fetchOf = (cache: Map<string, Promise<string>>, max: number) => (key: string) =>
    cachedFetch(cache, key, max, () => {
      calls.push(key)
      return Promise.resolve(`${key}!`)
    })
  return { calls, fetchOf }
}

describe('card assets: 单飞', () => {
  it('同一把键在飞的时候只发一次请求', async () => {
    const { calls, fetchOf } = recorder()
    const cache = new Map<string, Promise<string>>()
    const fetch = fetchOf(cache, 4)

    const [a, b] = await Promise.all([fetch('card@10'), fetch('card@10')])

    expect(calls).toEqual(['card@10'])
    expect(a).toBe('card@10!')
    expect(b).toBe('card@10!')
  })

  it('不同的键各发各的——键里带着 bytes，文件被重写就会重新读', async () => {
    const { calls, fetchOf } = recorder()
    const fetch = fetchOf(new Map<string, Promise<string>>(), 4)

    await Promise.all([fetch('card@10'), fetch('card@20')])

    expect(calls).toEqual(['card@10', 'card@20'])
  })
})

describe('card assets: 有界', () => {
  it('满员后淘汰最早进入的那一条，而不是无限攒着', async () => {
    const { calls, fetchOf } = recorder()
    const fetch = fetchOf(new Map<string, Promise<string>>(), 2)

    await Promise.all([fetch('a@1'), fetch('b@1'), fetch('c@1')])
    // a 是第一个被挤出去的：再要它必须重新发起。
    await fetch('a@1')
    await fetch('c@1')

    expect(calls).toEqual(['a@1', 'b@1', 'c@1', 'a@1'])
  })

  it('淘汰不会取消已经交出去的那次请求', async () => {
    // 缓存表与飞行中的 Promise 是两件事：那个 Promise 已经交给调用方了，它照旧解析出
    // 自己的值；只是结果不再被后来的调用者复用。取消是调用方的事（各 hook 的 cancelled）。
    let release: ((value: string) => void) | undefined
    const slow = new Promise<string>((resolve) => {
      release = resolve
    })
    const cache = new Map<string, Promise<string>>()
    const inflight = cachedFetch(cache, 'big@9', 1, () => slow)

    // 挤掉它，再把缓存腾空。
    await cachedFetch(cache, 'other@1', 1, () => Promise.resolve('x'))

    release?.('still here')
    await expect(inflight).resolves.toBe('still here')
  })
})
