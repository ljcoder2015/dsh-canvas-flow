/**
 * dsh-canvas — the folder picker (design screen 02).
 *
 * The one place a new canvas project comes from. It walks real directories
 * through `canvas.listFolders` — the host owns what "a directory is listable"
 * means and which root the walk starts at — and binds the chosen folder to a
 * project on confirm. It never reads or writes a file itself.
 */
import { useCallback, useEffect, useState } from 'react'
import type { FolderEntry, ProjectBinding } from '../../../types.ts'
import type { CanvasBridge } from '../../wire/bridge.ts'
import type { Translate } from '../../ui/locales.ts'
import { basenameOf, dirnameOf } from '../../wire/address.ts'

/** Props of the folder picker. */
export interface FolderPickerProps {
  bridge: CanvasBridge
  t: Translate
  /** Called with the bound project once the user confirms. */
  onBound: (binding: ProjectBinding) => void
  onCancel: () => void
}

/** Render the picker dialog. */
export function FolderPicker(props: FolderPickerProps) {
  const { bridge, t, onBound, onCancel } = props
  // An empty path asks the host for its configured picker root — the canvas
  // records where a user's folders begin, and the browser has no business
  // guessing at `$HOME`.
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<FolderEntry[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    bridge
      .listFolders(path)
      .then((listing) => {
        if (!cancelled) setEntries(listing)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : t('canvas.error.unknown'))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [bridge, path, t])

  const confirm = useCallback(() => {
    if (busy) return
    setBusy(true)
    setError('')
    bridge
      .createProject(name, path)
      .then((binding: ProjectBinding) => onBound(binding))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('canvas.error.unknown')))
      .finally(() => setBusy(false))
  }, [bridge, busy, name, onBound, path, t])

  const parent = dirnameOf(path)
  const here = path === '' ? t('canvas.action.pickProject') : basenameOf(path)

  return (
    <div className="dsh-canvas-scrim" onPointerDown={(event) => event.stopPropagation()}>
      <div className="dsh-canvas-dialog" role="dialog">
        <div className="dsh-canvas-dialog-head">
          {t('canvas.picker.title')}
          <span style={{ marginLeft: 'auto' }} />
          <button className="dsh-canvas-chipbtn" onClick={onCancel}>
            {t('canvas.action.cancel')}
          </button>
        </div>

        <div className="dsh-canvas-dialog-path">{path === '' ? '~' : path}</div>

        <div className="dsh-canvas-dialog-list">
          {path !== '' ? (
            <button className="dsh-canvas-row" onClick={() => setPath(parent)}>
              ↰ {t('canvas.picker.parent')}
              <span className="dsh-canvas-row-meta">{parent}</span>
            </button>
          ) : null}

          {entries
            .filter((entry) => entry.selectable)
            .map((entry) => (
              <button className="dsh-canvas-row" key={entry.path} onClick={() => setPath(entry.path)}>
                {entry.name}
                <span className="dsh-canvas-row-meta">{entry.size}</span>
              </button>
            ))}

          {entries.length === 0 && !busy ? <div className="dsh-canvas-dialog-path">{t('canvas.picker.empty')}</div> : null}
        </div>

        {error !== '' ? <div className="dsh-canvas-dialog-path">{t('canvas.error', { message: error })}</div> : null}

        <div className="dsh-canvas-dialog-foot">
          <input
            className="dsh-canvas-input"
            placeholder={t('canvas.picker.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="dsh-canvas-chipbtn" data-primary="true" disabled={busy} onClick={confirm} title={here}>
            {t('canvas.picker.here')}
          </button>
        </div>
      </div>
    </div>
  )
}
