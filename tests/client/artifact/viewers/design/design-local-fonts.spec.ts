/**
 * 面板那张「本机字体」清单（v1.89）。
 *
 * 这里判的是**数据形状与缓存规矩**，不是请求本身：路由那头由 `tests/host/fonts.spec.ts` 盯。
 * 三件容易错的事都钉住：
 * - 宿主回什么都别让坏行流进下拉框（数组里混进一个 `null` 就把整份清单废掉）；
 * - 内置的两支**必须**始终在（它们是唯一保证画得出来的兜底）；
 * - 问不到时**不留档**：宿主可能只是还没起来，下次打开面板要能再问一次。
 *
 * 每个判据都**动态 import** 一份新模块：清单是模块级缓存，共用同一个实例的话，上一条判据
 * 问到的结果会让下一条判据永远看不到请求——那就成了「看起来在验缓存，其实什么都没跑」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalFontFamily } from '../../../../../src/client/artifact/viewers/design/design-local-fonts.ts'

async function fonts() {
  return import('../../../../../src/client/artifact/viewers/design/design-local-fonts.ts')
}

/** 一份假响应：只带这个模块真读的那几个成员。 */
function fakeFetch(body: unknown, ok = true): { fetch: typeof fetch; calls: number } {
  const state = { calls: 0 }
  const impl = async (): Promise<Response> => {
    state.calls += 1
    return { ok, json: async () => body } as unknown as Response
  }
  return {
    fetch: impl as unknown as typeof fetch,
    get calls() {
      return state.calls
    },
  }
}

beforeEach(() => {
  vi.resetModules()
})

describe('parseFontCatalog', () => {
  it('只认形状对得上的行：坏行丢掉，好行照常留下', async () => {
    const catalog = (await fonts()).parseFontCatalog({
      families: [
        { family: 'PingFang SC', weights: [400, 500] },
        null,
        { family: '', weights: [400] },
        { family: 42 },
        { family: 'Helvetica' },
        { family: 'PingFang SC', weights: [400] },
      ],
    })
    expect(catalog.families).toEqual([
      { family: 'PingFang SC', weights: [400, 500] },
      // 没报字重的族退回 Regular：面板因此只显示一个档，而不是一排选不中的档。
      { family: 'Helvetica', weights: [400] },
    ])
    // 没写 `pending` 就当扫完了：宁可少问一次，也别让面板无限轮询。
    expect(catalog.pending).toBe(false)
  })

  it('字重去重并升序；非数字的字重被滤掉', async () => {
    const clean = (await fonts()).parseFontCatalog({
      families: [{ family: 'Arial', weights: [700, 400, 400, 'x', null] }],
      pending: true,
    })
    expect(clean.families).toEqual([{ family: 'Arial', weights: [400, 700] }])
    expect(clean.pending).toBe(true)
  })

  it('body 不是那个形状就回空清单（不抛）', async () => {
    const module = await fonts()
    expect(module.parseFontCatalog(null)).toEqual({ families: [], pending: false })
    expect(module.parseFontCatalog({})).toEqual({ families: [], pending: false })
    expect(module.parseFontCatalog({ families: 'nope' })).toEqual({ families: [], pending: false })
  })
})

describe('buildFontFamilyOptions', () => {
  const local: LocalFontFamily[] = [
    { family: 'Helvetica', weights: [400, 700] },
    { family: 'PingFang SC', weights: [400] },
  ]

  it('内置两支在前（一定画得出来的兜底），本机的按原顺序排在后', async () => {
    const options = (await fonts()).buildFontFamilyOptions('Inter', local)
    expect(options.slice(0, 2).map((option) => option.value)).toEqual(['Inter', 'Noto Sans SC'])
    expect(options.slice(2).map((option) => option.value)).toEqual(['Helvetica', 'PingFang SC'])
  })

  it('本机清单里与内置重名的族不重复列（大小写不同也算重名）', async () => {
    const options = (await fonts()).buildFontFamilyOptions('Inter', [{ family: 'inter', weights: [400] }])
    expect(options.filter((option) => option.value.toLowerCase() === 'inter')).toHaveLength(1)
  })

  it('当前值不在清单里时也要列出来，并标明本机没装', async () => {
    const options = (await fonts()).buildFontFamilyOptions('Georgia', local)
    expect(options.at(-1)).toEqual({ value: 'Georgia', label: 'Georgia（本机未安装）' })
  })

  it('当前值是本机族时不再补一条', async () => {
    const options = (await fonts()).buildFontFamilyOptions('Helvetica', local)
    expect(options.filter((option) => option.value === 'Helvetica')).toHaveLength(1)
  })
})

describe('weightsForFamily', () => {
  const local: LocalFontFamily[] = [{ family: 'PingFang SC', weights: [400, 500, 600] }]

  it('本机的族按宿主报的档；内置的按内置表', async () => {
    const module = await fonts()
    expect(module.weightsForFamily('PingFang SC', local)).toEqual([400, 500, 600])
    expect(module.weightsForFamily('Inter', local)).toEqual([400, 500, 600, 700])
  })

  it('都不认识就只给 Regular（面板据此不显示字重下拉）', async () => {
    expect((await fonts()).weightsForFamily('Comic Sans MS', local)).toEqual([400])
  })

  it('大小写不影响命中', async () => {
    expect((await fonts()).weightsForFamily('pingfang sc', local)).toEqual([400, 500, 600])
  })
})

describe('loadLocalFontFamilies', () => {
  const fast = { firstWaitMs: 0, intervalMs: 0, rounds: 3 }

  it('问到一次就够：宿主说扫完了就不再问', async () => {
    const module = await fonts()
    const fake = fakeFetch({ families: [{ family: 'Helvetica', weights: [400] }], pending: false })
    const first = await module.loadLocalFontFamilies(fake.fetch, fast)
    const second = await module.loadLocalFontFamilies(fake.fetch, fast)
    expect(first).toEqual([{ family: 'Helvetica', weights: [400] }])
    expect(second).toEqual(first)
    expect(fake.calls).toBe(1)
  })

  it('清单分批长出来：`pending` 期间每批都通知订阅者，扫完就停', async () => {
    const module = await fonts()
    const seen: string[][] = []
    module.subscribeLocalFontFamilies((families) => seen.push(families.map((entry) => entry.family)))
    const bodies = [
      { families: [{ family: 'Helvetica' }], pending: true },
      { families: [{ family: 'Helvetica' }, { family: 'PingFang SC' }], pending: true },
      { families: [{ family: 'Helvetica' }, { family: 'PingFang SC' }], pending: false },
    ]
    let call = 0
    const impl = (async () => ({
      ok: true,
      json: async () => bodies[Math.min(call++, 2)],
    })) as unknown as typeof fetch
    const final = await module.loadLocalFontFamilies(impl, fast)
    expect(final.map((entry) => entry.family)).toEqual(['Helvetica', 'PingFang SC'])
    expect(seen).toEqual([['Helvetica'], ['Helvetica', 'PingFang SC'], ['Helvetica', 'PingFang SC']])
    expect(call).toBe(3)
  })

  it('后台回得乱了也不后退：短的那份不会覆盖长的', async () => {
    const module = await fonts()
    const bodies = [
      { families: [{ family: 'A' }, { family: 'B' }], pending: true },
      { families: [{ family: 'A' }], pending: false },
    ]
    let call = 0
    const impl = (async () => ({
      ok: true,
      json: async () => bodies[Math.min(call++, 1)],
    })) as unknown as typeof fetch
    const final = await module.loadLocalFontFamilies(impl, fast)
    expect(final.map((entry) => entry.family)).toEqual(['A', 'B'])
  })

  it('问不到回已有那份，且**不留档**：下一次会再问', async () => {
    const module = await fonts()
    let attempts = 0
    const failing = (async () => {
      attempts += 1
      throw new Error('host not ready')
    }) as unknown as typeof fetch
    expect(await module.loadLocalFontFamilies(failing, fast)).toEqual([])
    expect(await module.loadLocalFontFamilies(failing, fast)).toEqual([])
    expect(attempts).toBe(2)
  })

  it('HTTP 不成功也不留档', async () => {
    const module = await fonts()
    const fake = fakeFetch({ families: [] }, false)
    expect(await module.loadLocalFontFamilies(fake.fetch, fast)).toEqual([])
    await module.loadLocalFontFamilies(fake.fetch, fast)
    expect(fake.calls).toBe(2)
  })

  it('并发的调用共用同一趟（面板重挂时会同时问）', async () => {
    const module = await fonts()
    const fake = fakeFetch({ families: [{ family: 'Arial', weights: [400] }], pending: false })
    const [first, second] = await Promise.all([
      module.loadLocalFontFamilies(fake.fetch, fast),
      module.loadLocalFontFamilies(fake.fetch, fast),
    ])
    expect(first).toEqual(second)
    expect(fake.calls).toBe(1)
  })

  it('问的时候把「最多等多久」带上（宿主据此决定等不等后台）', async () => {
    const module = await fonts()
    const urls: string[] = []
    const impl = (async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return { ok: true, json: async () => ({ families: [], pending: false }) }
    }) as unknown as typeof fetch
    await module.loadLocalFontFamilies(impl, { firstWaitMs: 600, intervalMs: 0, rounds: 1 })
    expect(urls[0]).toContain('/dsh-canvas/fonts/list?wait=600')
  })

  it('一次都没问到过时快照是 null，问到之后是那一份', async () => {
    const module = await fonts()
    expect(module.localFontFamiliesSnapshot()).toBeNull()
    await module.loadLocalFontFamilies(fakeFetch({ families: [{ family: 'Arial' }], pending: false }).fetch, fast)
    expect(module.localFontFamiliesSnapshot()).toEqual([{ family: 'Arial', weights: [400] }])
  })
})
