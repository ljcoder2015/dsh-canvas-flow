/**
 * dsh-canvas — 哪些扩展名算「媒体」，以及它们各自的 MIME（F2.7）。
 *
 * 这张表原先住在 `artifact-io.ts`，与全屏预览的字节通道写在一起——因为它的第一个消费者
 * 就是那条通道：读回来的一串字节，浏览器要知道按什么 MIME 内联。可这条事实**不是 IO 的
 * 私事**：客户端「导入本地文件」那一侧也要拿它判「这个文件能不能当产物」（一个 `.heic`
 * 或 `.txt` 不该被搬进画布），而客户端不许 import `artifact-io`——那个模块为了绕开 fs 缝
 * 的二进制缺口直接引了 `node:fs`，拖进浏览器包就是死。
 *
 * 所以表挪到这里：纯数据、零依赖，宿主与客户端读同一份。`artifact-io` 仍然把它**再导出**
 * 一次，老 import 一个都不断（`media-provider.ts` 用的就是老那条）。
 *
 * 「哪些形态是媒体」是另一个问题，答案在 `kind-registry.ts` 的 `MEDIA_KINDS` 上——那边是
 * **形态语义**（画出来的 / 放出来的 / 听出来的），这边是**字节通道**（这个扩展名的字节该
 * 按什么 MIME 交给浏览器）。两张表刻意没有互相读，理由写在 `MEDIA_KINDS` 的注释里。
 */

/** Media types the fullscreen view may inline as a data URL, by extension. */
export const MEDIA_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  wma: 'audio/x-ms-wma',
}

/**
 * The MIME type a binary artifact is served to the browser as, or `undefined`
 * when the extension names nothing the view can inline.
 *
 * @param extension - lower-cased extension without the dot.
 */
export function mediaMimeOf(extension: string): string | undefined {
  return MEDIA_MIME[extension]
}

/**
 * 浏览器文件选择框的 `accept`：由上面那张表**推出来**，不另写一份通配符清单。
 *
 * 写 `image/*,video/*,audio/*` 也能用，但它是第二个来源：表里加一种音频格式时，那份
 * 通配符不会跟着变——它只会「恰好也对」，直到哪天表里出现一种不属于这三族的媒体。
 */
export const MEDIA_ACCEPT: string = [
  ...new Set(Object.values(MEDIA_MIME).map((mime) => `${mime.split('/')[0] ?? ''}/*`)),
].join(',')
