/**
 * dsh-canvas — Live2D 卡的两条导出（F10.1）。
 *
 * 1. **帧序列雪碧图**：把动画**烘成图**（`sheet.png` + `sheet.json` + `README.txt`）。
 *    「导出给微信小游戏、Unity、Godot 当素材」这句话最稳的落法：帧序列是所有 2D 引擎
 *    共同的语言，AnimatedSprite2D、Sprite 动画、小游戏里的帧播放器各取所需，**逐像素
 *    与画布上看到的一致**（呼吸 / 摇摆 / 倾头 / 雕刻全在里面）。
 * 2. **DragonBones 骨架**：把**骨骼那一层**交出去（`_ske.json` + `_tex.json` + 贴图）。
 *    网格、蒙皮权重、绑定姿态与骨骼动画都带着，进 DragonBones Pro 能继续摆姿势、进引擎
 *    能接物理与换装——换来的是「可编辑」，代价是非骨骼的形变层不在里面（见
 *    `core/live2d/dragonbones.ts` 开头那段：那几种形变按顶点连续衰减，骨骼表达不了）。
 *
 * 与打包（`bundle-export.ts`）同一条分工：**能读的那一侧读，能下载的那一侧打包**——
 * 帧是浏览器里渲染出来的（WebGL 舞台 + `core/live2d/rig.ts` 的同一份算术），zip 也
 * 在浏览器里压（`CompressionStream`），整条路不依赖部署的导出能力。
 *
 * 纯与不纯的分界是刻意的：{@link spritesheetPlanOf} 与 `core/live2d/dragonbones.ts`
 * 只算数（node 判据跑它们），后面几个函数碰 `document` / `canvas.toBlob`——平台，不是逻辑。
 */

import { zipDeflated, type ZipEntry } from '../../../core/artifact/io/zip.ts'
import { fileStemOf } from '../../../core/canvas/card/card-name.ts'
import { dragonBonesPackOf } from '../../../core/live2d/dragonbones.ts'
import type { Live2dModel } from '../../../core/live2d/model.ts'
import { createLive2dStage } from '../../artifact/viewers/live2d/live2d-stage.ts'
import type { CanvasKey } from '../../ui/locales.ts'
import { platformDeflate } from './bundle-export.ts'

/** 导出 MIME：一个 zip 就是 `application/zip`。 */
export const SPRITESHEET_ZIP_MIME = 'application/zip'

/** live2d 卡的两条出路。 */
export type Live2dExportFormat = 'sheet' | 'bones'

/** 「导出」菜单里提供的格式，按展示顺序排：先最稳的那条，再给带骨架的那条。 */
export const LIVE2D_EXPORT_FORMATS: readonly Live2dExportFormat[] = ['sheet', 'bones']

/**
 * 每种格式在菜单里那行文案的字典键（与 `text-export.ts` 同一个道理：格式与文案一起改）。
 */
export const LIVE2D_EXPORT_LABEL: Record<Live2dExportFormat, CanvasKey> = {
  sheet: 'canvas.export.live2dSheet',
  bones: 'canvas.export.live2dBones',
}

/** 一张雪碧图的布局与节律——全部由此函数定，其余地方只读它的产出。 */
export interface SpritesheetPlan {
  /** 每秒多少帧。 */
  fps: number
  /** 总帧数（一个完整循环烘到底）。 */
  frameCount: number
  /** 单帧宽高（像素）。 */
  frameWidth: number
  frameHeight: number
  /** 横向排几帧。 */
  columns: number
  /** 整张雪碧图的宽高（像素）。 */
  sheetWidth: number
  sheetHeight: number
  /** 模型自己的循环时长，原样进元数据（引擎端按 `fps × frameCount` 播放即无缝）。 */
  loopSeconds: number
}

/** 帧率的出厂值：12 帧对呼吸 / 摇摆这类慢动作足够顺滑，也让帧数可控。 */
const DEFAULT_FPS = 12
/** 总帧数上限：循环很长时按它折算帧率，而不是让雪碧图长到内存装不下。 */
const MAX_FRAMES = 240
/** 单帧的目标宽：雪碧图素材 512px 宽对 2D 角色是常用档，再大收益递减。 */
const TARGET_FRAME_WIDTH = 512
/** 横向排帧数：8 列是各引擎图集工具的常见布局。 */
const COLUMNS = 8
/** 整张雪碧图任一边的上限：超过就把单帧等比缩小（GPU 纹理与内存都认这条）。 */
const MAX_SHEET_SIDE = 8192

/**
 * 烘一张雪碧图要按什么布局。
 *
 * 帧数 = `fps × loop`，向上取整到**偶数以上**（至少 2 帧：一帧的「动画」没有节律可言）；
 * 单帧按贴图比例从目标宽反推；贴图比例极端（长条横幅）时单帧等比缩小，保证整张图
 * 不超过 {@link MAX_SHEET_SIDE}——宁可单帧糊一点，不要一张导不出来的图。
 */
export function spritesheetPlanOf(model: Live2dModel, imageWidth: number, imageHeight: number): SpritesheetPlan {
  const aspect = imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : 16 / 9
  const fps = DEFAULT_FPS
  const frameCount = Math.max(2, Math.min(MAX_FRAMES, Math.round(fps * model.loop)))
  const columns = Math.min(COLUMNS, frameCount)
  const rows = Math.ceil(frameCount / columns)

  let frameWidth = Math.max(16, Math.min(TARGET_FRAME_WIDTH, Math.round(imageWidth) || TARGET_FRAME_WIDTH))
  let frameHeight = Math.max(16, Math.round(frameWidth / aspect))
  // 贴图比例极端时按雪碧图上限等比缩。下限 64px：再小就不是素材，是马赛克。
  const shrink = Math.min(1, MAX_SHEET_SIDE / (columns * frameWidth), MAX_SHEET_SIDE / (rows * frameHeight))
  if (shrink < 1) {
    frameWidth = Math.max(64, Math.floor(frameWidth * shrink))
    frameHeight = Math.max(64, Math.floor(frameHeight * shrink))
  }
  return {
    fps,
    frameCount,
    frameWidth,
    frameHeight,
    columns,
    sheetWidth: columns * frameWidth,
    sheetHeight: rows * frameHeight,
    loopSeconds: model.loop,
  }
}

/** `sheet.json` 的形状：引擎端要的每一样都在 `meta` 与 `frames` 两块里。 */
export interface SpritesheetMeta {
  meta: {
    app: 'dsh-canvas'
    format: 'dsh-live2d-lite/spritesheet@1'
    image: 'sheet.png'
    size: { w: number; h: number }
    frame: { w: number; h: number }
    fps: number
    count: number
    loopSeconds: number
    columns: number
  }
  frames: { x: number; y: number; w: number; h: number }[]
}

/** 元数据（导出端写盘、判据穷举都用它）。 */
export function spritesheetMetaOf(plan: SpritesheetPlan): SpritesheetMeta {
  const frames: SpritesheetMeta['frames'] = []
  for (let index = 0; index < plan.frameCount; index += 1) {
    frames.push({
      x: (index % plan.columns) * plan.frameWidth,
      y: Math.floor(index / plan.columns) * plan.frameHeight,
      w: plan.frameWidth,
      h: plan.frameHeight,
    })
  }
  return {
    meta: {
      app: 'dsh-canvas',
      format: 'dsh-live2d-lite/spritesheet@1',
      image: 'sheet.png',
      size: { w: plan.sheetWidth, h: plan.sheetHeight },
      frame: { w: plan.frameWidth, h: plan.frameHeight },
      fps: plan.fps,
      count: plan.frameCount,
      loopSeconds: plan.loopSeconds,
      columns: plan.columns,
    },
    frames,
  }
}

/** 三个引擎各一段能照抄的用法。写在这里而不是调用方：它是产物的一部分，跟着 zip 走。 */
function readmeText(): string {
  return [
    'dsh-canvas live2d-lite 帧序列雪碧图',
    '',
    '这个包把一段 live2d-lite 动画烘成了无缝循环的帧序列：',
    '- sheet.png —— 所有帧横向排布的雪碧图（每帧大小一致，见 sheet.json）',
    '- sheet.json —— 布局与节律（fps / 帧数 / 每帧位置）',
    '',
    '播放方法：按 sheet.json 的 fps 依次播放 frames 数组里的帧，播到第 count 帧后回到',
    '第 0 帧——动作曲线是正弦且整周期收尾，循环处没有跳变。',
    '',
    '── Godot（AnimatedSprite2D）──',
    '把 sheet.png 拖进 Godot，在导入设置里按 sheet.json 的 frame.w/frame.h 开启自动切分，',
    '新建 SpriteFrames，把帧按顺序拖进去，AnimatedSprite2D 的 speed 设为 fps。',
    '',
    '── Unity（Image / SpriteRenderer）──',
    '把 sheet.png 的 Texture Type 设为 Sprite (2D and UI)、Sprite Mode 设为 Multiple，',
    '在 Sprite Editor 里按 frame.w × frame.h Grid 切分；用 Animation 窗口按 fps 逐帧',
    '摆放，或用脚本按 time * fps % count 换 sprite。',
    '',
    '── 微信小游戏 / Canvas 2D（任意引擎）──',
    'const meta = require("./sheet.json");',
    'const frame = meta.frames[Math.floor(time * meta.meta.fps) % meta.meta.count];',
    'ctx.drawImage(sheet, frame.x, frame.y, frame.w, frame.h, dx, dy, frame.w, frame.h);',
    '',
  ].join('\n')
}

/** 把贴图 URL 读成一张加载完的图；失败回 `null`（调用方按「贴图不在」说话）。 */
export function loadLive2dTexture(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image.naturalWidth > 0 ? image : null)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

/**
 * 烘雪碧图并压成 zip。
 *
 * `save` 由调用方注入（画布那侧传 `downloadBytes`）——与打包那条同一条纪律：本模块
 * 要在浏览器里跑 GL 与 `toBlob`，但「交出去」这件事仍归调用方。
 *
 * @returns 交出去的包名与内容清单；失败（GL 不可用、编码失败）抛给调用方说。
 */
export async function exportLive2dSpritesheet(
  model: Live2dModel,
  image: HTMLImageElement,
  cardName: string,
  save: (name: string, bytes: Uint8Array, mime: string) => void,
): Promise<{ name: string; frames: number }> {
  const plan = spritesheetPlanOf(model, image.naturalWidth, image.naturalHeight)
  const meta = spritesheetMetaOf(plan)

  // 逐帧渲染：一块离屏画布跑 WebGL 舞台（与卡面 / 全屏同一份变形算术），一块 2D
  // 画布收帧。`preserveDrawingBuffer` 必须开——不保留的话 drawImage 读到的可能是
  // 已经被下一帧清掉的缓冲。
  const frameCanvas = document.createElement('canvas')
  const stage = createLive2dStage(frameCanvas, { preserveDrawingBuffer: true })
  if (stage === undefined) throw new Error('浏览器当前不可用 WebGL，帧序列烘不出来；换一个支持硬件加速的环境再试')
  stage.resize(plan.frameWidth, plan.frameHeight)

  const sheet = document.createElement('canvas')
  sheet.width = plan.sheetWidth
  sheet.height = plan.sheetHeight
  const context = sheet.getContext('2d')
  if (context === null) {
    stage.dispose()
    throw new Error('浏览器当前不可用 2D 画布，帧序列拼不出来')
  }
  context.clearRect(0, 0, sheet.width, sheet.height)

  for (let index = 0; index < plan.frameCount; index += 1) {
    const t = index / plan.fps
    stage.draw(model, image, t)
    const cell = meta.frames[index]!
    context.drawImage(frameCanvas, cell.x, cell.y, cell.w, cell.h)
  }
  stage.dispose()

  const png = await new Promise<Blob | null>((resolve) => sheet.toBlob(resolve, 'image/png'))
  if (png === null) throw new Error('雪碧图编码失败（浏览器返回了空结果）')
  const pngBytes = new Uint8Array(await png.arrayBuffer())

  const entries: ZipEntry[] = [
    { name: 'sheet.png', data: pngBytes },
    { name: 'sheet.json', data: new TextEncoder().encode(`${JSON.stringify(meta, null, 2)}\n`) },
    { name: 'README.txt', data: new TextEncoder().encode(readmeText()) },
  ]
  const bytes = await zipDeflated(entries, platformDeflate())
  const stem = fileStemOf(cardName.trim()) || fileStemOf('live2d')
  const name = `${stem}-spritesheet.zip`
  save(name, bytes, SPRITESHEET_ZIP_MIME)
  return { name, frames: plan.frameCount }
}

/** 骨架包里的 README：写清三份文件各是什么、以及**它不含哪一层**。 */
function dragonBonesReadme(stem: string): string {
  return [
    'dsh-canvas live2d-lite 骨架包（DragonBones 5.5）',
    '',
    `${stem}_ske.json —— 骨架、蒙皮网格（含顶点权重）与 idle 动画`,
    `${stem}_tex.json —— 图集（一张全幅子图，名为 body）`,
    `${stem}.png     —— 贴图（就是卡片的原图，未缩放）`,
    '',
    '── 引擎里怎么用 ──',
    'Egret / Pixi / Cocos / Laya：先解析 _ske.json，再解析 _tex.json 并把 png 作为纹理，',
    '然后 buildArmature(ske.armature[0].name)、animation.play("idle")。',
    '微信小游戏（dragonBones 运行时 + 自己的贴图加载器）同理。',
    '',
    '── DragonBones Pro ──',
    '导入 _ske.json + _tex.json（贴图放在同目录），即可在编辑器里继续加骨骼、刷权重、',
    '重排时间线；导出时选「DragonBones JSON」再回引擎。',
    '',
    '── 这个包里没有呼吸 / 摇摆 / 倾头 ──',
    '那几种形变是按顶点权重连续衰减的（离锚点越远动得越多），一根刚体骨骼表达不了；',
    '所以骨架动画只包含骨骼这一层。要连它们一起拿走，请用同一张卡片导出的雪碧图',
    '（sheet.png + sheet.json），那份与画布上看到的逐像素一致。',
    '',
  ].join('\n')
}

/**
 * 把贴图重新编码成 PNG 字节。
 *
 * 不复用原文件字节：贴图可能是 JPEG / WebP（`IMPORT` 与生成两条路都收），而各引擎的
 * DragonBones 加载器对图集纹理的常见假设是 PNG。重画一遍是唯一不依赖原格式的做法。
 */
async function pngBytesOf(image: HTMLImageElement): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, image.naturalWidth)
  canvas.height = Math.max(1, image.naturalHeight)
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('浏览器当前不可用 2D 画布，贴图转不进骨架包')
  context.drawImage(image, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (blob === null) throw new Error('贴图编码失败（浏览器返回了空结果）')
  return new Uint8Array(await blob.arrayBuffer())
}

/** 一次骨架导出的产出（包名与两个数，用来写那句「已导出」）。 */
export interface DragonBonesOutcome {
  name: string
  /** 动画帧数；0 表示这份骨架没有曲线，只有静态绑定姿态。 */
  frames: number
  /** 骨骼条数（含合成根骨）。 */
  bones: number
}

/**
 * 烘 DragonBones 骨架包并压成 zip。
 *
 * 没有骨骼的模型直接抛：这份文件的意义全在骨架，导出来会是一张静态图。调用方应当先
 * 看 `model.bones`，把话说到「先去骨骼模式加关节」上，而不是把异常抛给用户。
 */
export async function exportLive2dDragonBones(
  model: Live2dModel,
  image: HTMLImageElement,
  cardName: string,
  save: (name: string, bytes: Uint8Array, mime: string) => void,
): Promise<DragonBonesOutcome> {
  const stem = fileStemOf(cardName.trim()) || fileStemOf('live2d')
  const pack = dragonBonesPackOf(model, { width: image.naturalWidth, height: image.naturalHeight }, stem)
  if (pack === undefined) throw new Error('这份模型还没有骨骼，先到骨骼模式加几根关节再导出')
  const encoder = new TextEncoder()
  const entries: ZipEntry[] = [
    { name: `${stem}_ske.json`, data: encoder.encode(JSON.stringify(pack.skeleton)) },
    { name: `${stem}_tex.json`, data: encoder.encode(`${JSON.stringify(pack.atlas, null, 2)}\n`) },
    { name: `${stem}.png`, data: await pngBytesOf(image) },
    { name: 'README.txt', data: encoder.encode(dragonBonesReadme(stem)) },
  ]
  const bytes = await zipDeflated(entries, platformDeflate())
  const name = `${stem}-dragonbones.zip`
  save(name, bytes, SPRITESHEET_ZIP_MIME)
  return { name, frames: pack.frameCount, bones: pack.boneCount }
}
