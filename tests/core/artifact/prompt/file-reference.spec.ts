/**
 * The `@file` grammar this plugin reproduces, and the names it builds from it.
 *
 * These assertions are the contract with the harness, not with this
 * implementation: each one is a property the host's own formatter has (see
 * `packages/context/file-reference`), so a change that breaks the host's UI
 * would break this test too. `tests/file-reference.spec.ts` and the agreement
 * script in `.workbuddy/verify/` are the two halves of that guard — one pins the
 * rules, the other proves the bytes match.
 */
import { describe, expect, it } from 'vitest'
import {
  formatFileMention,
  nameFileReferences,
  nameWithoutProbe,
  renderFileReferences,
  type FileReferenceTarget,
} from '../../../../src/core/artifact/prompt/file-reference.ts'

describe('formatFileMention', () => {
  it('writes a plain path as a bare token', () => {
    expect(formatFileMention({ path: 'brief.md', kind: 'file' })).toBe('@brief.md')
    expect(formatFileMention({ path: 'notes/plan.md', kind: 'file' })).toBe('@notes/plan.md')
  })

  it('quotes a path that contains whitespace', () => {
    expect(formatFileMention({ path: 'my brief.md', kind: 'file' })).toBe('@"my brief.md"')
    expect(formatFileMention({ path: 'a b/c d.md', kind: 'file' })).toBe('@"a b/c d.md"')
  })

  it('gives a directory a trailing slash, and leaves the quote open with it', () => {
    expect(formatFileMention({ path: 'site', kind: 'directory' })).toBe('@site/')
    // The open quote is the host's completion convention: a closed one would end
    // the token, and the UI could not descend into the directory.
    expect(formatFileMention({ path: 'my site', kind: 'directory' })).toBe('@"my site/')
  })

  it('keeps an explicitly opened quote when asked', () => {
    expect(formatFileMention({ path: 'brief.md', kind: 'file' }, true)).toBe('@"brief.md"')
    expect(formatFileMention({ path: 'site', kind: 'directory' }, true)).toBe('@"site/')
  })

  it('refuses a path the grammar cannot denote', () => {
    expect(formatFileMention({ path: 'say "hi".md', kind: 'file' })).toBeUndefined()
    expect(formatFileMention({ path: 'tab\there.md', kind: 'file' })).toBeUndefined()
    expect(formatFileMention({ path: 'null\u0000.md', kind: 'file' })).toBeUndefined()
    // The check runs on the *whole* path, directory suffix included.
    expect(formatFileMention({ path: 'bad\u009fname', kind: 'directory' })).toBeUndefined()
  })
})

describe('nameWithoutProbe', () => {
  it('names a site card as the file it actually is, not as the directory its kind implies', () => {
    // `site` / `webapp` are directory kinds while the card sits on its entry
    // file; a slash here would name a path that does not exist.
    expect(nameWithoutProbe('site/index.html')).toBe('@site/index.html')
    expect(nameWithoutProbe('my app/index.html')).toBe('@"my app/index.html"')
  })

  it('keeps an unrepresentable path visible in backticks', () => {
    expect(nameWithoutProbe('a"b.md')).toBe('`a"b.md`')
  })
})

const target = (over: Partial<FileReferenceTarget> = {}): FileReferenceTarget => ({  cardId: 'brief.md',
  path: 'brief.md',
  directory: false,
  kind: 'markdown',
  kindLabel: 'Markdown',
  present: true,
  bytes: 512,
  ...over,
})

describe('nameFileReferences', () => {
  it('keeps the caller order and reports the names', () => {
    const named = nameFileReferences([
      target(),
      target({ cardId: 'chart.csv', path: 'chart.csv', kind: 'chart', kindLabel: '数据图表', bytes: 2048 }),
    ])
    expect(named.skipped).toEqual([])
    expect(named.references.map((entry) => entry.mention)).toEqual(['@brief.md', '@chart.csv'])
    expect(named.references[1]?.bytes).toBe(2048)
  })

  it('names a directory with its trailing slash', () => {
    const named = nameFileReferences([target({ cardId: 'site', path: 'site', directory: true, kind: 'app', kindLabel: '应用' })])
    expect(named.references[0]?.mention).toBe('@site/')
  })

  it('collapses a path named twice to its first appearance', () => {
    const named = nameFileReferences([target(), target({ bytes: 99 })])
    expect(named.references).toHaveLength(1)
    expect(named.references[0]?.bytes).toBe(512)
  })

  it('reports what the grammar cannot carry instead of dropping it quietly', () => {
    const named = nameFileReferences([target({ cardId: 'a"b.md', path: 'a"b.md' }), target()])
    expect(named.skipped).toEqual(['a"b.md'])
    expect(named.references.map((entry) => entry.cardId)).toEqual(['brief.md'])
  })
})

describe('renderFileReferences', () => {
  it('says who named the files, and what each one is', () => {
    const named = nameFileReferences([target(), target({ cardId: 'hero.png', path: 'hero.png', kind: 'image', kindLabel: '图片', bytes: 2_621_440 })])
    const text = renderFileReferences(named.references, named.skipped)
    expect(text).toContain('### Upstream material (file references)')
    expect(text).toContain('read one with the ordinary file tools when you need it')
    expect(text).toContain('- @brief.md — Markdown, 512 B')
    expect(text).toContain('- @hero.png — 图片, 2.5 MB')
    expect(text).not.toContain('Could not be named')
  })

  it('marks an artifact that has not been written yet', () => {
    const text = renderFileReferences(nameFileReferences([target({ present: false, bytes: 0 })]).references, [])
    expect(text).toContain('- @brief.md — Markdown, not written yet')
  })

  it('states what could not be named', () => {
    const named = nameFileReferences([target({ cardId: 'a"b.md', path: 'a"b.md' })])
    const text = renderFileReferences(named.references, named.skipped)
    expect(text).toContain('Could not be named as a file reference')
    expect(text).toContain('`a"b.md`')
  })

  it('still renders when every path was refused, rather than saying nothing', () => {
    const named = nameFileReferences([target({ cardId: 'a"b.md', path: 'a"b.md' })])
    expect(named.references).toEqual([])
    expect(renderFileReferences(named.references, named.skipped)).not.toBe('')
  })

  it('renders nothing when there is nothing to name', () => {
    expect(renderFileReferences([], [])).toBe('')
  })
})
