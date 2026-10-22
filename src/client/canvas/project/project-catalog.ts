/**
 * dsh-canvas — the live list of canvas projects.
 *
 * Canvas projects are only ever created by this plugin's own interface, so the
 * list needs no polling: one read at startup, and a forced re-read after every
 * create (and after a canvas panel is about to be selected, since the panel it
 * addresses may have just come into being).
 *
 * Two consumers share it, and they want different things from it:
 *
 * - the main column mounts and recycles one panel per canvas (the `sync`
 *   listener in canvas-panels.tsx), and
 * - the sidebar's canvas area renders the list (a `useSyncExternalStore`
 *   subscriber in canvas-nav.tsx), which compares snapshots **by reference**.
 *
 * That second consumer is why `snapshot()` exists and why every notification
 * carries one array: a fresh array per read would read as a change on every
 * render pass.
 */
import type { Project } from '../../../types.ts'
import type { CanvasBridge } from '../../wire/bridge.ts'

/** A list of canvas projects, refreshed on demand and pushed to subscribers. */
export class ProjectCatalog {
  private readonly listeners = new Set<(projects: readonly Project[]) => void>()
  private inflight: Promise<void> | undefined
  private current: readonly Project[] = []
  /** Issue counter for reads; see `start` for why reads are ranked. */
  private issued = 0

  /** @param bridge - the plugin's call surface. */
  constructor(private readonly bridge: CanvasBridge) {}

  /**
   * The list as of the last successful read.
   *
   * Stable between changes: the same array is handed out until a read lands,
   * so a subscriber comparing by reference sees exactly one change per read.
   *
   * @returns the current list (empty until the first read lands).
   */
  snapshot(): readonly Project[] {
    return this.current
  }

  /** Read the list; a read already in flight is shared rather than duplicated. */
  refresh(): Promise<void> {
    return this.inflight ?? this.start()
  }

  /** Force a re-read: used right after a canvas is created or deleted. */
  reload(): Promise<void> {
    return this.start()
  }

  /** Subscribe to list changes; returns the unsubscribe. */
  subscribe(listener: (projects: readonly Project[]) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Issue one call and hand the result to every subscriber (subscribers run first — the read is not done until they have). */
  private start(): Promise<void> {
    // Reads are concurrent (one at startup, another right after a create), and
    // an earlier one can land later than a newer one. The list belongs to the
    // newest read issued, so every read carries its rank and a superseded one
    // publishes nothing — otherwise one slow read would put back the canvas
    // that was just created.
    const issued = (this.issued += 1)
    // Yield one tick first: the call surface throws synchronously before the
    // Remote is mounted, and landing that as a rejection keeps "not mounted
    // yet" a single missed read instead of a torn-down seat registration.
    const run = Promise.resolve()
      .then(() => this.bridge.listProjects())
      .then((projects) => {
        if (issued !== this.issued) return
        this.current = projects
        for (const listener of [...this.listeners]) listener(projects)
      })
      // An unreadable list keeps the previous one: fewer canvases beats a
      // vanishing canvas area.
      .catch(() => undefined)
    this.inflight = run
    void run.then(() => {
      if (this.inflight === run) this.inflight = undefined
    })
    return run
  }
}
