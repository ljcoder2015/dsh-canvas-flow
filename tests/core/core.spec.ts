/**
 * The pure layer: seating, source-edge rules, kind detection, identities.
 *
 * Nothing here needs a Cordis container, which is the point — a board bug is a
 * geometry or a graph bug, and both are cheap to pin down exactly.
 */
import { describe, expect, it } from 'vitest'
import { CARD_HEIGHT, CARD_WIDTH, arrangeSeats, depthsOf, nextFreeSeat } from '../../src/core/canvas/board/board.ts'
import { projectIdOf, shortDigest, slugify } from '../../src/core/canvas/card/ids.ts'
import {
  BUILTIN_KINDS,
  DESIGN_KINDS,
  HTML_KINDS,
  detectKind,
  digestOf,
  isBundleKind,
  isDesignKind,
  isHtmlKind,
  kindById,
  kindLabel,
  kindSupportsExport,
  outlineOf,
  resolveKindId,
} from '../../src/core/artifact/kind/kind-registry.ts'
import {
  materialUpstreams,
  reconcileEdges,
  referencedPaths,
  sourceIdOf,
  transitiveUpstreams,
  validateEdge,
} from '../../src/core/canvas/board/source-store.ts'
import type { CardId, Source } from '../../src/types.ts'

/** One edge, as the store keeps it. */
const edge = (downstream: CardId, upstream: CardId, project = 'p1'): Source => ({
  id: sourceIdOf(downstream, upstream),
  project,
  downstream,
  upstream,
  origin: 'manual',
})

describe('board seating', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('lays a plain grid in reading order', () => {
    const seats = arrangeSeats(cards, [], 'grid', 40)
    expect(seats.map((seat) => seat.id)).toEqual(['a', 'b', 'c'])
    expect(seats[1]?.position.x).toBe(seats[0]!.position.x + CARD_WIDTH + 40)
    expect(seats[2]?.position.y).toBe(seats[0]!.position.y + CARD_HEIGHT + 40)
  })

  it('places every card one column right of the deepest material', () => {
    const edges = [edge('b', 'a'), edge('c', 'b')]
    const depths = depthsOf(cards, edges)
    expect(depths.get('a')).toBe(0)
    expect(depths.get('b')).toBe(1)
    expect(depths.get('c')).toBe(2)

    const seats = arrangeSeats(cards, edges, 'source-chain', 40)
    const byId = new Map(seats.map((seat) => [seat.id, seat.position]))
    expect(byId.get('b')!.x).toBe(byId.get('a')!.x + CARD_WIDTH + 40)
    expect(byId.get('c')!.x).toBe(byId.get('b')!.x + CARD_WIDTH + 40)
  })

  it('keeps the furthest material as the depth when a card has several parents', () => {
    const edges = [edge('b', 'a'), edge('c', 'b'), edge('c', 'a')]
    expect(depthsOf(cards, edges).get('c')).toBe(2)
  })

  it('does not hang on a cycle in a corrupted record', () => {
    const edges = [edge('a', 'b'), edge('b', 'a')]
    const depths = depthsOf(cards, edges)
    expect(depths.get('a')).toBeTypeOf('number')
    expect(depths.get('b')).toBeTypeOf('number')
  })

  it('packs cards with no edges below the chain when organizing', () => {
    const edges = [edge('b', 'a')]
    const seats = arrangeSeats(cards, edges, 'organize', 40)
    const loose = seats.find((seat) => seat.id === 'c')!
    const chained = seats.find((seat) => seat.id === 'a')!
    expect(loose.position.y).toBeGreaterThan(chained.position.y)
    expect(loose.position.x).toBe(chained.position.x)
  })

  it('parks a new card clear of the right-most one', () => {
    const seat = nextFreeSeat([{ id: 'a', position: { x: 100, y: 200 } }], 40)
    expect(seat.x).toBe(100 + CARD_WIDTH + 40)
    expect(seat.y).toBe(200)
  })

  it('is idempotent: arranging an arranged board changes nothing', () => {
    const edges = [edge('b', 'a')]
    const once = arrangeSeats(cards, edges, 'source-chain', 40)
    const twice = arrangeSeats(
      once.map((seat) => ({ id: seat.id, position: seat.position })),
      edges,
      'source-chain',
      40,
    )
    expect(twice).toEqual(once)
  })
})

describe('source edges', () => {
  const known = ['a', 'b', 'c']

  it('refuses a self edge', () => {
    expect(validateEdge({ downstream: 'a', upstream: 'a' }, known, [])).toEqual({ ok: false, reason: 'self' })
  })

  it('refuses a card that is not on the board', () => {
    expect(validateEdge({ downstream: 'a', upstream: 'ghost' }, known, [])).toEqual({
      ok: false,
      reason: 'unknown-card',
    })
  })

  it('refuses a duplicate of an existing edge', () => {
    expect(validateEdge({ downstream: 'b', upstream: 'a' }, known, [edge('b', 'a')])).toEqual({
      ok: false,
      reason: 'duplicate',
    })
  })

  it('refuses an edge that would close a cycle', () => {
    expect(validateEdge({ downstream: 'a', upstream: 'c' }, known, [edge('b', 'a'), edge('c', 'b')])).toEqual({
      ok: false,
      reason: 'cycle',
    })
  })

  it('accepts a lawful edge', () => {
    expect(validateEdge({ downstream: 'c', upstream: 'a' }, known, [edge('b', 'a')])).toEqual({ ok: true })
  })

  it('walks the upstream chain nearest first and stops at the configured depth', () => {
    const edges = [edge('b', 'a'), edge('c', 'b'), edge('d', 'c')]
    const wide = transitiveUpstreams('d', edges, 8)
    expect(wide.direct).toEqual(['c'])
    expect(wide.indirect).toEqual(['b', 'a'])

    const shallow = transitiveUpstreams('d', edges, 1)
    expect(shallow.direct).toEqual(['c'])
    expect(shallow.indirect).toEqual([])
  })

  it('keeps material to one hop, however deep the chain behind it runs', () => {
    // The rule the prompt, the digests and the file references all share: a
    // card's material is its own edges. `transitiveUpstreams` is the *view*
    // question and answers differently on the same graph — that difference is
    // the point, so both are asserted side by side.
    const edges = [edge('b', 'a'), edge('c', 'b'), edge('d', 'c')]
    expect(materialUpstreams('d', edges)).toEqual(['c'])
    expect(transitiveUpstreams('d', edges, 8).indirect).toEqual(['b', 'a'])

    // Several parents are all still one hop, and order follows the edges.
    const forked = [edge('d', 'c'), edge('d', 'a')]
    expect(materialUpstreams('d', forked)).toEqual(['c', 'a'])

    expect(materialUpstreams('a', edges)).toEqual([])
  })

  it('lists downstream cards from the upstream side', () => {
    const edges = [edge('b', 'a'), edge('c', 'a')]
    expect(edges.filter((item) => item.upstream === 'a').map((item) => item.downstream)).toEqual(['b', 'c'])
  })

  it('derives an idempotent storage id', () => {
    expect(sourceIdOf('deck.html', 'brief.md')).toBe(sourceIdOf('deck.html', 'brief.md'))
    expect(sourceIdOf('deck.html', 'brief.md')).not.toBe(sourceIdOf('brief.md', 'deck.html'))
  })

  it('reconciles only references that resolve to a seated card, and never removes', () => {
    const existing = [edge('b', 'a')]
    const added = reconcileEdges('c', ['a', 'ghost', 'c'], known, existing)
    expect(added).toEqual([{ downstream: 'c', upstream: 'a' }])
  })

  it('extracts references that could imply an edge, ignoring absolute and inline URLs', () => {
    const html = referencedPaths('app', '<img src="cover.png"><a href="https://x.dev/y.md">y</a><i src="data:image/png;base64,AA">', 'html')
    expect(html).toContain('cover.png')
    expect(html.some((value) => value.startsWith('https'))).toBe(false)
    expect(html.some((value) => value.startsWith('data:'))).toBe(false)

    expect(referencedPaths('markdown', 'see [brief](notes/brief.md#top) and ![c](c.png)', 'md')).toEqual([
      'notes/brief.md',
      'c.png',
    ])
  })
})

describe('kind registry', () => {
  const probe = (over: Partial<Parameters<typeof detectKind>[0]>) => ({
    path: '',
    directory: false,
    basename: '',
    extension: '',
    head: '',
    children: [],
    ...over,
  })

  it('any html page is an app, whatever its markup', () => {
    // 归并后幻灯片标记、普通页面都是 app——head 嗅探（slide/reveal）已废除。
    expect(detectKind(probe({ path: 'd.html', basename: 'd.html', extension: 'html', head: '<section class="slide">' }))).toBe('app')
    expect(detectKind(probe({ path: 'p.html', basename: 'p.html', extension: 'html', head: '<p>plain</p>' }))).toBe('app')
  })

  it('prefers app over folder for a directory with an entry point', () => {
    expect(detectKind(probe({ path: 'site', directory: true, children: ['index.html', 'a.css'] }))).toBe('app')
    expect(detectKind(probe({ path: 'site', directory: true, children: ['a.css'] }))).toBe('folder')
  })

  it('falls back to a generic file rather than guessing', () => {
    expect(detectKind(probe({ path: 'x.bin', basename: 'x.bin', extension: 'bin' }))).toBe('file')
  })

  /**
   * 两份手抄的 kind 清单会漂移，而漏掉一个的后果就是 HTML 卡片丢样式：
   * host 不内联它的本地样式表，srcdoc 里 `styles.css` 又无处解析。所以清单
   * 只有一份，且只列真实存在的 kind —— 拼错一个 id 也会在这里被抓住。
   */
  it('lists exactly the kinds whose artifact is one HTML page', () => {
    for (const kind of HTML_KINDS) {
      expect(BUILTIN_KINDS.some((entry) => entry.id === kind)).toBe(true)
      expect(isHtmlKind(kind)).toBe(true)
    }
    expect(HTML_KINDS).toEqual(['app'])
    // 老板上的记录盖着归并前的章：读侧折算到 app，标签与导出对老卡照常成立。
    expect(kindById('webapp')?.id).toBe('app')
    expect(kindLabel('site')).toBe('应用')
    expect(kindSupportsExport('html-deck', 'pdf')).toBe(true)
    for (const kind of ['markdown', 'image', 'video', 'data', 'folder', 'file', '']) {
      expect(isHtmlKind(kind)).toBe(false)
    }
  })

  /**
   * 归并前的老 id 在**集合判据**上也必须是今天那个样子（v1.59）。
   *
   * 这一条不是洁癖：`kindById` 折算而 `isBundleKind` 不折算，同一个函数里就有了两种
   * 「kind」（`export-plan.ts` 里正是这个形状）。老应用卡（`webapp`）于是掉到部署那条
   * 导出线上——一条在没有 `dsh-canvas.capabilities` 的部署上**点了什么都不发生**的路，
   * 而 v1.58 花了一整版才把它绕开。
   */
  it('归并前的老 id 在集合判据上也是它归并后的那一个', () => {
    for (const legacy of ['webapp', 'site', 'html-deck']) {
      expect(resolveKindId(legacy), legacy).toBe('app')
      expect(isHtmlKind(legacy), legacy).toBe(true)
      expect(isBundleKind(legacy), legacy).toBe(true)
    }
    // 没被归并、也没注册过的 id 原样返回：部署自己加的形态照旧指认得出来。
    expect(resolveKindId('design')).toBe('design')
    expect(resolveKindId('nothing-registered')).toBe('nothing-registered')
  })

  /** 设计稿（F10.1，v1.59）：导出＝**在浏览器里把它画出来**，不是打包，也不问部署。 */
  it('设计稿是「在浏览器里画出来」的那一种形态，且不动部署那条线的格式表', () => {
    expect(DESIGN_KINDS).toEqual(['design'])
    expect(isDesignKind('design')).toBe(true)
    for (const kind of ['app', 'markdown', 'image', 'video', 'data', 'folder', 'file']) {
      expect(isDesignKind(kind), kind).toBe(false)
    }
    // 那四样出路（fig / png / pdf / pptx）部署一个都做不到，所以不进 `exportFormats`——
    // 往里塞一个部署永远实现不了的格式，只会换来一条必然失败的请求。
    expect(kindById('design')?.exportFormats).toEqual(['png'])
  })

  it('keeps every built-in kind addressable and exporting only what it can', () => {
    for (const definition of BUILTIN_KINDS) {
      expect(definition.id).toBe(definition.id.trim())
      expect(definition.label.length).toBeGreaterThan(0)
    }
    expect(kindSupportsExport('app', 'pdf')).toBe(true)
    expect(kindSupportsExport('video', 'pdf')).toBe(false)
  })

  it('outlines structure instead of pasting the artifact', () => {
    const markdown = '# Title\n\ntext\n\n## Part\n\n### Deep\n'
    expect(outlineOf('markdown', markdown)).toEqual(['Title', 'Part', 'Deep'])
    expect(outlineOf('data', 'a,b,c\n1,2,3')).toEqual(['a', 'b', 'c'])
    expect(outlineOf('image', 'binary')).toEqual([])
  })

  it('honours the digest budget and says when it truncated', () => {
    const digest = digestOf('markdown', '# A\n'.repeat(50), 40)
    expect(digest).toContain('结构：A')
    expect(digest).toContain('已截断')
  })
})

describe('identities', () => {
  it('is deterministic and stable across trailing slashes', () => {
    expect(projectIdOf('/tmp/deck')).toBe(projectIdOf('/tmp/deck/'))
  })

  it('distinguishes two same-named roots', () => {
    expect(projectIdOf('/a/deck')).not.toBe(projectIdOf('/b/deck'))
  })

  it('keeps the slug readable and bounded', () => {
    expect(slugify('我的 画布 / Deck')).toBe('我的-画布-deck')
    expect(slugify('!!!').length).toBeGreaterThan(0)
    expect(slugify('x'.repeat(120)).length).toBeLessThanOrEqual(40)
    expect(shortDigest('a')).not.toBe(shortDigest('b'))
  })
})
