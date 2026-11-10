/**
 * dsh-canvas — skeleton2d-lite → DragonBones 骨架数据的判据。
 *
 * 这一份钉的是**文件里那串数字的含义**，不是「有没有生成一个 JSON」：导出的骨架要能被
 * DragonBones 的运行时读懂，而懂的意思是——权重、绑定姿态、骨骼动画三者合起来复原出的
 * 顶点位置，与画布上那一刻的位置是同一个点。所以这里先用三十行把**运行时的算法**照抄一遍
 * （`_parseMesh` 的绑定求逆 + 骨骼世界矩阵连乘 + 权重混合），再拿它去解我们导出的文件；
 * 解出来的顶点与 `poseAt` 比，差多少就是「导出去以后会错位多少像素」。
 *
 * 三条判据各防一种坏法：
 * 1. **结构**：`weights` 的长度、骨号的指向、`bonePose` 有没有漏掉被引用的骨——写错一处
 *    运行时不会报错，只会把整张网格画成一团（或者干脆不画）；
 * 2. **保真**：从文件反算的顶点必须落在 `poseAt` 上；再做一个**变异**（把某根骨的绑定
 *    姿态挪 1px），反算必须**明显偏离**——不变的话说明这条判据根本没读到 `bonePose`，
 *    属于「夹具互相掩护」的假绿；
 * 3. **节律**：帧数由循环时长定，长循环压帧率不压时长；`duration` 仍等于 loop 秒，
 *    这样引擎里播完一圈回到第 0 帧是连续的。
 *
 * 副动作（呼吸 / 摇摆 / 倾头 / 雕刻）**刻意不在这份文件里**，所以这里的模型把它们全设成
 * 0：骨架那条路只承诺骨骼这一层，逐像素一致是雪碧图那条的承诺（`skeleton2d-export.ts`）。
 */
import { describe, expect, it } from 'vitest'
import {
  DRAGONBONES_ANIMATION,
  DRAGONBONES_FPS,
  DRAGONBONES_MAX_FRAMES,
  DRAGONBONES_ROOT,
  armatureNameOf,
  dragonBonesPackOf,
} from '../../../src/core/skeleton2d/dragonbones.ts'
import { SKELETON2D_FORMAT, normalizeSkeleton2dModel, type Skeleton2dModel } from '../../../src/core/skeleton2d/model.ts'
import { poseAt } from '../../../src/core/skeleton2d/rig.ts'

const WIDTH = 1024
const HEIGHT = 1024

/** 一份绑好骨的模型：三根骨成链 + 一根旁枝，副动作全关（骨架只承诺骨骼那一层）。 */
function rigged(overrides: Record<string, unknown> = {}): Skeleton2dModel {
  return normalizeSkeleton2dModel({
    format: SKELETON2D_FORMAT,
    texture: '少女.png',
    loop: 4.8,
    motions: {
      breath: { cycles: 2, amplitude: 0, phase: 0 },
      sway: { cycles: 1, amplitude: 0, phase: 0 },
      tilt: { cycles: 1, amplitude: 0, phase: 0.25 },
    },
    bones: [
      { name: 'hip', x: 0.5, y: 0.9 },
      { name: 'chest', x: 0.5, y: 0.55, parent: 'hip' },
      { name: 'head', x: 0.5, y: 0.3, parent: 'chest' },
      { name: 'arm', x: 0.2, y: 0.45, parent: 'chest' },
    ],
    boneTracks: {
      chest: { rot: [{ t: 0, v: 0.2 }, { t: 0.5, v: -0.6 }] },
      head: { rot: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }, { t: 0.9, v: -0.5 }] },
    },
    ...overrides,
  }) as Skeleton2dModel
}

interface SkeletonJson {
  frameRate: number
  name: string
  version: string
  compatibleVersion: string
  armature: {
    name: string
    aabb: { x: number; y: number; width: number; height: number }
    bone: { name: string; parent?: string; transform: { x: number; y: number } }[]
    slot: { name: string; parent: string; displayIndex: number }[]
    skin: {
      name: string
      slot: {
        name: string
        display: {
          name: string
          path: string
          type: string
          width: number
          height: number
          vertices: number[]
          uvs: number[]
          triangles: number[]
          weights: number[]
          slotPose: number[]
          bonePose: number[]
        }[]
      }[]
    }[]
    animation?: { name: string; duration: number; playTimes: number; bone: { name: string; rotateFrame: { duration: number; tweenEasing: number; rotate: number }[] }[] }[]
  }[]
}

/** 取骨架那份 JSON（判据里到处要用，写一次）。 */
function skeletonOf(model: Skeleton2dModel, width = WIDTH, height = HEIGHT): SkeletonJson {
  const pack = dragonBonesPackOf(model, { width, height }, '少女 01')
  expect(pack).toBeDefined()
  return pack?.skeleton as unknown as SkeletonJson
}

/**
 * DragonBones 运行时的骨架算法，照抄一份（`ObjectDataParser._parseMesh` +
 * `Bone._updateGlobalTransformMatrix` + 蒙皮混合）。
 *
 * 只照抄「我们这份文件用到的部分」：骨骼只平移+旋转、槽挂在原点的根骨上（`slotPose`
 * 是单位阵）。抄在判据里而不是 import 实现，是因为这里要验的正是**文件的语义**——
 * 拿实现去验实现，两边一起错也是一片绿。
 */
function skinFromSkeleton(json: SkeletonJson, frame: number) {
  const armature = json.armature[0] as SkeletonJson['armature'][number]
  const bones = armature.bone
  // 骨号 → 数组下标（运行时 `bonePose` 里的骨号就是 `bone` 数组的下标）。
  const indexOf = new Map(bones.map((bone, index) => [bone.name, index]))

  // 绑定姿态的世界矩阵：本模型只有平移，所以就是「自己 + 所有父级」的位移和。
  const restOf: { x: number; y: number }[] = []
  for (const bone of bones) {
    const parent = bone.parent === undefined ? undefined : restOf[indexOf.get(bone.parent) as number]
    restOf.push({ x: (parent?.x ?? 0) + bone.transform.x, y: (parent?.y ?? 0) + bone.transform.y })
  }

  // 每一帧的局部旋转（度 → 弧度），缺帧的骨按 0 算。
  const rotationOf = new Map<string, number>()
  const animation = armature.animation?.[0]
  for (const track of animation?.bone ?? []) {
    rotationOf.set(track.name, ((track.rotateFrame[frame]?.rotate ?? 0) * Math.PI) / 180)
  }

  // 世界姿态：子骨骼的原点随父级旋转（与 `bones.ts` 里那条合成规则同一件事）。
  const poseOf: { x: number; y: number; angle: number }[] = []
  for (const bone of bones) {
    const local = rotationOf.get(bone.name) ?? 0
    const parentIndex = bone.parent === undefined ? -1 : (indexOf.get(bone.parent) as number)
    if (parentIndex < 0) {
      poseOf.push({ x: bone.transform.x, y: bone.transform.y, angle: local })
      continue
    }
    const parent = poseOf[parentIndex] as { x: number; y: number; angle: number }
    const cos = Math.cos(parent.angle)
    const sin = Math.sin(parent.angle)
    poseOf.push({
      x: parent.x + bone.transform.x * cos - bone.transform.y * sin,
      y: parent.y + bone.transform.x * sin + bone.transform.y * cos,
      angle: parent.angle + local,
    })
  }

  // `bonePose` 的槽位：骨号 → 绑定矩阵的平移（判据用它而不是 restOf，才能验到文件里那串数）。
  const display = armature.skin[0]?.slot[0]?.display[0]
  const bindPose = new Map<number, { x: number; y: number }>()
  const pose = display?.bonePose ?? []
  for (let offset = 0; offset + 6 < pose.length; offset += 7) {
    bindPose.set(pose[offset] as number, { x: pose[offset + 5] as number, y: pose[offset + 6] as number })
  }

  return {
    /** 解一个顶点在这一帧的位置（像素）。 */
    vertex(index: number): { x: number; y: number } {
      const weights = display?.weights ?? []
      const px = display?.vertices[index * 2] as number
      const py = display?.vertices[index * 2 + 1] as number
      // 逐顶点：`[骨数, 骨号, 权重, 骨号, 权重, …]`——先走到这个顶点的那一格。
      let cursor = 0
      for (let vertex = 0; vertex < index; vertex += 1) {
        const count = weights[cursor] as number
        cursor += 1 + count * 2
      }
      const count = weights[cursor] as number
      let x = 0
      let y = 0
      for (let pair = 0; pair < count; pair += 1) {
        const boneIndex = weights[cursor + 1 + pair * 2] as number
        const weight = weights[cursor + 2 + pair * 2] as number
        const bind = bindPose.get(boneIndex) as { x: number; y: number }
        const bone = poseOf[boneIndex] as { x: number; y: number; angle: number }
        const cos = Math.cos(bone.angle)
        const sin = Math.sin(bone.angle)
        const lx = px - bind.x
        const ly = py - bind.y
        x += weight * (bone.x + lx * cos - ly * sin)
        y += weight * (bone.y + lx * sin + ly * cos)
      }
      return { x, y }
    },
  }
}

describe('没有骨骼就没有骨架包', () => {
  it('一份没绑骨的模型返回 undefined——这份文件的意义全在骨架', () => {
    const model = rigged({ bones: undefined, boneTracks: undefined })
    expect(model.bones).toBeUndefined()
    expect(dragonBonesPackOf(model, { width: 512, height: 512 }, 'x')).toBeUndefined()
  })
})

describe('结构：运行时读得懂的那几处', () => {
  const json = skeletonOf(rigged())
  const armature = json.armature[0] as SkeletonJson['armature'][number]

  it('版本是运行时认的那四个之一，帧率与名字落在顶层与骨架上', () => {
    expect(json.version).toBe('5.5')
    expect(json.compatibleVersion).toBe('5.5')
    expect(json.frameRate).toBeGreaterThan(0)
    expect(json.name).toBe(armatureNameOf('少女 01'))
    expect(armature.name).toBe(json.name)
  })

  it('骨骼：合成根骨在最前，父级**一定在子级之前**（运行时按顺序找父级）', () => {
    expect(armature.bone[0]?.name).toBe(DRAGONBONES_ROOT)
    const seen = new Set<string>()
    for (const bone of armature.bone) {
      if (bone.parent !== undefined) expect(seen.has(bone.parent), `${bone.name} 的父级 ${bone.parent}`).toBe(true)
      seen.add(bone.name)
    }
    // 四根模型骨都在，且层级没被压平。
    expect(armature.bone.map((bone) => bone.name)).toEqual([DRAGONBONES_ROOT, 'hip', 'chest', 'head', 'arm'])
    expect(armature.bone.find((bone) => bone.name === 'head')?.parent).toBe('chest')
  })

  it('槽挂在根骨上（`slotPose` 因此可以是单位阵），网格挂在这个槽上', () => {
    const slot = armature.slot[0]
    expect(slot?.parent).toBe(DRAGONBONES_ROOT)
    const display = armature.skin[0]?.slot[0]
    expect(display?.name).toBe(slot?.name)
    const mesh = display?.display[0]
    expect(mesh?.type).toBe('mesh')
    expect(mesh?.slotPose).toEqual([1, 0, 0, 1, 0, 0])
    expect(mesh?.width).toBe(WIDTH)
    expect(mesh?.height).toBe(HEIGHT)
    expect(mesh?.uvs).toHaveLength(mesh?.vertices.length ?? -1)
  })

  it('权重：逐顶点 `[骨数, 骨号…]`，长度自洽、骨号都指向真实骨骼、和恒为 1', () => {
    const mesh = armature.skin[0]?.slot[0]?.display[0]
    const weights = mesh?.weights ?? []
    const vertexCount = (mesh?.vertices.length ?? 0) / 2
    expect(vertexCount).toBeGreaterThan(0)
    let cursor = 0
    let pairs = 0
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const count = weights[cursor] as number
      // 模型只有「最近两根」会拿到非零权重，所以骨数 ∈ {1, 2}。
      expect(count).toBeGreaterThanOrEqual(1)
      expect(count).toBeLessThanOrEqual(2)
      let sum = 0
      for (let pair = 0; pair < count; pair += 1) {
        const boneIndex = weights[cursor + 1 + pair * 2] as number
        const weight = weights[cursor + 2 + pair * 2] as number
        expect(Number.isInteger(boneIndex)).toBe(true)
        expect(boneIndex).toBeGreaterThan(0)
        expect(boneIndex).toBeLessThan(armature.bone.length)
        sum += weight
      }
      expect(sum).toBeCloseTo(1, 9)
      pairs += count
      cursor += 1 + count * 2
    }
    // 长度恰好是运行时算 weightCount 的那条式子（多一个少一个都会把后面的顶点读歪）。
    expect(weights).toHaveLength(vertexCount + pairs * 2)

    // `bonePose` 必须覆盖**被权重引用到的每一根**骨：漏一根，运行时 `indexOf` 得到 -1。
    const referenced = new Set<number>()
    cursor = 0
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const count = weights[cursor] as number
      for (let pair = 0; pair < count; pair += 1) referenced.add(weights[cursor + 1 + pair * 2] as number)
      cursor += 1 + count * 2
    }
    const bonePose = mesh?.bonePose ?? []
    expect(bonePose.length % 7).toBe(0)
    const posed = new Set<number>()
    for (let offset = 0; offset < bonePose.length; offset += 7) {
      expect(bonePose[offset]).toBeLessThan(armature.bone.length)
      // 绑定矩阵是纯平移（骨骼不缩放），顺序是 [骨号, a, b, c, d, tx, ty]。
      expect(bonePose.slice(offset + 1, offset + 5)).toEqual([1, 0, 0, 1])
      posed.add(bonePose[offset] as number)
    }
    for (const boneIndex of referenced) expect(posed.has(boneIndex), `骨号 ${boneIndex}`).toBe(true)
  })
})

describe('保真：从文件反算出来的顶点，就是画布上那一刻的顶点', () => {
  const model = rigged()
  const json = skeletonOf(model)
  const armature = json.armature[0] as SkeletonJson['armature'][number]
  const display = armature.skin[0]?.slot[0]?.display[0]
  const vertexCount = (display?.vertices.length ?? 0) / 2

  it('骨架里的顶点就是贴图上的位置（uv × 尺寸），锚点与比例都没被改过', () => {
    for (const index of [0, 1, vertexCount - 1]) {
      const u = display?.uvs[index * 2] as number
      const v = display?.uvs[index * 2 + 1] as number
      expect(display?.vertices[index * 2]).toBeCloseTo(u * WIDTH, 2)
      expect(display?.vertices[index * 2 + 1]).toBeCloseTo(v * HEIGHT, 2)
    }
  })

  it('每一帧：反算顶点与 `poseAt` 差不到百分之一像素（角度量化到 0.001° 的余量）', () => {
    const animation = armature.animation?.[0]
    expect(animation?.name).toBe(DRAGONBONES_ANIMATION)
    const frameCount = animation?.duration as number
    for (const frame of [0, 17, 57, frameCount - 1]) {
      const skin = skinFromSkeleton(json, frame)
      const t = (frame / frameCount) * model.loop
      for (const index of [0, 13, 300, 312, 624]) {
        const u = display?.uvs[index * 2] as number
        const v = display?.uvs[index * 2 + 1] as number
        const expected = poseAt(model, u, v, t)
        const actual = skin.vertex(index)
        // 容差：旋转角只存到 0.001°（远端的臂展 ~1000px 也只差千分之几像素），权重存到
        // 六位小数。百分之一像素是这两个量化加起来的余量，比任何能看见的差小两个数量级。
        expect(Math.abs(actual.x - expected.u * WIDTH)).toBeLessThan(0.01)
        expect(Math.abs(actual.y - expected.v * HEIGHT)).toBeLessThan(0.01)
      }
    }
  })

  it('变异：把所有骨的绑定姿态挪 1px，反算必须明显偏离——判据真的读了 `bonePose`', () => {
    // 不做这一条，上面那条有可能在「两边都没读 bonePose、恰好都对」的情况下也是绿的。
    // 挪**每一根**（只挪一根的话，得先知道哪根管着被抽的那个顶点，那又是在抄实现）。
    const mutated = skeletonOf(rigged())
    const mutatedDisplay = mutated.armature[0]?.skin[0]?.slot[0]?.display[0]
    const bonePose = mutatedDisplay?.bonePose ?? []
    for (let offset = 0; offset + 6 < bonePose.length; offset += 7) bonePose[offset + 5] = (bonePose[offset + 5] as number) + 1
    const frame = 57
    const skin = skinFromSkeleton(mutated, frame)
    const t = (frame / (mutated.armature[0]?.animation?.[0]?.duration as number)) * model.loop
    // 顶点 0 在左上角，离那根骨最远、权重也在它身上——挪 1px 至少看得见。
    const expected = poseAt(model, 0, 0, t)
    const actual = skin.vertex(0)
    const drift = Math.hypot(actual.x - expected.u * WIDTH, actual.y - expected.v * HEIGHT)
    expect(drift).toBeGreaterThan(0.5)
  })
})

describe('节律：帧数由循环时长定，长循环压帧率不压时长', () => {
  it('帧数 = 循环 × 帧率，duration 就是这些帧，playTimes 为 0（永远循环）', () => {
    const model = rigged()
    const armature = skeletonOf(model).armature[0] as SkeletonJson['armature'][number]
    const animation = armature.animation?.[0]
    expect(animation?.duration).toBe(Math.round(model.loop * DRAGONBONES_FPS))
    expect(animation?.playTimes).toBe(0)
    for (const track of animation?.bone ?? []) {
      expect(track.rotateFrame).toHaveLength(animation?.duration as number)
      // 线性补间：帧与帧之间不另设缓动，曲线已经在 24fps 上烘过一遍了。
      for (const frame of track.rotateFrame) {
        expect(frame.duration).toBe(1)
        expect(frame.tweenEasing).toBe(0)
      }
    }
    // 有曲线的骨才写轨道：`arm` 没铺曲线，不该出现在动画里。
    expect((animation?.bone ?? []).map((track) => track.name).sort()).toEqual(['chest', 'head'])
  })

  it('循环特别长时压帧率：帧数封顶，`duration / frameRate` 仍等于循环时长', () => {
    const model = rigged({ loop: 60 })
    const json = skeletonOf(model)
    const armature = json.armature[0] as SkeletonJson['armature'][number]
    const duration = armature.animation?.[0]?.duration as number
    expect(duration).toBeLessThanOrEqual(DRAGONBONES_MAX_FRAMES)
    expect(json.frameRate).toBeLessThan(DRAGONBONES_FPS)
    expect(duration / json.frameRate).toBeCloseTo(model.loop, 1)
  })

  it('绕回来那一刻接得上：末帧与首帧的差，相对整条曲线的幅度可以忽略', () => {
    // 无缝的性质在数学层（正弦整周期、关键帧环绕插值），文件这一层能钉的是「烘出来的
    // 最后一帧离第一帧只差一步」——差到一整个幅度就说明帧边界切错了位置。
    const model = rigged()
    const armature = skeletonOf(model).armature[0] as SkeletonJson['armature'][number]
    const duration = armature.animation?.[0]?.duration as number
    expect((armature.animation?.[0]?.bone ?? []).length).toBeGreaterThan(0)
    for (const track of armature.animation?.[0]?.bone ?? []) {
      const values = track.rotateFrame.map((frame) => frame.rotate)
      const first = values[0] as number
      const last = values[duration - 1] as number
      const range = Math.max(...values) - Math.min(...values)
      expect(range).toBeGreaterThan(1)
      expect(Math.abs(first - last)).toBeLessThan(range * 0.1)
    }
  })
})

describe('名字', () => {
  it('卡片名清洗成各平台都不挑的骨架名，空名退成 Armature', () => {
    expect(armatureNameOf('少女 01')).toBe('少女_01')
    expect(armatureNameOf('a/b:c')).toBe('a_b_c')
    expect(armatureNameOf('  ')).toBe('Armature')
  })
})
