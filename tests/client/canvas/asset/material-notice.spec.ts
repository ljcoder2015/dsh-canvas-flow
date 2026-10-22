/**
 * What the board says after a file-reference handoff.
 *
 * A handoff is invisible on the card face, so the sentence is the only signal
 * the user gets — and the interesting case is the partial one: naming *some* of
 * the material must not read as naming all of it. The tone carries the same
 * judgement as the wording, so it is asserted next to it: a handoff that named
 * nothing must not be painted like one that named everything.
 */
import { describe, expect, it } from 'vitest'
import { referenceNotice } from '../../../../src/client/canvas/asset/material-notice.ts'
import type { NoticeTranslate } from '../../../../src/client/canvas/asset/notice.ts'
import type { ReferencedFiles } from '../../../../src/types.ts'

/** A translator that echoes key and args, so the assertions pin the call shape. */
const t: NoticeTranslate = ((key: string, args?: Record<string, unknown>) =>
  args === undefined
    ? key
    : `${key}(${Object.entries(args)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(',')})`) as unknown as NoticeTranslate

const file = { cardId: 'brief.md', path: 'brief.md', mention: '@brief.md', kind: 'markdown', kindLabel: 'Markdown', present: true, bytes: 512 }

const result = (over: Partial<ReferencedFiles> = {}): ReferencedFiles => ({
  cardId: 'deck.html',
  files: [file],
  skipped: [],
  ...over,
})

describe('referenceNotice', () => {
  it('reports how many files were handed over', () => {
    expect(referenceNotice(result(), t)).toEqual({ text: 'canvas.reference.files(count=1)', tone: 'ok' })
  })

  it('says a card with no sources has nothing to reference — a fact, not a failure', () => {
    expect(referenceNotice(result({ files: [] }), t)).toEqual({
      text: 'canvas.reference.filesEmpty',
      tone: 'info',
    })
  })

  it('adds the count that could not be named, and never reads as full success', () => {
    const partial = referenceNotice(result({ skipped: ['a"b.md', 'c"d.md'] }), t)
    expect(partial.text).toBe('canvas.reference.files(count=1) canvas.reference.skipped(count=2)')
    expect(partial.tone, '交出去的是半份，就不该涂成成功色').toBe('warn')
  })

  it('reports an all-skipped handoff as refused, not as "no sources"', () => {
    expect(referenceNotice(result({ files: [], skipped: ['a"b.md'] }), t)).toEqual({
      text: 'canvas.reference.filesNone canvas.reference.skipped(count=1)',
      tone: 'warn',
    })
  })
})
