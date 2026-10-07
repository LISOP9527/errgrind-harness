/** Error-centric browser for the safe Session-list episode projection. */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ErrorListEntry } from '@errgrind/episode'
import {
  IconArchiveOutlineRegular, IconEditOutlineRegular, IconUnarchiveOutlineRegular, relativeTime,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './locales.ts'
import css from './ErrorHistory.module.css'

export interface ErrorHistoryInjected {
  /** Navigate to the selected existing Session. */
  readonly openSession: (sessionId: SessionId) => void
  /** Open the dedicated Drill Session and queue the learner-triggered practice; `title` is the localized Session title to pin. */
  readonly practiceFromError: (sessionId: SessionId, title: (index: number) => string) => Promise<void>
  /** Rename the Session's display title. */
  readonly renameSession: (sessionId: SessionId, title: string) => Promise<void>
  /** Archive the Session (the row then leaves this list). */
  readonly archiveSession: (sessionId: SessionId) => Promise<void>
  /** Restore an archived Session to this list. */
  readonly unarchiveSession: (sessionId: SessionId) => Promise<void>
}

export type ErrorHistoryProps = PropsRuntime<'sidebar.workspaces'>
  & PropsLocale<typeof NS>
  & ErrorHistoryInjected

/** One-line history preview: drop TeX math delimiters so raw \( and $$ stay readable in a single clipped line. */
function previewText(text: string): string {
  return text.replace(/\\\(|\\\)|\\\[|\\\]|\$\$/g, '')
}

/** Replaces the general Workspace browser with the learner's Error history. */
export function ErrorHistory({
  wide,
  expandSidebar,
  useSessions,
  useWorkspaces,
  openSession,
  practiceFromError,
  renameSession,
  archiveSession,
  unarchiveSession,
  t,
}: ErrorHistoryProps) {
  const list = useSessions(state => state)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const archived = useMemo(() => new Set(archivedSessionIds), [archivedSessionIds])
  const [query, setQuery] = useState('')
  const [busySession, setBusySession] = useState<SessionId | null>(null)
  const [editingSession, setEditingSession] = useState<SessionId | null>(null)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const needle = query.trim().toLocaleLowerCase()
  const errors = useMemo(() => list.ids.flatMap((id) => {
    const session = list.byId[id]
    const episode = session?.projectionValues?.errgrindEpisode
    if (session === undefined || episode == null || archived.has(id)) return []
    const description = episode.description?.trim() || session.displayTitle
    if (needle && !`${description} ${session.displayTitle}`.toLocaleLowerCase().includes(needle)) return []
    return [{ sessionId: id, description, episode, title: session.displayTitle, updatedAt: session.updatedAt }]
  }), [list, needle, archived])
  // The header counts Errors; practice Sessions share the list but are not Errors.
  const errorCount = useMemo(() => errors.filter(entry => entry.episode.kind !== 'drill').length, [errors])
  // A cold Session can lack a projection-cache hint. Keep it reachable so
  // opening it can reconstruct the authoritative Error state.
  const unclassified = useMemo(() => list.ids.flatMap((id) => {
    const session = list.byId[id]
    if (session === undefined || session.blank || archived.has(id)
      || session.projectionValues?.errgrindEpisode !== undefined) return []
    if (needle && !session.displayTitle.toLocaleLowerCase().includes(needle)) return []
    return [{ sessionId: id, title: session.displayTitle, updatedAt: session.updatedAt }]
  }), [list, needle, archived])
  // Archived Errors stay reachable here because this panel replaces the
  // Workspace browser, which carries the only other unarchive affordance.
  // Archived practice Sessions are throwaway by contract: they leave no trace.
  const archivedEntries = useMemo(() => list.ids.flatMap((id) => {
    const session = list.byId[id]
    if (session === undefined || session.blank || !archived.has(id)) return []
    const episode = session.projectionValues?.errgrindEpisode
    if (episode?.kind === 'drill') return []
    const description = episode?.description?.trim() || session.displayTitle
    if (needle && !`${description} ${session.displayTitle}`.toLocaleLowerCase().includes(needle)) return []
    return [{ sessionId: id, title: session.displayTitle, updatedAt: session.updatedAt }]
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

  const timeLabel = (at: number): string => {
    const { unit, n } = relativeTime(at, Date.now())
    return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
  }

  const runCardAction = async (
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

  const submitRename = async (sessionId: SessionId): Promise<void> => {
    const title = draft.trim()
    if (title === '') {
      setEditingSession(null)
      return
    }
    setBusySession(sessionId)
    setNotice(null)
    try {
      await renameSession(sessionId, title)
      setEditingSession(null)
    } catch {
      setNotice(t('history.renameFailed'))
    } finally {
      setBusySession(null)
    }
  }

  const cardActions = (sessionId: SessionId, title: string, canArchive: boolean): ReactNode => (
    editingSession === sessionId
      ? (
        <div className={css.renameRow}>
          <input
            className={css.renameInput}
            value={draft}
            aria-label={t('history.renameInput')}
            autoFocus
            onChange={(event) => { setDraft(event.currentTarget.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitRename(sessionId)
              if (event.key === 'Escape') setEditingSession(null)
            }}
          />
          <button
            className={css.actionButton}
            type="button"
            disabled={busySession === sessionId}
            onClick={() => { void submitRename(sessionId) }}
          >
            {t('history.renameSave')}
          </button>
          <button
            className={css.actionButton}
            type="button"
            onClick={() => { setEditingSession(null) }}
          >
            {t('history.renameCancel')}
          </button>
        </div>
      )
      : (
        <div className={css.actions}>
          <button
            className={css.iconAction}
            type="button"
            aria-label={t('history.rename')}
            title={t('history.rename')}
            onClick={() => { setEditingSession(sessionId); setDraft(title) }}
          >
            <IconEditOutlineRegular />
          </button>
          {canArchive && (
            <button
              className={css.iconAction}
              type="button"
              aria-label={t('history.archive')}
              title={t('history.archive')}
              disabled={busySession === sessionId}
              onClick={() => {
                void runCardAction(
                  sessionId,
                  () => archiveSession(sessionId),
                  t('history.archived'),
                  t('history.archiveFailed'),
                )
              }}
            >
              <IconArchiveOutlineRegular />
            </button>
          )}
        </div>
      )
  )

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
          : errors.map(({ sessionId, description, episode, title, updatedAt }) => (
            <article className={css.card} key={sessionId} data-error-session-id={sessionId}>
              <button className={css.openButton} type="button" onClick={() => { openSession(sessionId) }}>
                <span className={css.cardTitle}>{title}</span>
                {description !== title && <span className={css.description}>{previewText(description)}</span>}
                <span className={css.status}>{statusLabel(episode)} · {timeLabel(updatedAt)}</span>
              </button>
              {cardActions(sessionId, title, episode.kind === 'drill')}
              {episode.drillEligible && (
                <button
                  className={css.practiceButton}
                  type="button"
                  disabled={busySession === sessionId}
                  onClick={() => {
                    void runCardAction(
                      sessionId,
                      () => practiceFromError(
                        sessionId,
                        index => t(index === 0 ? 'history.practiceSessionTitle' : 'history.practiceSessionTitleIndexed', {
                          index: index + 1,
                          description: Array.from(description).slice(0, 40).join(''),
                        }),
                      ),
                      t('history.practiceQueued'),
                      t('history.practiceFailed'),
                    )
                  }}
                >
                  {busySession === sessionId ? t('history.practiceSending') : t('history.practice')}
                </button>
              )}
            </article>
          ))}
        {unclassified.length > 0 && (
          <p className={css.empty}>{t('history.unclassified')}</p>
        )}
        {unclassified.map(({ sessionId, title, updatedAt }) => (
          <article className={css.card} key={sessionId}>
            <button className={css.openButton} type="button" onClick={() => { openSession(sessionId) }}>
              <span className={css.cardTitle}>{title}</span>
              <span className={css.status}>{timeLabel(updatedAt)}</span>
            </button>
            {cardActions(sessionId, title, false)}
          </article>
        ))}
        {showArchived && archivedEntries.length > 0 && (
          <p className={css.empty}>{t('history.archivedSection')}</p>
        )}
        {showArchived && archivedEntries.map(({ sessionId, title, updatedAt }) => (
          <article className={css.card} key={sessionId}>
            <button className={css.openButton} type="button" onClick={() => { setNotice(t('history.archivedNotOpenable')) }}>
              <span className={css.cardTitle}>{title}</span>
              <span className={css.status}>{t('history.status.archived')} · {timeLabel(updatedAt)}</span>
            </button>
            <div className={css.actions}>
              <button
                className={css.iconAction}
                type="button"
                aria-label={t('history.unarchive')}
                title={t('history.unarchive')}
                disabled={busySession === sessionId}
                onClick={() => {
                  void runCardAction(
                    sessionId,
                    () => unarchiveSession(sessionId),
                    t('history.unarchived'),
                    t('history.unarchiveFailed'),
                  )
                }}
              >
                <IconUnarchiveOutlineRegular />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
