/**
 * dsh-canvas — skeleton2d 编辑器网格模式的判据。
 *
 * 拾取与拖拽是编辑器的手感所在：点偏了抓不到、抓住了拖不动、拖出去越了界，任何一条
 * 出问题用户都会说「这个编辑器没法用」。这里的判据按真实交互形态写——点击落点、
 * 贴合盒、位移上限，都是真机传进来的形状。
 */
import { describe, expect, it } from 'vitest'
import { DEFORM_MAX } from '../../../src/core/skeleton2d/model.ts'
import { GRID_COLS, GRID_ROWS } from '../../../src/core/skeleton2d/rig.ts'
import { containLayout } from '../../../src/client/artifact/viewers/skeleton2d/skeleton2d-editor-layout.ts'
import { dragOffset, isZeroOffset, nearestVertex, vertexPixel } from '../../../src/client/artifact/viewers/skeleton2d/skeleton2d-mesh.ts'

/** 一个 400×300 的编辑台，贴图 1:1——贴合盒就是正中 300×300。 */
const BOX = containLayout(1, 400, 300)

describe('顶点定位', () => {
  it('网格顶点均匀铺在贴合盒里：四角与中心都在该在的位置', () => {
    expect(vertexPixel(0, 0, BOX)).toEqual({ x: BOX.left, y: BOX.top })
    expect(vertexPixel(GRID_COLS, GRID_ROWS, BOX)).toEqual({
      x: BOX.left + BOX.width,
      y: BOX.top + BOX.height,
    })
    expect(vertexPixel(GRID_COLS / 2, GRID_ROWS / 2, BOX)).toEqual({
      x: BOX.left + BOX.width / 2,
      y: BOX.top + BOX.height / 2,
    })
  })
})

describe('顶点拾取', () => {
  it('点在顶点上抓得到，点在空白处抓不到（空点 = 误触，不该有任何反应）', () => {
    const hit = vertexPixel(12, 12, BOX)
    expect(nearestVertex(hit.x, hit.y, BOX)).toEqual({ col: 12, row: 12 })
    // 两顶点之间空档的中央（半个格胞之外）：间距远超拾取半径。
    const between = vertexPixel(6, 6, BOX)
    expect(nearestVertex(between.x + BOX.width / GRID_COLS / 2, between.y + BOX.height / GRID_ROWS / 2, BOX)).toBeUndefined()
  })

  it('拾取永远选最近的那颗：偏过半格就改抓下一颗，不会同时认两颗', () => {
    const hit = vertexPixel(8, 8, BOX)
    // 网格很密（12.5px 一格）：偏出半格后最近的是下一颗——这正是「跟手」的来源。
    expect(nearestVertex(hit.x + 7, hit.y, BOX)).toEqual({ col: 9, row: 8 })
    // 半格对角的中点（≈8.8px）离两颗都超过半径 8：真空区，空手而归。
    expect(nearestVertex(hit.x + BOX.width / GRID_COLS / 2, hit.y + BOX.height / GRID_ROWS / 2, BOX)).toBeUndefined()
  })

  it('letterbox 区的点抓不到——顶点只存在于贴图上', () => {
    expect(nearestVertex(10, 10, BOX)).toBeUndefined()
    expect(nearestVertex(390, 290, BOX)).toBeUndefined()
  })
})

describe('拖拽位移', () => {
  it('位移 = 目标 uv − 顶点原位，方向与像素直觉一致', () => {
    const start = vertexPixel(10, 10, BOX)
    const [du, dv] = dragOffset(start.x + 10, start.y - 5, 10, 10, BOX, DEFORM_MAX)
    expect(du).toBeCloseTo(10 / BOX.width, 12)
    expect(dv).toBeCloseTo(-5 / BOX.height, 12)
  })

  it('拖太远夹进 ±DEFORM_MAX——雕刻是造型，不是撕图', () => {
    const start = vertexPixel(5, 5, BOX)
    const [du, dv] = dragOffset(start.x + 500, start.y - 500, 5, 5, BOX, DEFORM_MAX)
    expect(du).toBe(DEFORM_MAX)
    expect(dv).toBe(-DEFORM_MAX)
  })

  it('回到原位的顶点位移为零，不该再占稀疏表的一行', () => {
    expect(isZeroOffset([0, 0])).toBe(true)
    expect(isZeroOffset([0.0001, 0])).toBe(false)
  })
})
