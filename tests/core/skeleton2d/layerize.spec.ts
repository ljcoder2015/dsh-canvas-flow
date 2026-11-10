/**
 * skeleton2d 的自动分层判据。
 *
 * 夹具是一张**画出来的人形**（圆头 + 方躯干 + 两条胳膊 + 两条腿），不是真图：
 * 判据要钉的是「剪影的宽度轮廓能不能切出六块、骨架是不是十根人骨」，不是某个画师
 * 的构图。画一张 120×200 的图，每个部位的位置都是写死的整数，期望值因此也能写死。
 */

import { describe, expect, it } from 'vitest'
import {
  decodeMask,
  encodeMask,
  layerize,
  maskAt,
  withRig,
  type RgbaImage,
} from '../../../src/core/skeleton2d/layerize.ts'
import { baseLayerGrid, poseGridAt } from '../../../src/core/skeleton2d/rig.ts'
import { normalizeSkeleton2dModel } from '../../../src/core/skeleton2d/model.ts'

const WIDTH = 120
const HEIGHT = 200

/** 一块空白画布（全透明）。 */
function blank(): RgbaImage {
  return { width: WIDTH, height: HEIGHT, data: new Uint8Array(WIDTH * HEIGHT * 4) }
}

/** 往图上填一块不透明矩形。 */
function fill(image: RgbaImage, left: number, top: number, right: number, bottom: number): void {
  for (let y = Math.max(0, top); y < Math.min(HEIGHT, bottom); y += 1) {
    for (let x = Math.max(0, left); x < Math.min(WIDTH, right); x += 1) {
      const at = (y * WIDTH + x) * 4
      image.data[at] = 200
      image.data[at + 1] = 160
      image.data[at + 2] = 140
      image.data[at + 3] = 255
    }
  }
}

/** 一个圆（头）。 */
function disc(image: RgbaImage, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > radius * radius) continue
      const at = (y * WIDTH + x) * 4
      image.data[at] = 200
      image.data[at + 1] = 160
      image.data[at + 2] = 140
      image.data[at + 3] = 255
    }
  }
}

/**
 * 人形：头（圆，y 22–58）、颈（y 55–62，明显比肩窄）、躯干（y 62–120）、
 * 两臂（顺着躯干两侧，y 66–118）、两腿（y 120–190，中间留 4px 缝）。
 */
function character(): RgbaImage {
  const image = blank()
  disc(image, 60, 40, 18)
  fill(image, 56, 55, 65, 62)
  fill(image, 42, 62, 79, 120)
  fill(image, 24, 66, 42, 118)
  fill(image, 79, 66, 97, 118)
  fill(image, 44, 120, 58, 190)
  fill(image, 62, 120, 76, 190)
  return image
}

describe('layerize：从一张人形图切出六层', () => {
  it('切出腿 / 臂 / 躯干 / 头六层，名字与绘制次序都是定值', () => {
    const result = layerize(character())
    expect(result).toBeDefined()
    expect(result?.layers.map((layer) => layer.name)).toEqual(['leg.l', 'leg.r', 'arm.l', 'arm.r', 'torso', 'head'])
  })

  it('头的矩形只圈住上面那一段，躯干的矩形从脖子到裆', () => {
    const result = layerize(character())
    const head = result?.layers.find((layer) => layer.name === 'head')
    const torso = result?.layers.find((layer) => layer.name === 'torso')
    expect(head).toBeDefined()
    expect(torso).toBeDefined()
    // 头在 y≈22–58（贴图高 200）：矩形的下沿不该越过躯干。
    expect((head?.rect.y ?? 1) * HEIGHT).toBeLessThan(30)
    expect(((head?.rect.y ?? 0) + (head?.rect.h ?? 0)) * HEIGHT).toBeLessThan(70)
    // 躯干下沿落在裆（y=120）附近，误差给两成身高。
    expect(Math.abs(((torso?.rect.y ?? 0) + (torso?.rect.h ?? 0)) * HEIGHT - 120)).toBeLessThan(HEIGHT * 0.2)
  })

  it('两腿各占一侧，中间那道缝把左右分开', () => {
    const result = layerize(character())
    const left = result?.layers.find((layer) => layer.name === 'leg.l')
    const right = result?.layers.find((layer) => layer.name === 'leg.r')
    expect(left).toBeDefined()
    expect(right).toBeDefined()
    expect((left?.pixel.x ?? 0) + (left?.pixel.w ?? 0)).toBeLessThanOrEqual(60)
    expect(right?.pixel.x ?? 0).toBeGreaterThanOrEqual(60)
  })

  it('掩码不是装饰：头那一层只覆盖圆里，躯干中缝不属于它', () => {
    const result = layerize(character())
    const head = result?.layers.find((layer) => layer.name === 'head')
    expect(head).toBeDefined()
    const bits = decodeMask(head?.mask, (head?.mw ?? 0) * (head?.mh ?? 0))
    // 圆顶正中是头，圆外的左下角不是。
    expect(maskAt(bits, head?.mw ?? 1, Math.floor((head?.mw ?? 1) / 2), 1)).toBe(true)
    expect(maskAt(bits, head?.mw ?? 1, 0, (head?.mh ?? 1) - 1)).toBe(false)
  })

  it('同一张图跑两次，产出的 JSON 逐字节相同（自动分层是确定的）', () => {
    const a = layerize(character())
    const b = layerize(character())
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('全透明的图分不出层——返回 undefined 而不是一层空壳', () => {
    expect(layerize(blank())).toBeUndefined()
  })
})

describe('layerize：十骨人体模板', () => {
  it('十二根骨，名字与父子关系按「根-脊-胸-头 + 两臂两腿各两段」摆', () => {
    const bones = layerize(character())?.bones ?? []
    expect(bones.map((bone) => bone.name)).toEqual([
      'root',
      'spine',
      'chest',
      'head',
      'arm.l.1',
      'arm.l.2',
      'arm.r.1',
      'arm.r.2',
      'leg.l.1',
      'leg.l.2',
      'leg.r.1',
      'leg.r.2',
    ])
    const parentOf = (name: string): string | undefined => bones.find((bone) => bone.name === name)?.parent
    expect(parentOf('spine')).toBe('root')
    expect(parentOf('chest')).toBe('spine')
    expect(parentOf('head')).toBe('chest')
    expect(parentOf('arm.l.2')).toBe('arm.l.1')
    expect(parentOf('arm.r.1')).toBe('chest')
    expect(parentOf('leg.l.2')).toBe('leg.l.1')
    expect(parentOf('leg.r.1')).toBe('root')
  })

  it('父级永远排在子级前面（归一按这个次序验环，次序错了整份模型会被拒）', () => {
    const bones = layerize(character())?.bones ?? []
    for (let index = 0; index < bones.length; index += 1) {
      const parent = bones[index]?.parent
      if (parent === undefined) continue
      expect(bones.findIndex((bone) => bone.name === parent)).toBeLessThan(index)
    }
  })

  it('关节落在连接处：根在躯干下部、头在躯干上部（不是层中心）', () => {
    const result = layerize(character())
    const bones = result?.bones ?? []
    const torso = result?.layers.find((layer) => layer.name === 'torso')
    const root = bones.find((bone) => bone.name === 'root')
    const chest = bones.find((bone) => bone.name === 'chest')
    expect(root?.y ?? 0).toBeGreaterThan((torso?.rect.y ?? 0) + (torso?.rect.h ?? 0) * 0.8)
    expect(chest?.y ?? 1).toBeLessThan((torso?.rect.y ?? 0) + (torso?.rect.h ?? 0) * 0.3)
  })

  it('默认待机给躯干与头铺了旋转曲线，四肢末端也各有一条', () => {
    const tracks = layerize(character())?.boneTracks ?? {}
    expect(Object.keys(tracks).sort()).toEqual(['arm.l.1', 'arm.l.2', 'arm.r.1', 'arm.r.2', 'chest', 'head', 'spine'])
    for (const track of Object.values(tracks)) expect((track.rot ?? []).length).toBe(2)
  })
})

describe('withRig：把分层装回模型', () => {
  const base = normalizeSkeleton2dModel({
    format: 'dsh-skeleton2d',
    texture: 'a.png',
    autoRig: true,
    prompt: 'x',
  })

  it('层、骨、轨道一齐换上，`autoRig` 标记摘掉、锚点落到脚底', () => {
    expect(base?.autoRig).toBe(true)
    const result = layerize(character())
    const next = withRig(base!, result!)
    expect(next.autoRig).toBeUndefined()
    expect(next.layers?.length).toBe(6)
    expect(next.bones?.length).toBe(12)
    expect(next.anchor).toEqual({ x: 0.5, y: 1 })
    // 层里的网格密度取默认值，掩码连栅格尺寸一起带过去。
    for (const layer of next.layers ?? []) {
      expect(layer.cols).toBeGreaterThan(1)
      expect(layer.mask).toBeDefined()
      expect(layer.mw).toBeGreaterThan(0)
    }
  })

  it('装回去的模型能被归一原样吃下（写出—读回是幂等的）', () => {
    const first = normalizeSkeleton2dModel(JSON.parse(JSON.stringify(withRig(base!, layerize(character())!))) as Record<string, unknown>)
    const second = normalizeSkeleton2dModel(JSON.parse(JSON.stringify(first)) as Record<string, unknown>)
    expect(first?.layers?.length).toBe(6)
    expect(second?.layers?.length).toBe(6)
    // 幂等：再读一遍不再变（字段次序由序列化统一，值一个都不许动）。
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})

describe('掩码与层内网格', () => {
  it('游程编码解回来与原文一致（含首段透明与整段不透明两种极端）', () => {
    expect(decodeMask('3,2,1', 6).join('')).toBe('000110')
    expect(decodeMask('', 3).join('')).toBe('000')
    expect(decodeMask('0,4', 4).join('')).toBe('1111')
    expect(encodeMask([0, 0, 1, 1, 0, 1])).toBe('2,2,1,1')
  })

  it('层内网格铺满层矩形：四个角与矩形四角重合', () => {
    const grid = baseLayerGrid({ x: 0.2, y: 0.1, w: 0.4, h: 0.5 }, 4, 2)
    expect(grid.length).toBe(5 * 3)
    expect(grid[0]?.su ?? 0).toBeCloseTo(0.2, 12)
    expect(grid[0]?.sv ?? 0).toBeCloseTo(0.1, 12)
    expect(grid[4]?.su ?? 0).toBeCloseTo(0.6, 12)
    expect(grid[4]?.sv ?? 0).toBeCloseTo(0.1, 12)
    expect(grid[grid.length - 1]?.su ?? 0).toBeCloseTo(0.6, 12)
    expect(grid[grid.length - 1]?.sv ?? 0).toBeCloseTo(0.6, 12)
  })

  it('层的骨骼子集真的收窄了权重：只绑 head 的层不受 arm 旋转影响', () => {
    const model = normalizeSkeleton2dModel({
      format: 'dsh-skeleton2d',
      texture: 'a.png',
      anchor: { x: 0, y: 0 },
      motions: {
        breath: { cycles: 0, amplitude: 0, phase: 0 },
        sway: { cycles: 0, amplitude: 0, phase: 0 },
        tilt: { cycles: 0, amplitude: 0, phase: 0 },
      },
      bones: [
        { name: 'head', x: 0.5, y: 0.2 },
        { name: 'arm', x: 0.5, y: 0.2 },
      ],
      boneTracks: { arm: { rot: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }] } },
      layers: [{ name: 'head', rect: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, cols: 2, rows: 2, bones: ['head'] }],
    })
    expect(model).toBeDefined()
    const layer = model!.layers![0]!
    const vertices = baseLayerGrid(layer.rect, layer.cols, layer.rows)
    poseGridAt(vertices, model!, 2.4, layer.cols, layer.rows, layer)
    // 只绑 head（没有轨道）⇒ 顶点纹丝不动；全身蒙皮时 arm 的旋转会把它推走。
    const still = vertices[0] as { su: number; sv: number; u: number; v: number }
    expect(still.u).toBeCloseTo(still.su, 12)
    expect(still.v).toBeCloseTo(still.sv, 12)
  })
})
