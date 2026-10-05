/**
 * Model selection plugin, node half. The browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration; the host half only projects the deployment's command-menu
 * choice onto the page.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { type Config, MODEL_COMMAND_MENU_GLOBAL } from './command-menu.ts'

export { Config } from './command-menu.ts'

/**
 * Publish the command-menu choice before browser plugins activate.
 * @param ctx - Host context collecting the page's initialization data.
 * @param config - plugin options with schema defaults applied by the Loader.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global',
      name: MODEL_COMMAND_MENU_GLOBAL,
      value: { commandMenu: config.commandMenu },
    })
  })
}
