/**
 * dsh-canvas — stable identities.
 *
 * Card ids are opaque board seat identities minted as six random letters —
 * deliberately *not* file names, so the artifact file can be named (and
 * renamed) freely; the path lives on the card record's `file` field. Records
 * minted before that split keep a path-shaped id, which is why every file
 * lookup falls back to the id when a record carries no `file`. Project ids
 * cannot be paths (they cross the wire and are schema-bounded), and they must
 * stay stable across restarts, so they are derived from the root: a readable
 * slug plus a short digest of the full path. Two projects named `deck` under
 * different parents therefore stay distinct, and re-binding the same directory
 * reuses the same project.
 */

/**
 * 32-bit FNV-1a, rendered base 36.
 *
 * A digest is only used to disambiguate sibling-named roots, so collision
 * resistance at 32 bits is far beyond what the board needs; using a real
 * cryptographic hash here would cost the plugin a dependency for nothing.
 */
export function shortDigest(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** Turn an arbitrary directory name into a wire-safe slug. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return slug === '' ? 'canvas' : slug.slice(0, 40)
}

/** Deterministic project id for one workspace root. */
export function projectIdOf(root: string): string {
  const normalised = root.replace(/\/+$/, '')
  const base = normalised.split('/').pop() ?? 'canvas'
  return `${slugify(base)}-${shortDigest(normalised)}`
}

/** Alphabet a minted card id draws from — lowercase letters only. */
const CARD_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz'
/** Length of a minted card id: six letters, per the board's identity rule. */
const CARD_ID_LENGTH = 6

/**
 * Mint one card id that no card in `taken` holds.
 *
 * Six random letters: short enough to read on a card caption, opaque enough
 * that no file name can collide with it by accident. The pool is 26⁶ ≈ 309m,
 * so the retry loop below never spins in practice; it exists because "random"
 * is not "unique" and the seat table is the only judge that matters.
 */
export function mintCardId(taken: Iterable<string>): string {
  const used = new Set(taken)
  for (;;) {
    let id = ''
    for (let index = 0; index < CARD_ID_LENGTH; index += 1) {
      id += CARD_ID_ALPHABET[Math.floor(Math.random() * CARD_ID_ALPHABET.length)]
    }
    if (!used.has(id)) return id
  }
}

/**
 * Escape everything outside the storage key alphabet as fixed-width `_xxxx`.
 *
 * The JSON medium's `per-record` layout turns a record key into a path segment
 * and rejects everything outside `[a-zA-Z0-9_-]+` at write — and card ids are
 * paths, so they carry dots and slashes. The escape is fixed-width, so it can
 * neither be ambiguous nor collide with a separator that also avoids `_`:
 * a literal `_` in the input always comes out as `_005f`, which means the
 * sequence `__` can only ever be a delimiter someone put there on purpose.
 */
export function encodeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9-]/g, (char) => `_${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}
