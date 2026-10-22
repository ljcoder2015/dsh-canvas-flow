/**
 * dsh-canvas — 应用节点的导出：把整份产物打包成 zip，落在用户的本机（F10.1）。
 *
 * 与文本导出同一套分工：**能读的那一侧读，能下载的那一侧打包**。目录在宿主上
 * （`readBundle` 递归读出来），而 zip 在这里生成——因为下载发生在这里，也因为一个
 * 「导出」本就该由用户手里的那个程序完成，而不是让部署先写一份到磁盘上再告诉他路径。
 *
 * 这条路的另一个结果是：**它不依赖部署的导出能力**。文本节点 v1.57 起就是这样了，应用
 * 节点此前走 `exportCard(cardId, 'zip')` 那条线——那条线要求部署提供
 * `dsh-canvas.capabilities`，没有它的部署上点一下什么都不会发生。打包是纯浏览器里做得
 * 了的事，于是它就和 md / docx 一样在本地做完。
 *
 * 压缩走平台的 `CompressionStream`（宿主是 Chromium，从 103 起支持 `deflate-raw`）；
 * 没有它、或者压完反而更大，条目就按 stored 落进包——见 `core/artifact/zip.ts`。
 */
import type { BundleFile, BundleView } from '../../../types.ts'
import { zipDeflated, type ZipDeflate, type ZipEntry } from '../../../core/artifact/io/zip.ts'
import { bundleArchiveName, bundleEntryPath, bundlePrefix } from '../../../core/artifact/io/bundle.ts'

/** 导出的 MIME：一个 zip 就是 `application/zip`。 */
export const ZIP_MIME = 'application/zip'

/**
 * 把一段字节交给浏览器（对象 URL + `a[download]`）。
 *
 * 注入而不是直接调用 `download.ts`：本模块要能在 node 里被单测跑，而一次下载碰的是
 * `Blob` / `URL.createObjectURL` / `document` 三样宿主原语——它们在这里是**平台**，不是
 * 逻辑。判据是「装进包里的字节对不对」，那件事不需要一个浏览器；真正把它存下来的那一步
 * 由调用方给（画布那侧传的就是 `downloadBytes`）。
 */
export type BundleSaver = (name: string, bytes: Uint8Array, mime: string) => void

/**
 * 一次应用打包的结果：要么是一个已经下载下来的包，要么是「没有包」以及为什么。
 *
 * 拒绝是**答案**而不是异常（与宿主那条导出线一致）：产物还没写、目录里空得只剩被跳过的
 * 东西、或者文件多到一包装不下——这三种都是界面上一句话的事，不是要把调用方炸掉的事。
 */
export type BundleExportResult =
  | { kind: 'done'; name: string; files: number; bytes: number }
  | { kind: 'refused'; reason: BundleRefusal }

/** 为什么这一次没有包。 */
export type BundleRefusal =
  /** 产物还不在磁盘上（座位可以先于产物存在，F1.11）。 */
  | 'absent'
  /** 目录里没有可打包的文件（空目录，或者只有被忽略的依赖目录）。 */
  | 'empty'
  /** 有文件没装下，装下的就是半份——照本仓的规矩，宁可不出（见 `artifact-io` 的 `bundle`）。 */
  | 'truncated'

/**
 * 把读回来的清单打成 zip 并交出去。
 *
 * `dirPrefix` 让目录形态的应用解压出来是**一个文件夹**（`应用1/index.html`…），单文件
 * 形态则是包里就那一个文件——判据在 `core/artifact/bundle.ts` 的 `bundlePrefix`。
 */
export async function exportBundle(view: BundleView, save: BundleSaver): Promise<BundleExportResult> {
  if (!view.present) return { kind: 'refused', reason: 'absent' }
  if (view.truncated) return { kind: 'refused', reason: 'truncated' }
  if (view.files.length === 0) return { kind: 'refused', reason: 'empty' }

  const prefix = bundlePrefix(view.name, view.directory)
  const entries = view.files.map((file): ZipEntry => ({
    name: bundleEntryPath(prefix, file.path),
    data: bundleFileBytes(file),
  }))
  const bytes = await zipDeflated(entries, platformDeflate())
  const name = bundleArchiveName(view.name)
  save(name, bytes, ZIP_MIME)
  return { kind: 'done', name, files: entries.length, bytes: bytes.byteLength }
}

/**
 * 一个条目在 zip 里的字节。
 *
 * 两个字段互斥（见 `BundleFile`）：文本自己编一遍 UTF-8，二进制把 base64 解回字节。
 * `atob` 而不是 `Buffer`——这一半跑在浏览器里（node 也有 `atob`，所以测试环境同样跑得动）。
 */
export function bundleFileBytes(file: BundleFile): Uint8Array {
  if (file.base64 === '') return new TextEncoder().encode(file.text)
  const binary = atob(file.base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at)
  return bytes
}

/**
 * 这台平台的 `deflate-raw`，没有就返回 `undefined`（于是条目按 stored 落包）。
 *
 * `deflate-raw` 这个名字是这件事里最容易错的一处：zip 的方法 8 要的是**裸** deflate 流，
 * 而 `'deflate'` 那个名字给的是带 zlib 头与尾的流——把它塞进 zip，解压器会在第一个块上
 * 读出坏数据，包看起来完好、打开是坏的。所以名字写死在这一处，且不给别的选项。
 */
export function platformDeflate(): ZipDeflate {
  return async (bytes) => {
    if (typeof CompressionStream === 'undefined') return undefined
    try {
      const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
        .stream()
        .pipeThrough(new CompressionStream('deflate-raw'))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    } catch {
      // 平台说它有、用起来却没有（旧引擎、被策略挡掉）：当它没有。
      return undefined
    }
  }
}
