/**
 * 卡片名与改名（F1.12，`core/canvas/card-name.ts`）。
 *
 * 这里钉的是三件事，每一件都出过（或差点出）事故：
 *
 * 1. **默认名从产物推出来**，而且目录形态推的是**目录**——应用卡显示「myapp」而不是
 *    「index.html」。老记录没有 `name`，读出来的必须正是它一直显示的样子（零迁移）。
 * 2. **改名改的是「产物自己那一项」**：文件的改文件（扩展名留着）、目录的改目录
 *    （入口页跟着搬）、画布根目录那一项拒改。
 * 3. **用户输入不能变成路径**：`../x`、`.hidden`、`a/b` 这些都得在进磁盘之前被削平，
 *    否则一次改名就能把产物写到自己文件夹外面去。
 */
import { describe, expect, it } from 'vitest'
import {
  autoNameOf,
  basenameOf,
  cardNameOf,
  dirnameOf,
  extensionOf,
  fileStemOf,
  planRename,
  renameStep,
  settleRename,
  stemOf,
  storedNameOf,
  type RenamePlan,
} from '../../../../src/core/canvas/card/card-name.ts'

/** 一个改名方案，取它的字段；拒改时直接让测试炸掉（那些用例另有断言）。 */
function renamed(plan: RenamePlan): Extract<RenamePlan, { kind: 'rename' }> {
  if (plan.kind !== 'rename') throw new Error(`expected a rename, got ${plan.reason}`)
  return plan
}

describe('路径碎片', () => {
  it('把一条路径切开成父目录、末名与扩展名', () => {
    expect(basenameOf('a/b/c.md')).toBe('c.md')
    expect(dirnameOf('a/b/c.md')).toBe('a/b')
    expect(dirnameOf('c.md')).toBe('')
    expect(extensionOf('brief.md')).toBe('.md')
    expect(extensionOf('archive.tar.gz')).toBe('.gz')
    expect(extensionOf('README')).toBe('')
    // 点开头的文件整个就是名字：那个点是名字的一部分，不是扩展名的分隔符。
    expect(extensionOf('.env')).toBe('')
    expect(stemOf('.env')).toBe('.env')
    expect(stemOf('brief.md')).toBe('brief')
  })
})

describe('默认卡片名（F1.12）', () => {
  it('文件形态取文件名去掉扩展名', () => {
    expect(cardNameOf({ file: 'brief.md', kind: 'markdown' })).toBe('brief')
    expect(cardNameOf({ file: 'notes/brief.md', kind: 'markdown' })).toBe('brief')
    expect(cardNameOf({ file: 'deck.html', kind: 'app' })).toBe('deck')
    expect(cardNameOf({ file: 'blank.design', kind: 'design' })).toBe('blank')
  })

  it('目录形态取目录名，而不是入口页的名字', () => {
    // 这是这条功能里最显眼的一处：应用卡的产物是「一个目录带 index.html」，
    // 卡片上写着 index.html 说的其实是「怎么搭的」，不是「做了什么」。
    expect(cardNameOf({ file: 'myapp/index.html', kind: 'app' })).toBe('myapp')
    expect(cardNameOf({ file: 'docs/site/index.html', kind: 'app' })).toBe('site')
    // `folder` 形态的 file 本身就是那个目录。
    expect(cardNameOf({ file: 'docs', kind: 'folder' })).toBe('docs')
  })

  it('根上的入口页没有目录可借名，退回入口页自己的名字', () => {
    expect(cardNameOf({ file: 'index.html', kind: 'app' })).toBe('index')
  })

  it('记录里有名字就用它', () => {
    expect(cardNameOf({ file: 'brief.md', kind: 'markdown', name: '市场分析' })).toBe('市场分析')
    // 空白不算名字。
    expect(cardNameOf({ file: 'brief.md', kind: 'markdown', name: '   ' })).toBe('brief')
  })
})

describe('用户输入变成路径段', () => {
  it('削掉路径与文件名里不许出现的字符', () => {
    expect(fileStemOf('市场分析')).toBe('市场分析')
    expect(fileStemOf('Q3 Brief')).toBe('Q3-Brief')
    expect(fileStemOf('a/b\\c')).toBe('a-b-c')
    expect(fileStemOf('what?')).toBe('what')
    expect(fileStemOf('a:b*c"d<e>f|g')).toBe('a-b-c-d-e-f-g')
    expect(fileStemOf('tab\there')).toBe('tabhere')
  })

  it('不许写成隐藏文件，也不许写成相对路径', () => {
    expect(fileStemOf('...')).toBe('')
    expect(fileStemOf('..')).toBe('')
    expect(fileStemOf('.hidden')).toBe('hidden')
    expect(fileStemOf('-dash-')).toBe('dash')
  })

  it('大写与 CJK 原样留着（名字是给人看的，不是 slug）', () => {
    expect(fileStemOf('My Brief')).toBe('My-Brief')
  })
})

describe('改名改的是哪一项', () => {
  it('文本与设计：改文件，扩展名留着', () => {
    expect(renamed(planRename({ file: 'brief.md', kind: 'markdown', name: '市场分析' }))).toEqual({
      kind: 'rename',
      from: 'brief.md',
      to: '市场分析.md',
      file: '市场分析.md',
    })
    expect(renamed(planRename({ file: 'notes/brief.md', kind: 'markdown', name: '市场分析' })).to).toBe(
      'notes/市场分析.md',
    )
    // 扩展名比名字长得多也照样留着：改的是名字，不是形态。
    expect(renamed(planRename({ file: 'blank.design', kind: 'design', name: '首页' })).to).toBe('首页.design')
    expect(renamed(planRename({ file: 'deck.html', kind: 'app', name: '季度汇报' })).to).toBe('季度汇报.html')
  })

  it('应用绑在目录上：改目录，入口页跟着搬', () => {
    expect(renamed(planRename({ file: 'myapp/index.html', kind: 'app', name: '市场分析' }))).toEqual({
      kind: 'rename',
      from: 'myapp',
      to: '市场分析',
      file: '市场分析/index.html',
    })
    // 目录不在根上时，改的是它自己，父目录一个字都不动。
    expect(renamed(planRename({ file: 'apps/site/index.html', kind: 'app', name: '官网' }))).toEqual({
      kind: 'rename',
      from: 'apps/site',
      to: 'apps/官网',
      file: 'apps/官网/index.html',
    })
  })

  it('文件夹形态改的就是那个目录，名字里的点不当作扩展名', () => {
    expect(renamed(planRename({ file: 'v1.docs', kind: 'folder', name: '归档' }))).toEqual({
      kind: 'rename',
      from: 'v1.docs',
      to: '归档',
      file: '归档',
    })
  })

  it('画布根目录那一项拒改', () => {
    // 根上的入口页：改它等于改画布目录本身（或者把它改成一张不再叫 index 的页）。
    expect(planRename({ file: 'index.html', kind: 'app', name: '官网' })).toEqual({
      kind: 'refused',
      reason: 'root-entry',
    })
    expect(planRename({ file: '.', kind: 'folder', name: '官网' })).toEqual({
      kind: 'refused',
      reason: 'root-entry',
    })
  })

  it('名字里没有可用的字就拒改', () => {
    expect(planRename({ file: 'brief.md', kind: 'markdown', name: '   ' })).toEqual({
      kind: 'refused',
      reason: 'empty-name',
    })
  })

  it('名字与现在一致时，不改磁盘（只可能改记录里的名字）', () => {
    const plan = renamed(planRename({ file: 'brief.md', kind: 'markdown', name: 'brief' }))
    expect(plan.to).toBe(plan.from)
  })

  it('序号加在后缀前，扩展名与目录都不受影响', () => {
    expect(renamed(planRename({ file: 'brief.md', kind: 'markdown', name: '市场分析', suffix: 2 })).to).toBe(
      '市场分析-2.md',
    )
    expect(renamed(planRename({ file: 'myapp/index.html', kind: 'app', name: '市场分析', suffix: 3 })).file).toBe(
      '市场分析-3/index.html',
    )
  })
})

describe('撞名连同它的变体都占着时，拒改而不是死循环', () => {
  it('一路试到 -99 都占着 ⇒ name-taken', async () => {
    const tried: string[] = []
    const plan = await settleRename({
      file: 'brief.md',
      kind: 'markdown',
      name: '市场分析',
      taken: async (candidate) => {
        tried.push(candidate)
        return true
      },
    })
    expect(plan).toEqual({ kind: 'refused', reason: 'name-taken' })
    expect(tried).toHaveLength(99)
    expect(tried[0]).toBe('市场分析.md')
    expect(tried[tried.length - 1]).toBe('市场分析-99.md')
  })

  it('第一个空位就停下，且不再往后探', async () => {
    const tried: string[] = []
    const plan = await settleRename({
      file: 'brief.md',
      kind: 'markdown',
      name: '市场分析',
      taken: async (candidate) => {
        tried.push(candidate)
        return candidate === '市场分析.md'
      },
    })
    expect(renamed(plan).to).toBe('市场分析-2.md')
    expect(tried).toEqual(['市场分析.md', '市场分析-2.md'])
  })

  it('名字没变时根本不问磁盘', async () => {
    let asked = 0
    const plan = await settleRename({
      file: 'brief.md',
      kind: 'markdown',
      name: 'brief',
      taken: async () => {
        asked += 1
        return true
      },
    })
    expect(renamed(plan).to).toBe('brief.md')
    expect(asked).toBe(0)
  })

  it('拒改的理由原样带出来，不去问磁盘', async () => {
    let asked = 0
    const plan = await settleRename({
      file: 'index.html',
      kind: 'app',
      name: '官网',
      taken: async () => {
        asked += 1
        return false
      },
    })
    expect(plan).toEqual({ kind: 'refused', reason: 'root-entry' })
    expect(asked).toBe(0)
  })
})

describe('磁盘那一步做什么', () => {
  const plan = renamed(planRename({ file: 'notes/brief.md', kind: 'markdown', name: '市场分析' }))

  it('源在磁盘上就搬它', () => {
    expect(renameStep({ plan, sourcePresent: true })).toEqual({
      kind: 'move',
      from: 'notes/brief.md',
      to: 'notes/市场分析.md',
      file: 'notes/市场分析.md',
    })
  })

  it('源不在（空座位或产物丢了的幽灵卡）就只改绑定', () => {
    expect(renameStep({ plan, sourcePresent: false })).toEqual({
      kind: 'rebind',
      file: 'notes/市场分析.md',
    })
  })

  it('名字没变就一步都不动', () => {
    const same = renamed(planRename({ file: 'brief.md', kind: 'markdown', name: 'brief' }))
    expect(renameStep({ plan: same, sourcePresent: true })).toEqual({ kind: 'rebind', file: 'brief.md' })
  })
})

describe('记录里存不存这个名字', () => {
  it('与产物自己说的名字一致就不存（老记录因此永远零迁移）', () => {
    expect(storedNameOf({ file: 'brief.md', kind: 'markdown', name: 'brief' })).toBeUndefined()
    expect(storedNameOf({ file: 'myapp/index.html', kind: 'app', name: 'myapp' })).toBeUndefined()
    expect(storedNameOf({ file: 'brief.md', kind: 'markdown', name: '   ' })).toBeUndefined()
  })

  it('自己起的名就存下来', () => {
    expect(storedNameOf({ file: '市场分析.md', kind: 'markdown', name: '市场分析' })).toBeUndefined()
    expect(storedNameOf({ file: '市场分析-2.md', kind: 'markdown', name: '市场分析' })).toBe('市场分析')
  })
})

describe('建卡时铸的默认名（v1.54）', () => {
  it('第一张就是类型名，第二张起带序号', () => {
    expect(autoNameOf('文本', 1)).toBe('文本')
    expect(autoNameOf('文本', 2)).toBe('文本2')
    expect(autoNameOf('应用', 17)).toBe('应用17')
    // 序号 0 与负数不是这一族的用法：照第一张处理，不产出 `文本0`。
    expect(autoNameOf('文本', 0)).toBe('文本')
  })

  it('铸出来的是**产物文件名**，所以推名与存名两条判据都天然成立', () => {
    // `文本1.md` 落座之后：显示名推出来就是它，记录里一个 `name` 都不用写。
    expect(cardNameOf({ file: '文本1.md', kind: 'markdown' })).toBe('文本1')
    expect(storedNameOf({ file: '文本1.md', kind: 'markdown', name: '文本1' })).toBeUndefined()
    // 应用同理：文件夹 `应用1`，入口页跟着它。
    expect(cardNameOf({ file: '应用1/index.html', kind: 'app' })).toBe('应用1')
  })
})
