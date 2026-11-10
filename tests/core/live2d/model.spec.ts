/**
 * dsh-canvas — live2d-lite 模型格式的判据（F2.7 第四种产物）。
 *
 * 钉四件事：
 * 1. **归一是唯一入口**：读不懂的整份拒绝、缺省补齐、非法值收敛——宿主写盘、客户端渲染、
 *    导出打包读到的都是同一个函数的产出；
 * 2. **`.live2d.json` 的形态认定**：detectKind 在 `json` → data 之前认出它，`data` 表
 *    不许把它抢走；
 * 3. **产物目录**：live2d 进 `live2d/`，四个入口同源（artifact-folders 一张表）；
 * 4. **贴图路径**：相对引用、根相对引用、穿越拒绝——模型里那个 `texture` 字段是这张卡
 *    连着外部世界的一根线，两头都要判。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOOP_SECONDS,
  DEFAULT_MOTIONS,
  DEFORM_MAX,
  LIVE2D_EXTENSION,
  LIVE2D_FORMAT,
  defaultTexturePathOf,
  normalizeLive2dModel,
  serializeLive2dModel,
  texturePathOf,
  textureReferenceOf,
} from '../../../src/core/live2d/model.ts'
import { detectKind, isLive2dKind, kindById, outlineOf } from '../../../src/core/artifact/kind/kind-registry.ts'
import { ARTIFACT_FOLDERS, artifactPathOf } from '../../../src/core/canvas/project/artifact-folders.ts'

describe('live2d-lite 模型 — 归一', () => {
  it('一份最小 JSON 就是一份能跑的模型（只有 format 与 texture 也在）', () => {
    const model = normalizeLive2dModel({ format: LIVE2D_FORMAT, texture: '少女.png' })
    expect(model).toBeDefined()
    expect(model?.loop).toBe(DEFAULT_LOOP_SECONDS)
    expect(model?.anchor).toEqual({ x: 0.5, y: 1 })
    expect(model?.breath).toEqual(DEFAULT_MOTIONS.breath)
    expect(model?.sway).toEqual(DEFAULT_MOTIONS.sway)
    expect(model?.tilt).toEqual(DEFAULT_MOTIONS.tilt)
    expect(model?.prompt).toBe('')
  })

  it('格式不对（或没写）的整份拒绝——猜一个格式比拒绝更坏', () => {
    expect(normalizeLive2dModel({ texture: 'a.png' })).toBeUndefined()
    expect(normalizeLive2dModel({ format: 'cubism', texture: 'a.moc3' })).toBeUndefined()
    expect(normalizeLive2dModel(undefined)).toBeUndefined()
    expect(normalizeLive2dModel(null)).toBeUndefined()
    expect(normalizeLive2dModel('not an object' as unknown as Record<string, unknown>)).toBeUndefined()
  })

  it('没有贴图的模型是一具空壳，也拒绝——渲染无从谈起', () => {
    expect(normalizeLive2dModel({ format: LIVE2D_FORMAT })).toBeUndefined()
    expect(normalizeLive2dModel({ format: LIVE2D_FORMAT, texture: '   ' })).toBeUndefined()
  })

  it('更高版本如实拒绝，而不是猜它长什么样', () => {
    expect(normalizeLive2dModel({ format: LIVE2D_FORMAT, version: 2, texture: 'a.png' })).toBeUndefined()
    expect(normalizeLive2dModel({ format: LIVE2D_FORMAT, version: 1, texture: 'a.png' })).toBeDefined()
  })

  it('离谱的数值收敛进界内：循环时长、拍数取整、振幅与相位夹紧', () => {
    const model = normalizeLive2dModel({
      format: LIVE2D_FORMAT,
      texture: 'a.png',
      loop: 0.01,
      motions: { breath: { cycles: 2.6, amplitude: 5, phase: -3 } },
    })
    expect(model?.loop).toBe(1)
    expect(model?.breath.cycles).toBe(3)
    expect(model?.breath.amplitude).toBe(0.2)
    expect(model?.breath.phase).toBe(0)
  })

  it('循环上限 60s：太长的循环是配置错误，不是创意', () => {
    const model = normalizeLive2dModel({ format: LIVE2D_FORMAT, texture: 'a.png', loop: 999 })
    expect(model?.loop).toBe(60)
  })

  it('拍数必须是整数（无缝循环的性质靠它），四舍五入到最近的整数', () => {
    const model = normalizeLive2dModel({
      format: LIVE2D_FORMAT,
      texture: 'a.png',
      motions: { sway: { cycles: 1.2, amplitude: 0.01 } },
    })
    expect(model?.sway.cycles).toBe(1)
  })

  it('关键帧：t 量化到千分位、v 夹进 [-1,1]，按 t 排序；凑不足两键不算曲线', () => {
    const model = normalizeLive2dModel({
      format: LIVE2D_FORMAT,
      texture: 'a.png',
      motions: {
        breath: {
          cycles: 1,
          amplitude: 0.01,
          keys: [
            { t: 0.99999, v: 5 },
            { t: 0.123456, v: -0.5 },
          ],
        },
      },
    })
    // 排序 + 量化 + 夹边，全部在归一里完成。
    expect(model?.breath.keys).toEqual([
      { t: 0.123, v: -0.5 },
      { t: 0.999, v: 1 },
    ])
    expect(normalizeLive2dModel({
      format: LIVE2D_FORMAT,
      texture: 'a.png',
      motions: { breath: { cycles: 1, amplitude: 0.01, keys: [{ t: 0.5, v: 1 }] } },
    })?.breath.keys).toBeUndefined()
    expect(normalizeLive2dModel({
      format: LIVE2D_FORMAT,
      texture: 'a.png',
      motions: { breath: { cycles: 1, amplitude: 0.01, keys: 'nope' } },
    })?.breath.keys).toBeUndefined()
  })

  it('雕刻表：坏键剔除、位移夹进 ±DEFORM_MAX、空表整体收掉、键按字典序落盘', () => {
    const model = normalizeLive2dModel({
      format: LIVE2D_FORMAT,
      texture: 'a.png',
      deform: {
        offsets: {
          '12,6': [0.5, -0.5],
          'not-a-vertex': [0.1, 0.1],
          '3,4': [-0.02, 0.03],
        },
      },
    })
    expect(model?.deform?.offsets).toEqual({
      '3,4': [-0.02, 0.03],
      '12,6': [DEFORM_MAX, -DEFORM_MAX],
    })
    expect(normalizeLive2dModel({ format: LIVE2D_FORMAT, texture: 'a.png', deform: { offsets: {} } })?.deform).toBeUndefined()
    expect(normalizeLive2dModel({ format: LIVE2D_FORMAT, texture: 'a.png', deform: 'nope' })?.deform).toBeUndefined()
  })

  it('序列化带雕刻：deform 在 motions 之后、prompt 之前，回环逐字节稳定', () => {
    const model = normalizeLive2dModel({
      format: LIVE2D_FORMAT,
      texture: 'a.png',
      deform: { offsets: { '2,2': [0.01, 0.02], '10,5': [0, -0.01] } },
    })!
    const text = serializeLive2dModel(model)
    expect(text.indexOf('"deform"')).toBeGreaterThan(text.indexOf('"motions"'))
    expect(text.indexOf('"deform"')).toBeLessThan(text.indexOf('"prompt"'))
    expect(serializeLive2dModel(normalizeLive2dModel(JSON.parse(text))!)).toBe(text)
    expect(serializeLive2dModel(normalizeLive2dModel({ format: LIVE2D_FORMAT, texture: 'a.png' })!)).not.toContain('"deform"')
  })
})

describe('live2d-lite 模型 — 序列化', () => {
  it('字段顺序固定，同一模型两次序列化逐字节相同', () => {
    const raw = { format: LIVE2D_FORMAT, texture: '少女.png', prompt: '一只猫' }
    const first = serializeLive2dModel(normalizeLive2dModel(raw)!)
    const second = serializeLive2dModel(normalizeLive2dModel(raw)!)
    expect(first).toBe(second)
    // 序列化出来的文本归一回去还是同一个模型——写盘与读盘走闭环。
    expect(normalizeLive2dModel(JSON.parse(first))).toEqual(normalizeLive2dModel(raw))
  })
})

describe('live2d-lite 模型 — 贴图路径', () => {
  it('裸文件名以模型所在目录为基准', () => {
    expect(texturePathOf('live2d/少女.live2d.json', '少女.png')).toBe('live2d/少女.png')
    expect(texturePathOf('少女.live2d.json', '少女.png')).toBe('少女.png')
  })

  it('`/` 开头是项目根相对，原样收下', () => {
    expect(texturePathOf('live2d/少女.live2d.json', '/images/少女.png')).toBe('images/少女.png')
  })

  it('`..` 逐段上收，收出项目根就是拒绝', () => {
    expect(texturePathOf('live2d/子/少女.live2d.json', '../少女.png')).toBe('live2d/少女.png')
    expect(texturePathOf('少女.live2d.json', '../少女.png')).toBeUndefined()
  })

  it('生成时贴图落在模型同目录、同词干的 .png 上', () => {
    expect(defaultTexturePathOf('live2d/少女.live2d.json')).toBe('live2d/少女.png')
    expect(defaultTexturePathOf('少女.live2d.json')).toBe('少女.png')
  })

  it('贴图引用：同目录写裸文件名（搬目录不断链），否则写根相对', () => {
    expect(textureReferenceOf('live2d/少女.live2d.json', 'live2d/少女.png')).toBe('少女.png')
    expect(textureReferenceOf('live2d/少女.live2d.json', 'images/上游.png')).toBe('/images/上游.png')
  })
})

describe('live2d 的形态认定', () => {
  it('`.live2d.json` 按 basename 认出 live2d，不许被 `json` → data 抢走', () => {
    const probe = {
      path: 'live2d/少女.live2d.json',
      directory: false,
      basename: `少女${LIVE2D_EXTENSION}`,
      extension: 'json',
      head: '{}',
      children: [],
    }
    expect(detectKind(probe)).toBe('live2d')
    expect(isLive2dKind('live2d')).toBe(true)
    expect(kindById('live2d')?.label).toBe('Live2D')
  })

  it('普通的 .json 照旧是 data——两条判据不许互相吞', () => {
    const probe = {
      path: 'data/表格.json',
      directory: false,
      basename: '表格.json',
      extension: 'json',
      head: '{}',
      children: [],
    }
    expect(detectKind(probe)).toBe('data')
  })

  it('产物目录：live2d 进 live2d/，建卡路径由同一张表拼出', () => {
    expect(ARTIFACT_FOLDERS.live2d).toBe('live2d')
    expect(artifactPathOf('live2d', '少女', 'live2d.json')).toBe('live2d/少女.live2d.json')
  })

  it('摘要大纲：贴图、循环、动作名单', () => {
    const json = serializeLive2dModel(normalizeLive2dModel({ format: LIVE2D_FORMAT, texture: '少女.png' })!)
    expect(outlineOf('live2d', json)).toEqual(['贴图 少女.png', `循环 ${DEFAULT_LOOP_SECONDS}s`, 'breath', 'sway', 'tilt'])
    expect(outlineOf('live2d', '{{{')).toEqual([])
  })
})
