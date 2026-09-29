// Keyless browser coverage for ErrGrind's original-image receipt at the real
// Web upload and Session persistence boundaries. Synthetic inputs are the
// default; a local smoke case can opt into two private images and a prompt.
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { SESSION_FORMAT_VERSION, Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '../../../packages/core/errgrind-episode/src/types.ts'
import {
  launchWebScaffold, readPersistedEvents, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, writeComposerDraft } from './support.ts'

const MODE = webSnapshotMode()
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ERRGRIND_PATCH = join(REPO_ROOT, 'errgrind-fork/web.patch.yml')
const PROFILE_ANCHOR = fileURLToPath(new URL('./errgrind-keyless-profile/package.json', import.meta.url))
const IMAGE_FIXTURE = fileURLToPath(new URL('../../../snapshots/session/read-image/workspace/red.png', import.meta.url))
const PROMPT = 'I wrote 2 + 3 = 6. Please record this math error for review.'
const DRAFT_DESCRIPTION = 'The user reports the original arithmetic error shown in the submitted material.'

type ReplayEntry = { kind: 'chunks'; chunks: Record<string, unknown>[] }

function replayScript(): ReplayEntry[] {
  const argumentsText = JSON.stringify({ description: DRAFT_DESCRIPTION })
  const call = { type: 'tool-call', id: 'call_errgrind_draft', name: 'error_draft', arguments: argumentsText }
  const assistant = { type: 'text', text: 'Please review this Error description. If it is accurate, confirm it with /error-confirm.' }
  return [
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: call.id, name: call.name, argumentsDelta: argumentsText },
      { type: 'block-end', index: 0, block: call },
      { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 0, reasoningTokens: 0 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ] },
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: assistant.text },
      { type: 'block-end', index: 0, block: assistant },
      { type: 'usage', usage: { inputTokens: 80, outputTokens: 12, totalTokens: 92, cacheReadTokens: 0, reasoningTokens: 0 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] },
  ]
}

interface SmokeImage {
  readonly name: string
  readonly mimeType: 'image/png' | 'image/jpeg'
  readonly bytes: Buffer
  readonly sha256: string
}

interface SmokeCase {
  readonly prompt: string
  readonly real: boolean
  readonly images: readonly SmokeImage[]
}

function jsonPathsContaining(value: unknown, expected: string, path = '$'): string[] {
  if (typeof value === 'string') return value.includes(expected) ? [path] : []
  if (Array.isArray(value)) return value.flatMap((item, index) => jsonPathsContaining(item, expected, `${path}[${String(index)}]`))
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, item]) => jsonPathsContaining(item, expected, `${path}.${key}`))
}

/** Load a synthetic default case or a private local case without exposing its path or contents. */
async function loadSmokeCase(): Promise<SmokeCase> {
  const caseDir = process.env.ERRGRIND_SMOKE_CASE_DIR
  let prompt: string
  let imageInputs: { name: string; mimeType: SmokeImage['mimeType']; bytes: Buffer }[]
  if (caseDir === undefined || caseDir.length === 0) {
    const bytes = await readFile(IMAGE_FIXTURE)
    prompt = PROMPT
    imageInputs = [{ name: 'synthetic-math-error.png', mimeType: 'image/png', bytes }]
  } else {
    try {
      const [privatePrompt, firstImage, secondImage] = await Promise.all([
        readFile(join(caseDir, 'input.txt'), 'utf8'),
        readFile(join(caseDir, 'image-1.jpg')),
        readFile(join(caseDir, 'image-2.jpg')),
      ])
      prompt = privatePrompt
      // Display names are fixed and generic; source filenames never enter the Session.
      imageInputs = [firstImage, secondImage].map((bytes, index): typeof imageInputs[number] => ({
        name: `error-image-${String(index + 1)}.jpg`, mimeType: 'image/jpeg', bytes,
      }))
    } catch {
      throw new Error('ERRGRIND_SMOKE_CASE_DIR does not contain the required local smoke inputs')
    }
  }
  return {
    prompt,
    real: caseDir !== undefined && caseDir.length > 0,
    images: imageInputs.map(image => ({
      ...image,
      sha256: createHash('sha256').update(image.bytes).digest('hex'),
    })),
  }
}

describe('web e2e: ErrGrind original image receipt', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tempDir: string
  let openedSessionId: string | undefined
  const inboundFrames: string[] = []
  const apiResponses: string[] = []

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'errgrind-image-receipt-'))
    const fixture = join(tempDir, `session.v${SESSION_FORMAT_VERSION}.jsonl`)
    const override = join(tempDir, 'replay.override.json')
    await writeFile(fixture, `${JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{session:1}}', createdAt: 0, cwd: '{{cwd}}',
      isSeeded: false, delegationDepth: 0,
    })}\n`)
    await writeFile(override, JSON.stringify(replayScript()))
    scaffold = await launchWebScaffold({
      extraOverlayPath: ERRGRIND_PATCH,
      extraInstallAnchors: [PROFILE_ANCHOR],
      replayFixture: fixture,
      replayOverride: override,
      compareReplaySession: false,
      paceMs: 5,
    })
    scaffold.ctx.on('session/event', (session, event: SessionEvent) => {
      if (event.type === 'errgrind/error-open') openedSessionId = String(session.id)
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    page.on('response', async (response) => {
      if (!response.url().includes('/api/')) return
      try {
        apiResponses.push(`${response.status()} ${response.url()} ${await response.text()}`)
      } catch {
        // Some streamed responses do not expose a reusable body.
      }
    })
    await page.routeWebSocket('**/api/remote.mux', (route) => {
      const server = route.connectToServer()
      server.onMessage((message) => {
        inboundFrames.push(typeof message === 'string' ? message : Buffer.from(message).toString('utf8'))
        route.send(message)
      })
      route.onMessage((message) => { server.send(message) })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    try {
      await scaffold?.close()
    } finally {
      if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true })
    }
  })

  it.skipIf(MODE === 'record')('admits an image prompt, durably retains its original receipt, and renders it after reload', async () => {
    const input = page.locator('[data-composer-input]').first()
    const smokeCase = await loadSmokeCase()
    const modelTrigger = page.getByRole('button', { name: /^Select model, current/ })
    await modelTrigger.click()
    await page.getByRole('menuitem', { name: /^Model\b/ }).click()
    await page.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash-Vision-Exp' }).click()
    await expect.poll(() => modelTrigger.getAttribute('aria-label'), { timeout: 10_000 })
      .toContain('DeepSeek-V4-Flash-Vision-Exp')

    await page.locator('input[type="file"]').setInputFiles(smokeCase.images.map(image => ({
      name: image.name, mimeType: image.mimeType, buffer: image.bytes,
    })))
    for (const image of smokeCase.images) {
      const pendingImage = page.getByRole('img', { name: image.name, exact: true })
      await pendingImage.waitFor({ timeout: 15_000 })
      await expect.poll(() => pendingImage.getAttribute('src'), { timeout: 15_000 }).toMatch(/^blob:/)
    }

    if (smokeCase.prompt.includes('\n')) await input.fill(smokeCase.prompt)
    else await writeComposerDraft(page, input, smokeCase.prompt)
    const send = page.getByRole('button', { name: 'Send message' })
    await send.waitFor({ state: 'visible', timeout: 15_000 })
    await expect.poll(() => send.isEnabled(), { timeout: 15_000 }).toBe(true)
    const settled = scaffold.whenTurnSettled(30_000)
    const admitted = page.waitForResponse(response => response.url().endsWith('/api/session/prompt'))
    await send.click()
    const admission = await admitted
    const admissionBody = await admission.json() as {
      result?: {
        ok?: boolean
        value?: { accepted?: boolean }
        error?: { code?: unknown; details?: { reason?: unknown } }
      }
    }
    const rawErrorCode = admissionBody.result?.error?.code
    // Remote error codes are scoped, e.g. `session/attachment-invalid`; the
    // slash is part of the stable code and must survive this allowlist.
    const safeErrorCode = typeof rawErrorCode === 'string' && /^[A-Za-z0-9_./-]{1,96}$/u.test(rawErrorCode)
      ? rawErrorCode
      : 'unspecified'
    const knownReasons = new Set([
      'MODEL_DOES_NOT_SUPPORT_IMAGES', 'INVALID_IMAGE', 'IMAGE_TYPE_MISMATCH', 'IMAGE_TOO_LARGE',
      'IMAGE_TOO_MANY_PIXELS', 'IMAGE_DIMENSION_TOO_LARGE', 'ATTACHMENT_CORRUPT',
      'ATTACHMENT_NOT_FOUND', 'ATTACHMENT_WRITE_FAILED', 'ATTACHMENT_READ_FAILED',
      'INVALID_ATTACHMENT_REF', 'TOO_MANY_IMAGES', 'IMAGES_TOO_LARGE', 'UNSUPPORTED_IMAGE_TYPE',
    ])
    const rawReason = admissionBody.result?.error?.details?.reason
    const safeReason = typeof rawReason === 'string' && knownReasons.has(rawReason) ? rawReason : 'unspecified'
    const safeFields = (value: unknown): string => {
      if (typeof value !== 'object' || value === null) return ''
      const allowed = new Set(['result', 'ok', 'value', 'accepted', 'error', 'code', 'message', 'details', 'reason'])
      return Object.keys(value).filter(key => allowed.has(key)).join(',')
    }
    const envelope = `fields body=[${safeFields(admissionBody)}] result=[${safeFields(admissionBody.result)}] error=[${safeFields(admissionBody.result?.error)}] details=[${safeFields(admissionBody.result?.error?.details)}]`
    expect(admissionBody.result?.ok,
      `prompt admission rejected (safe error code: ${safeErrorCode}; safe reason: ${safeReason}; ${envelope})`)
      .toBe(true)
    expect(admissionBody.result?.value?.accepted).toBe(true)

    await expect.poll(() => openedSessionId, { timeout: 20_000 }).toBeTypeOf('string')
    const sessionId = openedSessionId!
    const turnSessionId = await settled
    expect(String(turnSessionId) === sessionId).toBe(true)
    for (const image of smokeCase.images) {
      await page.getByRole('img', { name: image.name, exact: true }).first().waitFor({ state: 'visible' })
    }

    const persisted = await readPersistedEvents(scaffold, turnSessionId)
    expect(persisted.some(event => event.type === 'errgrind/error-open')).toBe(true)
    const coldSession = Session.create(turnSessionId, persisted)
    const episode = scaffold.ctx.sessionProjections.stateOf(coldSession, 'errgrindEpisode')
    expect(episode !== null).toBe(true)
    expect(episode?.firstInput === smokeCase.prompt).toBe(true)
    expect(episode?.firstInputHasImage === true).toBe(true)
    expect(episode?.draft?.revision).toBe(1)
    expect(episode?.draft?.text).toBe(DRAFT_DESCRIPTION)
    const episodeAttachments = episode?.attachments ?? []
    const receiptsMatch = episodeAttachments.length === smokeCase.images.length
      && smokeCase.images.every((image, index) => {
        const attachment = episodeAttachments[index]
        const original = attachment?.originalFileRef
        const carried = attachment?.normalizedImageRef?.errgrindOriginal
        return attachment !== undefined && original !== undefined && carried !== undefined
          && attachment.sha256 === image.sha256
          && attachment.mediaType === image.mimeType
          && attachment.bytes === image.bytes.byteLength
          && attachment.name === image.name
          && original.attachmentId === `sha256:${image.sha256}`
          && original.bytes === image.bytes.byteLength
          && original.name === image.name
          && carried.sha256 === image.sha256
          && carried.bytes === image.bytes.byteLength
          && carried.mediaType === image.mimeType
          && carried.fileRef.attachmentId === original.attachmentId
          && carried.fileRef.bytes === original.bytes
          && carried.fileRef.name === original.name
      })
    expect(receiptsMatch).toBe(true)

    if (smokeCase.real) await page.setViewportSize({ width: 390, height: 844 })
    const beforeReloadFrames = inboundFrames.length
    await page.reload({ waitUntil: 'load' })
    const restoredSessionRow = page.locator(`[data-row-key="session:${turnSessionId}"]`)
    if (!smokeCase.real) {
      await restoredSessionRow.waitFor({ state: 'visible', timeout: 20_000 })
      await restoredSessionRow.click()
      await expect.poll(() => restoredSessionRow.getAttribute('aria-selected'), { timeout: 10_000 }).toBe('true')
    }
    try {
      await expect.poll(async () => (await page.locator('body').innerText()).includes(smokeCase.prompt), { timeout: 15_000 }).toBe(true)
    } catch {
      const diagnostics = await page.evaluate(() => {
        const body = document.body.innerText
        return {
          hasPrompt: body.includes('Please record this math error for review.'),
          hasHistoryError: body.includes('Failed to load history'),
          hasLoadingHistory: body.includes('Loading history'),
          historyErrorLines: body.split('\n').filter(line => /history|failed|invalid|unknown event/iu.test(line))
            .map(line => line.slice(0, 180)),
          chatTurnCount: document.querySelectorAll('[data-chat-turn]').length,
          renderedImageCount: document.querySelectorAll('img').length,
        }
      })
      const allowedEventTypes = ['user/message', 'errgrind/error-draft', 'browser/private']
      const remoteEventCounts = Object.fromEntries(allowedEventTypes.map(type => [
        type,
        inboundFrames.filter(frame => frame.includes(type)).length,
      ]))
      throw new Error(JSON.stringify({
        ...diagnostics,
        selected: await restoredSessionRow.getAttribute('aria-selected'),
        apiRouteStatuses: apiResponses.map(item => item.split(' ').slice(0, 2).join(' ')),
        remoteEventCounts,
      }))
    }
    const restoredImages = await Promise.all(smokeCase.images.map(async (image) => {
      const restoredImage = page.getByRole('img', { name: image.name, exact: true })
      try {
        await restoredImage.waitFor({ timeout: 20_000 })
      } catch {
        const imageButtons = await page.getByRole('button').allTextContents()
        throw new Error(JSON.stringify({
          restoredImageCount: await restoredImage.count(),
          publicAttachmentLocatorInHistory: apiResponses.some(body => body.includes('browser-event:')),
          publicAttachmentLocatorInRemoteFrames: inboundFrames.some(frame => frame.includes('browser-event:')),
          publicAttachmentLocatorAfterReload: inboundFrames.slice(beforeReloadFrames).some(frame => frame.includes('browser-event:')),
          receiptFieldNameInApiResponses: apiResponses.some(body => body.includes('errgrindOriginal')),
          receiptFieldNameInRemoteFrames: inboundFrames.some(frame => frame.includes('errgrindOriginal')),
          attachmentReadRejected: inboundFrames.some(frame => frame.includes('attachment-invalid')),
          imageButtons: imageButtons.slice(-12),
        }))
      }
      await expect.poll(() => restoredImage.getAttribute('src'), { timeout: 15_000 }).toMatch(/^blob:/)
      await expect.poll(() => restoredImage.evaluate((element: HTMLImageElement) =>
        element.complete && element.naturalWidth > 0)).toBe(true)
      return restoredImage.count()
    }))
    expect(restoredImages.every(count => count === 1)).toBe(true)
    const persistedUserMessage = persisted.find(
      (event): event is Extract<SessionEvent, { type: 'user/message' }> =>
        event.type === 'user/message' && event.data.source.kind === 'user',
    )
    const persistedImages = persistedUserMessage?.data.content.filter(block => block.type === 'image') ?? []
    const persistedAttachmentsMatch = persistedImages.length === smokeCase.images.length
      && smokeCase.images.every((image, index) => {
        const block = persistedImages[index]
        const episodeReceipt = episodeAttachments[index]
        const episodeOriginal = episodeReceipt?.originalFileRef
        const persistedOriginal = block?.type === 'image' ? block.attachment.errgrindOriginal : undefined
        return block?.type === 'image'
          && block.attachment.name === image.name
          && episodeReceipt !== undefined
          && episodeOriginal !== undefined
          && persistedOriginal !== undefined
          && persistedOriginal.sha256 === episodeReceipt.sha256
          && persistedOriginal.bytes === episodeReceipt.bytes
          && persistedOriginal.mediaType === episodeReceipt.mediaType
          && persistedOriginal.fileRef.attachmentId === episodeOriginal.attachmentId
          && persistedOriginal.fileRef.bytes === episodeOriginal.bytes
          && persistedOriginal.fileRef.name === episodeOriginal.name
      })
    expect(persistedAttachmentsMatch).toBe(true)
    const browserPayloads = `${apiResponses.join('\n')}\n${inboundFrames.join('\n')}`
    const attachmentResponses = apiResponses.filter(response => response.includes('/api/session/attachment'))
    expect(attachmentResponses.join('\n')).not.toContain('errgrindOriginal')
    for (const [index, image] of smokeCase.images.entries()) {
      const hashPaths = apiResponses.filter(body => body.includes(image.sha256)).map((body) => {
        const jsonStart = body.indexOf('{')
        if (jsonStart < 0) return { route: body.split(' ')[1], paths: ['<non-json>'] }
        try {
          return { route: body.split(' ')[1], paths: jsonPathsContaining(JSON.parse(body.slice(jsonStart)), image.sha256) }
        } catch {
          return { route: body.split(' ')[1], paths: ['<unparsed-json>'] }
        }
      })
      const hashFrameCount = inboundFrames.filter(frame => frame.includes(image.sha256)).length
      expect({ hashPaths, hashFrameCount }).toEqual({ hashPaths: [], hashFrameCount: 0 })
      const normalizedId = episodeAttachments[index]?.normalizedImageRef?.attachmentId
      if (normalizedId !== undefined) expect(browserPayloads).not.toContain(String(normalizedId))
      const originalId = episodeAttachments[index]?.originalFileRef?.attachmentId
      if (originalId !== undefined) expect(browserPayloads).not.toContain(String(originalId))
    }
    const visibleText = await page.locator('body').innerText()
    expect(visibleText).not.toContain('errgrindOriginal')
    for (const image of smokeCase.images) expect(visibleText).not.toContain(image.sha256)
  }, 120_000)
})
