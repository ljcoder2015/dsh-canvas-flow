/**
 * 产物按卡片类型分目录（F1.13）的判据。
 *
 * 这一层要防的不是「搬错一个文件」，而是**同一件事有两个来源**：目录名如果被
 * 客户端、宿主、扫描器各拼一遍，加一种形态时总有一处会漏——而漏了不报错，只是
 * 那一类产物继续平铺在根上（或者扫描时整目录消失）。
 *
 * 所以判据分两组：
 *
 * - **映射**：每个内置 kind 都有目录、目录名唯一、老 kind 折算后也落对地方；
 * - **迁移**：根条目怎么分组、什么时候不搬、撞名怎么退让、失败怎么收场。
 */
import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_FOLDERS,
  applyFoldPlans,
  artifactFolderOf,
  artifactFolderPathOf,
  artifactPathOf,
  foldedPathOf,
  isArtifactFolder,
  planFolds,
  topSegmentOf,
  type FoldCard,
  type FoldPlan,
} from '../../../../src/core/canvas/project/artifact-folders.ts'
import { BUILTIN_KINDS } from '../../../../src/core/artifact/kind/kind-registry.ts'

/** 一张卡片的记录，只填迁移关心的三格。 */
const card = (id: string, file: string, kind: string): FoldCard => ({ id, file, kind })

/** 只看「搬」的那几条，按 from 取。 */
function moveOf(plans: readonly FoldPlan[], from: string): Extract<FoldPlan, { action: 'move' }> {
  const found = plans.find((plan) => plan.action === 'move' && plan.from === from)
  if (found === undefined || found.action !== 'move') throw new Error(`${from} 没有被安排搬迁：${JSON.stringify(plans)}`)
  return found
}

/** 只看「不搬」的那一条，按 from 取。 */
function skipOf(plans: readonly FoldPlan[], from: string): Extract<FoldPlan, { action: 'skip' }> {
  const found = plans.find((plan) => plan.action === 'skip' && plan.from === from)
  if (found === undefined || found.action !== 'skip') throw new Error(`${from} 没有被跳过：${JSON.stringify(plans)}`)
  return found
}

describe('目录名只有一份真源', () => {
  it('每个内置形态都有归属——新增一种 kind 时漏了这张表，产物会静默留在根上', () => {
    for (const definition of BUILTIN_KINDS) {
      expect(ARTIFACT_FOLDERS[definition.id], `kind ${definition.id} 没有目录`).toBeTypeOf('string')
    }
  })

  it('目录名互不相同（两种形态挤进同一个目录就再也分不出来）', () => {
    const names = Object.values(ARTIFACT_FOLDERS)
    expect(new Set(names).size).toBe(names.length)
  })

  it('目录名是英文小写（项目结构会被 git 与别的编辑器读到，不是界面文案）', () => {
    for (const name of Object.values(ARTIFACT_FOLDERS)) expect(name).toMatch(/^[a-z]+$/)
  })

  it('老记录上的 kind 先折算：`site` / `webapp` / `html-deck` 都落 apps', () => {
    for (const legacy of ['site', 'webapp', 'html-deck']) expect(artifactFolderOf(legacy)).toBe('apps')
  })

  it('未知形态没有目录：猜一个名字比留在根上更坏', () => {
    expect(artifactFolderOf('deployment-own-kind')).toBeUndefined()
    expect(artifactPathOf('deployment-own-kind', 'x', 'bin')).toBe('x.bin')
  })

  it('路径组合：文件形态与目录形态各一条', () => {
    expect(artifactPathOf('markdown', '文本1', 'md')).toBe('docs/文本1.md')
    expect(artifactPathOf('image', '图片1', 'png')).toBe('images/图片1.png')
    expect(artifactFolderPathOf('app', '应用1')).toBe('apps/应用1')
    expect(artifactFolderPathOf('design', '设计1')).toBe('designs/设计1')
  })

  it('认得出哪些路径段是类型目录（扫描器据此把壳看穿）', () => {
    expect(isArtifactFolder('docs')).toBe(true)
    expect(isArtifactFolder('images')).toBe(true)
    expect(isArtifactFolder('产品文档')).toBe(false)
    expect(topSegmentOf('docs/文本1.md')).toBe('docs')
    expect(topSegmentOf('文本1.md')).toBe('文本1.md')
  })
})

describe('迁移计划：一个根条目一件', () => {
  it('根上的文本进 docs', () => {
    const plans = planFolds([card('a', '产品需求文档.md', 'markdown')])
    const move = moveOf(plans, '产品需求文档.md')
    expect(move.to).toBe('docs/产品需求文档.md')
    expect(move.folder).toBe('docs')
    expect(move.cards).toEqual(['a'])
  })

  it('应用目录整块搬：入口页与它的兄弟文件在同一组里，只搬一次', () => {
    const plans = planFolds([
      card('a', 'dsh-canvas-应用/index.html', 'app'),
      card('b', 'dsh-canvas-应用/styles.css', 'file'),
    ])
    // 两种形态挂在同一个根条目上——这正是「不该搬」的情形之一：搬去 apps 会把
    // 那份 css 的归属说成「文件」，搬去 files 会拆掉应用。
    expect(skipOf(plans, 'dsh-canvas-应用').reason).toBe('mixed-kinds')
  })

  it('同一形态的应用目录：整块进 apps，里面每条路径都跟着改', () => {
    const plans = planFolds([
      card('a', 'dsh-canvas-应用/index.html', 'app'),
      card('b', 'dsh-canvas-应用/pages/detail.html', 'app'),
    ])
    const move = moveOf(plans, 'dsh-canvas-应用')
    expect(move.to).toBe('apps/dsh-canvas-应用')
    expect([...move.cards].sort()).toEqual(['a', 'b'])
    expect(foldedPathOf('dsh-canvas-应用/pages/detail.html', [move])).toBe('apps/dsh-canvas-应用/pages/detail.html')
  })

  it('已经在类型目录里的一律不动——迁移因此可以反复跑', () => {
    const plans = planFolds([card('a', 'docs/文本1.md', 'markdown'), card('b', 'apps/应用1/index.html', 'app')])
    expect(skipOf(plans, 'docs').reason).toBe('already-folded')
    expect(skipOf(plans, 'apps').reason).toBe('already-folded')
    expect(plans.some((plan) => plan.action === 'move')).toBe(false)
  })

  it('根上的入口页不搬：整个画布就是它的产物，搬走等于拆了它', () => {
    const plans = planFolds([card('a', 'index.html', 'app')])
    expect(skipOf(plans, 'index.html').reason).toBe('root-entry')
  })

  it('指向根自己的记录（空串 / 点）没有可搬的条目', () => {
    expect(skipOf(planFolds([card('a', '', 'folder')]), '').reason).toBe('root-entry')
    expect(skipOf(planFolds([card('a', '.', 'folder')]), '.').reason).toBe('root-entry')
  })

  it('形态没有目录就留着（部署自定义的 kind 不该被猜一个目录塞进去）', () => {
    const plans = planFolds([card('a', '自定义.bin', 'deployment-own-kind')])
    expect(skipOf(plans, '自定义.bin').reason).toBe('no-folder')
  })

  it('用户自己的子目录按整块算：`decks/intro.html` 搬的是 decks，不是那一页', () => {
    const move = moveOf(planFolds([card('a', 'decks/intro.html', 'app')]), 'decks')
    expect(move.to).toBe('apps/decks')
  })

  it('四种媒体各进各的目录（手写名单少一种，那一类就永远平铺在根上）', () => {
    const plans = planFolds([
      card('a', '图片.png', 'image'),
      card('b', '视频.mp4', 'video'),
      card('c', '音频.mp3', 'audio'),
      card('d', '设计稿.design', 'design'),
      card('e', '表格.csv', 'data'),
      card('f', '说明.txt', 'file'),
      card('g', '素材', 'folder'),
    ])
    expect(moveOf(plans, '图片.png').to).toBe('images/图片.png')
    expect(moveOf(plans, '视频.mp4').to).toBe('videos/视频.mp4')
    expect(moveOf(plans, '音频.mp3').to).toBe('audio/音频.mp3')
    expect(moveOf(plans, '设计稿.design').to).toBe('designs/设计稿.design')
    expect(moveOf(plans, '表格.csv').to).toBe('data/表格.csv')
    expect(moveOf(plans, '说明.txt').to).toBe('files/说明.txt')
    expect(moveOf(plans, '素材').to).toBe('folders/素材')
  })

  it('板面读出来是老 kind 也照样搬（`site` 是 `app` 的旧章）', () => {
    expect(moveOf(planFolds([card('a', 'dsh-canvas-应用/index.html', 'site')]), 'dsh-canvas-应用').to).toBe(
      'apps/dsh-canvas-应用',
    )
  })
})

describe('路径改写按段比对', () => {
  const moves = [{ from: '图片.png', to: 'images/图片.png' }]

  it('整条相等', () => {
    expect(foldedPathOf('图片.png', moves)).toBe('images/图片.png')
  })

  it('它下面的路径跟着走', () => {
    expect(foldedPathOf('图片.png/内页.html', moves)).toBe('images/图片.png/内页.html')
  })

  it('名字像而已的不跟：`图片.png.bak` 是另一件东西', () => {
    expect(foldedPathOf('图片.png.bak', moves)).toBe('图片.png.bak')
  })

  it('没被搬的原样返回', () => {
    expect(foldedPathOf('别的.md', moves)).toBe('别的.md')
  })
})

describe('落盘：撞名退让、失败留着', () => {
  /** 一个记账用的假磁盘：present 由 `taken` 决定，move 只记录。 */
  function effects(taken: readonly string[] = []) {
    const occupied = new Set(taken)
    const moves: { from: string; to: string }[] = []
    const prepared: string[] = []
    const warned: string[] = []
    return {
      moves,
      prepared,
      warned,
      deps: {
        present: async (path: string) => occupied.has(path),
        prepare: async (folder: string) => {
          prepared.push(folder)
        },
        move: async (from: string, to: string) => {
          moves.push({ from, to })
        },
        warn: (message: string) => {
          warned.push(message)
        },
      },
    }
  }

  const plan = (from: string, to: string, folder: string): FoldPlan => ({
    action: 'move',
    from,
    to,
    folder,
    kind: 'markdown',
    cards: [from],
  })

  it('目标被占就从 -2 起试', async () => {
    const harness = effects(['docs/文本.md'])
    const outcome = await applyFoldPlans([plan('文本.md', 'docs/文本.md', 'docs')], harness.deps)
    expect(outcome.applied).toEqual([{ from: '文本.md', to: 'docs/文本.md-2' }])
  })

  it('目标与 -2 都被占就继续往下', async () => {
    const harness = effects(['docs/文本.md', 'docs/文本.md-2'])
    const outcome = await applyFoldPlans([plan('文本.md', 'docs/文本.md', 'docs')], harness.deps)
    expect(outcome.applied[0]?.to).toBe('docs/文本.md-3')
  })

  it('目录先建一次，同一目录下的第二件不再建', async () => {
    const harness = effects()
    await applyFoldPlans(
      [plan('甲.md', 'docs/甲.md', 'docs'), plan('乙.md', 'docs/乙.md', 'docs'), plan('丙.png', 'images/丙.png', 'images')],
      harness.deps,
    )
    expect(harness.prepared).toEqual(['docs', 'images'])
  })

  it('一件搬不动，其它照搬——整理目录失败不该带走整张板', async () => {
    const harness = effects()
    const deps = {
      ...harness.deps,
      move: async (from: string, to: string) => {
        if (from === '甲.md') throw new Error('EPERM')
        harness.moves.push({ from, to })
      },
    }
    const outcome = await applyFoldPlans([plan('甲.md', 'docs/甲.md', 'docs'), plan('乙.md', 'docs/乙.md', 'docs')], deps)
    expect(outcome.applied).toEqual([{ from: '乙.md', to: 'docs/乙.md' }])
    expect(outcome.failed).toEqual([{ from: '甲.md', reason: 'move-failed' }])
    expect(harness.warned).toHaveLength(1)
  })

  it('全是 skip 时一件都不动', async () => {
    const harness = effects()
    const outcome = await applyFoldPlans([{ action: 'skip', from: 'docs', reason: 'already-folded' }], harness.deps)
    expect(outcome.applied).toEqual([])
    expect(outcome.failed).toEqual([])
    expect(harness.moves).toEqual([])
  })
})
