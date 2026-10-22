/**
 * dsh-canvas — 一笔还没说完的元素选择，比弹窗活得久一点（F3.14）。
 *
 * 弹窗是**按卡挂载**的：关掉就整棵卸掉，`useElementPick` 里的状态跟着没。而元素选择这条线
 * 恰恰要跨过这段「没」——选好一个元素、写下要求、发给这张卡的会话，会话要跑一轮才把产物
 * 改出来。用户在这段时间里合上预览（去看别的卡、或者就是手滑）再打开，该看见的是「还在改
 * 这个元素、要改的是这一段」，而不是一张什么都没发生过的干净页面。
 *
 * 所以这笔事存在**模块级**的一张表里，按画布 + 卡片记。它不是持久化：不落盘、不跨页刷新，
 * 只是比组件活得久。什么时候丢掉，只有两件事说了算——用户明确放手（框上的 × / Esc），
 * 或者**这笔改动已经落地**（产物换了新的一份，圈与框都完成了它们的使命）。
 *
 * 纯模块（不碰 React、不碰宿主 UI 原语），所以它能在 node 里直接测：这张表的全部行为就是
 * 「记、读、丢」。
 */
import type { PickRect, PickTarget } from '../../../core/artifact/kind/preview-picker.ts'

/**
 * 记下来的是这一笔的全部，够重开时把画面摆回去。
 *
 * `draft` 与 `sent` 分开记，是为了分辨「用户发完之后又在框里写了下一句」：那时改动落地也
 * 不能替他合上框（那句话会没）。`from` 是发出要求那一刻的产物文本——回来时文本变了才算
 * 改动落地。
 */
export interface PendingPick {
  /** 圈住的那个元素（记号、路径、源码、位置）。 */
  readonly target: PickTarget
  /** 选中那一刻帧自己的矩形（视口坐标）。 */
  readonly frame: PickRect
  /** 选中那一刻产物的文本：它一变，旧坐标就指着别的东西了。 */
  readonly viewText: string
  /** 提示词框里的全文（节点源码嵌在里面）。 */
  readonly draft: string
  /** 已经发出去的那一份（还没发过就是空串）。 */
  readonly sent: string
  /** 这笔改动还在跑吗——流光与「重开就恢复」都以它为准。 */
  readonly awaiting: boolean
  /** 发出要求那一刻的产物文本。 */
  readonly from: string
}

/** 一笔选择记在哪个键下：一张卡一个框。 */
export function pendingKey(projectId: string, cardId: string): string {
  return projectId + '/' + cardId
}

const kept = new Map<string, PendingPick>()

/** 这一笔（如果没有）。 */
export function readPending(key: string): PendingPick | undefined {
  return kept.get(key)
}

/** 记下这一笔。存的是**副本**：调用方那边还在改的那个对象与这里无关。 */
export function writePending(key: string, value: PendingPick): void {
  kept.set(key, { ...value })
}

/** 放手：用户关掉了框，或者这笔改动已经落地。 */
export function dropPending(key: string): void {
  kept.delete(key)
}

/** 忘掉全部（测试用；也是「这一层不该有比这个更长的记忆」的明证）。 */
export function forgetPending(): void {
  kept.clear()
}
