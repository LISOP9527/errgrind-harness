/** ErrGrind's ChatGPT Codex authorization controls for the Models settings footer. */

import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientRemote, CodexAuthNotice, CodexAuthStatus } from '@deepseek-ai/dsh-api-remotes/client'
import { NS } from './locales.ts'
import css from './EpisodeCards.module.css'

/** The typed Codex authorization namespace contributed by the Host Remote. */
export type CodexAuthRemote = ClientRemote['errgrindCodexAuth']

/** Complete settings footer props for the ErrGrind Codex authorization controls. */
export type CodexAuthSettingsProps = PropsLocale<typeof NS>
  & { readonly auth: CodexAuthRemote }

/** Show server-owned Codex sign-in state and the one-time device authorization code. */
export function CodexAuthSettings({ auth, t }: CodexAuthSettingsProps) {
  const [status, setStatus] = useState<CodexAuthStatus | null>(null)
  const [notices, setNotices] = useState<readonly CodexAuthNotice[]>([])
  const [cursor, setCursor] = useState(0)
  const [starting, setStarting] = useState(false)
  const [failure, setFailure] = useState(false)
  const [copyState, setCopyState] = useState<'url' | 'code' | 'failed' | null>(null)
  const refreshInFlight = useRef(false)
  const cursorRef = useRef(cursor)
  const keepPolling = useRef(true)

  cursorRef.current = cursor
  keepPolling.current = status === null
    || status.phase === 'waiting'
    || status.phase === 'idle' && status.inFlight

  useEffect(() => {
    const lifetime = new AbortController()

    async function refresh(): Promise<void> {
      if (refreshInFlight.current || lifetime.signal.aborted) return
      refreshInFlight.current = true
      try {
        const [statusResult, noticeResult] = await Promise.all([auth.status(), auth.noticesAfter(cursorRef.current)])
        if (!statusResult.ok || !noticeResult.ok) {
          throw new Error('Codex authorization state is unavailable')
        }
        const nextStatus = statusResult.value
        const page = noticeResult.value
        // Cleanup can abort while the Remote promises above are pending.
        // oxlint-disable-next-line typescript/no-unnecessary-condition
        if (lifetime.signal.aborted) return
        setStatus(nextStatus)
        setNotices((current) => {
          const seen = new Set(current.map(notice => notice.id))
          return [...current, ...page.notices.filter(notice => !seen.has(notice.id))]
        })
        setCursor(page.next)
        setFailure(false)
      } catch {
        // oxlint-disable-next-line typescript/no-unnecessary-condition
        if (!lifetime.signal.aborted) setFailure(true)
      } finally {
        refreshInFlight.current = false
      }
    }

    void refresh()
    const timer = globalThis.setInterval(() => {
      if (keepPolling.current) void refresh()
    }, 1000)
    return () => {
      lifetime.abort()
      globalThis.clearInterval(timer)
    }
  }, [auth])

  async function begin(): Promise<void> {
    if (starting) return
    setStarting(true)
    setFailure(false)
    setCopyState(null)
    setNotices([])
    cursorRef.current = 0
    setCursor(0)
    try {
      const result = await auth.beginDeviceCode()
      if (!result.ok) throw new Error('Could not start Codex authorization')
      if (!result.value.started) setFailure(true)
      const statusResult = await auth.status()
      if (!statusResult.ok) throw new Error('Could not read Codex authorization status')
      setStatus(statusResult.value)
    } catch {
      setFailure(true)
    } finally {
      setStarting(false)
    }
  }

  async function cancel(): Promise<void> {
    try {
      const result = await auth.cancel()
      if (!result.ok) throw new Error('Could not cancel Codex authorization')
      const statusResult = await auth.status()
      if (!statusResult.ok) throw new Error('Could not read Codex authorization status')
      setStatus(statusResult.value)
    } catch {
      setFailure(true)
    }
  }

  async function copy(value: string, target: 'url' | 'code'): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setCopyState(target)
    } catch {
      setCopyState('failed')
    }
  }

  const latestNotice = notices.at(-1)
  const active = status?.phase === 'waiting' || status?.phase === 'idle' && status.inFlight
  const signedIn = status?.authorized === true
  const unavailable = status?.available === false

  return (
    <section className={css.authCard} aria-labelledby="errgrind-codex-auth-title">
      <header className={css.header}>
        <h3 className={css.title} id="errgrind-codex-auth-title">{t('codex.title')}</h3>
        {signedIn && <span className={css.status} role="status">{t('codex.signedIn')}</span>}
      </header>
      <p className={css.hint}>{t('codex.description')}</p>

      {status === null && <p className={css.statusLine} role="status">{t('codex.loading')}</p>}
      {unavailable && <p className={css.feedback} role="status">{t('codex.unavailable')}</p>}
      {failure && <p className={css.feedback} role="status">{active ? t('codex.refreshFailed') : t('codex.failed')}</p>}
      {status?.phase === 'cancelled' && <p className={css.statusLine} role="status">{t('codex.cancelled')}</p>}

      {active && (
        <div className={css.authPending} aria-live="polite">
          <p className={css.statusLine}>{t('codex.waiting')}</p>
          {latestNotice !== undefined && (
            <>
              <div className={css.authLinkRow}>
                <a className={css.authLink} href={latestNotice.verificationUri} target="_blank" rel="noopener noreferrer">
                  {t('codex.open')}
                </a>
                <button className={css.copyButton} type="button" onClick={() => { void copy(latestNotice.verificationUri, 'url') }}>
                  {copyState === 'url' ? t('codex.copied') : t('codex.copyLink')}
                </button>
              </div>
              <div className={css.authCodeRow}>
                <span className={css.authCodeLabel}>{t('codex.code')}</span>
                <code className={css.authCode}>{latestNotice.userCode}</code>
                <button className={css.copyButton} type="button" onClick={() => { void copy(latestNotice.userCode, 'code') }}>
                  {copyState === 'code' ? t('codex.copied') : t('codex.copy')}
                </button>
              </div>
              {copyState === 'failed' && <p className={css.feedback} role="status">{t('codex.copyFailed')}</p>}
            </>
          )}
          <button className={css.secondaryButton} type="button" onClick={() => { void cancel() }}>{t('codex.cancel')}</button>
        </div>
      )}

      {!unavailable && !active && (
        <button className={css.confirmButton} type="button" disabled={starting || status === null} onClick={() => { void begin() }}>
          {starting ? t('codex.starting') : failure || status?.phase === 'cancelled' || status?.phase === 'failed' ? t('codex.retry') : signedIn ? t('codex.signInAgain') : t('codex.signIn')}
        </button>
      )}
    </section>
  )
}
