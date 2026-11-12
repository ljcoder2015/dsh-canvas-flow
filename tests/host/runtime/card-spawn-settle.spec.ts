/**
 * 新建判撞（v2.10）的**接线**判据。
 *
 * 用户原话：「已经删除的骨骼节点，新建时会变成旧的已经删除的卡片」。根因是 F1.2 的
 * 「落座从不删产物」与客户端起名只对板上负责这两条规矩在 `createCard` 处接不起来：
 * 名字被判作空闲，切绑却切到了已删卡留在磁盘上的那份产物上。修法是给 `createCard`
 * 一条对磁盘落定的路（`spawnStem`），判据本身在 `core/canvas/project/artifact-folders.ts`
 * 的 `settleArtifactPath`（纯，已穷举验过），这里只钉五句接线——与 `card-import.spec.ts`
 * 同一个理由，读源码文本而不是构造 `CardRuntime`。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const RUNTIME = readFileSync(new URL('../../../src/host/runtime/card-runtime.ts', import.meta.url), 'utf8')
const TOOLS = readFileSync(new URL('../../../src/host/tools.ts', import.meta.url), 'utf8')
const VIEW = readFileSync(new URL('../../../src/client/canvas/board/canvas-view.tsx', import.meta.url), 'utf8')
const BRIDGE = readFileSync(new URL('../../../src/client/wire/bridge.ts', import.meta.url), 'utf8')
const CONTRACT = readFileSync(new URL('../../../src/contract.ts', import.meta.url), 'utf8')

/** 抓一个方法的函数体（从签名到同级的收尾大括号）。 */
function bodyOf(source: string, signature: RegExp, what: string): string {
  const match = signature.exec(source)
  if (match === null) throw new Error(`${what} 的形状变了，这条判据要跟着改`)
  const start = match.index
  const end = source.indexOf('\n  }', start)
  if (end === -1) throw new Error(`${what} 的收尾大括号找不到，这条判据要跟着改`)
  return source.slice(start, end)
}

describe('宿主：createCard 的落定路', () => {
  const createCard = (): string => bodyOf(RUNTIME, /async createCard\(/, '`createCard`')

  it('词干非空才判撞：判据走 settleArtifactPath，磁盘由 presenceOf 注入', () => {
    const body = createCard()
    expect(body).toMatch(/settleArtifactPath\(/)
    expect(body).toMatch(/presenceOf\(project\.root, candidate/)
    // 空串是「精确切绑」——那一条路上一个磁盘探测都不该有。
    expect(body).toMatch(/spawnStem !== undefined && spawnStem !== ''/)
  })

  it('切绑的是落定后的路径：facts 读、记录写、回报带的都是 bound，不是客户端预判的 file', () => {
    const body = createCard()
    expect(body).toMatch(/io\.facts\(project\.root, bound/)
    expect(body).toMatch(/file: bound/)
    expect(body, '回报里的名字也从落定路径推，客户端不用自己再算一遍').toMatch(/cardNameOf\(\{ file: bound/)
  })

  it('双扩展名从 file 上剥词干前缀拿——skeleton2d 的 `-2` 落在 .skeleton2d 之前', () => {
    const body = createCard()
    expect(body).toMatch(/base\.startsWith\(spawnStem\) \? base\.slice\(spawnStem\.length\) : extensionOf\(base\)/)
  })

  it('两个脚手架内部切绑不交词干：目录名它们已对磁盘落定过，再判一遍是第二次来源', () => {
    expect(RUNTIME).toMatch(/this\.createCard\(projectId, `\$\{folder\}\/index\.html`, 'app', position, undefined, signal\)/)
    expect(RUNTIME).toMatch(/this\.createCard\(projectId, filePath, 'design', position, undefined, signal\)/)
  })
})

describe('调用方：谁交词干、谁精确切绑', () => {
  it('画布坞新建交词干——这正是「新建变成已删卡」的修法落点', () => {
    // spawnFromSpec 是组件内嵌套的 useCallback，收尾缩进与顶层不同，直接对全文匹配。
    expect(VIEW).toMatch(/bridge\.createCard\(projectId, file, spec\.kind, position, name\)/)
  })

  it('桥把缺省归一成空串：线上参数必须齐全，空串 = 精确切绑', () => {
    expect(BRIDGE).toMatch(/spawnStem \?\? ''/)
  })

  it('agent 建卡工具精确切绑（agent 自己点名路径），且 signal 不再被误当词干传', () => {
    expect(TOOLS).toMatch(/deps\.card\.createCard\(projectId, String\(args\.content\), kind, \{ x: x \?\? 48, y: y \?\? 170 \}, undefined, exec\.signal\)/)
  })

  it('契约把 spawnStem 记进 create_card 的参数表——两边描述同一句话', () => {
    expect(CONTRACT).toMatch(/P\.projectId, P\.file, P\.kind, P\.position, P\.spawnStem\]/)
    expect(CONTRACT).toMatch(/spawnStem: json\('stem', 'stem', 'dsh-canvas-flow#CardStem'/)
  })
})
