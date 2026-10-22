/**
 * 媒体形态在类型表里的那几件事（F2.7）。
 *
 * 这里守的不只是「`.mp3` 认成音频」，而是三条**跨模块的**不变量——它们各自都曾经是
 * 「加了形态但漏了一处」的现场：
 *
 * 1. `detectKind` 能吐出来的每一种媒体扩展名，都要在 `MEDIA_MIME` 里有一行。少一行的
 *    后果不是报错，是那张卡的字节**不走二进制通道**：view 会去 readText，读崩之后落到
 *    「未知形态」那条兜底，于是图片变成了 `application/octet-stream`。画不出来，但不报错。
 * 2. `MEDIA_KINDS` 与 `MEDIA_EXTENSIONS` 说的必须是同一批形态。两张表一个在
 *    `core/artifact`、一个在 `core/media`，谁都 import 不到对方，所以只能靠判据钉住。
 * 3. 形态指针 `isMediaKind` 要跟着 `resolveKindId` 折算，与 `isHtmlKind` 那一族同一个
 *    规矩——老记录盖着旧章，读侧一律先折算。
 * 4. **按形态分叉的地方，要么走指针，要么三种写全**。这是上面那条规律**机械化**：加一种
 *    媒体形态时漏掉的那一处，总是长成「手写名单里只有一两种形态」的样子。加音频那一版就
 *    漏了三处（右栏认领、摘要读文本、板面对账），三处都不报错——它们只是**不出现**。
 *    判据直接扫 `src/`：任何一处 `kind === 'image'` 式的比较，要么走 `isMediaKind`，
 *    要么三种都写出来（`prompt.ts` 的提示词分叉与预览器注册就是后者，它们**该**分明说）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_KINDS,
  MEDIA_KINDS,
  detectKind,
  isMediaKind,
  kindById,
  kindLabel,
  resolveKindId,
  type KindProbe,
} from '../../../src/core/artifact/kind/kind-registry.ts'
import { mediaMimeOf } from '../../../src/core/artifact/io/artifact-io.ts'
import { MEDIA_EXTENSIONS } from '../../../src/core/media/ark.ts'

/** 一份只有扩展名有意义的探测结果。 */
function probeOf(name: string): KindProbe {
  const extension = name.includes('.') ? (name.split('.').pop() as string).toLowerCase() : ''
  return { path: name, directory: false, basename: name.toLowerCase(), extension, head: '', children: [] }
}

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src')

/** `src/` 下每一个 .ts / .tsx。 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : []
  })
}

/**
 * 每一处「拿形态跟媒体名字比」的地方，连它比了哪几种形态。
 *
 * 两条边界，都是被误报教出来的：
 *
 * - **注释行不算**：注释里举例子（「原先写的是 image / video 两个名字」）是该留的记录，
 *   不是漏网。跳过整行注释，够这个仓库的写法用。
 * - **只认名叫 `kind` 的那一侧**。媒体形态的名字与别处撞车：卡面上 `face.element === 'audio'`
 *   说的是元素、引用里 `option.type === 'image'` 说的是参考物类型——它们本来就只有一个值，
 *   不是名单。抓的是「有一份名单、而且少写了一两种」这个形状；换个变量名绕过去是可能的，
 *   但那时读的人先会看不懂，所以这条判据管的是最常见的那个形状，不自称定理。
 */
function mediaComparisons(): { file: string; kinds: string[] }[] {
  const out: { file: string; kinds: string[] }[] = []
  for (const full of sourceFiles(SRC)) {
    const found = new Set<string>()
    for (const line of readFileSync(full, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue
      for (const match of line.matchAll(/\bkind\b\s*[!=]==\s*['"](image|video|audio)['"]/g)) {
        if (match[1] !== undefined) found.add(match[1])
      }
    }
    if (found.size > 0) out.push({ file: full.slice(SRC.length + 1), kinds: [...found].sort() })
  }
  return out
}

describe('the audio kind', () => {
  it('is in the type table, with a label a person reads', () => {
    expect(kindById('audio')?.label).toBe('音频')
    expect(kindLabel('audio')).toBe('音频')
    // 与另外两种媒体并列，不是它们的子类。
    expect(BUILTIN_KINDS.map((entry) => entry.id)).toContain('audio')
  })

  it('recognises every audio extension a project can plausibly hold', () => {
    for (const extension of ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma']) {
      expect(detectKind(probeOf(`voice.${extension}`))).toBe('audio')
    }
  })

  it('keeps the three media kinds apart from each other', () => {
    expect(detectKind(probeOf('hero.png'))).toBe('image')
    expect(detectKind(probeOf('hero.webp'))).toBe('image')
    expect(detectKind(probeOf('clip.mp4'))).toBe('video')
    expect(detectKind(probeOf('clip.mov'))).toBe('video')
    expect(detectKind(probeOf('voice.mp3'))).toBe('audio')
    // 不是媒体的，一个都不能被卷进来。
    expect(detectKind(probeOf('note.md'))).toBe('markdown')
    expect(detectKind(probeOf('page.html'))).toBe('app')
    expect(detectKind(probeOf('scene.design'))).toBe('design')
    expect(detectKind(probeOf('rows.csv'))).toBe('data')
  })
})

describe('the media pointer', () => {
  it('claims exactly the three media kinds', () => {
    expect([...MEDIA_KINDS]).toEqual(['image', 'video', 'audio'])
    for (const kind of MEDIA_KINDS) expect(isMediaKind(kind)).toBe(true)
    for (const kind of ['markdown', 'app', 'design', 'data', 'folder', 'file']) {
      expect(isMediaKind(kind)).toBe(false)
    }
  })

  it('folds legacy ids the way every other kind predicate does', () => {
    // 媒体形态目前没有归并史，但这条判据守的是**机制**：resolveKindId 是那条折算的唯一
    // 入口，将来真有归并时，isMediaKind 不会因为漏折算而在老卡上判错。
    expect(isMediaKind(resolveKindId('image'))).toBe(true)
    for (const kind of MEDIA_KINDS) expect(resolveKindId(kind)).toBe(kind)
  })
})

describe('the two media tables agree', () => {
  it('gives every media kind an extension', () => {
    // 点 2：MEDIA_KINDS（谁算媒体）与 MEDIA_EXTENSIONS（生成时落什么名）必须同键。
    expect(Object.keys(MEDIA_EXTENSIONS).sort()).toEqual([...MEDIA_KINDS].sort())
  })

  it('routes every extension detectKind can classify as media through the binary channel', () => {
    // 点 1：这条是真正的不变量 —— detectKind 认下来的每一个媒体扩展名，都得在
    // MEDIA_MIME 里有一行，否则那张卡的字节不走数据通道（画不出来，且不报错）。
    const extensions = [
      'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif',
      'mp4', 'mov', 'webm', 'm4v',
      'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma',
    ]
    for (const extension of extensions) {
      expect(detectKind(probeOf(`x.${extension}`))).toBeTruthy()
      expect(mediaMimeOf(extension), `MEDIA_MIME 缺少 ${extension}`).toBeDefined()
    }
  })

  it('gives MIME types that match the traffic they carry', () => {
    expect(mediaMimeOf('mp3')).toBe('audio/mpeg')
    expect(mediaMimeOf('wav')).toBe('audio/wav')
    expect(mediaMimeOf('flac')).toBe('audio/flac')
  })
})

describe('按形态分叉的地方（点 4：上面那条规律的机械化）', () => {
  it('要么走 isMediaKind，要么三种写全——只写一两种就是漏网', () => {
    const offenders = mediaComparisons()
      .filter((entry) => entry.kinds.length < MEDIA_KINDS.length)
      .map((entry) => `${entry.file} → 只比了 ${entry.kinds.join(' / ')}`)

    expect(offenders, '手写名单少一种形态：那处不会报错，它只是不出现（加音频那版漏了三处）').toEqual([])
  })

  it('这条规则不是空转：确实存在「三种写全」的那种写法', () => {
    // 提示词分叉（`host/prompt.ts`）与预览器注册（`viewers/media-viewer.tsx`）是该分明说的
    // 地方，三种都在场，于是它们不算漏网——这条断言保证上面那条不是因为「一处都没有」而绿。
    expect(mediaComparisons().some((entry) => entry.kinds.length === MEDIA_KINDS.length)).toBe(true)
  })
})
