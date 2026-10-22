/**
 * dsh-canvas — the rule that keeps a bulk cleanup off cards that are not ghosts
 * (F1.11).
 *
 * The subject is small and the stakes are not: this decision is the difference
 * between clearing a board of stale seats and emptying a board. Each case below
 * is one of the three situations a dimmed card can be in, and the point of the
 * table is that only one of them may be swept.
 */
import { describe, expect, it } from 'vitest'
import { planCleanup, type CleanupCandidate } from '../../../../src/core/canvas/project/cleanup.ts'
import { missingOf } from '../../../../src/core/artifact/io/artifact-io.ts'

/** One candidate, with the two defaults that keep each case to one line. */
function card(id: string, patch: Partial<Omit<CleanupCandidate, 'id'>> = {}): CleanupCandidate {
  return { id, presence: 'present', empty: false, ...patch }
}

describe('planCleanup', () => {
  it('unseats a card whose artifact the seam reports gone', () => {
    expect(planCleanup([card('gone.md', { presence: 'absent' })]).remove).toEqual(['gone.md'])
  })

  it('keeps a card whose artifact is there', () => {
    expect(planCleanup([card('brief.md')]).remove).toEqual([])
  })

  it('keeps an empty seat even though no file is there', () => {
    // The case this module exists for: a seat is allowed to precede its
    // artifact, and removing it would take a conversation and its edges along.
    const plan = planCleanup([card('untitled.md', { presence: 'absent', empty: true })])
    expect(plan.remove).toEqual([])
    expect(plan.unknown).toEqual([])
  })

  it('keeps a card no probe could judge, and says so', () => {
    const plan = planCleanup([card('mystery.md', { presence: 'unknown' })])
    expect(plan.remove).toEqual([])
    expect(plan.unknown).toEqual(['mystery.md'])
  })

  it('never lets a failed probe pass for absence, even on an ordinary card', () => {
    // The dangerous reading of a `stat` the sandbox refused is "the file is
    // gone"; the safe one is "nobody knows".
    const plan = planCleanup([card('a.md', { presence: 'unknown' }), card('b.md', { presence: 'absent' })])
    expect(plan.remove).toEqual(['b.md'])
    expect(plan.unknown).toEqual(['a.md'])
  })

  it('sorts one mixed board into exactly two piles, and loses nobody', () => {
    const cards = [
      card('brief.md'),
      card('gone.md', { presence: 'absent' }),
      card('untitled.md', { presence: 'absent', empty: true }),
      card('mystery.md', { presence: 'unknown' }),
      card('also-gone.md', { presence: 'absent' }),
    ]
    const plan = planCleanup(cards)
    expect(plan.remove).toEqual(['gone.md', 'also-gone.md'])
    expect(plan.unknown).toEqual(['mystery.md'])
    // Everything else was kept: kept cards are simply absent from both lists.
    expect(plan.remove.length + plan.unknown.length).toBeLessThan(cards.length)
  })

  it('keeps the board order it was given', () => {
    const plan = planCleanup([
      card('z.md', { presence: 'absent' }),
      card('a.md', { presence: 'absent' }),
    ])
    expect(plan.remove).toEqual(['z.md', 'a.md'])
  })

  it('decides nothing for an empty board', () => {
    expect(planCleanup([])).toEqual({ remove: [], unknown: [] })
  })
})

describe('missingOf', () => {
  it('calls only a proven absence missing', () => {
    expect(missingOf('absent', false)).toBe(true)
    expect(missingOf('absent', undefined)).toBe(true)
    expect(missingOf('present', false)).toBe(false)
    expect(missingOf('unknown', false)).toBe(false)
  })

  it('never calls an empty seat missing, whatever the probe says', () => {
    expect(missingOf('absent', true)).toBe(false)
  })
})
