/**
 * 媒体预览器与「谁画哪个 kind」那张表（F2.7）。
 *
 * 两半各验各的，因为它们各自的失败不一样：
 *
 * - **注册项**（本文件直接 import `media-viewer.tsx`）：三种媒体各认领自己的 kind，
 *   id 互不相同。写错一个 kind 的后果是那张卡落到兜底的文本预览器上——一段音频被当文本
 *   读，画面上是乱码，但没有任何一层报错。
 * - **表的接线**（读 `registry.ts` 的源码文本）：预览器写好了却没进表，等于没写。这条
 *   用源码文本判，与项目里 `card-export.spec.ts` / `card-rename.spec.ts` 对 jsx 接线的
 *   既有做法一致——**不 import** 注册表本身，因为它会把设计预览器那一串宿主 UI 原语拖进来，
 *   而单测在 node 下碰到那些会死于 `clsx`。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { audioViewer, imageViewer, videoViewer } from '../../../../src/client/artifact/viewers/media-viewer.tsx'
import { MEDIA_KINDS } from '../../../../src/core/artifact/kind/kind-registry.ts'

const REGISTRY = readFileSync(new URL('../../../../src/client/artifact/registry.ts', import.meta.url), 'utf8')

describe('the three media viewers', () => {
  it('claims exactly one kind each, and they are the three media kinds', () => {
    for (const entry of [imageViewer, videoViewer, audioViewer]) {
      const claimed = MEDIA_KINDS.filter((kind) => entry.claims(kind))
      expect(claimed).toEqual([entry.id === 'image' ? 'image' : entry.id === 'video' ? 'video' : 'audio'])
    }
  })

  it('keeps audio apart from the other two', () => {
    expect(audioViewer.claims('audio')).toBe(true)
    expect(audioViewer.claims('video')).toBe(false)
    expect(audioViewer.claims('image')).toBe(false)
    expect(videoViewer.claims('audio')).toBe(false)
  })

  it('does not claim a kind that is not media', () => {
    for (const entry of [imageViewer, videoViewer, audioViewer]) {
      for (const kind of ['markdown', 'app', 'design', 'data', 'file', 'folder']) {
        expect(entry.claims(kind)).toBe(false)
      }
    }
  })

  it('uses distinct ids', () => {
    const ids = [imageViewer.id, videoViewer.id, audioViewer.id]
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('the viewer registry wires all three', () => {
  it('imports the audio viewer from the media viewer module', () => {
    // `audioViewer` 与另外两个住在同一个模块里，所以这一行 import 是它们共同的门。
    expect(REGISTRY).toMatch(/import\s*\{[^}]*\baudioViewer\b[^}]*\}\s*from\s*'\.\/viewers\/media-viewer\.tsx'/)
  })

  it('lists every media viewer in the registry table', () => {
    const table = REGISTRY.slice(REGISTRY.indexOf('VIEWER_REGISTRY'))
    for (const name of ['imageViewer', 'videoViewer', 'audioViewer']) {
      expect(table).toContain(name)
    }
  })
})
