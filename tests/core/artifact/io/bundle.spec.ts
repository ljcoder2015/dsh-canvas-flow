/**
 * 应用节点打包的判据（F10.1）。
 *
 * 三半，各自回答一个问题：
 *
 * 1. **哪些东西进包**（`core/artifact/bundle.ts`，纯）：依赖目录与工具垃圾不进包、预算之外
 *    的东西不进包、包叫什么、里面那层文件夹叫什么。这些规则决定了用户解压之后看到什么，
 *    而它们与文件系统无关，所以直接在容器外测。
 * 2. **装的是哪一项**（`bundleTarget`）：产物是那个文件还是它所在的文件夹。这一条曾错在
 *    「只看磁盘」，于是应用卡（`file` 是入口页 `应用1/index.html`）导出的包里只有
 *    `index.html`，样式与脚本一个都不在——见下面「装哪一项」那一节。
 * 3. **目录是怎么被读成清单的**（`ArtifactIo.bundle`）：递归、路径用 `/` 连、文本走文本、
 *    二进制走 base64、装不下的记在 `skipped` 里且 `truncated` 为真。先用一个内存里的目录
 *    树桩出 seam（判「哪些条目被收下了」），末尾再用**真磁盘**跑一遍同一件事——桩是
 *    `listDir` 的第二份实现，而第二份实现可能与代码一致、与磁盘不一致。
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ArtifactIo } from '../../../../src/core/artifact/io/artifact-io.ts'
import {
  BUNDLE_BYTES_LIMIT,
  BUNDLE_DEPTH_LIMIT,
  BUNDLE_ENTRY_BYTES_LIMIT,
  BUNDLE_FILE_LIMIT,
  bundleAdmits,
  bundleArchiveName,
  bundleEntryPath,
  bundlePrefix,
  bundleSkipped,
  bundleTarget,
} from '../../../../src/core/artifact/io/bundle.ts'
import { isBundleKind, kindById } from '../../../../src/core/artifact/kind/kind-registry.ts'

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('什么不进包', () => {
  it('依赖目录、版本库内部结构与画布自己的投影都不进去', () => {
    for (const name of ['node_modules', '.git', '.svn', '.hg', '.dsh-canvas', '.DS_Store']) {
      expect(bundleSkipped(name), name).toBe(true)
    }
  })

  it('应用的源码与会构建出来的东西都进去（带不带走由用户决定）', () => {
    for (const name of ['index.html', 'styles.css', 'app.js', 'assets', 'dist', 'build', '.gitignore']) {
      expect(bundleSkipped(name), name).toBe(false)
    }
  })
})

describe('预算', () => {
  const empty = { files: 0, bytes: 0 }

  it('装得下的就收（单个文件的线比总量的线更紧，所以先卡它）', () => {
    expect(bundleAdmits(1024, empty)).toBe(true)
    expect(bundleAdmits(BUNDLE_ENTRY_BYTES_LIMIT, empty)).toBe(true)
    // 一个文件不可能既装得进 4 MB 的单文件上限、又超过 8 MB 的总量——两条线不打架。
    expect(BUNDLE_ENTRY_BYTES_LIMIT).toBeLessThan(BUNDLE_BYTES_LIMIT)
  })

  it('单个文件超过上限就不收——一个 4 MB 的文件值得自己走一趟', () => {
    expect(bundleAdmits(BUNDLE_ENTRY_BYTES_LIMIT + 1, empty)).toBe(false)
  })

  it('总数满了就不收', () => {
    expect(bundleAdmits(1, { files: BUNDLE_FILE_LIMIT, bytes: 0 })).toBe(false)
  })

  it('总量到线就不收（刚好到线仍收）', () => {
    expect(bundleAdmits(1, { files: 0, bytes: BUNDLE_BYTES_LIMIT })).toBe(false)
    expect(bundleAdmits(0, { files: 0, bytes: BUNDLE_BYTES_LIMIT })).toBe(true)
  })
})

describe('包叫什么、里面那层叫什么', () => {
  it('包用卡片名，后缀是 .zip', () => {
    expect(bundleArchiveName('应用1')).toBe('应用1.zip')
    expect(bundleArchiveName('my app')).toBe('my-app.zip')
  })

  it('名字里一个能当文件名的字都没有时退回 app，而不是造出一个叫 .zip 的文件', () => {
    expect(bundleArchiveName('///')).toBe('app.zip')
    expect(bundleArchiveName('   ')).toBe('app.zip')
    expect(bundleArchiveName('')).toBe('app.zip')
  })

  it('目录形态包一层同名文件夹，单文件形态不套', () => {
    expect(bundlePrefix('应用1', true)).toBe('应用1/')
    expect(bundlePrefix('应用1', false)).toBe('')
    // 目录形态但名字已经什么都不剩（退不回一个安全的名字）：宁可不套，也不套出一个 `/` 前缀。
    expect(bundlePrefix('///', true)).toBe('')
  })

  it('条目路径是前缀加目录内相对路径', () => {
    expect(bundleEntryPath('应用1/', 'index.html')).toBe('应用1/index.html')
    expect(bundleEntryPath('应用1/', 'js/app.js')).toBe('应用1/js/app.js')
    expect(bundleEntryPath('', 'deck.html')).toBe('deck.html')
  })
})

describe('装哪一项：路径与磁盘一起看', () => {
  it('入口页意味着它所在的整个文件夹', () => {
    expect(bundleTarget('应用1/index.html', false)).toEqual({ path: '应用1', directory: true })
    expect(bundleTarget('深层/嵌套/应用/index.html', false)).toEqual({ path: '深层/嵌套/应用', directory: true })
  })

  it('磁盘上就是目录的产物（folder 形态）照样是整个目录', () => {
    // 这一条是上面那条的另一半证据：`folder` 的 `file` 直接是目录（`资料`），没有入口页
    // 这回事。只看路径的话它会被判成「单文件」，然后去读一个目录的字节——读不出来。
    expect(bundleTarget('资料', true)).toEqual({ path: '资料', directory: true })
  })

  it('其余形态就是那个文件自己', () => {
    expect(bundleTarget('decks/talk.html', false)).toEqual({ path: 'decks/talk.html', directory: false })
    expect(bundleTarget('brief.md', false)).toEqual({ path: 'brief.md', directory: false })
  })

  it('大小写不影响判据，改过后缀的也不算入口页', () => {
    expect(bundleTarget('应用1/INDEX.HTML', false).directory).toBe(true)
    expect(bundleTarget('应用1/index.html.bak', false).directory).toBe(false)
  })

  it('根上的入口页没有「同目录的散件」可言：那一层是全部卡片的公共场地', () => {
    expect(bundleTarget('index.html', false)).toEqual({ path: 'index.html', directory: false })
  })
})

// ── ArtifactIo.bundle：目录怎么被读成清单 ────────────────────────────────────

/** The two fields `ArtifactIo` reads off a resolved path. */
interface StubTarget {
  targetKey: string
  displayPath: string
}

/** A seam error in the vocabulary the IO layer branches on (`FS_*` codes). */
function seamError(code: string, message: string): Error {
  const error = new Error(message)
  Object.assign(error, { code })
  return error
}

/**
 * An `ArtifactIo` over an in-memory tree, keyed by project-relative path.
 *
 * Directories are implicit: a key `a/b.txt` makes `a` one. `listDir` answers in
 * the tree's own declaration order rather than sorted, so the archive's ordering
 * (which is what makes an export comparable run to run) is the host's doing and
 * not the stub's.
 */
function bundleHarness(files: Record<string, string | Uint8Array>) {
  const keys = Object.keys(files)
  const target = (key: string): StubTarget => ({ targetKey: key, displayPath: `/root/${key}` })
  const bytesOf = (key: string): Uint8Array => {
    const value = files[key]
    if (value === undefined) throw seamError('FS_NOT_FOUND', key)
    return typeof value === 'string' ? utf8(value) : value
  }
  const dirOf = (key: string): boolean => keys.some((candidate) => candidate.startsWith(`${key}/`))

  const ctx = {
    fs: {
      resolve: (path: string) => Promise.resolve(target(path)),
      stat: (resolved: StubTarget) => {
        const key = resolved.targetKey
        if (files[key] !== undefined) {
          return Promise.resolve({ type: 'file' as const, size: bytesOf(key).byteLength, version: 'v1' })
        }
        return Promise.resolve(dirOf(key) ? { type: 'directory' as const, size: 0, version: 'v1' } : undefined)
      },
      processPath: (resolved: StubTarget) => resolved.displayPath,
      listDir: (resolved: StubTarget) => {
        const dir = resolved.targetKey
        const seen = new Set<string>()
        const entries: { name: string; type: 'file' | 'directory'; target: StubTarget; size: number }[] = []
        for (const key of keys) {
          if (!key.startsWith(`${dir}/`)) continue
          const rest = key.slice(dir.length + 1)
          const name = rest.split('/')[0] ?? ''
          if (name === '' || seen.has(name)) continue
          seen.add(name)
          const childKey = `${dir}/${name}`
          const isFile = rest === name
          entries.push({
            name,
            type: isFile ? 'file' : 'directory',
            target: target(childKey),
            size: isFile ? bytesOf(childKey).byteLength : 0,
          })
        }
        return Promise.resolve(entries)
      },
      readText: (resolved: StubTarget) => {
        const bytes = bytesOf(resolved.targetKey)
        try {
          return Promise.resolve(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        } catch {
          // The seam refuses to decode a binary file rather than guessing.
          return Promise.reject(seamError('FS_NOT_TEXT', resolved.targetKey))
        }
      },
      readBytes: (resolved: StubTarget, _signal: unknown, maxBytes: number) => {
        const bytes = bytesOf(resolved.targetKey)
        if (bytes.byteLength > maxBytes) {
          return Promise.reject(seamError('FS_TOO_LARGE', resolved.targetKey))
        }
        return Promise.resolve(bytes)
      },
    },
    get: () => undefined,
  } as unknown as Context

  return new ArtifactIo(ctx)
}

describe('类型表与「导出＝打包」这条线对得上', () => {
  it('应用节点既在打包形态里，也把 zip 列在自己的导出格式里', () => {
    // 两处必须同时成立：`isBundleKind` 决定客户端走本地打包，`exportFormats` 决定部署那条
    // 线上这个格式认不认。两边说的不是同一件事的话，就会出现「按钮在、点了没反应」
    // ——正是 v1.58 要修掉的那个症状。（按钮出不出，v1.59 起由 `export-plan.ts` 一处说了算。）
    expect(isBundleKind('app')).toBe(true)
    expect(kindById('app')?.exportFormats).toContain('zip')
  })

  it('文本节点不走这条路：它有自己的四种格式菜单', () => {
    for (const kind of ['markdown', 'file', 'image', 'design', 'video', 'folder']) {
      expect(isBundleKind(kind), kind).toBe(false)
    }
  })
})

describe('读一个应用目录', () => {
  const APP = {
    '应用1/dsh.webapp.json': '{"name":"应用1"}',
    '应用1/index.html': '<!doctype html>',
    '应用1/js/app.js': 'console.log(1)',
    '应用1/node_modules/left-pad/index.js': 'module.exports = 1',
    '应用1/.git/config': '[core]',
    '应用1/logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01]),
  }

  it('递归读全，路径用 / 连，依赖目录与版本库不进清单', async () => {
    const view = await bundleHarness(APP).bundle('/root', '应用1')

    expect(view.kind).toBe('app')
    expect(view.directory).toBe(true)
    expect(view.present).toBe(true)
    expect(view.truncated).toBe(false)
    expect(view.skipped).toEqual([])
    expect(view.files.map((file) => file.path)).toEqual([
      'dsh.webapp.json',
      'index.html',
      'js/app.js',
      'logo.png',
    ])
  })

  it('文本走文本、二进制走 base64，字节一个不改', async () => {
    const view = await bundleHarness(APP).bundle('/root', '应用1')

    const html = view.files.find((file) => file.path === 'index.html')
    expect(html?.text).toBe('<!doctype html>')
    expect(html?.base64).toBe('')

    const png = view.files.find((file) => file.path === 'logo.png')
    expect(png?.text).toBe('')
    expect(png?.base64).toBe(Buffer.from(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01])).toString('base64'))
    expect(png?.bytes).toBe(8)
  })

  it('装不下的记在 skipped 里，并把 truncated 立起来——绝不悄悄少装', async () => {
    const view = await bundleHarness({
      '应用1/index.html': '<!doctype html>',
      '应用1/huge.bin': new Uint8Array(BUNDLE_ENTRY_BYTES_LIMIT + 1),
    }).bundle('/root', '应用1')

    expect(view.files.map((file) => file.path)).toEqual(['index.html'])
    expect(view.skipped).toEqual(['huge.bin'])
    expect(view.truncated).toBe(true)
  })

  it('清单按名字排序，于是同一份目录永远读到同一份清单', async () => {
    const view = await bundleHarness({
      '应用1/zebra.js': 'z',
      '应用1/alpha.js': 'a',
      '应用1/middle.js': 'm',
      '应用1/sub/b.js': 'b',
      '应用1/sub/a.js': 'a',
    }).bundle('/root', '应用1')

    expect(view.files.map((file) => file.path)).toEqual([
      'alpha.js',
      'middle.js',
      'sub/a.js',
      'sub/b.js',
      'zebra.js',
    ])
  })

  it('单文件形态的包就是它自己，用它在目录里的名字', async () => {
    const view = await bundleHarness({ 'decks/talk.html': '<!doctype html>' }).bundle('/root', 'decks/talk.html')

    expect(view.directory).toBe(false)
    expect(view.files.map((file) => file.path)).toEqual(['talk.html'])
    expect(view.files[0]?.text).toBe('<!doctype html>')
  })

  it('卡片记的是入口页时，装的是它所在的整个目录', async () => {
    // **这一条按真机的调用形态来调**：宿主把卡片的 `file`（`应用1/index.html`）交给
    // `bundle`，而它就是入口页——磁盘上问「这是文件还是目录」，答案永远是「文件」。
    // 此前正是照着这个答案打包，于是包里有 `index.html`，样式与脚本一个都不在：一个
    // 解得开、打得开、但一打开就没有样式也没有交互的包，而按钮说「已导出」。
    // 上面每一条判据都用目录路径调用，所以谁也抓不住它。
    const view = await bundleHarness({
      '应用1/index.html': '<!doctype html><link rel="stylesheet" href="styles.css">',
      '应用1/styles.css': 'h1 { color: red; }',
      '应用1/app.js': 'console.log(1)',
    }).bundle('/root', '应用1/index.html')

    expect(view.present).toBe(true)
    expect(view.directory).toBe(true)
    expect(view.files.map((file) => file.path)).toEqual(['app.js', 'index.html', 'styles.css'])
  })

  it('入口页落在画布根上时只带它自己：同目录是全部卡片的公共场地', async () => {
    // 根上那个 `index.html` 的同级文件是**别的卡片**（`brief.md`、`设计.design`），
    // 不是这一份产物的配套资源。把整个画布打包给一张卡显然是错的——与 `planRename`
    // 把根上入口页判成 `root-entry`、`cardNameOf` 说它「没有文件夹可以借名字」同源。
    const view = await bundleHarness({
      'index.html': '<!doctype html>',
      'brief.md': '# 另一张卡片',
      '设计.design': '{}',
    }).bundle('/root', 'index.html')

    expect(view.directory).toBe(false)
    expect(view.files.map((file) => file.path)).toEqual(['index.html'])
  })

  it('产物不在磁盘上时如实回答「不在」，而不是报错', async () => {
    const view = await bundleHarness({}).bundle('/root', '应用1/index.html')

    expect(view.present).toBe(false)
    expect(view.files).toEqual([])
  })

  it('递归有深度上限：病态深的名字不会把 zip 的条目路径撑爆', async () => {
    const deep: Record<string, string> = {}
    let path = '应用1'
    for (let level = 0; level <= BUNDLE_DEPTH_LIMIT; level += 1) {
      path = `${path}/d${String(level)}`
      deep[`${path}/file.txt`] = 'x'
    }
    const view = await bundleHarness(deep).bundle('/root', '应用1')

    // 到上限那一层就不再往下走，所以最后一层的文件没有进清单。
    expect(view.files.some((file) => file.path.endsWith(`${'d' + String(BUNDLE_DEPTH_LIMIT)}/file.txt`))).toBe(false)
    expect(view.files.length).toBeGreaterThan(0)
  })
})

// ── 真磁盘：桩与真 fs 会不会给出不同答案 ────────────────────────────────────

/**
 * An `ArtifactIo` over a real temp directory, with a seam shaped like the local
 * backend: absolute paths in and out, `listDir` entries carrying their own
 * targets.
 *
 * Nothing here has an opinion — every answer comes from `node:fs`. The point is
 * not to re-test the decisions the in-memory harness already covers, but to
 * catch the class of mistake this file *just had*: a stub is a second
 * implementation of `listDir`, and a second implementation can agree with the
 * code while the disk says something else.
 */
function diskHarness(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-canvas-bundle-'))
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  const target = (key: string): StubTarget => ({ targetKey: key, displayPath: key })
  const entryOf = (parent: string, entry: { name: string; isDirectory: () => boolean }) => {
    const child = join(parent, entry.name)
    return {
      name: entry.name,
      type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
      target: target(child),
      size: entry.isDirectory() ? 0 : statSync(child).size,
    }
  }

  const ctx = {
    fs: {
      resolve: (path: string, opts?: { cwd?: string }) => Promise.resolve(target(join(opts?.cwd ?? root, path))),
      stat: (resolved: StubTarget) => {
        try {
          const info = statSync(resolved.targetKey)
          return Promise.resolve(
            info.isDirectory()
              ? { type: 'directory' as const, size: 0, version: 'v1' }
              : { type: 'file' as const, size: info.size, version: 'v1' },
          )
        } catch {
          return Promise.resolve(undefined)
        }
      },
      listDir: (resolved: StubTarget) =>
        Promise.resolve(readdirSync(resolved.targetKey, { withFileTypes: true }).map((entry) => entryOf(resolved.targetKey, entry))),
      readText: (resolved: StubTarget) => Promise.resolve(readFileSync(resolved.targetKey, 'utf8')),
      readBytes: (resolved: StubTarget, _signal: unknown, maxBytes: number) => {
        const bytes = readFileSync(resolved.targetKey)
        if (bytes.byteLength > maxBytes) return Promise.reject(seamError('FS_TOO_LARGE', resolved.targetKey))
        return Promise.resolve(new Uint8Array(bytes))
      },
    },
    get: () => undefined,
  } as unknown as Context

  return { io: new ArtifactIo(ctx), root, clean: () => rmSync(root, { recursive: true, force: true }) }
}

describe('真磁盘上的一个应用目录', () => {
  it('按真机的调用形态（卡片的 file 是入口页）读出整份产物', async () => {
    // 这一条与上面那条桩判据问的是同一件事，区别只在答案从哪来：这里没有桩，
    // `stat`/`listDir`/`readBytes` 全是 `node:fs`。用户报的就是这个场景——包里
    // 只有 `index.html`，`styles.css` 与 `app.js` 不见踪影。
    const h = diskHarness({
      '应用/index.html': '<!doctype html><link rel="stylesheet" href="styles.css"><script src="app.js"></script>',
      '应用/styles.css': 'h1 { color: red; }',
      '应用/app.js': 'console.log(1)',
      '应用/dsh.webapp.json': '{"name":"应用"}',
    })

    const view = await h.io.bundle(h.root, '应用/index.html')

    expect(view.directory).toBe(true)
    expect(view.truncated).toBe(false)
    expect(view.files.map((file) => file.path)).toEqual(['app.js', 'dsh.webapp.json', 'index.html', 'styles.css'])
    h.clean()
  })

  it('产物还没落盘时如实回答「不在」，而不是把目录当成产物', async () => {
    const h = diskHarness({})

    const view = await h.io.bundle(h.root, '应用/index.html')

    expect(view.present).toBe(false)
    expect(view.files).toEqual([])
    h.clean()
  })
})
