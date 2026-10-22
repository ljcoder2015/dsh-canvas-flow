/**
 * dsh-canvas — the right pane's tab types (F2.4, §4.7).
 *
 * Two kinds of type are registered here, and the split is the whole design:
 *
 * - **The workbench** is a *page* type: no address patterns, opened by kind.
 *   It is what the right sidebar's guide offers and what a card's "locate"
 *   action brings forward.
 * - **One type per artifact kind** is a *claim* type: it recognizes the
 *   addresses that kind lives at, outranks the built-in viewers, and draws the
 *   card face for the file. Adding a kind is adding an entry to
 *   `core/kind-registry.ts` — the claims here are derived from that same table,
 *   never restated.
 *
 * The claim is deliberately narrow. A type that declares nothing outranks every
 * built-in viewer, so claiming `dsh-resource://file/**` would take the whole
 * product's file opening away from the product. The canvas claims only the
 * patterns its kinds name, and its `canOpen` veto refuses any address that is
 * not inside one of the user's own canvas projects — everything else falls
 * through to the viewers that already handle it.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { BUILTIN_KINDS, MEDIA_KINDS } from '../../../core/artifact/kind/kind-registry.ts'
import type { KindDefinition, Project } from '../../../types.ts'
import type { CanvasBridge } from '../../wire/bridge.ts'
import { NS } from '../../ui/locales.ts'
import { basenameOf, isInside, parseFileAddress } from '../../wire/address.ts'
import { CanvasView, type CanvasInject } from './canvas-view.tsx'
import { ArtifactTabView, type ArtifactInject } from '../../artifact/artifact-tab.tsx'

/** Id of the workbench tab type; also the key its body registers under. */
export const WORKBENCH_ID = 'dsh-canvas:workbench'
/** Kind of the workbench page type; what `openTab` names. */
export const WORKBENCH_KIND = 'canvas'
/** Prefix of one artifact kind's tab type id. */
export const KIND_TAB_PREFIX = 'dsh-canvas:kind:'

/**
 * Kinds whose addresses the canvas will claim.
 *
 * 媒体那三个（`image` / `video` / `audio`）**从 `MEDIA_KINDS` 摊开**，不在这里再重写一遍。
 * 这份清单原先四个名字是手写的，v1.70 加音频节点时就漏了 `audio`：后果是音频卡在右栏
 * 认领不到自己的地址，点开落到内置查看器上——而 host 那侧的形态认定明明是 `audio`，
 * 于是同一个文件两边各说各话（`.mp3` 有地址模式、却没人认领）。同一条规矩 §十一 已经
 * 写过一次：kind 清单只有 `kind-registry.ts` 一份真源。
 */
const CLAIMABLE = new Set<string>(['app', 'markdown', 'data', ...MEDIA_KINDS])

/** The kinds this package claims addresses for. */
function claimedKinds(): readonly KindDefinition[] {
  return BUILTIN_KINDS.filter((kind) => CLAIMABLE.has(kind.id) && kind.addressPatterns.length > 0)
}

/** How long a project-root snapshot is trusted before a background refresh. */
const ROOT_TTL_MS = 30_000

/**
 * A synchronous answer to "is this file inside one of the user's projects?".
 *
 * The tab registry's `canOpen` is synchronous and runs on every routing
 * decision, so a project list cannot be fetched inside it. This cache is the
 * answer: it keeps the roots from the last refresh and re-fetches in the
 * background once the snapshot goes stale, which is what makes the veto both
 * instant and current.
 */
class ProjectRoots {
  private roots: readonly string[] = []
  private fetchedAt = 0
  private inflight = false

  /** @param bridge - the plugin's call surface. */
  constructor(private readonly bridge: CanvasBridge) {}

  /**
   * Whether an absolute file address belongs to a canvas project.
   * @param address - the address being routed.
   * @returns the synchronous verdict, refreshing in the background when stale.
   */
  has(address: string): boolean {
    void this.refresh()
    const parsed = parseFileAddress(address)
    // Session addresses are not judged here: without a session-to-card map on
    // this side, a synchronous verdict would be a guess, and a wrong guess
    // steals the file from the viewer that would have opened it correctly.
    if (parsed === undefined || parsed.scope !== 'absolute') return false
    return this.roots.some((root) => isInside(root, parsed.path))
  }

  /** Refresh the roots if the snapshot is stale; safe to call on every routing decision. */
  refresh(): Promise<void> {
    if (this.inflight || Date.now() - this.fetchedAt < ROOT_TTL_MS) return Promise.resolve()
    this.inflight = true
    return this.bridge
      .listProjects()
      .then((projects) => {
        this.ingest(projects)
      })
      .catch(() => undefined)
      .finally(() => {
        this.inflight = false
      })
  }

  /**
   * Adopt a project list that was just read elsewhere.
   *
   * The veto must know a canvas the moment it exists: a snapshot taken before
   * the user created it would otherwise keep refusing that canvas's files for
   * the rest of its TTL.
   *
   * @param projects - the list to take the roots from.
   */
  ingest(projects: readonly Project[]): void {
    this.roots = projects.map((project) => project.root)
    this.fetchedAt = Date.now()
  }
}

/** What the tab types and their bodies need from the plugin entry. */
export interface CanvasTabDeps {
  bridge: CanvasBridge
  /** Make one session current, so the host's conversation surface shows it. */
  activateSession: (sessionId: string) => void
}

/**
 * Register the canvas tab types and their bodies.
 *
 * Stage one of a tab type's registration is static (what the type recognizes);
 * stage two is the keyed body under the definition's own `id`. Both stages go
 * through the caller's effect, so unloading the plugin leaves the built-in
 * viewers exactly as they were.
 *
 * @param ctx - the client root context.
 * @param deps - the bridge and the two session helpers the bodies need.
 * @returns the project-root cache, so the entry point can warm it at startup.
 */
export function registerCanvasTabs(ctx: ClientContext, deps: CanvasTabDeps): ProjectRoots {
  const { bridge, activateSession } = deps
  const roots = new ProjectRoots(bridge)

  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: WORKBENCH_ID,
        kind: WORKBENCH_KIND,
        // A page type claims no address, so `canOpen` is not consulted for it.
        title: () => ctx.locale.bind(NS)('canvas.label'),
        guide: [
          {
            id: WORKBENCH_ID,
            order: 10,
            title: () => ctx.locale.bind(NS)('canvas.guide.title'),
            description: () => ctx.locale.bind(NS)('canvas.guide.description'),
          },
        ],
      }),
    'dsh-canvas: workbench type',
  )

  ctx.effect(() => {
    const disposers = claimedKinds().map((kind): (() => void) =>
      ctx.sidebarRightTabs.register({
        id: `${KIND_TAB_PREFIX}${kind.id}`,
        kind: `canvas-${kind.id}`,
        patterns: kind.addressPatterns,
        // A type that declares nothing is an extension, and an extension is
        // what outranks the viewers shipped with the product — that is the
        // point of claiming these addresses at all.
        priority: 'extension',
        canOpen: (address: string) => roots.has(address),
        title: (address: string) => basenameOf(address),
      }),
    )
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-canvas: artifact type claims')

  // Stage two: the bodies. A body is found under its definition's `id`, and
  // `slots.inject` waits for the seat, so the canvas never registers into a
  // sidebar that is not there.
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register(
      {
        name: 'sidebar.right.pane.tab',
        key: WORKBENCH_ID,
        locale: NS,
        inject: (): CanvasInject => ({ bridge, activateSession }),
      },
      CanvasView,
    ),
  )

  ctx.slots.inject('sidebar.right.pane.tab', () => {
    const inject = (): ArtifactInject => ({ bridge })
    const disposers = claimedKinds().map((kind): (() => void) =>
      ctx.slots.register({ name: 'sidebar.right.pane.tab', key: `${KIND_TAB_PREFIX}${kind.id}`, locale: NS, inject }, ArtifactTabView),
    )
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  return roots
}
