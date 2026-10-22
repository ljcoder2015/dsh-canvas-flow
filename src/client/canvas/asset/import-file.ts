/**
 * dsh-canvas — 把用户选中的一个本地文件送进画布（F2.7，v1.81）。
 *
 * 这一步只有三件事：**先照规矩验一遍**（免得把几十兆先编码再传输、最后被拒）、
 * **读成 base64**（浏览器手里只有字节，没有路径）、**交给宿主落盘**。判据全在
 * `core/canvas/import-plan.ts` 里，这里不重复任何一条——包括「什么算媒体」。
 *
 * 为什么先验一遍而不是让宿主拒：这个调用的载荷就是文件本身（base64 膨胀 4/3）。
 * 一个 80MB 的视频会先在内存里变成 107MB 的字符串再走 wire，然后被宿主一句「太大」
 * 退回来——用户等的是那几十秒，看到的是一句本可以在点下按钮的那一刻就说的话。
 */
import type { BoardCard } from '../../../types.ts'
import { importPlanOf, type ImportRefusal } from '../../../core/canvas/project/import-plan.ts'
import type { CanvasBridge } from '../../wire/bridge.ts'

/**
 * 一次导入的收场。
 *
 * 「被拒」不是异常：文件太大、扩展名不是媒体、选了个空文件——三件事都有各自的下一步
 * （压小、换一张、挑错文件了），所以它们走返回值，与「宿主抛错」那条路分开（本仓
 * `notice.ts` 里那条「被拒不是出错」的界线）。
 */
export type ImportOutcome =
  | { readonly kind: 'imported'; readonly file: string; readonly replaced: boolean; readonly card: BoardCard }
  | { readonly kind: 'refused'; readonly reason: ImportRefusal }

/** 一个本地文件在浏览器这边够得着的三件事：名字、字节数、内容。 */
export interface LocalFile {
  readonly name: string
  readonly size: number
}

/**
 * 这个文件能不能导（不问磁盘，只问文件本身）。
 *
 * 复用的就是宿主那一条判据（`importPlanOf`），`taken` 恒假：撞名是磁盘上的事实，客户端
 * 没有那份答案，也不该猜——真正落哪个路径由宿主定，回在 `BoardCard.file` 上。
 */
export async function importCheckOf(file: LocalFile): Promise<ImportRefusal | undefined> {
  const plan = await importPlanOf({ name: file.name, size: file.size, current: '', taken: async () => false })
  return plan.kind === 'refused' ? plan.reason : undefined
}

/**
 * 读一个文件的内容，base64。
 *
 * `readAsDataURL` 而不是「`arrayBuffer` 再 `btoa`」：后者要先把字节摊成一个二进制字符串，
 * 十几兆的循环在主线程上是一个看得见的卡顿；前者是浏览器自己的实现，同样一块内存它还
 * 少走一趟。前缀（`data:<mime>;base64,`）在这里就剥掉——宿主只要字节，MIME 它自己按
 * 扩展名认（`core/media/mime.ts`），两处各给一次就又多了一个会漂的来源。
 */
export function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('读取本地文件失败'))
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      const comma = url.indexOf(',')
      resolve(comma === -1 ? '' : url.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

/**
 * 验 → 读 → 送。被拒时连字节都不读。
 *
 * @param bridge - 画布那侧的门面。
 * @param projectId - 这张卡所在的画布。
 * @param cardId - 哪张卡收下这份产物。
 * @param file - 用户在文件选择框里挑中的那个文件。
 * @param before - 导入**之前**这张卡的样子：产物路径，以及它当时在不在。宿主回的
 *   `BoardCard.file` 与它相同、并且原本确实有产物，这一次才算「替换」——否则只是
 *   「这张卡原来什么都没有，现在有了」，即便文件名恰好一样。
 */
export async function importFromFile(
  bridge: CanvasBridge,
  projectId: string,
  cardId: string,
  file: File,
  before: { readonly file: string; readonly present: boolean },
): Promise<ImportOutcome> {
  const refusal = await importCheckOf(file)
  if (refusal !== undefined) return { kind: 'refused', reason: refusal }
  const content = await readBase64(file)
  const card = await bridge.importArtifact(projectId, cardId, file.name, content)
  return { kind: 'imported', file: card.file, replaced: before.present && card.file === before.file, card }
}
