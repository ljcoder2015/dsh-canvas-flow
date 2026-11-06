/**
 * 设计文档的图片字节（v1.96 图片图层）。
 *
 * 钉三件事：**base64 编解码**（分块纪律、大块数组不撞栈）、**信封的 images 格**
 * （没图 = 旧信封形状逐字节不变；有图 = round-trip 后字节与引用它的填充都在）、
 * **坏条目的诚实降级**（个别条目坏了跳过那一张，不拖死整份文档）。
 */
import { describe, expect, it } from 'vitest'
import {
  DESIGN_FILE_PREFIX,
  DESIGN_FILE_VERSION,
  decodeDesignFile,
  encodeDesignFile,
  scaffoldDesignDocument,
} from '../../../../src/core/artifact/design/document.ts'
import { base64ToBytes, bytesToBase64 } from '../../../../src/core/artifact/design/image-bytes.ts'

describe('image-bytes', () => {
  it('round-trips bytes through base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('round-trips a block larger than the encode chunk (0x8000)', () => {
    // 一次 String.fromCharCode(...bytes) 在这一档会撞调用栈上限——分块就是为它立的。
    const bytes = new Uint8Array(0x8000 + 17)
    for (let at = 0; at < bytes.length; at += 1) bytes[at] = at % 251
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})

describe('design envelope image store', () => {
  it('keeps the old envelope shape byte-identical when no images are stored', () => {
    const graph = scaffoldDesignDocument()
    const text = encodeDesignFile(graph)
    expect(text.startsWith(`${DESIGN_FILE_PREFIX}${DESIGN_FILE_VERSION}\n`)).toBe(true)
    const body = JSON.parse(text.split('\n')[1] ?? '{}') as Record<string, unknown>
    expect('images' in body).toBe(false)
  })

  it('round-trips stored images and the fills that reference them', () => {
    const graph = scaffoldDesignDocument()
    const page = graph.getPages()[0]
    if (page === undefined) throw new Error('scaffold produced no page')
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    const hash = 'img-hash-1'
    graph.images.set(hash, bytes)
    graph.createNode('RECTANGLE', page.id, {
      name: '图 1',
      x: 10,
      y: 20,
      width: 300,
      height: 200,
      fills: [{ type: 'IMAGE', imageHash: hash, imageScaleMode: 'FILL', color: { r: 0, g: 0, b: 0, a: 0 }, opacity: 1, visible: true }],
    })

    const revived = decodeDesignFile(encodeDesignFile(graph))
    expect(revived.images.get(hash)).toEqual(bytes)
    // 引用这张图的填充也活着：图层画得出来的前提是 hash 对得上字节表。
    const layers = revived.getChildren(revived.getPages()[0]?.id ?? '')
    const imageLayer = layers.find((node) => node.name === '图 1')
    expect(imageLayer?.fills[0]?.type).toBe('IMAGE')
    expect(imageLayer?.fills[0]?.imageHash).toBe(hash)
  })

  it('skips malformed entries instead of refusing the whole document', () => {
    const graph = scaffoldDesignDocument()
    const good = new Uint8Array([9, 8, 7])
    graph.images.set('good', good)
    graph.images.set('broken', new Uint8Array([1]))
    const text = encodeDesignFile(graph)
    const [header, body] = text.split('\n')
    const snapshot = JSON.parse(body ?? '{}') as { images: { hash: string; data: string }[] }
    // 一条好、一条坏（base64 解不开）：解码只跳过坏的那条。
    snapshot.images = [
      snapshot.images.find((entry) => entry.hash === 'good') ?? { hash: '', data: '' },
      { hash: 'broken', data: '!!!not base64!!!' },
      { hash: 42 as unknown as string, data: 'aGk=' },
    ]
    const revived = decodeDesignFile(`${header}\n${JSON.stringify(snapshot)}`)
    expect(revived.images.get('good')).toEqual(good)
    expect(revived.images.has('broken')).toBe(false)
  })

  it('refuses a non-array image table as a broken snapshot', () => {
    const graph = scaffoldDesignDocument()
    const text = encodeDesignFile(graph)
    const [header, body] = text.split('\n')
    const snapshot = JSON.parse(body ?? '{}') as Record<string, unknown>
    snapshot.images = 'nope'
    expect(() => decodeDesignFile(`${header}\n${JSON.stringify(snapshot)}`)).toThrow()
  })
})

describe('design image layers on the headless editor (node, honest skip)', () => {
  it('answers an empty list when nothing can be decoded instead of throwing', async () => {
    const { createDesignEngine } = await import(
      '../../../../src/client/artifact/viewers/design/design-engine.ts'
    )
    const envelope = encodeDesignFile(scaffoldDesignDocument())
    const outcome = await createDesignEngine({
      twoD: {} as never,
      gl: {} as never,
      runtime: null,
      envelope,
      onRepaint: () => {},
    })
    if (outcome.kind !== 'ready') throw new Error(`engine did not come up: ${outcome.message}`)
    // node 没有浏览器的 createImageBitmap：位图解不出尺寸就跳过——「一张都没落上」
    // 是答案，不是异常。判据钉的是这个诚实空，而不是抛错。
    const created = await outcome.engine.addImageLayers(
      [new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })],
      { x: 0, y: 0 },
    )
    expect(created).toEqual([])
    outcome.engine.dispose()
  })
})
