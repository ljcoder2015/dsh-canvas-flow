/**
 * 卡片尺寸的判据（F2.7 / F3.11，v1.77 → v1.79）。
 *
 * 用户原话三轮：「图片卡片和视频卡片，要放大一倍，方便预览」→「调整图片视频尺寸默认为
 * 16:9 的宽高比，现在高度有空白区域」→「其他类型的卡片大小改成和图片和视频一样的默认
 * 大小」。前两轮把媒体卡放大到 400×252（卡面正好 16:9），第三轮把这一档**推给所有形态**。
 *
 * 这件事的几何很简单（一张卡 400×252），难的是它在画布上有**六处**消费者：卡片自己的
 * 渲染、引用线的锚点、连线落点的命中矩形、取景与缩略图、宿主排位、控制带与工具条挂在哪。
 * 六处读同一个函数（`cardSizeOf()`），一处写错就是「线画在卡片中间」这类**不报错**的错位。
 *
 * 四半：
 *
 * 1. **一档**：所有形态同一个尺寸，且 `cardSizeOf` / `cardPanelOf` **不接受参数**——
 *    签名里没有 kind，「图片大、文本小」这种分岔就写不出来。这一条替代了 v1.77 的
 *    「放大名单与媒体形态表差的正好是 audio」，因为「名单」本身已经不存在了。
 * 2. **卡面 16:9**：验面板比例而不是验高度——改卡宽时高度会跟着变，比例不该变。
 * 3. **排位不重叠**：座位上如果按错的步长排，后一张会盖住前一张（贴着不算相交）。
 * 4. **接线**（读源码文本）：客户端四处真的用了这个函数、且**没有一处给它传 kind**；
 *    卡头高度与边框宽度**拿 `styles.ts` 现算一遍**——这两个数扣错了，16:9 的图就会在
 *    卡面下方留出一条空带，而页面上一句报错都没有。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CARD_BORDER,
  CARD_HEAD_HEIGHT,
  CARD_HEIGHT,
  CARD_WIDTH,
  MEDIA_CARD_ASPECT,
  cardPanelOf,
  cardSizeFor,
  cardSizeOf,
  sizeOfCard,
} from '../../../../src/core/canvas/card/card-size.ts'
import { arrangeSeats, nextFreeSeat, type Seat, type SeatInput } from '../../../../src/core/canvas/board/board.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

const SIZES = '../../../../src/core/canvas/card/card-size.ts'
const TILE = '../../../../src/client/canvas/card/card-tile.tsx'
const VIEW = '../../../../src/client/canvas/board/canvas-view.tsx'
const EDGES = '../../../../src/client/canvas/board/source-edges.tsx'
const OVERLAY = '../../../../src/client/canvas/card/card-overlay.tsx'
const STYLES = '../../../../src/client/ui/styles.ts'

/** 读尺寸的客户端文件（`card-size.ts` 自己是定义处，不在扫描范围）。 */
const READERS = [TILE, VIEW, EDGES, OVERLAY]

/**
 * 从 `styles.ts` 里取出某个类名的声明块。
 *
 * 样式表是模板字符串、声明块里没有嵌套大括号，所以 `选择器{...}` 这样切就够。
 * 类名要求紧跟 `{`：`.dsh-canvas-card-media` 不会误取到 `.dsh-canvas-card-media-audio`。
 * 还要求**锚在行首**：`.dsh-canvas-card.is-absent .dsh-canvas-card-preview{opacity:.35}`
 * 也以 `.dsh-canvas-card-preview{` 结尾，不锚就会取到那条修饰规则。
 */
function cssBlock(styles: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}\\{([^}]*)\\}`, 'm').exec(styles)?.[1] ?? ''
}

/**
 * 两张卡占的矩形是否相交（贴着不算）。
 *
 * 尺寸按**座位自己的比例**算：v1.80 起一张 9:16 的竖视频卡比 16:9 的图卡高一倍，用同一个
 * 尺寸去判重叠会放过「竖卡把自己的下半身让给了下一张」。
 */
function overlaps(left: Seat, right: Seat, cards: readonly SeatInput[]): boolean {
  const sizeOf = (seat: Seat): { width: number; height: number } =>
    sizeOfCard(cards.find((card) => card.id === seat.id) ?? {})
  const a = { ...left.position, ...sizeOf(left) }
  const b = { ...right.position, ...sizeOf(right) }
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function anyOverlap(seats: readonly Seat[], cards: readonly SeatInput[]): string[] {
  const hits: string[] = []
  for (let i = 0; i < seats.length; i += 1) {
    for (let j = i + 1; j < seats.length; j += 1) {
      if (overlaps(seats[i]!, seats[j]!, cards)) hits.push(`${seats[i]!.id} × ${seats[j]!.id}`)
    }
  }
  return hits
}

describe('一张卡占多大', () => {
  it('所有形态一档：400×252（图片、视频、文本、设计、应用、音频、不知道是啥，都一样）', () => {
    expect(CARD_WIDTH).toBe(400)
    expect(CARD_HEIGHT).toBe(252)
    expect(cardSizeOf()).toEqual({ width: 400, height: 252 })
  })

  it('尺寸不收形态——签名里没有 kind，「图片大、文本小」在类型上就写不出来', () => {
    // 函数声明的参数个数（`.length` 不含默认值与剩余参数）。传了 kind 就变成 1。
    expect(cardSizeOf.length).toBe(0)
    expect(cardPanelOf.length).toBe(0)
    // v1.77 那套「哪些形态放大」的名单必须连根拔掉：留着它，下一个人会以为还能分档。
    const source = read(SIZES)
    expect(source).not.toContain('LARGE_CARD')
    expect(source).not.toContain('isLargeCard')
  })

  it('卡面就是 16:9：一张 16:9 的图铺进去，上下左右都不留底色', () => {
    const panel = cardPanelOf()
    // 精度 2（容差 0.005）是**故意收紧**的：容差 0.05 时高度差 1px 照样绿——而那正好
    // 是用户说的「高度有空白区域」的量级（398×252 是 1.58:1，398×224 才是 16:9）。
    expect(panel.width / panel.height).toBeCloseTo(MEDIA_CARD_ASPECT, 2)
    // 面板必须是整数像素：半像素会在卡边上渲染出一条更浅的缝。
    expect(Number.isInteger(panel.height)).toBe(true)
    expect(panel).toEqual({ width: 398, height: 224 })
  })
})

describe('按产物比例坐（v1.80 / F3.11）', () => {
  it('宽不变、高按比例反推：1:1 是 400×426，9:16 是 400×736', () => {
    // 398（面板宽）÷ 1 = 398，+ 卡头 26 + 边框 2 = 426。
    expect(cardSizeFor(1)).toEqual({ width: 400, height: 426 })
    // 398 ÷ (9/16) = 707.6 → 708，+ 28 = 736。
    expect(cardSizeFor(9 / 16)).toEqual({ width: 400, height: 736 })
  })

  it('没量过比例（以及所有说不通的值）一律回到默认的 16:9', () => {
    for (const bad of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(cardSizeFor(bad)).toEqual({ width: 400, height: 252 })
    }
  })

  it('极端扁的比例不让面板塌成一条缝：面板有下限', () => {
    // 20:1 的横幅按比例只该有 20px 高——卡头比画面还高，那已经不是一张卡。
    expect(cardSizeFor(20).height).toBe(CARD_HEAD_HEIGHT + CARD_BORDER * 2 + 60)
  })

  it('sizeOfCard 读的是卡自己的 aspect——六处消费者该调的就是它', () => {
    expect(sizeOfCard({})).toEqual({ width: 400, height: 252 })
    expect(sizeOfCard({ aspect: 1 })).toEqual({ width: 400, height: 426 })
  })

  it('排位按各自的高度排：竖卡不会把自己的下半身让给下一张', () => {
    // **必须排成一列**才验得出来：网格默认两列，高卡与后面的卡虽然 y 挨得很近，x 不同
    // 就不会相交（第一版判据就是这么绿的，而代码已经错了）。`source-chain` 在没有引用
    // 时把全部卡放在 depth 0，即同一列竖排——这才是「按谁的步长往下走」真正生效的地方。
    // 两张高卡两张矮卡：不管排位怎么排，**总有一张高卡后面还跟着一张**——差值断言于是在
    // 任何顺序下都验得到「下一张是不是按前一张自己的高度往下走」。
    const cards: SeatInput[] = [
      { id: 'tall-a.png', aspect: 9 / 16, position: { x: 48, y: 170 } },
      { id: 'short-a.md', position: { x: 48, y: 170 } },
      { id: 'tall-b.png', aspect: 9 / 16, position: { x: 48, y: 170 } },
      { id: 'short-b.md', position: { x: 48, y: 170 } },
    ]
    const seats = arrangeSeats(cards, [], 'source-chain', 40)
    const byHeight = [...seats].sort((left, right) => left.position.y - right.position.y)
    for (let index = 1; index < byHeight.length; index += 1) {
      const above = byHeight[index - 1]!
      const below = byHeight[index]!
      const footprint = cardSizeFor(cards.find((card) => card.id === above.id)?.aspect)
      // 同列竖排：下一张的 y 就是上一张的底边 + gap，用的是**上一张自己的高**。
      expect(below.position.y - above.position.y, `${above.id} → ${below.id}`).toBe(footprint.height + 40)
    }
    expect(anyOverlap(seats, cards)).toEqual([])
  })
})

describe('排位不把卡叠在一起', () => {
  const board: SeatInput[] = [
    { id: 'note.md', kind: 'markdown' },
    { id: 'cover.png', kind: 'image' },
    { id: 'clip.mp4', kind: 'video' },
    { id: 'voice.mp3', kind: 'audio' },
    { id: 'page.html', kind: 'app' },
  ]

  it('网格：逐行按各自的宽、按行内最高的那张换行', () => {
    expect(anyOverlap(arrangeSeats(board, [], 'grid', 40), board)).toEqual([])
  })

  it('引用链：列宽取该列最宽的那张，行高按各自的高', () => {
    const seats = arrangeSeats(
      [
        { id: 'a.md', kind: 'markdown' },
        { id: 'b.png', kind: 'image' },
        { id: 'c.mp4', kind: 'video' },
        { id: 'd.md', kind: 'markdown' },
      ],
      [
        { id: 'e1', project: 'p', downstream: 'b.png', upstream: 'a.md', origin: 'manual' },
        { id: 'e2', project: 'p', downstream: 'd.md', upstream: 'b.png', origin: 'manual' },
        { id: 'e3', project: 'p', downstream: 'c.mp4', upstream: 'b.png', origin: 'manual' },
      ],
      'source-chain',
      40,
    )
    expect(anyOverlap(seats, board)).toEqual([])
  })

  it('整理：散卡落在链的最低边之下，不会被链上的卡盖住', () => {
    const cards: SeatInput[] = [
      { id: 'a.md', kind: 'markdown' },
      { id: 'b.png', kind: 'image' },
      { id: 'loose.md', kind: 'markdown' },
    ]
    const seats = arrangeSeats(
      cards,
      [{ id: 'e1', project: 'p', downstream: 'b.png', upstream: 'a.md', origin: 'manual' }],
      'organize',
      40,
    )
    const chain = seats.find((seat) => seat.id === 'b.png')!
    const loose = seats.find((seat) => seat.id === 'loose.md')!
    expect(loose.position.y).toBeGreaterThanOrEqual(chain.position.y + cardSizeOf().height)
    expect(anyOverlap(seats, cards)).toEqual([])
  })

  it('新卡落在最右一张的**右沿之外**，不是「最右那张的 x + 200」', () => {
    const seat = nextFreeSeat([{ id: 'cover.png', kind: 'image', position: { x: 100, y: 170 } }], 40)
    expect(seat.x).toBe(100 + 400 + 40)
  })
})

describe('尺寸接在真机上', () => {
  it('没有一处给 cardSizeOf 传 kind——传了在类型上就是错的', () => {
    for (const file of READERS) {
      // `cardSizeOf()` 后面紧跟右括号；`cardSizeOf(card.kind)` 会在这里被抓到。
      expect(read(file), file).not.toMatch(/cardSizeOf\([^)\s]/)
    }
  })

  it('卡片自己按尺寸设宽高——这是唯一的尺寸来源', () => {
    const tile = read(TILE)
    // v1.80 起卡面读的是**这张卡自己的**尺寸（量过比例就按比例），不是全局默认。
    expect(tile).toContain('sizeOfCard(card)')
    expect(tile).toMatch(/width: `\$\{size\.width\}px`/)
    expect(tile).toMatch(/height: `\$\{size\.height\}px`/)
  })

  it('命中矩形、取景、缩略图与新卡居中都不再用写死的 200 / 140', () => {
    const view = read(VIEW)
    expect(view).toContain('cardSizeOf()')
    // 从前这里抄过一份 `const CARD_W = 200`：两份数字迟早对不上。
    expect(view).not.toMatch(/const CARD_W\s*=/)
    expect(view).not.toMatch(/const CARD_H\s*=/)
  })

  it('引用线的锚点落在真实右沿：座位 + 这张卡自己的宽，不是卡的正中间', () => {
    const edges = read(EDGES)
    expect(edges).toMatch(/outAnchor\(upstream\.position, sizeOfCard\(upstream\)\)/)
    expect(edges).toMatch(/inAnchor\(downstream\.position, sizeOfCard\(downstream\)\)/)
    expect(edges).toMatch(/portAnchor\(start\.position, pending\.side, sizeOfCard\(start\)\)/)
  })

  it('控制带与工具条跟着卡心与下沿走', () => {
    const overlay = read(OVERLAY)
    expect(overlay).toContain('sizeOfCard(card)')
    expect(overlay).toContain('cardBox.width / 2')
    expect(overlay).toContain('cardBox.height + COMPOSER_GAP')
    // 从前那两个数是 200×140 的一半：`x + 100` 与 `y + 156`。
    expect(overlay).not.toContain('card.position.x + 100')
    expect(overlay).not.toContain('card.position.y + 156')
  })

  it('卡头与边框是拿样式表现算的：这两个数扣错了，16:9 的图就在卡面下方多一条空带', () => {
    const styles = read(STYLES)
    const head = cssBlock(styles, '.dsh-canvas-card-head')
    const name = cssBlock(styles, '.dsh-canvas-card-name')
    const card = cssBlock(styles, '.dsh-canvas-card')
    const pad = Number(/padding:(\d+)px/.exec(head)?.[1])
    const line = Number(/font:\d+ \d+px\/(\d+)px/.exec(name)?.[1])
    const border = Number(/border:(\d+)px solid/.exec(card)?.[1])
    // 三个数都得解析出来：解析失败是 NaN，下面的断言会以 NaN ≠ 26 报出来。
    expect([pad, line, border]).toEqual([5, 16, 1])
    expect(pad * 2 + line).toBe(CARD_HEAD_HEIGHT)
    expect(border).toBe(CARD_BORDER)
  })

  it('媒体卡面铺满预览面板：负边距抵掉内边距，16:9 才算得准', () => {
    const styles = read(STYLES)
    const preview = cssBlock(styles, '.dsh-canvas-card-preview')
    const media = cssBlock(styles, '.dsh-canvas-card-media')
    // 预览区左右各 10px、底 8px；媒体用 +20 / +8 与 -10 / -8 正好抵回去，盖住整个面板。
    expect(preview).toContain('padding:0 10px 8px')
    expect(media).toContain('width:calc(100% + 20px)')
    expect(media).toContain('height:calc(100% + 8px)')
    expect(media).toContain('margin:0 -10px -8px')
  })

  it('样式表里的兜底宽高也是 400×252——单独读那份 CSS 时不该看到两个数', () => {
    const card = cssBlock(read(STYLES), '.dsh-canvas-card')
    expect(card).toContain(`width:${CARD_WIDTH}px`)
    expect(card).toContain(`height:${CARD_HEIGHT}px`)
  })
})
