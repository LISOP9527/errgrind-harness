// Keyless assembled-browser coverage for the ErrGrind multi-turn boundary.
// The replay adapter supplies synthetic model tool calls; the browser confirms
// the visible revision card and answers Grill in the ordinary conversation.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page, WebSocketRoute } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FiberState } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '../../../packages/core/errgrind-episode/src/types.ts'
import {
  launchWebScaffold, readPersistedEvents, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, expandTurnProcesses, newEnglishPage, openSettings, writeComposerDraft } from './support.ts'

const MODE = webSnapshotMode()
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ERRGRIND_PATCH = join(REPO_ROOT, 'errgrind-fork/web.patch.yml')
const PROFILE_ANCHOR = fileURLToPath(new URL('./errgrind-keyless-profile/package.json', import.meta.url))
const SENTINEL = 'ERRGRIND_PRIVATE_SENTINEL_6F2C'
const INPUT = 'I added the numerators and denominators in 1/2 + 1/3 and got 2/5.'
const CORRECTION = 'Please keep the description limited to this incident and preserve only the steps I actually wrote.'
const CLARIFICATION = 'Which line did you write first when adding the fractions?'
const ANSWER = 'I added 1+1 and 2+3 directly, without making equal denominators.'
const PROBE_QUESTION = 'How would you add 1/2 and 1/3 using a common denominator?'
const TEACH_QUESTION = 'What denominator can both 2 and 3 divide into evenly?'
const TEACH_ANSWER = '6, because both 2 and 3 divide 6 evenly.'
const TEACH_FOLLOWUP = 'Now rewrite both fractions with denominator 6 before adding.'
const DRILL_QUESTION = 'What is 3/4 + 1/8? Show the denominator you use.'
const DRILL_ANSWER = 'I added top and bottom again and got 4/12.'
const DRILL_FEEDBACK = 'The denominator describes the size of each part. Rewrite 3/4 in eighths before adding.'
const DRILL_FEEDBACK_CORRECT = 'The learner converted to eighths before adding — the rule held.'

type ReplayEntry = { kind: 'chunks'; chunks: Record<string, unknown>[] }

function toolCall(callId: string, name: string, args: unknown): ReplayEntry {
  const argumentsText = JSON.stringify(args)
  const block = { type: 'tool-call', id: callId, name, arguments: argumentsText }
  return { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block },
    { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 0, reasoningTokens: 0 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ] }
}

function assistantText(text: string): ReplayEntry {
  const block = { type: 'text', text }
  return { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block },
    { type: 'usage', usage: { inputTokens: 80, outputTokens: 12, totalTokens: 92, cacheReadTokens: 0, reasoningTokens: 0 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }
}

function replayScript(): ReplayEntry[] {
  return [
    toolCall('call_errgrind_draft', 'error_draft', {
      description: 'The user added the numerators and denominators in 1/2 + 1/3, producing 2/5.',
    }),
    toolCall('call_errgrind_clarify', 'error_clarify', { text: CLARIFICATION }),
    assistantText(SENTINEL),
    toolCall('call_errgrind_draft_revision_2', 'error_draft', {
      description: 'In this incident, the user added the numerators and denominators directly and obtained 2/5.',
    }),
    assistantText('I revised the Error description. Please review it and confirm with /error-confirm when accurate.'),
    toolCall('call_errgrind_probe', 'grill_probe', {
      probe: {
        id: 'P1', type: 'reasoning_question', question: PROBE_QUESTION,
        targetHypothesisIds: ['H1'], discriminationGoal: 'Check whether the user understands equal denominators.',
        predictions: [{ hypothesisId: 'H1', expectedObservation: SENTINEL }],
        answerKey: SENTINEL,
      },
      newHypotheses: [{ id: 'H1', claim: 'Adds numerator and denominator values directly.' }],
    }),
    assistantText(PROBE_QUESTION),
    toolCall('call_errgrind_conclude', 'grill_conclude', {
      diagnosisStatus: 'undetermined',
      summary: 'The answer was recorded, but this short exchange does not distinguish the candidate mechanisms.',
      remainingUncertainty: 'One response is not enough to determine whether this is a stable misconception or a one-time slip.',
      newEvidence: [{ id: 'E1', sourceRef: 'latest-probe-answer', quote: ANSWER,
        interpretation: 'The response reports the operation but does not distinguish its cause.',
        supports: [], contradicts: [], probeId: 'P1' }],
    }),
    assistantText('The Grill conclusion is ready. Please confirm the Error description before we continue to Teach.'),
    toolCall('call_errgrind_teach_step', 'teach_step', {
      kind: 'question', text: TEACH_QUESTION,
    }),
    assistantText('The episode diagnosis remains undetermined. Let’s work through the fraction rule together.'),
    toolCall('call_errgrind_teach_followup', 'teach_step', {
      kind: 'hint', text: TEACH_FOLLOWUP,
    }),
    assistantText('That answer is a post-intervention observation, so it is not added to the original Error evidence.'),
  ]
}

/** Model calls of Sessions spawned after the primary: Drill Sessions and the
 * materialized derived Error bind their scripts in first-call order. */
function extraSessionScripts(): ReplayEntry[][] {
  const preparation = toolCall('call_errgrind_drill_prepare_a', 'drill_prepare', {
    targetMechanism: 'Using a common denominator before adding fractions',
    trigger: 'Adding fractions with unlike denominators',
    failureBehavior: 'Adds denominators without checking the size of the parts',
    desiredBehavior: 'Convert to equal-sized parts before adding numerators',
    successSignal: 'Explains and uses a common denominator',
    domain: 'Fractions', taskType: 'explain', setting: 'Compare lengths measured in different fractional units',
    taskGoal: 'Find the combined length and justify the unit conversion',
    essentialTrigger: 'Units represent different-sized parts', solutionStrategy: 'Express both lengths in equal-sized units',
    avoid: ['Unrelated algebra'], difficultyLevel: 1, reasoningDepth: 2, calculationLoad: 1,
  })
  const preparationB = toolCall('call_errgrind_drill_prepare_b', 'drill_prepare', {
    targetMechanism: 'Using a common denominator before adding fractions',
    trigger: 'Adding fractions with unlike denominators',
    failureBehavior: 'Adds denominators without checking the size of the parts',
    desiredBehavior: 'Convert to equal-sized parts before adding numerators',
    successSignal: 'Explains and uses a common denominator',
    domain: 'Fractions', taskType: 'explain', setting: 'Compare lengths measured in different fractional units',
    taskGoal: 'Find the combined length and justify the unit conversion',
    essentialTrigger: 'Units represent different-sized parts', solutionStrategy: 'Express both lengths in equal-sized units',
    avoid: ['Unrelated algebra'], difficultyLevel: 1, reasoningDepth: 2, calculationLoad: 1,
  })
  return [
    // Dedicated Drill Session A (sidebar Practice): prepare, then an incorrect
    // judged attempt that materializes a derived Error Session.
    [preparation,
      assistantText('Practice question prepared.'),
      toolCall('call_errgrind_drill_judge_wrong', 'drill_judge', {
        isCorrect: false, feedback: DRILL_FEEDBACK,
      }),
      assistantText('The attempt was recorded.')],
    // The derived Error Session's kickoff turn.
    [assistantText('Opening the derived Error.')],
    // Dedicated Drill Session B (second openDrill call): prepare, then a
    // correct judged attempt that archives the Drill Session.
    [preparationB,
      assistantText('Practice question prepared.'),
      toolCall('call_errgrind_drill_judge_right', 'drill_judge', {
        isCorrect: true, feedback: DRILL_FEEDBACK_CORRECT,
      }),
      assistantText('Nicely done.')],
  ]
}

describe('web e2e: ErrGrind keyless multi-turn privacy', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tempDir: string
  let replayPatch: string
  let initialPrompt = INPUT
  let smokeImages: { name: string; bytes: Buffer }[] = []
  let setupCompleted = false
  let remoteSocket: WebSocketRoute | undefined
  const inboundFrames: string[] = []
  const apiBodies: string[] = []
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const isolatedDraftRequests: GenerateOptions[] = []
  const startupSignals: string[] = []

  beforeAll(async () => {
    const caseDir = process.env.ERRGRIND_SMOKE_CASE_DIR
    if (caseDir !== undefined && caseDir.length > 0) {
      try {
        const [prompt, firstImage, secondImage] = await Promise.all([
          readFile(join(caseDir, 'input.txt'), 'utf8'),
          readFile(join(caseDir, 'image-1.jpg')),
          readFile(join(caseDir, 'image-2.jpg')),
        ])
        initialPrompt = prompt
        smokeImages = [firstImage, secondImage].map((bytes, index) => ({
          name: `error-image-${String(index + 1)}.jpg`, bytes,
        }))
      } catch {
        throw new Error('ERRGRIND_SMOKE_CASE_DIR does not contain the required local smoke inputs')
      }
    }
    tempDir = await mkdtemp(join(tmpdir(), 'errgrind-multiturn-'))
    const fixture = join(tempDir, `session.v${SESSION_FORMAT_VERSION}.jsonl`)
    const override = join(tempDir, 'replay.override.json')
    replayPatch = join(tempDir, 'errgrind-replay.patch.yml')
    await writeFile(replayPatch, `${await readFile(ERRGRIND_PATCH, 'utf8')}\n- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: deepseek-flash\n`)
    await writeFile(fixture, `${JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{session:1}}', createdAt: 0, cwd: '{{cwd}}',
      isSeeded: false, delegationDepth: 0,
    })}\n`)
    await writeFile(override, JSON.stringify(replayScript()))

    scaffold = await launchWebScaffold({
      extraOverlayPath: replayPatch,
      extraInstallAnchors: [PROFILE_ANCHOR],
      replayFixture: fixture,
      replayOverride: override,
      compareReplaySession: false,
      paceMs: 5,
    })
    scaffold.ctx.on('api-session/added', (summary) => { startupSignals.push(`added:${summary.blank}:${summary.running}`) })
    scaffold.ctx.on('api-session/status', (_sessionId, running) => { startupSignals.push(`status:${running}`) })
    // The Draft is an independent request, so its external model response has
    // its own fixture instead of consuming the conversation replay cursor.
    const spawnedScripts = extraSessionScripts()
    const boundScripts = new Map<string, ReplayEntry[]>()
    scaffold.ctx.on('llm/stream', (options, next) => {
      if (typeof options.sessionId === 'string' && options.sessionId.startsWith('errgrind-')) {
        let entries = boundScripts.get(options.sessionId)
        if (entries === undefined) {
          entries = spawnedScripts.shift()
          if (entries === undefined) throw new Error(`no replay script left for Session "${options.sessionId}"`)
          boundScripts.set(options.sessionId, entries)
        }
        const entry = entries.shift()
        if (entry === undefined) throw new Error(`replay script exhausted for Session "${options.sessionId}"`)
        return (async function* (): AsyncIterable<StreamChunk> {
          yield* entry.chunks as StreamChunk[]
        })()
      }
      if (options.sessionId !== undefined) return next()
      isolatedDraftRequests.push(options)
      return (async function* (): AsyncIterable<StreamChunk> {
        yield { type: 'text-delta', index: 0,
          text: JSON.stringify({ question: DRILL_QUESTION, referenceAnswer: `7/8 ${SENTINEL}` }) }
        yield { type: 'usage', usage: { inputTokens: 120, outputTokens: 30 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    }, { prepend: true })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    page.on('pageerror', (error) => { pageErrors.push(String(error)) })
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('response', async (response) => {
      if (!response.url().includes('/api/')) return
      try {
        apiBodies.push(`${response.status()} ${response.url()} ${await response.text()}`)
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
      remoteSocket = route
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    try {
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    } catch {
      throw new Error(JSON.stringify({
        pageErrors,
        body: (await page.locator('body').innerText()).slice(0, 3000),
        host: [...scaffold.ctx.loader.entries()].filter(entry => /settings-controller/.test(entry.id))
          .map(entry => ({ id: entry.id, state: entry.fiber?.state })),
        url: page.url(),
      }))
    }
    const heroInput = page.locator('[data-composer-input]').first()
    await heroInput.waitFor({ timeout: 10_000 })
    await page.getByText('Start with a math mistake', { exact: true }).waitFor({ timeout: 10_000 })
    await page.waitForFunction(() => document.title === 'ErrGrind', undefined, { timeout: 10_000 })
    expect(await heroInput.getAttribute('data-placeholder'))
      .toBe('Choose a workspace to start')
    await page.getByRole('button', { name: 'Choose workspace' }).waitFor()
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    expect(await page.locator('[data-conversation-content]').getAttribute('data-content-phase'), JSON.stringify(
      { signals: startupSignals, agents: scaffold.ctx.agents.list().map(agent => ({
        id: agent.session.id,
        seq: agent.session.seq,
        eventTypes: agent.session.snapshotEvents().map(event => event.type),
        listMetadata: scaffold.ctx.sessionProjections.stateOf(agent.session, 'sessionListMetadata'),
      })) },
    )).toBe('hero')
    await page.getByText('Start with a math mistake', { exact: true }).waitFor()
    await page.waitForFunction(() => {
      const picker = document.querySelector('[data-conversation-content] [data-hero-workspace-picker]')
      return picker instanceof HTMLElement && getComputedStyle(picker).display === 'none'
    })
    await page.getByRole('button', { name: 'New Error', exact: true }).filter({ hasText: 'New Error' }).waitFor()
    expect(await page.getByText('Preview', { exact: true }).count()).toBe(0)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.locator('[data-conversation-content]').getAttribute('data-content-phase')).toBe('hero')
    await page.getByText('Start with a math mistake', { exact: true }).waitFor()
    await page.setViewportSize({ width: 1280, height: 800 })
    expect(scaffold.ctx.clientModules.graph().entries.map(entry => entry.id))
      .toContain('@errgrind/ui-errgrind-episode')
    setupCompleted = true
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    try {
      await scaffold?.close()
    } catch (error) {
      if (setupCompleted) throw error
      // A failed beforeAll can leave the replay script unconsumed; preserve the setup error.
    } finally {
      if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true })
    }
  })

  it.skipIf(MODE === 'record')('runs draft, human confirmation, probe, answer, and conclusion without exposing Grill internals', async () => {
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    expect(await input.getAttribute('data-placeholder'))
      .toBe('Describe the mistake and what you tried, / for commands')
    await page.getByRole('button', { name: 'Add a problem image or file' }).waitFor({ timeout: 10_000 })

    if (smokeImages.length > 0) {
      const modelTrigger = page.getByRole('button', { name: /^Select model, current/ })
      await modelTrigger.click()
      await page.getByRole('menuitem', { name: /^Model\b/ }).click()
      await page.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash-Vision-Exp' }).click()
      await page.locator('input[type="file"]').setInputFiles(smokeImages.map(image => ({
        name: image.name, mimeType: 'image/jpeg', buffer: image.bytes,
      })))
      for (const image of smokeImages) {
        await page.getByRole('img', { name: image.name, exact: true }).waitFor({ timeout: 15_000 })
      }
    }

    const firstTurn = scaffold.whenTurnSettled()
    // A real case may contain line breaks; typing them key by key would send
    // the first line as a separate turn before the images are admitted.
    if (initialPrompt.includes('\n')) await input.fill(initialPrompt)
    else await writeComposerDraft(page, input, initialPrompt)
    await input.press('Enter')
    const sessionId = await firstTurn
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('the Error Session has no live Agent')
    await expect.poll(() => scaffold.ctx.sessionProjections.stateOf(agent.session, 'errgrindEpisode')?.draft?.revision)
      .toBe(1)
    const errorRow = page.locator(`[data-error-session-id="${sessionId}"]`)
    await errorRow.waitFor({ timeout: 10_000 })
    await errorRow.locator('button').first().click()
    await expect.poll(() => inboundFrames.some(frame => frame.includes('errgrind/error-draft')))
      .toBe(true)
    const firstErrorCard = page.getByRole('article', { name: 'Error description' })
    try {
      await firstErrorCard.waitFor({ state: 'visible', timeout: 10_000 })
    } catch {
      const diagnostics = await page.evaluate(() => {
        const boot = (window as unknown as { __DSH_BOOT__?: { entries?: { id: string }[] } }).__DSH_BOOT__
        const body = document.body.innerText
        return {
          browserEntryIds: boot?.entries?.map(entry => entry.id) ?? [],
          articleLabels: Array.from(document.querySelectorAll('article[aria-label]'))
            .map(article => article.getAttribute('aria-label')),
          chatTurnCount: document.querySelectorAll('[data-chat-turn]').length,
          hasSessionPrompt: body.includes('2/5.'),
          hasErrorCardHeading: body.includes('Error description'),
          historyErrorVisible: body.includes('Failed to load history'),
          historyErrorLines: body.split('\n').filter(line => /history|failed|invalid|unknown event/iu.test(line))
            .map(line => line.slice(0, 180)),
        }
      })
      const allowedEventTypes = ['user/message', 'errgrind/error-draft', 'browser/private']
      const remoteEventCounts = Object.fromEntries(allowedEventTypes.map(type => [
        type,
        inboundFrames.filter(frame => frame.includes(type)).length,
      ]))
      throw new Error(JSON.stringify({
        ...diagnostics,
        hostClientEntryIds: scaffold.ctx.clientModules.graph().entries.map(entry => entry.id),
        activeHostEntryCount: [...scaffold.ctx.loader.entries()]
          .filter(entry => entry.fiber?.state === FiberState.ACTIVE).length,
        remoteEventCounts,
        apiRouteStatuses: apiBodies.map(item => item.split(' ').slice(0, 2).join(' ')),
        pageErrorCount: pageErrors.length,
      }))
    }
    const initialCardText = await firstErrorCard.innerText()
    expect(initialCardText).toContain('If anything is missing')
    expect(await firstErrorCard.getByRole('button', { name: 'Confirm this description' }).count()).toBe(0)
    // The clarification renders as an ordinary flow message, not a card.
    await page.getByText(CLARIFICATION).waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(() => page.locator('[data-submission-echo]').count()).toBe(0)
    expect(await page.locator('[class*="userRow"]').count()).toBe(1)
    expect((await page.locator('body').innerText())).not.toContain(SENTINEL)
    expect(inboundFrames.join('\n')).toContain(CLARIFICATION)
    expect(inboundFrames.join('\n')).not.toContain(SENTINEL)
    expect(apiBodies.join('\n')).not.toContain(SENTINEL)
    expect((agent.session.requestHeader()?.tools ?? []).map(tool => tool.name).sort())
      .toEqual(['drill_answer_draft', 'drill_judge', 'drill_prepare', 'error_clarify', 'error_draft', 'grill_conclude', 'grill_probe', 'teach_step'])
    const activeEntryIds = [...scaffold.ctx.loader.entries()]
      .filter(entry => entry.fiber?.state === FiberState.ACTIVE)
      .map(entry => entry.options.id)
    expect(activeEntryIds).toContain('errgrind-episode')
    expect(scaffold.ctx.clientModules.graph().entries.map(entry => entry.id))
      .toContain('@errgrind/ui-errgrind-episode')
    for (const inactiveId of ['ptc-runtime', 'session-reference', 'ui-reference', 'ui-settings-shell']) {
      expect(activeEntryIds).not.toContain(inactiveId)
    }

    const correctedTurn = scaffold.whenTurnSettled()
    await writeComposerDraft(page, input, CORRECTION)
    await input.press('Enter')
    await correctedTurn
    expect(scaffold.ctx.sessionProjections.stateOf(agent.session, 'errgrindEpisode')?.draft?.revision).toBe(2)
    const currentErrorCard = page.getByRole('article', { name: 'Error description' })
    await currentErrorCard.waitFor({ state: 'visible' })
    const currentCardText = await currentErrorCard.innerText()
    expect(currentCardText).toContain('In this incident, the user added the numerators and denominators directly and obtained 2/5.')
    const staleConfirmation = await scaffold.ctx.commands.execute(
      agent,
      '/error-confirm 1',
      [],
      new AbortController().signal,
    )
    expect(staleConfirmation?.result.kind).toBe('error')
    expect(staleConfirmation?.result.text).toContain('请先查看最新修订')
    expect(scaffold.ctx.sessionProjections.stateOf(agent.session, 'errgrindEpisode')?.confirmedRevision).toBeNull()
    const liveStart = inboundFrames.length
    const secondTurn = scaffold.whenTurnSettled()
    await input.fill('Please begin the Grill diagnosis now.')
    await input.press('Enter')
    await secondTurn
    const afterProbe = scaffold.ctx.sessionProjections.stateOf(agent.session, 'errgrindEpisode')
    expect(afterProbe?.diagnosis.currentProbeId).toBe('P1')
    expect(afterProbe?.diagnosis.probes[0]?.question).toBe(PROBE_QUESTION)
    expect(afterProbe?.diagnosis.probes[0]?.answerKey).toBe(SENTINEL)
    expect(afterProbe?.diagnosis.probes[0]?.predictions[0]?.expectedObservation).toBe(SENTINEL)
    await expandTurnProcesses(page)
    await page.getByText(PROBE_QUESTION, { exact: true }).waitFor({ timeout: 10_000 })
    const transcript = await page.locator('body').innerText()
    expect(transcript).not.toContain(SENTINEL)
    expect(transcript).not.toContain('answerKey')
    expect(transcript).not.toContain('predictions')
    expect(transcript).not.toContain('errgrindEpisode')

    const thirdTurn = scaffold.whenTurnSettled()
    await input.fill(ANSWER)
    await input.press('Enter')
    await thirdTurn
    const afterConclusion = scaffold.ctx.sessionProjections.stateOf(agent.session, 'errgrindEpisode')
    expect(afterConclusion?.diagnosis.status).toBe('active')
    expect(afterConclusion?.pendingConclusion?.status).toBe('undetermined')
    expect(afterConclusion?.confirmedRevision).toBeNull()
    expect(agent.session.snapshotEvents().filter(event => event.type === 'errgrind/teach-step')).toHaveLength(0)

    await currentErrorCard.getByRole('button', { name: 'Confirm this description' }).click()
    await page.waitForTimeout(500)
    const confirmationText = await currentErrorCard.innerText()
    const confirmedRevision = scaffold.ctx.sessionProjections.stateOf(agent.session, 'errgrindEpisode')?.confirmedRevision
    expect(confirmedRevision, JSON.stringify({ confirmationText, confirmedRevision, pageErrors })).toBe(2)
    expect(scaffold.ctx.sessionProjections.stateOf(agent.session, 'errgrindEpisode')?.diagnosis.status).toBe('undetermined')
    expect(confirmationText).toContain('Confirmed')
    await errorRow.getByRole('button', { name: 'Practice from this Error' }).waitFor()

    const teachStartTurn = scaffold.whenTurnSettled()
    await input.fill('Please begin teaching this mechanism now.')
    await input.press('Enter')
    await teachStartTurn
    const teachAnswerTurn = scaffold.whenTurnSettled()
    await input.fill(TEACH_ANSWER)
    await input.press('Enter')
    await teachAnswerTurn
    await page.getByText(TEACH_FOLLOWUP).first().waitFor({ state: 'visible' })
    const afterTeachAnswer = scaffold.ctx.sessionProjections.stateOf(agent.session, 'errgrindEpisode')
    expect(afterTeachAnswer?.evidenceSources.some(source => source.text === TEACH_ANSWER)).toBe(false)
    // A sidebar Practice click opens a dedicated Drill Session seeded with the
    // confirmed Error; the learner answers inside that Session.
    const settleFor = (id: SessionId) => new Promise<SessionId>((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error(`no turn/end for ${id} within 30000ms`))
      }, 30_000)
      const off = scaffold.ctx.on('session/event', (session, event) => {
        if (session.id === id && event.type === 'turn/end') {
          clearTimeout(timer)
          off()
          resolve(id)
        }
      })
    })
    const drillId = SessionId(`errgrind-drill-${createHash('sha256')
      .update(`${sessionId}\u00000`).digest('hex').slice(0, 32)}`)
    const drillTurn = settleFor(drillId)
    await errorRow.getByRole('button', { name: 'Practice from this Error' }).click()
    expect(await drillTurn).toBe(drillId)
    const drillAgent = scaffold.ctx.agents.get(drillId)
    if (drillAgent === undefined) throw new Error('the Drill Session has no live Agent')
    const drillOpened = drillAgent.session.snapshotEvents()
    expect(drillOpened.some(event => event.type === 'errgrind/drill-open'
      && event.data.sourceSessionId === sessionId
      && event.data.sourceRevision === 2)).toBe(true)
    expect(drillOpened.some(event => event.type === 'user/message'
      && event.data.source.kind === 'errgrind-drill-request')).toBe(true)
    const drillEpisode = scaffold.ctx.sessionProjections.stateOf(drillAgent.session, 'errgrindEpisode')
    expect(drillEpisode?.origin).toMatchObject({ kind: 'drill', sourceSessionId: sessionId })
    expect(drillEpisode?.confirmedRevision).toBe(1)
    expect(drillEpisode?.diagnosis.status).toBe('undetermined')
    expect(isolatedDraftRequests).toHaveLength(1)
    const draftRequest = isolatedDraftRequests[0]!
    expect(draftRequest.messages).toHaveLength(1)
    expect(draftRequest.tools).toBeUndefined()
    expect(JSON.stringify(draftRequest)).not.toContain(INPUT)
    expect(JSON.stringify(draftRequest)).not.toContain(SENTINEL)
    expect(JSON.stringify(draftRequest)).not.toContain(ANSWER)
    await page.getByText('Independent practice').waitFor()
    await page.getByText(DRILL_QUESTION).first().waitFor({ state: 'visible' })
    const drillPrepared = drillAgent.session.snapshotEvents()
      .find(event => event.type === 'errgrind/drill-prepared')
    if (drillPrepared === undefined) throw new Error('Drill Session A committed no preparation')
    const preparationId = drillPrepared.data.id
    const derivedId = SessionId(`errgrind-derived-${createHash('sha256')
      .update(`${drillId}\0${preparationId}`).digest('hex').slice(0, 32)}`)
    const drillAnswerTurn = settleFor(drillId)
    const derivedKickoff = settleFor(derivedId)
    await input.fill(DRILL_ANSWER)
    await input.press('Enter')
    expect(new Set([await drillAnswerTurn, await derivedKickoff])).toEqual(new Set([drillId, derivedId]))
    const drillPersisted = await readPersistedEvents(scaffold, drillId)
    const coldDrill = Session.create(drillId, drillPersisted)
    const drill = scaffold.ctx.sessionProjections.stateOf(coldDrill, 'errgrindDrill')
    expect(drill?.active).toBeNull()
    expect(drill?.attempts).toHaveLength(1)
    expect(drill?.attempts[0]?.userResponse).toBe(DRILL_ANSWER)
    expect(drill?.attempts[0]?.isCorrect).toBe(false)
    expect(drill?.attempts[0]?.derivedError?.origin).toBe('drill')
    expect(drill?.attempts[0]?.derivedError?.question).toBe(DRILL_QUESTION)
    expect(drill?.attempts[0]?.derivedError?.referenceAnswer).toContain(SENTINEL)
    expect(drillPersisted.filter(event => event.type === 'errgrind/drill-judged')).toHaveLength(1)
    await page.getByText('Incorrect').first().waitFor({ state: 'visible' })
    await page.getByText(DRILL_FEEDBACK).waitFor()
    // The incorrect verdict materializes the derived Error Session by itself.
    const derivedAgent = scaffold.ctx.agents.get(derivedId)
    if (derivedAgent === undefined) throw new Error('incorrect Drill did not materialize its derived Error')
    const derivedEpisode = scaffold.ctx.sessionProjections.stateOf(derivedAgent.session, 'errgrindEpisode')
    expect(derivedEpisode?.origin).toMatchObject({
      kind: 'derived_drill', sourceSessionId: drillId, sourcePreparationId: preparationId,
    })
    // Neither a Drill Session nor an unconfirmed derived Error can open a Drill.
    await expect(scaffold.ctx.sessionController.openDrill({ sourceSessionId: drillId }))
      .rejects.toThrow('Only a confirmed Error')
    await expect(scaffold.ctx.sessionController.openDrill({ sourceSessionId: derivedId }))
      .rejects.toThrow('Only a confirmed Error')
    await expect(scaffold.ctx.sessionController.openDrill({ sourceSessionId: SessionId('errgrind-missing') }))
      .rejects.toThrow()
    // The transcript checks below read the source Error Session; the Practice
    // click navigated the page to the Drill Session, so return first.
    await errorRow.locator('button').first().click()
    const persisted = await readPersistedEvents(scaffold, sessionId)
    const coldSession = Session.create(sessionId, persisted)
    const episode = scaffold.ctx.sessionProjections.stateOf(coldSession, 'errgrindEpisode')
    const draftEvents = persisted.filter(event => event.type === 'errgrind/error-draft')
    const correctionIndex = persisted.findIndex(event => event.type === 'user/message'
      && event.data.source.kind === 'user'
      && event.data.content.some(block => block.type === 'text' && block.text === CORRECTION))
    const draftIndex = persisted.findIndex(event => event.type === 'errgrind/error-draft')
    const confirmIndex = persisted.findIndex(event => event.type === 'errgrind/error-confirm')
    const probeIndex = persisted.findIndex(event => event.type === 'errgrind/grill-probe')
    const concludeIndex = persisted.findIndex(event => event.type === 'errgrind/grill-conclude')
    const answerIndex = persisted.findIndex(event => event.type === 'user/message'
      && event.data.source.kind === 'user'
      && event.data.content.some(block => block.type === 'text' && block.text === ANSWER))
    expect(draftIndex).toBeGreaterThan(-1)
    expect(draftEvents.map(event => event.data.revision)).toEqual([1, 2])
    expect(correctionIndex).toBeGreaterThan(draftIndex)
    expect(probeIndex).toBeGreaterThan(correctionIndex)
    expect(answerIndex).toBeGreaterThan(probeIndex)
    expect(concludeIndex).toBeGreaterThan(answerIndex)
    expect(confirmIndex).toBeGreaterThan(concludeIndex)
    expect(episode?.confirmedRevision).toBe(2)
    expect(episode?.diagnosis.status).toBe('undetermined')
    expect(episode?.diagnosis.probes[0]?.answerKey).toBe(SENTINEL)
    expect(episode?.diagnosis.probes[0]?.predictions[0]?.expectedObservation).toBe(SENTINEL)
    const teachEvent = persisted.find(event => event.type === 'errgrind/teach-step')
    expect(teachEvent?.data).toMatchObject({ kind: 'question', text: TEACH_QUESTION })
    expect(persisted.filter(event => event.type === 'errgrind/teach-step')).toHaveLength(2)
    expect(episode?.teachStartedAtTurn).not.toBeNull()
    await page.getByText(TEACH_QUESTION).first().waitFor({ state: 'visible', timeout: 10_000 })
    expect(persisted.some(event => event.type === 'errgrind/grill-probe'
      && JSON.stringify(event.data).includes(SENTINEL))).toBe(true)

    const livePrivateFrame = inboundFrames.slice(liveStart).some(frame => frame.includes('browser/private'))
    expect(livePrivateFrame).toBe(true)
    expect(inboundFrames.slice(liveStart).join('\n')).not.toContain(SENTINEL)
    expect(apiBodies.join('\n')).not.toContain(SENTINEL)
    expect(inboundFrames.join('\n')).not.toContain('answerKey')
    expect(apiBodies.join('\n')).not.toContain('answerKey')
    expect(inboundFrames.join('\n')).toContain('errgrindEpisode')
    for (const privateField of ['diagnosisHistory', 'evidenceSources', 'firstInputHasImage', 'confirmedRevision']) {
      expect(inboundFrames.join('\n')).not.toContain(privateField)
      expect(apiBodies.join('\n')).not.toContain(privateField)
    }
    expect(inboundFrames.join('\n')).not.toContain('answerKey')
    expect(apiBodies.join('\n')).not.toContain('predictions')

    // Return to the Error Session before the mobile transcript checks; the
    // Drill cards and verdict live in the Drill Session transcript.
    await errorRow.locator('button').first().click()
    const beforeReload = inboundFrames.length
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload({ waitUntil: 'load' })
    await expect.poll(() => inboundFrames.slice(beforeReload).some(frame => frame.includes('browser/private')),
      { timeout: 15_000 }).toBe(true)
    expect(inboundFrames.slice(beforeReload).join('\n')).not.toContain(SENTINEL)
    expect(apiBodies.join('\n')).not.toContain(SENTINEL)
    await expect.poll(async () => (await page.locator('body').innerText()).includes(PROBE_QUESTION),
      { timeout: 15_000 }).toBe(true)
    const mobileTranscript = await page.locator('body').innerText()
    expect(mobileTranscript).not.toContain(SENTINEL)
    expect(mobileTranscript).not.toContain('answerKey')
    expect(mobileTranscript).not.toContain('predictions')
    expect(mobileTranscript).not.toContain('errgrindEpisode')
    await page.getByText(TEACH_QUESTION).first().waitFor({ state: 'visible', timeout: 10_000 })
    for (const image of smokeImages) {
      await page.getByRole('img', { name: image.name, exact: true }).waitFor({ timeout: 20_000 })
    }
    const mobileLayout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      composerWidth: document.querySelector('[data-composer-input]')?.getBoundingClientRect().width ?? 0,
    }))
    expect(mobileLayout.viewportWidth).toBe(390)
    expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth)
    expect(mobileLayout.composerWidth).toBeGreaterThan(0)

    // The verdict card's Investigate button still navigates into the
    // already-materialized derived Error Session.
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.locator(`[data-error-session-id="${drillId}"]`).locator('button').first().click()
    await page.getByText(DRILL_FEEDBACK).waitFor()
    await page.getByRole('button', { name: 'Investigate this new Error' }).click()
    try {
      await page.getByText('New Error from practice').waitFor({ state: 'visible', timeout: 10_000 })
    } catch {
      throw new Error(`Derived Error card missing: ${JSON.stringify({ body: (await page.locator('body').innerText()).slice(-800), pageErrors, consoleErrors })}`)
    }
    await page.getByText(DRILL_QUESTION).first().waitFor({ state: 'visible' })
    await page.getByText(DRILL_ANSWER).first().waitFor({ state: 'visible' })
    const retry = await scaffold.ctx.sessionController.openDerivedError({
      sourceSessionId: drillId,
      preparationId,
    })
    expect(retry.sessionId).toBe(derivedId)
    expect(derivedAgent.session.snapshotEvents().filter(event => event.type === 'errgrind/derived-error-open'))
      .toHaveLength(1)
    const derivedPersisted = await readPersistedEvents(scaffold, derivedId)
    const coldDerived = Session.create(derivedId, derivedPersisted)
    expect(scaffold.ctx.sessionProjections.stateOf(coldDerived, 'errgrindEpisode')?.origin.kind)
      .toBe('derived_drill')
    expect(inboundFrames.join('\n')).not.toContain(SENTINEL)
    await page.reload({ waitUntil: 'load' })
    await page.getByText('New Error from practice').waitFor({ state: 'visible', timeout: 15_000 })
    expect((await page.locator('body').innerText())).not.toContain(SENTINEL)

    // A second Practice request allocates the next deterministic Drill index;
    // its row carries the practice label in Error history.
    const drillBId = SessionId(`errgrind-drill-${createHash('sha256')
      .update(`${sessionId}\u00001`).digest('hex').slice(0, 32)}`)
    const drillBTurn = settleFor(drillBId)
    const secondDrill = await scaffold.ctx.sessionController.openDrill({ sourceSessionId: sessionId })
    expect(secondDrill.sessionId).toBe(drillBId)
    expect(await drillBTurn).toBe(drillBId)
    const drillBRow = page.locator(`[data-error-session-id="${drillBId}"]`)
    await drillBRow.waitFor({ timeout: 10_000 })
    expect(await drillBRow.innerText()).toContain('Practice')
    await drillBRow.locator('button').first().click()
    await page.getByText('Independent practice').waitFor()
    await page.getByText(DRILL_QUESTION).first().waitFor({ state: 'visible' })
    const judgeBTurn = settleFor(drillBId)
    await input.fill('Converted to eighths first: 6/8 + 1/8 = 7/8.')
    await input.press('Enter')
    expect(await judgeBTurn).toBe(drillBId)
    // A correct verdict archives the Drill Session once its turn settles;
    // the incorrect one stays open beside its derived Error. The verdict card
    // itself was already exercised on the incorrect path; here the log owns the
    // fact because archival can unmount the transcript before it renders.
    const drillBPersisted = await readPersistedEvents(scaffold, drillBId)
    expect(drillBPersisted.some(event => event.type === 'errgrind/drill-judged'
      && event.data.isCorrect)).toBe(true)
    await expect.poll(() => scaffold.ctx.workspaceRegistry.archivedSessionIds.includes(drillBId))
      .toBe(true)
    expect(scaffold.ctx.workspaceRegistry.archivedSessionIds.includes(drillId)).toBe(false)
    await expect.poll(() => page.locator(`[data-error-session-id="${drillBId}"]`).count()).toBe(0)
    expect(pageErrors).toEqual([])
    expect(remoteSocket).toBeDefined()
  }, 120_000)

  it.skipIf(MODE === 'record')('keeps New Error and Error history usable after a refresh', async () => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.getByRole('button', { name: 'New Error', exact: true })
      .filter({ hasText: 'New Error' }).click()
    await expect.poll(() => page.locator('[data-conversation-content]').getAttribute('data-content-phase'))
      .toBe('hero')
    await page.reload({ waitUntil: 'load' })
    await page.getByText('Start with a math mistake', { exact: true }).waitFor({ timeout: 15_000 })
    const derived = scaffold.ctx.agents.list().find(agent => String(agent.session.id).startsWith('errgrind-derived-'))
    if (derived === undefined) throw new Error('derived Error Session missing')
    await page.locator(`[data-error-session-id="${derived.session.id}"] button`).first().click()
    await page.getByText('New Error from practice').waitFor({ state: 'visible', timeout: 15_000 })
    expect(pageErrors).toEqual([])
  })

  it.skipIf(MODE === 'record')('keeps the removed Codex sign-in surface out of Web Models settings', async () => {
    await openSettings(page, 'en')
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Models', exact: true }).click()
    expect(await dialog.getByRole('heading', { name: 'Codex sign-in' }).count()).toBe(0)
    expect(await dialog.getByRole('button', { name: 'Sign in with ChatGPT' }).count()).toBe(0)
  })
})
