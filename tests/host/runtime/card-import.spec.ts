/**
 * 宿主那一半的「导入」判据（F2.7，v1.81）。
 *
 * 为什么读源码文本而不是构造一个 `CardRuntime` 去调：它要 Cordis 上下文、存储域与一整套
 * 假 `io`，判据会变成为难而难（与 `card-media.spec.ts` 同一个理由）。而这一层的逻辑本来
 * 就薄——**判据在 `core/canvas/import-plan.ts`（纯，已穷举验过），这里只有五句接线**：
 *
 * 1. 字节走 `writeBytes`，不走 `write`（后者把内容当 UTF-8 发布，一张 PNG 过去不报错，
 *    只写出一个打不开的文件）；
 * 2. **先落盘、后写记录**（顺序反了会留下一条指向不存在路径的记录）；
 * 3. 记录改三处：`file`、`kind`（按新文件名重判）、以及删掉 `aspect` 与 `seatedEmpty`；
 * 4. 撞名问**磁盘**（`presenceOf`），不问板面；
 * 5. 一次都不碰会话（导入是「换产物」，不是「说一句话」）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const RUNTIME = readFileSync(new URL('../../../src/host/runtime/card-runtime.ts', import.meta.url), 'utf8')

/** 抓一个方法的函数体（从签名到同级的收尾大括号）。 */
function bodyOf(signature: RegExp, what: string): string {
  const match = signature.exec(RUNTIME)
  if (match === null) throw new Error(`${what} 的形状变了，这条判据要跟着改`)
  const start = match.index
  const end = RUNTIME.indexOf('\n  }', start)
  if (end === -1) throw new Error(`${what} 的收尾大括号找不到，这条判据要跟着改`)
  return RUNTIME.slice(start, end)
}

const importArtifact = (): string => bodyOf(/async importArtifact\(/, '`importArtifact`')

describe('字节怎么落盘', () => {
  it('走 writeBytes，不走 write——文本写会把 PNG 当成 UTF-8 落下去，且不报错', () => {
    const body = importArtifact()
    expect(body).toMatch(/this\.deps\.io\.writeBytes\(/)
    expect(body, '这里不该出现文本写：writeBytes 才是字节那条路').not.toMatch(/deps\.io\.write\(/)
  })

  it('先落盘、后写记录（反过来会留下一条指向不存在文件的记录）', () => {
    const body = importArtifact()
    const disk = body.indexOf('writeBytes(')
    const record = body.indexOf('this.cards.put(')
    expect(disk).toBeGreaterThan(0)
    expect(record).toBeGreaterThan(disk)
  })

  it('超限在**解码之前**就拒：解一遍再拒，等于先把那几十兆分配出来', () => {
    const body = importArtifact()
    const guard = body.indexOf('IMPORT_MAX_BYTES')
    const decode = body.indexOf('decodeBase64(')
    expect(guard).toBeGreaterThan(0)
    expect(decode).toBeGreaterThan(guard)
  })

  it('base64 不合法有自己的错误码：那是调用方写错了，不是用户做错了', () => {
    expect(RUNTIME).toMatch(/card\/import-malformed/)
    expect(RUNTIME).toMatch(/function decodeBase64\(/)
  })
})

describe('记录改成什么', () => {
  it('file 指向新路径，kind 按新文件名重判——一张图片卡导进视频，它就成了视频卡', () => {
    const body = importArtifact()
    expect(body).toMatch(/file: plan\.file/)
    expect(body).toMatch(/kind: kindOfFile\(plan\.file\)/)
  })

  it('比例与「生来没有产物」这两条推断一起作废（派生默认 + 只存差异：删掉，不是写假值）', () => {
    const body = importArtifact()
    expect(body).toMatch(/delete next\.aspect/)
    expect(body).toMatch(/delete next\.seatedEmpty/)
  })

  it('形态判定仍然只有一处：kindOfFile 走 detectKind，不自己写扩展名表', () => {
    const helper = bodyOf(/function kindOfFile\(/, '`kindOfFile`')
    expect(helper).toMatch(/detectKind\(/)
  })
})

describe('撞名、拒绝与会话', () => {
  it('撞名问磁盘，不问板面——一张已经拿掉的旧卡留下的文件同样占着那个名字', () => {
    const body = importArtifact()
    expect(body).toMatch(/presenceOf\(project\.root, candidate/)
    expect(body, '撞名不该读板面：板上的卡片与盘上的文件是两回事').not.toMatch(/cardsOf\(projectId\)/)
  })

  it('拒绝带理由：`card/import-refused` + 那个枚举，界面据此说三种不同的话', () => {
    const body = importArtifact()
    expect(body).toMatch(/card\/import-refused/)
    expect(body).toMatch(/reason,/)
  })

  it('一次都不碰会话：导入是换产物，不是让这张卡说一句话', () => {
    const body = importArtifact()
    // 回给客户端的 BoardCard 当然带 `sessionId`（那是这张卡自己的事实，原样回显），
    // 所以「不碰」要看**写进记录的那一段**：它不该出现会话相关的任何一个词。
    const start = body.indexOf('const next: CardRecord')
    const end = body.indexOf('this.cards.put(', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(body.slice(start, end)).not.toMatch(/session/i)
    expect(body).not.toMatch(/openSession|sendMessage|SessionManager/)
  })
})
