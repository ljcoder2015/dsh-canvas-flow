/**
 * dsh-canvas — the harness's `@file` mention grammar, at the half a board needs
 * (F5.3).
 *
 * A source edge (引用) says "this artifact builds on that artifact", and the harness
 * already owns the vocabulary for naming an artifact inside a prompt: an `@`
 * token whose payload is a workspace-relative path, with `@"..."` quoting when
 * the path contains whitespace. Card sessions carry that convention today —
 * `@deepseek-ai/dsh-file-reference-local` installs its guidance whenever the
 * agent has a `read` tool, which every card session does — so a board that
 * names upstream artifacts in exactly this form needs no new vocabulary, and
 * the model resolves the name with the tool it was already going to use.
 *
 * What this module deliberately does **not** do is carry content. A reference
 * is a pointer: the upstream artifact stays the single file it already is, so
 * it cannot go stale, and nothing enters the conversation until the model
 * decides the material matters and calls `read`. The digest channel is the
 * other half of that trade and lives where it belongs (`ArtifactIo.summarize`).
 *
 * Two properties are copies, not paraphrases:
 *
 * - **Byte-exact output.** `formatFileMention` reproduces the harness's
 *   implementation character for character — the trailing slash a directory
 *   keeps, the quote that stays *open* after that slash (so the host UI can
 *   descend another level), the rejection of paths the grammar cannot carry.
 *   A mention this module mints is one the host's own UI could have minted.
 * - **No dependency on the harness package.** The plugin ships one bundle for
 *   the browser and must load on deployments that never composed the
 *   file-reference packages at all, so the grammar is reproduced here rather
 *   than imported, and it is unit-testable with no container.
 *
 * The completion half of the grammar (`activeAtToken`, which finds the token
 * under a caret) is intentionally absent: a board never autocompletes a path,
 * it formats one.
 */

/** Whether a selected path names a file or a directory. */
export type FileMentionKind = 'file' | 'directory'

/**
 * Whether a path holds something the token grammar cannot carry.
 *
 * The host refuses the same set with a character class; this scans code points
 * instead, which says the same thing without a control-character regex that the
 * repository's lint rules reject. The set is: C0 controls, DEL and the C1
 * block, and the double quote — the first three would corrupt the token, and
 * the quote is the delimiter a quoted form is built from. Exported because the
 * prompt-block scanner (`prompt-blocks.ts`) refuses the same set when it decides
 * whether a token may render as a file block.
 */
export function hasUnsafeCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || character === '"') return true
  }
  return false
}

/**
 * Format one path as the prompt token that references it.
 *
 * Mirrors the harness's formatter, including its refusal: a path carrying a
 * control character or a double quote cannot be written in this grammar without
 * becoming a different path, and `undefined` is the honest answer — the caller
 * must then either quote the file some other way or fall back to reading it.
 *
 * @param candidate - the workspace-relative path and whether it is a directory.
 * @param preserveQuote - keep a quote the caller opened, even if unnecessary.
 * @returns the mention, or `undefined` for a path the grammar cannot denote.
 */
export function formatFileMention(
  candidate: { path: string; kind: FileMentionKind },
  preserveQuote = false,
): string | undefined {
  const path = candidate.kind === 'directory' ? `${candidate.path}/` : candidate.path
  if (hasUnsafeCharacter(path)) return undefined
  const quoted = preserveQuote || /\s/u.test(path)
  if (!quoted) return `@${path}`
  // A quoted *directory* deliberately leaves the quote open: the host UI
  // continues completing inside it, and a closed quote would end the token.
  if (candidate.kind === 'directory') return `@"${path}`
  return `@"${path}"`
}

/**
 * The name for a path whose file-versus-directory nature has not been probed.
 *
 * A card sits on a *file* even when its kind is a directory kind — `site` and
 * `webapp` describe a directory of files, but the card is `site/index.html` —
 * so a name built without touching the filesystem must take the file form, or
 * it will put a trailing slash on a file path and name something that does not
 * exist. Only {@link nameFileReferences}, which is fed by a probe, may add the
 * slash. The fallback keeps a path the grammar cannot carry visible rather than
 * dropping it from the block.
 */
export function nameWithoutProbe(path: string): string {
  return formatFileMention({ path, kind: 'file' }) ?? `\`${path}\``
}

/** One artifact to name, as the board knows it. */
export interface FileReferenceTarget {
  /** Board identity, reported back verbatim. */
  cardId: string
  /** Workspace-relative path; normally the card id itself. */
  path: string
  /** Whether the path is a directory — it decides the mention's shape. */
  directory: boolean
  /** The canvas kind of the artifact, for the reader's benefit. */
  kind: string
  kindLabel: string
  present: boolean
  bytes: number
}

/** One artifact named successfully. */
export interface FileReference {
  cardId: string
  path: string
  /** The mention the model resolves. */
  mention: string
  kind: string
  kindLabel: string
  present: boolean
  bytes: number
}

/** The names a block of references is made of, and what could not be named. */
export interface FileReferenceNames {
  references: FileReference[]
  /** Card ids dropped because the grammar cannot denote their path. */
  skipped: string[]
}

/**
 * Name a set of artifacts, keeping order and reporting what could not be named.
 *
 * Order is the caller's (nearest upstream first), duplicates collapse to their
 * first appearance — naming the same file twice buys nothing and reads as two
 * materials — and a path the grammar cannot carry is *reported* rather than
 * dropped quietly, because a board that silently omits material is worse than
 * one that says it could not name it.
 */
export function nameFileReferences(targets: readonly FileReferenceTarget[]): FileReferenceNames {
  const references: FileReference[] = []
  const skipped: string[] = []
  const seen = new Set<string>()
  for (const target of targets) {
    if (seen.has(target.cardId)) continue
    seen.add(target.cardId)
    const mention = formatFileMention({
      path: target.path,
      kind: target.directory ? 'directory' : 'file',
    })
    if (mention === undefined) {
      skipped.push(target.cardId)
      continue
    }
    references.push({
      cardId: target.cardId,
      path: target.path,
      mention,
      kind: target.kind,
      kindLabel: target.kindLabel,
      present: target.present,
      bytes: target.bytes,
    })
  }
  return { references, skipped }
}

/** Render a byte count the way a person reads one. */
function sizeText(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Render the durable message that hands a card's conversation these names.
 *
 * The text says three things the model cannot infer from the tokens: who named
 * the files (the board, not the user), what each one is, and that reading is
 * its own decision — a reference is an offer, not material already in context.
 * Size is included for exactly that decision: a 2 MB page is a reason to read
 * selectively rather than to read.
 *
 * Empty only when there is *nothing at all to say*. A handoff whose every path
 * the grammar refused still renders: it names none of the material, and saying
 * so is strictly better than a message that never arrives and leaves the model
 * believing the card has no upstreams.
 */
export function renderFileReferences(references: readonly FileReference[], skipped: readonly string[]): string {
  if (references.length === 0 && skipped.length === 0) return ''
  const lines = references.map((reference) => {
    const state = reference.present ? sizeText(reference.bytes) : 'not written yet'
    return `- ${reference.mention} — ${reference.kindLabel}, ${state}`
  })
  const tail =
    skipped.length === 0
      ? []
      : [
          '',
          `Could not be named as a file reference (its path cannot be written in the @file grammar): ${skipped
            .map((cardId) => `\`${cardId}\``)
            .join(', ')}.`,
        ]
  return [
    '### Upstream material (file references)',
    '',
    'The board declared this artifact to source from the files below. They are references, not content: read one with the ordinary file tools when you need it, and do not describe a file you have not read.',
    '',
    ...lines,
    ...tail,
  ].join('\n')
}
