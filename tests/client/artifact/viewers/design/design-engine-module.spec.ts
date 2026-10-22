/**
 * 设计引擎 chunk 的加载器：**取不到是一回事，取回来「不是那一份」是另一回事**（v1.59）。
 *
 * 这一组判据的来处是一次真机事故：资产路由从前回 `max-age=31536000, immutable`，而 chunk
 * 的名字跨构建不变 ⇒ 浏览器把旧 chunk 存满一年，新的客户端去调 `designExport`，而那个函数
 * 在旧 chunk 里根本不存在，用户看到的是 `n.designExport is not a function`。
 *
 * 于是这里有**两道防线**，判据各钉一道：
 *  - `assetUrl` 上那一格 `?v=`：旧策略发出去的条目根本不会被用上（`describe('assetUrl')`）；
 *  - 形状校验 + 换一个全新 URL 重取一次：任何一层再犯一次，也只是一条降级路，不是一句
 *    `is not a function`（`describe('designEngineOf')` 与 `loadDesignEngineFrom`）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { designEngineOf, loadDesignEngineFrom, type ModuleImporter } from '../../../../../src/client/artifact/viewers/design/design-engine-module.ts'
import { ASSET_BASE, assetUrl, withParam } from '../../../../../src/client/artifact/viewers/design/design-canvaskit.ts'

/** 一份「对得上」的 chunk（两个函数都在，就是这一版客户端要的那一份）。 */
const good = {
  createDesignEngine: async (): Promise<never> => ({}) as never,
  designExport: async (): Promise<never> => ({}) as never,
}

/** 一份旧 chunk：只有渲染器那个出口（v1.58 及以前的样子）。 */
const stale = { createDesignEngine: async (): Promise<never> => ({}) as never }

/**
 * 资产 URL 那一格 `?v=`：它**不是版本号**，是换一格缓存键。
 *
 * 这一组是这次事故的第一道防线，也是判据里唯一钉得住那个字面量的地方：旧策略
 * （`immutable` + 一年）发出去的响应在浏览器里再也不会回来问服务器，只有换 URL 才绕得开。
 */
describe('assetUrl', () => {
  it('每一份资产都挂上那一格，并且只有一处拼 URL', () => {
    expect(assetUrl('design-engine.js')).toBe(`${ASSET_BASE}/design-engine.js?v=2`)
    expect(assetUrl('canvaskit.wasm')).toBe(`${ASSET_BASE}/canvaskit.wasm?v=2`)
    expect(assetUrl('export-worker.ts')).toContain('?v=2')
  })

  it('再挂参数时 `&` 与 `?` 自己认得出来', () => {
    expect(withParam('/a/b.js', 't=1')).toBe('/a/b.js?t=1')
    expect(withParam('/a/b.js?v=2', 't=1')).toBe('/a/b.js?v=2&t=1')
  })

  it('没有第二处拼资产 URL（`${ASSET_BASE}/` 只许出现在资产模块自己里）', () => {
    // 这一条在钉「一处说了算」：谁再手拼一条 `${ASSET_BASE}/…`，那一份就又回到旧策略发出
    // 去的缓存条目上，事故原样复现——而它不会报错，只会悄悄加载一份旧的。
    // 递归扫：设计那一支住在 `viewers/design/` 里，平扫会静默漏掉它们（这条判据的价值
    // 就在「一处说了算」，漏一层等于没这一条）。
    const here = new URL('../../../../../src/client/artifact/viewers/', import.meta.url)
    const offenders = readdirSync(here, { recursive: true })
      .map((name) => String(name))
      .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
      .filter((name) => !name.endsWith('design-canvaskit.ts'))
      .filter((name) => readFileSync(new URL(name, here), 'utf8').includes('${ASSET_BASE}/'))
    expect(offenders).toEqual([])
  })
})

describe('designEngineOf', () => {
  it('两个出口都在才算数', () => {
    expect(designEngineOf(good)).toBe(good)
  })

  it('少一个出口就不是这一份（旧 chunk、半份资产、混版部署都落在这里）', () => {
    expect(designEngineOf(stale)).toBeNull()
    expect(designEngineOf({ designExport: good.designExport })).toBeNull()
  })

  it('不是模块的东西也不许当模块用', () => {
    expect(designEngineOf(null)).toBeNull()
    expect(designEngineOf(undefined)).toBeNull()
    expect(designEngineOf('createDesignEngine')).toBeNull()
    expect(designEngineOf({ createDesignEngine: 1, designExport: 2 })).toBeNull()
  })
})

describe('loadDesignEngineFrom', () => {
  const url = 'https://host/plugin/assets/design-engine.js'

  /** 一个记下每一次 URL 的假取回器：按顺序吐给定的几份东西。 */
  function scripted(answers: readonly unknown[]) {
    const urls: string[] = []
    const importer: ModuleImporter = async (target) => {
      urls.push(target)
      const answer = answers[urls.length - 1]
      if (answer instanceof Error) throw answer
      return answer
    }
    return { importer, urls }
  }

  it('第一份就对得上：只取一次，URL 原样（拿的是 assetUrl 给的那一条）', async () => {
    const { importer, urls } = scripted([good])
    expect(await loadDesignEngineFrom(importer, url, 42)).toBe(good)
    expect(urls).toEqual([url])
  })

  it('第一份是旧 chunk：换一个带时间戳的 URL 再取一次，拿到真的那一份', async () => {
    const { importer, urls } = scripted([stale, good])
    expect(await loadDesignEngineFrom(importer, url, 42)).toBe(good)
    expect(urls).toEqual([url, `${url}?t=42`])
  })

  it('绕一次仍不对：认输（`null`），不抓着一个没有的函数往下走', async () => {
    const { importer, urls } = scripted([stale, stale])
    expect(await loadDesignEngineFrom(importer, url, 42)).toBeNull()
    // 只绕一次：第三次请求解决不了「这台机器上的资产不对劲」。
    expect(urls).toHaveLength(2)
  })

  it('取回来的路上就炸了（404、语法错、路由不认）：也走同一条路，不抛出去', async () => {
    const { importer, urls } = scripted([new Error('404'), good])
    expect(await loadDesignEngineFrom(importer, url, 42)).toBe(good)
    expect(urls).toEqual([url, `${url}?t=42`])

    const both = scripted([new Error('404'), new Error('404')])
    expect(await loadDesignEngineFrom(both.importer, url, 42)).toBeNull()
  })

  it('默认那一条真的挂着 `?v=`（不会有人偷偷绕过 assetUrl 去取 chunk）', async () => {
    const urls: string[] = []
    const importer: ModuleImporter = async (target) => {
      urls.push(target)
      return good
    }
    await loadDesignEngineFrom(importer)
    expect(urls).toEqual([assetUrl('design-engine.js')])
    expect(urls[0]).toContain('?v=')
  })
})
