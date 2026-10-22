/**
 * dsh-canvas — Client plugin entry (browser half).
 *
 * The boot order here is not incidental; it is the whole file:
 *
 * 1. The stylesheet and the dictionaries go first, because every seat
 *    registered below renders copy and needs its classes to exist.
 * 2. The seats are registered **synchronously**, before the Remote mount
 *    resolves. A registration that waited on an `await` could miss its seat's
 *    declaration and silently never render, so the bridge is created empty and
 *    attached to once the namespaces arrive — a call made in the gap reports
 *    that plainly instead of throwing a property error.
 * 3. Only then is the Remote mounted, and the last thing is the wiring that
 *    needs the mounted faces.
 *
 * Everything runs through `ctx.effect`, so unloading the plugin takes the
 * dictionaries, the tab types, the seats and the in-flight calls with it and
 * leaves the product exactly as it was.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { DSH_CANVAS_REMOTE, type CanvasFace, type CardFace } from './wire/remote.ts'
import { NS, en, zh } from './ui/locales.ts'
import { CanvasBridge } from './wire/bridge.ts'
import { adoptStyles } from './ui/styles.ts'
import { registerCanvasTabs } from './canvas/board/canvas-tab.ts'
import { registerCanvasPanels } from './canvas/project/canvas-panels.tsx'
import { registerToolViews } from './artifact/tool-view.tsx'

/** Required browser services: the Remote gateway, copy, sessions, layout, and both sidebar halves. */
export const inject = ['slots', 'layout', 'remote', 'locale', 'sessions', 'sidebarRight', 'sidebarRightTabs', 'uiWorkspace']

/**
 * Read the two services this half needs off the client root context.
 *
 * The browser half's "which session is the user looking at" action lives on the
 * workspace's navigation service (`uiWorkspace.openSession`), not on the
 * sessions read face, so the sessions domain is not read here at all.
 *
 * @param ctx - the client root context.
 * @returns the navigation service and the Remote gateway.
 */
function clientFaces(ctx: ClientContext): { uiWorkspace: UiWorkspace; remote: TypertClientRemote } {
  return ctx as unknown as { uiWorkspace: UiWorkspace; remote: TypertClientRemote }
}

/** Start the canvas: copy, seats, Remote, wiring. */
export function apply(ctx: ClientContext): void {
  adoptStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-canvas: dictionaries')

  // One abort signal for every call this plugin makes: unloading cancels the
  // in-flight board reads rather than letting them resolve into a dead tree.
  const abort = new AbortController()
  ctx.effect(() => () => abort.abort(), 'dsh-canvas: remote calls')

  const bridge = new CanvasBridge(abort.signal)
  const faces = clientFaces(ctx)

  // ── seats (synchronous, so no declaration can be missed) ──────────────────

  const roots = registerCanvasTabs(ctx, {
    bridge,
    activateSession: (sessionId: string) => faces.uiWorkspace.openSession(sessionId as SessionId),
  })

  registerToolViews(ctx)

  // The sidebar's canvas management area and the main column's canvas panels.
  // Both are seats, so they go up with the rest of them; the first read of the
  // canvas list waits for the mount below, because the call surface does not
  // exist before it.
  const panels = registerCanvasPanels(ctx, {
    bridge,
    openSession: (sessionId: string) => faces.uiWorkspace.openSession(sessionId as SessionId),
    pickDirectory: () => faces.uiWorkspace.pickDirectory(),
    // The tab types' veto reads the same list; handing it over here keeps that
    // cache from refusing a canvas the user created a moment ago.
    onProjects: (projects) => roots.ingest(projects),
  })

  // ── Remote mount ──────────────────────────────────────────────────────────

  ctx.effect(async () => {
    const dispose = await faces.remote.$mount(DSH_CANVAS_REMOTE)
    // The mounted namespaces are services in the global reflect store under
    // `remote.canvas` / `remote.card`, provided by sibling fibers of this
    // plugin. The fiber walk behind `ctx.remote.<name>` only visits ancestors,
    // so the composed property throws "without inject" here; the lenient
    // global read is the one face that sees them.
    const reflect = (ctx as unknown as { reflect: { get(name: string, strict?: boolean): unknown } }).reflect
    const canvas = reflect.get('remote.canvas', false) as CanvasFace | undefined
    const card = reflect.get('remote.card', false) as CardFace | undefined
    if (canvas === undefined || card === undefined) {
      throw new Error('dsh-canvas: the mounted Remote namespaces are missing from the service registry')
    }
    // The framework's own session namespace is optional here: only the card
    // composer's model picker reads it, and that degrades to a plain notice.
    const session = reflect.get('remote.session', false) as Parameters<CanvasBridge['attach']>[2] | undefined
    bridge.attach(canvas, card, session)
    // Warm the project-root cache: it is what the tab types' `canOpen` veto
    // consults, and it must already hold an answer by the first routing
    // decision rather than the one after it.
    void roots.refresh()
    // Same list, second consumer: this is what puts the canvas rows in the
    // sidebar and the canvas panels behind them.
    panels.refresh()
    return () => {
      void dispose()
    }
  }, 'dsh-canvas: remote')
}
