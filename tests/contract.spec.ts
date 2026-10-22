/**
 * The plane the whole plugin rests on: host and client must describe exactly
 * the same wire contract, and no descriptor may drift from the method it names.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DSH_CANVAS_INVOCATIONS, PACKAGE_NAME, TOOL_NAMES, TOOL_NAME_LIST, TOOL_NAME_PATTERN, boardSnapshotSchema } from '../src/contract.ts'
import { CANVAS_DOMAIN } from '../src/domain.ts'
import { TYPERT_MANIFEST } from '../src/typert.ts'
import { DSH_CANVAS_REMOTE } from '../src/client/wire/remote.ts'

describe('dsh-canvas wire contract', () => {
  it('shares one descriptor list between the host manifest and the package', () => {
    expect(TYPERT_MANIFEST.invocations).toBe(DSH_CANVAS_INVOCATIONS)
    expect(TYPERT_MANIFEST.package).toBe(PACKAGE_NAME)
    expect(TYPERT_MANIFEST.face).toBe('host')
  })

  // The client contribution is the second place the package name is written as
  // an identity (the model layer attributes both faces by it). Reading it off
  // `PACKAGE_NAME` is what keeps the two from drifting when the package is
  // renamed — the miss this test exists for.
  it('attributes both faces to the same package', () => {
    expect(DSH_CANVAS_REMOTE.package).toBe(PACKAGE_NAME)
  })

  it('uses unique, namespaced identities', () => {
    const ids = DSH_CANVAS_INVOCATIONS.map((descriptor) => descriptor.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const descriptor of DSH_CANVAS_INVOCATIONS) {
      expect(descriptor.id.startsWith(`${PACKAGE_NAME}#`)).toBe(true)
      expect(['canvas', 'card']).toContain(descriptor.namespace)
      // The wire namespace and the owning service key are the same value in
      // this plugin, which is what lets one `bindTypertRemote` cover both.
      expect(descriptor.service).toBe(descriptor.namespace)
    }
  })

  it('declares cancellation on every method, so no call can hang un-cancellably', () => {
    for (const descriptor of DSH_CANVAS_INVOCATIONS) {
      expect(descriptor.cancellation).toEqual({ parameter: 'signal' })
      expect(descriptor.invocation).toEqual({ kind: 'direct' })
    }
  })

  it('names every model-facing tool exactly once and inside the provider charset', () => {
    expect(new Set(TOOL_NAME_LIST).size).toBe(TOOL_NAME_LIST.length)
    expect(TOOL_NAME_LIST).toHaveLength(18)
    // The provider validates `tools[].name` against ^[a-zA-Z0-9_-]+$ and
    // answers 400 for anything else, so the canvas namespace is joined with an
    // underscore: a dotted name never reaches the model.
    for (const tool of TOOL_NAME_LIST) {
      expect(tool.startsWith('canvas_')).toBe(true)
      expect(TOOL_NAME_PATTERN.test(tool)).toBe(true)
    }
    expect(TOOL_NAMES.readCard).toBe('canvas_read_card')
    expect(TOOL_NAMES.linkSourceOnBoard).toBe('canvas_link_source_on_board')
    expect(TOOL_NAMES.referenceFiles).toBe('canvas_reference_files')
  })

  it('keeps the plugin manifest\u2019s contributed tools equal to the registered names', () => {
    // The manifest is registry-facing — no runtime path reads it — so it drifts
    // in silence: v1.35 added a fourteenth tool and this list still said
    // thirteen, through v1.37's rename as well. One read here is what makes
    // that particular silent drift impossible.
    const manifest = JSON.parse(
      readFileSync(new URL('../dsh.plugin.json', import.meta.url), 'utf8'),
    ) as { contributes: { tools: string[] } }
    expect(manifest.contributes.tools).toEqual(TOOL_NAME_LIST)
  })

  it('publishes a manifest whose member list matches the descriptor set', () => {
    const declared = new Set(
      TYPERT_MANIFEST.model.services.flatMap((service) => service.members.map((member) => member.name)),
    )
    for (const descriptor of DSH_CANVAS_INVOCATIONS) {
      expect(declared.has(descriptor.method)).toBe(true)
    }
  })

  it('routes the card composer through card/send_message with a prompt and a session binding', () => {
    const descriptor = DSH_CANVAS_INVOCATIONS.find((entry) => entry.id === `${PACKAGE_NAME}#card/send_message`)
    expect(descriptor).toBeDefined()
    expect(descriptor?.namespace).toBe('card')
    expect(descriptor?.method).toBe('sendMessage')
    // projectId, cardId, prompt — the prompt is the third parameter.
    expect(descriptor?.parameters).toHaveLength(3)
    expect(descriptor?.parameters?.[2]?.name).toBe('prompt')
  })

  it('validates a board snapshot and rejects a card with a malformed seat', () => {
    const snapshot = {
      project: {
        id: 'p1',
        name: 'deck',
        root: '/tmp/deck',
        viewport: { x: 0, y: 0, zoom: 1 },
        style: { palette: [], font: '', tone: '' },
        createdAt: 1,
      },
      cards: [
        {
          id: 'brief.md',
          file: 'brief.md',
          name: 'brief',
          project: 'p1',
          kind: 'markdown',
          kindLabel: 'Markdown',
          position: { x: 0, y: 0 },
          sessionId: '',
          missing: false,
        },
      ],
      sources: [],
      notes: [],
    }
    expect(boardSnapshotSchema.parse(snapshot).cards).toHaveLength(1)
    expect(() =>
      boardSnapshotSchema.parse({ ...snapshot, cards: [{ ...snapshot.cards[0], position: { x: 'left', y: 0 } }] }),
    ).toThrow()
  })
})

describe('dsh-canvas storage domain', () => {
  // Importing the module is itself the assertion: `defineDomain` validates at
  // module load and throws on a name the medium rejects, which takes the whole
  // host half down at boot (`plugin tree failed to load`). The package name
  // (`PACKAGE_NAME` — scoped, with `@` and `/`) is not a legal unit name, so
  // the domain cannot mirror it.
  it('declares a unit name the medium accepts, and it is not the package name', () => {
    expect(CANVAS_DOMAIN.name).toMatch(/^[a-z][a-z0-9_]*$/)
    expect(CANVAS_DOMAIN.name).not.toBe(PACKAGE_NAME)
    expect(Object.keys(CANVAS_DOMAIN.tables)).toEqual(['projects', 'cards', 'sources', 'notes', 'intents'])
  })

  it('keeps the global non-nullable so a written global round-trips', () => {
    expect(CANVAS_DOMAIN.global?.schema.safeParse(null).success).toBe(false)
  })
})
