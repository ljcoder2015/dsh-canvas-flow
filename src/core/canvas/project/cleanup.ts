/**
 * dsh-canvas — which cards a bulk cleanup may take off the board (F1.11).
 *
 * The one thing this module exists to prevent is a bulk operation guessing.
 * `canvas_read_board` shows a card as dimmed whenever the artifact probe does
 * not see a file, and that single fact covers three different situations:
 *
 * - **the file was there and is not any more** — a rename, a delete, a branch
 *   switch. The card is a ghost: its file is gone for good, and clearing it off
 *   the board is the chore this feature exists to shorten.
 * - **the seat exists and its artifact was never written** — a dock spec seats
 *   the card and seeds the file a moment later, a bitmap card stays empty until
 *   a generation run fills it, an Agent may seat a card for what it is about to
 *   write. A seat without an artifact is an *honest* board state (F3.5), not a
 *   missing file, and removing it would throw away the card's conversation
 *   binding and its edges along with it.
 * - **the probe could not answer** — a card id the seam refuses to resolve, a
 *   `stat` the sandbox or the permissions denied. Nothing is known here, so
 *   nothing may be done.
 *
 * Only the first may be swept. The decision is pure — the caller gathers the
 * facts off the disk and the card records and hands them over as plain data —
 * so the rule can be pinned by a test instead of being trusted.
 *
 * Contrast with `removeCard`: taking *one* named card off the board is the
 * user's explicit move and may remove any card, empty seat included.
 */
import type { CardId } from '../../../types.ts'
import { missingOf, type Presence } from '../../artifact/io/artifact-io.ts'

/** One card as cleanup sees it: identity, what the probe could say, and whether the seat was born empty. */
export interface CleanupCandidate {
  id: CardId
  presence: Presence
  /** The card record says it was seated without an artifact and has not been seen with one since. */
  empty: boolean
}

/** What one pass over the board decided. */
export interface CleanupPlan {
  /** Cards proven gone — the only ones a bulk cleanup may unseat. */
  remove: CardId[]
  /**
   * Cards the seam could not judge, left exactly where they are.
   *
   * Reported rather than silently dropped, because a board that keeps showing a
   * card the user just asked to clear is a conversation: "the count said three
   * and two went away" is only honest if somebody can say why.
   */
  unknown: CardId[]
}

/**
 * Split the board into "provably gone" and "leave alone" (F1.11).
 *
 * @param cards - every card of one project, in board order.
 * @returns the ids to unseat, plus the ids no probe could judge.
 */
export function planCleanup(cards: readonly CleanupCandidate[]): CleanupPlan {
  const remove: CardId[] = []
  const unknown: CardId[] = []
  for (const card of cards) {
    if (card.presence === 'unknown') {
      unknown.push(card.id)
      continue
    }
    if (missingOf(card.presence, card.empty)) remove.push(card.id)
  }
  return { remove, unknown }
}
