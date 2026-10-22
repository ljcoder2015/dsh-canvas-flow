/**
 * dsh-canvas — 滚轮该归谁：画布的手势，与「指针底下自己会滚的地方」之间的那条界线。
 *
 * 画布把整块表面都拿来平移（`canvas-view.tsx` 的 `surfaceWheel`），于是提示词输入框的
 * 正文、`@` 候选与模型菜单这些**自己会滚**的地方也一并被卷走：用户在输入框里滚轮，
 * 动的是画布。浏览器本来有一条规矩管这件事——**内层还有余量就内层滚**——可它在这儿
 * 不成立：React 的 wheel 监听挂在根容器上，画布这一层收到的永远是那一下，内层的滚动
 * 条根本没有先吃的机会。所以这条链要自己判，判据只有一句：
 *
 *   **指针底下是一处自己会滚的地方 ⇒ 那一滚归它，画布一个字都不动。**
 *
 * 认这几处用的是类名（与 `styles.ts` 一一对应），不是量它们的溢出量：量溢出要在每一次
 * 滚轮事件里读 `scrollHeight`，而那会逼出同步布局——平移恰恰是最受不了这一下的一处。
 * 何况输入框本来就**按设计**会滚（`max-height:120px; overflow:auto`），它当下滚不滚得
 * 动与「这一滚该不该归它」是两件事：内容短的时候滚轮在它上面什么也不做，正合直觉——
 * **画布不该从正在读提示词的人脚下滑走**（何况它滑走之后，那条带子也跟着离开视野）。
 *
 * 缩放不看这条线：`ctrl` / `⌘` + 滚轮是画布自己的手势（触控板捏合也走它），指针落在
 * 哪儿都一样。**判据在这里算，DOM 在读的那一侧认**（`tests/` 跑在 node 环境，没有 DOM
 * 可摆）。
 */
export type WheelOwner = 'zoom' | 'self' | 'board'

/** 画布以内、自己会滚的几处：提示词正文、`@` 候选菜单、模型菜单。 */
export const SELF_SCROLLING = '.dsh-canvas-promptbox-field,.dsh-canvas-refmenu,.dsh-canvas-modelmenu'

/**
 * 这一滚归谁。
 *
 * 缩放压过一切（它是画布的手势，不因指针落在哪儿而变）；plain 滚轮则先问内层。
 */
export function wheelOwner(input: { zoom: boolean; selfScrolling: boolean }): WheelOwner {
  if (input.zoom) return 'zoom'
  return input.selfScrolling ? 'self' : 'board'
}

/**
 * 归画布的这一滚，画布要不要**替浏览器做主**——也就是 `preventDefault()` 加
 * `stopPropagation()` 两下都做。
 *
 * 接着上面那句话往下问一层：滚轮归了画布，浏览器自己那手还算不算数？**画布接下的手势
 * 就不许它再往外走**。缩放这一档尤其绕不过去——`ctrl` / `⌘` + 滚轮在浏览器里本来就是
 * **页面缩放**（Chromium 里触控板捏合合成的也正是这样一条带 `ctrlKey` 的 wheel），不
 * 拦就等于「画布放大了一档，整个宿主页面也放大一档」：用户要的是看清画布，不是把插件
 * 连同对话一起放大。平移那一档同理——画布已经在动了，没有理由让外层再滚一遍。
 *
 * 两下都要做，分工不同：`preventDefault()` 挡的是**浏览器**的默认动作（页面缩放、滚动
 * 祖先容器），`stopPropagation()` 挡的是**继续往上冒泡**——事件从画布表面再往上走一层，
 * 宿主（以及将来这棵树里别处的滚轮监听）就会对同一滚再算一遍。
 *
 * 而归内层滚动盒子的那一滚**一个字都不碰**：滚动正是它的默认动作，拦下就等于那些盒子
 * 再也滚不动（这也正是这里要返回 `false` 的原因，不是「留一手」）。
 */
export function wheelSwallowed(owner: WheelOwner): boolean {
  return owner !== 'self'
}
