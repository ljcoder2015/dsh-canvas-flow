/**
 * 宿主那一半的音频通路（F2.7，v1.82）。
 *
 * 为什么这一份**真的发了一次请求**，而不是像别的宿主判据那样读源码文本：音频与图片 / 视频
 * 走的不是同一个服务体系（见 `core/media/ark.ts` 里那段「第三个产地」），而两者之间的差别
 * 全是**接线**——地址、请求头、模型名。接线错一处，纯函数那侧照样全绿，只有真的发一次才
 * 看得见。所以这里把 `fetch` 换成一个记账的假货，`ctx` 只给它**真机真有**的那三个成员
 * （`settings.describe` / `credentials.resolve` / `fs.resolve` + `fs.processPath`），
 * 产物落到一个真的临时目录里——于是「写下去的是不是那段字节」也是真的被验到的。
 *
 * 一个假对象只能有真机有的成员（这是本仓踩出来的纪律）：多给一个不存在的便利成员，判据
 * 就会放过真机上才有的失败。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaProvider } from '../../src/host/media-provider.ts'

/** 一份照 DSH 设置段形状写的配置：一条方舟路线，同时声明了图片、视频、音频三个模型。 */
const SETTINGS = {
  providers: {
    doubao: {
      apiKeyEnv: 'DOUBAO_API_KEY',
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      models: [
        { id: 'doubao-seedream-5-0-pro-260628' },
        { id: 'doubao-seedance-2-5-260628' },
        { id: 'doubao-seed-audio-1-0' },
      ],
    },
  },
}

const OPTIONS = { imageRoute: '', videoRoute: '', audioRoute: '', pollMs: 1, timeoutMs: 5 }

/** 一次被抓到的请求。 */
interface Call {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: unknown
}

let root = ''

/**
 * 造一个 `ctx`：只挂 `media-provider` 真的会调的那几个成员。
 *
 * `fs.resolve` 收的是「相对路径 + cwd」，回一个目标；`fs.processPath` 把目标变成 OS 能打开
 * 的绝对路径——这正是真机那两下的分工，照它写才验得到「产物落在项目根下」。
 */
function face(settings: unknown = SETTINGS) {
  return {
    get(name: string) {
      if (name === 'settings') {
        return { describe: () => [{ ns: 'llm-pi-ai', value: settings }] }
      }
      if (name === 'credentials') {
        return { resolve: async () => ({ value: 'sk-speech', source: 'env' }) }
      }
      return undefined
    },
    fs: {
      resolve: async (file: string, options: { cwd: string }) => ({ file, cwd: options.cwd }),
      processPath: (target: { file: string; cwd: string }) => join(target.cwd, target.file),
    },
  }
}

/** 把应答排成队，每次 `fetch` 取一条；顺便把请求记下来。 */
function stubFetch(replies: readonly unknown[]): Call[] {
  const calls: Call[] = []
  let index = 0
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    calls.push({
      url,
      headers,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    })
    const reply = replies[Math.min(index, replies.length - 1)]
    index += 1
    return new Response(JSON.stringify(reply), { status: 200 })
  })
  return calls
}

/** 落一个字节串的 base64，拿来当音频载荷。 */
const AUDIO = Buffer.from('ID3\u0004fake-mp3-bytes')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-canvas-audio-'))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(root, { recursive: true, force: true })
})

describe('一次音频生成实际发到哪儿、带什么', () => {
  it('posts to the speech endpoint, not to the Ark host the route names', async () => {
    const calls = stubFetch([{ code: 0, audio: AUDIO.toString('base64') }])
    const provider = new MediaProvider(face() as never, OPTIONS)
    await provider.capabilities().generateAudio!(
      { project: { root } as never, file: 'voice.mp3', prompt: '雨夜便利店，两人压低声音争吵' },
      undefined,
    )
    expect(calls[0]?.url).toBe('https://openspeech.bytedance.com/api/v3/tts/create')
  })

  it('authenticates with X-Api-Key and never mixes a Bearer into it', async () => {
    const calls = stubFetch([{ code: 0, audio: AUDIO.toString('base64') }])
    const provider = new MediaProvider(face() as never, OPTIONS)
    await provider.capabilities().generateAudio!(
      { project: { root } as never, file: 'voice.mp3', prompt: 'x' },
      undefined,
    )
    const headers = calls[0]?.headers ?? {}
    expect(headers['x-api-key']).toBe('sk-speech')
    // 请求追踪 id 是服务端的必备上下文；出问题时客服第一句就问它。
    expect(headers['x-api-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    expect(headers).not.toHaveProperty('authorization')
  })

  it('sends text_prompt, the dotted model id, and the format the file already declares', async () => {
    const calls = stubFetch([{ code: 0, audio: AUDIO.toString('base64') }])
    const provider = new MediaProvider(face() as never, OPTIONS)
    await provider.capabilities().generateAudio!(
      { project: { root } as never, file: 'voice.mp3', prompt: '雨夜便利店' },
      undefined,
    )
    expect(calls[0]?.body).toEqual({
      model: 'seed-audio-1.0',
      text_prompt: '雨夜便利店',
      audio_config: { format: 'mp3' },
    })
  })

  it('writes the decoded bytes into the card artifact, and returns that path', async () => {
    stubFetch([{ code: 0, audio: AUDIO.toString('base64') }])
    const provider = new MediaProvider(face() as never, OPTIONS)
    const result = await provider.capabilities().generateAudio!(
      { project: { root } as never, file: 'voice.mp3', prompt: 'x' },
      undefined,
    )
    expect(result.path).toBe(join(root, 'voice.mp3'))
    expect(await readFile(join(root, 'voice.mp3'))).toEqual(AUDIO)
  })

  it('downloads the temporary url when the response only carries that', async () => {
    // 第二次 fetch 是下载：它不看 JSON，直接要字节。
    const seen: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url)
      if (url === 'https://cdn.test/a.mp3') return new Response(new Uint8Array(AUDIO))
      return new Response(JSON.stringify({ code: 0, audio: '', url: 'https://cdn.test/a.mp3' }), { status: 200 })
    })
    const provider = new MediaProvider(face() as never, OPTIONS)
    const result = await provider.capabilities().generateAudio!(
      { project: { root } as never, file: 'voice.mp3', prompt: 'x' },
      undefined,
    )
    expect(result.path).toBe(join(root, 'voice.mp3'))
    expect(await readFile(join(root, 'voice.mp3'))).toEqual(AUDIO)
    // 签发的是临时链接（约两小时过期），所以必须当场下载，不能把它记进卡片。
    expect(seen).toEqual(['https://openspeech.bytedance.com/api/v3/tts/create', 'https://cdn.test/a.mp3'])
  })
})

describe('音频失败时说的话', () => {
  it('carries the server message through when the code is non-zero, and writes nothing', async () => {
    stubFetch([{ code: 40001, message: 'unsupported audio format' }])
    const provider = new MediaProvider(face() as never, OPTIONS)
    await expect(
      provider.capabilities().generateAudio!({ project: { root } as never, file: 'voice.mp3', prompt: 'x' }),
    ).rejects.toThrow(/unsupported audio format/)
  })

  it('explains a 401 as the other key system it is, instead of leaving a bare status code', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"message":"invalid api key"}', { status: 401 }))
    const provider = new MediaProvider(face() as never, OPTIONS)
    const message = await provider
      .capabilities()
      .generateAudio!({ project: { root } as never, file: 'voice.mp3', prompt: 'x' })
      .catch((error: Error) => error.message)
    // 同一句里必须同时有「哪套鉴权」与「去哪儿改」：只说 401，用户会拿方舟那把 key 反复重试。
    expect(message).toContain('X-Api-Key')
    expect(message).toContain('DOUBAO_API_KEY')
  })

  it('says there is no route at all when the config has no audio model', async () => {
    stubFetch([{ code: 0, audio: '' }])
    const provider = new MediaProvider(
      face({ providers: { gw: { apiKeyEnv: 'GW_API_KEY', models: [{ id: 'deepseek-v4-flash' }] } } }) as never,
      OPTIONS,
    )
    await expect(
      provider.capabilities().generateAudio!({ project: { root } as never, file: 'voice.mp3', prompt: 'x' }),
    ).rejects.toThrow(/没有能找到音频模型的路线/)
  })
})
