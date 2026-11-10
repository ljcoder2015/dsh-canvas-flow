/**
 * dsh-canvas — live2d-lite 变形数学的判据。
 *
 * 钉三件事：
 * 1. **无缝循环是数学性质**：`t + loop` 处的网格与 `t` 处逐位相同——导出帧序列没有
 *    补间收尾可依赖，这条性质破了，导出的循环就有跳变；
 * 2. **权重分布**：锚点不动、离锚越远动得越多（人物贴图锚在脚底，脚下站得稳）；
 * 3. **两处消费同一份算术**：`poseGridAt`（逐顶点、原地改）与 `poseAt`（单点、分配）
 *    是同一个函数的两种调用形状，结果必须一致。
 */
import { describe, expect, it } from 'vitest'
import {
  GRID_COLS,
  GRID_ROWS,
  baseGrid,
  gridIndices,
  motionValueAt,
  poseAt,
  poseGridAt,
  sampleKeys,
  vertexWeight,
} from '../../../src/core/live2d/rig.ts'
import { LIVE2D_FORMAT, normalizeLive2dModel, type Live2dModel, type Live2dMotion } from '../../../src/core/live2d/model.ts'

const MODEL: Live2dModel = normalizeLive2dModel({
  format: LIVE2D_FORMAT,
  texture: '少女.png',
  motions: {
    breath: { cycles: 2, amplitude: 0.02, phase: 0 },
    sway: { cycles: 1, amplitude: 0.01, phase: 0 },
    tilt: { cycles: 1, amplitude: 0.01, phase: 0.25 },
  },
})!

describe('网格', () => {
  it('密度是 24×24 个格胞，顶点数是 (rows+1)×(cols+1)', () => {
    expect(baseGrid()).toHaveLength((GRID_ROWS + 1) * (GRID_COLS + 1))
  })

  it('三角索引覆盖每个格胞两个三角形，且不越界', () => {
    const indices = gridIndices()
    expect(indices.length).toBe(GRID_COLS * GRID_ROWS * 6)
    const vertices = (GRID_ROWS + 1) * (GRID_COLS + 1)
    for (const index of indices) {
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(vertices)
    }
  })
})

describe('无缝循环', () => {
  it('`t + loop` 处的网格与 `t` 处重合到 1e-12 以内——导出帧序列因此没有循环跳变', () => {
    // 数学上逐位相同（整数拍 + 正弦的周期性）；浮点在 `t + loop` 的加法上会引入
    // 1e-16 量级的误差，所以这里按 1e-12 收——比任何可见像素小九个数量级。
    const a = baseGrid()
    const b = baseGrid()
    poseGridAt(a, MODEL, 1.234)
    poseGridAt(b, MODEL, 1.234 + MODEL.loop)
    expect(b.length).toBe(a.length)
    for (let index = 0; index < a.length; index += 1) {
      expect(b[index]!.u).toBeCloseTo(a[index]!.u, 12)
      expect(b[index]!.v).toBeCloseTo(a[index]!.v, 12)
    }
  })

  it('循环内的两处不同时刻给出不同的形状（动画是真的在动）', () => {
    const a = baseGrid()
    const b = baseGrid()
    poseGridAt(a, MODEL, 0)
    poseGridAt(b, MODEL, MODEL.loop / 4)
    expect(b).not.toEqual(a)
  })

  it('t=0 时相位为零的动作位移为零（tilt 带 0.25 相位，单独一个模型验它）', () => {
    const noTilt: Live2dModel = normalizeLive2dModel({
      format: LIVE2D_FORMAT,
      texture: '少女.png',
      motions: {
        breath: { cycles: 2, amplitude: 0.02, phase: 0 },
        sway: { cycles: 1, amplitude: 0.01, phase: 0 },
        tilt: { cycles: 1, amplitude: 0, phase: 0 },
      },
    })!
    const posed = baseGrid()
    poseGridAt(posed, noTilt, 0)
    const base = baseGrid()
    // breath / sway 的相位是 0，t=0 正弦为零，网格逐位还原——这就是「循环起点」。
    expect(posed).toEqual(base)
  })
})

describe('权重分布', () => {
  it('锚点处权重为 0，离锚点越远权重越大', () => {
    expect(vertexWeight(1, 1)).toBe(0)
    expect(vertexWeight(0.5, 1)).toBeGreaterThan(vertexWeight(0.8, 1))
    expect(vertexWeight(0, 1)).toBeGreaterThan(vertexWeight(0.5, 1))
  })
})

describe('两处消费同一份算术', () => {
  it('`poseGridAt` 与 `poseAt` 对同一个点给出同一个答案', () => {
    const posed = baseGrid()
    poseGridAt(posed, MODEL, 2.5)
    for (const row of [0, 6, 12, 18, 24]) {
      for (const col of [0, 8, 16, 24]) {
        const su = col / GRID_COLS
        const sv = row / GRID_ROWS
        const single = poseAt(MODEL, su, sv, 2.5)
        const grid = posed[row * (GRID_COLS + 1) + col]!
        expect(single.u).toBeCloseTo(grid.u, 12)
        expect(single.v).toBeCloseTo(grid.v, 12)
      }
    }
  })
})

describe('关键帧曲线', () => {
  /** 两枚键的直线思维曲线：t=0.25 处 v=-1，t=0.75 处 v=1。 */
  const CURVE: Live2dMotion = {
    cycles: 0,
    amplitude: 0.01,
    phase: 0,
    keys: [
      { t: 0.25, v: -1 },
      { t: 0.75, v: 1 },
    ],
  }

  it('键点上的取值就是键值', () => {
    expect(motionValueAt(CURVE, 0.25, 1)).toBe(-1)
    expect(motionValueAt(CURVE, 0.75, 1)).toBe(1)
  })

  it('键间走余弦插值（中点恰为中值，四分点比线性慢），不是折线也不是正弦', () => {
    expect(motionValueAt(CURVE, 0.5, 1)).toBeCloseTo(0, 12)
    // 段内 u=0.25 处的余弦推进是 (1-cos(π/4))/2 ≈ 0.146——比线性插值的 0.25 慢得多。
    const quarter = motionValueAt(CURVE, 0.25 + 0.5 * 0.25, 1)
    expect(quarter).toBeCloseTo(-1 + 2 * ((1 - Math.cos(Math.PI * 0.25)) / 2), 12)
  })

  it('环绕段：p 在首键之前落在「尾键 → 首键」的插值里，缝合处无硬接', () => {
    // p=0.1 < 首键 0.25：从尾键 (0.75, 1) 环绕到首键 (0.25, -1)。
    const value = sampleKeys(CURVE.keys!, 0.1)
    const u = (0.1 + 1 - 0.75) / (1 + 0.25 - 0.75)
    expect(value).toBeCloseTo(1 + (-2 * (1 - Math.cos(Math.PI * u))) / 2, 12)
    // 循环缝合处：p 恰在首键上，两个方向的值一致。
    expect(sampleKeys(CURVE.keys!, 0.25)).toBe(-1)
  })

  it('环绕段还有另一半：尾键之后到缝合点之间也在插值，不是停在尾键值上', () => {
    // 此前只算了「首键之前」那一半：p 从尾键走到 1 会停在尾值上，过 1 那一刻再跳到环绕
    // 值——循环处一个硬接。这一条钉住后半段（关键帧驱动的「无缝」全靠它）。
    const keys = [
      { t: 0, v: 0.2 },
      { t: 0.5, v: -0.6 },
    ]
    expect(sampleKeys(keys, 0.5)).toBeCloseTo(-0.6, 12)
    expect(sampleKeys(keys, 1 - 1e-9)).toBeCloseTo(sampleKeys(keys, 0), 6)
    // 走到 0.99 时已经贴近首键，而不是还趴在尾键上。
    expect(sampleKeys(keys, 0.99)).toBeGreaterThan(0)
  })

  it('关键帧驱动与正弦驱动是同一扇门后面的两条路（`motionValueAt` 是唯一分岔点）', () => {
    const sine: Live2dMotion = { cycles: 1, amplitude: 1, phase: 0 }
    expect(motionValueAt(sine, 0.25, 1)).toBeCloseTo(1, 12)
    // 有关键帧（≥2 键）时正弦参数彻底退位：cycles=0 的正弦恒为零，曲线却在动。
    expect(motionValueAt(CURVE, 0.4, 1)).not.toBe(0)
    const singleton: Live2dMotion = { cycles: 1, amplitude: 1, phase: 0, keys: [{ t: 0.5, v: 0.9 }] }
    expect(motionValueAt(singleton, 0.25, 1)).toBeCloseTo(1, 12)
  })

  it('无缝循环在关键帧驱动下依然成立：`t + loop` 处的网格与 `t` 处重合', () => {
    const keyed: Live2dModel = normalizeLive2dModel({
      format: LIVE2D_FORMAT,
      texture: '少女.png',
      motions: {
        breath: { cycles: 2, amplitude: 0.02, keys: [{ t: 0.2, v: -1 }, { t: 0.6, v: 1 }] },
        sway: { cycles: 1, amplitude: 0.01, keys: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }] },
        tilt: { cycles: 1, amplitude: 0.01, phase: 0.25 },
      },
    })!
    const a = baseGrid()
    const b = baseGrid()
    poseGridAt(a, keyed, 2.71)
    poseGridAt(b, keyed, 2.71 + keyed.loop)
    for (let index = 0; index < a.length; index += 1) {
      expect(b[index]!.u).toBeCloseTo(a[index]!.u, 12)
      expect(b[index]!.v).toBeCloseTo(a[index]!.v, 12)
    }
  })
})

describe('网格雕刻', () => {
  const SCULPTED: Live2dModel = normalizeLive2dModel({
    format: LIVE2D_FORMAT,
    texture: '少女.png',
    motions: {
      breath: { cycles: 2, amplitude: 0, phase: 0 },
      sway: { cycles: 1, amplitude: 0, phase: 0 },
      tilt: { cycles: 1, amplitude: 0, phase: 0 },
    },
    deform: { offsets: { '12,0': [0.05, -0.02] } },
  })!

  it('雕过的顶点带着位移走，没雕过的纹丝不动', () => {
    const posed = baseGrid()
    poseGridAt(posed, SCULPTED, 0)
    const base = baseGrid()
    const sculpted = posed[0 * (GRID_COLS + 1) + 12]!
    const origin = base[0 * (GRID_COLS + 1) + 12]!
    expect(sculpted.u).toBeCloseTo(origin.u + 0.05, 12)
    expect(sculpted.v).toBeCloseTo(origin.v - 0.02, 12)
    // 隔壁顶点没雕过，不跟着走：它与自己的原 uv 完全重合。
    const neighbour = posed[0 * (GRID_COLS + 1) + 13]!
    expect(neighbour.u).toBe(neighbour.su)
    expect(neighbour.v).toBe(neighbour.sv)
  })

  it('雕刻是静态形状：任意时刻都在（动作位移之外恒定叠加）', () => {
    const at0 = baseGrid()
    const atHalf = baseGrid()
    poseGridAt(at0, SCULPTED, 0)
    poseGridAt(atHalf, SCULPTED, SCULPTED.loop / 3)
    const sculptedA = at0[12]!
    const sculptedB = atHalf[12]!
    expect(sculptedA.u - sculptedA.su).toBeCloseTo(sculptedB.u - sculptedB.su, 12)
    expect(sculptedA.v - sculptedA.sv).toBeCloseTo(sculptedB.v - sculptedB.sv, 12)
  })

  it('无缝循环在雕刻存在下依然成立', () => {
    const a = baseGrid()
    const b = baseGrid()
    poseGridAt(a, SCULPTED, 1.111)
    poseGridAt(b, SCULPTED, 1.111 + SCULPTED.loop)
    expect(b).toEqual(a)
  })
})
