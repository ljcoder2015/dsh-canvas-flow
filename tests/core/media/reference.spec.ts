/**
 * 「引用进来的那张图」怎么变成生成请求里的参考图（F2.7 / F4.1，v1.74）。
 *
 * 这条判据守的是一个**自动判断**：画布上连了一条边，就该把它喂给生成——而自动判断最容易
 * 安静地做错。四个岔口各有一条判据：
 *
 * 1. 上游不止一张时取哪张（**第一条能用的**，不是第一条）；
 * 2. 上游是视频 / 音频时不能硬塞（不是图片就跳过，继续找）；
 * 3. 边的方向（只有 `downstream` 是这张卡才算——反向引用不是「我引用了它」）；
 * 4. 点名了一张不能用的（**要能说出为什么**，而不是退回「就当没有」）。
 *
 * 第 4 条尤其要紧：引用了却没喂进去，用户会以为「模型没照我的图来」，而真正发生的是
 * 一次安静的丢弃。
 */
import { describe, expect, it } from 'vitest'
import { referenceFor, referenceNote } from '../../../src/core/media/reference.ts'
import type { ReferenceCardShape, ReferenceEdgeShape } from '../../../src/core/media/reference.ts'

const cards: readonly ReferenceCardShape[] = [
  { id: 'img1', file: '图片.png', kind: 'image' },
  { id: 'vid1', file: '片段.mp4', kind: 'video' },
  { id: 'aud1', file: '配音.mp3', kind: 'audio' },
  { id: 'doc1', file: '说明.md', kind: 'markdown' },
  { id: 'img2', file: '参考.webp', kind: 'image' },
]

/** 一张下游视频卡，引用了若干上游。 */
function edges(...upstreams: string[]): readonly ReferenceEdgeShape[] {
  return upstreams.map((upstream) => ({ upstream, downstream: 'target' }))
}

describe('自动挑参考图', () => {
  it('取第一条上游里**能用的**那张图，不是第一条上游', () => {
    // 这段视频先引用了配音、再引用了图片：跳过音频，用那张图。
    expect(referenceFor(cards, edges('aud1', 'img1'), 'target')).toEqual({
      status: 'found',
      cardId: 'img1',
      file: '图片.png',
    })
  })

  it('上游是视频 / 文本时一律跳过，继续往后找', () => {
    expect(referenceFor(cards, edges('vid1', 'doc1', 'img2'), 'target')).toMatchObject({
      status: 'found',
      cardId: 'img2',
    })
  })

  it('一条能用的都没有就是没有——不退回第一张、不猜', () => {
    expect(referenceFor(cards, edges('vid1', 'aud1'), 'target')).toEqual({ status: 'none' })
    expect(referenceFor(cards, [], 'target')).toEqual({ status: 'none' })
  })

  it('只看「引用进这张卡」的边，反向与本卡自连都不算', () => {
    const reversed: readonly ReferenceEdgeShape[] = [
      { upstream: 'target', downstream: 'img1' },
      { upstream: 'img1', downstream: 'img1' },
    ]
    expect(referenceFor(cards, reversed, 'target')).toEqual({ status: 'none' })
  })

  it('引用了画布上已经没有的卡片时跳过（记录与文件不一定同步）', () => {
    expect(referenceFor(cards, edges('ghost', 'img1'), 'target')).toMatchObject({ cardId: 'img1' })
  })
})

describe('点名要用的那张', () => {
  it('点名压过自动挑选，哪怕它不在引用里', () => {
    expect(referenceFor(cards, edges('img1'), 'target', 'img2')).toEqual({
      status: 'found',
      cardId: 'img2',
      file: '参考.webp',
    })
  })

  it('点名了一张不是图片的卡：说清楚是什么形态，而不是「就当没有」', () => {
    const lookup = referenceFor(cards, edges('img1'), 'target', 'vid1')
    expect(lookup).toEqual({ status: 'not-image', cardId: 'vid1', kind: 'video' })
    // 这句话必须同时说出是哪张卡、它是什么——缺一件用户就得去猜。
    expect(referenceNote(lookup)).toContain('vid1')
    expect(referenceNote(lookup)).toContain('video')
  })

  it('点了不存在的卡片，与「没有引用」同等对待（都不是错误）', () => {
    expect(referenceFor(cards, edges('img1'), 'target', 'ghost')).toEqual({ status: 'none' })
  })

  it('空白字符串等于没点名', () => {
    expect(referenceFor(cards, edges('img1'), 'target', '   ')).toMatchObject({ cardId: 'img1' })
  })
})

describe('给 agent 的那句话', () => {
  it('正常挑到、或本来就没有引用时，什么都不说', () => {
    expect(referenceNote({ status: 'none' })).toBeUndefined()
    expect(referenceNote({ status: 'found', cardId: 'img1', file: '图片.png' })).toBeUndefined()
  })
})
