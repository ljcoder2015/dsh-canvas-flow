/**
 * dsh-canvas — 骨骼模式（编辑台）的判据。
 *
 * 屏幕这一侧只有三件事要钉：
 * 1. **换算**：uv ↔ 像素走贴合盒（contain 的同一句算术），letterbox 区的点不会落成关节；
 * 2. **拾取**：点得准——最近的关节在半径内才算抓住，半径上不算（差一点就别抓）；
 * 3. **取名**：`b1`、`b2`…取最小的空号，删过再建不撞名。
 */
import { describe, expect, it } from 'vitest'
import { BONE_PICK_RADIUS_PX, bonePixel, boneUVFromPoint, nearestBone, nextBoneName } from '../../../src/client/artifact/viewers/live2d/live2d-bones.ts'

const BOX = { left: 10, top: 20, width: 200, height: 100 }

describe('uv ↔ 像素', () => {
  it('关节画在贴合盒里的比例位置上（不是整块画布的）', () => {
    expect(bonePixel({ x: 0.5, y: 0.5 }, BOX)).toEqual({ x: 110, y: 70 })
    expect(bonePixel({ x: 0, y: 1 }, BOX)).toEqual({ x: 10, y: 120 })
  })

  it('屏幕点换成 uv 时扣掉 letterbox 的偏移', () => {
    // 盒内的点：x=(110-10)/200=0.5、y=(70-20)/100=0.5。
    expect(boneUVFromPoint(110, 70, BOX)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('夹进 [0,1]：落在黑边上的点不许变成负的或大于 1 的关节', () => {
    expect(boneUVFromPoint(0, 0, BOX)).toEqual({ x: 0, y: 0 })
    expect(boneUVFromPoint(400, 400, BOX)).toEqual({ x: 1, y: 1 })
  })

  it('盒宽为 0 时不除零（贴合盒还没量出来的那一帧）', () => {
    const flat = { left: 0, top: 0, width: 0, height: 0 }
    const point = boneUVFromPoint(50, 50, flat)

    expect(Number.isFinite(point.x)).toBe(true)
    expect(Number.isFinite(point.y)).toBe(true)
    expect(point).toEqual({ x: 1, y: 1 })
  })
})

describe('拾取关节', () => {
  const bones = [
    { name: 'b1', x: 0.25, y: 0.25 },
    { name: 'b2', x: 0.75, y: 0.75 },
  ]

  it('点在关节附近就抓住它（像素位置由贴合盒给出）', () => {
    expect(nearestBone(bonePixel(bones[1]!, BOX).x + 3, bonePixel(bones[1]!, BOX).y - 2, bones, BOX)).toBe(1)
  })

  it('两根重合时取先遇到的那根（同一像素反复点，抓到的关节不会来回跳）', () => {
    const near = [
      { name: 'b1', x: 0.5, y: 0.5 },
      { name: 'b2', x: 0.5, y: 0.5 },
    ]
    const point = bonePixel(near[0]!, BOX)

    expect(nearestBone(point.x, point.y, near, BOX)).toBe(0)
  })

  it('远离所有关节返回 undefined（不是抓最近的那根凑数）', () => {
    expect(nearestBone(0, 0, bones, BOX)).toBeUndefined()
  })

  it('正好在拾取半径上不算抓住——半径是「差一点就别抓」的边界', () => {
    const point = bonePixel(bones[0]!, BOX)

    expect(BONE_PICK_RADIUS_PX).toBeGreaterThan(0)
    expect(nearestBone(point.x + BONE_PICK_RADIUS_PX, point.y, bones, BOX)).toBeUndefined()
    expect(nearestBone(point.x + BONE_PICK_RADIUS_PX - 0.001, point.y, bones, BOX)).toBe(0)
  })

  it('没有关节时什么也不抓', () => {
    expect(nearestBone(110, 70, [], BOX)).toBeUndefined()
  })
})

describe('关节取名', () => {
  it('空清单从 b1 起', () => {
    expect(nextBoneName([])).toBe('b1')
  })

  it('顺延到最小的空号：删掉中间那根，下一根补它的位子', () => {
    expect(nextBoneName([{ name: 'b1', x: 0, y: 0 }])).toBe('b2')
    expect(nextBoneName([{ name: 'b1', x: 0, y: 0 }, { name: 'b3', x: 0, y: 0 }])).toBe('b2')
  })

  it('用户改过名字也不撞：只认清单里真在的那些字', () => {
    expect(nextBoneName([{ name: '头', x: 0, y: 0 }, { name: 'b1', x: 0, y: 0 }])).toBe('b2')
  })
})
