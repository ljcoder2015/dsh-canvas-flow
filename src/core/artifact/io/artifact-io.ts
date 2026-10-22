/**
 * dsh-canvas — artifact access through the host filesystem seam (§4.9).
 *
 * Every read and write goes through `ctx.fs`, never `node:fs`: the same code
 * then works against a local, remote or sandboxed workspace, and it inherits
 * the seam's version guards, sandbox policy parameters and the
 * `fs/write-intent` / `fs/edit-intent` waterfalls that F8.4 hooks into.
 *
 * The one operation the seam has no verb for is {@link ArtifactIo.renameEntry}
 * (F1.12): the seam writes *content* to a target, so a rename would have to be
 * expressed as "write the file elsewhere, then delete the original" — and there
 * is no delete either. That method is therefore the single place this plugin
 * reaches past the seam, and it does so with a proof in hand (the backend must
 * map the path straight back into its own world) plus the same sandbox refusal
 * every other mutation gets.
 *
 * Every method here takes the artifact's path *relative to the project root*
 * (§2.2) — the card record's `file`, not the card id — and resolves it against
 * the project root rather than concatenating strings: the seam owns the join
 * and the containment rules.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsErrorCode, FsTarget, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ArtifactView, BundleFile, BundleView, CardId, CardSummary, FolderEntry } from '../../../types.ts'
import { PROBE_HEAD_LIMIT, digestOf, detectKind, isHtmlKind, isMediaKind, kindLabel, outlineOf, type KindProbe } from '../kind/kind-registry.ts'
import { dirnameOf, isEntryPage } from '../../canvas/card/card-name.ts'
import { isArtifactFolder } from '../../canvas/project/artifact-folders.ts'
import { BUNDLE_DEPTH_LIMIT, BUNDLE_ENTRY_BYTES_LIMIT, bundleAdmits, bundleSkipped, bundleTarget, type BundleLedger } from './bundle.ts'
import { injectPreviewLinkGuard, inlineWebAppAssets, webAppAssetRefs, webappFiles } from '../kind/webapp.ts'
import { injectPreviewPicker } from '../kind/preview-picker.ts'
import { decodeDesignFile, designDigest, encodeDesignFile, type DesignGraph } from '../design/document.ts'
import { MEDIA_MIME, mediaMimeOf } from '../../media/mime.ts'

/** A classified artifact: the kind plus the facts the board and the digest need. */
export interface ArtifactFacts {
  cardId: CardId
  kind: string
  kindLabel: string
  /** Absolute display path, for the card caption and error messages. */
  displayPath: string
  present: boolean
  /** Byte size when the target is a regular file. */
  bytes: number
  /** Freshness token of the content the facts were read from. */
  version: string
}

/**
 * 卡片预览用的原文头部字符数（markdown 专有）。
 *
 * 画布卡片只有 200×140，几百字符渲染出来已经填满整张卡面；再多只是把
 * `CardSummary` 撑大，往来的每一趟 wire 都在付这几十行的运费。
 */
export const PREVIEW_HEAD_CHARS = 600

/** A directory that can host a project, as the folder picker lists it. */
export interface ProjectCandidate {
  name: string
  root: string
}

/**
 * How sure a probe is that an artifact is there (F1.11).
 *
 * Three values rather than a boolean because the two failures are not the same
 * fact: `absent` is the seam *saying* there is no such file, while `unknown` is
 * the seam being unable to answer at all — a card id that will not resolve, a
 * `stat` the sandbox or the permissions refused. A board can draw both the same
 * way, but an operation that takes cards *off* the board must not: it may only
 * act on what it can prove.
 */
export type Presence = 'present' | 'absent' | 'unknown'

/**
 * Whether a card's artifact is provably gone (F3.5 / F1.11).
 *
 * `seatedEmpty` is the card's own record of having been seated without an
 * artifact and never observed with one since — a seat is allowed to exist
 * before its file does (a dock spec seeds the file a moment later, a bitmap has
 * no text form until a generation run fills it, an Agent may seat a card for
 * what it is about to write), so that state is **not** a missing artifact and
 * must never be swept up as one.
 */
export function missingOf(presence: Presence, seatedEmpty: boolean | undefined): boolean {
  return presence === 'absent' && seatedEmpty !== true
}

/**
 * The seam's stable error code (`FS_*`) of a caught value, or `undefined`.
 *
 * Checked structurally, never with `instanceof`: the host runtime and this
 * bundle may hold different `FsError` classes for the same vocabulary, so the
 * `FS_` code prefix is the identity `dsh-fs` actually owns. Callers branch on
 * the code, never on the message.
 */
export function fsErrorCodeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.startsWith('FS_') ? code : undefined
}

/** Whether a caught value is the seam's own typed error (see {@link fsErrorCodeOf}). */
function isSeamError(error: unknown): boolean {
  return error instanceof Error && fsErrorCodeOf(error) !== undefined
}

/**
 * The seam's code for a failure the OS reported on a rename (F1.12).
 *
 * `ArtifactIo.renameEntry` is the one call that reaches the platform directly,
 * so it is also the one place that has to translate `errno` back into the
 * vocabulary the rest of the plugin branches on. Anything unrecognised is an
 * I/O failure rather than a guess: the caller shows the message and the user
 * decides.
 */
function renameErrorCodeOf(error: unknown): FsErrorCode {
  switch ((error as { code?: unknown } | null)?.code) {
    case 'ENOENT':
      return 'FS_NOT_FOUND'
    case 'EACCES':
    case 'EPERM':
      return 'FS_PERMISSION_DENIED'
    default:
      return 'FS_IO_ERROR'
  }
}

/**
 * 一次 `writeFile` 失败翻成缝的错误码。
 *
 * 与 {@link renameErrorCodeOf} 分开写而不是共用一个「按 errno 翻译」的函数：两次调用
 * 失败的**含义**不同（改名失败要说「那个名字搬不动」，写字节失败要说「这个文件写不
 * 进去」），而错误码是调用方拿去分支的东西——真有一天 ENOENT 在写路径上要翻成别的
 * 东西（比如「目标目录不在」），分开的这两处才改得动。
 */
function writeErrorCodeOf(error: unknown): FsErrorCode {
  switch ((error as { code?: unknown } | null)?.code) {
    case 'ENOENT':
      return 'FS_NOT_FOUND'
    case 'EACCES':
    case 'EPERM':
      return 'FS_PERMISSION_DENIED'
    case 'ENOSPC':
      return 'FS_TOO_LARGE'
    default:
      return 'FS_IO_ERROR'
  }
}

/**
 * Cards a single project scan may seat. Each one costs the caller a facts
 * read, so binding a broad root must stay a bounded crawl (F1.3).
 */
const MAX_SCAN_CARDS = 60

/** Character cap on the text an artifact view carries across the wire (F3.8). */
export const VIEW_TEXT_CAP = 2_000_000
/** Byte cap on the binary media an artifact view carries across the wire (F3.8). */
export const VIEW_BYTES_CAP = 16_000_000

/**
 * 媒体扩展名 → MIME 的表已经搬到 `core/media/mime.ts`（它不再是 IO 的私事：
 * 客户端判「这个文件能不能当产物」也要读它，而客户端引不动这个模块——这里为了字节
 * 通道引了 `node:fs`）。这里**再导出**一次，老 import 一条都不断。
 */
export { MEDIA_MIME, mediaMimeOf }

/**
 * The slice of `ctx.sandboxPolicy` (`@deepseek-ai/dsh-sandbox-policy`) this
 * module needs.
 *
 * Structural, and resolved by name, because that package is a harness
 * companion rather than a dependency of this plugin: the same bundle runs in a
 * composition that confines and in one that never does, and only the former
 * provides the service.
 */
interface SandboxPolicyService {
  /** The standing policy: deployment default mode, session cwd as the root. */
  resolve(): SandboxExecutionPolicy
}

/** Filesystem-facing helpers shared by both runtimes and the tool layer. */
export class ArtifactIo {
  constructor(private readonly ctx: Context) {}

  /** Resolve a project-relative card id to a seam target. */
  private async targetOf(root: string, cardId: CardId, signal?: AbortSignal): Promise<FsTarget> {
    return this.ctx.fs.resolve(cardId, { cwd: root, signal })
  }

  /**
   * 把产物目录建出来（F1.13）。
   *
   * 产物按类型分目录之后，`docs/文本1.md` 的第一个写往往发生在一个还不存在的目录里：
   * 缝的 `writeText` 只负责「把内容发布到这个 target」，父目录不在就是一次 `ENOENT`
   * ——一张新卡于是当场写不出种子文字，而错误离现场很远。
   *
   * 为什么不把这件事交给调用方：**建目录是这个 IO 层的职责**，与 `writeBytes` 里那行
   * `mkdir` 是同一条理由（它早就这么做了）。守卫也照抄它：包含性用缝自己的 `contains`
   * 判、只读部署一个目录都不建、另一个执行世界则原样放手（那边的后端自己会处理，
   * 本进程手里的路径并不指向它）。
   *
   * 空串与 `.` 是「就在项目根上」，什么都不做——那是最常见的一档，不该付一次系统调用。
   */
  async ensureFolder(root: string, folder: string, signal?: AbortSignal): Promise<void> {
    if (folder === '' || folder === '.') return
    const target = await this.targetOf(root, folder, signal)
    const boundary = await this.ctx.fs.resolve(root, { signal })
    if (!this.ctx.fs.contains(boundary, target)) {
      throw new FsError(`a folder may not leave the canvas folder: ${folder}`, 'FS_PERMISSION_DENIED')
    }
    if (this.policyFor(root)?.mode === 'read-only') {
      throw new FsError(`this deployment is read-only, so ${folder} cannot be created`, 'FS_SANDBOX_DENIED')
    }
    const path = await this.processPathOf(target, signal)
    if (path === undefined) return
    try {
      await mkdir(path, { recursive: true })
    } catch (error) {
      throw new FsError(`creating ${folder} failed`, writeErrorCodeOf(error), { cause: error })
    }
  }

  /**
   * Gather the evidence a kind decision needs (F2.2).
   *
   * Bounded on purpose: at most {@link PROBE_HEAD_LIMIT} characters of text and
   * a directory listing, so classifying a large artifact never reads it whole.
   * A missing target is not an error here — a card may be seated on the board
   * before its file exists — so the caller learns `present: false` instead of
   * catching.
   */
  async probe(root: string, cardId: CardId, signal?: AbortSignal): Promise<KindProbe & { present: boolean; bytes: number; version: string }> {
    const base = {
      path: cardId,
      basename: cardId.split('/').pop() ?? cardId,
      extension: (cardId.split('.').length > 1 ? cardId.split('.').pop() ?? '' : '').toLowerCase(),
    }

    let target: FsTarget
    try {
      target = await this.targetOf(root, cardId, signal)
    } catch {
      return { ...base, directory: false, head: '', children: [], present: false, bytes: 0, version: '' }
    }

    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) {
      return { ...base, directory: false, head: '', children: [], present: false, bytes: 0, version: '' }
    }

    if (info.type === 'directory') {
      const children = await this.ctx.fs.listDir(target, signal)
      return {
        ...base,
        directory: true,
        head: '',
        children: children.map((child) => child.name),
        present: true,
        bytes: 0,
        version: String(info.version),
      }
    }

    let head = ''
    try {
      head = (await this.ctx.fs.readText(target, signal)).slice(0, PROBE_HEAD_LIMIT)
    } catch (error) {
      // Binary or over-budget content still has a decidable kind from its
      // extension; only the deck-vs-page refinement is lost.
      if (!isSeamError(error)) throw error
    }

    return {
      ...base,
      directory: false,
      head,
      children: [],
      present: true,
      bytes: info.size ?? 0,
      version: String(info.version),
    }
  }

  /**
   * Whether an artifact is there, without reading a byte of it (F1.11).
   *
   * {@link probe} answers "what is this, and what does it say", and pays for
   * that with a bounded head read and a directory listing; it also folds every
   * failure into `present: false`. A board paint needs none of that — it needs
   * "is it there" — and an operation that *removes* cards needs the difference
   * between "the seam says no" and "the seam could not say", so this returns
   * the three-valued {@link Presence} instead.
   */
  async presenceOf(root: string, cardId: CardId, signal?: AbortSignal): Promise<Presence> {
    let target: FsTarget
    try {
      target = await this.targetOf(root, cardId, signal)
    } catch {
      // A card id the seam will not resolve: unrepresentable path, or one the
      // sandbox maps out of this execution world. Not absence.
      return 'unknown'
    }
    try {
      return (await this.ctx.fs.stat(target, signal)) === undefined ? 'absent' : 'present'
    } catch {
      // Refused or failed rather than answered (`FS_PERMISSION_DENIED`,
      // `FS_SANDBOX_DENIED`, `FS_IO_ERROR`): we cannot claim it is gone.
      return 'unknown'
    }
  }

  /** Classify one card from its evidence. */
  async facts(root: string, cardId: CardId, signal?: AbortSignal): Promise<ArtifactFacts> {
    const probe = await this.probe(root, cardId, signal)
    const kind = detectKind(probe)
    return {
      cardId,
      kind,
      kindLabel: kindLabel(kind),
      displayPath: probe.present ? await this.displayPathOf(root, cardId, signal) : cardId,
      present: probe.present,
      bytes: probe.bytes,
      version: probe.version,
    }
  }

  /** Absolute, host-facing path of a card id. */
  async displayPathOf(root: string, cardId: CardId, signal?: AbortSignal): Promise<string> {
    const target = await this.targetOf(root, cardId, signal)
    return this.ctx.fs.processPath(target)
  }

  /**
   * Read an artifact's text.
   *
   * Rejects a missing target and a non-text target with the seam's own
   * `FsError`, so callers get consistent codes rather than a plugin-specific
   * vocabulary.
   */
  async readText(root: string, cardId: CardId, signal?: AbortSignal): Promise<{ text: string; version: FsVersion }> {
    const target = await this.targetOf(root, cardId, signal)
    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) throw new FsError(`artifact is absent: ${cardId}`, 'FS_NOT_FOUND')
    if (info.type !== 'file') throw new FsError(`artifact is not a regular file: ${cardId}`, 'FS_NOT_REGULAR_FILE')
    const text = await this.ctx.fs.readText(target, signal)
    return { text, version: info.version }
  }

  /**
   * Build the bounded digest injected into a card session (F5.2).
   *
   * `budget` is the caller's (`Config.summaryBudget`), so the same artifact can
   * be digested tightly for a prompt and loosely for a preview without a second
   * code path.
   */
  async summarize(root: string, cardId: CardId, budget: number, signal?: AbortSignal): Promise<CardSummary> {
    const facts = await this.facts(root, cardId, signal)
    if (!facts.present) {
      throw new FsError(`artifact is absent: ${cardId}`, 'FS_NOT_FOUND')
    }

    // A design document's digest comes from the decoded structure, not from
    // the file's text — the envelope's base64 body is noise to a prompt.
    if (facts.kind === 'design') {
      try {
        const { doc } = await this.readDesign(root, cardId, signal)
        const { summary, outline } = designDigest(doc, budget)
        return {
          cardId,
          kind: facts.kind,
          path: facts.displayPath,
          summary,
          outline,
          head: '',
          bytes: facts.bytes,
          updatedAt: Date.now(),
        }
      } catch (error) {
        if (!isSeamError(error)) throw error
        // Undecodable content falls through to the generic text digest, which
        // shows the envelope header at least — honest about being unreadable.
      }
    }

    let text = ''
    // 媒体的字节不是文本：读它只会换来一串替换字符，而那串字符会顺着 digest 一路进
    // 下游卡片的提示词（F5.2）。**形态清单只有 `MEDIA_KINDS` 一份**——这句判断原先手写了
    // image / video 两个名字，加音频时漏了它，于是 mp3 被当文本读（与 `canvas-tab.ts` 的
    // `CLAIMABLE` 同一类漏网，都是「判定与认领各说各话，而且不报错」）。
    if (!isMediaKind(facts.kind)) {
      try {
        text = (await this.readText(root, cardId, signal)).text
      } catch (error) {
        if (!isSeamError(error)) throw error
      }
    }

    // 归并后 html 产物只有 app 一种；folder 是没有入口页的普通目录。
    const isDirectory = facts.kind === 'app' || facts.kind === 'folder'
    return {
      cardId,
      kind: facts.kind,
      path: facts.displayPath,
      summary: isDirectory
        ? `${facts.kindLabel} · ${String(facts.bytes)} B`
        : digestOf(facts.kind, text, budget),
      outline: outlineOf(facts.kind, text),
      // 预览的原文头部只对 markdown 有意义：它是「文件即文本」的 kind（F3.12），
      // 卡片直接渲染头部就是渲染产物本身；其余 kind 的 text 是标记或数据，渲染出来是噪音。
      head: facts.kind === 'markdown' ? text.trim().slice(0, PREVIEW_HEAD_CHARS) : '',
      bytes: facts.bytes,
      updatedAt: Date.now(),
    }
  }

  /**
   * Write a webapp scaffold into a fresh folder under the project root (应用节点).
   *
   * Four small files — manifest, entry page, token stylesheet, components —
   * through the same seam and the same per-call policy as {@link write}. The
   * manifest goes first so a scaffold interrupted partway still leaves kind
   * evidence behind: the folder reads as a webapp, not as a half-built site.
   * The caller owns collision handling; this method overwrites nothing it did
   * not just decide to create.
   */
  async writeScaffold(root: string, folder: string, title: string, signal?: AbortSignal): Promise<void> {
    // 应用目录现在落在 `apps/` 下（F1.13）：`apps/应用1` 这一层在第一次写之前并不存在。
    await this.ensureFolder(root, dirnameOf(folder), signal)
    for (const file of webappFiles(title)) {
      const target = await this.ctx.fs.resolve(`${folder}/${file.path}`, { cwd: root, signal })
      await this.ctx.fs.writeText(target, file.content, undefined, signal, this.policyFor(root))
    }
  }

  /**
   * Read a design document (设计节点, F2.6).
   *
   * The `.design` file is a text envelope — one header line plus a JSON
   * snapshot of the scene graph — because the workspace seam is text-write-
   * only; the decode lives in `core/artifact/design/`. Malformed content is
   * the caller's error to present, so the envelope's own exceptions surface
   * untouched.
   */
  async readDesign(root: string, cardId: CardId, signal?: AbortSignal): Promise<{ doc: DesignGraph; version: FsVersion }> {
    const { text, version } = await this.readText(root, cardId, signal)
    return { doc: decodeDesignFile(text), version }
  }

  /** Write a design document through the same seam and sandbox policy as {@link write}. */
  async writeDesign(
    root: string,
    cardId: CardId,
    doc: DesignGraph,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
  ): Promise<{ operation: 'create' | 'update'; version: string; before: string | null }> {
    return this.write(root, cardId, encodeDesignFile(doc), expected, signal)
  }

  /** Cap on the local assets one HTML preview inlines. */
  private static readonly PAGE_ASSET_BUDGET = 12
  /** Character cap on one inlined asset; bigger files are left as references. */
  private static readonly PAGE_ASSET_CAP = 1_000_000

  /**
   * Inline an HTML page's local stylesheets and scripts into its text.
   *
   * Every kind in {@link HTML_KINDS} previews by running its markup in a
   * sandboxed iframe, and the fullscreen viewer renders exactly one `srcDoc` —
   * a document with no base URL to resolve `styles.css` or `app.js` against.
   * Without this, the preview of *any* multi-file page runs unstyled and dead;
   * with it the folder keeps its multi-file shape on disk and the preview
   * still shows the running page. References resolve against the entry page's
   * own directory, so a card seated on `app/index.html` inlines
   * `app/styles.css`. Referenced assets that are missing or unreadable are
   * left as references, which is the honest rendering of a broken page rather
   * than a silent one.
   */
  private async inlinePageAssets(
    root: string,
    cardId: CardId,
    html: string,
    signal?: AbortSignal | undefined,
  ): Promise<string> {
    const refs = webAppAssetRefs(html).slice(0, ArtifactIo.PAGE_ASSET_BUDGET)
    if (refs.length === 0) return html
    const dir = cardId.includes('/') ? cardId.slice(0, cardId.lastIndexOf('/') + 1) : ''
    const assets = new Map<string, string>()
    for (const ref of refs) {
      try {
        const { text } = await this.readText(root, `${dir}${ref}`, signal)
        if (text.length <= ArtifactIo.PAGE_ASSET_CAP) assets.set(ref, text)
      } catch (error) {
        if (!isSeamError(error)) throw error
      }
    }
    if (assets.size === 0) return html
    return inlineWebAppAssets(html, (ref) => assets.get(ref))
  }

  /**
   * Build the fullscreen view payload of one artifact (F3.8).
   *
   * Where {@link summarize} deliberately bounds what it reads, this method
   * reads *whole* — the view is what a person opens to read the artifact — and
   * the caps here are wire caps, not digestion: text kinds are truncated at
   * {@link VIEW_TEXT_CAP} characters and binary media refused above
   * {@link VIEW_BYTES_CAP} bytes, both reported through `truncated` so the
   * browser can say so honestly instead of rendering a silent excerpt.
   *
   * A missing target is a state, not a failure — a seated card whose file has
   * not been written yet still gets its viewer, showing an absent state.
   *
   * An HTML page is the one kind whose *text* is not what it shows: the view
   * carries the page with its local stylesheets and scripts inlined, because
   * the iframe renders a `srcdoc` with no base URL to resolve them against
   * ({@link inlinePageAssets}) — and with the link guard installed, for the
   * same reason: a relative *link* resolves against the host page just as a
   * relative stylesheet reference does, which is what clicking one used to do
   * (navigate the preview to the host app, and land on its 401).
   */
  async view(root: string, cardId: CardId, signal?: AbortSignal): Promise<ArtifactView> {
    const facts = await this.facts(root, cardId, signal)
    const base = {
      cardId,
      // `cardId` is the artifact path at this layer; the runtime overrides it
      // with the card's real id and stamps `file` and `name`.
      file: cardId,
      name: '',
      kind: facts.kind,
      present: facts.present,
      text: '',
      dataUrl: '',
      truncated: false,
      bytes: facts.bytes,
      updatedAt: Date.now(),
    }
    if (!facts.present) return base

    const extension = (cardId.split('.').pop() ?? '').toLowerCase()

    // Binary media first: the classifier calls every image `image`, and an
    // `image` whose readText would fail is the normal case, not an error path.
    const mime = mediaMimeOf(extension)
    if (mime !== undefined) {
      if (facts.bytes > VIEW_BYTES_CAP) return { ...base, truncated: true }
      const bytes = await this.readBytesOf(root, cardId, signal)
      return { ...base, dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` }
    }

    try {
      const { text } = await this.readText(root, cardId, signal)
      const body = isHtmlKind(facts.kind)
        ? injectPreviewPicker(injectPreviewLinkGuard(await this.inlinePageAssets(root, cardId, text, signal)))
        : text
      return { ...base, text: body.slice(0, VIEW_TEXT_CAP), truncated: body.length > VIEW_TEXT_CAP }
    } catch (error) {
      // An untextual file of an unknown kind (a PDF, a binary) still gets a
      // view: inlined as a data URL when small, refused honestly when large.
      if (!isSeamError(error)) throw error
      if (facts.bytes > VIEW_BYTES_CAP) return { ...base, truncated: true }
      const bytes = await this.readBytesOf(root, cardId, signal)
      return { ...base, dataUrl: `data:${mime ?? 'application/octet-stream'};base64,${Buffer.from(bytes).toString('base64')}` }
    }
  }

  /** Read a card's whole content as bytes, through the seam's own cap. */
  private async readBytesOf(root: string, cardId: CardId, signal?: AbortSignal): Promise<Uint8Array> {
    const target = await this.targetOf(root, cardId, signal)
    return this.ctx.fs.readBytes(target, signal, VIEW_BYTES_CAP)
  }

  /**
   * Read an application artifact as the archive the browser is about to build
   * (F10.1).
   *
   * Where {@link view} answers "what does one artifact show", this answers
   * "what is *in* one artifact" — the whole folder, recursively, because an
   * exported app has to be the app and not a rendering of it. That makes this
   * the one read in the plugin that is unbounded in *shape* (a tree, not a
   * file), so it is bounded everywhere else instead:
   *
   * - names in {@link bundleSkipped} never travel (`node_modules`, `.git`, the
   *   canvas's own board projection) — they are dependencies and tool
   *   bookkeeping, not the app;
   * - every file is read through the seam's byte cap, so a large file is
   *   refused at the seam rather than buffered and then discarded;
   * - the running total and count are kept in a {@link BundleLedger}, and
   *   whatever does not fit lands in `skipped` (`truncated: true`).
   *
   * The last point is the same discipline the text export already follows: an
   * export that quietly leaves something out is worse than one that declines,
   * so nothing here is dropped silently — the caller can see exactly what was
   * left behind and say so.
   *
   * **Which entry gets packed takes both the path and the disk into account**
   * ({@link bundleTarget}): a card's `file` may name its *entry page*
   * (`应用/index.html`), so asking the disk "is this a file" answers "yes" —
   * and packing that answer ships a folder app with no stylesheet and no
   * script. An entry page means the folder around it, which is the same
   * judgement the rename path and the preview path already make.
   *
   * A missing artifact is a state, not a failure (a seated card may have no
   * file yet), so it comes back as `present: false` — the same contract
   * {@link view} keeps.
   *
   * @param root - the project root the path resolves against.
   * @param cardId - the artifact's path relative to that root (the card's
   *   `file`, never its seat id — see §9 of the technical doc).
   */
  async bundle(root: string, cardId: CardId, signal?: AbortSignal): Promise<BundleView> {
    const probe = await this.probe(root, cardId, signal)
    const plan = bundleTarget(cardId, probe.directory)
    const base: BundleView = {
      cardId,
      file: cardId,
      name: '',
      kind: detectKind(probe),
      present: probe.present,
      directory: plan.directory,
      files: [],
      skipped: [],
      bytes: 0,
      truncated: false,
    }
    if (!probe.present) return base

    const target = await this.targetOf(root, plan.path, signal)
    const files: BundleFile[] = []
    const skipped: string[] = []
    const ledger: BundleLedger = { files: 0, bytes: 0 }

    if (plan.directory) {
      await this.walkBundle(target, '', 0, files, skipped, ledger, signal)
    } else {
      // 单文件形态：包里就是它自己，用它在目录里的名字（`deck.html`），
      // 而不是整个产物路径。
      const name = cardId.split('/').pop() ?? cardId
      const file = await this.readBundleFile(target, name, signal)
      if (file === undefined) skipped.push(name)
      else {
        files.push(file)
        ledger.files += 1
        ledger.bytes += file.bytes
      }
    }

    return { ...base, files, skipped, bytes: ledger.bytes, truncated: skipped.length > 0 }
  }

  /**
   * Walk one directory of an artifact into the archive's file list.
   *
   * Entries are read in name order so the same folder always packs to the same
   * archive — an export one can compare rather than merely open. A directory
   * the seam refuses to list is left out rather than aborting the walk: a
   * folder with an unreadable corner still has an export worth having, and the
   * omission is not silent (the entry is recorded in `skipped`).
   */
  private async walkBundle(
    dir: FsTarget,
    prefix: string,
    depth: number,
    out: BundleFile[],
    skipped: string[],
    ledger: BundleLedger,
    signal?: AbortSignal,
  ): Promise<void> {
    if (depth >= BUNDLE_DEPTH_LIMIT) return
    let children: Awaited<ReturnType<typeof this.ctx.fs.listDir>>
    try {
      children = await this.ctx.fs.listDir(dir, signal)
    } catch (error) {
      if (!isSeamError(error)) throw error
      return
    }

    for (const child of [...children].sort((left, right) => left.name.localeCompare(right.name))) {
      if (bundleSkipped(child.name)) continue
      const path = prefix === '' ? child.name : `${prefix}/${child.name}`
      if (child.type === 'directory') {
        await this.walkBundle(child.target, path, depth + 1, out, skipped, ledger, signal)
        continue
      }
      if (child.type !== 'file') continue
      // The declared size is a cheap refusal: a file this big will not fit any
      // budget, so there is no reason to read it first and find out.
      if (child.size !== undefined && !bundleAdmits(child.size, ledger)) {
        skipped.push(path)
        continue
      }
      const file = await this.readBundleFile(child.target, path, signal)
      if (file === undefined || !bundleAdmits(file.bytes, ledger)) {
        skipped.push(path)
        continue
      }
      out.push(file)
      ledger.files += 1
      ledger.bytes += file.bytes
    }
  }

  /**
   * Read one file into its archive entry.
   *
   * One read, not two: the bytes come back through the seam's own cap (so a
   * file beyond {@link BUNDLE_ENTRY_BYTES_LIMIT} is refused *by the seam*,
   * never buffered here), and whether it is text is then a decoding question
   * rather than a second file read. Text travels as text because that is what
   * an app folder mostly is — HTML, CSS, JS — and base64 would tax every one
   * of those bytes by a third; anything that is not valid UTF-8 (an image, a
   * font, a GBK-encoded file) travels as its own bytes, unchanged.
   *
   * `undefined` means "this file cannot be in the archive" — too large, or
   * unreadable. The caller reports it instead of exporting a hole.
   */
  private async readBundleFile(
    target: FsTarget,
    path: string,
    signal?: AbortSignal,
  ): Promise<BundleFile | undefined> {
    let bytes: Uint8Array
    try {
      bytes = await this.ctx.fs.readBytes(target, signal, BUNDLE_ENTRY_BYTES_LIMIT)
    } catch (error) {
      if (!isSeamError(error)) throw error
      return undefined
    }
    try {
      // `fatal` is the whole judgement: a byte sequence that is not valid
      // UTF-8 is not text, and guessing a replacement character would corrupt
      // the file on the way into the archive.
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return { path, text, base64: '', bytes: bytes.byteLength }
    } catch {
      return { path, text: '', base64: Buffer.from(bytes).toString('base64'), bytes: bytes.byteLength }
    }
  }

  /**
   * The per-call sandbox policy a mutation under `root` runs under.
   *
   * A project root is picked by the user in the folder picker, and it *is* this
   * plugin's workspace: every artifact we write lands inside it. The standing
   * policy carries a different boundary — the deployment fallback root, or the
   * calling session's cwd — so a canvas opened outside the agent's own
   * workspace is refused outright (`FS_SANDBOX_DENIED`, "file access denied
   * under workspace-write mode"). That is the one that fires here, because a
   * dock click is an agentless write with no session cwd to inherit.
   *
   * So we stamp the boundary ourselves, the way `dsh-tool-fs` stamps its
   * session cwd, with the project root standing in for it. The MODE is never
   * touched: a `read-only` composition keeps refusing every write, and
   * `danger-full-access` keeps delegating unfenced. `undefined` leaves the call
   * on the backend's own default, which is all a backend that does not confine
   * has.
   */
  private policyFor(root: string): SandboxExecutionPolicy | undefined {
    const policy = this.ctx.get('sandboxPolicy') as SandboxPolicyService | undefined
    if (policy === undefined) return undefined
    const standing = policy.resolve()
    // Only `workspace-write` reads a boundary out of the policy; the other two
    // are mode-level facts, and widening one of them would be an escalation
    // this layer has no mandate to make.
    if (standing.mode !== 'workspace-write') return standing
    return { ...standing, workspaceRoot: root }
  }

  /**
   * Move one directory entry inside the project root — a file, or a folder
   * (F1.12, the rename behind a card's name).
   *
   * **Why this is not a `ctx.fs` call.** The seam's mutation vocabulary is
   * "atomically publish this *content* at this target" (`writeText`) and "edit
   * this text in place" (`editText`); a rename changes no content at all, and
   * its other half — the original must stop existing — has no verb either. So
   * the only way to express a rename through the seam would be a copy that
   * leaves the original behind, which is not a rename. This method therefore
   * hands the OS the path the backend itself reports, and pays for that with
   * two guards:
   *
   * 1. **It must be *this* file.** `processPath` names a path in the backend's
   *    execution world, which is only the local filesystem when the backend
   *    says so. A backend that serves another world (a remote, a container)
   *    answers `processPathFromHostPath` with `undefined`, or maps the path back
   *    somewhere else — and a rename that cannot be round-tripped to the same
   *    target key is refused rather than applied to whatever happens to sit at
   *    that path on this machine.
   * 2. **The deployment must allow a mutation here.** The mode comes from the
   *    same standing policy {@link write} hands the seam, so a `read-only`
   *    composition refuses a rename exactly as it refuses a write.
   *
   * Both ends are canonically inside `root` (the seam's own containment, not a
   * string prefix), so neither the source nor the destination can leave the
   * canvas folder even if a record was hand-edited to say otherwise.
   */
  async renameEntry(root: string, from: string, to: string, signal?: AbortSignal): Promise<void> {
    const source = await this.targetOf(root, from, signal)
    const destination = await this.targetOf(root, to, signal)
    const boundary = await this.ctx.fs.resolve(root, { signal })
    if (!this.ctx.fs.contains(boundary, source) || !this.ctx.fs.contains(boundary, destination)) {
      throw new FsError(`a rename may not leave the canvas folder: ${from} -> ${to}`, 'FS_PERMISSION_DENIED')
    }
    if (this.policyFor(root)?.mode === 'read-only') {
      throw new FsError(`this deployment is read-only, so nothing under ${root} may be renamed`, 'FS_SANDBOX_DENIED')
    }

    const sourcePath = await this.processPathOf(source, signal)
    const destinationPath = await this.processPathOf(destination, signal)
    if (sourcePath === undefined || destinationPath === undefined) {
      // Another execution world, or a path the OS below would not be naming the
      // same file. Nothing is attempted: a wrong guess here renames somebody
      // else's file.
      throw new FsError(
        `the filesystem backend serves another execution world, so ${from} cannot be renamed from this process`,
        'FS_NOT_OBSERVED',
      )
    }

    try {
      await rename(sourcePath, destinationPath)
    } catch (error) {
      throw new FsError(`rename failed: ${from} -> ${to}`, renameErrorCodeOf(error), { cause: error })
    }
  }

  /**
   * The OS path of a target, but only when this process provably names the same
   * file with it (see {@link renameEntry}).
   */
  private async processPathOf(target: FsTarget, signal?: AbortSignal): Promise<string | undefined> {
    const path = this.ctx.fs.processPath(target)
    const mapped = this.ctx.fs.processPathFromHostPath(path)
    if (mapped === undefined) return undefined
    try {
      const back = await this.ctx.fs.resolve(mapped, { signal })
      return back.targetKey === target.targetKey ? path : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Write a card's artifact (F8.1).
   *
   * The seam's guard is passed straight through: `expected` carries the version
   * the caller last observed, so an Agent write and a concurrent user edit
   * cannot silently overwrite each other (§4.9). Passing `undefined` is an
   * unconditional write, which is what creating a brand-new card does.
   */
  async write(
    root: string,
    cardId: CardId,
    content: string,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
  ): Promise<{ operation: 'create' | 'update'; version: string; before: string | null }> {
    const target = await this.targetOf(root, cardId, signal)
    // 产物按类型分目录（F1.13）之后，第一个写常常落在一个还不存在的目录里：缝只负责
    // 「发布到 target」，父目录不在就是 ENOENT。建目录归这一层，理由见 ensureFolder。
    await this.ensureFolder(root, dirnameOf(cardId), signal)
    // The seam's guard is an *intent*, not a bare version: `replaceIfVersion`
    // is exactly the "I saw this content, fail if it moved" case the card
    // write path needs, and it is the only arm that both rejects absence and
    // detects a lost race (FS_STALE_VERSION).
    const intent: FsWriteIntent | undefined =
      expected === undefined ? undefined : { kind: 'replaceIfVersion', version: expected.version }
    const outcome = await this.ctx.fs.writeText(target, content, intent, signal, this.policyFor(root))
    return {
      operation: outcome.operation,
      version: String(outcome.version),
      before: outcome.before,
    }
  }

  /**
   * 把一段**二进制**落成卡片的产物（F2.7「导入」，v1.81）。
   *
   * **为什么不能走 `write`。** 缝的写入口是 `writeText`——它把内容当 UTF-8 文本发布。
   * 一张 PNG 或一段 MP4 从那儿过去**不会报错**，只会写出一个打不开的文件（媒体生成
   * 那条路早就是同一个结论，见 `host/media-provider.ts` 的开头）。
   *
   * **为什么仍然要有这个方法，而不是让每个调用方自己 `writeFile`。** 绕过缝就绕过了它的
   * 两件事：包含性（只能写在这个画布文件夹里）与只读策略。`renameEntry` 已经把这份代价
   * 付过一次，这里照抄它那两道守卫，再补一条前提：
   *
   * 1. **必须在画布文件夹里**——判据是缝自己的 `contains`，不是字符串前缀；
   * 2. **部署得允许写**——`read-only` 的组合连一个字节都不落。
   *
   * 返回值是写成功的**字节数**：调用方（导入）拿它去决定卡片要不要报「产物过大」。
   */
  async writeBytes(root: string, file: string, bytes: Uint8Array, signal?: AbortSignal): Promise<number> {
    const target = await this.targetOf(root, file, signal)
    const boundary = await this.ctx.fs.resolve(root, { signal })
    if (!this.ctx.fs.contains(boundary, target)) {
      throw new FsError(`an import may not leave the canvas folder: ${file}`, 'FS_PERMISSION_DENIED')
    }
    if (this.policyFor(root)?.mode === 'read-only') {
      throw new FsError(`this deployment is read-only, so ${file} cannot be written`, 'FS_SANDBOX_DENIED')
    }
    const path = await this.processPathOf(target, signal)
    if (path === undefined) {
      // 另一个执行世界（远端、容器）：本进程手里的路径并不指向这个目标，写下去就是写到
      // 别处。宁可报一句「写不了」，也不猜。
      throw new FsError(
        `the filesystem backend serves another execution world, so ${file} cannot be written from this process`,
        'FS_NOT_OBSERVED',
      )
    }
    try {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, bytes)
    } catch (error) {
      throw new FsError(`writing ${file} failed`, writeErrorCodeOf(error), { cause: error })
    }
    return bytes.byteLength
  }

  /**
   * List the directory entries the folder picker shows (design screen 02).
   *
   * Direct children only, and each one is marked selectable when it is a
   * directory. A directory the deployment cannot list yields an empty list
   * rather than throwing: the picker is a navigation surface, not a probe.
   */
  async listFolders(path: string, signal?: AbortSignal): Promise<FolderEntry[]> {
    let target: FsTarget
    try {
      target = await this.ctx.fs.resolve(path, { signal })
    } catch {
      return []
    }
    let children: Awaited<ReturnType<typeof this.ctx.fs.listDir>>
    try {
      children = await this.ctx.fs.listDir(target, signal)
    } catch {
      return []
    }
    return children
      .filter((child) => child.type === 'directory')
      .map((child) => ({
        name: child.name,
        path: child.name,
        selectable: true,
        size: child.size ?? 0,
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Discover the artifacts of a project root, so a freshly bound project is not
   * an empty board (F1.3).
   *
   * One level deep, skipping dotfiles and dependency directories. Deeper trees
   * stay reachable through the tool layer; the board's first paint only needs a
   * representative set rather than every file under `node_modules` — so the
   * result is also capped: each discovered card costs the caller one facts read
   * per seating, and binding a broad root (a home directory) must not turn into
   * an unbounded crawl.
   */
  async scanProject(root: string, signal?: AbortSignal): Promise<CardId[]> {
    const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '.cache'])
    const found: CardId[] = []
    const rootTarget = await this.ctx.fs.resolve(root, { signal }).catch(() => undefined)
    if (rootTarget === undefined) return []
    let top: Awaited<ReturnType<typeof this.ctx.fs.listDir>>
    try {
      top = await this.ctx.fs.listDir(rootTarget, signal)
    } catch {
      return []
    }

    // 画布根 + 每个类型目录各扫一层：产物按类型分目录之后（F1.13），`docs/` 里的
    // 文件与根上的文件是同一种东西，只是多了一层壳。类型目录只认 registry 里那一份
    // 名单——自己拼 `images` 之类的字符串就会在改名时静默丢掉一整个目录的产物。
    const roots: { target: FsTarget; prefix: string }[] = [{ target: rootTarget, prefix: '' }]
    for (const child of top) {
      if (child.type === 'file' || !isArtifactFolder(child.name)) continue
      roots.push({ target: child.target, prefix: `${child.name}/` })
    }

    for (const { target, prefix } of roots) {
      let entries: Awaited<ReturnType<typeof this.ctx.fs.listDir>>
      try {
        entries = await this.ctx.fs.listDir(target, signal)
      } catch {
        continue
      }
      for (const child of entries) {
        if (child.name.startsWith('.') || ignored.has(child.name)) continue
        if (child.type === 'file') {
          found.push(`${prefix}${child.name}`)
          continue
        }
        let inner: Awaited<ReturnType<typeof this.ctx.fs.listDir>>
        try {
          inner = await this.ctx.fs.listDir(child.target, signal)
        } catch {
          continue
        }
        const entry = inner.find((item) => isEntryPage(item.name))
        if (entry !== undefined) {
          found.push(`${prefix}${child.name}/index.html`)
          continue
        }
        for (const grandchild of inner) {
          if (grandchild.type !== 'file' || grandchild.name.startsWith('.')) continue
          found.push(`${prefix}${child.name}/${grandchild.name}`)
        }
      }
    }
    return found.sort().slice(0, MAX_SCAN_CARDS)
  }

  /** Candidate project roots under the configured picker root. */
  async listProjectCandidates(pickerRoot: string, signal?: AbortSignal): Promise<ProjectCandidate[]> {
    const entries = await this.listFolders(pickerRoot, signal)
    return entries.map((entry) => ({ name: entry.name, root: `${pickerRoot.replace(/\/+$/, '')}/${entry.name}` }))
  }
}
