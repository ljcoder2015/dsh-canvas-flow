/**
 * 方舟媒体接口的请求体与响应（F2.7）。
 *
 * 这个文件验的是**四样最容易抄错、而抄错了不会在本地报错的东西**：图片请求体的形状、
 * 图片响应的三种长相（url / base64 / 出错）、视频任务请求体里「哪些字段给了才传」、
 * 以及**成片地址的两副长相**。
 *
 * 为什么这些值得单独穷举：它们的失败长在**对面**。一个多传的 `size: ''` 会换回 400，
 * 一句拼错的 `response_format` 会让响应从 url 变成 base64（而两条路的下游完全不同），
 * 漏掉一种 `video_url` 形态会让「任务明明成功了」读成「找不到视频地址」。这些在真机上
 * 都要花钱、花时间才能撞到一次，在单测里是几行。
 */
import { describe, expect, it } from 'vitest'
import {
  arkAudioBody,
  arkAudioModelOf,
  arkImageBody,
  arkVideoBody,
  audioFormatOf,
  isTerminalStatus,
  MEDIA_EXTENSIONS,
  readAudioResult,
  readImageResult,
  readTaskId,
  readTaskResult,
} from '../../../src/core/media/ark.ts'

describe('ark image request', () => {
  it('always asks for a url and never sends blank optional fields', () => {
    expect(arkImageBody({ model: 'doubao-seedream-4-0', prompt: '一只鲸鱼' })).toEqual({
      model: 'doubao-seedream-4-0',
      prompt: '一只鲸鱼',
      response_format: 'url',
      watermark: false,
    })
  })

  it('never asks for a watermark — the artifact belongs to the user', () => {
    // 这个字段在服务端**默认 true**（右下角一枚「AI 生成」），所以「不写」不等于「不要」，
    // 必须显式写成 false。视频那条一开始就写了，图片这条是照文档核对时才发现的。
    expect(arkImageBody({ model: 'm', prompt: 'p' })['watermark']).toBe(false)
  })

  it('aligns the output format with the extension the artifact path already declares', () => {
    // 服务端默认 jpeg，而产物路径可能叫 `.png`——不写它就会把 jpeg 字节写进 png 文件。
    expect(arkImageBody({ model: 'm', prompt: 'p', format: 'png' })['output_format']).toBe('png')
    expect(arkImageBody({ model: 'm', prompt: 'p', format: 'JPEG' })['output_format']).toBe('jpeg')
    // 认不出的格式不表态：让服务端用它自己的默认，别替它猜一个它不认的名字。
    expect(arkImageBody({ model: 'm', prompt: 'p', format: 'webp' })).not.toHaveProperty('output_format')
    expect(arkImageBody({ model: 'm', prompt: 'p', format: '' })).not.toHaveProperty('output_format')
  })

  it('carries size and reference image only when they are actually given', () => {
    expect(arkImageBody({ model: 'm', prompt: 'p', size: '1024x1024', referenceUrl: 'https://x/y.png' })).toEqual({
      model: 'm',
      prompt: 'p',
      response_format: 'url',
      watermark: false,
      size: '1024x1024',
      image: 'https://x/y.png',
    })
    // 空串是「没给」，不是「给了一个空值」：传下去会让对面拿一个空 size 校验失败。
    expect(arkImageBody({ model: 'm', prompt: 'p', size: '  ', referenceUrl: '' })).toEqual({
      model: 'm',
      prompt: 'p',
      response_format: 'url',
      watermark: false,
    })
  })

  it('accepts an inlined data url as the reference, because a local path means nothing to Ark', () => {
    // 卡片产物是本机文件；Ark 是拿着地址自己去下载的。data URL 是两个接口都明确支持、
    // 且不需要任何外部条件的那条路（见 `media-provider.ts` 的 referenceUrl）。
    const body = arkImageBody({ model: 'm', prompt: 'p', referenceUrl: 'data:image/png;base64,AAAA' })
    expect(body['image']).toBe('data:image/png;base64,AAAA')
  })
})

describe('ark image response', () => {
  it('reads the url shape', () => {
    expect(readImageResult({ data: [{ url: 'https://cdn/a.png' }] })).toEqual({ url: 'https://cdn/a.png' })
  })

  it('reads the inline base64 shape too, because the server may ignore response_format', () => {
    expect(readImageResult({ data: [{ b64_json: 'AAAA' }] })).toEqual({ base64: 'AAAA' })
  })

  it('takes only the first image — one card is one artifact', () => {
    expect(readImageResult({ data: [{ url: 'first' }, { url: 'second' }] })).toEqual({ url: 'first' })
  })

  it('turns every unreadable answer into a reason instead of a wrong guess', () => {
    expect(readImageResult({ error: { message: 'quota exceeded' } })).toEqual({ reason: 'quota exceeded' })
    expect(readImageResult({ data: [] }).reason).toBeDefined()
    expect(readImageResult({ data: [{}] }).reason).toBeDefined()
    expect(readImageResult(null).reason).toBeDefined()
    expect(readImageResult({ data: ['nope'] }).reason).toBeDefined()
  })
})

describe('ark video request', () => {
  it('puts the prompt first and omits every parameter the caller did not name', () => {
    expect(arkVideoBody({ model: 'doubao-seedance-2-0', prompt: '镜头缓缓拉出' })).toEqual({
      model: 'doubao-seedance-2-0',
      content: [{ type: 'text', text: '镜头缓缓拉出' }],
      watermark: false,
    })
  })

  it('carries duration, ratio and resolution only when given', () => {
    const body = arkVideoBody({
      model: 'm',
      prompt: 'p',
      ratio: '16:9',
      duration: 5,
      resolution: '1080p',
      seed: 7,
    })
    expect(body).toMatchObject({ ratio: '16:9', duration: 5, resolution: '1080p', seed: 7 })
    // 时长是成本参数：没给就**不能**出现在请求里，替用户猜一个等于替他花钱。
    expect(arkVideoBody({ model: 'm', prompt: 'p' })).not.toHaveProperty('duration')
  })

  it('attaches a reference image as a second content part, with its role when named', () => {
    const body = arkVideoBody({ model: 'm', prompt: 'p', referenceUrl: 'https://x/y.png', referenceRole: 'first_frame' })
    expect(body['content']).toEqual([
      { type: 'text', text: 'p' },
      { type: 'image_url', image_url: { url: 'https://x/y.png' }, role: 'first_frame' },
    ])
  })

  it('fills in first_frame when nobody named a role, instead of sending an undefined one', () => {
    // 从前那条想法是「不写 role，让服务端按首帧处理」。翻 Seedance 2.5 的文档才确认：
    // role 的取值里**没有「空」这一档**，一张图不给角色会被当成什么，文档没写。
    // 所以由我们说明白——「让这张图动起来」就是这个画布上「视频引用图片」的默认读法。
    const body = arkVideoBody({ model: 'm', prompt: 'p', referenceUrl: 'data:image/png;base64,AAAA' })
    expect(body['content']).toEqual([
      { type: 'text', text: 'p' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' }, role: 'first_frame' },
    ])
  })

  it('forces ratio to adaptive for frame roles, which is the only value the API accepts there', () => {
    // Seedance 2.5：`role` 为 first_frame / last_frame 时输出比例**自动跟随首帧**，
    // 另给一个 16:9 会被判成 InvalidParameter.TaskTypeConstraint。首帧已经决定了比例，
    // 那个 ratio 本来就不会生效——所以这里不是「替用户改参数」，是把自相矛盾的请求改成
    // 它唯一成立的写法。
    const first = arkVideoBody({
      model: 'm',
      prompt: 'p',
      referenceUrl: 'https://x/y.png',
      referenceRole: 'first_frame',
      ratio: '16:9',
    })
    expect(first['ratio']).toBe('adaptive')
    expect(
      arkVideoBody({ model: 'm', prompt: 'p', referenceUrl: 'https://x/y.png', ratio: '16:9' })['ratio'],
    ).toBe('adaptive')
    const last = arkVideoBody({
      model: 'm',
      prompt: 'p',
      referenceUrl: 'https://x/y.png',
      referenceRole: 'last_frame',
      ratio: '9:16',
    })
    expect(last['ratio']).toBe('adaptive')
  })

  it('leaves ratio alone for a reference image, where any supported ratio is legal', () => {
    // reference_image 是「全模态参考」，文档对它没有比例约束：用户要 16:9 就该是 16:9。
    const body = arkVideoBody({
      model: 'm',
      prompt: 'p',
      referenceUrl: 'https://x/y.png',
      referenceRole: 'reference_image',
      ratio: '16:9',
    })
    expect(body['ratio']).toBe('16:9')
    expect((body['content'] as unknown[])[1]).toMatchObject({ role: 'reference_image' })
  })

  it('keeps the requested ratio for text-to-video, where no frame decides it', () => {
    expect(arkVideoBody({ model: 'm', prompt: 'p', ratio: '16:9' })['ratio']).toBe('16:9')
  })

  it('never asks for a watermark — the artifact belongs to the user', () => {
    expect(arkVideoBody({ model: 'm', prompt: 'p' })['watermark']).toBe(false)
  })
})

describe('ark video task', () => {
  it('reads the task id from a create response', () => {
    expect(readTaskId({ id: 'cgt-2026-abc' })).toBe('cgt-2026-abc')
    expect(readTaskId({})).toBeUndefined()
    expect(readTaskId('nope')).toBeUndefined()
  })

  it('treats cancelled and expired as terminal, so a reclaimed task cannot be polled forever', () => {
    expect(isTerminalStatus('succeeded')).toBe(true)
    expect(isTerminalStatus('failed')).toBe(true)
    expect(isTerminalStatus('cancelled')).toBe(true)
    expect(isTerminalStatus('expired')).toBe(true)
    expect(isTerminalStatus('queued')).toBe(false)
    expect(isTerminalStatus('running')).toBe(false)
  })

  it('still reports a non-terminal status rather than calling it a failure', () => {
    expect(readTaskResult({ status: 'running' })).toEqual({ status: 'running' })
    expect(readTaskResult({ status: 'QUEUED' })).toEqual({ status: 'queued' })
  })

  it('reads the video url in both shapes the API has shipped', () => {
    expect(readTaskResult({ status: 'succeeded', content: { video_url: 'https://cdn/a.mp4' } })).toEqual({
      status: 'succeeded',
      videoUrl: 'https://cdn/a.mp4',
    })
    expect(readTaskResult({ status: 'succeeded', content: [{ video_url: { url: 'https://cdn/b.mp4' } }] })).toEqual({
      status: 'succeeded',
      videoUrl: 'https://cdn/b.mp4',
    })
    expect(readTaskResult({ status: 'succeeded', content: { video_url: { url: 'https://cdn/c.mp4' } } })).toEqual({
      status: 'succeeded',
      videoUrl: 'https://cdn/c.mp4',
    })
  })

  it('says so when a succeeded task carries no url, instead of returning an empty one', () => {
    const result = readTaskResult({ status: 'succeeded', content: {} })
    expect(result.videoUrl).toBeUndefined()
    expect(result.reason).toBeDefined()
  })

  it('carries the server message through on failure, and names an unreadable status as such', () => {
    expect(readTaskResult({ status: 'failed', error: { message: 'unsupported resolution' } }).reason).toBe(
      'unsupported resolution',
    )
    expect(readTaskResult({ status: 'finished' }).reason).toContain('finished')
    expect(readTaskResult({}).reason).toBeDefined()
  })
})

describe('media extensions', () => {
  it('names an extension per capability, matching the kind registry', () => {
    expect(MEDIA_EXTENSIONS).toEqual({ image: 'png', video: 'mp4', audio: 'mp3' })
  })

  it('every extension an audio artifact can land on has a format the speech API accepts', () => {
    // 两个事实（产物叫什么、服务端写什么格式）必须能对上，否则 wav 字节会落进 .mp3：
    // 不报错、能播，但 MIME 与字节不是一回事。
    expect(audioFormatOf(MEDIA_EXTENSIONS.audio)).toBe('mp3')
  })
})

describe('speech audio request', () => {
  it('sends the prompt as text_prompt — the model takes direction, not a script', () => {
    expect(arkAudioBody({ model: 'seed-audio-1.0', prompt: '雨夜便利店，两人压低声音争吵' })).toEqual({
      model: 'seed-audio-1.0',
      text_prompt: '雨夜便利店，两人压低声音争吵',
    })
  })

  it('never sends an empty audio_config — that would override the server default with nothing', () => {
    expect(arkAudioBody({ model: 'seed-audio-1.0', prompt: 'x' })).not.toHaveProperty('audio_config')
  })

  it('aligns the output format with the extension the artifact path already declares', () => {
    expect(arkAudioBody({ model: 'seed-audio-1.0', prompt: 'x', format: 'mp3' })['audio_config']).toEqual({
      format: 'mp3',
    })
    // `.opus` 与 `.ogg` 是同一个容器，服务端只有一个名字。
    expect(audioFormatOf('opus')).toBe('ogg_opus')
    expect(audioFormatOf('OGG')).toBe('ogg_opus')
    // 认不出的扩展名不表态，让服务端用自己的默认。
    expect(audioFormatOf('m4a')).toBeUndefined()
    expect(audioFormatOf(undefined)).toBeUndefined()
  })

  it('carries a sample rate only when it is a positive number', () => {
    expect(arkAudioBody({ model: 'm', prompt: 'x', sampleRate: 44100 })['audio_config']).toEqual({
      sample_rate: 44100,
    })
    expect(arkAudioBody({ model: 'm', prompt: 'x', sampleRate: 0 })).not.toHaveProperty('audio_config')
    expect(arkAudioBody({ model: 'm', prompt: 'x', sampleRate: Number.NaN })).not.toHaveProperty('audio_config')
  })
})

describe('speech audio response', () => {
  it('reads the inlined base64 the API returns', () => {
    expect(readAudioResult({ code: 0, audio: 'SUQz', original_duration: 12.5 })).toEqual({ base64: 'SUQz' })
  })

  it('falls back to the temporary url, which is the only other shape it ships', () => {
    expect(readAudioResult({ code: 0, audio: '', url: 'https://cdn.test/a.mp3' })).toEqual({
      url: 'https://cdn.test/a.mp3',
    })
  })

  it('treats a non-zero code as the failure it is, even on HTTP 200', () => {
    const result = readAudioResult({ code: 40001, message: 'unsupported format' })
    expect(result.base64).toBeUndefined()
    expect(result.reason).toContain('unsupported format')
    expect(result.reason).toContain('40001')
    // 只有错误码、没有 message 时也得说得出发生了什么。
    expect(readAudioResult({ code: 7 }).reason).toContain('7')
  })

  it('prefers the error code over an empty audio field, so a blank file never gets written', () => {
    expect(readAudioResult({ code: 12, audio: '', message: 'quota exceeded' }).reason).toContain('quota exceeded')
  })

  it('reads the same two fields one level down, because some gateways wrap them', () => {
    expect(readAudioResult({ data: { audio: 'SUQz' } })).toEqual({ base64: 'SUQz' })
    expect(readAudioResult({ data: { code: 3, message: 'nope' } }).reason).toContain('nope')
  })

  it('turns every unreadable answer into a reason instead of a wrong guess', () => {
    expect(readAudioResult(null).reason).toBeDefined()
    expect(readAudioResult([]).reason).toBeDefined()
    expect(readAudioResult({ ok: true }).reason).toContain('audio')
  })
})

describe('the model id the speech API wants', () => {
  it('turns the marketplace id into the dotted one, which is the only one it accepts', () => {
    expect(arkAudioModelOf('doubao-seed-audio-1-0')).toBe('seed-audio-1.0')
  })

  it('leaves an id that is already in speech form exactly as it is', () => {
    expect(arkAudioModelOf('seed-audio-1.0')).toBe('seed-audio-1.0')
    expect(arkAudioModelOf('  seed-audio-1.0  ')).toBe('seed-audio-1.0')
  })

  it('does not touch the image or video ids — those APIs take the marketplace id as-is', () => {
    expect(arkAudioModelOf('doubao-seedream-5-0-pro-260628')).toBe('doubao-seedream-5-0-pro-260628')
    expect(arkAudioModelOf('doubao-seedance-2-5-260628')).toBe('doubao-seedance-2-5-260628')
    // 日期后缀不是版本号：认不出就不猜，原样发出去让服务端说话。
    expect(arkAudioModelOf('doubao-seed-audio-1-0-260628')).toBe('doubao-seed-audio-1-0-260628')
  })
})
