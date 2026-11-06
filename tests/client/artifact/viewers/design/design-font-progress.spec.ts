/**
 * 字体加载进度（v1.88）：**数字不能撒谎**。
 *
 * 这一组判据都对着「会骗人的那几种算法」写，不是对着函数的形状写：
 *   1. 分母还没到时按支数折算——那是此刻唯一知道的东西（不能凭空编个总字节）；
 *   2. 分母到了就必须按字节（四支 Inter 到齐＝4/5＝80%，可那才 1.3MB，中文 17.7MB 一个字
 *      都还没来——按支数算的 80% 是假的）；
 *   3. 没结束之前封顶 99（压过的响应与真到货差几个字节，停在 100% 会让人以为卡死）；
 *   4. 已经全在缓存里时不露面（一条停在 100% 的进度条反而像还有东西在加载）；
 *   5. 逐块读来的字节不能每次都惊动界面（17.7MB / 64KB ≈ 280 次回调）。
 */
import { describe, expect, it } from 'vitest'
import {
  createFontProgressTracker,
  fontPercentKnown,
  fontPercentOf,
  fontProgressChanged,
  fontProgressVisible,
  formatBytes,
  type DesignFontProgress,
} from '../../../../../src/client/artifact/viewers/design/design-font-progress.ts'

/** 本机这五支字面的真实大小（`lib/assets/*.ttf`，字节）。 */
const INTER = 344_072 + 325_304 + 342_408 + 326_048
const CJK = 17_772_300

const progress = (patch: Partial<DesignFontProgress> = {}): DesignFontProgress => ({
  done: 0,
  total: 0,
  bytes: 0,
  totalBytes: 0,
  measured: 0,
  ...patch,
})

describe('fontPercentOf', () => {
  it('分母还没到时按支数折算', () => {
    expect(fontPercentOf(progress({ done: 1, total: 4 }))).toBe(25)
    expect(fontPercentOf(progress({ done: 2, total: 4 }))).toBe(50)
  })

  it('分母到了就按字节——四支 Inter 是 4/5 支、却只有 7% 的字节', () => {
    const p = progress({ done: 4, total: 5, bytes: INTER, totalBytes: INTER + CJK, measured: 5 })
    // 按支数会说 80%，按字节才 7%。用户能看见的中文正等着后面那 17.7MB。
    expect(fontPercentOf(p)).toBe(7)
  })

  it('没结束之前封顶 99：字节读满了也不算 100', () => {
    const p = progress({ done: 4, total: 5, bytes: INTER + CJK, totalBytes: INTER + CJK, measured: 5 })
    expect(fontPercentOf(p)).toBe(99)
  })

  it('全结束了就是 100（无论字节数怎么报的）', () => {
    expect(fontPercentOf(progress({ done: 5, total: 5, bytes: 10, totalBytes: 0 }))).toBe(100)
  })

  it('一支都不取时是 0，不是 NaN', () => {
    expect(fontPercentOf(progress())).toBe(0)
  })
})

describe('fontPercentKnown', () => {
  it('分母只覆盖了一部分字面时不可信（四支 Inter 到齐那一下）', () => {
    const p = progress({ done: 4, total: 5, bytes: INTER, totalBytes: INTER, measured: 4 })
    // 这一份按字节算出来是 99%，可中文的响应头都还没回来——下一秒分母变 18.2MB，掉到 7%。
    expect(fontPercentOf(p)).toBe(99)
    expect(fontPercentKnown(p)).toBe(false)
  })

  it('五支的响应头都到了才可信', () => {
    const p = progress({ done: 4, total: 5, bytes: INTER, totalBytes: INTER + CJK, measured: 5 })
    expect(fontPercentKnown(p)).toBe(true)
  })

  it('一个字节都没测到时不算数', () => {
    expect(fontPercentKnown(progress({ done: 0, total: 5 }))).toBe(false)
  })
})

describe('fontProgressVisible', () => {
  it('还有字面在路上才露面', () => {
    expect(fontProgressVisible(progress({ done: 2, total: 5 }))).toBe(true)
  })

  it('没有可讲的进度就不露面', () => {
    expect(fontProgressVisible(null)).toBe(false)
    // 全缓存命中（第二次打开就是这样）：没有在跑的字体。
    expect(fontProgressVisible(progress({ done: 0, total: 0 }))).toBe(false)
    // 收尾了也不留一条停在 100% 的条。
    expect(fontProgressVisible(progress({ done: 5, total: 5 }))).toBe(false)
  })
})

describe('formatBytes', () => {
  it('MB 保一位小数，KB 取整', () => {
    expect(formatBytes(CJK)).toBe('16.9 MB')
    expect(formatBytes(INTER)).toBe('1.3 MB')
    expect(formatBytes(325_304)).toBe('318 KB')
    expect(formatBytes(0)).toBe('0 KB')
  })
})

describe('createFontProgressTracker', () => {
  const FILES = ['Inter-Regular.ttf', 'Inter-Bold.ttf', 'NotoSansSC-Regular.ttf']

  function setup() {
    const seen: DesignFontProgress[] = []
    const tracker = createFontProgressTracker(FILES, (p) => seen.push(p))
    return { tracker, seen }
  }

  it('清单决定分母——已缓存的不该混进来', () => {
    const { tracker } = setup()
    expect(tracker.snapshot()).toMatchObject({ done: 0, total: 3, bytes: 0, totalBytes: 0, measured: 0 })
  })

  it('响应头的总长重复报也只认第一次（重定向/代理会报两回）', () => {
    const { tracker } = setup()
    tracker.measure('Inter-Regular.ttf', 344_072)
    tracker.measure('Inter-Regular.ttf', 344_072)
    expect(tracker.snapshot()).toMatchObject({ totalBytes: 344_072, measured: 1 })
  })

  it('结束一支就报一次，重复结束不再加', () => {
    const { tracker, seen } = setup()
    tracker.finish('Inter-Regular.ttf')
    tracker.finish('Inter-Regular.ttf')
    expect(tracker.snapshot().done).toBe(1)
    expect(seen.at(-1)?.done).toBe(1)
  })

  it('失败也算结束——否则进度条为一条永远不来的请求停在半路', () => {
    const { tracker } = setup()
    // 取不到的那一支照样走 finish（loadFontFile 的两个失败分支都这么调）。
    tracker.finish('NotoSansSC-Regular.ttf')
    expect(tracker.snapshot().done).toBe(1)
  })

  it('逐块读不每次都惊动界面：跨过步长才报一次', () => {
    const { tracker, seen } = setup()
    tracker.measure('NotoSansSC-Regular.ttf', CJK)
    const before = seen.length
    // 64KB 一块地喂 100 块（6.4MB）：不该来 100 次。
    for (let i = 0; i < 100; i += 1) tracker.read('NotoSansSC-Regular.ttf', 64 * 1024)
    expect(seen.length - before).toBeLessThan(40)
    // 但字节一个都不能丢。
    expect(tracker.snapshot().bytes).toBe(100 * 64 * 1024)
  })

  it('结束那一下必须报（文案的主语是 done/total）', () => {
    const { tracker, seen } = setup()
    tracker.finish('Inter-Bold.ttf')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ done: 1, total: 3 })
  })
})

describe('fontProgressChanged', () => {
  it('百分比没动的那一次不值得重渲染', () => {
    const prev = progress({ done: 2, total: 5, bytes: 1_000_000, totalBytes: 19_000_000 })
    const next = progress({ done: 2, total: 5, bytes: 1_050_000, totalBytes: 19_000_000 })
    expect(fontPercentOf(prev)).toBe(fontPercentOf(next))
    expect(fontProgressChanged(prev, next)).toBe(false)
  })

  it('支数变了必报', () => {
    const prev = progress({ done: 2, total: 5, bytes: 1_000_000, totalBytes: 19_000_000 })
    const next = progress({ done: 3, total: 5, bytes: 1_000_000, totalBytes: 19_000_000 })
    expect(fontProgressChanged(prev, next)).toBe(true)
  })

  it('从「没有」到「有」、从「有」到「没有」都要报', () => {
    expect(fontProgressChanged(null, progress({ done: 0, total: 5 }))).toBe(true)
    expect(fontProgressChanged(progress({ done: 0, total: 5 }), null)).toBe(true)
    expect(fontProgressChanged(null, null)).toBe(false)
  })
})
