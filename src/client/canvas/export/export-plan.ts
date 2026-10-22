/**
 * dsh-canvas — 「这张卡点导出给什么」（F10.1，v1.59 → v1.83）。
 *
 * 到 v1.83，导出一共有五条实现：客户端本地的**文本排版**（v1.57）、**打包**（v1.58）、
 * **渲染**（v1.59）、**媒体原样下载**（v1.83），以及留给部署能力那一条（HTML / PNG 那类
 * 要真光栅化后端的）。而「给菜单还是给一击」与「走哪条通道」这两件事，此前是**分在两个
 * 文件里判的**：`card-overlay.tsx` 用 `isDirectTextKind` 决定出不出菜单，
 * `canvas-view.tsx` 用 `isBundleKind` 决定走哪条路。两条判据当时并不冲突（设计稿两种都不是）
 * ——但再加一条通道，它们立刻会开始各说各话：菜单里摆着「Figma 文件」，点下去走的却是部署
 * 那条线。这是这一仓最熟悉的那种坏法（同一个东西两个来源），所以在**加第三条通道之前**
 * 先把它们并成一份。
 *
 * 合并成的是**一个纯函数**：形态进去，「有没有得导、是菜单还是一击、每一行点下去叫什么」
 * 一起出来。谁认得哪几种格式一律从类型表（`core/artifact/kind-registry.ts`）与各自的格式表
 * 读；处理函数由调用方（画布那侧）注入——于是这一整套判据在 node 里就能穷举，不需要一个
 * React，也不需要真的导出一份东西。
 */
import { isBundleKind, isDesignKind, isDirectTextKind, isMediaKind, kindById } from '../../../core/artifact/kind/kind-registry.ts'
import type { ExportFormat } from '../../../types.ts'
import type { CanvasKey } from '../../ui/locales.ts'
import { DESIGN_EXPORT_FORMATS, DESIGN_EXPORT_LABEL, type DesignExportFormat } from './design-export.ts'
import { TEXT_EXPORT_FORMATS, TEXT_EXPORT_LABEL, type TextExportFormat } from './text-export.ts'

/** 菜单里的一行：叫什么、点下去做什么。 */
export interface ExportRow<F extends string = string> {
  /** 行的身份（格式名）——也用作 React 的 key。 */
  id: F
  label: CanvasKey
  run: () => void
}

/**
 * 那张卡片点导出之后的去向。
 *
 * 三种：**没有可导出的东西**（连那枚按钮都不该出现）、**一击**（点一下就是它）、
 * **菜单**（格式由用户点的那一行给）。
 *
 * 菜单那两种是「没有哪个格式能当默认」的形态——文本节点的四种文本格式、设计稿的四条出路，
 * 替用户猜一个就是把另外几样藏起来。一击那三种是「只有一件事可做」的形态：应用节点（整份
 * 产物一个包）、**媒体节点**（把产物原样下载，不转换——转换是把用户手里那一份换成另一份，
 * 不是他要的），以及其余形态（格式由类型表写死，从 v1.0 起就是这个样子）。
 */
export type ExportOffer =
  | { kind: 'none' }
  | { kind: 'one'; run: () => void }
  | { kind: 'menu'; menu: CanvasKey; rows: readonly ExportRow[] }

/**
 * 五条通道各自的落点，由调用方给。
 *
 * 分开五个而不是一个 `(channel, format) => void`：调用方那边的五个处理函数本来就各是各的
 * （读的东西不同、走的路不同），在这里再合成一个带 switch 的入口只是把分派写第二遍。
 */
export interface ExportHandlers {
  /** 应用节点：整份产物打成一个包。 */
  bundle: () => void
  /** 其余形态：交给部署的导出能力，格式是类型表里的第一个。 */
  host: (format: ExportFormat) => void
  /** 文本节点：客户端本地排版的四种格式。 */
  text: (format: TextExportFormat) => void
  /** 设计节点：客户端本地渲染的四条出路。 */
  design: (format: DesignExportFormat) => void
  /** 媒体节点（图片 / 视频 / 音频）：产物原样下载，格式就是它自己的格式。 */
  media: () => void
}

/** 一个形态点导出之后的样子。 */
export function exportOfferOf(kind: string, handlers: ExportHandlers): ExportOffer {
  // 顺序即判据：包（应用）优先于别的通道，文本与设计各认自己的形态——三条都是「关于形态的
  // 事实」，读的是类型表里那三个集合，所以与宿主那一侧的认定不可能分家。
  if (isBundleKind(kind)) return { kind: 'one', run: handlers.bundle }
  if (isDirectTextKind(kind)) {
    return {
      kind: 'menu',
      menu: 'canvas.export.menu',
      rows: rowsOf(TEXT_EXPORT_FORMATS, TEXT_EXPORT_LABEL, handlers.text),
    }
  }
  if (isDesignKind(kind)) {
    return {
      kind: 'menu',
      menu: 'canvas.export.menuDesign',
      rows: rowsOf(DESIGN_EXPORT_FORMATS, DESIGN_EXPORT_LABEL, handlers.design),
    }
  }
  // 媒体（图片 / 视频 / 音频）**先于**下面那条「取类型表第一个格式」：图片的类型表里写着
  // `png / svg`，那是**部署能力那条线**能把它转成什么（`canvas_export` 工具用的就是这一格），
  // 而不是这枚按钮该做的事。媒体卡的产物已经是一个文件，导出的正确含义是原样拿走——所以
  // 这条分派看的是「它是不是媒体」，不是「它能不能被转换」。
  if (isMediaKind(kind)) return { kind: 'one', run: handlers.media }
  const format = kindById(kind)?.exportFormats[0]
  // 没有可导出的格式（文件夹、未知格式）：那枚按钮不该出现。此前它靠「kind 不是 folder」
  // 硬挡着，于是视频卡片上有一枚点了什么都不发生的按钮——现在按**能不能导**判。
  return format === undefined ? { kind: 'none' } : { kind: 'one', run: () => handlers.host(format) }
}

/** 格式表 → 菜单行（表与文案一起给，免得两处各排一遍序）。 */
function rowsOf<F extends string>(
  formats: readonly F[],
  labels: Record<F, CanvasKey>,
  pick: (format: F) => void,
): ExportRow<F>[] {
  return formats.map((format) => ({ id: format, label: labels[format], run: () => pick(format) }))
}
