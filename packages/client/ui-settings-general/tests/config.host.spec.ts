/** Onboarding state uses live Config fields. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished } from 'vitest'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import * as HostPlugin from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import { HIDDEN_SETTINGS_ITEMS_GLOBAL } from '../src/hidden-items.ts'
import * as General from '../src/index.ts'

it('validates and updates onboarding preferences without remounting', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const configuration = await liveConfig(ctx, General)
  await configuration.update({ welcomeNoticeVersion: 'v1' })
  expect(plainConfig(configuration.fiber.config)).toMatchObject({ welcomeNoticeVersion: 'v1' })
  expect(configuration.entry.fiber).toBe(configuration.fiber)
})

it('projects the hidden contribution ids onto the page', async () => {
  const ctx = new Context()
  ctx.provide('settings', { configure: () => () => {} } as never)
  onTestFinished(() => ctx.fiber.dispose())
  const plugin = ctx.plugin(General, { hiddenSettingsItems: ['developer-tools'] })
  await plugin.await()
  const rows: IndexInjection[] = []
  ctx.emit('webserver/index-inject', rows)
  expect(rows).toEqual([{ kind: 'global', name: HIDDEN_SETTINGS_ITEMS_GLOBAL, value: { hiddenSettingsItems: ['developer-tools'] } }])
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
