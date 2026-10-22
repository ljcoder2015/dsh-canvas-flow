/**
 * dsh-canvas — the per-kind tab an artifact opens in (F2.4, §4.7).
 *
 * This is the client half of the kind registry. The host decides *what* an
 * artifact is from its evidence; this half claims the *addresses* of the kinds
 * the canvas has a face for and, once claimed, shows that face: the digest,
 * the material chain, the queued intents, and the way back to the board.
 *
 * The tab also carries the one action the board cannot: pulling a file that
 * lives inside a project root onto the canvas. That is `card.createCard`, and
 * the seat it lands on is computed by the same pure `nextFreeSeat` the host
 * uses, so a card added from here and a card added from a scan agree.
 */
import { useCallback, useEffect, useState } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { nextFreeSeat, type SeatInput } from '../../core/canvas/board/board.ts'
import type { Project } from '../../types.ts'
import type { CanvasBridge, LocatedCard } from '../wire/bridge.ts'
import type { Translate } from '../ui/locales.ts'
import { CardFace, useCardFacts } from '../canvas/card/card-face.tsx'
import { basenameOf, isInside, parseFileAddress, relativeTo } from '../wire/address.ts'

/** Gap used when seating a card pulled in from a tab; matches `Config.arrangeGap`'s default. */
const SEAT_GAP = 88

/** The page kind of the canvas workbench, as registered in `canvas-tab.ts`. */
export const WORKBENCH_KIND = 'canvas'

/** Services this tab reaches through the inject face. */
export interface ArtifactInject {
  bridge: CanvasBridge
}

/** Composed props of one artifact tab. */
export type ArtifactTabProps = PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<ArtifactInject> & { t: Translate }

/** What one tab's address resolved to. */
interface Location {
  /** The card, once the artifact is on its project's board. */
  located: LocatedCard | undefined
  /** The project whose root contains the file, whether or not it is seated. */
  project: Project | undefined
  /** Whether the artifact already has a card on that board. */
  onBoard: boolean
  loading: boolean
}

/**
 * Resolve a tab's address to a card.
 *
 * The absolute form is the one the canvas itself opens, so it is resolved
 * against the project roots directly. The session form arrives when a user
 * opens a file from a card's session; that session is the card's, so the card
 * lookup answers it and the path is checked against what it reports.
 *
 * @param bridge - the plugin's call surface.
 * @param address - the address the tab was opened with.
 * @returns the resolved location; `project` is `undefined` when the file is
 *   outside every project root.
 */
function useLocation(bridge: CanvasBridge, address: string): Location {
  const [location, setLocation] = useState<Location>({ located: undefined, project: undefined, onBoard: false, loading: true })

  useEffect(() => {
    const parsed = parseFileAddress(address)
    if (parsed === undefined) {
      setLocation({ located: undefined, project: undefined, onBoard: false, loading: false })
      return
    }

    let cancelled = false
    setLocation((current) => ({ ...current, loading: true }))

    void (async () => {
      try {
        if (parsed.scope === 'session') {
          const found = await bridge.findCardBySession(parsed.sessionId)
          if (found === undefined) {
            if (!cancelled) setLocation({ located: undefined, project: undefined, onBoard: false, loading: false })
            return
          }
          const board = await bridge.readBoard(found.project.id)
          const seated = board.cards.find((card) => card.id === found.card.id)
          if (!cancelled) {
            setLocation({
              located: seated === undefined ? undefined : { project: found.project, card: seated },
              project: found.project,
              onBoard: seated !== undefined,
              loading: false,
            })
          }
          return
        }

        const projects = await bridge.listProjects()
        const project = projects.find((entry) => isInside(entry.root, parsed.path))
        if (project === undefined) {
          if (!cancelled) setLocation({ located: undefined, project: undefined, onBoard: false, loading: false })
          return
        }
        const board = await bridge.readBoard(project.id)
        const cardFile = relativeTo(project.root, parsed.path)
        // Reconciliation is by *file*: the card id is a random seat identity,
        // and the artifact path lives on the card's `file`.
        const seated = board.cards.find((card) => card.file === cardFile)
        if (!cancelled) {
          setLocation({
            located: seated === undefined ? undefined : { project, card: seated },
            project,
            onBoard: seated !== undefined,
            loading: false,
          })
        }
      } catch {
        if (!cancelled) setLocation({ located: undefined, project: undefined, onBoard: false, loading: false })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [address, bridge])

  return location
}

/** Render one artifact tab. */
export function ArtifactTabView(props: ArtifactTabProps) {
  const { bridge, t, useTabInfo } = props
  const tab = useTabInfo()
  const address = tab.tab.navigation.address
  const location = useLocation(bridge, address)
  const facts = useCardFacts(bridge, location.located, t)
  const [busy, setBusy] = useState(false)

  const joinBoard = useCallback(() => {
    const parsed = parseFileAddress(address)
    if (parsed === undefined || parsed.scope !== 'absolute') return
    setBusy(true)
    void (async () => {
      try {
        const projects = await bridge.listProjects()
        const project = projects.find((entry) => isInside(entry.root, parsed.path))
        if (project === undefined) return
        const board = await bridge.readBoard(project.id)
        const seats: SeatInput[] = board.cards.map((card) => ({ id: card.id, file: card.file, position: card.position }))
        const cardFile = relativeTo(project.root, parsed.path)
        // The host re-derives the kind from the file's own evidence and mints
        // the card id; `file` is only the fallback kind for an artifact it
        // cannot place.
        await bridge.createCard(project.id, cardFile, 'file', nextFreeSeat(seats, SEAT_GAP))
      } finally {
        setBusy(false)
      }
    })()
  }, [address, bridge])

  if (location.loading) {
    return (
      <div className="dsh-canvas-panel">
        <span className="dsh-canvas-muted">{t('canvas.loading')}</span>
      </div>
    )
  }

  if (location.located === undefined) {
    return (
      <div className="dsh-canvas-panel">
        <div className="dsh-canvas-empty-title">{basenameOf(address)}</div>
        <span className="dsh-canvas-muted">{t('canvas.panel.path')}：{address}</span>
        {location.project === undefined ? (
          <span className="dsh-canvas-muted">{t('canvas.view.outside')}</span>
        ) : (
          <div className="dsh-canvas-panel-actions">
            <button className="dsh-canvas-chipbtn" data-primary="true" disabled={busy} onClick={joinBoard}>
              {t('canvas.action.joinBoard')}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <CardFace located={location.located} facts={facts} t={t}>
      <button className="dsh-canvas-chipbtn" data-primary="true" onClick={() => tab.tab.actions.openTab(WORKBENCH_KIND)}>
        {t('canvas.action.locate')}
      </button>
    </CardFace>
  )
}
