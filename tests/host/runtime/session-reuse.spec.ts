/**
 * 卡片会话的复用逻辑：先收养、后 resume；租约被占时绝不另起一段对话。
 *
 * 现场症状：同一张卡片（`oozzqz`）每次重启后发消息都多出一段新会话，前后共 5 段，
 * 而卡片绑定被覆盖到最后一段，旧对话成了孤儿。根因不在本插件内部，而在**谁先拿到
 * 日志的单写者租约**：
 *
 * 1. 宿主启动时，harness 自己的会话控制器（`dsh-api-session-controller`）会为近期
 *    会话执行 `resumeObserved()`，其中就包括卡片绑定的那段对话，于是租约在它手上。
 * 2. 用户发消息，本插件走 `CardSession` 的 resume 路径，撞上同一把租约，
 *    抛 `SessionAlreadyOwnedError`。
 * 3. 旧代码把这个错误当成「日志读不出来」，catch 里吞掉、把绑定清空、再铸一段新会话
 *    并把卡片重新绑上去——**旧对话就此被静默遗弃**，而它其实好端端地开着。
 *
 * 所以判据有两条，都是**次序**上的：被别处拉起的 agent 要认出来并直接收养（它就是同一
 * 段对话），而「租约被占」要落在「清空绑定 + 另起一段」之前被拦下。这一层要跑起来得有
 * 一整套宿主装配（真实的 persistence、代理循环、会话控制器），而漏改的表现恰恰是
 * 「装配好了也照跑不误」——所以这里读的是源码文本，和 `card-paths.spec.ts` 同一个套路。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SOURCE = 'src/host/runtime/card-runtime.ts'

/** 依次出现的标记：每一个都必须在前一个之后，否则复用逻辑就断了。 */
const ORDERED = [
  // 先看这段对话是不是已经被别处拉起——是的话它就是同一段对话，不该再 resume。
  { marker: 'this.ctx.agents.get(', why: 'openSession 必须先查是否存在活 agent（收养），再考虑 resume' },
  // 收养的 agent 已经发布，卡作用域只能后装；这行只在收养分支里出现。
  { marker: 'this.scopeFor(agent.ctx', why: '收养的 agent 必须补装卡作用域，否则它不知道自己在编辑哪张卡' },
  { marker: 'this.deps.sessions.adopt(', why: '活 agent 要以「收养」登记，释放时不得 dispose 别处创建的 agent' },
  { marker: 'ownerCtx.agents.resume(', why: '只有确认没有活 agent 时，才轮到 resume 绑定的会话' },
] as const

/** 位置，找不到即 -1（调用方负责报错）。 */
function at(source: string, marker: string): number {
  return source.indexOf(marker)
}

describe('host: 卡片会话的复用次序', () => {
  const source = readFileSync(SOURCE, 'utf8')

  it('先收养宿主已拉起的活 agent，再谈 resume', () => {
    let previous = -1
    const problems: string[] = []
    for (const { marker, why } of ORDERED) {
      const index = at(source, marker)
      if (index < 0) {
        problems.push(`找不到 ${JSON.stringify(marker)}：${why}`)
        continue
      }
      if (index < previous) problems.push(`${JSON.stringify(marker)} 出现在前一个标记之前：${why}`)
      previous = index
    }
    expect(problems, `${SOURCE} 里的收养/复用次序被改动了`).toEqual([])
  })

  it('租约被占时在清空绑定、另起一段之前就被拦下', () => {
    const busy = at(source, 'isAlreadyOwned(error)')
    const clear = at(source, "binding = ''")
    expect(busy, '没有区分「租约被占」错误').toBeGreaterThanOrEqual(0)
    expect(clear, '没有找到清空绑定的分支').toBeGreaterThanOrEqual(0)
    expect(
      busy,
      '租约被占必须先被拦下；一旦先清空绑定，卡片就会被重新绑到一段新会话上，旧对话成孤儿',
    ).toBeLessThan(clear)
  })

  it('判据本身不许空转：这些标记确实都在源码里', () => {
    for (const { marker } of ORDERED) {
      expect(at(source, marker), `${SOURCE} 里找不到 ${JSON.stringify(marker)}，判据可能已经失效`).toBeGreaterThanOrEqual(0)
    }
  })
})