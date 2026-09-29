/** Error-centric browser for the safe Session-list episode projection. */

import { useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ErrorListEntry } from '@errgrind/episode'
import { NS } from './locales.ts'
import css from './ErrorHistory.module.css'

export interface ErrorHistoryInjected {
  /** Navigate to the selected existing Session. */
  readonly openSession: (sessionId: SessionId) => void
  /** Open the existing Error Session and queue the learner-triggered Drill request. */
  readonly practiceFromError: (sessionId: SessionId) => Promise<void>
}

export type ErrorHistoryProps = PropsRuntime<'sidebar.workspaces'>
  & PropsLocale<typeof NS>
  & ErrorHistoryInjected

/** Replaces the general Workspace browser with the learner's Error history. */
export function ErrorHistory({
  wide,
  expandSidebar,
  useSessions,
  openSession,
  practiceFromError,
  t,
}: ErrorHistoryProps) {
  const list = useSessions(state => state)
  const [query, setQuery] = useState('')
  const [busySession, setBusySession] = useState<SessionId | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const needle = query.trim().toLocaleLowerCase()
  const errors = useMemo(() => list.ids.flatMap((id) => {
    const session = list.byId[id]
    const episode = session?.projectionValues?.errgrindEpisode
    if (session === undefined || episode == null) return []
    const description = episode.description?.trim() || session.displayTitle
    if (needle && !`${description} ${session.displayTitle}`.toLocaleLowerCase().includes(needle)) return []
    return [{ sessionId: id, description, episode }]
  }), [list, needle])
  // A cold Session can lack a projection-cache hint. Keep it reachable so
  // opening it can reconstruct the authoritative Error state.
  const unclassified = useMemo(() => list.ids.flatMap((id) => {
    const session = list.byId[id]
    if (session === undefined || session.blank || session.projectionValues?.errgrindEpisode !== undefined) return []
    if (needle && !session.displayTitle.toLocaleLowerCase().includes(needle)) return []
    return [{ sessionId: id, title: session.displayTitle }]
  }), [list, needle])

  if (!wide) {
    return (
      <button className={css.railButton} type="button" onClick={expandSidebar}
        aria-label={t('history.title')} title={t('history.title')}>
        <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 5.8v4.4l3 1.8" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    )
  }

  const statusLabel = (status: ErrorListEntry['status']): string => {
    switch (status) {
      case 'grill': return t('history.status.grill')
      case 'confirm': return t('history.status.confirm')
      case 'teach': return t('history.status.teach')
    }
  }

  const startPractice = async (sessionId: SessionId): Promise<void> => {
    setBusySession(sessionId)
    setNotice(null)
    try {
      await practiceFromError(sessionId)
      setNotice(t('history.practiceQueued'))
    } catch {
      setNotice(t('history.practiceFailed'))
    } finally {
      setBusySession(null)
    }
  }

  return (
    <section className={css.root} aria-label={t('history.title')}>
      <header className={css.header}>
        <h2>{t('history.title')}</h2>
        <span className={css.count} aria-label={t('history.count', { count: errors.length })}>{errors.length}</span>
      </header>
      <label className={css.searchLabel}>
        <span>{t('history.searchLabel')}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.currentTarget.value) }}
          placeholder={t('history.searchPlaceholder')}
        />
      </label>
      {notice !== null && <p className={css.notice} role="status">{notice}</p>}
      <div className={css.list}>
        {errors.length === 0 && unclassified.length === 0
          ? <p className={css.empty}>{needle ? t('history.emptySearch') : t('history.empty')}</p>
          : errors.map(({ sessionId, description, episode }) => (
            <article className={css.card} key={sessionId} data-error-session-id={sessionId}>
              <button className={css.openButton} type="button" onClick={() => { openSession(sessionId) }}>
                <span className={css.description}>{description}</span>
                <span className={css.status}>{statusLabel(episode.status)}</span>
              </button>
              {episode.drillEligible && (
                <button
                  className={css.practiceButton}
                  type="button"
                  disabled={busySession === sessionId}
                  onClick={() => { void startPractice(sessionId) }}
                >
                  {busySession === sessionId ? t('history.practiceSending') : t('history.practice')}
                </button>
              )}
            </article>
          ))}
        {unclassified.length > 0 && (
          <p className={css.empty}>{t('history.unclassified')}</p>
        )}
        {unclassified.map(({ sessionId, title }) => (
          <button className={css.unknownButton} key={sessionId} type="button" onClick={() => { openSession(sessionId) }}>
            {title}
          </button>
        ))}
      </div>
    </section>
  )
}
