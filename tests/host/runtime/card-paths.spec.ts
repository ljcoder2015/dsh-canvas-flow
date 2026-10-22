/**
 * 「卡片 id 不是产物路径」这条线，在 Host 侧的守卫（v1.49 的欠账）。
 *
 * v1.49 之前卡片 id 就是产物文件的相对路径，于是 `io.write(root, cardId, …)`
 * 与 `io.write(root, file, …)` 是同一件事。身份解耦之后它们不是了：IO 层的第一个
 * 位置参数是**路径**（`ArtifactIo.probe/write/view/summarize` 全部如此，见
 * `tests/core/artifact/artifact-io.spec.ts` 里的调用形态），而卡片记录上的路径得从
 * `cardFileOf(record, id)` 取。漏改一处不会报错——它会**静默地**把产物写到
 * `<root>/qkxwvd` 这样一个以座位 id 命名的文件上，或者对着一个不存在的文件说
 * 「没有这份产物」：
 *
 * - `readSummary` 漏改 ⇒ 每张新卡片的摘要都读不到（卡片控制带上的「手动输入」对
 *   文本卡片隐身，卡面无摘要）。
 * - `writeText` 漏改 ⇒ 手写保存、以及建卡时那行种子文字，落到一个游离子目录里，
 *   用户自己的 `文本.md` 永远不出现（现场证据：项目根上的 `lzyoke` 里躺着
 *   `# 文本`，而板上那张卡的产物正是 `文本.md`）。
 *
 * 这两个症状都不响、不报错，只是「东西没出现」。所以这里把规矩钉成一条可读的判据：
 * **凡是喂给 IO 层的路径，必须是 `fileOf(…)` 出来的，或者本就不是座位 id。**
 * 判据读的是源码文本而不是运行结果——这一层要跑起来得有一套完整的宿主装配，而
 * 漏改的表现恰恰是「装配好了也照跑不误」。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 会被读的一份源码，与它里面该有的 IO 调用下限（守卫不许空转）。 */
const SOURCES = [
  { path: 'src/host/runtime/card-runtime.ts', minimumCalls: 8 },
  { path: 'src/host/runtime/canvas-runtime.ts', minimumCalls: 5 },
] as const

interface IoCall {
  method: string
  args: string
  line: number
}

/** 一次 `this.deps.io.<method>(…)` 调用的实参文本。括号按深度配对，字符串里的括号不算。 */
function ioCalls(source: string): IoCall[] {
  const calls: IoCall[] = []
  for (const match of source.matchAll(/this\.deps\.io\.([A-Za-z]+)\(/g)) {
    const start = (match.index ?? 0) + match[0].length
    let depth = 1
    let quote = ''
    let at = start
    for (; at < source.length && depth > 0; at += 1) {
      const char = source[at] as string
      if (quote !== '') {
        if (char === '\\') at += 1
        else if (char === quote) quote = ''
        continue
      }
      if (char === "'" || char === '"' || char === '`') quote = char
      else if (char === '(') depth += 1
      else if (char === ')') depth -= 1
    }
    calls.push({
      method: match[1] as string,
      args: source.slice(start, at - 1),
      // 只为了报错时指得出地方。
      line: source.slice(0, match.index ?? 0).split('\n').length,
    })
  }
  return calls
}

describe('host: 交给 IO 层的一律是产物路径', () => {
  it('从不把座位 id 当作路径传下去', () => {
    const offenders: string[] = []
    for (const { path } of SOURCES) {
      const source = readFileSync(path, 'utf8')
      for (const call of ioCalls(source)) {
        if (!/\bcardId\b/.test(call.args)) continue
        // `fileOf(record, cardId)` 是**唯一**合法的形态：它把 id 翻成路径。
        if (call.args.includes('fileOf(')) continue
        offenders.push(`${path}:${String(call.line)} io.${call.method}(${call.args.trim().replace(/\s+/g, ' ')})`)
      }
    }
    expect(offenders, 'IO 层收到的是路径；卡片记录上的路径要走 cardFileOf(record, id)').toEqual([])
  })

  it('守卫本身不许空转：两份源码里确实有这么多 IO 调用', () => {
    // 正则改坏、或者 io 调用被搬去了别处，都会让上面那条判据毫无意见地变绿。
    for (const { path, minimumCalls } of SOURCES) {
      const calls = ioCalls(readFileSync(path, 'utf8'))
      expect(calls.length, `${path} 里读到的 IO 调用太少，判据可能已经失效`).toBeGreaterThanOrEqual(minimumCalls)
      // 而且里头至少有一处走了 fileOf——否则这条「必须走 fileOf」的规矩无从谈起。
      expect(calls.some((call) => call.args.includes('fileOf(')), `${path} 里没有一处走 fileOf`).toBe(true)
    }
  })
})
