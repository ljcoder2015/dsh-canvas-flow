/**
 * dsh-canvas — 设计预览的**字体加载进度**（纯，无 React、无 DOM、不引 core）。
 *
 * 为什么值得单独一件：字体是这张预览里唯一「还在跑、用户却看不见」的一段。首帧要等的
 * 四支 Inter 约 1.3MB（引擎阶段），而中文字面 17.7MB 是**首帧之后**才到货的——到货前含中文
 * 的文字整段空白。没有进度，用户看到的是「打开就坏了」；有了进度，他看到的是「还差 4MB」。
 *
 * 数据真源在 loader 那一侧（`design-skia.ts` 的 `loadFontFile`：按响应流逐块读、逐块报）。
 * 这里只做三件纯事：**累加**、**折算成百分比**、**判断这份值不值得通知界面**。
 *
 * **它不许 import 任何东西**（连 `node:` 都不行）：引擎 chunk 拿它产进度、client.js 拿它画
 * 进度，而 client.js 一旦把 core 拉进来，场景图的类身份立刻变成两份（见 `design-engine.ts`
 * 开头那两条理由）。所以类型与函数都自带，不从 `design-engine-types.ts` 引。
 */

/** 一次字体加载的进度快照。 */
export interface DesignFontProgress {
  /** 这一轮已经**结束**的支数。失败也算结束——「不用再等了」与「装上了」对进度是同一件事。 */
  done: number
  /** 这一轮要取的支数（不是全页字体总数：已缓存的那些不进分母）。 */
  total: number
  /** 已经读到的字节（按响应流累加，不是「完成文件的大小之和」）。 */
  bytes: number
  /** 已从响应头读到的总字节；响应头还没到时为 0。 */
  totalBytes: number
  /** 已经拿到响应头的支数。它等于 `total` 时，分母才覆盖了本轮全部字面。 */
  measured: number
}

/**
 * 百分比（0–100 的整数）。
 *
 * 三条口径，都是为了让数字**不撒谎**：
 * - 分母还没有（响应头未到）时按**支数**折算——那是此刻唯一知道的东西。
 * - 分母有了就按**字节**折算。按支数会骗人：四支 Inter 到齐是 4/5 = 80%，可那才 1.3MB，
 *   中文那 17.7MB 一个字都还没来。
 * - 没结束之前**封顶 99**：压过的响应（`content-length` 是压缩后长度）与真到货之间可能
 *   差几个字节，`100%` 却还停在那儿会让人以为卡住了。
 *
 * 注意它算出来的数**未必可信**：分母只覆盖了一部分字面时（{@link fontPercentKnown} 为假），
 * 这个百分比下一秒可能掉一大截。界面要画条就该先问 `fontPercentKnown`。
 */
export function fontPercentOf(progress: DesignFontProgress): number {
  if (progress.total <= 0) return 0
  if (progress.done >= progress.total) return 100
  const fraction = progress.totalBytes > 0 ? progress.bytes / progress.totalBytes : progress.done / progress.total
  const percent = Math.floor(fraction * 100)
  if (!Number.isFinite(percent)) return 0
  return Math.max(0, Math.min(99, percent))
}

/**
 * 这个百分比**能不能拿去画条**。
 *
 * 分母要覆盖本轮全部字面才算数。真机上踩过：四支 Inter（1.3MB）先到齐时，分母里只有它们，
 * 条冲到 99% 还停了一会儿——然后中文字面一开始读，分母变成 18.2MB，数字**掉回 7%**。
 * 一条会倒退的进度条比没有更糟：它让人以为刚才那次是错的。所以分母补齐之前只报「字体 4/5」，
 * 不画条。
 */
export function fontPercentKnown(progress: DesignFontProgress): boolean {
  return progress.totalBytes > 0 && progress.measured >= progress.total
}

/**
 * 这份进度**该不该露面**。
 *
 * 只看一件事：还有字面在路上。全是缓存命中的那种打开（第二次起就是这样）没有进度可讲，
 * 一条停在 100% 的进度条只会让人以为「还有东西在加载」。
 */
export function fontProgressVisible(progress: DesignFontProgress | null): progress is DesignFontProgress {
  return progress !== null && progress.total > 0 && progress.done < progress.total
}

/** 字节数的人话（`18.2 MB` / `328 KB`）。**不本地化**：两种语言里这两个单位是同一副写法。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/**
 * 两次进度之间，界面值不值得为它重渲染一次。
 *
 * 按字节读意味着几秒钟里会有成百上千次回调（17.7MB / 64KB 一块 ≈ 280 次）；而界面上能看见
 * 的只有**整数百分比**与支数。百分比没动的那一次，重渲染是纯浪费。
 */
export function fontProgressChanged(prev: DesignFontProgress | null, next: DesignFontProgress | null): boolean {
  if (prev === null || next === null) return prev !== next
  if (prev.done !== next.done || prev.total !== next.total) return true
  return fontPercentOf(prev) !== fontPercentOf(next)
}

/** 一次读流每走这么多字节才值得惊动界面（比 1% 细一点，又不至于每块都喊）。 */
const EMIT_STEP_BYTES = 192 * 1024

export interface FontProgressTracker {
  snapshot(): DesignFontProgress
  /** 一支的响应头到了：记下这一支的总长（重复调用只认第一次，`content-length` 会重复报）。 */
  measure(file: string, bytes: number): void
  /** 读到一块。 */
  read(file: string, bytes: number): void
  /** 这一支结束了（到货，或放弃）。 */
  finish(file: string): void
}

/**
 * 一组字面的进度累加器。
 *
 * `files` 是**这一轮真要取的**那几支——已缓存的不要放进来，否则分母里躺着永远不动的一格，
 * 进度条会先跳到 80% 再等很久（中文那 17.7MB 就是这么骗人的）。
 *
 * `emit` 的调用频率已经按 `EMIT_STEP_BYTES` 与「支数变化」压过一道；调用方再叠一层
 * `fontProgressChanged` 就够了，不必自己做节流。
 */
export function createFontProgressTracker(
  files: readonly string[],
  emit: (progress: DesignFontProgress) => void,
): FontProgressTracker {
  const measured = new Set<string>()
  const finished = new Set<string>()
  let bytes = 0
  let totalBytes = 0
  let emittedBytes = 0

  const snapshot = (): DesignFontProgress => ({
    done: finished.size,
    total: files.length,
    bytes,
    totalBytes,
    measured: measured.size,
  })

  const announce = (): void => {
    emittedBytes = bytes
    emit(snapshot())
  }

  return {
    snapshot,
    measure(file, length) {
      if (measured.has(file) || !Number.isFinite(length) || length <= 0) return
      measured.add(file)
      totalBytes += length
      // 分母一变，百分比就会跳一格——这一刻必须让界面跟上，不然它显示的是旧分母算出来的数。
      announce()
    },
    read(file, length) {
      if (finished.has(file) || length <= 0) return
      bytes += length
      if (bytes - emittedBytes >= EMIT_STEP_BYTES) announce()
    },
    finish(file) {
      if (finished.has(file)) return
      finished.add(file)
      // 支数变了必喊：`done/total` 是那条文案的主语。
      announce()
    },
  }
}
