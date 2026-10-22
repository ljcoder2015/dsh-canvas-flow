/**
 * dsh-canvas — 媒体卡片画什么（F2.7）。
 *
 * 图片、视频、音频这三类产物的**内容就是画面本身**，而卡面原先只画「大纲行」——
 * 一张 PNG 的 `outline` 是空的（字节不是文本），于是图片卡上只剩「图片」两个字。
 * 所以这三类不画大纲，画产物自己：图片就是那张图，视频与音频就是各自的原生播放器。
 *
 * 这个文件只答两个问题，因为这两个都有理由不在 JSX 里随手写：
 *
 * 1. **画哪个元素**。三种形态各是一个元素，没有第四种；不是媒体的一律 `undefined`，
 *    好让卡片照旧走它本来那条分支（markdown / 设计 / 应用 / 大纲行）。清单只有这一份：
 *    `'image'` 这类字面量在 `card-tile.tsx` 里出现第二次，就是下一个
 *    `canvas-tab.ts` 的 `CLAIMABLE` 漏 `audio`——判定与认领各说各话，而且不报错。
 * 2. **谁吃指针**。有控件的元素（视频、音频）必须自己吃掉 `pointerdown`：卡片的指针是
 *    拖拽把柄（`setPointerCapture`），不吃掉的话按播放键会变成拖卡片、拖进度条会把
 *    这张卡从画布上拽走。图片没有控件，于是把指针让给卡片——点它＝选中、拖它＝拖卡，
 *    跟自己画上去的那张图没有区别。**双击那一路谁都不吃**：它留给卡片的「双击开全屏」
 *    （F3.8），而对媒体卡来说那正是「放大看」。
 *
 * 字节上限**不在这里，也不在客户端任何一处**：卡面不猜 host 会不会给字节，直接要一次，
 * 由 host 用它那个 `truncated` 答。客户端抄一份上限就是第二个来源，而两边早晚有一个是错的
 * （判据 `tests/client/canvas/card-tile.spec.ts` 会把抄回来的那一份抓出来）。
 */
import type { ArtifactView } from '../../../types.ts'
import { resolveKindId } from '../../../core/artifact/kind/kind-registry.ts'

/** 卡面为一种媒体形态画的东西。 */
export interface MediaFace {
  /** 画哪个元素——三种形态各一个，没有第四种。 */
  element: 'img' | 'video' | 'audio'
  /** 元素自带控件。这也正是「它自己吃指针」那条判断的由来（见文件头第 2 条）。 */
  controls: boolean
}

/** 形态 → 元素。**这是全客户端唯一一处**媒体形态的名字。 */
const FACES: ReadonlyMap<string, MediaFace> = new Map<string, MediaFace>([
  ['image', { element: 'img', controls: false }],
  ['video', { element: 'video', controls: true }],
  ['audio', { element: 'audio', controls: true }],
])

/**
 * 这个形态的卡面画什么；不是媒体就是 `undefined`（卡片照旧画大纲行）。
 *
 * 与 `isMediaKind` 同一规矩：先 `resolveKindId` 折算——老记录可能盖着归并前的章，
 * 而 `MEDIA_KINDS` 里那三个恰好就是折算后的名字。
 */
export function mediaFaceOf(kind: string): MediaFace | undefined {
  return FACES.get(resolveKindId(kind))
}

/**
 * 卡面从产物视图里拿到的东西。
 *
 * `ready` 之外的三态是三种**不同的话**，所以不合并：产物还没生成、产物大到过不了
 * 那道 wire 上限、产物在但里面是空的（0 字节，或者读不出来）。前两种要在卡面上说出来，
 * 第三种退回大纲行——它本来就是「这张卡还没有东西」的那个样子。
 */
export type MediaAsset =
  | { status: 'ready'; dataUrl: string }
  | { status: 'absent' }
  | { status: 'too-large' }
  | { status: 'empty' }

/** 把 `readArtifact` 的答案翻成「有没有东西可画」。 */
export function mediaAssetOf(view: Pick<ArtifactView, 'present' | 'truncated' | 'dataUrl'>): MediaAsset {
  if (!view.present) return { status: 'absent' }
  if (view.dataUrl !== '') return { status: 'ready', dataUrl: view.dataUrl }
  // 存在、却没有载荷：host 只在这两种情况下这么答——读了但超过 wire 上限（`truncated`），
  // 或者那个文件本来就是空的。前者是「太大」、后者是「还没有东西」，是两句不同的话。
  return view.truncated ? { status: 'too-large' } : { status: 'empty' }
}
