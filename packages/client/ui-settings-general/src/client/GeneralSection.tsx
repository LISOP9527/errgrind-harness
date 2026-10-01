/** The General section: one column rendering feature-owned item contributions. */
import type { InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GeneralSection.module.css'

/** Registrant-private injected share: deployment-hidden row ids. */
export interface GeneralSectionInjected {
  /** `settings.general.item` registration ids that must not render. */
  hiddenItems: readonly string[]
}

/** Full component props: section owner share plus item render share. */
export type GeneralSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.general.item'> & InjectFace<GeneralSectionInjected>

/**
 * Render the General section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function GeneralSection({ renderSlot, hiddenItems }: GeneralSectionComponentProps) {
  return (
    <div className={css.section}>
      {renderSlot('settings.general.item', {}, { except: hiddenItems })}
    </div>
  )
}
