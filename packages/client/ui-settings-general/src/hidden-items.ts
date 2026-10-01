/** Deployment-hidden Settings contribution ids shared by the Host and Client halves. */

import z from '@deepseek-ai/schemastery'

/** Page-global key carrying the hidden contribution ids. */
export const HIDDEN_SETTINGS_ITEMS_GLOBAL = '__DSH_SETTINGS_HIDDEN_ITEMS__'

/**
 * Validate the page payload once in the browser. `hiddenSettingsItems` lists
 * registration ids of `settings.general.item` and `settings.action`
 * contributions that must not render; unknown ids simply hide nothing.
 */
export const HiddenItemsPayload = z.object({
  hiddenSettingsItems: z.array(z.string()).default([]),
})
