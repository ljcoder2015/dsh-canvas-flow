/**
 * 「按产物的真实宽高比坐」这条闭环的客户端一半（F2.7 / F3.11，v1.80）。
 *
 * `card-size.spec.ts` 验的是**算**：给定一个比例，卡片该多大。这份验的是**比例怎么来**——
 * 浏览器量一次（`naturalWidth` ／ `videoWidth`）、写回宿主（`card/setAspect`）、六处消费者
 * 才读得到同一个数。这一段全线在**浏览器里**：`Image` / `document.createElement('video')` /
 * React 的 `useEffect`，在 node 下跑不起来（也不该为了跑判据给它们套一层假 DOM——假对象
 * 会把真机上才有的失败放过去）。所以照本仓的既有做法：**读源码文本断言接线与守卫**。
 *
 * 四件事，各对应一种真实失败：
 *
 * 1. **量的是浏览器算好的数**：图片读 `naturalWidth/naturalHeight`、视频读
 *    `videoWidth/videoHeight`、音频不给值。读错了（比如拿 CSS 的 `width`）会得到一个
 *    与产物无关的比例，而且一声不响。
 * 2. **量不到就不写**：宽或高为 0（解码失败、`data:` 还没就绪）必须答 `undefined`，
 *    卡片退回默认 16:9，而不是按一个猜出来的比例把卡片拉变形。
 * 3. **只在真的变了才写**：这个 effect 每次板面刷新都会跑，没有阈值与「报过没有」的守卫，
 *    就会变成一个自己喂自己的循环（写 → 板面刷新 → 再写）。
 * 4. **接线**：`card-tile` 传的是六个真参数（尤其 `card.aspect` 是**已知值**，
 *    少了它这道阈值就永远成立）；`bridge → remote → typert → contract` 四处同名同参。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

const MEDIA = '../../../../src/client/canvas/card/card-media.ts'
const TILE = '../../../../src/client/canvas/card/card-tile.tsx'
const BRIDGE = '../../../../src/client/wire/bridge.ts'
const REMOTE = '../../../../src/client/wire/remote.ts'
const TYPERT = '../../../../src/typert.ts'
const CONTRACT = '../../../../src/contract.ts'

/** 把注释剥掉：注释里写着「不解析字节」「`videoWidth`」这类词，不能让它们当成代码证据。 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('量一份产物的真实宽高比', () => {
  const source = code(read(MEDIA))

  it('图片读 naturalWidth / naturalHeight，视频读 videoWidth / videoHeight', () => {
    expect(source).toMatch(/image\.naturalWidth,\s*image\.naturalHeight/)
    expect(source).toMatch(/video\.videoWidth,\s*video\.videoHeight/)
    // 视频必须先要元数据再谈尺寸：preload 不设 metadata，onloadedmetadata 可能永远不来。
    expect(source).toMatch(/video\.preload = 'metadata'/)
  })

  it('音频不给比例：它的卡面是一条播放条，没有「宽高比」这回事', () => {
    expect(source).toMatch(/face\.element === 'audio'\) return Promise\.resolve\(undefined\)/)
  })

  it('宽或高为 0 就是没量到——不拿它去算一个比例', () => {
    expect(source).toMatch(/width > 0 && height > 0 \? width \/ height : undefined/)
  })

  it('解码失败也答「没量到」，不是抛出去让卡片挂掉', () => {
    expect(source.match(/onerror = \(\) => resolve\(undefined\)/g)).toHaveLength(2)
  })
})

describe('报回宿主这件事要克制', () => {
  const source = code(read(MEDIA))

  it('差别小于 0.5% 就不写：否则板面每刷新一次就写一次，自己喂自己', () => {
    expect(source).toMatch(/ASPECT_EPSILON = 0\.005/)
    expect(source).toMatch(/Math\.abs\(aspect - known\) <= ASPECT_EPSILON\) return/)
  })

  it('阈值守卫在写入**之前**（顺序反了等于没守卫）', () => {
    const guard = source.indexOf('Math.abs(aspect - known) <= ASPECT_EPSILON')
    const write = source.indexOf('bridge.setAspect(')
    expect(guard).toBeGreaterThan(0)
    expect(write).toBeGreaterThan(guard)
  })

  it('同一张卡同一份载荷只量一次：记住 stamp，重渲染不再跑', () => {
    expect(source).toMatch(/const stamp = `\$\{cardId\}@/)
    expect(source).toMatch(/if \(reported\.current === stamp\) return/)
  })

  it('写失败安静放着：下一次加载会再试，不在卡面上挂错误', () => {
    expect(source).toMatch(/bridge\.setAspect\(projectId, cardId, aspect\)\.catch\(\(\) => undefined\)/)
  })
})

describe('接线：从卡面到宿主一条线', () => {
  it('card-tile 传齐六个参数——尤其最后一个 `card.aspect` 是「已知值」', () => {
    expect(code(read(TILE))).toMatch(
      /useAspectReport\(bridge, projectId, card\.id, media, mediaFace, card\.aspect\)/,
    )
  })

  it('量比例与读载荷用的是同一份 face 与 asset：卡面画什么，就量什么', () => {
    const tile = code(read(TILE))
    expect(tile).toMatch(/const mediaFace = mediaFaceOf\(kind\)/)
    expect(tile).toMatch(/const media = useMediaAsset\(bridge, projectId, card\.id, /)
  })

  it('四处同名：bridge 的转发名、remote 的成员与调用键、typert 的成员、contract 的 id', () => {
    const bridge = code(read(BRIDGE))
    expect(bridge).toMatch(/setAspect\(projectId: string, cardId: string, aspect: number\): Promise<BoardCard>/)
    // bridge 只转发到命名空间，方法与信号的顺序在这里定死：漏 `signal` 会让取消失效。
    expect(bridge).toMatch(/this\.card\.setAspect\(projectId, cardId, aspect, this\.signal\)/)
    // remote 的一侧是「成员 + 调用键」两半：只加成员不挂键，调用时会是 undefined 而不是报错。
    expect(code(read(REMOTE))).toMatch(
      /setAspect\(projectId: string, cardId: string, aspect: number, signal\?: AbortSignal\): Promise<RemoteResult<BoardCard>>/,
    )
    expect(code(read(REMOTE))).toMatch(/'card\/setAspect': CardFace\['setAspect'\]/)
    expect(code(read(TYPERT))).toMatch(/member\('setAspect'/)
    expect(code(read(CONTRACT))).toMatch(/id: 'dsh-canvas-flow#card\/set_aspect'/)
  })

  it('参数里带的是卡片 id 与比例，没有把「哪张卡」漏成一个空参', () => {
    expect(code(read(CONTRACT))).toMatch(/method: 'setAspect',[\s\S]{0,160}P\.aspect/)
  })
})
