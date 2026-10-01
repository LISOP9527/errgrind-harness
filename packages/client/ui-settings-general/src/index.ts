/** Welcome acknowledgement stored in the plugin configuration. */
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'

import type { Volatile, Context } from '@deepseek-ai/cordis'

import z from '@deepseek-ai/schemastery'
import { HIDDEN_SETTINGS_ITEMS_GLOBAL } from './hidden-items.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Last acknowledged welcome notice version. */
  welcomeNoticeVersion: Volatile<string | undefined>
  /** Settings contribution ids the deployment never renders. */
  hiddenSettingsItems: string[]
}

/** Live welcome preference plus the deployment's hidden-row list. */
export const Config = z.object({
  welcomeNoticeVersion: z.string().volatile(),
  hiddenSettingsItems: z.array(z.string()).default([]),
})

/**
 * Project the hidden-item choice onto the page before browser plugins
 * activate, and consume the preferences through the configuration form.
 * @param ctx Plugin context used for optional settings presentation.
 * @param config Plugin options with schema defaults applied by the Loader.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global',
      name: HIDDEN_SETTINGS_ITEMS_GLOBAL,
      value: { hiddenSettingsItems: config.hiddenSettingsItems },
    })
  })
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
