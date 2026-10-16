/**
 * Card conversations and the deployment's agent preset: what a card agent
 * inherits, and what happens when the deployment composes no roster.
 *
 * Two regressions are pinned here.
 *
 * **The composition that was missing.** A card conversation is created by this
 * plugin through the agent factory, so it never passes through the composition
 * an ordinary session gets. On the Web surface that composition is an *agent
 * preset* — `dsh-web-app` disables the base's `tool-fs` rows and the preset
 * mounts them — so an agent created without one inherits the canvas tools and
 * nothing else. The model, told by its own prompt section to edit the artifact
 * file, found every write tool answering `unknown tool`, and the card stayed
 * empty.
 *
 * **The check that asked for an API that never existed.** The pre-check used to
 * call a `standingKeyFor` on the roster. No published version of
 * `@deepseek-ai/dsh-agent-preset-registry` declares that member, and the face is
 * structural — resolved by name, checked by nobody but the live deployment — so
 * the guess travelled all the way to the machine: every card conversation on
 * every deployment *with* a roster died on
 * `face.standingKeyFor is not a function` (issue #1), while a unit test with a
 * hand-shaped fake of the same invention stayed green. Hence the fake below is
 * the published surface and nothing more, and one judgement here holds the call
 * sites to it.
 */
import { describe, expect, it, vi } from 'vitest'
import { cardPreset, composeCardAgent, presetFace, type AgentPresetFace } from '../../../src/core/session/agent-preset.ts'

/**
 * Every member `AgentPresetRegistry` publishes, read off the service's own
 * declaration rather than off this plugin's call site:
 * `@deepseek-ai/dsh-agent-preset-registry@0.2.0-rc.2`, `lib/types/index.d.ts`
 * (instance members; the statics `inject` / `Config` and the private helpers are
 * not part of the surface a face can call).
 *
 * Hand-copied, and honestly so: the package is a harness companion, not a
 * dependency of this plugin, so there is nothing here to derive the list from.
 * Cross-checked once against the live class rather than only against its
 * declaration — `Object.getOwnPropertyNames(AgentPresetRegistry.prototype)` on
 * the installed `0.2.0-rc.2` returns 20 names: these fourteen plus the six
 * private helpers (`activate`, `bind`, `collect`, `diagnostic`, `join`,
 * `retain`), and no `standingKeyFor`. Re-read that file when the harness is
 * upgraded — a member that disappears upstream has to disappear from our face
 * in the same breath, and a member this list rejects is a member the deployment
 * will not answer for.
 */
const PUBLISHED_PRESET_MEMBERS: readonly string[] = [
  'acquireScope',
  'composeFrom',
  'composedPreset',
  'compositionInventory',
  'defaultId',
  'list',
  'mount',
  'readDocument',
  'recompose',
  'register',
  'remoteExportList',
  'resolve',
  'select',
  'serviceFor',
]

/** A context that resolves the named services from a mutable map. */
function container(entries: Record<string, unknown> = {}): { get(name: string): unknown } {
  return { get: (name: string) => entries[name] }
}

/**
 * The roster as the deployment actually provides it: the two members a card
 * conversation calls, and nothing else.
 *
 * Only the published members are here on purpose. A fake carrying a member the
 * service does not have is worse than no fake at all — it is the thing that let
 * a call no deployment could answer pass 20 green judgements — so this object
 * has exactly the surface of the real one, and a call to anything else dies the
 * way it dies in production (`face.<name> is not a function`).
 */
function roster(
  options: { id?: string; broken?: string } = {},
): AgentPresetFace & { resolve: ReturnType<typeof vi.fn>; mount: ReturnType<typeof vi.fn> } {
  const id = options.id ?? 'standard'
  return {
    resolve: vi.fn(async () => (options.broken === undefined ? { id } : { id, broken: options.broken })),
    mount: vi.fn(async () => ({ id })),
  }
}

/** The members of a fake this run actually called, for the surface judgement. */
function calledMembers(face: unknown): string[] {
  return Object.entries(face as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'function' && (value as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    .map(([name]) => name)
    .sort()
}

describe('presetFace', () => {
  it('reads the container lazily, so a roster mounted later still reaches a card', () => {
    const entries: Record<string, unknown> = {}
    const ctx = container(entries) as never
    expect(presetFace(ctx)).toBeUndefined()
    const face = roster()
    entries.agentPresets = face
    expect(presetFace(ctx)).toBe(face)
  })
})

describe('cardPreset', () => {
  it('resolves the deployment default without creating an agent', async () => {
    const face = roster({ id: 'standard' })
    await expect(cardPreset(container({ agentPresets: face }) as never)).resolves.toBe('standard')
    expect(face.resolve).toHaveBeenCalledWith()
    expect(face.mount).not.toHaveBeenCalled()
  })

  it('calls no member the published service fails to declare', async () => {
    const face = roster({ id: 'standard' })
    await cardPreset(container({ agentPresets: face }) as never)
    expect(calledMembers(face).filter((name) => !PUBLISHED_PRESET_MEMBERS.includes(name))).toEqual([])
    expect(PUBLISHED_PRESET_MEMBERS).toContain('resolve')
  })

  it('resolves nothing in a rosterless deployment, where the host composition already supplies the tools', async () => {
    await expect(cardPreset(container() as never)).resolves.toBeUndefined()
  })

  it('does not swallow an unknown preset: the card cannot do its job without one', async () => {
    const face = roster()
    face.resolve.mockRejectedValueOnce(new Error('agent-preset/not-found'))
    await expect(cardPreset(container({ agentPresets: face }) as never)).rejects.toThrow('agent-preset/not-found')
  })

  it('reports a preset that resolves but cannot be composed, naming it and quoting the roster', async () => {
    const face = roster({ id: 'standard', broken: 'row unusable: tool-fs' })
    const refused = cardPreset(container({ agentPresets: face }) as never)
    await expect(refused).rejects.toThrow('「standard」')
    await expect(refused).rejects.toThrow('row unusable: tool-fs')
  })
})

describe('composeCardAgent', () => {
  it('joins the agent to the resolved preset', async () => {
    const face = roster({ id: 'standard' })
    const agentCtx = { scoped: true } as never
    await composeCardAgent(container({ agentPresets: face }) as never, agentCtx, 'standard')
    expect(face.mount).toHaveBeenCalledWith(agentCtx, 'standard')
  })

  it('is a no-op in a rosterless deployment', async () => {
    await expect(composeCardAgent(container() as never, {} as never, 'standard')).resolves.toBeUndefined()
  })

  it('is a no-op when no preset was resolved, so a deployment without a roster still opens cards', async () => {
    const face = roster()
    await composeCardAgent(container({ agentPresets: face }) as never, {} as never, undefined)
    expect(face.mount).not.toHaveBeenCalled()
  })

  it('propagates a refused mount so the factory can roll the creation back', async () => {
    const face = roster()
    face.mount.mockRejectedValueOnce(new Error('row unusable: tool-fs'))
    await expect(
      composeCardAgent(container({ agentPresets: face }) as never, {} as never, 'standard'),
    ).rejects.toThrow('row unusable')
  })
})
