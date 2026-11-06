/**
 * dsh-canvas — 读这台电脑上装了哪些字体，并把其中一张脸递给预览器（F2.6，v1.89）。
 *
 * 为什么要有这一层：设计稿里写的族名是**作者的机器**上的东西（`PingFang SC`、
 * `Helvetica Neue`、`Microsoft YaHei`）。预览器住在浏览器里，拿不到系统字体——CanvasKit
 * 只认自己 `registerFont` 注册过的那几张脸，所以此前只有仓库自带的两支（Inter 与
 * Noto Sans SC）：稿子里写别的族，文字要么退回 Inter（西文还行，中文全空白），要么整段不画。
 * 浏览器的 `queryLocalFonts()` 在这条链路上也不通（webview 里没有这个 API，即便有也要用户
 * 点一次授权），于是唯一稳的路是**宿主去读盘、把字节交给页面**——插件本来就有一条自己的
 * HTTP 路由（`/dsh-canvas/assets`），这里再加一条。
 *
 * 三件必须做对的事（都是「不报错但不对」的那一类）：
 *
 * 1. **`.ttc` 要拆**。`PingFang.ttc` 一个文件 36 张脸，第 0 张是港版；整份递给 CanvasKit
 *    只认第 0 张，于是「简体」会用港版字形画出来（见 `core/font/sfnt.ts` 的 `extractFace`）。
 * 2. **族名从字体自己嘴里读**，不从文件名猜：文件名与族名对不上的字体在本机不止一支
 *    （`Helvetica.ttc` 里还有 Light / Oblique）。
 * 3. **请求里的字符串永远不变成路径**。路由只认 `?family=` 与 `?style=` 两个键，拿它们去查
 *    扫描时建好的那张表，查不到就 404——没有拼接、没有 `..`、没有可穿越的形状。这条比
 *    资产路由那条「单段文件名」更彻底：连文件名都不从请求里来。
 *
 * 取不到（没有 HTTP 面、这台机器一个字体文件都没扫到）都只是「本地字体没了」，预览照旧
 * 用自带的那两支画——本模块任何一步失败都不抛到调用方。
 */
import { open, readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { fontFamilyList, normalizeFamily, pickFontFace, type FontFileInfo } from '../core/font/catalog.ts'
import { FONT_ROUTE } from '../core/font/route.ts'
import { extractFace, readFontFaces, type FontFaceInfo, type FontRead } from '../core/font/sfnt.ts'
import { registerRoute, type RouteRequest, type RouteResponse } from './web-server.ts'

/** 认这些后缀。`.woff`/`.woff2` 不收：Skia 不解析 web 字体容器，收进来也只是多一批扫不动的东西。 */
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc'])

/** 扫描上限：字体目录再畸形也不至于有这么多字体，兜底防的是「指向 / 的软链接」。 */
const MAX_FONT_FILES = 4000

/**
 * 后台扫描同时开几个文件。
 *
 * 这个数字是**量出来的**，不是拍脑袋：本机（macOS，安全扫描拦在 `open` 上）16 路并发下
 * 每个文件要 414ms、2 路只要 ~25ms，而 788 个文件扫完的总时长三档都是 17–21 秒
 * （16 路 17.2s / 4 路 19.2s / 2 路 18.1s）。也就是说**并发在这里买不到吞吐，只买到排队**，
 * 却把前台取脸从 210ms 拖到 1.6s。取脸在预览打开那一瞬间是硬等（`fontManager` 等它才排
 * 得出版式），所以宁可窄。
 *
 * 别按「并发更快」的直觉把它调大：真要大改，先量「单个 open 的耗时 × 分母」。
 */
const SCAN_CONCURRENCY = 2

/**
 * 这台机器上字体都在哪。
 *
 * 参数是给判据开的：平台分派是纯函数，没必要为了测 Windows 的路径去跑 Windows。
 */
export function systemFontDirs(
  platform: string = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string[] {
  if (platform === 'darwin') {
    return [
      '/System/Library/Fonts',
      '/System/Library/Fonts/Supplemental',
      '/Library/Fonts',
      join(home, 'Library/Fonts'),
    ]
  }
  if (platform === 'win32') {
    const root = env['SystemRoot'] ?? 'C:\\Windows'
    const local = env['LOCALAPPDATA']
    return [
      join(root, 'Fonts'),
      ...(local === undefined ? [] : [join(local, 'Microsoft/Windows/Fonts')]),
    ]
  }
  return [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    join(home, '.local/share/fonts'),
    join(home, '.fonts'),
  ]
}

/** 一份扫出来的字体库：路径清单先去列目录，族名清单在后台慢慢补。 */
export interface FontLibrary {
  /** 扫出来的全部文件。第一次调用才开始扫（真扫完要开几百个文件，见 `createFontLibrary`）。 */
  files(): Promise<FontFileInfo[]>
  /** 后台那一趟扫完（成功或失败）就 resolve。 */
  ready(): Promise<void>
  /** 现在知道哪些族；`pending` 说明后台还在扫，过一会儿再来问会更多。 */
  families(): Promise<{ families: { family: string; weights: number[] }[]; pending: boolean }>
  /** 取一张脸的字节（集合会拆成独立文件）。挑不到就是 `null`。 */
  read(family: string, style: string): Promise<{ bytes: Uint8Array; face: FontFaceInfo } | null>
}

/** 「等一会儿」用一个能被打断的定时器：判据里不必真的等。 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    // Node 的定时器对象有 `unref`；浏览器/别的运行时没有。
    const handle = timer as unknown as { unref?: () => void }
    handle.unref?.()
  })
}

/**
 * 按**文件名**先挑几个候选文件（只列目录，一个都不打开）。
 *
 * 为什么需要这一层：这台机器上 `open()` 要 ~40ms（`stat` 只要 0.06ms——不是磁盘慢，是每次
 * 打开都被安全扫描拦了一道，沙箱内外一样），扫 789 个字体文件要 32 秒。而「把稿子里写的族
 * 画出来」这件事**不能等那 32 秒**：文件名在 macOS/Linux 上离族名很近（`PingFang.ttc` ↔
 * `PingFang SC`），先开这一两个文件（40–120ms）就够回答绝大多数请求；真正准确的那份清单
 * 由后台扫完再补上（`/list` 的 `pending`）。
 *
 * 这个预筛**只决定去开哪几个文件**，不决定答案：命中的族名仍要 `pickFontFace` 逐字比对，
 * 筛歪了只是「没找到」——退回 Inter，而不是拿错字体画出来。
 */
export function filenameCandidates(paths: readonly string[], family: string, limit = 6): string[] {
  const key = normalizeFamily(family)
  if (key.length < 2) return []
  const scored: { path: string; score: number; collection: number }[] = []
  for (const path of paths) {
    const stem = normalizeFamily(basename(path, extname(path)))
    if (stem.length < 3) continue
    let score = -1
    if (stem === key) score = 0
    // `PingFang` ⊂ `PingFang SC` / `Songti` ⊂ `Songti SC`：文件名常常只写族名主干。
    else if (key.startsWith(stem)) score = 1
    // `HelveticaNeue` ⊃ `Helvetica`：文档写的是简称时，文件名更具体——先开它，匹配的事交给比对。
    else if (stem.startsWith(key)) score = 2
    if (score < 0) continue
    scored.push({ path, score, collection: /\.(ttc|otc)$/i.test(path) ? 1 : 0 })
  }
  scored.sort((left, right) =>
    left.score - right.score || left.collection - right.collection || left.path.length - right.path.length)
  return scored.slice(0, limit).map((entry) => entry.path)
}

/**
 * 一个字体文件有哪几张脸。读不出来返回 `null`（不抛）：字体目录里躺着半截下载、改错后缀的
 * 东西，一个坏文件不该让整份清单消失。
 */
async function scanFontFile(path: string): Promise<FontFileInfo | null> {
  let handle
  try {
    handle = await open(path, 'r')
  } catch {
    return null
  }
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < 12) return null
    const size = stat.size
    const read: FontRead = async (offset, length) => {
      const want = Math.max(0, Math.min(length, size - offset))
      if (want <= 0) return new Uint8Array(0)
      const buffer = new Uint8Array(want)
      const { bytesRead } = await handle.read(buffer, 0, want, offset)
      return bytesRead === want ? buffer : buffer.subarray(0, bytesRead)
    }
    const faces = await readFontFaces(read, size)
    if (faces.length === 0) return null
    // 两张脸以上必然是集合；单张脸的集合（很少见）与普通文件对调用方是同一种东西
    // ——整份递过去 Skia 取第 0 张，那张就是唯一一张。
    return { path, size, collection: faces.length > 1, faces }
  } catch {
    return null
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** 递进来的目录下有哪些字体文件（两层深：`/usr/share/fonts` 底下按厂商分目录）。 */
async function collectFontPaths(
  dir: string,
  depth: number,
  out: string[],
): Promise<void> {
  if (out.length >= MAX_FONT_FILES) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FONT_FILES) return
    if (entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth > 0) await collectFontPaths(path, depth - 1, out)
    } else if (entry.isFile() && FONT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      out.push(path)
    }
  }
}

/** 按批跑，别把 500 个 `open` 一起甩给系统。 */
async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await run(items[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * 一份字体库。**两段式**，因为「列清单」与「取一张脸」的代价差着两个数量级：
 *
 * - 列目录（`readdir`）很快，本机 4 个目录 789 个文件不到 2ms；
 * - 打开并解析一个文件在本机要 ~40ms（安全扫描拦在 `open` 上），789 个就是 32 秒。
 *
 * 所以取脸走**文件名预筛**（开最多 6 个候选，40–240ms），族名清单交给**后台慢扫**：
 * `/list` 立即可回（带上 `pending`），面板过一会儿再来问就多一批。
 *
 * 这套折法不是自找的复杂度——「预览打开就要画出字」不能等 32 秒，而「下拉里有哪些族」
 * 等得起。把两件事拆开，快的那条永远快。
 */
/**
 * 一份字体库的注入项（只有判据用得上）：把「开文件读脸」这一步换成可数的假实现，
 * 就能验证**同一个文件不会被开两次**——这件事在真磁盘上只看得到耗时长一点。
 */
export interface FontLibraryOptions {
  scan?: (path: string) => Promise<FontFileInfo | null>
}

export function createFontLibrary(
  dirs: readonly string[] = systemFontDirs(),
  options: FontLibraryOptions = {},
): FontLibrary {
  const scan = options.scan ?? scanFontFile
  let pathsCache: Promise<string[]> | undefined
  let indexCache: Promise<FontFileInfo[]> | undefined
  /** 后台那一趟有没有跑完（成功或失败都算跑完：`/list` 的 `pending` 看它）。 */
  let indexDone = false
  /** 已经解析过的文件（含随路解析的候选）：两条路共用，后台扫到同一个文件时不重复开。 */
  const parsed = new Map<string, FontFileInfo | null>()
  /** 正在解析的文件。**必须共享在飞的那一支**：后台 16 路扫描与一次取脸很容易撞上同一个
   * 文件（`PingFang.ttc` 就是这样），各开一次不只是白读 74MB——`open` 本身在本机要 40ms
   * 且要排安全扫描的队，重复开会让「取脸」从 216ms 变成 1.6s。 */
  const parsing = new Map<string, Promise<FontFileInfo | null>>()
  const faces = new Map<string, Uint8Array>()
  /**
   * 前台（取脸）正在跑几个；后台扫描在每个文件之前先让路。
   *
   * 真机实测：本机 `open` 在 16 路并发下要 414ms（单个只要 40ms——安全扫描基本是排队过的），
   * 于是 74MB 的 `PingFang.ttc` 单独读是 216ms、在后台扫描跑着的时候是 1.6s。取脸在预览
   * 打开的那一瞬间（`fontManager` 等它才排得出版式），后台扫只是为了填下拉框——让路的方向
   * 明确：取脸的这两百毫秒值钱，扫描多花两百毫秒没人看得见。
   */
  let foreground = 0
  const idle: (() => void)[] = []
  const enterForeground = (): void => {
    foreground += 1
  }
  const exitForeground = (): void => {
    foreground -= 1
    if (foreground > 0) return
    for (const wake of idle.splice(0)) wake()
  }
  const whenIdle = (): Promise<void> =>
    foreground === 0 ? Promise.resolve() : new Promise<void>((resolve) => idle.push(resolve))

  const paths = (): Promise<string[]> => {
    pathsCache ??= (async () => {
      const found: string[] = []
      for (const dir of dirs) await collectFontPaths(dir, 1, found)
      return found
    })().catch(() => {
      pathsCache = undefined
      return [] as string[]
    })
    return pathsCache
  }

  const parseOne = async (path: string): Promise<FontFileInfo | null> => {
    if (parsed.has(path)) return parsed.get(path) ?? null
    const running = parsing.get(path)
    if (running !== undefined) return running
    const job = scan(path)
      .then((info) => {
        parsed.set(path, info)
        return info
      })
      .finally(() => {
        parsing.delete(path)
      })
    parsing.set(path, job)
    return job
  }

  const startIndex = (): Promise<FontFileInfo[]> => {
    indexCache ??= (async () => {
      const all = await paths()
      // 后台扫描在每个文件之前让路给取脸（见 `whenIdle`）：它的产出只是下拉框里多几行。
      const scanned = await mapLimit(all, SCAN_CONCURRENCY, async (path) => {
        await whenIdle()
        return parseOne(path)
      })
      indexDone = true
      // 同一支字体常在两三个目录里各有一份（系统目录 + `~/Library/Fonts` 的旧拷贝）；
      // 重复的族名留给 `pickFontFace` 按「非集合优先」去挑。
      return scanned.filter((file): file is FontFileInfo => file !== null)
    })().catch(() => {
      // 扫失败（权限、目录都变了）不留档：下一次问重来一遍，而不是这一整页都没本地字体。
      indexCache = undefined
      indexDone = false
      return [] as FontFileInfo[]
    })
    return indexCache
  }

  /** 还没扫完时的那条快路：只开文件名像的那几个。 */
  const quickPool = async (family: string): Promise<FontFileInfo[]> => {
    const candidates = filenameCandidates(await paths(), family)
    const infos = await mapLimit(candidates, 4, parseOne)
    return infos.filter((file): file is FontFileInfo => file !== null)
  }

  return {
    files: startIndex,
    async ready() {
      await startIndex()
    },
    async families() {
      // 第一次问就把后台那一趟发出去（面板打开＝用户想看到清单）。
      void startIndex()
      const known = [...parsed.values()].filter((file): file is FontFileInfo => file !== null)
      return { families: fontFamilyList(known), pending: !indexDone }
    },
    async read(family, style) {
      // 这一趟是**前台**：后台扫描在这期间让路（真机上这就是 216ms 与 1.6s 的差别）。
      enterForeground()
      try {
        // 扫完了就用全表（准确）；还没扫完就用文件名候选（快）。
        const pool = indexDone ? await startIndex() : await quickPool(family)
        const hit = pickFontFace(pool, family, style)
        if (hit === null) return null
        const key = `${hit.file.path}#${hit.face.index}`
        const cached = faces.get(key)
        if (cached !== undefined) return { bytes: cached, face: hit.face }
        let raw: Uint8Array
        try {
          raw = new Uint8Array(await readFile(hit.file.path))
        } catch {
          return null
        }
        const bytes = hit.file.collection ? extractFace(raw, hit.face.index) : raw
        if (bytes === null) return null
        faces.set(key, bytes)
        return { bytes, face: hit.face }
      } finally {
        exitForeground()
      }
    },
  }
}

/** 一条 `{ families: [...] }` 的 JSON 响应。 */
function respondJson(res: RouteResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
    // 清单随「用户刚装了一支字体」而变，而这次请求只在面板打开时发一次：不回缓存。
    'cache-control': 'no-store',
  })
  res.end(text)
}

function respondText(res: RouteResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(body)
}

/**
 * 处理一次本地字体请求。
 *
 * `/list` 与 `/file` 两条：前者给面板列族名，后者给预览器取字节。其余一律 404——包括
 * 任何看起来像路径的东西（这条路由**不读路径**，只读两个 query 键）。
 */
export function serveFontRequest(
  req: RouteRequest,
  res: RouteResponse,
  library: FontLibrary = createFontLibrary(),
): void {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    respondText(res, 405, 'method not allowed')
    return
  }
  let url: URL
  try {
    url = new URL(req.url ?? '/', 'http://dsh-canvas.local')
  } catch {
    respondText(res, 404, 'not found')
    return
  }
  const sub = url.pathname.slice(FONT_ROUTE.length).replace(/\/+$/, '')
  const head = method === 'HEAD'

  if (sub === '/list') {
    // `?wait=600`：最多等这么久再答。后台扫在本机要几十秒，面板不能一直等——它拿到
    // `pending: true` 之后隔一会儿再问，清单一批批长出来。
    const wait = Math.min(Math.max(Number(url.searchParams.get('wait') ?? 0) || 0, 0), 5000)
    const started = Date.now()
    void (async () => {
      void library.ready()
      if (wait > 0) await Promise.race([library.ready(), delay(wait)])
      const snapshot = await library.families()
      if (head) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end()
        return
      }
      respondJson(res, 200, { ...snapshot, waited: Date.now() - started })
    })().catch(() => respondJson(res, 200, { families: [], pending: false }))
    return
  }

  if (sub === '/file') {
    const family = url.searchParams.get('family') ?? ''
    const style = url.searchParams.get('style') ?? 'Regular'
    if (family.trim() === '') {
      respondText(res, 400, 'family required')
      return
    }
    void library
      .read(family, style)
      .then((found) => {
        if (found === null) {
          respondText(res, 404, 'not found')
          return
        }
        res.writeHead(200, {
          'content-type': 'font/ttf',
          'content-length': String(found.bytes.byteLength),
          // 同一份字节在页面里由 `fontManager` 自己留一份，浏览器缓存没有意义。
          'cache-control': 'no-store',
        })
        if (head) res.end()
        else res.end(found.bytes)
      })
      .catch(() => respondText(res, 404, 'not found'))
    return
  }

  respondText(res, 404, 'not found')
}

/**
 * 注册本地字体路由（跟着插件的生命周期走）。
 *
 * `library` 可注入：判据要一份「我知道的那几支假字体」的库，生产里就是这台机器的字体目录。
 */
export function registerFontRoute(
  ctx: Context,
  library: FontLibrary = createFontLibrary(),
): void {
  registerRoute(ctx, {
    path: FONT_ROUTE,
    label: 'dsh-canvas: local font route',
    handler: (req, res) => serveFontRequest(req, res, library),
  })
}
