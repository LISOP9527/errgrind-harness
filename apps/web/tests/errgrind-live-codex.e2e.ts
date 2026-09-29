// Opt-in real-provider smoke. It uses an existing isolated Codex login and a
// private local math case, but keeps Session data in a temporary workspace.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {} from '../../../packages/api/settings-controller/src/codex-auth.ts'
import type {} from '../../../packages/core/errgrind-episode/src/types.ts'
import type {} from '../../../packages/llm/llm-retry/src/types.ts'
import { launchWebScaffold, readPersistedEvents, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const ENABLED = process.env.ERRGRIND_LIVE_CODEX === '1'
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ERRGRIND_PATCH = join(REPO_ROOT, 'errgrind-fork/web.patch.yml')
const PROFILE_ANCHOR = fileURLToPath(new URL('./errgrind-keyless-profile/package.json', import.meta.url))

describe.skipIf(!ENABLED)('web e2e: live ErrGrind Codex math intake', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let prompt: string
  let images: { name: string; mimeType: 'image/jpeg'; buffer: Buffer }[]
  let caseDir: string

  beforeAll(async () => {
    // Replay mode supplies a fail-loud DeepSeek stub while the patch keeps
    // Codex on its real adapter; this avoids requiring a second API key.
    if (process.env.DSH_SNAPSHOT !== 'replay') throw new Error('Live Codex smoke requires DSH_SNAPSHOT=replay')
    const configuredCaseDir = process.env.ERRGRIND_LIVE_CASE_DIR
    const harnessHome = process.env.ERRGRIND_LIVE_DSH_HOME
    if (!configuredCaseDir || !harnessHome) throw new Error('Live Codex smoke needs case directory and isolated DSH home')
    caseDir = configuredCaseDir
    try {
      const [input, first, second] = await Promise.all([
        readFile(join(caseDir, 'input.txt'), 'utf8'),
        readFile(join(caseDir, 'image-1.jpg')),
        readFile(join(caseDir, 'image-2.jpg')),
      ])
      if (!input.trim() || first.length === 0 || second.length === 0) throw new Error('Empty private case')
      prompt = input
      images = [first, second].map((buffer, index) => ({
        name: `error-image-${String(index + 1)}.jpg`, mimeType: 'image/jpeg', buffer,
      }))
    } catch {
      throw new Error('Live case must contain nonempty input.txt and two JPEG images')
    }

    scaffold = await launchWebScaffold({
      extraOverlayPath: ERRGRIND_PATCH,
      extraInstallAnchors: [PROFILE_ANCHOR],
      harnessHome,
      compareReplaySession: false,
    })
    const auth = await scaffold.ctx.get('codexAuthController')?.status()
    if (auth?.authorized !== true) throw new Error('Isolated Codex home is not authorized')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('accepts original images and persists a model-authored first turn', async () => {
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    await page.locator('input[type="file"]').setInputFiles(images)
    for (const image of images) {
      const preview = page.getByRole('img', { name: image.name, exact: true })
      await preview.waitFor({ timeout: 15_000 })
      await expect.poll(() => preview.getAttribute('src'), { timeout: 15_000 }).toMatch(/^blob:/)
    }

    // `writeComposerDraft` types key-by-key and Enter submits; this real
    // multiline case must be pasted as one draft instead.
    await input.fill(prompt)
    expect((await input.innerText()).length).toBeGreaterThan(500)
    const send = page.getByRole('button', { name: 'Send message' })
    await send.waitFor({ state: 'visible', timeout: 15_000 })
    await expect.poll(() => send.isEnabled(), { timeout: 15_000 }).toBe(true)
    const settled = scaffold.whenTurnSettled(150_000)
    await send.click()
    const sessionId = await settled
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('Live session has no agent')
    const state = scaffold.ctx.sessionProjections.stateOf(agent.session, 'errgrindEpisode')
    const events = await readPersistedEvents(scaffold, sessionId)
    if (state?.attachments.length !== 2) {
      const counts = Object.fromEntries([...new Set(events.map(event => event.type))]
        .map(type => [type, events.filter(event => event.type === type).length]))
      throw new Error(JSON.stringify({
        attachmentCount: state?.attachments.length ?? -1,
        firstInputHasImage: state?.firstInputHasImage ?? false,
        draftCount: events.filter(event => event.type === 'errgrind/error-draft').length,
        clarificationCount: events.filter(event => event.type === 'errgrind/error-clarify').length,
        userMessages: events.filter(event => event.type === 'user/message')
          .map(event => ({ source: event.data.source.kind, blocks: event.data.content.map(block => block.type) })),
        routes: events.filter(event => event.type === 'request/header')
          .map(event => ({ provider: event.data.header.config.provider, model: event.data.header.config.model })),
        retries: events.filter(event => event.type === 'llm/retry')
          .map(event => ({ provider: event.data.provider, code: event.data.failure.code, status: event.data.failure.status })),
        ends: events.filter(event => event.type === 'turn/end').map(event => event.data.reason.kind),
        counts,
      }))
    }
    expect(state.attachments.map(attachment => attachment.sha256))
      .toEqual(images.map(image => createHash('sha256').update(image.buffer).digest('hex')))
    expect(events.some(event => event.type === 'errgrind/error-open')).toBe(true)
    const hasDraft = events.some(event => event.type === 'errgrind/error-draft')
    const hasClarification = events.some(event => event.type === 'errgrind/error-clarify')
    expect(hasDraft || hasClarification).toBe(true)
    const replyPath = process.env.ERRGRIND_LIVE_REPLY_FILE
    if (replyPath !== undefined && hasClarification) {
      const reply = await readFile(replyPath, 'utf8')
      if (reply.trim().length === 0) throw new Error('Live clarification reply is empty')
      await input.fill(reply)
      const nextTurn = scaffold.whenTurnSettled(150_000)
      await input.press('Enter')
      expect(await nextTurn).toBe(sessionId)
    }
    const finalEvents = replyPath === undefined ? events : await readPersistedEvents(scaffold, sessionId)
    const finalState = scaffold.ctx.sessionProjections.stateOf(agent.session, 'errgrindEpisode')
    await writeFile(join(caseDir, 'first-turn-review.json'), JSON.stringify({
      draft: finalState?.draft?.text ?? null,
      clarification: finalEvents.filter(event => event.type === 'errgrind/error-clarify')
        .map(event => event.data.text),
      usage: finalEvents.filter(event => event.type === 'assistant/message')
        .map(event => event.data.usage ?? null),
    }), { mode: 0o600 })
    if (finalState?.draft !== null && finalState?.draft !== undefined) {
      const card = page.getByRole('article', { name: 'Error description' })
      await card.waitFor({ timeout: 15_000 })
      await card.getByRole('button', { name: 'Confirm this description' }).waitFor({ timeout: 10_000 })
      await page.setViewportSize({ width: 390, height: 844 })
      await card.waitFor({ state: 'visible', timeout: 10_000 })
    }
  }, 200_000)
})
