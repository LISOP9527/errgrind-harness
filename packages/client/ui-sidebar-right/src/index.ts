/** Host half: project the dock visibility choice onto the page. */
import type {} from '@deepseek-ai/dsh-host-webserver'

import type { Context } from '@deepseek-ai/cordis'

import { Config, DOCK_CONFIG_GLOBAL } from './dock-config.ts'

export { Config } from './dock-config.ts'

/**
 * Host plugin body: publish the expand-button choice for the browser half.
 * @param ctx Plugin context used for the page-projection listener.
 * @param config Plugin options with schema defaults applied by the Loader.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: DOCK_CONFIG_GLOBAL, value: { expandButton: config.expandButton } })
  })
}
