/** Dock expand-button visibility shared by the Host and Client halves. */

import z from '@deepseek-ai/schemastery'

/** Page-global key carrying the dock visibility choice. */
export const DOCK_CONFIG_GLOBAL = '__DSH_SIDEBAR_RIGHT__'

/**
 * Deployment choice projected to the browser: `expandButton` controls the
 * conversation-header affordance that expands the dock. The dock services
 * stay mounted (ui-chat requires them); only the affordance is gated.
 */
export interface Config {
  /** Render the conversation-corner dock expand button. */
  expandButton: boolean
}

/** Live dock visibility choice with schema defaults. */
export const Config = z.object({
  expandButton: z.boolean().default(true),
})
