/**
 * The canvas row's actions (F1.5 revision) — the two decisions behind them.
 *
 * The components are view, and the floating layers are the host's own primitives
 * now (placement, Escape, outside-click all live there and are not ours to test).
 * What can still drift silently and break the feature is:
 *
 * - which application id opens the folder (the host filters its catalog by
 *   platform, so a wrong pick here is a button that reports "unknown app"
 *   instead of opening anything), and
 * - which rows the menu carries — and specifically that "open folder" is gone
 *   entirely on a deployment with no file manager, rather than present and
 *   failing when pressed.
 *
 * Both live in modules with no host-primitive imports, which is what lets these
 * run in plain Node: `canvas-menu.tsx` itself pulls in the browser `Menu` /
 * `Modal` (React, react-dom, CSS modules) and is exercised end-to-end instead.
 */
import { describe, expect, it } from 'vitest'
import { FILE_MANAGER_APPS, fileManagerOf } from '../../../../src/client/canvas/project/open-folder.ts'
import { ROW_ACTIONS, rowActions } from '../../../../src/client/canvas/project/row-actions.ts'

describe('file manager selection', () => {
  it('picks the file manager a host actually reports', () => {
    expect(fileManagerOf(['finder', 'vscode', 'iterm'])).toBe('finder')
    expect(fileManagerOf(['explorer', 'cursor'])).toBe('explorer')
    expect(fileManagerOf(['filemanager'])).toBe('filemanager')
  })

  it('does not care where in the list it sits', () => {
    expect(fileManagerOf(['terminal', 'iterm', 'finders', 'finder'])).toBe('finder')
  })

  it('is empty when the deployment has no file manager at all', () => {
    expect(fileManagerOf([])).toBe('')
    expect(fileManagerOf(['vscode', 'xcode'])).toBe('')
  })

  it('never mistakes a code editor for the file manager', () => {
    for (const id of ['vscode', 'cursor', 'zed', 'sublimetext', 'androidstudio']) {
      expect(fileManagerOf([id])).toBe('')
    }
  })

  it('offers exactly the platform file managers, file manager first', () => {
    // The host already filtered by platform, so at most one is ever present; the
    // order is what makes a host that reports several (a future one) deterministic.
    expect(FILE_MANAGER_APPS).toEqual(['finder', 'explorer', 'filemanager'])
    expect(fileManagerOf(['filemanager', 'explorer', 'finder'])).toBe('finder')
  })
})

describe('row action menu contents', () => {
  it('carries open-folder then delete on a machine that can open folders', () => {
    expect(rowActions('finder')).toEqual(['open', 'remove'])
  })

  it('drops open-folder entirely when there is no file manager', () => {
    // Not disabled — absent. A row that is always refused is worse than no row.
    expect(rowActions('')).toEqual(['remove'])
  })

  it('names every row from the dictionary', () => {
    expect(ROW_ACTIONS.open.label).toBe('canvas.menu.open')
    expect(ROW_ACTIONS.remove.label).toBe('canvas.menu.remove')
  })

  it('marks only the destructive row as danger', () => {
    expect(ROW_ACTIONS.open.danger).toBe(false)
    expect(ROW_ACTIONS.remove.danger).toBe(true)
  })

  it('has a policy entry for every action it can offer', () => {
    // Guards the union against a new id being added to `rowActions` with no copy.
    for (const id of [...rowActions('finder'), ...rowActions('')]) {
      expect(ROW_ACTIONS[id]).toBeDefined()
    }
  })
})
