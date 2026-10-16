/**
 * dsh-canvas — composing a card conversation from the deployment's agent preset.
 *
 * On the Web surface the model-facing tool rows are not in the host composition:
 * `dsh-web-app` disables the base's `tool-fs` / `tool-bash` / `tool-skill` / …
 * rows and lets every session mount an **agent preset** instead. A preset is
 * composed once under a standing scope, and an agent joins it by having its
 * scope key parented to that mount. The one supported call site for the join is
 * the agent factory's `setup(agentCtx)` hook — there, and only there, the
 * composition is installed while the agent is still unpublished, so a rejected
 * preset rolls the creation back instead of publishing a half-composed agent.
 *
 * A card conversation is an ordinary session in every respect that matters here,
 * and it has to be: the only way a card agent writes its artifact is the
 * ordinary file tools — that is what its own prompt section tells it to use.
 * Created *without* a preset, which is what this plugin used to do, a card agent
 * inherits nothing but the host composition: the canvas tools this plugin
 * registers globally, and not one way to put a byte on disk. The failure is
 * loud and confusing from the inside — the model is told to edit
 * `untitled.md`, every write tool answers `unknown tool`, and the artifact stays
 * absent, so the turn ends by explaining why it cannot do its job.
 *
 * A rosterless deployment (a bare harness, a unit test) has no `agentPresets`
 * service at all. There the model-facing rows sit in the host composition where
 * every agent already sees them through the global layer, so absence is a no-op
 * rather than a failure — exactly the reading `AgentPresetRegistry.composeFrom`
 * documents for a parent that joined no preset.
 */
import type { Context } from '@deepseek-ai/cordis'

/**
 * The slice of `ctx.agentPresets` (`@deepseek-ai/dsh-agent-preset-registry`)
 * this module uses.
 *
 * Structural, and resolved by name, because that package is a harness companion
 * rather than a dependency of this plugin: the same bundle runs behind a preset
 * roster and without one, and only the former provides the service.
 *
 * **Every member declared here is one the published service actually has**, and
 * that is the whole discipline of this interface: nothing below it exists to
 * disagree with a guess. A structural face is checked by the deployment, at
 * call time, and a member that was never published fails there rather than at
 * the type checker. So the surface is read off the service's own declaration
 * (`0.2.0-rc.2`, `lib/types/index.d.ts`) instead of being imagined from what
 * the call site wants — and a member the roster answers for another purpose
 * (reading a revision's registrations, say) is not repurposed into a check this
 * one needs.
 *
 * The invoice for getting that wrong was one line: this module once asked for a
 * `standingKeyFor`, which no published version of the package has ever
 * declared, and every card conversation on every deployment with the service
 * died on `face.standingKeyFor is not a function` (issue #1). The two members
 * below are the ones a card actually needs — and `resolve`, being the call that
 * runs the very audit `mount` would run, is the one that answers whether a
 * preset can compose at all.
 */
export interface AgentPresetFace {
  /**
   * Resolve one preset by id; no id means the deployment default. `broken`
   * carries the roster's own diagnostic when the composition cannot be
   * installed, and is absent when it can.
   */
  resolve(id?: string): Promise<{ id: string; broken?: string }>
  /** Compose one agent from a preset, by parenting its scope to the mount. */
  mount(agentCtx: Context, id?: string): Promise<{ id: string }>
}

/** The deployment's preset roster, or `undefined` when it composes none. */
export function presetFace(ctx: Context): AgentPresetFace | undefined {
  return ctx.get('agentPresets') as AgentPresetFace | undefined
}

/**
 * Resolve the preset a card conversation composes from, without creating one.
 *
 * Resolved per open rather than cached: the roster re-reads its roots on every
 * call, and which preset is *default* is a setting a person can change while
 * the process runs. The cost is one directory read when a conversation that is
 * not already live is opened.
 *
 * The preset's ability to compose is read off the diagnostic `resolve()` already
 * carries (`broken`) rather than re-derived by a second call: the roster fills
 * that field in for exactly this question — why this preset cannot compose a
 * session — and `resolve` is the same audit `mount` runs, so asking it here,
 * before any agent exists, makes a preset that cannot be composed fail this
 * call instead of failing an agent creation: the caller can then report it
 * without a session in the balance. Failure is deliberately not swallowed — a
 * deployment whose preset is broken cannot give a card agent a way to write
 * either, and the honest answer is the row that is broken rather than a
 * conversation that silently cannot do its job.
 *
 * @param ctx - the plugin context, for the service lookup.
 * @returns the preset id, or `undefined` when the deployment has no roster.
 * @throws when the default preset is unknown to the roster or uncomposable.
 */
export async function cardPreset(ctx: Context): Promise<string | undefined> {
  const face = presetFace(ctx)
  if (face === undefined) return undefined
  const preset = await face.resolve()
  if (preset.broken !== undefined) {
    throw new Error(`部署的 agent preset「${preset.id}」装不起来：${preset.broken}`)
  }
  return preset.id
}

/**
 * Join one card agent to its preset's standing composition.
 *
 * Called from the agent factory's `setup` callback, after
 * {@link cardPreset} has already proven the preset composes — so a rejection
 * here is a real race (a composition file edited between the two) rather than
 * the steady state. Letting it propagate is what keeps a card agent from being
 * published with a composition it did not get: the factory rolls the whole
 * creation back.
 *
 * @param ctx - the plugin context, for the service lookup.
 * @param agentCtx - the agent's own scope context, from the setup callback.
 * @param presetId - the id resolved by {@link cardPreset}; `undefined` in a
 *   rosterless deployment, where there is nothing to join.
 * @throws when the preset became unusable between resolution and the mount.
 */
export async function composeCardAgent(
  ctx: Context,
  agentCtx: Context,
  presetId: string | undefined,
): Promise<void> {
  const face = presetFace(ctx)
  if (face === undefined || presetId === undefined) return
  await face.mount(agentCtx, presetId)
}
