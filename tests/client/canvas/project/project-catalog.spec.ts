/**
 * The project list both consumers ride on.
 *
 * The sidebar's canvas area subscribes to this with `useSyncExternalStore`,
 * which compares snapshots **by reference** — so the properties worth pinning
 * are not just "does it fetch" but "does an unchanged read hand out the same
 * array", plus the tolerance this module promises its callers: a read that
 * fails (the Remote is not mounted yet) leaves the previous list in place and
 * resolves rather than rejecting, and a re-read forced while one is in flight
 * is not swallowed by it.
 */
import { describe, expect, it } from 'vitest'
import type { Project } from '../../../../src/types.ts'
import { ProjectCatalog } from '../../../../src/client/canvas/project/project-catalog.ts'
import type { CanvasBridge } from '../../../../src/client/wire/bridge.ts'

/** A canvas project as the bridge reports one; only `id`/`name` matter here. */
function project(id: string, name: string): Project {
  return { id, name, root: `/tmp/${id}` } as Project
}

/** A bridge stand-in whose list reads are scripted per call. */
function scripted(reads: (() => Promise<readonly Project[]>)[]) {
  const calls = { count: 0 }
  const bridge = {
    listProjects: () => {
      const read = reads[Math.min(calls.count, reads.length - 1)]
      calls.count += 1
      return read()
    },
  } as unknown as CanvasBridge
  return { bridge, calls }
}

describe('ProjectCatalog', () => {
  it('starts empty and does not fetch until asked', () => {
    const { bridge, calls } = scripted([async () => [project('a', 'A')]])
    const catalog = new ProjectCatalog(bridge)
    expect(catalog.snapshot()).toEqual([])
    expect(calls.count).toBe(0)
  })

  it('hands subscribers the array and exposes the same array as its snapshot', async () => {
    const list = [project('a', 'A'), project('b', 'B')]
    const { bridge } = scripted([async () => list])
    const catalog = new ProjectCatalog(bridge)
    const seen: (readonly Project[])[] = []
    catalog.subscribe((projects) => seen.push(projects))

    await catalog.refresh()

    expect(seen).toEqual([list])
    // 引用恒等是 useSyncExternalStore 的前提：换一份拷贝就等于每渲染一次都「变了」。
    expect(catalog.snapshot()).toBe(list)
  })

  it('keeps the snapshot reference stable across reads that change nothing', async () => {
    const list = [project('a', 'A')]
    const { bridge } = scripted([async () => list, async () => list])
    const catalog = new ProjectCatalog(bridge)
    await catalog.refresh()
    const first = catalog.snapshot()
    await catalog.reload()
    expect(catalog.snapshot()).toBe(first)
  })

  it('shares a read already in flight rather than issuing a second one', async () => {
    const { bridge, calls } = scripted([async () => [project('a', 'A')]])
    const catalog = new ProjectCatalog(bridge)
    await Promise.all([catalog.refresh(), catalog.refresh()])
    expect(calls.count).toBe(1)
  })

  it('lets a forced reload supersede the read in flight', async () => {
    const first = [project('a', 'A')]
    const second = [project('a', 'A'), project('b', 'B')]
    let release: (() => void) | undefined
    const { bridge, calls } = scripted([
      () => new Promise((resolve) => { release = () => resolve(first) }),
      async () => second,
    ])
    const catalog = new ProjectCatalog(bridge)

    const slow = catalog.refresh()
    const forced = catalog.reload()
    await forced

    expect(calls.count).toBe(2)
    expect(catalog.snapshot()).toBe(second)
    release?.()
    await slow
    // 后发的那次读取赢：先发的结果不许把新列表盖回去。
    expect(catalog.snapshot()).toBe(second)
  })

  it('keeps the previous list and resolves when a read fails', async () => {
    const list = [project('a', 'A')]
    const { bridge } = scripted([
      async () => list,
      async () => { throw new Error('canvas/listProjects: remote not mounted') },
    ])
    const catalog = new ProjectCatalog(bridge)
    await catalog.refresh()
    await expect(catalog.reload()).resolves.toBeUndefined()
    expect(catalog.snapshot()).toBe(list)
  })

  it('stops notifying a listener that unsubscribed', async () => {
    const { bridge } = scripted([async () => [project('a', 'A')], async () => []])
    const catalog = new ProjectCatalog(bridge)
    const seen: number[] = []
    const off = catalog.subscribe((projects) => seen.push(projects.length))
    await catalog.refresh()
    off()
    await catalog.reload()
    expect(seen).toEqual([1])
  })
})
