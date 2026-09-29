import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FiberState } from '@deepseek-ai/cordis'
import type {} from '../../../packages/api/settings-controller/src/codex-auth.ts'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

describe('web e2e: ErrGrind without model credentials', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: join(ROOT, 'errgrind-fork/web.patch.yml'),
      extraInstallAnchors: [fileURLToPath(new URL('./errgrind-keyless-profile/package.json', import.meta.url))],
      deepSeekMissingCredential: true,
      compareReplaySession: false,
      firstUse: true,
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows a path to sign in before the first message', async () => {
    const activeIds = [...scaffold.ctx.loader.entries()]
      .filter(entry => entry.fiber?.state === FiberState.ACTIVE)
      .map(entry => entry.options.id)
    expect(activeIds).toContain('llm-deepseek')
    expect(activeIds).not.toContain('deepseek-account')
    expect(activeIds).not.toContain('account-controller')
    expect(activeIds).not.toContain('ui-settings-account')
    expect(await scaffold.ctx.llm.listModels('deepseek-official')).toEqual([])
    expect(await scaffold.ctx.llm.listModels('openai-codex')).toEqual([])
    expect(scaffold.ctx.workspaceRegistry.list()).toHaveLength(1)
    expect(await page.locator('[data-hero-workspace-picker]').isVisible()).toBe(false)
    await page.getByText('Sign in to Codex to start', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await page.getByRole('dialog').count()).toBe(0)
    expect(await page.title()).toBe('ErrGrind')
    if (process.env.ERRGRIND_CAPTURE_UX === '1') await page.screenshot({ path: '/tmp/errgrind-ux-keyless.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Sign in with ChatGPT' }).waitFor()
    const history = page.getByRole('button', { name: 'Error history' })
    await history.waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (process.env.ERRGRIND_CAPTURE_UX === '1') {
      await page.waitForTimeout(700)
      await page.screenshot({ path: '/tmp/errgrind-ux-keyless-mobile.png' })
    }
    await history.click()
    await page.getByRole('searchbox', { name: 'Search Errors' }).waitFor()
  })
})
