/**
 * dsh-canvas — `@` 引用候选（F3.18 / F5.3）。
 *
 * 从 `card-overlay.tsx` 里请出来的**纯** half：它不碰 React、不碰 DOM，于是能在 node
 * 环境里真跑单测——这正是它必须搬家的原因，jsx 里的判据只能靠读源码钉。
 *
 * 一条候选说清三件事，而这三件事在 v1.49 之前是**同一个字符串**（卡片 id ＝ 产物路径），
 * 解耦之后就再也不能混用：
 *
 * - **插入提示词的是 `@产物路径`**（`mention`）——模型按路径 `read`，路径必须是盘上
 *   真实的那一份。v1.49 之前这里拿卡片 id 当路径用，解耦之后那串 6 位随机字母指向的
 *   是一个不存在的文件——本模块存在的第一理由就是把这两件事分开。
 * - **显示的是卡片名**（F1.12）——用户起的名字，或按产物推出来的那个；不是 id，也不
 *   一定是路径最后一段（应用卡是「应用1」而不是「index.html」）。
 * - **缩略图走卡片 id**——读产物那条通道认的是卡，不认路径；所以候选得把 id 也带上。
 */
import { formatFileMention } from '../../../core/artifact/prompt/file-reference.ts'
import { referenceTypeOf } from '../../../core/artifact/prompt/prompt-blocks.ts'
import type { ReferenceType } from '../../../core/artifact/prompt/prompt-blocks.ts'

/** 一个能被 `@` 的卡片，按调用方知道的三件事说清自己。 */
export interface ReferenceCandidate {
  /** 座位 id——缩略图那条通道认它，提示词不认它。 */
  readonly id: string
  /** 产物路径（工作区相对）——`@` 记号里写的是它。 */
  readonly file: string
  /** 卡片名（F1.12）——候选行显示的是它。 */
  readonly name: string
}

/** One `@` option the menu renders. */
export interface ReferenceOption {
  /** 工作区相对路径（去引号的那份）——tooltip 与缩略图记账都用它。 */
  readonly path: string
  /** 这条路径背后的卡——缩略图走读产物通道时要拿它当 cardId。 */
  readonly cardId: string
  /** 落进提示词的那串记号（`@path` / `@"my brief.md"`）。 */
  readonly mention: string
  /** 显示名：卡片名（F1.12），不是 id 也不是路径本身。 */
  readonly label: string
  /** 引用类型——按扩展名定（`referenceTypeOf`），决定标签的长相。 */
  readonly type: ReferenceType
  /** 这张卡已经引用的来源，还是画布上别的卡片。 */
  readonly fromMaterial: boolean
}

/** 一次最多几条候选：菜单是挑东西的，不是列清单的。 */
export const REFERENCE_LIMIT = 8

/**
 * `@` 能引用哪些东西：**这张卡已有的引用来源在前**（它们的关系是板上画着的），画布其余
 * 卡片在后。两处按**路径**去重（同一份产物不会出两条候选），再按查询过滤、截到上限。
 *
 * 过滤比的是 `mention`（那串 `@路径`）：用户正在写的本来就是记号本身，按显示名过滤反而
 * 会出现「菜单里高亮的那条与插进去的东西对不上」。
 */
export function referenceOptions(
  owned: readonly ReferenceCandidate[],
  others: readonly ReferenceCandidate[],
  query: string,
): ReferenceOption[] {
  const seen = new Set<string>()
  const all: ReferenceOption[] = []
  const add = (candidate: ReferenceCandidate, fromMaterial: boolean): void => {
    if (seen.has(candidate.file)) return
    seen.add(candidate.file)
    const mention = formatFileMention({ path: candidate.file, kind: 'file' })
    if (mention === undefined) return
    all.push({
      path: candidate.file,
      cardId: candidate.id,
      mention,
      label: candidate.name,
      type: referenceTypeOf(candidate.file),
      fromMaterial,
    })
  }
  for (const entry of owned) add(entry, true)
  for (const entry of others) add(entry, false)
  const needle = query.trim().toLowerCase()
  if (needle === '') return all.slice(0, REFERENCE_LIMIT)
  return all.filter((option) => option.mention.toLowerCase().includes(needle)).slice(0, REFERENCE_LIMIT)
}
