/**
 * dsh-canvas — board seating (F4.6).
 *
 * Arrangement is geometry over the graph and nothing else: it takes the cards,
 * the source edges and a strategy, and returns the positions the cards should
 * move to. It touches no storage, so `canvas_arrange_on_board` can be reasoned
 * about (and tested) as one pure function, and a drag that the user has already
 * done by hand is never silently undone unless the caller asks for `organize`.
 */
import type { ArrangeStrategy, CardId, Point, Source } from '../../../types.ts'
import { CARD_HEIGHT, sizeOfCard, type CardSize } from '../card/card-size.ts'

// 尺寸的真源搬到 `card-size.ts`（所有形态同一个尺寸）；从这里再导出一次，是因为排位、
// 锚点与判据都习惯从「板面几何」这一处取。**数字别在这里重写一遍**。
export { CARD_HEIGHT, CARD_WIDTH } from '../card/card-size.ts'

/** Top-left corner a fresh board lays its first card at. */
export const BOARD_ORIGIN: Point = { x: 48, y: 170 }

/** One card's seating input: its identity, its kind and, optionally, where it already is. */
export interface SeatInput {
  id: CardId
  /** Artifact path the card binds, when the caller knows it (id/path split: the id is not a path). */
  file?: string
  /**
   * The card's kind id.
   *
   * **排位不再看它**（v1.79 起所有卡一样大）。留着是因为它是座位的一条事实，宿主与判据
   * 都在传；哪天某个形态要单独坐，第一个要看的就是这里。
   */
  kind?: string
  /**
   * 产物的真实宽高比（F3.11）。
   *
   * 排位要看它：一张 9:16 的竖视频卡比 16:9 的图卡高一倍，按默认高度排会在下面留出一条
   * 别人挤进来的空档（或反过来把下一张盖住）。
   */
  aspect?: number
  /** Current position, used as a stable tiebreaker so re-arranging is idempotent. */
  position?: Point
}

/** A decided position for one card. */
export interface Seat {
  id: CardId
  position: Point
}

/** The footprint one seating input asks for：量过比例就按比例，没量过就默认 16:9。 */
function sizeOf(card: SeatInput): CardSize {
  return sizeOfCard(card)
}

/** Lay cards out in a left-to-right, top-to-bottom grid. */
function gridSeats(cards: readonly SeatInput[], gap: number, columns?: number): Seat[] {
  if (cards.length === 0) return []
  const perRow = columns ?? Math.max(1, Math.ceil(Math.sqrt(cards.length)))
  const seats: Seat[] = []
  // 逐行累积：列宽取该行每张卡自己的宽，行高取该行最高的那张。今天所有卡一样大，这个
  // 写法与固定步长等价；保留「按各自尺寸」是为了哪天某个形态要单独坐时排位不用重写。
  let y = BOARD_ORIGIN.y
  for (let start = 0; start < cards.length; start += perRow) {
    const row = cards.slice(start, start + perRow)
    let x = BOARD_ORIGIN.x
    let rowHeight = 0
    for (const card of row) {
      seats.push({ id: card.id, position: { x, y } })
      const size = sizeOf(card)
      x += size.width + gap
      rowHeight = Math.max(rowHeight, size.height)
    }
    y += rowHeight + gap
  }
  return seats
}

/**
 * Longest-path depth of every card over the source edges.
 *
 * Depth is the length of the longest upstream chain ending at the card, so a
 * card that builds on two materials always sits one column to the right of the
 * furthest material — the layout reads left to right as "material → product".
 * Cards inside a cycle (impossible to store, possible in a corrupted record)
 * keep depth 0 rather than hanging the walk.
 */
export function depthsOf(cards: readonly SeatInput[], sources: Iterable<Source>): Map<CardId, number> {
  const parents = new Map<CardId, CardId[]>()
  for (const card of cards) parents.set(card.id, [])
  for (const source of sources) {
    const list = parents.get(source.downstream)
    if (list !== undefined) list.push(source.upstream)
  }

  const depths = new Map<CardId, number>()
  const visiting = new Set<CardId>()
  const depthOf = (id: CardId): number => {
    const cached = depths.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0
    visiting.add(id)
    let depth = 0
    for (const parent of parents.get(id) ?? []) depth = Math.max(depth, depthOf(parent) + 1)
    visiting.delete(id)
    depths.set(id, depth)
    return depth
  }

  for (const card of cards) depthOf(card.id)
  return depths
}

/** Whether a card participates in any source edge. */
function connected(cards: readonly SeatInput[], sources: readonly Source[]): Set<CardId> {
  const linked = new Set<CardId>()
  for (const source of sources) {
    linked.add(source.upstream)
    linked.add(source.downstream)
  }
  return new Set(cards.filter((card) => linked.has(card.id)).map((card) => card.id))
}

/** Stable ordering: by current position, so a rebuild does not shuffle the board. */
function readingOrder(cards: readonly SeatInput[]): SeatInput[] {
  return [...cards].sort((left, right) => {
    const ly = left.position?.y ?? 0
    const ry = right.position?.y ?? 0
    if (ly !== ry) return ly - ry
    const lx = left.position?.x ?? 0
    const rx = right.position?.x ?? 0
    if (lx !== rx) return lx - rx
    return left.id.localeCompare(right.id)
  })
}

/**
 * Compute the seats for one strategy (F4.6).
 *
 * - `source-chain` places every card by its depth, one column per hop.
 * - `grid` is a plain compact grid, for a board with no edges worth reading.
 * - `organize` is the "tidy up" pass: cards that take part in a chain keep the
 *   chain layout, and the loose ones (notes-as-cards, orphans) are packed into
 *   a grid underneath, so a board that has accumulated strays ends up legible
 *   without any card's relationship being redefined.
 */
export function arrangeSeats(
  cards: readonly SeatInput[],
  sources: readonly Source[],
  strategy: ArrangeStrategy,
  gap: number,
): Seat[] {
  if (cards.length === 0) return []
  const ordered = readingOrder(cards)

  if (strategy === 'grid') return gridSeats(ordered, gap)

  if (strategy === 'source-chain') {
    const depths = depthsOf(ordered, sources)
    const columns = new Map<number, SeatInput[]>()
    for (const card of ordered) {
      const depth = depths.get(card.id) ?? 0
      const column = columns.get(depth)
      if (column === undefined) columns.set(depth, [card])
      else column.push(card)
    }
    const seats: Seat[] = []
    // 列的 x 由**前面每一列最宽的那张**决定，行内 y 同理按各自的高。
    let x = BOARD_ORIGIN.x
    for (const [, column] of [...columns].sort((left, right) => left[0] - right[0])) {
      let y = BOARD_ORIGIN.y
      let columnWidth = 0
      for (const card of column) {
        seats.push({ id: card.id, position: { x, y } })
        const size = sizeOf(card)
        y += size.height + gap
        columnWidth = Math.max(columnWidth, size.width)
      }
      x += columnWidth + gap
    }
    return seats
  }

  // organize: chains first (unchanged semantics), loose cards packed below.
  const linked = connected(ordered, sources)
  const chained = ordered.filter((card) => linked.has(card.id))
  const loose = ordered.filter((card) => !linked.has(card.id))

  const seats = chained.length === 0 ? [] : arrangeSeats(chained, sources, 'source-chain', gap)
  // 链的「底」是每一行最低的那条边，不是最高的那个 y——卡高将来若不一，散卡才不会被盖住。
  const heightById = new Map(ordered.map((card) => [card.id, sizeOf(card).height]))
  const chainBottom = seats.reduce(
    (bottom, seat) => Math.max(bottom, seat.position.y + (heightById.get(seat.id) ?? CARD_HEIGHT)),
    BOARD_ORIGIN.y,
  )
  const looseOrigin = {
    x: BOARD_ORIGIN.x,
    y: chained.length === 0 ? BOARD_ORIGIN.y : chainBottom + gap,
  }
  const perRow = Math.max(1, Math.ceil(Math.sqrt(Math.max(loose.length, 1))))
  const looseSeats = gridSeats(loose, gap, perRow)
  for (const seat of looseSeats) {
    seats.push({ id: seat.id, position: { x: looseOrigin.x + (seat.position.x - BOARD_ORIGIN.x), y: looseOrigin.y + (seat.position.y - BOARD_ORIGIN.y) } })
  }
  return seats
}

/**
 * The seat a newly discovered card takes when it is appended to an occupied
 * board: one step right of the right-most card, so a new file never lands on
 * top of an existing one.
 */
export function nextFreeSeat(cards: readonly SeatInput[], gap: number): Point {
  if (cards.length === 0) return { ...BOARD_ORIGIN }
  // 右沿按每张卡**自己的宽**算：新卡要落在最右那张的右沿之外，而不是「它的 x + 200」——
  // 那会正好压住它的右半边（宽度数也从 card-size 读，不在这里重写）。
  const rightMost = cards.reduce((max, card) => Math.max(max, (card.position?.x ?? 0) + sizeOf(card).width), 0)
  const bottomMost = cards.reduce((max, card) => Math.max(max, card.position?.y ?? 0), 0)
  return { x: rightMost + gap, y: bottomMost }
}
