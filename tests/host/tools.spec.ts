/**
 * The agent-facing tool layer (§3.6): which project a call answers for, and
 * whether what a tool returns is what it declared.
 *
 * Both rules have already failed once in production, silently and confusingly,
 * which is why they are pinned here:
 *
 * - **Project resolution.** A board-wide call answers for the canvas the user
 *   has open, and — when that is empty, or the caller is a card — for the
 *   caller's own project. Broken, the model is told "no canvas is open" while
 *   staring at one, and every board-wide tool is dead.
 * - **Declared output.** The registry validates `execute`'s value against
 *   `output.schema` *before* rendering, so one returned field the schema does
 *   not declare fails the call outright (`INVALID_TOOL_OUTPUT`) however good
 *   the rendering is. Every tool is therefore run for real, its value validated
 *   against its own declaration, and its renderer called.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { validateJsonSchemaValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { TOOL_NAMES } from '../../src/contract.ts'
import { registerTools, type ToolDeps } from '../../src/host/tools.ts'
import type { BoardCard, BoardSnapshot, CardSummary, Note, ReferencedFiles, SourceChain } from '../../src/types.ts'

/** The project every fixture answers for. */
const PROJECT = {
  id: 'flow-test',
  name: 'flow-test',
  root: '/tmp/flow-test',
  viewport: { x: 0, y: 0, zoom: 1 },
  style: { palette: [], font: '', tone: '' },
  createdAt: 0,
}

/** One digest, with only the fields under test spelled out. */
const DIGEST: CardSummary = {
  cardId: 'brief.md',
  kind: 'markdown',
  path: '/tmp/flow-test/brief.md',
  summary: 'A short brief.',
  outline: ['Goal'],
  head: '',
  bytes: 12,
  updatedAt: 0,
}

/** One seated card. */
const CARD: BoardCard = {
  id: 'deck.html',
  file: 'deck.html',
  name: 'deck',
  project: PROJECT.id,
  kind: 'app',
  kindLabel: 'Deck',
  position: { x: 0, y: 0 },
  sessionId: '',
  missing: false,
}

/** One board, empty but well-shaped. */
const boardOf = (projectId: string): BoardSnapshot => ({
  project: { ...PROJECT, id: projectId },
  cards: [],
  sources: [],
  notes: [],
})

/** What one harness run collected. */
interface Harness {
  /** Every registered tool, by name. */
  tools: Map<string, ToolDefinition>
  /** Project ids the board was read for, in call order. */
  boards: string[]
  /** 每一次生成拿到的参考图（按调用顺序），以及视频那一路的完整 options。 */
  generated: { image: (string | undefined)[]; video: Record<string, unknown>[] }
}

/**
 * Install the tools over fakes.
 *
 * @param options - `activeProject` is the domain global's slot; `card` is the
 *   card session the caller resolves to, absent for a plain conversation;
 *   `board` is what `readBoard` answers (the empty one by default).
 * @returns the registered tools and the calls they made.
 */
function harness(
  options: {
    activeProject?: string
    card?: { project: string; cardId: string }
    board?: BoardSnapshot
  } = {},
): Harness {
  const tools = new Map<string, ToolDefinition>()
  const boards: string[] = []
  const generated: Harness['generated'] = { image: [], video: [] }
  const card = options.card
  const board = options.board

  const deps = {
    domain: {
      global: {
        get: () => ({
          activeProjectId: options.activeProject ?? '',
          viewport: PROJECT.viewport,
          style: PROJECT.style,
        }),
      },
    },
    canvas: {
      readBoard: async (projectId: string): Promise<BoardSnapshot> => {
        boards.push(projectId)
        return board ?? boardOf(projectId)
      },
      arrange: async (projectId: string): Promise<BoardSnapshot> => {
        boards.push(projectId)
        return boardOf(projectId)
      },
      linkSource: async (_projectId: string, upstream: string, downstream: string) => ({
        id: 'deck.html<-brief.md',
        downstream,
        upstream,
        origin: 'manual' as const,
      }),
      getSources: async (_projectId: string, cardId: string): Promise<SourceChain> => ({
        cardId,
        direct: ['brief.md'],
        indirect: [],
        downstream: [],
      }),
      createNote: async (projectId: string, text: string, position: { x: number; y: number }): Promise<Note> => ({
        id: 'note-1',
        project: projectId,
        text,
        author: 'agent',
        position,
        createdAt: 0,
      }),
    },
    card: {
      readSummary: async (): Promise<CardSummary> => DIGEST,
      readSources: async (): Promise<CardSummary[]> => [DIGEST],
      readDesign: async () => ({
        cardId: 'untitled.design',
        formatVersion: 2,
        containers: ['board-1'],
        nodes: [
          {
            id: 'board-1',
            type: 'frame',
            parentId: 'page-1',
            name: '容器 1',
            x: 0,
            y: 0,
            width: 1024,
            height: 1024,
            rotation: 0,
            opacity: 1,
            cornerRadius: 0,
            visible: true,
            fill: '#ffffff',
            stroke: '',
            strokeWidth: 0,
            text: '',
            fontSize: 16,
            fontFamily: '',
            align: 'left',
          },
        ],
      }),
      editDesign: async () => ({ cardId: 'untitled.design', applied: 1, errors: [], version: 'v2' }),
      referenceFiles: async (): Promise<ReferencedFiles> => ({
        cardId: 'deck.html',
        skipped: [],
        files: [
          {
            cardId: 'brief.md',
            path: 'brief.md',
            mention: '@brief.md',
            kind: 'markdown',
            kindLabel: 'Markdown',
            present: true,
            bytes: 512,
          },
        ],
      }),
      injectCard: async (): Promise<CardSummary> => DIGEST,
      createCard: async (): Promise<BoardCard> => CARD,
      scaffoldWebapp: async (): Promise<BoardCard> => ({ ...CARD, id: 'site/index.html' }),
      scaffoldDesign: async (): Promise<BoardCard> => ({ ...CARD, id: 'untitled.design', kind: 'design' }),
      generateImage: async (
        _project: unknown,
        _cardId: unknown,
        _prompt: unknown,
        referencePath?: string,
      ) => {
        generated.image.push(referencePath)
        return { ok: true, path: '/tmp/flow-test/hero.png', reason: '' }
      },
      generateVideo: async (_project: unknown, _cardId: unknown, videoOptions: Record<string, unknown>) => {
        generated.video.push(videoOptions)
        return { ok: true, path: '/tmp/flow-test/clip.mp4', reason: '' }
      },
      generateAudio: async () => ({ ok: true, path: '/tmp/flow-test/voice.mp3', reason: '' }),
      exportCard: async () => ({ ok: true, path: '/tmp/flow-test/deck.pdf', reason: '' }),
      publishCard: async () => ({ ok: true, path: 'https://deck.example.test', reason: '' }),
    },
    sessions: {
      cardOf: (sessionId: string) =>
        card === undefined
          ? undefined
          : { project: card.project, cardId: card.cardId, sessionId, agent: undefined, dispose: async () => undefined },
    },
  }

  const ctx = {
    tools: {
      register: (definition: ToolDefinition) => {
        tools.set(definition.name, definition)
        return () => undefined
      },
    },
  }

  registerTools(ctx as unknown as Context, deps as unknown as ToolDeps)
  return { tools, boards, generated }
}

/** One tool call's identity: which session is asking. */
const exec = (sessionId: string | undefined): never =>
  ({ agent: sessionId === undefined ? undefined : { id: sessionId }, signal: undefined }) as never

/** The smallest legal arguments for each tool. */
const ARGS: Record<string, unknown> = {
  [TOOL_NAMES.readCard]: { cardId: 'brief.md' },
  [TOOL_NAMES.readSources]: {},
  [TOOL_NAMES.referenceFiles]: {},
  [TOOL_NAMES.linkSource]: { sourceCardId: 'brief.md' },
  [TOOL_NAMES.getSources]: {},
  [TOOL_NAMES.injectCard]: { cardId: 'brief.md' },
  [TOOL_NAMES.readBoard]: {},
  [TOOL_NAMES.arrangeOnBoard]: { strategy: 'grid' },
  [TOOL_NAMES.organizeBoard]: {},
  [TOOL_NAMES.createOnBoard]: { type: 'note', content: '决策：封面用横版' },
  [TOOL_NAMES.linkSourceOnBoard]: { from: 'brief.md', to: 'deck.html' },
  [TOOL_NAMES.generateImage]: { prompt: 'a cover', cardId: 'hero.png' },
  [TOOL_NAMES.generateVideo]: { prompt: '镜头缓缓拉出', cardId: 'clip.mp4', ratio: '16:9', duration: 5 },
  [TOOL_NAMES.generateAudio]: { prompt: '雨夜便利店，两个人压低声音争吵', cardId: 'voice.mp3' },
  [TOOL_NAMES.designRead]: {},
  [TOOL_NAMES.designEdit]: {
    ops: [{ kind: 'upsert', type: 'rect', x: 10, y: 10, width: 120, height: 80, fill: '#6B4226' }],
  },
  [TOOL_NAMES.export]: { cardId: 'deck.html', format: 'pdf' },
  [TOOL_NAMES.publish]: { cardId: 'deck.html' },
}

describe('canvas tools — declared output', () => {
  it('registers every name in the shared table', () => {
    const h = harness()
    expect([...h.tools.keys()].sort()).toEqual(Object.values(TOOL_NAMES).slice().sort())
  })

  it('returns only fields its own schema declares, and renders each one', async () => {
    const h = harness({ card: { project: PROJECT.id, cardId: 'app/index.html' } })
    for (const [name, definition] of h.tools) {
      const args = ARGS[name] ?? {}
      const value = await definition.execute(args, exec('cv-1'))
      // The registry runs this check before `render`, so a value that fails it
      // never reaches the model — the call fails as `INVALID_TOOL_OUTPUT`.
      expect(validateJsonSchemaValue(definition.output.schema, value), `${name} returned a value its schema rejects`).toEqual([])
      expect(definition.output.render(args, value as never).length, `${name} rendered nothing`).toBeGreaterThan(0)
    }
  })

  it('declares the output of every create branch', async () => {
    const h = harness({ card: { project: PROJECT.id, cardId: 'app/index.html' } })
    const definition = h.tools.get(TOOL_NAMES.createOnBoard)
    if (definition === undefined) throw new Error(`${TOOL_NAMES.createOnBoard} is not registered`)
    const branches = [
      { type: 'note', content: '记一笔' },
      { type: 'card', content: 'deck.html' },
      { type: 'app', content: '官网' },
      { type: 'design', content: '海报' },
    ]
    for (const args of branches) {
      const value = await definition.execute(args, exec('cv-1'))
      expect(validateJsonSchemaValue(definition.output.schema, value), `createOnBoard(${args.type}) failed its own schema`).toEqual([])
    }
  })
})

/** 一张坐好的卡（只写这个判据读到的栏）。 */
const seated = (id: string, file: string, kind: string): BoardCard => ({
  id,
  file,
  name: file.replace(/\.[^./]+$/, ''),
  project: PROJECT.id,
  kind,
  kindLabel: kind,
  position: { x: 0, y: 0 },
  sessionId: '',
  missing: false,
})

/**
 * 一张「视频引用了图片」的画布 —— 用户报障里那张（`视频.mp4 ← 图片.png`）。
 *
 * 画布上还坐着一张 `source.mp4`，用来验「点名一张不是图片的卡」。
 */
const REFERENCED_BOARD: BoardSnapshot = {
  project: PROJECT,
  cards: [seated('img1', '图片.png', 'image'), seated('clip', '视频.mp4', 'video'), seated('other', '另一段.mp4', 'video')],
  sources: [{ id: 's1', downstream: 'clip', upstream: 'img1', origin: 'manual' }],
  notes: [],
}

/**
 * 引用真的进了生成请求（v1.74）。
 *
 * 这是那条 400 背后的另一半：**画布上连了线，但参考图从来没进过请求**。`generateImage`
 * 的第 4 个参数写死 `undefined`，`generateVideo` 的 options 里根本没有这一栏——于是
 * 「引用一张图去生成」在界面上连得上、在请求里不存在。用户看到的是一张没照参考图来的图，
 * 而这件事**不会报错**。
 */
describe('canvas tools — 引用即参考图', () => {
  it('视频卡引用了一张图片：那张图作为 referencePath 交给生成', async () => {
    const h = harness({ board: REFERENCED_BOARD, activeProject: PROJECT.id })
    const value = await h.tools
      .get(TOOL_NAMES.generateVideo)
      ?.execute({ prompt: '镜头缓缓拉出', cardId: 'clip', ratio: '16:9', duration: 5 }, exec('cv-1'))
    expect(h.generated.video[0]).toMatchObject({ referencePath: '图片.png' })
    // 没点名角色就不写：服务端按首帧处理，那是「让这张图动起来」的默认读法。
    expect(h.generated.video[0]).not.toHaveProperty('referenceRole')
    expect((value as { note: string }).note).toBe('')
  })

  it('没有引用的卡照旧纯文生图——不替它编一张参考图', async () => {
    const h = harness({ board: REFERENCED_BOARD, activeProject: PROJECT.id })
    const args = { prompt: '一只鲸鱼', cardId: 'img1' }
    await h.tools.get(TOOL_NAMES.generateImage)?.execute(args, exec('cv-1'))
    expect(h.generated.image[0]).toBeUndefined()
  })

  it('referenceCardId 点名压过引用自动挑的那张', async () => {
    const board: BoardSnapshot = { ...REFERENCED_BOARD, cards: [...REFERENCED_BOARD.cards, seated('img2', '参考.png', 'image')] }
    const h = harness({ board, activeProject: PROJECT.id })
    await h.tools
      .get(TOOL_NAMES.generateImage)
      ?.execute({ prompt: 'p', cardId: 'img1', referenceCardId: 'img2' }, exec('cv-1'))
    expect(h.generated.image[0]).toBe('参考.png')
  })

  it('点名了一张不是图片的卡：不给参考图，但要说出来', async () => {
    const h = harness({ board: REFERENCED_BOARD, activeProject: PROJECT.id })
    const value = await h.tools
      .get(TOOL_NAMES.generateVideo)
      ?.execute({ prompt: '镜头缓缓拉出', cardId: 'clip', referenceCardId: 'other' }, exec('cv-1'))
    expect(h.generated.video[0]).not.toHaveProperty('referencePath')
    // 安静地用不上，用户会以为「模型没照我的图来」。
    expect((value as { note: string }).note).toContain('other')
  })
})

describe('canvas tools — which project a board-wide call answers for', () => {  it('falls back to the calling card\'s project when no canvas is recorded', async () => {
    const h = harness({ card: { project: PROJECT.id, cardId: 'app/index.html' } })
    await h.tools.get(TOOL_NAMES.readBoard)?.execute({}, exec('cv-9'))
    expect(h.boards).toEqual([PROJECT.id])
  })

  it('prefers the canvas the user has open', async () => {
    const h = harness({ activeProject: 'open-one', card: { project: PROJECT.id, cardId: 'brief.md' } })
    await h.tools.get(TOOL_NAMES.readBoard)?.execute({}, exec('cv-9'))
    expect(h.boards).toEqual(['open-one'])
  })

  it('refuses when no canvas is open and the conversation is not a card\'s', async () => {
    const h = harness()
    await expect(h.tools.get(TOOL_NAMES.readBoard)?.execute({}, exec('plain-session'))).rejects.toThrow(/no canvas is open/)
  })

  it('still refuses card-scoped tools outside a card conversation', async () => {
    const h = harness({ activeProject: 'open-one' })
    await expect(h.tools.get(TOOL_NAMES.getSources)?.execute({}, exec('plain-session'))).rejects.toThrow(/只能在卡片会话/)
  })
})
