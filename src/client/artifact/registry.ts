/**
 * dsh-canvas — 预览注册表（F3.8）。
 *
 * 双击一张卡打开它的产物，而**打开的是什么**由产物的 kind 决定——不是由一个大组件里的
 * `if (kind === …)` 决定。这张表就是那条分派：一行一个预览器，每行只说它认领哪些 kind。
 *
 * 它是「宿主的形态注册表」在视图层的对偶：那边把**证据**映射成 kind
 * （`core/artifact/kind-registry.ts` 的 `detectKind`），这边把 kind 映射成预览器。
 * 两张表都不在自己之外开分支——加一种形态意味着两边各加一行，而不是去改三个函数里的
 * 第四处 `if`。
 *
 * 表里**没有能力**。预览器能做什么（能否就地改文本、有没有一个能对话的页面帧）由它的
 * 组件自己决定，按钮与状态也住在它自己的文件里——见 `chrome.tsx` 的三个插槽与
 * `editing/`、`element-pick/`。这里只回答一个问题：这个 kind 归谁画。
 *
 * 两条查询函数是调用方唯一该碰的东西：
 *
 * | 调用方 | 问的 |
 * |---|---|
 * | 弹窗（`artifact-view.tsx`） | `viewerFor` 挑出正文那个组件 |
 * | 控制带（`card-overlay.tsx`） | 不问这里——「产物是不是它自己的文字」是 kind 表上的
 *   事实（`core/artifact/kind-registry.ts` 的 `isDirectTextKind`），两边读同一份 |
 * | 注册表自己（与本文件的测试） | `viewerIdFor` 看某个 kind 落到谁手上 |
 */
import { dataViewer } from './viewers/data-viewer.tsx'
import { deckViewer } from './viewers/deck-viewer.tsx'
import { designViewer } from './viewers/design/design-viewer.tsx'
import { audioViewer, imageViewer, videoViewer } from './viewers/media-viewer.tsx'
import { markdownViewer } from './viewers/markdown-viewer.tsx'
import { textViewer } from './viewers/text-viewer.tsx'
import type { ViewerId, ViewerRegistration } from './viewers/types.ts'

export type { ViewerId, ViewerProps, ViewerRegistration } from './viewers/types.ts'

/**
 * 全部预览器。
 *
 * 顺序**不影响**结果（兜底由 `fallback` 标出来，不靠排在最后），所以这张表可以按可读性
 * 排：先按内容的形态，兜底垫底。装配的可查性由测试钉住——恰好一条兜底。
 */
export const VIEWER_REGISTRY: readonly ViewerRegistration[] = [
  markdownViewer,
  imageViewer,
  dataViewer,
  videoViewer,
  audioViewer,
  deckViewer,
  designViewer,
  textViewer,
]

/**
 * 哪个预览器接这个 kind。
 *
 * 先问非兜底的条目，都不认领才落到兜底：这样「加一种形态」不会因为注册表的排列顺序而静默
 * 失效。纯且全：任何 kind id 都有答案，所以一张卡离「弹窗空白」永远差着一条注册项的距离，
 * 而不是差着一个未处理的 kind。
 *
 * @param kind - 产物读盘时分类出的 kind id。
 */
export function viewerFor(kind: string): ViewerRegistration {
  return VIEWER_REGISTRY.find((entry) => entry.fallback !== true && entry.claims(kind)) ?? textViewer
}

/** 这个 kind 用哪个预览器 —— 见 {@link viewerFor}。 */
export function viewerIdFor(kind: string): ViewerId {
  return viewerFor(kind).id
}
