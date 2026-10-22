/**
 * dsh-canvas — what the board says after handing material over (F5.3).
 *
 * A file-reference handoff is mostly silent by design: the names go into the
 * card's conversation and the model reads them if it wants. That silence is
 * exactly why the board owes the user a sentence — the user clicked something,
 * and "the model now knows those files exist" is not visible anywhere on the
 * board. So the answer is rendered here, from the same value the tool returned.
 *
 * Kept free of any import that touches host UI primitives: this runs in vitest
 * (node), and the translation function is injected rather than imported, so the
 * wording can be asserted without a browser.
 */
import type { ReferencedFiles } from '../../../types.ts'
import type { Notice, NoticeTranslate } from './notice.ts'

/**
 * Summarize one handoff: the sentence *and* the tone it is shown in.
 *
 * Four outcomes, and the last two are why this is not a one-liner: a card with
 * no sources at all (a plain fact — `info`, since nothing failed), a set of
 * names (`ok`), a partial set where some paths could not be written in the
 * `@file` grammar (`warn`), and a set where *every* path was refused (`warn`).
 * The partial and total cases never read as success, because a board that
 * silently hands over less material than it has is worse than one that says so.
 */
export function referenceNotice(result: ReferencedFiles, t: NoticeTranslate): Notice {
  if (result.files.length === 0 && result.skipped.length === 0) {
    return { text: t('canvas.reference.filesEmpty'), tone: 'info' }
  }
  const lines =
    result.files.length === 0
      ? [t('canvas.reference.filesNone')]
      : [t('canvas.reference.files', { count: result.files.length })]
  if (result.skipped.length > 0) lines.push(t('canvas.reference.skipped', { count: result.skipped.length }))
  return { text: lines.join(' '), tone: result.files.length === 0 || result.skipped.length > 0 ? 'warn' : 'ok' }
}
