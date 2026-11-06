/**
 * 媒体编辑台参数的归一与导演指令（媒体编辑台）。
 *
 * 这里验的是**三件写错了不会本地报错、只会静默变味的东西**：
 *
 * 1. **归一**：面板送上来的一包原始值里有空串、没设的字段、认不出的档位——收敛成
 *    「只存差异」的形状。这条判据失守的表现是记录里出现 `{}` 与垃圾档位，而
 *    「没设过」从此与「设过但全空」分不清（同一个东西两个来源的又一次温床）。
 * 2. **编辑指令**：三种模式各写一句什么。这句话直接进 prompt，写错一个字就是一张不一样的图。
 * 3. **相机指令**：`fixed` 必须回空串——它走协议字段 `camera_fixed`，两种去向混在
 *    一处就会一条请求里既改 prompt 又改字段。
 */
import { describe, expect, it } from 'vitest'
import {
  cameraPromptOf,
  imageBackgroundPromptOf,
  imageEditPromptOf,
  imageQualityPromptOf,
  imageSizeOf,
  normalizeMediaParams,
} from '../../../src/core/media/editing.ts'

describe('normalizeMediaParams', () => {
  it('什么都没设就是 undefined，而不是一包空参数', () => {
    expect(normalizeMediaParams(undefined)).toBeUndefined()
    expect(normalizeMediaParams(null)).toBeUndefined()
    expect(normalizeMediaParams({})).toBeUndefined()
    expect(normalizeMediaParams({ editMode: '', maskPath: '  ' })).toBeUndefined()
  })

  it('空串、空白与非字符串都算「没给」，设过的字段原样保留（trim）', () => {
    expect(
      normalizeMediaParams({
        editMode: 'inpaint',
        maskPath: ' images/mask.png ',
        outpaintSize: '',
        firstFramePath: undefined,
        lastFramePath: 'data:image/png;base64,AAAA',
      }),
    ).toEqual({
      editMode: 'inpaint',
      maskPath: 'images/mask.png',
      lastFramePath: 'data:image/png;base64,AAAA',
    })
  })

  it('认不出的档位丢掉，而不是替用户改写成最近似的那一档', () => {
    expect(normalizeMediaParams({ editMode: 'in-paint' })).toBeUndefined()
    expect(normalizeMediaParams({ camera: 'zoom_crazy' })).toBeUndefined()
    // 首尾帧路径是自由字符串：不做档位判断，只去空白。
    expect(normalizeMediaParams({ camera: 'fixed', firstFramePath: 'images/a.png' })).toEqual({
      camera: 'fixed',
      firstFramePath: 'images/a.png',
    })
  })

  it('生成参数五组档位各认各的；数字数量只收 1/2/4', () => {
    expect(
      normalizeMediaParams({
        quality: ' ultra ',
        resolution: '2K',
        background: 'transparent',
        ratio: '21:9',
        count: 4,
      }),
    ).toEqual({ quality: 'ultra', resolution: '2K', background: 'transparent', ratio: '21:9', count: 4 })
    // 数量是数值档位：小数、字符串数字、清单外的数都算「没给」——面板只发 1/2/4，
    // 手改的板面文件里出现 3 不该被当成设过。
    expect(normalizeMediaParams({ count: 3 })).toBeUndefined()
    expect(normalizeMediaParams({ count: '4' })).toBeUndefined()
    expect(normalizeMediaParams({ count: 2.5 })).toBeUndefined()
    expect(normalizeMediaParams({ ratio: '7:3' })).toBeUndefined()
    expect(normalizeMediaParams({ resolution: '8K' })).toBeUndefined()
  })
})

describe('imageEditPromptOf', () => {
  it('没设模式就一句话都不说', () => {
    expect(imageEditPromptOf(undefined)).toBe('')
    expect(imageEditPromptOf({})).toBe('')
  })

  it('三种模式各写各的指令；扩图带目标尺寸', () => {
    expect(imageEditPromptOf({ editMode: 'inpaint' })).toContain('蒙版')
    expect(imageEditPromptOf({ editMode: 'outpaint', outpaintSize: '2048x2048' })).toContain('2048x2048')
    // 没给目标尺寸的扩图也要成句：那句话本来就是给模型的，空着说等于没说。
    expect(imageEditPromptOf({ editMode: 'outpaint' })).toContain('扩展')
    expect(imageEditPromptOf({ editMode: 'matting' })).toContain('透明')
  })
})

describe('cameraPromptOf', () => {
  it('fixed 回空串——它走协议字段 camera_fixed，不是一句话', () => {
    expect(cameraPromptOf('fixed')).toBe('')
    expect(cameraPromptOf(undefined)).toBe('')
  })

  it('每个运镜档位都成句：这句话直接进 prompt，写错一个字就是另一种片子', () => {
    for (const mode of ['push_in', 'pull_out', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down'] as const) {
      const directive = cameraPromptOf(mode)
      expect(directive, mode).not.toBe('')
      expect(directive.startsWith('，'), mode).toBe(true)
    }
  })
})

describe('imageQualityPromptOf / imageBackgroundPromptOf', () => {
  it('默认档（standard / auto）回空串——默认行为多说一个字都是噪音', () => {
    expect(imageQualityPromptOf(undefined)).toBe('')
    expect(imageQualityPromptOf('standard')).toBe('')
    expect(imageBackgroundPromptOf(undefined)).toBe('')
    expect(imageBackgroundPromptOf('auto')).toBe('')
  })

  it('其余档位各成一句，且以「，」起头（追加在 prompt 之后的写法）', () => {
    for (const quality of ['low', 'high', 'ultra', 'extreme'] as const) {
      expect(imageQualityPromptOf(quality), quality).toMatch(/^，/)
    }
    expect(imageBackgroundPromptOf('keep')).toMatch(/^，/)
    expect(imageBackgroundPromptOf('transparent')).toContain('透明')
  })
})

describe('imageSizeOf', () => {
  it('两样都没设就是 undefined——请求体里不写 size，完全交给模型', () => {
    expect(imageSizeOf(undefined, undefined)).toBeUndefined()
  })

  it('只设清晰度：直接给协议认识的 token，画幅由模型自定', () => {
    expect(imageSizeOf('2K', undefined)).toBe('2K')
    expect(imageSizeOf('4K', undefined)).toBe('4K')
  })

  it('设了比例：换算成像素 WxH——比例是硬约束，token 表达不了 21:9', () => {
    // 2K 基准 2048：16:9 → 宽 2048×√(16/9)≈2731→2720（32 对齐），高 2048×√(9/16)≈1536。
    expect(imageSizeOf('2K', '16:9')).toBe('2720x1536')
    // 方图就是基准本身。
    expect(imageSizeOf('2K', '1:1')).toBe('2048x2048')
    // 没设清晰度按 2K。
    expect(imageSizeOf(undefined, '1:1')).toBe('2048x2048')
    // 1K 基准 1024 的竖图：宽 1024×3/4=768，高 1024×4/3≈1365→1376（32 对齐）。
    expect(imageSizeOf('1K', '9:16')).toBe('768x1376')
  })

  it('解析不动的比例退回 token，而不是发一个服务端消化不了的值', () => {
    expect(imageSizeOf('2K', '0:3' as never)).toBe('2K')
  })
})
