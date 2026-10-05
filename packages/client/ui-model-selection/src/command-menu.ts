/** Command-menu visibility option shared by the Host and Client halves. */

import z from '@deepseek-ai/schemastery'

/** Command-menu options after schema defaults are applied. */
export interface Config {
  /** Contribute the /model command-menu row; the composer seat keeps selection either way. */
  commandMenu: boolean
}

/** Validate Host configuration and its public page-bootstrap payload. */
export const Config: z<Partial<Config>, Config> = z.object({
  commandMenu: z.boolean().default(true),
})

/** Page-global key carrying the public command-menu option. */
export const MODEL_COMMAND_MENU_GLOBAL = '__DSH_MODEL_COMMAND_MENU__'
