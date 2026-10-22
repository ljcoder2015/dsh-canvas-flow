/**
 * dsh-canvas — 媒体卡（图片 / 视频 / 音频）的导出：把那份产物**原样**交给浏览器（F10.1，v1.83）。
 *
 * 媒体卡与文本、设计、应用三种都不一样：它的产物**已经是磁盘上一个现成文件**。所以「导出」
 * 不是一次转换，而是把那些字节原封不动交出去——转一道（jpg 重编码成 png、mp4 再封装一次）
 * 只会用一次画质损失换一个用户没要过的东西，而用户点「导出」想要的正是他现在看到的那一份。
 *
 * 由此有两件事跟着定下来：
 *
 * - **文件名跟卡片走，扩展名跟产物走**。卡片可以改名（「海边日落」→「海边日落 终稿」），
 *   但产物还是 `海边日落.jpg`；导出的名字该是「卡片名 + 产物扩展名」，而不是把旧文件名
 *   原样塞回去。词干的清洗复用 `fileStemOf`——它是「用户亲手打的名字」那条规矩的落点，
 *   导出没有理由再写一套。
 * - **上限只有宿主一处**。字节从 `readArtifact` 来（与全屏预览、卡面同一条读法），它回的
 *   `truncated` 就是「这份没读全」。客户端不抄那个数（本仓既有规矩，见
 *   `tests/client/canvas/card-tile.spec.ts` 第 5 条），也不把半份当整份下载：一个放到
 *   一半断掉的 mp4，配上「已导出」四个字，比不导出更坏。
 */
import { basenameOf, extensionOf, fileStemOf, stemOf } from '../../../core/canvas/card/card-name.ts'
import type { ArtifactView } from '../../../types.ts'

/**
 * 一次媒体导出的结局。
 *
 * 四种里有三种「没导成」，而它们指向三种不同的下一步：产物还没生成（去生成）、太大
 * （在画布目录里取）、内容读不出来（这份数据有问题）。「被拒不是出错」——只有最后一种
 * 是真正意料之外的东西。
 */
export type MediaExportPlan =
  | { kind: 'ready'; name: string; bytes: Uint8Array; mime: string }
  | { kind: 'absent' }
  | { kind: 'truncated' }
  | { kind: 'failed'; reason: string }

const DATA_URL_PREFIX = 'data:'
const BASE64_MARK = ';base64,'
/** 卡片名与产物名都清不出东西时的兜底：一个文件总得有个名字。 */
const FALLBACK_STEM = 'artifact'
const FALLBACK_MIME = 'application/octet-stream'

/**
 * 导出时用的文件名：卡片名的词干 + 产物的扩展名。
 *
 * 卡片名可能为空（`readArtifact` 之外的那条路径），那时用产物自己的词干；两者都清不出
 * 东西时退到 `artifact`。扩展名保留磁盘上的写法（`IMG_0042.JPG` 导出还叫 `.JPG`）——
 * 大小写在这里是用户自己的习惯，不是我们要纠正的东西。
 *
 * @param cardName - 这张卡叫什么（`Card.name`）。
 * @param file - 产物的路径，相对画布根（`Card.file`）。
 * @returns 浏览器保存时用的文件名。
 */
export function mediaExportNameOf(cardName: string, file: string): string {
  const base = basenameOf(file)
  const extension = extensionOf(base).replace(/^\./, '')
  const fromCard = fileStemOf(cardName)
  const fromFile = fileStemOf(stemOf(base))
  const stem = fromCard !== '' ? fromCard : fromFile !== '' ? fromFile : FALLBACK_STEM
  return extension === '' ? stem : `${stem}.${extension}`
}

/**
 * 这份产物能不能导、导出去叫什么。
 *
 * @param view - `readArtifact` 的答案（整份读；`truncated` 表示宿主那侧的上限挡住了）。
 * @param cardName - 这张卡叫什么；空串时退回 `view.name`。
 * @returns 可以下载的字节与文件名，或者「为什么这次不导」。
 */
export function mediaExportPlanOf(view: ArtifactView, cardName: string): MediaExportPlan {
  if (!view.present) return { kind: 'absent' }
  // `truncated` 与「空 dataUrl」是同一件事的两面：宿主超上限时只举旗、不给字节。
  if (view.truncated || view.dataUrl === '') return { kind: 'truncated' }
  const decoded = decodeDataUrl(view.dataUrl)
  if (decoded === undefined) {
    return { kind: 'failed', reason: '产物的内容读不出来（不是一份 base64 的 data URL）' }
  }
  const name = mediaExportNameOf(cardName !== '' ? cardName : view.name, view.file)
  return { kind: 'ready', name, bytes: decoded.bytes, mime: decoded.mime === '' ? FALLBACK_MIME : decoded.mime }
}

/**
 * 解开 `data:<mime>;base64,<payload>`。
 *
 * 不用 `fetch(dataUrl).then(r => r.blob())`：那会把整份字节在浏览器的网络栈里再走一遍，
 * 而这里拿到的已经是同一段字节的另一种写法。`atob` 一次解完，代价只有一份临时字符串。
 *
 * @param url - `ArtifactView.dataUrl`。
 * @returns MIME 与字节；不是那种形状（或 base64 坏了）时 `undefined`。
 */
function decodeDataUrl(url: string): { mime: string; bytes: Uint8Array } | undefined {
  if (!url.startsWith(DATA_URL_PREFIX)) return undefined
  const mark = url.indexOf(BASE64_MARK)
  if (mark === -1) return undefined
  const mime = url.slice(DATA_URL_PREFIX.length, mark)
  const payload = url.slice(mark + BASE64_MARK.length)
  try {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return { mime, bytes }
  } catch {
    return undefined
  }
}
