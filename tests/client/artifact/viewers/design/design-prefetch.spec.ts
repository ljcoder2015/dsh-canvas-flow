/**
 * 两件事：**预取的字面清单与引擎真正要的清单必须同源**、以及**加载失败不许留档**（v1.86）。
 *
 * 前者是「同一个东西两个来源」这一类最爱出事的静默失败（这仓库里撞过三次）：客户端那份
 * 清单（`PREFETCH_FONTS`）写错一个文件名，预热就白做——而它**什么都不报**，只是某次打开
 * 又多等 140ms。唯一能钉住它的地方是两份源码的字面量本身：这里不 import（`design-skia.ts`
 * 拉着 `@open-pencil/core` 与 CanvasKit，node 里 import 即死），只读文本抽文件名。
 *
 * 后者是一次真实事故的形状：`loadCanvasKit` 从前把 `null` 钉在 `inflight` 上，于是第一次
 * 取失败之后，这张页面上的每张设计卡都直接拿到那个 `null` 走降级——注释写着「不永久缓存」，
 * 代码却永久缓存了。失败要能重来，这条用源码钉（同样的理由：这个模块在 node 里只会走
 * `typeof document === 'undefined'` 那一支，跑不出「失败之后重试」这件事）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const canvaskit = readFileSync(
  new URL('../../../../../src/client/artifact/viewers/design/design-canvaskit.ts', import.meta.url),
  'utf8',
)
const skia = readFileSync(
  new URL('../../../../../src/client/artifact/viewers/design/design-skia.ts', import.meta.url),
  'utf8',
)

/** 抽出一份源码里出现的字面文件名（去重排序，比集合用）。 */
function fontFiles(source: string): string[] {
  const found = source.match(/Inter-[A-Za-z]+\.ttf/g) ?? []
  return [...new Set(found)].sort()
}

describe('预取清单', () => {
  it('客户端预取的四支与引擎注册的四支是同一批', () => {
    const prefetched = fontFiles(canvaskit)
    const registered = fontFiles(skia)
    // 两边都得有东西：正则写错了会双双返回空数组，那样下面的相等就变成假绿。
    expect(prefetched.length).toBe(4)
    expect(registered.length).toBe(4)
    expect(prefetched).toEqual(registered)
  })
})

describe('加载失败不留档', () => {
  it('CanvasKit 那一趟失败后把 inflight 放开，下一次能重来', () => {
    // 认的是「只清自己这一趟」那句：成功的那一份照旧按页缓存，失败的才放开。
    expect(canvaskit).toContain('runtime === null && inflight === attempt')
  })

  it('引擎 chunk 那一趟同理', () => {
    const module = readFileSync(
      new URL('../../../../../src/client/artifact/viewers/design/design-engine-module.ts', import.meta.url),
      'utf8',
    )
    expect(module).toContain('module === null && engineModule === attempt')
  })
})
