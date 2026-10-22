/**
 * dsh-canvas — 浏览器里的那一次「保存到本机」。
 *
 * 「导出」在客户端有两条独立的路——文本节点的 md / txt / docx / pdf，应用节点的 zip——
 * 但它们最后一步是同一件事：把一段字节交给浏览器。这一步只该写一份：两处 `a[download]`
 * 会在「什么时候 revoke 对象 URL」「MIME 由谁给」这些细节上各走各的，而两个都「能用」
 * 的分歧没有任何测试会去戳。
 *
 * MIME 由调用方给，因为它是**格式表的一部分**，格式表跟着各自的导出模块走（文本那份在
 * `text-export.ts`，zip 就一个值）。
 */

/**
 * Hand one blob to the browser as a download, and clean up after it.
 *
 * The object URL is revoked immediately after the click: the browser has already
 * taken what it needs by then, and holding it would leak the whole file for the
 * life of the page.
 *
 * The cast is TS 6's: its `Uint8Array` is generic over its backing buffer, while
 * `BlobPart` takes a view over an `ArrayBuffer`. Every byte array here is one we
 * just allocated (never a shared or resizable buffer), so the narrowing is the
 * safe one — without it the only alternative would be copying the file.
 *
 * @param name - the file name the browser saves it under.
 * @param bytes - the file's content.
 * @param mime - the content type, from the format table that produced the bytes.
 */
export function downloadBytes(name: string, bytes: Uint8Array, mime: string): void {
  const part = bytes as Uint8Array<ArrayBuffer>
  const url = URL.createObjectURL(new Blob([part], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
