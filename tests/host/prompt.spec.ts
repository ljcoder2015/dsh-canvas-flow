/**
 * The prompt layer: how a card describes itself and its material (F5.2).
 *
 * `renderMaterial` is the payload the pull path injects, so its shape is
 * checked literally: identity, path and structure lead, the body is indented
 * under them, and a card that sources from nothing contributes no heading at
 * all rather than an empty section.
 *
 * `installCardScope` is checked on what it actually hands the model: the
 * design card's preset (F3.16) and the rules it must carry (v1.55 — one page
 * is one continuous container, no per-screen split) — asserted through the
 * section it installs rather than on the module's private strings.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installCardScope, renderMaterial, userPromptMessage } from '../../src/host/prompt.ts'
import { TOOL_NAMES } from '../../src/contract.ts'
import type { CardSummary, Project } from '../../src/types.ts'

/** One digest, with only the fields under test spelled out. */
const digest = (over: Partial<CardSummary> = {}): CardSummary => ({
  cardId: 'brief.md',
  kind: 'markdown',
  path: '/proj/brief.md',
  summary: 'A short brief.',
  outline: ['Goal', 'Audience'],
  head: '',
  bytes: 16,
  updatedAt: 0,
  ...over,
})

const project: Project = {
  id: 'p',
  name: 'demo',
  root: '/proj',
  viewport: { x: 0, y: 0, zoom: 1 },
  style: { tone: '', font: '', palette: [] },
  createdAt: 0,
}

/** Run one card's `installCardScope` against a stub context, return its text. */
function sectionTextOf(kind: string): string {
  const sections: string[] = []
  const agentCtx = {
    systemPrompt: {
      section: (entry: { text: string }) => sections.push(entry.text),
      variable: () => undefined,
      context: () => undefined,
    },
  } as unknown as Context
  installCardScope(agentCtx, {
    project,
    cardId: 'abcdef',
    file: '文本1.md',
    kind,
    kindLabel: '文本',
    material: () => '',
  })
  return sections.join('\n')
}

describe('renderMaterial', () => {
  it('contributes nothing when the card sources from nothing', () => {
    expect(renderMaterial([])).toBe('')
  })

  it('leads with identity, path and structure, then the body', () => {
    const lines = renderMaterial([digest()]).split('\n')
    expect(lines[0]).toBe('### Sourced material')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('- **brief.md** (markdown) → /proj/brief.md')
    expect(lines[3]).toBe('  Structure: Goal / Audience')
    expect(lines[4]).toBe('  A short brief.')
  })

  it('indents every line of a multi-line body so it stays under its entry', () => {
    expect(renderMaterial([digest({ summary: 'first\nsecond' })])).toContain('  first\n  second')
  })

  it('omits the structure line when the artifact has no outline', () => {
    expect(renderMaterial([digest({ outline: [] })])).not.toContain('Structure:')
  })

  it('keeps one entry per digest, in the order given', () => {
    const text = renderMaterial([digest(), digest({ cardId: 'deck.html', kind: 'app' })])
    expect(text.match(/^- \*\*/gm)).toHaveLength(2)
    expect(text.indexOf('brief.md')).toBeLessThan(text.indexOf('deck.html'))
  })
})

describe('userPromptMessage', () => {
  it('attributes the words to the user, not to the plugin', () => {
    const message = userPromptMessage('把封面改成横版')
    expect(message.role).toBe('user')
    expect(message.source).toEqual({ kind: 'user' })
  })

  it('carries the prompt as its single text block', () => {
    const message = userPromptMessage('按 brief 生成 deck')
    expect(message.content).toEqual([{ type: 'text', text: '按 brief 生成 deck' }])
  })
})

describe('设计卡的预设（F3.16 / v1.55）', () => {
  it('设计卡带容器尺寸与「一页一个容器」的规矩', () => {
    const text = sectionTextOf('design')
    expect(text).toContain('design** card')
    expect(text).toContain('height follow the content')
    expect(text).toContain('Do not split one page into per-screen containers')
    // 网页 / 应用的高度按内容给，菜单里的固定值只是**宽度**与「整块给出」的稿件尺寸。
    expect(text).toContain('Phones 375 wide')
    expect(text).toContain('poster 1242×1660')
  })

  it('组织口径按 Figma：区域（section）归类容器（frame），容器里再拆模块容器', () => {
    const text = sectionTextOf('design')
    expect(text).toContain('a **page** holds **regions** (sections)')
    expect(text).toContain('a region holds **containers** (frames)')
    expect(text).toContain('Regions sit at the top level only')
  })

  it('菜单里不再给出「一屏高」的网页稿（那正是分屏的由来）', () => {
    expect(sectionTextOf('design')).not.toContain('官网首屏 1440×900')
  })

  it('非设计卡不带这套容器规矩', () => {
    const text = sectionTextOf('markdown')
    expect(text).not.toContain('Container sizes')
    expect(text).not.toContain('No pagination')
  })
})

describe('媒体卡的预设（F2.7）', () => {
  it('三种媒体各指到自己的生成工具上，且明说产物不是文本', () => {
    const expected = {
      image: TOOL_NAMES.generateImage,
      video: TOOL_NAMES.generateVideo,
      audio: TOOL_NAMES.generateAudio,
    } as const
    for (const [kind, tool] of Object.entries(expected)) {
      const text = sectionTextOf(kind)
      expect(text).toContain(`\`${tool}\``)
      // 「别拿文件工具去写它」必须是这一条的主体，否则模型会挑好走的那条路。
      expect(text).toContain('not text')
      expect(text).toContain('canvas_card_id')
    }
  })

  it('不把别的媒体的工具名混进来', () => {
    expect(sectionTextOf('image')).not.toContain(TOOL_NAMES.generateVideo)
    expect(sectionTextOf('image')).not.toContain(TOOL_NAMES.generateAudio)
    expect(sectionTextOf('video')).not.toContain(TOOL_NAMES.generateImage)
    expect(sectionTextOf('audio')).not.toContain(TOOL_NAMES.generateVideo)
  })

  it('视频卡额外交代时长是钱，音频卡额外交代 prompt 是导演指令且同步返回', () => {
    expect(sectionTextOf('video')).toContain('billed per second')
    // 音频卡最容易写错的一件事：把 prompt 当成「朗读稿」。这一条钉的是那句话本身。
    expect(sectionTextOf('audio')).toContain("director's brief")
    expect(sectionTextOf('audio')).toContain('synchronously')
  })

  it('文本卡与设计卡都不带媒体那套', () => {
    for (const kind of ['markdown', 'design', 'app']) {
      const text = sectionTextOf(kind)
      expect(text).not.toContain(TOOL_NAMES.generateImage)
      expect(text).not.toContain(TOOL_NAMES.generateVideo)
      expect(text).not.toContain(TOOL_NAMES.generateAudio)
    }
  })
})
