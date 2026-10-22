/**
 * 产物按类型分目录（F1.13）在 Host 侧的接线。
 *
 * 策略本身已经由 `tests/core/canvas/artifact-folders.spec.ts` 穷举验过（纯函数 +
 * 注入副作用的落盘）。这里只剩「有没有真的接上」——而这一层的漏法全都是**静默**的：
 *
 * - `readBoard` 忘了先整理 ⇒ 板面照画，只是目录永远不整理（用户看不到任何错误）；
 * - 迁移用 `write` 而不是 `renameEntry` ⇒ 文件被「读成文本再写回去」，二进制当场损坏；
 * - 先写记录后搬盘 ⇒ 记录指向一个还不存在的路径，一次失败就留下一张幽灵卡；
 * - `write` 不建父目录 ⇒ 新卡的种子文字写不进去（`docs/文本1.md` 的父目录还不存在）；
 * - 建卡/脚手架自己拼目录名 ⇒ 改名时漏一处，某类产物继续平铺在根上。
 *
 * 判据读源码文本（与 `card-import.spec.ts` 同一个理由）：这一层要跑起来得有一整套
 * 宿主装配，而漏接的表现恰恰是「装配好了也照跑不误」。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CANVAS = readFileSync(new URL('../../../src/host/runtime/canvas-runtime.ts', import.meta.url), 'utf8')
const CARD = readFileSync(new URL('../../../src/host/runtime/card-runtime.ts', import.meta.url), 'utf8')
const IO = readFileSync(new URL('../../../src/core/artifact/io/artifact-io.ts', import.meta.url), 'utf8')
const VIEW = readFileSync(new URL('../../../src/client/canvas/board/canvas-view.tsx', import.meta.url), 'utf8')

/** 抓一个方法的函数体（从签名到同级的收尾大括号）。 */
function bodyOf(source: string, signature: RegExp, what: string): string {
  const match = signature.exec(source)
  if (match === null) throw new Error(`${what} 的形状变了，这条判据要跟着改`)
  const start = match.index
  const end = source.indexOf('\n  }', start)
  if (end === -1) throw new Error(`${what} 的收尾大括号找不到，这条判据要跟着改`)
  return source.slice(start, end)
}

const readBoard = (): string => bodyOf(CANVAS, /async readBoard\(/, '`readBoard`')
const foldArtifacts = (): string => bodyOf(CANVAS, /private async foldArtifacts\(/, '`foldArtifacts`')
const runFold = (): string => bodyOf(CANVAS, /private async runFold\(/, '`runFold`')
const write = (): string => bodyOf(IO, /\s{2}async write\(/, '`ArtifactIo.write`')
const writeScaffold = (): string => bodyOf(IO, /async writeScaffold\(/, '`writeScaffold`')
const ensureFolder = (): string => bodyOf(IO, /async ensureFolder\(/, '`ensureFolder`')
const scanProject = (): string => bodyOf(IO, /async scanProject\(/, '`scanProject`')
/** 顶层函数（0 缩进的收尾大括号）。 */
function topLevelOf(source: string, signature: RegExp, what: string): string {
  const match = signature.exec(source)
  if (match === null) throw new Error(`${what} 的形状变了，这条判据要跟着改`)
  const start = match.index
  const end = source.indexOf('\n}', start)
  if (end === -1) throw new Error(`${what} 的收尾大括号找不到，这条判据要跟着改`)
  return source.slice(start, end)
}

/**
 * `spawnFromSpec` 是一个 `useCallback` 箭头函数：它自己的收尾是 `  )` 而不是 `  }`，
 * 所以按依赖数组那一行切。顺便也因此盯住了「依赖里带着 cards」这件事。
 */
const spawnFromSpec = (): string => {
  const match = /const spawnFromSpec = useCallback\(/.exec(VIEW)
  if (match === null) throw new Error('`spawnFromSpec` 的形状变了，这条判据要跟着改')
  const end = VIEW.indexOf('\n    [bridge, cards, projectId],', match.index)
  if (end === -1) throw new Error('`spawnFromSpec` 的依赖数组找不到，这条判据要跟着改')
  return VIEW.slice(match.index, end)
}
const freeCardName = (): string => topLevelOf(VIEW, /function freeCardName\(/, '`freeCardName`')
const freeFolderName = (): string => topLevelOf(VIEW, /function freeFolderName\(/, '`freeFolderName`')
const scaffoldWebapp = (): string => bodyOf(CARD, /async scaffoldWebapp\(/, '`scaffoldWebapp`')
const scaffoldDesign = (): string => bodyOf(CARD, /async scaffoldDesign\(/, '`scaffoldDesign`')

describe('什么时候整理：画板那一刻，且只整理一次', () => {
  it('readBoard 在算卡片**之前**整理——搬完记录已经指向新路径，这一趟读到的就是结果', () => {
    const body = readBoard()
    const fold = body.indexOf('this.foldArtifacts(')
    const cards = body.indexOf('this.cardsOf(')
    expect(fold).toBeGreaterThan(0)
    expect(cards).toBeGreaterThan(fold)
  })

  it('并发画板等同一个 Promise，而不是各搬一遍（两个座位会同时画同一张板）', () => {
    const body = foldArtifacts()
    expect(body).toMatch(/this\.folded\.get\(/)
    expect(body).toMatch(/this\.folded\.set\(/)
    // 值必须是 Promise：拿到布尔就又变成「第二次直接返回，搬了一半也当自己搬完了」。
    expect(CANVAS).toMatch(/Map<ProjectId, Promise<void>>/)
  })

  it('失败不缓存：只读部署或一次权限抖动之后，下一次画板还会再试', () => {
    expect(foldArtifacts()).toMatch(/this\.folded\.delete\(/)
  })
})

describe('怎么搬：整条目、问磁盘、一条一条来', () => {
  it('计划与落盘都走 core 那两个函数，不在宿主里再写一套', () => {
    const body = runFold()
    expect(body).toMatch(/planFolds\(/)
    expect(body).toMatch(/applyFoldPlans\(/)
  })

  it('搬动是 renameEntry，不是 write——文本写会把图片和视频读成 UTF-8 再写回去', () => {
    const body = runFold()
    expect(body).toMatch(/io\.renameEntry\(/)
    expect(body, '迁移不许走文本写').not.toMatch(/io\.write\(/)
  })

  it('撞名与存在性问磁盘（presenceOf），不是板面', () => {
    expect(runFold()).toMatch(/presenceOf\(project\.root/)
  })

  it('类型目录先建出来（rename 到一个不存在的目录是 ENOENT）', () => {
    expect(runFold()).toMatch(/io\.ensureFolder\(project\.root/)
  })

  it('路径改写按段比对，落在条目下面的每一条都跟着走', () => {
    expect(runFold()).toMatch(/foldedPathOf\(current, outcome\.applied\)/)
  })

  it('先搬盘、后写记录、最后写投影（反了就是一张指向不存在路径的卡）', () => {
    const body = runFold()
    const move = body.indexOf('applyFoldPlans(')
    const put = body.indexOf('this.cards.put(')
    const persist = body.indexOf('this.persist(')
    expect(move).toBeGreaterThan(0)
    expect(put).toBeGreaterThan(move)
    expect(persist).toBeGreaterThan(put)
  })

  it('一件都没搬成就不写投影（否则每次画板都在写一次没变化的 board.json）', () => {
    expect(runFold()).toMatch(/outcome\.applied\.length === 0\) return/)
  })
})

describe('新产物落在哪儿：目录名只有一份真源', () => {
  it('宿主写文件前先把父目录建出来——`docs/文本1.md` 的 `docs` 此刻还不存在', () => {
    const body = write()
    const folder = body.indexOf('this.ensureFolder(')
    const seam = body.indexOf('this.ctx.fs.writeText(')
    expect(folder).toBeGreaterThan(0)
    expect(seam).toBeGreaterThan(folder)
  })

  it('脚手架同样先建目录（`apps/应用1` 这一层也是新的）', () => {
    expect(writeScaffold()).toMatch(/this\.ensureFolder\(root, dirnameOf\(folder\)/)
  })

  it('建目录也守那三样：包含性、只读、另一个执行世界', () => {
    const body = ensureFolder()
    expect(body).toMatch(/this\.ctx\.fs\.contains\(/)
    expect(body).toMatch(/read-only/)
    expect(body).toMatch(/processPathOf\(/)
    expect(body).toMatch(/mkdir\(/)
  })

  it('客户端建卡用 artifactPathOf，不自己拼 `${folder}/`', () => {
    expect(spawnFromSpec()).toMatch(/artifactPathOf\(spec\.kind/)
    expect(freeCardName()).toMatch(/artifactPathOf\(kind/)
    expect(freeFolderName()).toMatch(/artifactFolderPathOf\(kind/)
    // 去掉注释再判：注释里举例写 `docs/文本1.md` 是好事，代码里拼路径才是坏事。
    const code = spawnFromSpec()
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(code, '目录名只从 artifact-folders 取，客户端不许自己拼带斜杠的路径').not.toMatch(/`[^`]*\/[^`]*`/)
  })

  it('两个脚手架把类型目录交给 host 决定（客户端只给名字）', () => {
    expect(scaffoldWebapp()).toMatch(/artifactFolderPathOf\('app'/)
    expect(scaffoldDesign()).toMatch(/artifactPathOf\('design'/)
    // 客户端传的仍然是裸名字：`freeFolderName` / `freeCardName` 不带路径。
    expect(spawnFromSpec()).toMatch(/scaffoldWebapp\(projectId, freeFolderName\(/)
    expect(spawnFromSpec()).toMatch(/scaffoldDesign\(projectId, freeCardName\(/)
  })

  it('绑定已有目录时把类型目录当透明壳：`apps/应用1/index.html` 也要被发现', () => {
    const body = scanProject()
    expect(body).toMatch(/isArtifactFolder\(/)
    expect(body, '扫描器不许手写目录名单').not.toMatch(/'docs'|'images'|'apps'/)
  })
})
