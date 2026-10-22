/**
 * dsh-canvas — 设计节点的导出：四样出路都在浏览器里画出来（F10.1，v1.59）。
 *
 * 与文本导出（v1.57）、应用打包（v1.58）同一套分工，理由也一样：**能在这里做的在这里做**。
 * 设计稿的四样出路一个都不在部署上——fig 要 Figma 的 kiwi schema，图片与 PPT 要 CanvasKit
 * 的渲染器，PDF 要 DOM——而它们全都在用户手里这台浏览器里。于是这一份产物既不需要部署提供
 * `dsh-canvas.capabilities`，也不必先写一份到服务器磁盘上再告诉用户路径。
 *
 * 本模块管的是**产物该叫什么、怎么装、怎么说**，画的那一步在引擎 chunk 里
 * （`design-engine.ts` 的 `designExport`，实现见 `design-io.ts`）——那个入口只吐「一件件
 * 字节」，装包与命名归这里，因为这两件事要判据、要在 node 里跑得动，而画图非要浏览器不可。
 *
 * 三件已经定下来的事：
 *
 * - **粒度**：`.fig` 与 PDF 是**整份文档一个文件**（PDF 一容器一页，页在文档里面——见
 *   `viewers/design-pdf.ts`）；图片一张容器一份；PPT 一页器一份幻灯片序列。多件就是多件——
 *   **按全仓同一条规矩打成一个包**（里面一层同名文件夹，与 v1.58 的应用导出同一个包法），
 *   不是随手丢几个文件到下载目录。
 * - **图片倍率 2×**（设计稿是 1× 逻辑像素）：在引擎那一侧定，这里不掺和。
 * - **切不动就说**。任何一个可见容器画不出来，那趟在引擎里已经是 `error`；这里只多做一件
 *   事——**装包失败不假装成功**（异常照实转成一句话，口气是 `error`）。
 */
import type { ArtifactView } from '../../../types.ts'
import { zipDeflated, type ZipEntry } from '../../../core/artifact/io/zip.ts'
import { bundleEntryPath, bundlePrefix } from '../../../core/artifact/io/bundle.ts'
import { fileStemOf } from '../../../core/canvas/card/card-name.ts'
import { platformDeflate, ZIP_MIME } from './bundle-export.ts'
import type { CanvasKey } from '../../ui/locales.ts'
import type {
  DesignExportFormat as EngineFormat,
  DesignExportOutcome as EngineOutcome,
  DesignExportRefusal,
  DesignExportRequest,
} from '../../artifact/viewers/design/design-engine-types.ts'

/** 设计稿能导成哪几样。顺序就是菜单里的顺序。 */
export type DesignExportFormat = EngineFormat

export const DESIGN_EXPORT_FORMATS: readonly DesignExportFormat[] = ['fig', 'png', 'pdf', 'pptx']

/**
 * 每一样在菜单里那行文案的字典键。
 *
 * 与文本导出同一处安排：写在格式表旁边，因为它是**格式表的一部分**——加一样出路要同时加
 * 一行文案，两处放在一起才看得见这件事。（`pdf` 这一行是与文本导出共用的那一条。）
 */
export const DESIGN_EXPORT_LABEL: Record<DesignExportFormat, CanvasKey> = {
  fig: 'canvas.export.fig',
  png: 'canvas.export.png',
  pdf: 'canvas.export.pdf',
  pptx: 'canvas.export.pptx',
}

/** 每一样落盘时的 MIME。`fig` 是 Figma 自己的二进制容器，没有登记过的类型，按二进制给。 */
export const DESIGN_EXPORT_MIME: Record<DesignExportFormat, string> = {
  fig: 'application/octet-stream',
  png: 'image/png',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/**
 * 落盘名的基名：**用户给的那个名字**（卡片名，F1.12）→ 一段合法的路径段。
 *
 * 走的是全仓同一个转换 `fileStemOf`（控制字符与 `/ \ : * ? " < > |` 换掉、空白收成 `-`），
 * 与 v1.58 应用导出的 `bundleArchiveName` 逐字同一条——同一张卡片的 `.zip` 与 `.fig` 该
 * 长得像同一个人起的名字。清光了退回「设计」：一个叫 `.fig` 的文件几乎打不开。
 *
 * 与 {@link designEntryStem} 分开是因为**名字的来源不同**：这里是用户在画布上打的字，那里
 * 是文档里的容器名/页面名（模型随手取的），后者不吃「空白收成 `-`」那一套。
 */
function designStemOf(title: string): string {
  const stem = fileStemOf(title)
  return stem === '' ? '设计' : stem
}

/**
 * 落盘名：`设计1.fig` / `设计1.png` / `设计1.pdf` / `设计1.pptx`。
 *
 * 扩展名与格式名逐字相同（`pptx` 那个是 `.pptx`，不是 `.ppt`——这是 OOXML 的包，PowerPoint
 * 认它），所以不另立一张扩展名表。
 */
export function designExportName(title: string, format: DesignExportFormat): string {
  return `${designStemOf(title)}.${format}`
}

/** 多件装包时的包名（与 v1.58 的应用导出同一个长相：一份产物一个 zip）。 */
export function designArchiveName(title: string): string {
  return `${designStemOf(title)}.zip`
}

/**
 * 一件东西在 zip 里叫什么（不含扩展名）：容器名 / 页面名。
 *
 * 名字是文档给的（`容器 1`、`页面 1`），可能带路径分隔符、控制字符，甚至为空——zip 条目名
 * 里出现 `/` 就不是一个文件了，`\` 更是很多解压器的雷。所以这里只留一个**安全的基名**，
 * 清光了就回落到兜底（`图1`/`幻灯片1` 这种由序号兜底，见 {@link designUnitStems}）。
 */
export function designEntryStem(name: string, fallback: string): string {
  // 控制字符 + 路径分隔符 + Windows 保留字符，一律换成下划线；首尾的空白与点也去掉
  // （末尾的点在 Windows 上会被静默吃掉，`.git` 这种名字更不能进包）。
  //
  // 控制字符写成 `\p{Cc}` 那个 Unicode 类别而不是 `\x00-\x1f` 的范围——与
  // `card-name.ts` 的 `fileStemOf` 同一条理由：同一个集合，但读的人（和 linter）不必
  // 去分辨一串转义序列是人写的还是手滑。`\p{Cc}` 连 DEL（U+007F）一起盖住。
  const cleaned = name
    .replace(/[\p{Cc}/\\:*?"<>|]/gu, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
  return cleaned === '' ? fallback : cleaned
}

/**
 * 一整套条目名：清一遍，再**去重**（重名补 `-2`、`-3`…）。
 *
 * 去重不是洁癖：两个容器可以叫同一个名字（模型随手取的），而 zip 里两条同名条目会让一部分
 * 解压器**静默覆盖**——用户拿到的包里少一张图，谁都不报错。递补规则与本仓改名的撞名办法
 * 一致（`settleRename`：`-2` 起、到 `-99` 为止），只是这里没有磁盘要问，重名只看这一批。
 */
export function designUnitStems(names: readonly string[], fallback: string): string[] {
  const taken = new Set<string>()
  const stems: string[] = []
  for (const name of names) {
    const base = designEntryStem(name, fallback)
    let candidate = base
    for (let suffix = 2; taken.has(candidate) && suffix <= 99; suffix += 1) {
      candidate = `${base}-${suffix}`
    }
    taken.add(candidate)
    stems.push(candidate)
  }
  return stems
}

/** 没导成的四种原因（三种来自引擎，一种来自「产物本身不在」）。 */
export type DesignRefusal = DesignExportRefusal | 'absent' | 'truncated'

/**
 * 一次设计导出的收场。
 *
 * 与全仓别的收场同一条规矩：**被拒是答案，不是异常**——产物还没写、只读到半份、文档解不开、
 * 没有容器、这台机器上取不到渲染引擎，各自有各自的下一步。`failed` 留给真的抛了异常
 * （引擎那一侧或装包这一步）。
 */
export type DesignExportOutcome =
  | { kind: 'done'; name: string; files: number }
  | { kind: 'refused'; reason: DesignRefusal }
  | { kind: 'failed'; reason: unknown }

/** 把一件字节交给用户的本机（注入，故本模块能在 node 里跑；画布那侧传 `downloadBytes`）。 */
export type DesignExportSaver = (name: string, bytes: Uint8Array, mime: string) => void

/** 引擎那一侧的能力面（就是 chunk 里 `designExport` 那一个函数）。 */
export interface DesignExportEngine {
  designExport(request: DesignExportRequest): Promise<EngineOutcome>
}

export interface DesignExportInput {
  /** 刚读回来的产物（`readArtifact` 那一份）。 */
  view: ArtifactView
  format: DesignExportFormat
  /** 落盘名的基名——卡片名（F1.12）。 */
  title: string
  /** 引擎 chunk 的入口；chunk 没加载上时 `null`（那是「取不到渲染引擎」的一种）。 */
  engine: DesignExportEngine | null
  save: DesignExportSaver
}

/** 读一份设计稿并按格式导出来。 */
export async function exportDesign(input: DesignExportInput): Promise<DesignExportOutcome> {
  const { view, format, title, engine, save } = input
  if (!view.present) return { kind: 'refused', reason: 'absent' }
  // 读到半份就不导：设计文档是个 JSON 快照，切掉一半连解都解不开，拿走的只会是一份坏文件。
  if (view.truncated) return { kind: 'refused', reason: 'truncated' }
  if (engine === null) return { kind: 'refused', reason: 'no-engine' }

  let outcome: EngineOutcome
  try {
    outcome = await engine.designExport({ envelope: view.text, format })
  } catch (error) {
    return { kind: 'failed', reason: error }
  }
  if (outcome.kind === 'refused') return { kind: 'refused', reason: outcome.reason }
  // 整个 outcome 一起交出去：带码的那几种「画不出来」要靠码在提示条那一层出双语
  // （`notice.ts`），只交 message 会把码丢在路上。
  if (outcome.kind === 'error') return { kind: 'failed', reason: outcome }

  const units = outcome.units
  if (units.length === 0) return { kind: 'refused', reason: 'empty' }
  const name = designExportName(title, format)

  try {
    if (units.length > 1) {
      save(designArchiveName(title), await packUnits(title, units, format), ZIP_MIME)
      return { kind: 'done', name: designArchiveName(title), files: units.length }
    }
    save(name, units[0].bytes, DESIGN_EXPORT_MIME[format])
    return { kind: 'done', name, files: 1 }
  } catch (error) {
    return { kind: 'failed', reason: error }
  }
}

/**
 * 多件打成一个包：里面一层同名文件夹（`设计1/容器 1.png`）。
 *
 * 与 v1.58 的应用导出共用同一条「包一层」的判据（`bundlePrefix` / `bundleEntryPath`）——
 * 解压出来是一个完整的文件夹，而不是把几张图倒在用户的解压目录里（同一个画布上两张卡都
 * 有 `容器 1.png` 时，平铺的那一种会互相覆盖，而用户收不到任何提示）。
 */
async function packUnits(
  title: string,
  units: readonly { name: string; bytes: Uint8Array }[],
  format: DesignExportFormat,
): Promise<Uint8Array> {
  const fallback = format === 'pptx' ? '幻灯片' : '图'
  const stems = designUnitStems(
    units.map((unit) => unit.name),
    fallback,
  )
  const prefix = bundlePrefix(designStemOf(title), true)
  const entries: ZipEntry[] = units.map((unit, index) => ({
    name: bundleEntryPath(prefix, `${stems[index] ?? fallback}.${format}`),
    data: unit.bytes,
  }))
  return zipDeflated(entries, platformDeflate())
}
