/** First-use model setup, shown only while a blank Error has no selectable provider. */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import { NS } from './locales.ts'
import css from './ModelOnboarding.module.css'

export type ModelOnboardingProps = PropsRuntime<'conversation.input.dock'>
  & PropsLocale<typeof NS>
  & {
    readonly catalog: ClientRemote['session']['modelCatalog']
  }

export function ModelOnboarding({ session, catalog, t }: ModelOnboardingProps) {
  const [needsSetup, setNeedsSetup] = useState(false)

  useEffect(() => {
    if (!session.blank) return
    let alive = true
    const timer = setInterval(() => { void refresh() }, 3000)
    const refresh = async (): Promise<void> => {
      try {
        const catalogResult = await catalog()
        if (!alive || !catalogResult.ok) return
        const available = catalogResult.value.groups.some(group => group.models.length > 0)
        const show = !available && catalogResult.value.failures.length === 0
        setNeedsSetup(show)
        if (!show) clearInterval(timer)
      } catch {
        // The model picker reports transport failures; avoid a false setup prompt.
      }
    }
    void refresh()
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [session.blank, catalog])

  if (!session.blank || !needsSetup) return null
  return (
    <div className={css.root}>
      <p className={css.title}>{t('onboarding.title')}</p>
      <p className={css.alternative}>{t('onboarding.alternative')}</p>
    </div>
  )
}
