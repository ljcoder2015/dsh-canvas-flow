/**
 * dsh-canvas — the source edges (F4.1).
 *
 * There is exactly one relation on this board: 引用 — a **source edge**. A downstream artifact
 * takes its material from an upstream one, so the line runs material → product.
 *
 * The line has exactly one look: a thin solid stroke in the breeze accent, no
 * arrowhead, no label, no legend. The line in the hand looks the same, because
 * it *is* the same line — born at the port's centre, with the far end still
 * following the hand until it lands (see `PORT_REACH` and `pendingPath`).
 * Nothing here reacts to the pointer: the layer is `pointer-events:none`, so a
 * stroke never intercepts a drag that crosses it.
 *
 * The layer is one SVG that shares the board's transformed coordinate space, so
 * every path is written in canvas coordinates and needs no screen-space maths.
 * While the user drags a card or a new edge, the affected path is drawn from
 * the live pointer position instead of the committed one.
 */
import type { BoardCard, BoardSource, Point } from '../../../types.ts'
// 卡片尺寸取自共享的那一份真源（`core/canvas/card-size.ts`）：宿主排位、卡片渲染、
// 锚点与命中矩形必须是同一个数，引用线才落在真实的边上。图片与视频卡是两倍大。
import { sizeOfCard, type CardSize } from '../../../core/canvas/card/card-size.ts'

/**
 * How far a port's centre sits outside the card's border.
 *
 * The ports hang 12px clear of the card and are 16px wide (`[data-side=out]`
 * is `right:-28px` in `styles.ts`), so their centres land 20px beyond the
 * border. That is where a drag from a port has to start — the anchor is the
 * port, not the card — and it is also what a release point is turned back into
 * a seat by (`seatAtAnchor`). The number and those CSS rules are one pair:
 * change one, change the other.
 */
export const PORT_REACH = 20

/**
 * A port's centre, which is the anchor a source edge is dragged from.
 *
 * @param position - the card's top-left seat, in canvas coordinates.
 * @param side - `out` = the card's material port (right), `in` = its consumer port (left).
 * @param size - that card's own footprint; a tall image card's centre is not the default one.
 * @returns the anchor point, in canvas coordinates.
 */
export function portAnchor(position: Point, side: 'in' | 'out', size: CardSize = sizeOfCard({})): Point {
  const x = side === 'out' ? position.x + size.width + PORT_REACH : position.x - PORT_REACH
  return { x, y: position.y + size.height / 2 }
}

/**
 * The seat a new card takes so that one of its ports lands on a release point.
 *
 * A drag out of the `out` port means the new card consumes this one's material,
 * so the new card's `in` port is what the hand let go of; a drag out of `in` is
 * the mirror. Placing it this way is what makes the gesture continuous: the
 * point the user released on becomes the port the relation is drawn to, so the
 * thin line they were dragging turns into the committed edge in place.
 *
 * @param at - the release point, in canvas coordinates.
 * @param side - the port the drag started from.
 * @param size - the footprint the placed card will have (default when it has no artifact yet).
 * @returns the new card's top-left seat, in canvas coordinates.
 */
export function seatAtAnchor(at: Point, side: 'in' | 'out', size: CardSize = sizeOfCard({})): Point {
  const x = side === 'out' ? at.x + PORT_REACH : at.x - size.width - PORT_REACH
  return { x: Math.round(x), y: Math.round(at.y - size.height / 2) }
}

/** Where the user is dragging a brand-new edge from. */
export interface PendingEdge {
  /** The card the drag started on. */
  cardId: string
  /** `out` = that card is the material; `in` = that card is the consumer. */
  side: 'in' | 'out'
  /** Live pointer position, in canvas coordinates. */
  at: Point
}

/** Props of the edge layer. */
export interface SourceEdgesProps {
  cards: readonly BoardCard[]
  sources: readonly BoardSource[]
  /** The card currently being dragged, whose drawn position overrides its seat. */
  dragging: { cardId: string; position: Point } | undefined
  /** The selected card, whose edges are lifted one notch by opacity alone. */
  selectedCardId: string | undefined
  /** The rubber band while a new edge is being dragged. */
  pending: PendingEdge | undefined
}

/** Centre of a card's right edge. */
function outAnchor(position: Point, size: CardSize): Point {
  return { x: position.x + size.width, y: position.y + size.height / 2 }
}

/** Centre of a card's left edge. */
function inAnchor(position: Point, size: CardSize): Point {
  return { x: position.x, y: position.y + size.height / 2 }
}

/**
 * A cubic path between two anchors.
 *
 * Left-to-right pairs get horizontal handles, which reads as "material flows
 * into product". Everything else (the same column, or a downstream that sits
 * to the left) gets vertical handles, because a horizontal handle would double
 * back through the cards.
 */
function edgePath(from: Point, to: Point): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    const bend = Math.max(36, Math.abs(dx) * 0.45)
    return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`
  }
  const bend = Math.max(36, Math.abs(dy) * 0.45)
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + bend}, ${to.x} ${to.y - bend}, ${to.x} ${to.y}`
}

/**
 * The path of an edge still in the hand.
 *
 * Same curve as a committed edge, one difference that matters: the handles
 * leave the anchor in the direction the drag came from. A relation always runs
 * left to right, but a drag out of the `in` port runs right to left, and a
 * left-to-right handle there would loop back over the card the hand started on.
 *
 * @param from - the port's centre, in canvas coordinates.
 * @param to - the live pointer, in canvas coordinates.
 * @param side - the port the drag started from.
 * @returns the SVG path data.
 */
export function pendingPath(from: Point, to: Point, side: 'in' | 'out'): string {
  const sign = side === 'out' ? 1 : -1
  const dx = (to.x - from.x) * sign
  const dy = to.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    const bend = Math.max(36, Math.abs(dx) * 0.45)
    return `M ${from.x} ${from.y} C ${from.x + sign * bend} ${from.y}, ${to.x - sign * bend} ${to.y}, ${to.x} ${to.y}`
  }
  const bend = Math.max(36, Math.abs(dy) * 0.45)
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + bend}, ${to.x} ${to.y - bend}, ${to.x} ${to.y}`
}

/** Render the board's source edges. */
export function SourceEdges(props: SourceEdgesProps) {
  const { cards, sources, dragging, selectedCardId, pending } = props

  /**
   * A card's live seat 与它自己的尺寸（拖动中的那张按手上那一位算）。
   *
   * 两张都要：座位给出左上角，比例给出它占多大（一张竖图卡比横图卡高一倍）。只取座位会
   * 把线画到「默认卡片宽」处，而那张卡可能比它高得多——线落在卡的正中间。
   */
  const boxOf = (cardId: string): { position: Point; aspect?: number | undefined } | undefined => {
    if (dragging !== undefined && dragging.cardId === cardId) return { position: dragging.position }
    const card = cards.find((entry) => entry.id === cardId)
    return card === undefined ? undefined : { position: card.position, aspect: card.aspect }
  }

  return (
    <svg className="dsh-canvas-edges" style={{ left: '-4000px', top: '-4000px' }} width="12000" height="12000" viewBox="-4000 -4000 12000 12000">
      {sources.map((source) => {
        const upstream = boxOf(source.upstream)
        const downstream = boxOf(source.downstream)
        if (upstream === undefined || downstream === undefined) return null

        const active = selectedCardId === source.upstream || selectedCardId === source.downstream

        return (
          <path
            key={source.id}
            className={active ? 'dsh-canvas-edge is-active' : 'dsh-canvas-edge'}
            d={edgePath(
              outAnchor(upstream.position, sizeOfCard(upstream)),
              inAnchor(downstream.position, sizeOfCard(downstream)),
            )}
          />
        )
      })}

      {pending === undefined
        ? null
        : (() => {
            const start = boxOf(pending.cardId)
            if (start === undefined) return null
            // 从锚点（端口圆心）起笔、终点就是指针本身。样式与落定的引用线同款（细线、
            // 无箭头），`is-pending` 这个类不挂样式，只留给工具区分「手上这根」。
            return (
              <path
                className="dsh-canvas-edge is-pending"
                d={pendingPath(portAnchor(start.position, pending.side, sizeOfCard(start)), pending.at, pending.side)}
              />
            )
          })()}
    </svg>
  )
}
