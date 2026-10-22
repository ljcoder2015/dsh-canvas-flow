/**
 * dsh-canvas — the agent-facing tool set (§3.6).
 *
 * The tools are thin: they resolve *which* card and project the call belongs
 * to, then delegate to a runtime. Two resolution rules, and the difference
 * between them is the whole isolation model:
 *
 * - **Card tools** answer for the card whose conversation is calling. The card
 *   is resolved from `exec.agent` through the live session table — never from a
 *   prompt convention and never from an argument — so a session that is not a
 *   card session is refused (`card/session-missing`) instead of silently acting
 *   on someone else's artifact.
 * - **Board tools** answer for the project the user is currently looking at,
 *   which the client records in the domain global when it switches boards.
 *
 * `execute` returns only the canonical JSON value; the human-readable rendering
 * lives in `output.render`, as the tool pipeline requires.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { CardSummary, ExportFormat, ReferencedFiles, SourceChain } from '../types.ts'
import { TOOL_NAMES } from '../contract.ts'
import type { DesignOpInput } from '../core/artifact/design/ops.ts'
import { referenceFor, referenceNote } from '../core/media/reference.ts'
import type { CanvasRuntime } from './runtime/canvas-runtime.ts'
import type { CardRuntime } from './runtime/card-runtime.ts'
import type { SessionManager } from '../core/session/session-manager.ts'
import type { CanvasDomain } from '../domain.ts'

/** What the tool layer needs from the composition root. */
export interface ToolDeps {
  domain: CanvasDomain
  canvas: CanvasRuntime
  card: CardRuntime
  sessions: SessionManager
}

/** Render blocks for one line-oriented text answer. */
const text = (value: string): ContentBlock[] => [{ type: 'text', text: value }]

/** 参数里的可选字符串：空白与「没给」等价，免得下游再判一次。 */
const optionalText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

/** The canonical summary shape every summary-returning tool declares. */
const SUMMARY_PROPERTIES = {
  cardId: { type: 'string' },
  kind: { type: 'string' },
  path: { type: 'string' },
  summary: { type: 'string' },
  outline: { type: 'array', items: { type: 'string' } },
  // 卡片预览用的原文头部（markdown 专有）；renderSummary 不渲染它，模型看不见。
  head: { type: 'string' },
  bytes: { type: 'number' },
  updatedAt: { type: 'number' },
} as const

/** One design node, as `canvas_design_read` returns and `canvas_design_edit` accepts (F2.6, v2 — scene-graph). */
const DESIGN_NODE_PROPERTIES = {
  id: { type: 'string' },
  type: { type: 'string' },
  parentId: { type: 'string' },
  name: { type: 'string' },
  x: { type: 'number' },
  y: { type: 'number' },
  width: { type: 'number' },
  height: { type: 'number' },
  rotation: { type: 'number' },
  opacity: { type: 'number' },
  cornerRadius: { type: 'number' },
  visible: { type: 'boolean' },
  fill: { type: 'string' },
  stroke: { type: 'string' },
  strokeWidth: { type: 'number' },
  text: { type: 'string' },
  fontSize: { type: 'number' },
  fontFamily: { type: 'string' },
  align: { type: 'string' },
} as const

/** One structured edit op, as the schema declares it. */
const DESIGN_OP_PROPERTIES = {
  kind: { type: 'string' },
  id: { type: 'string' },
  type: { type: 'string' },
  parentId: { type: 'string' },
  name: { type: 'string' },
  x: { type: 'number' },
  y: { type: 'number' },
  rotation: { type: 'number' },
  width: { type: 'number' },
  height: { type: 'number' },
  cornerRadius: { type: 'number' },
  opacity: { type: 'number' },
  fill: { type: 'string' },
  stroke: { type: 'string' },
  strokeWidth: { type: 'number' },
  text: { type: 'string' },
  fontSize: { type: 'number' },
  fontFamily: { type: 'string' },
  align: { type: 'string' },
  visible: { type: 'boolean' },
  index: { type: 'number' },
} as const

/** One summary rendered for the model. */
function renderSummary(summary: CardSummary): string {
  const outline = summary.outline.length === 0 ? '' : `\n结构：${summary.outline.join(' / ')}`
  return `## ${summary.cardId} (${summary.kind})\n路径：${summary.path}\n${summary.summary}${outline}`
}

/**
 * Install the canvas tools.
 *
 * @param ctx - the plugin's context, carrying `tools`.
 * @param deps - the live runtimes to delegate to.
 * @returns nothing; registrations are owned by the calling fiber.
 */
export function registerTools(ctx: Context, deps: ToolDeps): void {
  /** The card whose conversation is calling, or a refusal the model can act on. */
  const callingCard = (agentId: string | undefined) => {
    if (agentId === undefined) return undefined
    return deps.sessions.cardOf(agentId as never)
  }

  /**
   * The project a board-wide call answers for.
   *
   * Two sources, in this order. The canvas the user has open is what these
   * tools are *for*: the client records it in the domain global whenever the
   * visible canvas changes. When that slot is empty, a card conversation falls
   * back to its own project — a card session is the one place the project is
   * certain, so refusing there would tell an agent that is demonstrably inside
   * a canvas that none is open.
   */
  const activeProject = (exec: { agent?: { id?: string } }): string => {
    const active = deps.domain.global.get().activeProjectId
    if (active !== '') return active
    const caller = callingCard(exec.agent?.id)
    if (caller !== undefined) return caller.project
    throw new Error(
      `no canvas is open in this session and this conversation does not belong to a card. Open a canvas first, or call this from a card conversation.`,
    )
  }

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.readCard,
      description:
        '读取指定卡片产物的摘要（结构化大纲 + 有界正文）。用于了解画布上另一张卡片当前是什么样子。只读取，不修改。',
      parameters: {
        cardId: { type: 'string', description: '目标卡片 id（画布座位身份，不是文件路径）', required: true },
      },
      output: {
        schema: { type: 'object', properties: SUMMARY_PROPERTIES, additionalProperties: false },
        render: (_args, value) => text(renderSummary(value as CardSummary)),
      },
      async execute(args, exec) {
        const caller = callingCard(exec.agent?.id)
        if (caller === undefined) throw new Error(`${TOOL_NAMES.readCard} 只能在卡片会话内调用：请先打开这张卡片的对话。`)
        return deps.card.readSummary(caller.project, String(args.cardId), exec.signal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.readSources,
      description:
        '读取当前卡片引用来源（直接上游产物）的摘要。引用只取上一级：这里不会带回上游的上游，那部分材料应由上游产物自己消化。改动产物前先调用它，避免与上游脱节。',
      parameters: {},
      output: {
        schema: { type: 'array', items: { type: 'object', properties: SUMMARY_PROPERTIES, additionalProperties: false } },
        render: (_args, value) => {
          const list = value as CardSummary[]
          if (list.length === 0) return text('这张卡片目前没有引用来源。')
          return text(list.map(renderSummary).join('\n\n'))
        },
      },
      async execute(_args, exec) {
        const caller = callingCard(exec.agent?.id)
        if (caller === undefined) throw new Error(`${TOOL_NAMES.readSources} 只能在卡片会话内调用。`)
        return deps.card.readSources(caller.project, caller.cardId, exec.signal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.linkSource,
      description:
        '声明当前卡片的产物引用另一张卡片（建立一条「引用」边：素材 → 产物）。当你的产物确实使用了另一张卡片的产物时调用。',
      parameters: {
        sourceCardId: { type: 'string', description: '作为素材的上游卡片 id（项目内相对路径）', required: true },
      },
      output: {
        schema: {
          type: 'object',
          properties: { id: { type: 'string' }, upstream: { type: 'string' }, downstream: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const edge = value as { upstream: string; downstream: string }
          return text(`已建立引用关系：${edge.downstream} ← ${edge.upstream}`)
        },
      },
      async execute(args, exec) {
        const caller = callingCard(exec.agent?.id)
        if (caller === undefined) throw new Error(`${TOOL_NAMES.linkSource} 只能在卡片会话内调用。`)
        const edge = await deps.canvas.linkSource(caller.project, String(args.sourceCardId), caller.cardId, exec.signal)
        return { id: edge.id, upstream: edge.upstream, downstream: edge.downstream }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.getSources,
      description: '获取当前卡片的引用链：直接上游、间接上游与下游卡片 id。用于判断改动会影响谁、依赖了谁。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: {
            cardId: { type: 'string' },
            direct: { type: 'array', items: { type: 'string' } },
            indirect: { type: 'array', items: { type: 'string' } },
            downstream: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const chain = value as SourceChain
          return text(
            [
              `本卡：${chain.cardId}`,
              `引用来源（直接）：${chain.direct.join('、') || '无'}`,
              `引用来源（间接）：${chain.indirect.join('、') || '无'}`,
              `下游产物：${chain.downstream.join('、') || '无'}`,
            ].join('\n'),
          )
        },
      },
      async execute(_args, exec) {
        const caller = callingCard(exec.agent?.id)
        if (caller === undefined) throw new Error(`${TOOL_NAMES.getSources} 只能在卡片会话内调用。`)
        return deps.canvas.getSources(caller.project, caller.cardId, exec.signal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.injectCard,
      description:
        '把另一张卡片的产物内容注入当前会话上下文。mode=summary 只注入摘要，mode=full 注入有界全文。用于真正需要原文时，而不是猜测上游写了什么。',
      parameters: {
        cardId: { type: 'string', description: '要被注入的卡片 id', required: true },
        mode: { type: 'string', enum: ['summary', 'full'], description: '注入粒度，默认 summary' },
      },
      output: {
        schema: { type: 'object', properties: SUMMARY_PROPERTIES, additionalProperties: false },
        render: (_args, value) => text(`已注入 ${(value as CardSummary).cardId}：\n\n${renderSummary(value as CardSummary)}`),
      },
      async execute(args, exec) {
        const caller = callingCard(exec.agent?.id)
        if (caller === undefined) throw new Error(`${TOOL_NAMES.injectCard} 只能在卡片会话内调用。`)
        const mode = args.mode === 'full' ? 'full' : 'summary'
        return deps.card.injectCard(caller.project, caller.cardId, String(args.cardId), mode, exec.signal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.referenceFiles,
      description:
        '把当前卡片的引用来源（直接上游产物）以「文件引用」交给本会话：注入的是上游产物的 @路径（模型自己用 read 工具按需读取），不是内容副本。只报上一级，不做穿透引用。想知道上游文件在哪、按需取用时用它；想把上游内容摘要直接拿到上下文里，用 canvas_read_sources 或 canvas_inject_card。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: {
            cardId: { type: 'string' },
            files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  cardId: { type: 'string' },
                  path: { type: 'string' },
                  mention: { type: 'string' },
                  kind: { type: 'string' },
                  kindLabel: { type: 'string' },
                  present: { type: 'boolean' },
                  bytes: { type: 'number' },
                },
                additionalProperties: false,
              },
            },
            skipped: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const named = value as ReferencedFiles
          if (named.files.length === 0) {
            return text(named.skipped.length === 0 ? '本卡片没有引用来源，没有可引用的文件。' : '没有可引用的文件（见 skipped）。')
          }
          const lines = [
            `已把 ${named.files.length} 个上游产物以文件引用注入本会话（读取由你决定）：`,
            ...named.files.map((file) => {
              const state = file.present ? `${file.bytes} 字节` : '文件尚未写出来'
              return `- ${file.mention}（${file.kindLabel}，${state}）`
            }),
          ]
          if (named.skipped.length > 0) {
            lines.push(`无法写成 @文件引用（路径里有引号或控制字符）：${named.skipped.join('、')}`)
          }
          return text(lines.join('\n'))
        },
      },
      async execute(_args, exec) {
        const caller = callingCard(exec.agent?.id)
        if (caller === undefined) throw new Error(`${TOOL_NAMES.referenceFiles} 只能在卡片会话内调用。`)
        return deps.card.referenceFiles(caller.project, caller.cardId, exec.signal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.designRead,
      description:
        '读取本卡设计文档（.design）的 JSON 结构：容器清单与全部图层的 id、几何、样式。修改设计前必须先读它——canvas_design_edit 的 ops 要引用这里返回的节点 id。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: {
            cardId: { type: 'string' },
            formatVersion: { type: 'number' },
            containers: { type: 'array', items: { type: 'string' } },
            nodes: { type: 'array', items: { type: 'object', properties: DESIGN_NODE_PROPERTIES, additionalProperties: false } },
          },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const doc = value as { cardId: string; containers: string[]; nodes: readonly unknown[] }
          return text(
            [
              `设计文档 ${doc.cardId}：${doc.containers.length} 容器 · ${doc.nodes.length} 图层`,
              `容器：${doc.containers.join('、') || '无'}`,
              JSON.stringify(doc.nodes, null, 1),
            ].join('\n'),
          )
        },
      },
      async execute(_args, exec) {
        const caller = callingCard(exec.agent?.id)
        if (caller === undefined) throw new Error(`${TOOL_NAMES.designRead} 只能在卡片会话内调用。`)
        return deps.card.readDesign(caller.project, caller.cardId, exec.signal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.designEdit,
      description:
        '对本卡设计文档应用批量结构化编辑 op。kind=upsert 新建（缺 id 自动分配）；setProps 改属性；move 挪位置/换父节点；delete 级联删除子图层；reorder 调整叠放次序（index 省略则移到最上层）。坐标是图层坐标（相对父图层，x/y 为左上角），颜色用 #RRGGBB[AA]。结构照 Figma 的形状：page → section（区域）→ frame（容器）→ 嵌套 frame（模块容器）/ group（分组）→ 元素，即按模块分层：区域归类容器，容器再拆模块容器（导航栏/内容区/页脚…，type=frame），元素不要直接平铺在容器上。层级有硬约束：区域只放顶层、不能塞进容器也不进分组，容器可以嵌套容器，分组到处都能套。frame 默认裁切溢出内容（新建即裁），section 不裁，元素可溢出模块只要不出容器。一次给一批 op；全部失败会报错，部分失败时 errors 逐条说明。',
      parameters: {
        ops: {
          type: 'array',
          required: true,
          items: { type: 'object', properties: DESIGN_OP_PROPERTIES, additionalProperties: false },
          description: '编辑 op 列表（1–200 条）',
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            cardId: { type: 'string' },
            applied: { type: 'number' },
            errors: { type: 'array', items: { type: 'string' } },
            version: { type: 'string' },
          },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const result = value as { cardId: string; applied: number; errors: string[] }
          const head = `已应用 ${result.applied} 条编辑到 ${result.cardId}。`
          if (result.errors.length === 0) return text(head)
          return text([head, `失败 ${result.errors.length} 条：`, ...result.errors].join('\n'))
        },
      },
      async execute(args, exec) {
        const caller = callingCard(exec.agent?.id)
        if (caller === undefined) throw new Error(`${TOOL_NAMES.designEdit} 只能在卡片会话内调用。`)
        const ops = Array.isArray(args.ops) ? (args.ops as DesignOpInput[]) : []
        return deps.card.editDesign(caller.project, caller.cardId, ops, exec.signal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.readBoard,
      description: '读取画布当前座次、卡片清单与引用边。用于了解整个项目有哪些产物、它们如何互相引用。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            root: { type: 'string' },
            cards: { type: 'array', items: { type: 'string' } },
            sources: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const board = value as { project: string; root: string; cards: string[]; sources: string[] }
          return text(
            [
              `项目：${board.project}（${board.root}）`,
              `卡片 ${board.cards.length} 张：${board.cards.join('、') || '无'}`,
              `引用边 ${board.sources.length} 条：${board.sources.join('、') || '无'}`,
            ].join('\n'),
          )
        },
      },
      async execute(_args, exec) {
        const board = await deps.canvas.readBoard(activeProject(exec), exec.signal)
        return {
          project: board.project.name,
          root: board.project.root,
          cards: board.cards.map((card) => `${card.id}(${card.kind}「${card.name}」→ 文件 ${card.file})`),
          sources: board.sources.map((source) => `${source.downstream} ← ${source.upstream}`),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.arrangeOnBoard,
      description:
        '按语义重新摆位画布。strategy=source-chain 沿引用链从左到右分层（素材在左、产物在右）；grid 平铺；organize 把游离卡片归纳到链条下方。只改座次，不改产物。',
      parameters: {
        strategy: { type: 'string', enum: ['source-chain', 'grid', 'organize'], description: '摆位策略，默认 source-chain' },
      },
      output: {
        schema: { type: 'object', properties: { moved: { type: 'number' } }, additionalProperties: false },
        render: (_args, value) => text(`已重新摆位 ${(value as { moved: number }).moved} 张卡片。`),
      },
      async execute(args, exec) {
        const strategy = args.strategy === 'grid' || args.strategy === 'organize' ? args.strategy : 'source-chain'
        const board = await deps.canvas.arrange(activeProject(exec), strategy, exec.signal)
        return { moved: board.cards.length }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.organizeBoard,
      description: '归纳收纳画布：把参与引用链的卡片按链条摆好，把游离卡片打包到下方，让画布重新可读。',
      parameters: {},
      output: {
        schema: { type: 'object', properties: { moved: { type: 'number' } }, additionalProperties: false },
        render: (_args, value) => text(`已归纳 ${(value as { moved: number }).moved} 张卡片。`),
      },
      async execute(_args, exec) {
        const board = await deps.canvas.arrange(activeProject(exec), 'organize', exec.signal)
        return { moved: board.cards.length }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.createOnBoard,
      description:
        '在画布上创建内容：type=note 创建共享便利贴（决策记录），type=card 把项目内的一个产物落成卡片，type=app 新建一个应用节点——建文件夹并写入 web components + shadcn 风格的 web 应用脚手架，type=design 新建一个设计节点——写入含空白容器的场景图设计文档（.design v2）。',
      parameters: {
        type: { type: 'string', enum: ['note', 'card', 'app', 'design'], description: '创建类型', required: true },
        content: {
          type: 'string',
          description: 'note 为便利贴文字；card 为产物文件的项目内相对路径（卡片 id 与卡片名由画布铸出并在返回值里给出）；app / design 为显示名（落盘名字由它生成）',
          required: true,
        },
        kind: { type: 'string', description: 'type=card 时的形态 id；省略则按文件证据认定' },
        x: { type: 'number', description: '画布 x 坐标；省略则自动找空位' },
        y: { type: 'number', description: '画布 y 坐标；省略则自动找空位' },
      },
      output: {
        schema: {
          type: 'object',
          properties: { type: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' }, file: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const created = value as { type: string; id: string; name?: string; file?: string }
          const named = created.name === undefined ? '' : `「${created.name}」`
          if (created.type === 'note') return text(`已创建便利贴 ${created.id}。`)
          if (created.type === 'app') return text(`已创建应用${named}（id ${created.id}，入口 index.html，文件夹内含脚手架）。`)
          if (created.type === 'design') return text(`已创建设计${named}（id ${created.id}，.design，含空白容器）。`)
          return text(`已创建卡片${named}（id ${created.id}，文件 ${created.file ?? ''}）。`)
        },
      },
      async execute(args, exec) {
        const projectId = activeProject(exec)
        const x = typeof args.x === 'number' ? args.x : undefined
        const y = typeof args.y === 'number' ? args.y : undefined
        if (args.type === 'note') {
          const note = await deps.canvas.createNote(
            projectId,
            String(args.content),
            { x: x ?? 48, y: y ?? 48 },
            exec.signal,
          )
          return { type: 'note', id: note.id }
        }
        if (args.type === 'app') {
          const card = await deps.card.scaffoldWebapp(
            projectId,
            String(args.content),
            { x: x ?? 48, y: y ?? 170 },
            exec.signal,
          )
          return { type: 'app', id: card.id, name: card.name }
        }
        if (args.type === 'design') {
          const card = await deps.card.scaffoldDesign(
            projectId,
            String(args.content),
            { x: x ?? 48, y: y ?? 170 },
            exec.signal,
          )
          return { type: 'design', id: card.id, name: card.name }
        }
        const kind = typeof args.kind === 'string' ? args.kind : 'file'
        const card = await deps.card.createCard(projectId, String(args.content), kind, { x: x ?? 48, y: y ?? 170 }, exec.signal)
        return { type: 'card', id: card.id, name: card.name, file: card.file }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.linkSourceOnBoard,
      description: '在画布上直接画一条引用线：from 是素材（上游），to 是产物（下游）。',
      parameters: {
        from: { type: 'string', description: '上游卡片 id（素材）', required: true },
        to: { type: 'string', description: '下游卡片 id（产物）', required: true },
      },
      output: {
        schema: {
          type: 'object',
          properties: { upstream: { type: 'string' }, downstream: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const edge = value as { upstream: string; downstream: string }
          return text(`已连接：${edge.downstream} ← ${edge.upstream}`)
        },
      },
      async execute(args, exec) {
        const edge = await deps.canvas.linkSource(activeProject(exec), String(args.from), String(args.to), exec.signal)
        return { upstream: edge.upstream, downstream: edge.downstream }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.generateImage,
      description:
        '为某张图片卡片生成画面。prompt 描述要什么，cardId 指定写进哪张卡片（卡片 id）。引用进来的图片会自动当作参考图（图生图）；也可以用它自己的 referenceCardId 点名另一张。',
      parameters: {
        prompt: { type: 'string', description: '画面描述', required: true },
        cardId: { type: 'string', description: '目标图片卡片 id', required: true },
        referenceCardId: {
          type: 'string',
          description: '用哪张卡的产物当参考图。省略则自动用引用进这张卡的第一张图片；画布上没连引用就是纯文生图',
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            path: { type: 'string' },
            reason: { type: 'string' },
            note: { type: 'string' },
          },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const result = value as { ok: boolean; path: string; reason: string; note: string }
          if (!result.ok) return text(`生图未完成：${result.reason}`)
          return text(result.note === '' ? `已生成：${result.path}` : `已生成：${result.path}（${result.note}）`)
        },
      },
      async execute(args, exec) {
        const projectId = activeProject(exec)
        const board = await deps.canvas.readBoard(projectId, exec.signal)
        const cardId = String(args.cardId)
        // **引用要真的送进请求**：画布上连了一条边，就是「把这张图当材料」，而这句话只有
        // 在参考图进了 `image` 字段时才兑现。此前这里写死 `undefined`，于是连线只出现在
        // 提示词里、从来没进过生成请求（用户看到的是「模型没照参考图来」）。
        const reference = referenceFor(board.cards, board.sources, cardId, optionalText(args.referenceCardId))
        const result = await deps.card.generateImage(
          board.project,
          cardId,
          String(args.prompt),
          reference.status === 'found' ? reference.file : undefined,
          exec.signal,
        )
        return {
          ok: result.ok,
          path: result.path,
          reason: result.reason,
          note: referenceNote(reference) ?? '',
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.generateVideo,
      description:
        '为某张视频卡片生成一段片子。prompt 描述画面与运镜；ratio / duration / resolution 是可选参数，不给则用模型自己的默认。引用进来的图片会自动当首帧（图生视频）；referenceRole 可改成 reference_image 当参考图。生成是异步任务，会等到成片为止。',
      parameters: {
        prompt: { type: 'string', description: '画面与运镜描述', required: true },
        cardId: { type: 'string', description: '目标视频卡片 id', required: true },
        ratio: { type: 'string', description: '画面比例，如 16:9 / 9:16 / 1:1 / adaptive' },
        duration: { type: 'number', description: '片长（秒）。按秒计费，所以不说就交给模型默认，别自己猜' },
        resolution: { type: 'string', description: '分辨率，如 480p / 720p / 1080p' },
        referenceCardId: {
          type: 'string',
          description: '用哪张卡的产物当参考图。省略则自动用引用进这张卡的第一张图片；画布上没连引用就是纯文生视频',
        },
        referenceRole: {
          type: 'string',
          description: '参考图的角色：first_frame（默认，让这张图动起来）、last_frame（首尾帧的尾帧）、reference_image（参考图）',
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            path: { type: 'string' },
            reason: { type: 'string' },
            note: { type: 'string' },
          },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const result = value as { ok: boolean; path: string; reason: string; note: string }
          if (!result.ok) return text(`生视频未完成：${result.reason}`)
          return text(result.note === '' ? `已生成：${result.path}` : `已生成：${result.path}（${result.note}）`)
        },
      },
      async execute(args, exec) {
        const projectId = activeProject(exec)
        const board = await deps.canvas.readBoard(projectId, exec.signal)
        const cardId = String(args.cardId)
        const reference = referenceFor(board.cards, board.sources, cardId, optionalText(args.referenceCardId))
        const result = await deps.card.generateVideo(
          board.project,
          cardId,
          {
            prompt: String(args.prompt),
            ...(typeof args.ratio === 'string' ? { ratio: args.ratio } : {}),
            ...(typeof args.duration === 'number' ? { duration: args.duration } : {}),
            ...(typeof args.resolution === 'string' ? { resolution: args.resolution } : {}),
            ...(reference.status === 'found' ? { referencePath: reference.file } : {}),
            ...(typeof args.referenceRole === 'string' && args.referenceRole.trim() !== ''
              ? { referenceRole: args.referenceRole.trim() }
              : {}),
          },
          exec.signal,
        )
        return {
          ok: result.ok,
          path: result.path,
          reason: result.reason,
          note: referenceNote(reference) ?? '',
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.generateAudio,
      description:
        '为某张音频卡片生成一段音频（对白、音效、配乐、环境声都可以）。prompt 用自然语言描述要生成什么声音；要念出来的台词也可以直接写在里面。音频生成需要部署配了可用的音频模型。',
      parameters: {
        prompt: {
          type: 'string',
          description: '要生成什么声音：自然语言描述（可含多角色对白、音效、配乐），也可直接是要念出来的台词',
          required: true,
        },
        cardId: { type: 'string', description: '目标音频卡片 id', required: true },
      },
      output: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, path: { type: 'string' }, reason: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const result = value as { ok: boolean; path: string; reason: string }
          return text(result.ok ? `已生成：${result.path}` : `生音频未完成：${result.reason}`)
        },
      },
      async execute(args, exec) {
        const projectId = activeProject(exec)
        const board = await deps.canvas.readBoard(projectId, exec.signal)
        const result = await deps.card.generateAudio(
          board.project,
          String(args.cardId),
          { prompt: String(args.prompt) },
          exec.signal,
        )
        return { ok: result.ok, path: result.path, reason: result.reason }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.export,
      description:
        '把一张卡片产物导出为其它格式（html / pdf / pptx / png / svg / zip）。能否导出取决于卡片形态与部署是否提供导出能力，不可行时会返回具体原因。',
      parameters: {
        cardId: { type: 'string', description: '要导出的卡片 id', required: true },
        format: { type: 'string', enum: ['html', 'pdf', 'pptx', 'png', 'svg', 'zip'], description: '目标格式', required: true },
      },
      output: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, path: { type: 'string' }, reason: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const result = value as { ok: boolean; path: string; reason: string }
          return text(result.ok ? `导出完成：${result.path}` : `导出未完成：${result.reason}`)
        },
      },
      async execute(args, exec) {
        const projectId = activeProject(exec)
        const board = await deps.canvas.readBoard(projectId, exec.signal)
        const result = await deps.card.exportCard(projectId, String(args.cardId), args.format as ExportFormat, exec.signal)
        return { ok: result.ok, path: result.path || board.project.root, reason: result.reason }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.publish,
      description: '把一张卡片产物发布到公开链接（可下线即回收）。发布取决于卡片形态与部署是否提供发布能力。',
      parameters: {
        cardId: { type: 'string', description: '要发布的卡片 id', required: true },
      },
      output: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, url: { type: 'string' }, reason: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const result = value as { ok: boolean; url: string; reason: string }
          return text(result.ok ? `已发布：${result.url}` : `发布未完成：${result.reason}`)
        },
      },
      async execute(args, exec) {
        const result = await deps.card.publishCard(activeProject(exec), String(args.cardId), exec.signal)
        return { ok: result.ok, url: result.path, reason: result.reason }
      },
    }),
  )
}
