/**
 * dsh-canvas — 应用节点的本地打包（F10.1）。
 *
 * 应用卡片的产物是一个**文件夹**（应用节点：manifest + 入口页 + 它自己的源码），
 * 「导出」于是不是「把这份文字变成另一种格式」，而是「把整个文件夹完整地装进一个压缩包」。
 * 这两件事共享同一条纪律：**要么完整，要么如实说不**——文本节点读到半份就不导出
 * （见 `client/canvas/text-export.ts`），目录里少装一个文件同样不叫导出，只是叫「一个
 * 看起来像导出的东西」。所以本模块的每一条判据都朝这个方向：什么不进包、什么算太大、
 * 包叫什么、里面那层文件夹叫什么。
 *
 * 纯逻辑：不碰 `ctx.fs`，也不认识文件系统——读目录那一半在
 * `core/artifact/artifact-io.ts`（`readBundle`），它拿这里的三张判据决定「这一个条目
 * 该不该读」。于是「`node_modules` 不进包」「单文件超过 4 MB 就拒绝」这类规则都能在
 * 容器外直接测。
 */
import { dirnameOf, fileStemOf, isEntryPage } from '../../canvas/card/card-name.ts'

/**
 * 不进包的条目名。
 *
 * 判据是「它是不是**应用的源码**」，而不是「它在不在目录里」：这些名字底下的东西是依赖
 * 缓存、版本库内部结构与本插件自己的元数据——它们要么能从一个 lock 文件重建，要么属于
 * 交付物之外的世界。一个应用目录里最常见的大块头（`node_modules`）正是卡在「打包成一个
 * 可搬运的包」这件事上的那一个。
 *
 * 反过来，**构建产物（`dist/`、`build/`）不在此列**：那是用户可能确实想交付的东西，
 * 该不该带由他决定；真要带走而包太大，本模块的预算会如实说不，不会替他扔掉。
 */
const BUNDLE_SKIP: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  // 画布自己的板面投影（F1.9）——它属于这张画布，不属于这份应用。
  '.dsh-canvas',
  '.DS_Store',
])

/** Whether a directory entry never travels inside an exported archive. */
export function bundleSkipped(name: string): boolean {
  return BUNDLE_SKIP.has(name)
}

/**
 * 一个包最多装几个文件。
 *
 * 上限不是防磁盘，是防一次导出把整台机器拖住：目录要递归读、字节要过 wire、打包在浏览器
 * 里做，三处都随文件数线性走。一个真正的应用在这个数量级之下两三个数量级。
 */
export const BUNDLE_FILE_LIMIT = 300

/**
 * 一个包最多装多少字节（未压缩）。
 *
 * 8 MB 是「一次导出能可靠搬运」与「一个应用有多大」之间的那根线：scaffold 是几十 KB，
 * 模型写出来的应用通常是几百 KB 到几 MB，而一个 8 MB 以上的目录往往是里面混进了该被
 * {@link bundleSkipped} 挡掉的依赖、或者混进了几十 MB 的素材——后者该由用户自己决定
 * 怎么交付。
 */
export const BUNDLE_BYTES_LIMIT = 8_000_000

/** 单个文件超过它就不进包：一个 4 MB 的文件值得单独走一趟，而不是拖垮整包。 */
export const BUNDLE_ENTRY_BYTES_LIMIT = 4_000_000

/**
 * 递归的最大层数。
 *
 * 目录树里不会有环（一个条目只有一个父目录），所以这一层不是防死循环，是防**病态的深**：
 * 层的名字本身要被拼进 zip 的条目路径，而 zip 的条目名有长度上限。
 */
export const BUNDLE_DEPTH_LIMIT = 12

/** 已经收进包的账。 */
export interface BundleLedger {
  files: number
  /** Sum of the sizes admitted so far, in bytes. */
  bytes: number
}

/** Whether one more file of this size still fits in the archive. */
export function bundleAdmits(size: number, ledger: BundleLedger): boolean {
  if (size > BUNDLE_ENTRY_BYTES_LIMIT) return false
  if (ledger.files >= BUNDLE_FILE_LIMIT) return false
  return ledger.bytes + size <= BUNDLE_BYTES_LIMIT
}

/**
 * 这个包叫什么：卡片名 + `.zip`。
 *
 * 名字过一遍 {@link fileStemOf}——它是本仓「用户起的名字 → 一个合法的路径段」的唯一
 * 转换（控制字符、`/ \ : * ? " < > |` 换掉，空白收成 `-`），因为这个名字接下来会变成
 * 用户磁盘上的一个文件名。清洗后什么都不剩时退回 `app`：一个叫 `.zip` 的文件是很难
 * 打开的东西。
 */
export function bundleArchiveName(name: string): string {
  const stem = fileStemOf(name)
  return `${stem === '' ? 'app' : stem}.zip`
}

/**
 * 要打包的是哪一项，以及它是不是一个目录。
 *
 * 这是本模块最容易搞错的一条，而它错起来是**静默的半份包**，所以判据要写清。
 * 「产物是一个目录」有**两条各自充分**的证据，取或：
 *
 * 1. **磁盘上它就是目录**（`directory`，宿主 probe 给的）。`folder` 形态的产物就是
 *    这样：卡片的 `file` 直接是那个目录（`资料`），没有入口页这回事。
 * 2. **它是一个目录的入口页**（`isEntryPage`）。scaffold 的约定是入口页固定叫
 *    `index.html`，于是目录应用的 `file` 是 `应用/index.html`——磁盘上问「这是文件
 *    还是目录」，答案永远是「文件」。**只信这条答案就是 v1.58 发出的那个包**：里面
 *    有 `index.html`，同目录的 `styles.css` 与 `app.js` 一个都不在，用户拿到一个解得
 *    开、打得开、但一打开没有样式也没有交互的包，而按钮说「已导出」。
 *
 * 所以形态**路径与磁盘一起看**，而这两条判据都不是新知识：入口页那条与改名
 * （`planRename`：入口页改目录、其余改文件）、预览（`inlinePageAssets` 按入口页所在
 * 目录解析 `styles.css`）用的是同一条。
 *
 * 一个例外必须留着：入口页**就落在画布根上**时，同目录是所有卡片的公共场地，不是这
 * 一份产物的配套资源——把整个画布打包给一张卡显然是错的，于是退回文件形态。这与
 * `planRename` 对根上入口页的 `root-entry` 拒绝、`cardNameOf` 「根上的入口页没有自己的
 * 文件夹可以借名字」是同一条道理。
 */
export function bundleTarget(file: string, directory: boolean): { path: string; directory: boolean } {
  if (directory) return { path: file, directory: true }
  if (!isEntryPage(file)) return { path: file, directory: false }
  const folder = dirnameOf(file)
  if (folder === '') return { path: file, directory: false }
  return { path: folder, directory: true }
}

/**
 * zip 里那层文件夹的名字（含结尾的 `/`），单文件形态为空串。
 *
 * 包一层是刻意的：解压出来是一个完整的文件夹，而不是把十几个文件倒在用户的解压目录里
 * ——同一张画布上的两个应用都叫 `index.html` 时，平铺的那一种会互相覆盖，而用户并不会
 * 收到任何提示。单文件形态没有这个风险（包里就一个文件），所以不套。
 */
export function bundlePrefix(name: string, directory: boolean): string {
  if (!directory) return ''
  const stem = fileStemOf(name)
  return stem === '' ? '' : `${stem}/`
}

/** 一个条目在 zip 里的路径。 */
export function bundleEntryPath(prefix: string, path: string): string {
  return `${prefix}${path}`
}
