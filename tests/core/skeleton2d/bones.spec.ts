/**
 * dsh-canvas — skeleton2d-lite 骨骼层的判据。
 *
 * 钉四件事：
 * 1. **层级合成**：父动子随——子骨原点绕父骨**世界原点**转父角，角度是整条链的累加；
 *    没铺曲线的骨不自己动，但原点照样跟着父级走（手臂抬起来，手腕的关节得到新位置）；
 * 2. **蒙皮权重**：和恒为 1、只在最近的两根之间分、离得近的份额大；
 * 3. **rest 恒等**：全角 0、原点未动时蒙皮输出逐位等于输入——「没动的东西不许被挪」；
 * 4. **两条路同一份算术**：`poseGridAt`（逐顶点）与 `poseAt`（单点）在骨骼接入之后仍然
 *    逐点一致——舞台、卡面、导出三处靠的就是这一条。
 */
import { describe, expect, it } from 'vitest'
import { BONE_ROT_MAX, bonePosesAt, boneRotationAt, boneWeightsAt, skinAt } from '../../../src/core/skeleton2d/bones.ts'
import { SKELETON2D_FORMAT, normalizeSkeleton2dModel, type Skeleton2dModel } from '../../../src/core/skeleton2d/model.ts'
import { GRID_COLS, GRID_ROWS, baseGrid, poseAt, poseGridAt } from '../../../src/core/skeleton2d/rig.ts'

/** 一条两节的骨链：hip 在胯，chest 在胸口（挂在 hip 下）。 */
const CHAIN = [
  { name: 'hip', x: 0.5, y: 0.9 },
  { name: 'chest', x: 0.5, y: 0.55, parent: 'hip' },
]

/** v 恒为 1 的两键曲线：旋转角恒等于满幅——好让期望值是一句可读的算式。 */
const FULL = [
  { t: 0, v: 1 },
  { t: 0.5, v: 1 },
]

const MODEL: Skeleton2dModel = normalizeSkeleton2dModel({
  format: SKELETON2D_FORMAT,
  texture: '少女.png',
  motions: {
    breath: { cycles: 2, amplitude: 0.02, phase: 0 },
    sway: { cycles: 1, amplitude: 0.01, phase: 0 },
    tilt: { cycles: 1, amplitude: 0.01, phase: 0.25 },
  },
  bones: [
    { name: 'hip', x: 0.5, y: 0.9 },
    { name: 'chest', x: 0.5, y: 0.55, parent: 'hip' },
    { name: 'head', x: 0.5, y: 0.3, parent: 'chest' },
  ],
  boneTracks: { chest: { rot: FULL } },
})!

describe('层级合成', () => {
  it('rest 态：没有曲线时每根骨停在 rest 原点、角度为 0', () => {
    const poses = bonePosesAt(CHAIN, undefined, 0, 4.8)

    expect(poses).toHaveLength(2)
    expect(poses[0]).toEqual({ ox: 0.5, oy: 0.9, angle: 0 })
    expect(poses[1]).toEqual({ ox: 0.5, oy: 0.55, angle: 0 })
  })

  it('父骨转 θ：子骨的原点绕父骨原点转过去，角度加上父角', () => {
    const poses = bonePosesAt(CHAIN, { hip: { rot: FULL } }, 0, 4.8)
    const angle = BONE_ROT_MAX
    // 子骨相对父骨的 rest 偏移（uv）：只有纵向 0.35。
    const rx = 0
    const ry = 0.55 - 0.9
    const expectedX = 0.5 + rx * Math.cos(angle) - ry * Math.sin(angle)
    const expectedY = 0.9 + rx * Math.sin(angle) + ry * Math.cos(angle)

    expect(poses[0]?.angle).toBeCloseTo(angle, 12)
    expect(poses[1]?.ox).toBeCloseTo(expectedX, 12)
    expect(poses[1]?.oy).toBeCloseTo(expectedY, 12)
    // 子骨自己没有曲线：角度只继承父级那一个。
    expect(poses[1]?.angle).toBeCloseTo(angle, 12)
  })

  it('三连链：末骨的角度是整条链的累加（父动子随，一级一级叠）', () => {
    const poses = bonePosesAt(
      [
        { name: 'hip', x: 0.5, y: 0.9 },
        { name: 'chest', x: 0.5, y: 0.55, parent: 'hip' },
        { name: 'head', x: 0.5, y: 0.3, parent: 'chest' },
      ],
      { hip: { rot: FULL }, chest: { rot: FULL }, head: { rot: FULL } },
      0,
      4.8,
    )

    // 逐根比（不 deep equal：累加的顺序与乘法在浮点上差最后一位，那不是判据要管的事）。
    poses.forEach((pose, index) => expect(pose.angle).toBeCloseTo(BONE_ROT_MAX * (index + 1), 12))
  })

  it('没铺曲线的骨不自己转，但原点照样跟着父级走（角度只继承父级）', () => {
    const poses = bonePosesAt(CHAIN, { hip: { rot: FULL } }, 0, 4.8)

    // chest 那条曲线不存在：它自己的旋转是 0，世界角只是父级交给它的那一个。
    expect(poses[1]?.angle).toBeCloseTo(BONE_ROT_MAX, 12)
    expect(poses[1]?.oy).not.toBeCloseTo(0.55, 6)
  })

  it('父级不在自己之前（顺序错乱）时当根处理，不读别人的姿态', () => {
    // 归一不会放这种形状进来，但导出与判据都可能手搓骨骼——防御一道，别读到空洞。
    const poses = bonePosesAt(
      [
        { name: 'child', x: 0.2, y: 0.2, parent: 'later' },
        { name: 'later', x: 0.8, y: 0.8 },
      ],
      undefined,
      0,
      4.8,
    )

    expect(poses[0]).toEqual({ ox: 0.2, oy: 0.2, angle: 0 })
  })
})

describe('蒙皮权重', () => {
  it('没有骨骼就是空表（调用方按「无蒙皮」短路）', () => {
    expect(boneWeightsAt([], 0.5, 0.5)).toEqual([])
  })

  it('一根骨就是全给（不必再分）', () => {
    expect(boneWeightsAt([{ x: 0.3, y: 0.3 }], 0.9, 0.9)).toEqual([1])
  })

  it('和恒为 1，而且只有最近的两根有份额', () => {
    const weights = boneWeightsAt(
      [
        { x: 0.2, y: 0.8 },
        { x: 0.8, y: 0.2 },
        { x: 0.5, y: 0.5 },
      ],
      0.21,
      0.79,
    )

    expect(weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12)
    // 三根里必定有一根一分钱都拿不到——「最近两根」不是「按距离加权全部」。
    expect(weights.filter((value) => value > 0)).toHaveLength(2)
    expect(weights[0]).toBeGreaterThan(weights[1] as number)
  })

  it('正中两根之间平分（对称的点不许偏向任何一边）', () => {
    const weights = boneWeightsAt(
      [
        { x: 0.3, y: 0.5 },
        { x: 0.7, y: 0.5 },
      ],
      0.5,
      0.5,
    )

    expect(weights[0]).toBeCloseTo(0.5, 12)
    expect(weights[1]).toBeCloseTo(0.5, 12)
  })

  it('骑在关节上时份额集中在自己身上，不会除零炸开', () => {
    const weights = boneWeightsAt(
      [
        { x: 0.25, y: 0.25 },
        { x: 0.75, y: 0.75 },
      ],
      0.25,
      0.25,
    )

    expect(Number.isFinite(weights[0])).toBe(true)
    expect(weights[0]).toBeGreaterThan(0.99)
  })
})

describe('蒙皮', () => {
  it('rest 态：输出逐位等于输入——没铺曲线的骨一个像素都不许挪', () => {
    const bones = [
      { x: 0.5, y: 0.9 },
      { x: 0.5, y: 0.55 },
    ]
    const poses = bones.map((bone) => ({ ox: bone.x, oy: bone.y, angle: 0 }))
    const weights = [0.6, 0.4]

    for (const [su, sv] of [
      [0.5, 0.5],
      [0.12, 0.86],
      [0.99, 0.01],
    ] as const) {
      const point = skinAt(bones, poses, weights, su, sv)
      expect(point.u).toBeCloseTo(su, 12)
      expect(point.v).toBeCloseTo(sv, 12)
    }
  })

  it('单骨转 90°：点绕骨自己的世界原点转过去（(1,0) 的偏移变成 (0,1)）', () => {
    const point = skinAt([{ x: 0.5, y: 0.5 }], [{ ox: 0.5, oy: 0.5, angle: Math.PI / 2 }], [1], 0.6, 0.5)

    expect(point.u).toBeCloseTo(0.5, 12)
    expect(point.v).toBeCloseTo(0.6, 12)
  })

  it('两根骨按权重线性混合：两半都转、点落在两者之间', () => {
    const bones = [
      { x: 0.4, y: 0.5 },
      { x: 0.6, y: 0.5 },
    ]
    const poses = [
      { ox: 0.4, oy: 0.5, angle: Math.PI / 2 },
      { ox: 0.6, oy: 0.5, angle: 0 },
    ]
    const blended = skinAt(bones, poses, [0.5, 0.5], 0.5, 0.5)
    const onlyFirst = skinAt(bones, poses, [1, 0], 0.5, 0.5)
    const onlySecond = skinAt(bones, poses, [0, 1], 0.5, 0.5)

    expect(blended.u).toBeCloseTo((onlyFirst.u + onlySecond.u) / 2, 12)
    expect(blended.v).toBeCloseTo((onlyFirst.v + onlySecond.v) / 2, 12)
  })
})

describe('旋转曲线的无缝', () => {
  it('`t + loop` 处与 `t` 处逐位相同——循环缝合处没有跳变', () => {
    // 首键不落在 0 上（0.15）：要走的正是「尾键 → 首键」那一段环绕插值，而不是
    // 只在首键处取一次值。
    const curved = [
      { t: 0.15, v: -1 },
      { t: 0.6, v: 1 },
    ]
    for (const t of [0, 0.37, 1.9, 4.79]) {
      expect(boneRotationAt(curved, t + 4.8, 4.8)).toBeCloseTo(boneRotationAt(curved, t, 4.8), 12)
    }
  })

  it('不足两键就是静止（0）——单键凑不成曲线，归一那边已经拒了', () => {
    expect(boneRotationAt(undefined, 1.2, 4.8)).toBe(0)
    expect(boneRotationAt([{ t: 0, v: 1 }], 1.2, 4.8)).toBe(0)
  })

  it('满幅 v=1 对应 BONE_ROT_MAX（弧度），不是 1 弧度', () => {
    expect(boneRotationAt(FULL, 0.1, 4.8)).toBeCloseTo(BONE_ROT_MAX, 12)
  })
})

describe('两条路同一份算术（骨骼接入之后）', () => {
  it('poseGridAt 的每个顶点，与 poseAt 在同一点同一刻逐点一致', () => {
    // 这一条是舞台 / 卡面 / 导出三处不打架的根：网格是逐顶点算的，导出是按连续坐标
    // 采的，两边只要有一处漏掉骨骼（或次序不同），这里立刻红。
    for (const t of [0, 0.7, 1.9, 3.3]) {
      const grid = baseGrid()
      poseGridAt(grid, MODEL, t)
      for (let row = 0; row <= GRID_ROWS; row += 1) {
        for (let col = 0; col <= GRID_COLS; col += 1) {
          const vertex = grid[row * (GRID_COLS + 1) + col]!
          const same = poseAt(MODEL, vertex.su, vertex.sv, t)
          expect(same.u).toBeCloseTo(vertex.u, 12)
          expect(same.v).toBeCloseTo(vertex.v, 12)
        }
      }
    }
  })

  it('骨骼确实参与了变形：同一顶点在 rest 与转起来的时刻位置不同', () => {
    // 没有这一条，上面那条在「两边都完全忽略骨骼」的情况下也会是绿的。
    const at0 = baseGrid()
    poseGridAt(at0, MODEL, 0)
    const moved = at0[0]!
    expect(Math.abs(moved.u - moved.su) + Math.abs(moved.v - moved.sv)).toBeGreaterThan(0)
  })
})
