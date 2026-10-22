/**
 * 右栏认领清单（F2.4）的判据。
 *
 * `canvas-tab.ts` **import 不了**：它引了 `canvas-view.tsx`（React + 宿主 UI 原语），node
 * 下会死在 `clsx`。所以这一组读**源码文本**——但读的不是「出现了某个词」那种形似，而是
 * **把两份真源对起来**：认领清单必须覆盖 `kind-registry.ts` 里全部媒体形态，同时**不许**
 * 把「什么都认领」当解法（那条会把整个产品的文件打开权拿走，见模块头那段）。
 *
 * 补的是 v1.70 的一处漏网：加音频节点时这份清单还是手写的四个名字，`audio` 没加进去，
 * 于是 `.mp3` 在 kind 表里有地址模式、却没人认领——**判定与认领两边对同一个文件各说各话**，
 * 点开落到内置查看器上。修法不是补一个字面量，而是把媒体那三个从 `MEDIA_KINDS` 摊开，
 * 让「以后再加一种媒体形态」不会再漏第二次；下面第 1 条判的就是这件事。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUILTIN_KINDS, MEDIA_KINDS } from '../../../../src/core/artifact/kind/kind-registry.ts'

/** 读一份源码文本（接线那几条读不了模块，只能读字）。 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** 认领清单的**集合体**：`new Set<string>([...])` 方括号里那一串。 */
function claimBody(): string {
  const source = read('../../../../src/client/canvas/board/canvas-tab.ts')
  const match = /const CLAIMABLE = new Set<string>\(\[([^\]]*)\]\)/.exec(source)
  if (match === null) throw new Error('`CLAIMABLE` 的形状变了，这条判据要跟着改')
  return match[1]!
}

describe('画布认领的形态清单', () => {
  it('覆盖全部媒体形态（含音频）', () => {
    const body = claimBody()
    const spread = body.includes('...MEDIA_KINDS')
    for (const kind of MEDIA_KINDS) {
      expect(spread || body.includes(`'${kind}'`), `${kind} 没被认领`).toBe(true)
    }
  })

  it('不认领 folder / file——那条会把整个产品的文件打开权拿走', () => {
    const body = claimBody()
    for (const blanket of ['folder', 'file']) {
      expect(body.includes(`'${blanket}'`), `${blanket} 不该被认领`).toBe(false)
    }
    // 理由摆在明处：`file` 的地址模式是全匹配式的一条，认领它等于认领所有文件。
    expect(BUILTIN_KINDS.find((kind) => kind.id === 'file')?.addressPatterns).toEqual([
      'dsh-resource://file/**',
    ])
  })

  it('媒体形态各带地址模式，认领才有东西可认', () => {
    for (const kind of MEDIA_KINDS) {
      const definition = BUILTIN_KINDS.find((entry) => entry.id === kind)
      expect(definition, `${kind} 不在 kind 表里`).toBeDefined()
      expect(definition!.addressPatterns.length, `${kind} 没有地址模式`).toBeGreaterThan(0)
    }
  })
})
