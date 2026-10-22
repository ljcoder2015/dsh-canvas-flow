/**
 * dsh-canvas — 板面文件的读写（F1.9 / F1.10）。
 *
 * 格式与决策在 `core/canvas/board-file.ts`；这里只做两件事：把它接到
 * `ctx.fs` seam（于是沙箱策略、版本守卫与写前 waterfall 全都照旧生效），以及
 * 从存储域的表里把这份投影组装出来。
 *
 * **谁是真源**：存储域仍是这张画布在本机的真源——读盘、排序、命中测试都读它；
 * 板面文件是**随目录走的投影**。所以写入是尽力而为：写失败只记一行日志，绝不让
 * 一次拖拽因为目录只读而失败（那时板上该动的东西仍然动了，只是这份投影没跟上）。
 * 反过来的那一条更硬：**读不懂的文件绝不覆盖**——一个本构建不认识的文件可能是
 * 手改到一半，也可能是更新格式写的，被我们的旧投影盖掉就是数据丢失。
 */
import type { CanvasDomain } from '../../domain.ts'
import type { Project, ProjectId } from '../../types.ts'
import { cardIdOfKey } from '../../core/session/session-manager.ts'
import { fsErrorCodeOf, type ArtifactIo } from '../../core/artifact/io/artifact-io.ts'
import {
  BOARD_FILE,
  composeBoardFile,
  parseBoardFile,
  type BoardFileContent,
  type BoardFileRead,
} from '../../core/canvas/board/board-file.ts'

/** What one read of a folder's board file found. `absent` is the first bind. */
export type BoardFileOutcome = { kind: 'absent' } | BoardFileRead

/** What this class needs from the composition root. */
export interface BoardFileDeps {
  domain: CanvasDomain
  io: ArtifactIo
  /** One line about a projection that could not be read or written. */
  log: (message: string, error?: unknown) => void
}

/** Reads and writes `<root>/.dsh-canvas/board.json`. One instance per plugin. */
export class BoardFile {
  /**
   * The text last written per project, so an unchanged board costs no write.
   *
   * Compared rather than debounced: a drag that ends where it started, or an
   * arrange that decides nothing, then leaves the file's mtime — and a
   * watcher's or a git status's output — exactly as it was. In-memory only, and
   * that is fine: a cold process writes once and is level again.
   */
  private readonly written = new Map<ProjectId, string>()

  /**
   * Roots whose board file we cannot understand, so we do not overwrite it.
   *
   * Keyed by root rather than project id because the read that discovers the
   * problem happens *before* there is an id to key on — the id is read out of
   * the file. Cleared by a later read that succeeds, so fixing the file by hand
   * is enough to get the projection flowing again.
   */
  private readonly foreign = new Set<string>()

  constructor(private readonly deps: BoardFileDeps) {}

  /** Read one folder's board file. Never throws: an unreadable file is a quiet refusal. */
  async read(root: string, signal?: AbortSignal): Promise<BoardFileOutcome> {
    let text: string
    try {
      text = (await this.deps.io.readText(root, BOARD_FILE, signal)).text
    } catch (error) {
      if (fsErrorCodeOf(error) === 'FS_NOT_FOUND') {
        // The ordinary first bind of a folder the canvas has never seen.
        this.foreign.delete(root)
        return { kind: 'absent' }
      }
      // A file that is there but could not be read (binary, permissions): we
      // cannot say what it is, so we must not claim to know.
      this.foreign.add(root)
      this.deps.log(`画布目录里的板面文件读不出来，将不被覆盖：${root}`, error)
      return { kind: 'unreadable', reason: fsErrorCodeOf(error) ?? 'read failed' }
    }

    const outcome = parseBoardFile(text)
    if (outcome.kind === 'unreadable') {
      this.foreign.add(root)
      this.deps.log(`画布目录里的板面文件不认识，将不被覆盖：${root}（${outcome.reason}）`)
    } else {
      this.foreign.delete(root)
    }
    return outcome
  }

  /**
   * Write the board's projection, unless it is already exactly what is on disk.
   *
   * @returns whether a write actually happened.
   */
  async write(project: Project, signal?: AbortSignal): Promise<boolean> {
    if (this.foreign.has(project.root)) return false
    const text = composeBoardFile(this.compose(project))
    if (this.written.get(project.id) === text) return false
    try {
      await this.deps.io.write(project.root, BOARD_FILE, text, undefined, signal)
      this.written.set(project.id, text)
      return true
    } catch (error) {
      this.deps.log(`板面文件写不进去（${project.root}），本机存储域不受影响`, error)
      return false
    }
  }

  /** The board as the file wants it: identity, name and style, then seating and relations. */
  private compose(project: Project): BoardFileContent {
    const belongs = (record: { project: string }): boolean => record.project === project.id
    const cards = [...this.deps.domain.table('cards').entries()]
      .filter(([, record]) => belongs(record))
      .map(([key, record]) => {
        const id = cardIdOfKey(project.id, key)
        return {
          id,
          position: record.position,
          // Only when it differs from the id: a legacy record (path-shaped id,
          // no `file`) renders exactly as it did before the split.
          file: record.file !== undefined && record.file !== id ? record.file : undefined,
          // Only when the record carries one, i.e. when it is not simply what
          // the artifact's own path says (F1.12).
          name: record.name !== undefined && record.name !== '' ? record.name : undefined,
          // `undefined` rather than `false`, so a board with no empty seats
          // renders exactly as it did before this field existed.
          empty: record.seatedEmpty === true ? true : undefined,
          // 生成模型跟着作品走（F2.7）：它是这张作品怎么做出来的决定，不是本机环境。
          // `undefined` 就是「没选过」，编码时那一段会被整个省掉。
          mediaModel: record.mediaModel,
          // 宽高比同样跟着作品走（F3.11）：卡片多大是这张作品的样子，不是本机的观察结果。
          aspect: record.aspect,
        }
      })
    const sources = [...this.deps.domain.table('sources').entries()]
      .filter(([, record]) => belongs(record))
      .map(([, record]) => ({ downstream: record.downstream, upstream: record.upstream, origin: record.origin }))
    const notes = [...this.deps.domain.table('notes').entries()]
      .filter(([, record]) => belongs(record))
      .map(([id, record]) => ({
        id,
        text: record.text,
        author: record.author,
        position: record.position,
        createdAt: record.createdAt,
      }))
    return { id: project.id, name: project.name, style: project.style, cards, sources, notes }
  }
}
