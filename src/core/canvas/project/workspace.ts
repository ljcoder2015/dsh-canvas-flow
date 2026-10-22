/**
 * dsh-canvas — the one seam between a canvas project and the deployment's
 * Workspace registry.
 *
 * A canvas *is* a folder, and the harness groups conversations by Workspace:
 * a session is shown under a Workspace only when its id sits on that
 * Workspace's account **and** its stored header `cwd` canonicalizes to exactly
 * the Workspace path. Card conversations already carry the canvas root as
 * their `cwd` — what they never had was the account, so every one of them fell
 * into the sidebar's 未分组 bucket even though the canvas owned the folder they
 * ran in.
 *
 * So, one move, made from two call sites: `claimCanvasWorkspace` registers the
 * canvas root as a Workspace titled after the canvas and accounts the given
 * conversations on it.
 *
 * - Creating a canvas claims it with the sessions its already-seated cards are
 *   bound to, so re-opening an old canvas walks its conversations out of
 *   未分组 on the spot.
 * - Opening a card conversation claims it with that one session, which is how
 *   every conversation opened afterwards lands under its canvas's folder.
 *
 * Registration is idempotent: a folder the user already added to the sidebar
 * by hand resolves to the same record and keeps its own title.
 *
 * All of it is best effort and quiet by design. `ctx.workspaceRegistry` is a
 * deployment service this plugin does not inject (a bare harness has no roster
 * at all, and the service may register after this plugin), so absence means
 * "this deployment has no grouping surface", not "the canvas is broken" — a
 * canvas that cannot be grouped is still a working canvas, and failing its
 * creation over a sidebar nicety would be the worse trade.
 */
import type { Context } from '@deepseek-ai/cordis'
import { PLUGIN_ID } from '../../../host/prompt.ts'

/** The slice of one Workspace entity this module uses. */
export interface CanvasWorkspace {
  readonly id: string
  readonly path: string
  /** Prepend one session to the Workspace's account (see the registry docs). */
  attachSession(sessionId: string): Promise<void>
}

/** The slice of the Host Workspace registry this module uses. */
interface WorkspaceRegistry {
  /** Create or reuse a Workspace over an *existing* directory. */
  create(path: string, title?: string): Promise<CanvasWorkspace>
}

/**
 * The registry this deployment publishes, read fresh every call.
 *
 * A lookup, never a snapshot taken in `apply`: the registry is not in this
 * plugin's `inject` list, so at apply time it may simply not be there yet.
 */
function registryOf(ctx: Context): WorkspaceRegistry | undefined {
  return ctx.get('workspaceRegistry', true) as WorkspaceRegistry | undefined
}

/**
 * Conversations this process has already accounted, keyed by Workspace path
 * plus session id.
 *
 * Attaching is idempotent on the registry side but not free — it validates the
 * session's stored header through a realpath on every call — and the card open
 * path runs on every click, so the answer is remembered here.
 */
const attached = new Set<string>()

/** Register (or resolve) the Workspace that owns one canvas root. */
async function ensureCanvasWorkspace(
  ctx: Context,
  root: string,
  title: string,
): Promise<CanvasWorkspace | undefined> {
  const registry = registryOf(ctx)
  if (registry === undefined) return undefined
  try {
    return await registry.create(root, title)
  } catch (error) {
    // A root the registry refuses (not a real directory, or a canonical path
    // another record already owns) is reported once and then dropped:
    // grouping is not the canvas's job, and the failure must not reach the wire.
    ctx.logger(PLUGIN_ID).warn(`canvas root ${root} could not be registered as a workspace`, error)
    return undefined
  }
}

/**
 * Claim one canvas for its Workspace, and account conversations on it.
 *
 * @param ctx - Host context; the registry is looked up on it.
 * @param canvas - The canvas: its root directory and its display name.
 * @param sessionIds - Conversations to account; empty ids are skipped.
 * @returns how many of them are on the account after this call.
 */
export async function claimCanvasWorkspace(
  ctx: Context,
  canvas: { root: string; title: string },
  sessionIds: readonly string[],
): Promise<number> {
  const workspace = await ensureCanvasWorkspace(ctx, canvas.root, canvas.title)
  if (workspace === undefined) return 0
  let accounted = 0
  for (const sessionId of sessionIds) {
    if (sessionId === '') continue
    const key = `${workspace.path}\u0000${sessionId}`
    if (attached.has(key)) {
      accounted += 1
      continue
    }
    try {
      await workspace.attachSession(sessionId)
      attached.add(key)
      accounted += 1
    } catch (error) {
      // The usual cause is a cwd mismatch: the conversation ran in a directory
      // that canonicalizes elsewhere (a symlinked canvas root). Logged, never
      // raised — the conversation itself is fine, it just stays ungrouped.
      ctx.logger(PLUGIN_ID).warn(
        `card conversation ${sessionId} stays ungrouped: ${workspace.path} refused the account`,
        error,
      )
    }
  }
  return accounted
}

/** Claim one canvas for one conversation — the card-open path. */
export async function attachCanvasSession(
  ctx: Context,
  canvas: { root: string; title: string },
  sessionId: string,
): Promise<boolean> {
  return (await claimCanvasWorkspace(ctx, canvas, [sessionId])) === 1
}
