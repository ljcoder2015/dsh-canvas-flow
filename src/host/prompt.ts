/**
 * dsh-canvas — card-session prompt contributions (§4.5).
 *
 * Two registrations, at two scopes:
 *
 * - A **global** section tells any agent that the canvas tools exist and what
 *   the card/product/material vocabulary means. Tools that only work inside a
 *   card session must say so, or the model will call them from a plain
 *   conversation and read the refusal as a malfunction.
 * - A **card-scoped** section plus dynamic context, installed inside the
 *   agent's own context by `installCardScope`, carries the facts the model
 *   needs every turn: which artifact it is editing, how to write it back, and
 *   what material its artifact is allowed to draw on.
 *
 * The scope is the isolation mechanism: a registration made through
 * `agentCtx` exists only for that agent, unwinds with it, and shadows a global
 * entry of the same name — so a card's facts can never leak into another
 * card's requests.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage, boundContextSummary } from '@deepseek-ai/dsh-llm'
import type { CardId, CardSummary, Project } from '../types.ts'
import { renderFileReferences, type FileReference } from '../core/artifact/prompt/file-reference.ts'
import { TOOL_NAMES } from '../contract.ts'

/**
 * This plugin's own message-source kind.
 *
 * 0.2.0's source vocabulary is merge-extensible and has no shared catch-all
 * `plugin` kind: each producer names itself in its own module, and the form it
 * carries declares whether the content is a superseding snapshot or a one-off
 * notice. Declaring the kind here is what makes the three injected messages
 * below attributable to the canvas rather than to an anonymous producer.
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-canvas': {
      kind: 'dsh-canvas'
    } & ContextFormed
  }
}

/** Plugin identity used on every injected message source and log line. */
export const PLUGIN_ID = 'dsh-canvas'

/** Section name of the global tool guidance. */
export const GLOBAL_SECTION = 'dsh-canvas:tools'

/** Section name of the card's own context block. */
export const CARD_SECTION = 'dsh-canvas:card'

/** Dynamic-context name carrying the current upstream digests. */
export const UPSTREAM_CONTEXT = 'dsh-canvas:upstreams'

/** Order of the global tool guidance, alongside the harness's own tool sections. */
const GLOBAL_SECTION_ORDER = 2950

/** Order of the card section, inside the same band. */
const CARD_SECTION_ORDER = 2955

/** Order of the upstream dynamic context. */
const UPSTREAM_CONTEXT_ORDER = 130

/**
 * The design preset: what a design card's conversation knows without asking
 * (F3.16). Container sizes come first because "什么尺寸" is the first decision
 * every design instruction implies — the menu gives the ***width***, the
 * ***height*** follows the content, because one page is one continuous container
 * (v1.55: no per-screen split) — then the layer discipline that keeps a
 * document navigable — semantic names, text as text — and finally the
 * edit-loop etiquette: read before writing, batch the ops.
 */
const DESIGN_PRESET = [
  'Container sizes (scene-graph frames). Take the **width** from this menu and let the **height follow the content**, unless the user names a size:',
  'Phones 375 wide, tablets 834 wide, desktop / marketing sites 1440 wide — for web pages and apps the long-page **height follows the content** (1440×2600 or 375×3200 are both normal; one screen-height is not a cap). Fixed-format deliverables are still given as whole blocks: poster 1242×1660, square social 1080×1080, slide 1920×1080, banner 1920×600.',
  'No pagination: a web page or an app lives on **one container** — everything below the fold stays in that same continuous column, exactly how the browser will scroll it, never compressed to fit one screen. Do not split one page into per-screen containers (above-the-fold / screen two / screen three): the user scrolls one page, they do not flip between screens. Several containers are right only when the user asks for screens side by side (side-by-side comparison / flow walkthrough) or when the deliverable is a sequence by nature (each slide of a deck, a poster series).',
  'Layer discipline — the scene graph is a **module tree, not a flat pile**, shaped like the Figma model: a **page** holds **regions** (sections), a region holds **containers** (frames), a container holds nested containers / groups / text / images. Decompose the deliverable into **regions** first where it groups several screens (page flows / version groups…, named for what it groups — a lone screen needs no region), then each container into module **containers** — nav bars / sidebars / content areas / footers / forms / card grids…, each named for what the module is — and hang every element **inside its module container**: an element sitting directly on a container is a smell; the only legal container-level nodes are the container background and full-bleed decorations. Nest deeper where it pays (each list item is a child container; a few icons grouped for the moment take a **group**). A **container** (frame) clips its overflow by default — content spilling past a container edge simply does not render; a **region** (section) is the organizing layer and does not clip, so a container may overhang its region and still show. Regions sit at the top level only — a region never goes inside a container, a container never holds a region. Child x/y are **relative to the parent** (the renderer walks the tree and accumulates). text stays type `text` with its string in `text`, never flattened; keep one container per deliverable and no stray root nodes.',
  'Edit loop: `canvas_design_read` first (ops must reference real node ids), then one `canvas_design_edit` batch of upsert/setProps/move/delete/reorder — small batches, geometry in layer coordinates (relative to the parent frame, x/y is the top-left), colors as #RRGGBB[AA].',
].join(' ')

/**
 * 媒体预设：一张图片 / 视频 / 音频卡的会话，生来就知道的那几件事（F2.7）。
 *
 * 与 {@link DESIGN_PRESET} 同一个位置、同一个理由——它们是**这类卡共有的常识**，
 * 每轮现讲一遍等于每次都要用户重复一遍。这四条各自堵一个真会发生的错：
 *
 * 1. **产物不是文本，别拿文件工具去写它**。这张卡的产物是二进制，卡片自己的产物路径
 *    在这里是**只读**的——用 `write` 往里写字，写出来的会是一个扩展名对、内容全错的
 *    文件，而且它不会报错。要改这张卡，只有一条路：{@link MEDIA_TOOL} 那个工具。
 * 2. **生成工具要的是本卡的 id**。这些工具是板级的（要 cardId 才动手），所以「改这张卡」
 *    与「新建一张卡」在这件事上只差一个参数。默认写**本卡的 `canvas_card_id`**，这正是
 *    「一次改稿」与「再生成一张」的分界——后者只在用户明说要一张新的时才对。
 * 3. **时长不是可以猜的参数**。视频按秒计费，所以用户没说就**不要**填一个「合理的默认」
 *    替他说；给了才传。
 * 4. **慢是真的慢**。一段视频按分钟计，等它是对的；说要等，比让用户以为卡住了好。
 */
function mediaPreset(kind: string, tool: string): string {
  const what = kind === 'image' ? 'an image' : kind === 'video' ? 'a video' : 'an audio clip'
  return [
    `The artifact of this card is ${what} (binary), **not text**: do not write it with file tools — that produces a file with the right extension and entirely wrong content, and it will not error.`,
    `To produce or change this card, use \`${tool}\` and set \`cardId\` to **this card's id** (\`canvas_card_id\`). These tools are board-wide, so the card must be named; passing a different id generates for another card, and the user sees "mine did not change, a new one appeared over there".`,
    kind === 'video'
      ? '`duration` is billed per second, so do **not** fill in a default on the user\'s behalf; the same goes for `ratio` / `resolution` — only pass what was given.'
      : '',
    kind === 'image'
      ? 'Images return synchronously and fast; if the user named an aspect or size, pass it as `size` (e.g. `1024x1024`).'
      : '',
    kind === 'audio'
      ? '`prompt` is a **director\'s brief**, not a script to read aloud: one prompt can carry multi-character dialogue, sound effects, music and ambience ("a rainy-night convenience store, two people arguing in low voices, a beeping cash register in the background"); put the lines to be spoken directly in it, and state voice and tone in one sentence ("lazy, husky female voice") — no separate voice id. 120 seconds max per call.'
      : '',
    kind === 'video'
      ? 'Video is an **async task** billed by the minute. Waiting is correct — do not resend with different parameters because it is slow; resending really does charge again.'
      : '',
    kind === 'audio'
      ? 'Audio returns **synchronously** (unlike video, no polling), usually within a few seconds.'
      : '',
    kind === 'audio'
      ? ''
      : 'Images **referenced onto the canvas become reference images automatically** (image-to-image / image-to-video) — you pass no path and no published URL is needed; turning a local file into something the server can fetch is the plugin\'s job. To pick a different image, name it with `referenceCardId`; video can also use `referenceRole` to say whether that image is the first frame (default), the last frame, or a reference image.',
    'When a tool returns `ok: false`, relay `reason` verbatim: it is the server\'s own reason (usually a parameter this model does not support) — inventing "probably a network problem" sends the user down the wrong path.',
  ]
    .filter((line) => line !== '')
    .join(' ')
}

/** 每种媒体形态配哪个生成工具。
 *
 * 从 {@link TOOL_NAMES} 取值而不是抄字符串：工具名那条单一真源在 `contract.ts`，
 * 手写一遍就又多了一个「改了名不会跟着改、也不会报错」的副本。
 */
const MEDIA_TOOL: Readonly<Record<string, string>> = {
  image: TOOL_NAMES.generateImage,
  video: TOOL_NAMES.generateVideo,
  audio: TOOL_NAMES.generateAudio,
}

/**
 * 「这张卡的产物该怎么改」那一条。
 *
 * 三种形态各有各的一条路，而这条**必须只说一条**：给设计卡讲清楚「用 canvas_design_edit」
 * 之后，再附一句「也可以用文件工具改」会立刻把上一条抵消掉——模型会挑那条好走的，而好走的
 * 那条正是会产出坏文件的那条。
 *
 * 单独抽成函数而不留在数组字面量里，是因为它是这里唯一一处**按形态分叉**的逻辑：分叉写在
 * 三元表达式里读不出「一共只有三态」，而它本身是要进判据的（`tests/host/prompt.spec.ts`）。
 */
function artifactGuidance(kind: string, kindLabel: string, file: string): string {
  if (kind === 'design') {
    return `- This is a **design** card: the artifact is a scene-graph design document (.design, v2). Do not edit the file with text tools — read the document with \`${TOOL_NAMES.designRead}\` and change it with \`${TOOL_NAMES.designEdit}\` batches. ${DESIGN_PRESET}`
  }
  const tool = MEDIA_TOOL[kind]
  if (tool !== undefined) {
    return `- This is a **${kindLabel}** card: the artifact is a binary media file (\`${file}\`), so it is not written with text tools at all. ${mediaPreset(kind, tool)}`
  }
  return '- Write the artifact by editing that file with the ordinary file tools. The canvas re-reads it from disk whenever the board is read, so no export or publish step is needed for the card to be up to date.'
}

/**
 * Register the canvas tool guidance globally.
 *
 * Deliberately states the cards-only precondition in the tool's own words
 * rather than leaving it implicit: `canvas_*` resolves *which card is asking*
 * from the calling agent, so the same call outside a card session is refused
 * on purpose.
 */
export function registerGlobalPrompt(ctx: Context): void {
  ctx.systemPrompt.section({
    name: GLOBAL_SECTION,
    order: GLOBAL_SECTION_ORDER,
    text: [
      '## Canvas workspace',
      '',
      `This deployment has the canvas plugin (${PLUGIN_ID}). A canvas project is a directory on disk; every artifact in it is a card, and every card owns one conversation.`,
      '',
      'Vocabulary: a **card** is one artifact plus its board seat; a **session** is that card\'s conversation; a **source** (a reference line) is the statement "this artifact builds on that artifact" — material at the upstream end, product at the downstream end. There is exactly one relationship type, and it is directed.',
      '',
      'A reference edge carries material in two forms, and they answer different questions. The upstream **artifact** can be *named* as a file reference (`canvas_reference_files`): the board injects its workspace-relative path as an `@` token and you read it with the ordinary file tools when it matters — that is the cheap, always-current form. The same artifact can also be *summarized into this conversation* on demand (`canvas_read_sources`, `canvas_inject_card`), which costs context whether or not you wanted it but puts the material in front of you without a read.',
      '',
      `The \`${TOOL_NAMES.readCard}\`, \`${TOOL_NAMES.readSources}\`, \`${TOOL_NAMES.referenceFiles}\`, \`${TOOL_NAMES.linkSource}\`, \`${TOOL_NAMES.getSources}\` and \`${TOOL_NAMES.injectCard}\` tools act on *the card whose conversation is calling them*. Outside a card conversation they are refused — that is the intended behavior, not a fault, and the fix is to open the card first rather than to retry.`,
      `\`${TOOL_NAMES.readBoard}\`, \`${TOOL_NAMES.arrangeOnBoard}\`, \`${TOOL_NAMES.organizeBoard}\`, \`${TOOL_NAMES.createOnBoard}\`, \`${TOOL_NAMES.linkSourceOnBoard}\`, \`${TOOL_NAMES.generateImage}\`, \`${TOOL_NAMES.generateVideo}\`, \`${TOOL_NAMES.generateAudio}\`, \`${TOOL_NAMES.export}\` and \`${TOOL_NAMES.publish}\` are board-wide: they answer for the canvas the user has open — and inside a card conversation, where the project is certain, for that card's canvas.`,
    ].join('\n'),
  })
}

/** What one card session needs to describe itself. */
export interface CardScopeInput {
  project: Project
  /** The card's seat id — six random letters, not a file name. */
  cardId: CardId
  /** Path of the card's artifact, relative to the project root. */
  file: string
  /** Kind id resolved by the kind registry. */
  kind: string
  /** Human label of that kind. */
  kindLabel: string
  /** Formatted material block — the card's direct upstreams, one hop (F5.8). */
  material: () => string
}

/**
 * Install one card's prompt facts inside its agent scope.
 *
 * @param agentCtx - the agent's own context, before the agent is published.
 * @param input - the card's identity, kind, and a lazy material reader.
 */
export function installCardScope(agentCtx: Context, input: CardScopeInput): void {
  const { project, cardId, file, kind, kindLabel } = input

  agentCtx.systemPrompt.section({
    name: CARD_SECTION,
    order: CARD_SECTION_ORDER,
    text: [
      '## This conversation',
      '',
      `Conversation for the canvas card \`${cardId}\` (kind: ${kindLabel} / \`${kind}\`) in project **${project.name}**. The card id is only a seat identity — the artifact lives at the file below.`,
      '',
      `- The artifact is the file \`${file}\`, relative to the project root \`${project.root}\`. Its absolute path is available as the \`canvas_card_path\` variable.`,
      artifactGuidance(kind, kindLabel, file),
      `- **A change belongs to this artifact.** This conversation has exactly one product — the file above — so a turn that asks for a change means rewriting *that* file. "tweak it again / change it to… / add this / adjust that" is a revision of what is already here, not a new artifact: work in place. (Where the artifact is the entry file of a site or an app, its sibling files are this same artifact and are edited as such — the line that must not be crossed is starting a *second* deliverable: no \`-v2\` / \`-copy\` / alternate file left for the user to pick between, and no seating another card (\`${TOOL_NAMES.createOnBoard}\`) for a change to this one.) A multi-turn conversation is meant to converge on one artifact that gets better; a new file per turn scatters the thread the user is holding, and the board ends up showing two cards where they asked for one thing fixed.`,
      '- Creating a card is the user\'s move, not yours: cards are seated on the board by them (dragging out a node, or asking for one), and a conversation never creates one as a side effect of wanting to write something. So the one case where another card is the right answer is when the user asks for a *separate* deliverable outright — then say so in words and let them create it, rather than forking silently or overwriting this artifact with something that is not it.',
      project.style.tone.trim() === '' ? '' : `- Tone of voice for this project: ${project.style.tone}.`,
      project.style.font.trim() === '' ? '' : `- Type family for this project: ${project.style.font}.`,
      project.style.palette.length === 0 ? '' : `- Palette for this project: ${project.style.palette.join(', ')}.`,
      '',
      '### Material this artifact sources from',
      '',
      'The block below names the artifacts this one is declared to source from (a reference) — **one hop**: the material it builds on directly, as workspace-relative paths, which is exactly what the `@file` grammar denotes. Read any of them with the ordinary file tools: they are references, not content, and nothing has been copied into this conversation on your behalf.',
      '',
      'Nothing further up the chain is listed, on purpose. Those artifacts are upstream of *your* upstream, and the product in between is expected to have absorbed them — so work from what is named here, and from that artifact\'s own content, rather than guessing at its ancestors. If an instruction really reaches past them, `canvas_get_sources` names the whole chain, and `canvas_read_card` reads any one artifact on it.',
      '',
      `When a name is not enough — you want the material in front of you without spending a read — \`${TOOL_NAMES.readSources}\` returns a digest of every upstream listed above, \`${TOOL_NAMES.readCard}\` returns one artifact, and \`${TOOL_NAMES.injectCard}\` pushes one into this conversation. \`${TOOL_NAMES.referenceFiles}\` re-states the upstream files as \`@\` tokens, which is what to call after a long exchange has pushed the block out of sight.`,
    ]
      .filter((line) => line !== '')
      .join('\n'),
  })

  agentCtx.systemPrompt.variable('canvas_card_path', () => `${project.root.replace(/\/+$/, '')}/${cardId}`)
  agentCtx.systemPrompt.variable('canvas_card_id', () => cardId)
  agentCtx.systemPrompt.variable('canvas_project', () => project.name)

  // Upstream digests are dynamic: the artifact behind them may be rewritten by
  // a *different* card's conversation while this one is open, so the text is
  // resolved per assembly instead of frozen at registration.
  agentCtx.systemPrompt.context({
    name: UPSTREAM_CONTEXT,
    order: UPSTREAM_CONTEXT_ORDER,
    text: () => input.material(),
  })
}

/**
 * Build the message that tells a downstream session its material changed (F5.7).
 *
 * Injected, never delivered as a turn: the policy exists so an open downstream
 * conversation is not left reasoning about a version of the material that no
 * longer exists, not so the plugin can spend the user's tokens unprompted.
 */
export function upstreamChangedMessage(upstream: CardId, downstream: CardId, digest: string): UserMessage {
  const body =
    digest === ''
      ? `Material changed: canvas card \`${upstream}\` was rewritten. Call \`${TOOL_NAMES.readCard}\` if you need its new content before continuing.`
      : `Material changed: canvas card \`${upstream}\` was rewritten, and \`${downstream}\` is declared to source from it. Its new digest:\n\n${digest}`
  return createUserMessage({
    content: [{ type: 'text', text: body }],
    source: {
      kind: 'dsh-canvas',
      form: 'snapshot',
      sections: [{ name: UPSTREAM_CONTEXT, text: body }],
    },
  })
}

/**
 * Build the message that hands a downstream session its material as file names.
 *
 * The source is `kind: 'dsh-canvas'`, never `kind: 'user'`: the board is naming the
 * files, not putting words in the user's mouth, and the harness's own `@file`
 * guidance already tells the model how to treat such tokens. The body carries
 * no file content at all — a reference is an offer to read, and its whole value
 * is that it costs nothing until the model accepts.
 */
export function referenceMessage(
  references: readonly FileReference[],
  skipped: readonly string[],
): UserMessage {
  const body = renderFileReferences(references, skipped)
  return createUserMessage({
    content: [{ type: 'text', text: body }],
    source: {
      kind: 'dsh-canvas',
      form: 'notice',
      summary: boundContextSummary(`References ${references.map((reference) => reference.cardId).join(' / ')}`),
    },
  })
}

/**
 * Render one digest as a material entry: identity, path, structure, body (F5.2).
 *
 * The path and the outline are the parts an agent cannot recover from the
 * summary text alone, so they lead instead of trailing the body.
 */
function renderMaterialEntry(summary: CardSummary): string {
  const outline = summary.outline.length === 0 ? '' : `\n  Structure: ${summary.outline.join(' / ')}`
  return `- **${summary.cardId}** (${summary.kind}) → ${summary.path}${outline}\n  ${summary.summary.replace(/\n/g, '\n  ')}`
}

/**
 * Render the material block from upstream digests (F5.2).
 *
 * Used by the pull path — `canvas_inject_card` in `summary` mode — where the
 * digests are read at the moment of injection and are therefore current.
 *
 * Deliberately *not* wired into the per-turn material context in
 * {@link installCardScope}: that context is assembled synchronously, so serving
 * digests from it would mean caching them, and nothing in this deployment
 * invalidates such a cache — a card whose artifact is rewritten by an ordinary
 * file edit would keep feeding the prompt a stale digest. The context carries
 * the chain (which cards, which kinds) and points the model at
 * `canvas_read_sources`, which reads through and cannot go stale.
 *
 * Empty when the card sources from nothing — an empty contribution is dropped
 * rather than leaving a heading with no content.
 */
export function renderMaterial(summaries: readonly CardSummary[]): string {
  if (summaries.length === 0) return ''
  return ['### Sourced material', '', ...summaries.map(renderMaterialEntry)].join('\n')
}

/**
 * Build the message that carries an explicit card-to-card injection.
 *
 * `agent.inject` writes durable context without waking an idle agent, which is
 * exactly the semantics an injection wants: the model sees the material on its
 * next request, and no turn is started behind the user's back.
 */
export function injectionMessage(source: CardSummary, mode: 'summary' | 'full', body: string): UserMessage {
  const text =
    mode === 'full'
      ? `Material injected from canvas card \`${source.cardId}\` (${source.kind}) — full content:\n\n${body}`
      : `Material injected from canvas card \`${source.cardId}\` (${source.kind}).\n\n${body}`
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'dsh-canvas',
      form: 'notice',
      summary: boundContextSummary(`References ${source.cardId}`),
    },
  })
}

/**
 * Build the user's own prompt, typed into a card's composer on the board.
 *
 * The source is `kind: 'user'` — the words are the user's, not the plugin's —
 * which is the same attribution the harness's own conversation composer uses.
 * Delivery is the caller's business: {@link userPromptMessage} is handed to
 * `agent.followup`, so a prompt typed while the agent runs queues as the next
 * turn instead of racing the active one.
 */
export function userPromptMessage(prompt: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  })
}
