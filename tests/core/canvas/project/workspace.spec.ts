/**
 * Canvas projects and the deployment's Workspace registry.
 *
 * The regression this pins is a grouping one: a canvas is a folder, a card
 * conversation runs with that folder as its cwd, and yet every one of those
 * conversations showed up in the sidebar's 未分组 bucket — the Workspace
 * account, which is the other half of membership, was never claimed. So the
 * plugin now registers the canvas root as a Workspace and accounts its
 * conversations on it.
 *
 * The seam is deliberately forgiving, and the tests below are mostly about
 * that: no registry (a bare harness), a registry that refuses the root, a
 * session it refuses to attach — none of those may reach the wire, because the
 * conversation works either way and grouping is a sidebar nicety.
 */
import { describe, expect, it, vi } from 'vitest'
import { attachCanvasSession, claimCanvasWorkspace, type CanvasWorkspace } from '../../../../src/core/canvas/project/workspace.ts'

/** A context whose services resolve from a mutable map, with a recorded logger. */
function container(entries: Record<string, unknown> = {}): {
  get(name: string, strict?: boolean): unknown
  logger: ReturnType<typeof vi.fn>
} {
  return {
    get: (name: string) => entries[name],
    logger: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() })),
  }
}

/**
 * A registry over one Workspace, recording every call.
 *
 * Each test uses its own root and session ids: the module remembers what it has
 * already accounted for the life of the process, which is itself under test.
 */
function registry(path: string, options: { refuseCreate?: boolean; refuseAttach?: boolean } = {}) {
  const workspace: CanvasWorkspace & { attachSession: ReturnType<typeof vi.fn> } = {
    id: `ws-${path}`,
    path,
    attachSession: vi.fn(async () => {
      if (options.refuseAttach === true) throw new Error('its cwd resolves elsewhere')
    }),
  }
  const create = vi.fn(async () => {
    if (options.refuseCreate === true) throw new Error('ENOENT')
    return workspace
  })
  return { face: { create }, workspace, create }
}

describe('claimCanvasWorkspace', () => {
  it('registers the root under the canvas title and accounts every conversation', async () => {
    const { face, create, workspace } = registry('/tmp/canvas-a')
    const count = await claimCanvasWorkspace(
      container({ workspaceRegistry: face }) as never,
      { root: '/tmp/canvas-a', title: '研究' },
      ['session-1', 'session-2'],
    )
    expect(count).toBe(2)
    expect(create).toHaveBeenCalledWith('/tmp/canvas-a', '研究')
    expect(workspace.attachSession.mock.calls).toEqual([['session-1'], ['session-2']])
  })

  it('still claims the folder when no conversation exists yet', async () => {
    const { face, create, workspace } = registry('/tmp/canvas-b')
    await expect(
      claimCanvasWorkspace(container({ workspaceRegistry: face }) as never, { root: '/tmp/canvas-b', title: '空' }, []),
    ).resolves.toBe(0)
    expect(create).toHaveBeenCalledWith('/tmp/canvas-b', '空')
    expect(workspace.attachSession).not.toHaveBeenCalled()
  })

  it('skips a card that has no conversation bound yet', async () => {
    const { face, workspace } = registry('/tmp/canvas-c')
    await claimCanvasWorkspace(
      container({ workspaceRegistry: face }) as never,
      { root: '/tmp/canvas-c', title: 'c' },
      ['', 'session-3', ''],
    )
    expect(workspace.attachSession.mock.calls).toEqual([['session-3']])
  })

  it('accounts a conversation once per process, so re-opening a card is free', async () => {
    const { face, workspace } = registry('/tmp/canvas-d')
    const ctx = container({ workspaceRegistry: face }) as never
    const canvas = { root: '/tmp/canvas-d', title: 'd' }
    await attachCanvasSession(ctx, canvas, 'session-4')
    await attachCanvasSession(ctx, canvas, 'session-4')
    await attachCanvasSession(ctx, canvas, 'session-4')
    expect(workspace.attachSession.mock.calls).toEqual([['session-4']])
  })

  it('is a no-op in a deployment with no workspace roster', async () => {
    const ctx = container() as never
    await expect(claimCanvasWorkspace(ctx, { root: '/tmp/canvas-e', title: 'e' }, ['session-5'])).resolves.toBe(0)
    await expect(attachCanvasSession(ctx, { root: '/tmp/canvas-e', title: 'e' }, 'session-5')).resolves.toBe(false)
  })

  it('reports a root the registry refuses without failing the canvas', async () => {
    const { face } = registry('/tmp/canvas-f', { refuseCreate: true })
    const ctx = container({ workspaceRegistry: face })
    await expect(
      claimCanvasWorkspace(ctx as never, { root: '/tmp/canvas-f', title: 'f' }, ['session-6']),
    ).resolves.toBe(0)
    expect(ctx.logger).toHaveBeenCalled()
  })

  it('reports a conversation the workspace refuses, and keeps the rest', async () => {
    const { face, workspace } = registry('/tmp/canvas-g', { refuseAttach: true })
    const ctx = container({ workspaceRegistry: face }) as never
    await expect(
      claimCanvasWorkspace(ctx, { root: '/tmp/canvas-g', title: 'g' }, ['session-7']),
    ).resolves.toBe(0)
    await expect(attachCanvasSession(ctx, { root: '/tmp/canvas-g', title: 'g' }, 'session-7')).resolves.toBe(false)
    expect(workspace.attachSession.mock.calls).toEqual([['session-7'], ['session-7']])
  })
})
