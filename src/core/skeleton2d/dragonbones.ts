/**
 * dsh-canvas — skeleton2d-lite 的**骨骼数据出口**：DragonBones 5.5（纯，零依赖）。
 *
 * 为什么是 DragonBones 而不是 Spine：Spine 的运行时许可绑在编辑器上（要拿到 Spine 授权
 * 才能合法分发运行时），而 DragonBones 的 JSON 格式与运行时都是开源、且微信小游戏官方
 * 支持。所以「带骨架的素材」这一半走 DragonBones：`_ske.json`（骨架 + 蒙皮网格 + 动画）
 * + `_tex.json`（图集）+ 贴图，三件一起丢进引擎或 DragonBones Pro 就能打开。
 *
 * 形状对齐的是**运行时解析器的读法**（`ObjectDataParser._parseMesh` 与 `_parseBoneRotateFrame`），
 * 不是文档里的一句话：
 *
 * - `weights` 逐顶点 `[骨数, 骨号, 权重, 骨号, 权重, …]`，`骨号` 是 `bone` 数组的**下标**；
 * - `bonePose` 每骨 7 个数 `[骨号, a, b, c, d, tx, ty]`，矩阵是该骨**绑定姿态的世界矩阵**
 *   （本模型里骨骼只平移+旋转、不缩放，所以是纯平移 `[1,0,0,1,ox,oy]`）；
 * - 顶点按 `slotPose`（槽的世界矩阵，这里取单位矩阵：槽挂在原点的根骨上）变换后，再被
 *   每根骨的绑定矩阵求逆，得到「骨内坐标」——运行时用**动画中的**骨矩阵乘回去，正是
 *   `bones.ts` 的 `skinAt` 那套线性混合蒙皮。两边的算术因此逐点一致（判据钉在
 *   `tests/core/skeleton2d/dragonbones.spec.ts`：从导出的 JSON 反算顶点，与 `poseAt` 比对）；
 * - 动画逐帧烘成 `rotateFrame`（度），`duration` = 帧数，`playTimes: 0` 循环——与雪碧图
 *   同一条「正弦整周期」的无缝性质，循环处没有跳变。
 *
 * **骨架只装骨骼能表达的那一半**：呼吸 / 摇摆 / 倾头 / 网格雕刻不是骨骼驱动的（它们按
 * 顶点权重连续衰减），而 DragonBones 的网格顶点动画（FFD）各家运行时实现不一、且会被
 * 骨骼动画二次叠加——烘进去只会得到「看起来像但不完全一样」的东西。所以这里只导出骨骼
 * 与骨骼曲线，**要逐像素一致的动画请用雪碧图那条**（`skeleton2d-export.ts` 的另一支）。
 *
 * 本模块是纯的：不碰 canvas、不碰文件，输入模型与贴图尺寸，输出两份 JSON 的内容。
 */

import { boneRotationAt, boneWeightsAt } from './bones.ts'
import type { Skeleton2dModel } from './model.ts'
import { GRID_COLS, GRID_ROWS, gridIndices } from './rig.ts'

/** 写进 JSON 的格式版本：运行时认 4.0 / 4.5 / 5.0 / 5.5，5.5 是当前的默认。 */
export const DRAGONBONES_VERSION = '5.5'

/** 烘帧的帧率：24 是 DragonBones 自己的出厂帧率，也是各引擎 2D 动画的常见档。 */
export const DRAGONBONES_FPS = 24

/** 总帧数上限：循环再长也不让文件爆掉（与雪碧图的 240 帧同一个道理，只是骨架更省）。 */
export const DRAGONBONES_MAX_FRAMES = 720

/** 合成根骨的名字：所有没有父级的模型骨骼都挂在它下面，槽也挂在它上面（世界矩阵＝单位阵）。 */
export const DRAGONBONES_ROOT = 'root'

/** 槽与显示对象的名字：一张贴图就是一层，名字不带信息，只求各平台都认。 */
export const DRAGONBONES_SLOT = 'body'

/** 动画名：`idle` 是各引擎默认播放的那一支。 */
export const DRAGONBONES_ANIMATION = 'idle'

/** 贴图的像素尺寸（导出时由调用方从前端 decode 出来的图上取）。 */
export interface DragonBonesSize {
  width: number
  height: number
}

/** 一次导出要落的三份东西里的两份 JSON（第三份是贴图本身）。 */
export interface DragonBonesPack {
  /** `_ske.json`：骨架、蒙皮网格、动画。 */
  skeleton: Record<string, unknown>
  /** `_tex.json`：图集（一张全幅子图，名字与网格显示的 path 一致）。 */
  atlas: Record<string, unknown>
  /** 骨架名（armature 名，也是 `_tex.json` 的 name）。 */
  armatureName: string
  /** 骨骼条数（含合成根骨）。 */
  boneCount: number
  /** 铺了旋转曲线的骨骼条数；0 表示这份模型只有静态骨架。 */
  animatedCount: number
  /** `idle` 的帧数（= duration）；没有曲线时是 0。 */
  frameCount: number
  /** 写进 `frameRate` 的值（长循环会被压到 24 以下，好让 duration 仍等于 loop 秒）。 */
  frameRate: number
}

/** 定点数：JSON 里不需要 15 位尾数，四位小数对像素级素材绰绰有余，也能把文件压小一半。 */
function fixed(value: number, digits = 4): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

/**
 * 骨架名：卡片名去掉文件系统与各平台都不爱的字符。
 *
 * 不做 ASCII 化——中文名在各个引擎里都是普通字符串，改掉反而让用户在代码里找不到它。
 * 只把空格、引号、斜杠这类会坏事的字符换成下划线；实在没剩东西就叫 `Armature`。
 */
export function armatureNameOf(stem: string): string {
  const cleaned = stem.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned === '' ? 'Armature' : cleaned
}

/**
 * 模型 + 贴图尺寸 → DragonBones 的两份 JSON。
 *
 * 没有骨骼就返回 `undefined`：这份文件的意义全在骨架，没骨架导出来是一张静态图，
 * 不如让调用方直说「先在骨骼模式绑几个关节」。
 */
export function dragonBonesPackOf(model: Skeleton2dModel, size: DragonBonesSize, stem: string): DragonBonesPack | undefined {
  const bones = model.bones
  if (bones === undefined || bones.length === 0) return undefined
  const width = Math.max(1, Math.round(size.width))
  const height = Math.max(1, Math.round(size.height))
  const armatureName = armatureNameOf(stem)

  // ── 骨骼：合成根骨 + 模型骨骼（局部偏移 = 自己的 rest 减父级的 rest）。
  const rawIndex = (index: number): number => index + 1
  const boneEntries: Record<string, unknown>[] = [{ name: DRAGONBONES_ROOT, transform: { x: 0, y: 0 } }]
  for (const bone of bones) {
    const parent = bone.parent === undefined ? undefined : bones.find((entry) => entry.name === bone.parent)
    const offsetX = (bone.x - (parent?.x ?? 0)) * width
    const offsetY = (bone.y - (parent?.y ?? 0)) * height
    boneEntries.push({
      name: bone.name,
      ...(parent === undefined ? {} : { parent: parent.name }),
      transform: { x: fixed(offsetX), y: fixed(offsetY) },
    })
  }

  // ── 网格：顶点、uv、三角索引、蒙皮权重（与卡面同一份 `boneWeightsAt`）。
  const cols = GRID_COLS
  const rows = GRID_ROWS
  const vertices: number[] = []
  const uvs: number[] = []
  const weights: number[] = []
  const usedBones = new Set<number>()
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      const su = col / cols
      const sv = row / rows
      const px = fixed(su * width)
      const py = fixed(sv * height)
      vertices.push(px, py)
      // uv 从**落盘的像素**反推，不各自舍入：两个数描述的是同一个点，各舍各的会在
      // 1024px 的贴图上差出 0.05px（不可见，但没必要留着——判据要拿它对齐）。
      uvs.push(fixed(px / width, 6), fixed(py / height, 6))
      const share = boneWeightsAt(bones, su, sv)
      const pairs: [number, number][] = []
      for (let index = 0; index < share.length; index += 1) {
        const weight = share[index] as number
        if (weight > 0) pairs.push([index, weight])
      }
      // 末一根用 1 减前面几根，保证权重和**逐位**是 1（各舍各的会留下 1e-4 的缝隙，
      // 蒙皮在 1024px 的贴图上就是零点几像素的漂移）。
      weights.push(pairs.length)
      let assigned = 0
      for (let index = 0; index < pairs.length; index += 1) {
        const [boneIndex, weight] = pairs[index] as [number, number]
        const value = index === pairs.length - 1 ? fixed(1 - assigned, 6) : fixed(weight, 6)
        assigned += value
        weights.push(rawIndex(boneIndex), value)
        usedBones.add(boneIndex)
      }
    }
  }

  // ── 绑定姿态：只列被权重引用到的骨骼，矩阵是它 rest 时的世界矩阵（纯平移）。
  const bonePose: number[] = []
  for (const index of [...usedBones].sort((a, b) => a - b)) {
    const bone = bones[index] as { x: number; y: number }
    bonePose.push(rawIndex(index), 1, 0, 0, 1, fixed(bone.x * width), fixed(bone.y * height))
  }

  // ── 动画：把每根骨的旋转曲线按帧率烘成度。帧数与帧率同源，长循环压帧率不压时长。
  const fps = model.loop * DRAGONBONES_FPS > DRAGONBONES_MAX_FRAMES ? DRAGONBONES_MAX_FRAMES / model.loop : DRAGONBONES_FPS
  const frameCount = Math.max(2, Math.min(DRAGONBONES_MAX_FRAMES, Math.round(model.loop * fps)))
  const frameRate = fixed(frameCount / model.loop, 2)
  const tracks: Record<string, unknown>[] = []
  for (const bone of bones) {
    const rot = model.boneTracks?.[bone.name]?.rot
    if (rot === undefined || rot.length < 2) continue
    const frames: Record<string, unknown>[] = []
    for (let index = 0; index < frameCount; index += 1) {
      // 时间按「帧序号 / 总帧数 × 循环时长」取，而不是 `index / frameRate`：frameRate 落了
      // 两位小数，拿它除会在长循环末尾差出几毫秒，而这条乘法**恒好**落在 [0, loop) 上。
      const seconds = (index / frameCount) * model.loop
      const radians = boneRotationAt(rot, seconds, model.loop)
      frames.push({ duration: 1, tweenEasing: 0, rotate: fixed((radians * 180) / Math.PI, 3) })
    }
    tracks.push({ name: bone.name, rotateFrame: frames })
  }

  const skeleton: Record<string, unknown> = {
    frameRate,
    name: armatureName,
    version: DRAGONBONES_VERSION,
    compatibleVersion: DRAGONBONES_VERSION,
    armature: [
      {
        type: 'Armature',
        frameRate,
        name: armatureName,
        aabb: { x: 0, y: 0, width, height },
        bone: boneEntries,
        slot: [{ name: DRAGONBONES_SLOT, parent: DRAGONBONES_ROOT, displayIndex: 0 }],
        skin: [
          {
            name: '',
            slot: [
              {
                name: DRAGONBONES_SLOT,
                display: [
                  {
                    name: DRAGONBONES_SLOT,
                    path: DRAGONBONES_SLOT,
                    type: 'mesh',
                    width,
                    height,
                    vertices,
                    uvs,
                    triangles: [...gridIndices(cols, rows)],
                    weights,
                    slotPose: [1, 0, 0, 1, 0, 0],
                    bonePose,
                  },
                ],
              },
            ],
          },
        ],
        ...(tracks.length === 0
          ? {}
          : {
              animation: [
                {
                  name: DRAGONBONES_ANIMATION,
                  duration: frameCount,
                  playTimes: 0,
                  bone: tracks,
                },
              ],
            }),
      },
    ],
  }

  const atlas: Record<string, unknown> = {
    name: armatureName,
    imagePath: `${stem}.png`,
    width,
    height,
    SubTexture: [{ name: DRAGONBONES_SLOT, x: 0, y: 0, width, height }],
  }

  return {
    skeleton,
    atlas,
    armatureName,
    boneCount: boneEntries.length,
    animatedCount: tracks.length,
    frameCount: tracks.length === 0 ? 0 : frameCount,
    frameRate,
  }
}
