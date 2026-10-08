/** Practice launcher page: drill one confirmed Error or let the model pick from a learner-chosen pool. */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, Checkbox, IconGoalOutlineRegular, IconRightUpOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './locales.ts'
import css from './PracticePage.module.css'

export interface PracticePageInjected {
  /** Navigate to an existing Session row. */
  readonly openSession: (sessionId: SessionId) => void
  /** Open a Drill Session for one Error; `title` is the localized Session title to pin. */
  readonly practiceFromError: (sessionId: SessionId, title: (index: number) => string) => Promise<void>
  /** Open a Drill Session whose model picks one Error from the given pool; `title` pins the Session name. */
  readonly practiceFromPool: (sessionIds: readonly SessionId[], title: (index: number) => string) => Promise<void>
}

export type PracticePageProps = PropsRuntime<'main'>
  & PropsLocale<typeof NS>
  & PracticePageInjected

/** Practice landing: per-Error drill buttons plus a select-all pool the model picks from. */
export function PracticePage({
  useSessions,
  useWorkspaces,
  openSession,
  practiceFromError,
  practiceFromPool,
  t,
}: PracticePageProps): ReactNode {
  const list = useSessions(state => state)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const archived = useMemo(() => new Set(archivedSessionIds), [archivedSessionIds])
  const [selected, setSelected] = useState<ReadonlySet<SessionId>>(new Set())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const candidates = useMemo(() => list.ids.flatMap((id) => {
    const session = list.byId[id]
    const episode = session?.projectionValues?.errgrindEpisode
    if (session === undefined || episode == null || archived.has(id)
      || episode.kind !== 'error' || !episode.drillEligible) return []
    return [{ sessionId: id, title: session.displayTitle }]
  }), [list, archived])
  const selectedIds = useMemo(
    () => candidates.filter(entry => selected.has(entry.sessionId)).map(entry => entry.sessionId),
    [candidates, selected],
  )
  const allSelected = candidates.length > 0 && selectedIds.length === candidates.length

  const practiceTitle = (index: number, description: string): string =>
    t('history.practiceSessionTitleIndexed', { index: index + 1, description })

  const runPractice = async (open: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      await open()
      setNotice(t('practice.opened'))
    } catch {
      setNotice(t('practice.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={css.page}>
      <header className={css.pageHead}>
        <h1 className={css.pageTitle}>{t('practice.title')}</h1>
        <p className={css.pageIntro}>{t('practice.intro')}</p>
      </header>
      {notice !== null && <p className={css.notice} role="status">{notice}</p>}
      {candidates.length === 0
        ? <p className={css.empty}>{t('practice.empty')}</p>
        : (
          <div className={css.list}>
            <div className={css.toolbar}>
              <Checkbox
                checked={allSelected}
                label={t('practice.selectAll')}
                onChange={(next) => {
                  setSelected(next ? new Set(candidates.map(entry => entry.sessionId)) : new Set())
                }}
              />
              <span className={css.selectedCount}>
                {t('practice.selected', { count: selectedIds.length })}
              </span>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || selectedIds.length === 0}
                onClick={() => {
                  void runPractice(() => practiceFromPool(
                    selectedIds,
                    index => practiceTitle(index, t('practice.poolLabel')),
                  ))
                }}
              >
                {t('practice.drillPool')}
              </Button>
            </div>
            {candidates.map(({ sessionId, title }) => (
              <div className={css.row} key={sessionId} data-practice-candidate={sessionId}>
                <Checkbox
                  checked={selected.has(sessionId)}
                  label={title}
                  title={title}
                  className={css.rowCheck}
                  onChange={(next) => {
                    setSelected((previous) => {
                      const nextSet = new Set(previous)
                      if (next) nextSet.add(sessionId)
                      else nextSet.delete(sessionId)
                      return nextSet
                    })
                  }}
                />
                <button
                  className={css.rowOpen}
                  type="button"
                  aria-label={t('practice.openError')}
                  title={t('practice.openError')}
                  onClick={() => { openSession(sessionId) }}
                >
                  <IconRightUpOutlineRegular size={14} />
                </button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    void runPractice(() => practiceFromError(
                      sessionId,
                      index => practiceTitle(index, title),
                    ))
                  }}
                >
                  {t('practice.drillOne')}
                </Button>
              </div>
            ))}
          </div>
        )}
      {busy && (
        <p className={css.opening} role="status">
          <StateDot state="ongoing" size={12} />{t('practice.opening')}
        </p>
      )}
    </section>
  )
}

/** Sidebar entry icon for the Practice page. */
export function PracticePanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconGoalOutlineRegular size={size} />
}
