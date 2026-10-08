/** Error-centric browser for the safe Session-list episode projection. */

import { useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ErrorListEntry } from '@errgrind/episode'
import {
  IconUnarchiveOutlineRegular, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './locales.ts'
import css from './ErrorHistory.module.css'

export interface ErrorHistoryInjected {
  /** Navigate to the selected existing Session. */
  readonly openSession: (sessionId: SessionId) => void
  /** Restore an archived Session to this list. */
  readonly unarchiveSession: (sessionId: SessionId) => Promise<void>
}

export type ErrorHistoryProps = PropsRuntime<'sidebar.workspaces'>
  & PropsLocale<typeof NS>
  & ErrorHistoryInjected

/**
 * Map one list entry onto the shared status-dot palette. Finished Errors and
 * unclassified rows carry no dot; practice rows stay green while they linger
 * in the list awaiting judgement or retirement.
 */
function statusDot(episode: ErrorListEntry): StateDotState | null {
  if (episode.kind === 'drill') return 'done'
  switch (episode.status) {
    case 'grill': return 'ongoing'
    case 'confirm': return 'warning'
    case 'teach': return null
  }
}

/**
 * List rank: practice Sessions awaiting an answer lead, then Errors pending
 * follow-ups, Errors pending confirmation, and finished Errors last.
 */
function statusRank(episode: ErrorListEntry): number {
  if (episode.kind === 'drill') return 0
  switch (episode.status) {
    case 'grill': return 1
    case 'confirm': return 2
    case 'teach': return 3
  }
}

/** Replaces the general Workspace browser with the learner's Error history. */
export function ErrorHistory({
  wide,
  expandSidebar,
  useSessions,
  useWorkspaces,
  openSession,
  unarchiveSession,
  t,
}: ErrorHistoryProps) {
  const list = useSessions(state => state)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const archived = useMemo(() => new Set(archivedSessionIds), [archivedSessionIds])
  const [query, setQuery] = useState('')
  const [busySession, setBusySession] = useState<SessionId | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const needle = query.trim().toLocaleLowerCase()
  const errors = useMemo(() => list.ids.flatMap((id) => {
    const session = list.byId[id]
    const episode = session?.projectionValues?.errgrindEpisode
    if (session === undefined || episode == null || archived.has(id)) return []
    const title = session.displayTitle
    // The search field names Error descriptions; practice Sessions stay listed
    // but never match it.
    if (needle && (episode.kind === 'drill'
      || !`${episode.description?.trim() || title} ${title}`.toLocaleLowerCase().includes(needle))) return []
    return [{ sessionId: id, episode, title }]
  }).sort((a, b) => statusRank(a.episode) - statusRank(b.episode)), [list, needle, archived])
  // The header counts Errors; practice Sessions share the list but are not Errors.
  const errorCount = useMemo(() => errors.filter(entry => entry.episode.kind !== 'drill').length, [errors])
  // A cold Session can lack a projection-cache hint. Keep it reachable so
  // opening it can reconstruct the authoritative Error state.
  const unclassified = useMemo(() => list.ids.flatMap((id) => {
    const session = list.byId[id]
    if (session === undefined || session.blank || archived.has(id)
      || session.projectionValues?.errgrindEpisode !== undefined) return []
    if (needle && !session.displayTitle.toLocaleLowerCase().includes(needle)) return []
    return [{ sessionId: id, title: session.displayTitle }]
  }), [list, needle, archived])
  // Archived Errors stay reachable here because this panel replaces the
  // Workspace browser, which carries the only other unarchive affordance.
  // Archived practice Sessions are throwaway by contract: they leave no trace.
  const archivedEntries = useMemo(() => list.ids.flatMap((id) => {
    const session = list.byId[id]
    if (session === undefined || session.blank || !archived.has(id)) return []
    const episode = session.projectionValues?.errgrindEpisode
    if (episode?.kind === 'drill') return []
    const title = session.displayTitle
    if (needle && !`${episode?.description?.trim() || title} ${title}`.toLocaleLowerCase().includes(needle)) return []
    return [{ sessionId: id, title }]
  }), [list, needle, archived])

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

  const statusLabel = (episode: ErrorListEntry): string => {
    if (episode.kind === 'drill') return t('history.status.practice')
    switch (episode.status) {
      case 'grill': return t('history.status.grill')
      case 'confirm': return t('history.status.confirm')
      case 'teach': return t('history.status.teach')
    }
  }

  const runRowAction = async (
    sessionId: SessionId,
    action: () => Promise<void>,
    done: string,
    failed: string,
  ): Promise<void> => {
    setBusySession(sessionId)
    setNotice(null)
    try {
      await action()
      setNotice(done)
    } catch {
      setNotice(failed)
    } finally {
      setBusySession(null)
    }
  }

  return (
    <section className={css.root} aria-label={t('history.title')}>
      <header className={css.header}>
        <h2>{t('history.title')}</h2>
        <span className={css.count} aria-label={t('history.count', { count: errorCount })}>{errorCount}</span>
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
      {archivedEntries.length > 0 && (
        <button
          className={css.archivedToggle}
          type="button"
          aria-expanded={showArchived}
          onClick={() => { setShowArchived(value => !value) }}
        >
          {t(showArchived ? 'history.hideArchived' : 'history.showArchived')} ({archivedEntries.length})
        </button>
      )}
      <div className={css.list}>
        {errors.length === 0 && unclassified.length === 0
          ? <p className={css.empty}>{needle ? t('history.emptySearch') : t('history.empty')}</p>
          : errors.map(({ sessionId, episode, title }) => {
            const dot = statusDot(episode)
            return (
              <article className={css.row} key={sessionId} data-error-session-id={sessionId}>
                <button
                  className={css.rowOpen}
                  type="button"
                  title={statusLabel(episode)}
                  aria-label={`${title} · ${statusLabel(episode)}`}
                  onClick={() => { openSession(sessionId) }}
                >
                  <span className={css.rowTitle}>{title}</span>
                  {dot !== null && <StateDot state={dot} size={10} className={css.rowDot} />}
                </button>
              </article>
            )
          })}
        {unclassified.length > 0 && (
          <p className={css.empty}>{t('history.unclassified')}</p>
        )}
        {unclassified.map(({ sessionId, title }) => (
          <article className={css.row} key={sessionId} data-error-session-id={sessionId}>
            <button className={css.rowOpen} type="button" onClick={() => { openSession(sessionId) }}>
              <span className={css.rowTitle}>{title}</span>
              <StateDot state="idle" size={10} className={css.rowDot} />
            </button>
          </article>
        ))}
        {showArchived && archivedEntries.length > 0 && (
          <p className={css.empty}>{t('history.archivedSection')}</p>
        )}
        {showArchived && archivedEntries.map(({ sessionId, title }) => (
          <article className={css.row} key={sessionId} data-error-session-id={sessionId}>
            <button
              className={css.rowOpen}
              type="button"
              title={t('history.status.archived')}
              onClick={() => { setNotice(t('history.archivedNotOpenable')) }}
            >
              <span className={css.rowTitle}>{title}</span>
              <StateDot state="idle" size={10} className={css.rowDot} />
            </button>
            <button
              className={css.iconAction}
              type="button"
              aria-label={t('history.unarchive')}
              title={t('history.unarchive')}
              disabled={busySession === sessionId}
              onClick={() => {
                void runRowAction(
                  sessionId,
                  () => unarchiveSession(sessionId),
                  t('history.unarchived'),
                  t('history.unarchiveFailed'),
                )
              }}
            >
              <IconUnarchiveOutlineRegular />
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}
