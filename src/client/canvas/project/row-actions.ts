/**
 * dsh-canvas — 画布行操作菜单的**内容**（F1.5 修订）。
 *
 * 菜单长什么样交给 canvas-menu.tsx 里的宿主 `Menu` 去画；「该有哪几行、每行叫什么、
 * 哪一行是破坏性的」是纯策略，单独放一个不碰宿主原语的模块——于是它可以被单测直接
 * 跑，而不必把一个浏览器浮层原语连同它的依赖（React、react-dom、一堆 CSS module）
 * 拖进 Node 环境里。
 *
 * 两个动作本身说的是同一件事的两半：**打开画布目录**（这张画布在磁盘上的哪个位置）
 * 与**删除画布**（怎么把它从列表里拿掉）。
 */
import type { zh } from '../../ui/locales.ts'

/** 画布行能给出的动作。 */
export type RowActionId = 'open' | 'remove'

/**
 * 每个动作的文案键与它是不是破坏性的。
 *
 * `danger` 是给宿主 `Menu` 的：它据此把那一行连同它的图形一起染成错误色、悬停时
 * 换成警告底。删除是用户自己点下去的动作，不是系统报的错——所以这里只让它「看起来
 * 更需要想一下」，而不是做成告警横幅。
 */
export const ROW_ACTIONS: Record<RowActionId, { label: keyof typeof zh; danger: boolean }> = {
  open: { label: 'canvas.menu.open', danger: false },
  remove: { label: 'canvas.menu.remove', danger: true },
}

/**
 * 这一行该给出哪几个动作，按显示顺序。
 *
 * **「打开画布目录」只在真的打得开时才有**：`app` 是宿主报回来的文件管理器标识，
 * 空串表示这台部署打不开目录（「在应用中打开」路由不在，或者系统里连 xdg-open 都
 * 没有）。那时整行不给——一枚点下去只会报错的按钮比没有按钮更糟。
 *
 * @param app - 宿主这台机器上的文件管理器标识；空串表示打不开目录。
 * @returns 动作 id，按显示顺序。
 */
export function rowActions(app: string): readonly RowActionId[] {
  return app === '' ? ['remove'] : ['open', 'remove']
}
