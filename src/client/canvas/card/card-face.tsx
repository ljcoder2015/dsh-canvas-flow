/**
 * dsh-canvas — the card face, shared by both of the surfaces that show one.
 *
 * Two places need to describe a single card rather than the whole board: the
 * conversation view's canvas tab, and the per-kind tab an artifact opens in.
 * They differ only in how they find the card, so the loading and the drawing
 * live here once.
 *
 * Everything it shows comes from the card's own Remote methods — digest,
 * material, chain, queued intents. Nothing reads a file directly, and nothing
 * duplicates a value the host already computed.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { fileSizeText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CardSummary, PendingIntent, SourceChain } from '../../../types.ts'
import type { CanvasBridge, LocatedCard } from '../../wire/bridge.ts'
import type { Translate } from '../../ui/locales.ts'
import { basenameOf } from '../../wire/address.ts'

/** What one card's face is made of, once loaded. */
export interface CardFacts {
  summary: CardSummary | undefined
  /** Digests of the cards this one takes material from. */
  material: CardSummary[]
  chain: SourceChain | undefined
  pending: PendingIntent[]
  loading: boolean
  error: string
}

const EMPTY: CardFacts = { summary: undefined, material: [], chain: undefined, pending: [], loading: false, error: '' }

/**
 * Load one card's facts.
 *
 * @param bridge - the plugin's call surface.
 * @param located - the project and card, or `undefined` while still being resolved.
 * @param t - translate, for the failure line.
 * @returns the facts; `loading` while a resolution or a read is outstanding.
 */
export function useCardFacts(bridge: CanvasBridge, located: LocatedCard | undefined, t: Translate): CardFacts {
  const [facts, setFacts] = useState<CardFacts>(EMPTY)
  const projectId = located?.project.id ?? ''
  const cardId = located?.card.id ?? ''

  useEffect(() => {
    if (projectId === '' || cardId === '') {
      setFacts(EMPTY)
      return
    }
    let cancelled = false
    setFacts((current) => ({ ...current, loading: true, error: '' }))
    void Promise.all([
      bridge.readSummary(projectId, cardId),
      bridge.readSources(projectId, cardId).catch(() => [] as CardSummary[]),
      bridge.getSources(projectId, cardId).catch(() => undefined),
      bridge.readPending(projectId, cardId).catch(() => [] as PendingIntent[]),
    ])
      .then(([summary, material, chain, pending]) => {
        if (!cancelled) setFacts({ summary, material, chain, pending, loading: false, error: '' })
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setFacts({ ...EMPTY, error: reason instanceof Error ? reason.message : t('canvas.error.unknown') })
      })
    return () => {
      cancelled = true
    }
  }, [bridge, cardId, projectId, t])

  return facts
}

/** One labelled row of the face. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dsh-canvas-field">
      <span className="dsh-canvas-field-key">{label}</span>
      <span className="dsh-canvas-field-value">{children}</span>
    </div>
  )
}

/** Props of the shared face. */
export interface CardFaceProps {
  located: LocatedCard
  facts: CardFacts
  t: Translate
  /** Buttons the caller adds: a chat entry for the conversation view, a board jump for a tab. */
  children?: ReactNode
}

/** Render one card's face. */
export function CardFace({ located, facts, t, children }: CardFaceProps) {
  const { card, project } = located
  const summary = facts.summary

  return (
    <div className="dsh-canvas-panel">
      <div className="dsh-canvas-panel-head">
        <span className="dsh-canvas-panel-title">{card.name}</span>
        <span className="dsh-canvas-card-meta">{card.kindLabel}</span>
      </div>

      <div className="dsh-canvas-fields">
        <Field label={t('canvas.panel.path')}>{`${project.root}/${card.file}`}</Field>
        <Field label={t('canvas.panel.kind')}>{summary?.kind ?? card.kind}</Field>
        <Field label={t('canvas.panel.size')}>{fileSizeText(summary?.bytes ?? 0)}</Field>
        <Field label={t('canvas.panel.updated')}>{new Date(summary?.updatedAt ?? 0).toLocaleString()}</Field>
      </div>

      <div className="dsh-canvas-block">
        <span className="dsh-canvas-eyebrow">{t('canvas.panel.sources')}</span>
        {facts.material.length === 0 ? (
          <span className="dsh-canvas-muted">{t('canvas.panel.noSources')}</span>
        ) : (
          <div className="dsh-canvas-chain">
            {facts.material.map((entry) => (
              <div className="dsh-canvas-chain-row" key={entry.cardId}>
                <span className="dsh-canvas-chain-arrow">↓</span>
                {basenameOf(entry.path)}
              </div>
            ))}
          </div>
        )}
      </div>

      {facts.chain !== undefined && facts.chain.downstream.length > 0 ? (
        <div className="dsh-canvas-block">
          <span className="dsh-canvas-eyebrow">{t('canvas.panel.downstream')}</span>
          <div className="dsh-canvas-chain">
            {facts.chain.downstream.map((cardId) => (
              <div className="dsh-canvas-chain-row" key={cardId}>
                <span className="dsh-canvas-chain-arrow">→</span>
                {cardId}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="dsh-canvas-block">
        <span className="dsh-canvas-eyebrow">{t('canvas.panel.intents')}</span>
        {facts.pending.length === 0 ? (
          <span className="dsh-canvas-muted">{t('canvas.panel.noIntents')}</span>
        ) : (
          <div className="dsh-canvas-chain">
            {facts.pending.map((intent) => (
              <div className="dsh-canvas-chain-row" key={intent.id}>
                {intent.kind}
                <span className="dsh-canvas-muted">{intent.payload.slice(0, 120)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {facts.error === '' ? null : <div className="dsh-canvas-error" style={{ position: 'static' }}>{t('canvas.error', { message: facts.error })}</div>}

      {children === undefined ? null : <div className="dsh-canvas-panel-actions">{children}</div>}
    </div>
  )
}
