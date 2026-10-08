import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import {
  createUserMessage,
  ToolCallId,
  type GenerateOptions,
  type LlmCallConfig,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { Agent, AgentOptions, AgentStatus } from '@deepseek-ai/dsh-agent'
import { apply } from '../src/index.ts'
import { loadToolPrompts } from '../src/tool-prompts.ts'
import type { DrillState } from '../src/drill.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

class MockLlmService extends Service {
  streamHandler?: (options: GenerateOptions) => AsyncIterable<StreamChunk>
  resolveHandler?: (config: LlmCallConfig) => Promise<LlmCallConfig>

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.streamHandler) return this.streamHandler(options)
    throw new Error('No streamHandler defined on MockLlmService')
  }

  resolveCallConfig(config: LlmCallConfig): Promise<LlmCallConfig> {
    if (this.resolveHandler) return this.resolveHandler(config)
    return Promise.resolve(config)
  }
}

function createTestAgent(ctx: Context, session: Session, options: AgentOptions = { provider: 'test-provider', model: 'test-model' }): Agent {
  return {
    id: session.id,
    session,
    options,
    ctx,
    status: 'idle' as AgentStatus,
    inbox: {
      nextTurn: [],
      nextStep: [],
      clear() {},
      append() {},
      prepend() {},
      replace() { return false },
      remove() { return false },
      splice() { return [] },
    },
    cancel() {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: <T>(fn: (signal: AbortSignal) => Promise<T>) => fn(new AbortController().signal),
    send() {},
    followup() {},
    steer() {},
    inject() {},
  } satisfies Agent
}

async function setupTestApp(): Promise<{ ctx: Context; mockLlm: MockLlmService }> {
  const ctx = context = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  const mockLlm = new MockLlmService(ctx)
  apply(ctx)
  return { ctx, mockLlm }
}

const validSpecArgs = {
  targetMechanism: 'Align denominators before adding',
  trigger: 'Fractions with unlike denominators',
  failureBehavior: 'Added numerators and added denominators directly',
  desiredBehavior: 'Find common denominator and convert before adding',
  successSignal: 'Correctly identifies common multiple and explains equal parts',
  domain: 'fractions',
  taskType: 'calculate' as const,
  setting: 'abstract arithmetic',
  taskGoal: 'Calculate the sum of two fractions with different denominators',
  essentialTrigger: 'Two fractions with coprime denominators requiring conversion',
  solutionStrategy: 'Determine LCM of denominators, convert numerators, add numerators, simplify',
  avoid: ['equal denominators', 'decimals', 'unrelated complex algebra'],
  difficultyLevel: 2,
  reasoningDepth: 2,
  calculationLoad: 1,
}

/** Stub the isolated Draft request to return one prepared problem. */
function stubDraftStream(mockLlm: MockLlmService, question: string, referenceAnswer: string): void {
  mockLlm.streamHandler = () => {
    async function* generate() {
      yield { type: 'text-delta' as const, index: 0, text: JSON.stringify({ question, referenceAnswer }) }
      yield { type: 'usage' as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
      yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
    }
    return generate()
  }
}

/** Seed a dedicated Drill Session; its episode context is the confirmed source outcome. */
function setupDrillSession(session: Session, sentinel: string = 'SENTINEL_INPUT'): void {
  session.append('errgrind/drill-open', {
    text: `Practice generated for: ${sentinel}`,
    sourceSessionId: 'source-session',
    sourceRevision: 1,
    description: `Draft description containing ${sentinel}`,
    diagnosisStatus: 'undetermined',
    diagnosisSummary: `Diagnosis summary with ${sentinel}`,
    remainingUncertainty: `Uncertainty with ${sentinel}`,
    whatWouldChangeJudgment: `Evidence that would change the judgment about ${sentinel}`,
  })
}

/** Seed a pool-mode Drill Session waiting for the model's pick. */
function setupPoolDrillSession(session: Session): void {
  session.append('errgrind/drill-open', {
    text: 'Practice pool: 2 confirmed Errors for you to choose from',
    candidates: [{
      sourceSessionId: 'error-a',
      sourceRevision: 1,
      description: 'added numerators',
      diagnosisStatus: 'supported',
      diagnosisSummary: 'diag a',
      remainingUncertainty: '',
      whatWouldChangeJudgment: '',
    }, {
      sourceSessionId: 'error-b',
      sourceRevision: 2,
      description: 'missed domain check',
      diagnosisStatus: 'undetermined',
      diagnosisSummary: 'diag b',
      remainingUncertainty: 'which rule',
      whatWouldChangeJudgment: 'counterexample',
    }],
  })
}

/** Seed an ordinary Error Session reaching a confirmed diagnosis. */
function setupErrorSession(session: Session): void {
  session.append('errgrind/error-open', {
    text: 'My mistake',
    turn: 1,
    hasImage: false,
    attachments: [],
  })
  session.append('errgrind/error-draft', {
    revision: 1,
    text: 'Draft description',
  })
  session.append('errgrind/error-confirm', {
    revision: 1,
    commandId: 'cmd-confirm',
  })
  session.append('errgrind/grill-conclude', {
    anchorRevision: 1,
    diagnosisStatus: 'undetermined',
    summary: 'Diagnosis summary',
    remainingUncertainty: 'Uncertainty',
    turn: 1,
  })
}

describe('Isolated Drill Generation', () => {
  it('rejects drill_prepare outside a dedicated Drill Session', async () => {
    const { ctx } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-in-error-session'))
    const agent = createTestAgent(ctx, session)
    setupErrorSession(session)

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-not-drill'), name: 'drill_prepare', agent,
      arguments: validSpecArgs,
    })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('dedicated Drill Session')
    expect(session.snapshotEvents().filter(
      e => e.type === 'errgrind/drill-spec-prepared' || e.type === 'errgrind/drill-draft-finished'))
      .toHaveLength(0)
  })

  it('requires a pool candidate pick before generation and rejects foreign or extra picks', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-pool-pick'))
    const agent = createTestAgent(ctx, session)
    setupPoolDrillSession(session)
    let called = false
    mockLlm.streamHandler = () => { called = true; throw new Error('must not run') }

    const noPick = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-no-pick'), name: 'drill_prepare', agent,
      arguments: validSpecArgs,
    })
    expect(noPick.isError).toBe(true)
    expect(noPick.error?.message).toContain('Pick one listed practice candidate')

    const foreignPick = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-foreign-pick'), name: 'drill_prepare', agent,
      arguments: { ...validSpecArgs, sourceSessionId: 'error-x' },
    })
    expect(foreignPick.isError).toBe(true)
    expect(foreignPick.error?.message).toContain('Pick one listed practice candidate')
    expect(called).toBe(false)
    expect(session.snapshotEvents().filter(e => e.type === 'errgrind/drill-source-selected'))
      .toHaveLength(0)
  })

  it('rejects a sourceSessionId foreign to the locked practice source', async () => {
    const { ctx } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-single-arg'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-single-pick'), name: 'drill_prepare', agent,
      arguments: { ...validSpecArgs, sourceSessionId: 'error-a' },
    })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('locked practice source')
  })

  it('accepts a resubmitted locked pick when a pool attempt retries', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-pool-retry'))
    const agent = createTestAgent(ctx, session)
    setupPoolDrillSession(session)

    // The first attempt picks a candidate and is rejected at specification
    // validation; retries resubmit the same locked pick and must not deadlock.
    const rejected = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-pool-leak'), name: 'drill_prepare', agent,
      arguments: { ...validSpecArgs, trigger: '引用原题的触发条件', sourceSessionId: 'error-b' },
    })
    expect(rejected.isError).toBe(true)
    expect(rejected.error?.message).toContain('without referring to the original')

    stubDraftStream(mockLlm, 'q', 'a')

    const retried = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-pool-retry'), name: 'drill_prepare', agent,
      arguments: { ...validSpecArgs, sourceSessionId: 'error-b' },
    })
    expect(retried.isError).toBe(false)
    expect(session.snapshotEvents().filter(e => e.type === 'errgrind/drill-source-selected'))
      .toHaveLength(1)
  })

  it('folds the picked candidate into the episode before generating', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-pool-success'))
    const agent = createTestAgent(ctx, session)
    setupPoolDrillSession(session)

    stubDraftStream(mockLlm, 'q', 'a')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-pool-pick'), name: 'drill_prepare', agent,
      arguments: { ...validSpecArgs, sourceSessionId: 'error-b' },
    })

    expect(result.isError).toBe(false)
    const selected = session.snapshotEvents().find(e => e.type === 'errgrind/drill-source-selected')
    expect(selected?.data).toMatchObject({ sourceSessionId: 'error-b', description: 'missed domain check' })
    const episode = ctx.sessionProjections.stateOf(session, 'errgrindEpisode')
    expect(episode?.drillCandidates).toHaveLength(0)
    expect(episode?.origin).toMatchObject({ kind: 'drill', sourceSessionId: 'error-b' })
    expect(episode?.confirmedRevision).toBe(1)
  })

  it('rejects copied source text before a specification can reach the Draft model', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-source-leak'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session, 'TOP_SECRET_SENTINEL')
    let called = false
    mockLlm.streamHandler = () => { called = true; throw new Error('must not run') }

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-leaked-spec'), name: 'drill_prepare', agent,
      arguments: { ...validSpecArgs, setting: 'Use TOP_SECRET_SENTINEL as the new setting' },
    })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('distinctive text')
    expect(called).toBe(false)
    expect(ctx.sessionProjections.stateOf(session, 'errgrindDrill')?.pendingSpec).toBeNull()

    // Rejected before a specification persisted, the attempt still records a
    // standalone failure marker for the browser's generation-failure card.
    const finished = session.snapshotEvents().find(e => e.type === 'errgrind/drill-draft-finished')
    expect(finished).toBeDefined()
    if (finished?.type === 'errgrind/drill-draft-finished') {
      expect(finished.data.status).toBe('failed')
    }
  })

  it('records a failure marker for an invalid specification and for a Draft call that cannot start', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-early-failures'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    const invalid = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-invalid'), name: 'drill_prepare', agent,
      arguments: { ...validSpecArgs, taskGoal: '   ' },
    })
    expect(invalid.isError).toBe(true)
    const markers = () => session.snapshotEvents().filter(
      (e): e is SessionEvent<'errgrind/drill-draft-finished'> => e.type === 'errgrind/drill-draft-finished')
    expect(markers()).toHaveLength(1)
    expect(markers()[0]?.data.status).toBe('failed')

    // The specification persists; the Draft call then fails to resolve, so the
    // marker must reference the pending specification exactly.
    mockLlm.resolveHandler = () => Promise.reject(new Error('config backend down'))
    const unresolved = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-unresolved'), name: 'drill_prepare', agent,
      arguments: validSpecArgs,
    })
    expect(unresolved.isError).toBe(true)
    const pending = ctx.sessionProjections.stateOf(session, 'errgrindDrill')?.pendingSpec
    expect(pending).not.toBeNull()
    expect(markers()).toHaveLength(2)
    expect(markers()[1]?.data.preparationId).toBe(pending?.id)
    expect(markers()[1]?.data.status).toBe('failed')

    // A staged specification persists across a failed attempt and the retry
    // settles against it even when its recorded anchor fields cannot recur.
    const stale = ctx.sessions.create(SessionId('drill-stale-anchor'))
    const staleAgent = createTestAgent(ctx, stale)
    setupDrillSession(stale)
    stale.append('errgrind/drill-spec-prepared', {
      id: 'stale-pending',
      spec: {
        targetMechanism: 'Align denominators', trigger: 'Unlike denominators',
        failureBehavior: 'Added denominators directly', desiredBehavior: 'Use equal parts',
        successSignal: 'Explains the common denominator', domain: 'fractions',
        taskType: 'calculate', setting: 'arithmetic', taskGoal: 'Compute sum of fractions',
        essentialTrigger: 'Different denominators', solutionStrategy: 'Find common denominator',
        avoid: ['same denominators'], difficultyLevel: 1, reasoningDepth: 1, calculationLoad: 1,
      },
      sourceRevision: 99, sourceDiagnosisRound: 1, preparedAtTurn: 4,
    })
    const staleResult = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-stale'), name: 'drill_prepare', agent: staleAgent,
      arguments: validSpecArgs,
    })
    expect(staleResult.isError).toBe(true)
    const staleMarkers = stale.snapshotEvents().filter(
      (e): e is SessionEvent<'errgrind/drill-draft-finished'> => e.type === 'errgrind/drill-draft-finished')
    expect(staleMarkers).toHaveLength(1)
    expect(staleMarkers[0]?.data.preparationId).toBe('stale-pending')
    expect(staleMarkers[0]?.data.status).toBe('failed')
  })

  it('rejects a second call during an in-flight Draft without recording a marker', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-in-flight'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    let resolveEntered = false
    let releaseResolve!: () => void
    mockLlm.resolveHandler = (config: LlmCallConfig) => new Promise<LlmCallConfig>((resolve) => {
      resolveEntered = true
      releaseResolve = () => { resolve(config) }
    })
    const first = ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-in-flight-first'), name: 'drill_prepare', agent,
      arguments: validSpecArgs,
    })
    await vi.waitFor(() => { expect(resolveEntered).toBe(true) })

    const second = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-in-flight-second'), name: 'drill_prepare', agent,
      arguments: validSpecArgs,
    })
    expect(second.isError).toBe(true)
    expect(second.error?.message).toContain('already in progress')
    const markers = () => session.snapshotEvents().filter(
      (e): e is SessionEvent<'errgrind/drill-draft-finished'> => e.type === 'errgrind/drill-draft-finished')
    // The duplicate is a rejection, not a failed attempt: no marker yet.
    expect(markers()).toHaveLength(0)

    mockLlm.streamHandler = async function* () {
      const answer = JSON.stringify({ question: '计算 2/3 + 1/4', referenceAnswer: '11/12' })
      yield { type: 'block-start' as const, index: 0, blockType: 'text' as const }
      yield { type: 'text-delta' as const, index: 0, text: answer }
      yield { type: 'block-end' as const, index: 0, block: { type: 'text' as const, text: answer } }
      yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
    }
    releaseResolve()
    const firstResult = await first
    expect(firstResult.isError).toBe(false)
    expect(markers()).toHaveLength(1)
    expect(markers()[0]?.data.status).toBe('success')
  })

  it('marks an attempt aborted when the call signal is cancelled mid-flight', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-aborted-mid-flight'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    let resolveEntered = false
    let rejectResolve!: (error: Error) => void
    mockLlm.resolveHandler = () => new Promise<LlmCallConfig>((_resolve, reject) => {
      resolveEntered = true
      rejectResolve = reject
    })
    const controller = new AbortController()
    const first = ctx.tools.execute({
      signal: controller.signal,
      callId: ToolCallId('call-aborted-mid-flight'), name: 'drill_prepare', agent,
      arguments: validSpecArgs,
    })
    await vi.waitFor(() => { expect(resolveEntered).toBe(true) })
    controller.abort()
    rejectResolve(new Error('config backend gone'))

    const result = await first
    expect(result.isError).toBe(true)
    const finished = () => session.snapshotEvents().find(e => e.type === 'errgrind/drill-draft-finished')
    await vi.waitFor(() => { expect(finished()).toBeDefined() })
    const marker = finished()
    if (marker?.type === 'errgrind/drill-draft-finished') {
      expect(marker.data.status).toBe('aborted')
    }
  })

  it('allows the mechanism to describe the original behavior while isolating the new problem', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-mechanism-wording'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session, '我把分子和分母分别相加')
    mockLlm.streamHandler = async function* () {
      const answer = JSON.stringify({ question: '计算 2/3 + 1/4', referenceAnswer: '11/12' })
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: answer }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-mechanism-wording'), name: 'drill_prepare', agent,
      arguments: { ...validSpecArgs, failureBehavior: '我把分子和分母分别相加' },
    })
    expect(result.isError).toBe(false)
  })

  it('isolates the draft LLM call and excludes sentinel original input, images, history, and tools', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-sentinel-test'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session, 'TOP_SECRET_SENTINEL')

    let capturedOptions: GenerateOptions | undefined
    mockLlm.streamHandler = (options: GenerateOptions) => {
      capturedOptions = options
      async function* generate() {
        yield { type: 'block-start' as const, index: 0, blockType: 'text' as const }
        yield { type: 'text-delta' as const, index: 0, text: JSON.stringify({ question: '计算 1/3 + 1/4', referenceAnswer: '7/12' }) }
        yield { type: 'block-end' as const, index: 0, block: { type: 'text' as const, text: JSON.stringify({ question: '计算 1/3 + 1/4', referenceAnswer: '7/12' }) } }
        yield { type: 'usage' as const, usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 } }
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      }
      return generate()
    }

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-1'),
      name: 'drill_prepare',
      arguments: validSpecArgs,
      agent,
    })

    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ question: '计算 1/3 + 1/4' })

    expect(capturedOptions).toBeDefined()
    if (!capturedOptions) throw new Error('options not captured')

    // Message must be single identity-free user input containing spec JSON
    expect(capturedOptions.messages).toHaveLength(1)
    const firstMsg = capturedOptions.messages[0]
    expect(firstMsg?.role).toBe('user')
    if (firstMsg?.role === 'user') {
      const textBlock = firstMsg.content[0]
      expect(textBlock?.type).toBe('text')
      if (textBlock?.type === 'text') {
        const parsedSpec = JSON.parse(textBlock.text) as typeof validSpecArgs
        expect(parsedSpec.targetMechanism).toBe(validSpecArgs.targetMechanism)
      }
    }

    // Verify system prompt is loaded from drill-draft.md
    expect(capturedOptions.system).toBe(loadToolPrompts().drillDraftPrompt)

    // Complete absence of original Error, images, conversation history, tools, and sessionId
    const serialized = JSON.stringify(capturedOptions)
    expect(serialized).not.toContain('TOP_SECRET_SENTINEL')
    expect(serialized).not.toContain('sentinel-hash-1234')
    expect(capturedOptions.tools).toBeUndefined()
    expect(capturedOptions.sessionId).toBeUndefined()
  })

  it('persists errgrind/drill-spec-prepared and errgrind/drill-draft-requested before LLM stream starts', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-persisted-before-stream'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    let eventsBeforeStream: ReturnType<Session['snapshotEvents']> = []
    mockLlm.streamHandler = () => {
      eventsBeforeStream = session.snapshotEvents()
      async function* generate() {
        yield { type: 'text-delta' as const, index: 0, text: JSON.stringify({ question: '计算 1/2 + 1/4', referenceAnswer: '3/4' }) }
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      }
      return generate()
    }

    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-pre-check'),
      name: 'drill_prepare',
      arguments: validSpecArgs,
      agent,
    })

    const typesBefore = eventsBeforeStream.map(e => e.type)
    expect(typesBefore).toContain('errgrind/drill-spec-prepared')
    expect(typesBefore).toContain('errgrind/drill-draft-requested')
    expect(typesBefore).not.toContain('errgrind/drill-draft-finished')
    expect(typesBefore).not.toContain('errgrind/drill-prepared')

    const requestedEvent = eventsBeforeStream.find(e => e.type === 'errgrind/drill-draft-requested')
    expect(requestedEvent).toBeDefined()
    if (requestedEvent?.type === 'errgrind/drill-draft-requested') {
      expect(requestedEvent.data.spec.targetMechanism).toBe(validSpecArgs.targetMechanism)
      expect(requestedEvent.data.config.provider).toBe('test-provider')
      expect(requestedEvent.data.config.model).toBe('test-model')
    }
  })

  it('validates bounds on all structured fields and rejects invalid bounds', async () => {
    const { ctx } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-bounds-test'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    // difficultyLevel out of bounds
    const resDifficulty = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-diff'),
      name: 'drill_prepare',
      arguments: { ...validSpecArgs, difficultyLevel: 0 },
      agent,
    })
    expect(resDifficulty.isError).toBe(true)

    // reasoningDepth out of bounds
    const resDepth = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-depth'),
      name: 'drill_prepare',
      arguments: { ...validSpecArgs, reasoningDepth: 6 },
      agent,
    })
    expect(resDepth.isError).toBe(true)

    // calculationLoad out of bounds
    const resCalc = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-calc'),
      name: 'drill_prepare',
      arguments: { ...validSpecArgs, calculationLoad: 10 },
      agent,
    })
    expect(resCalc.isError).toBe(true)

    // avoid empty
    const resAvoid = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-avoid'),
      name: 'drill_prepare',
      arguments: { ...validSpecArgs, avoid: [] },
      agent,
    })
    expect(resAvoid.isError).toBe(true)

    // empty string
    const resEmpty = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-empty'),
      name: 'drill_prepare',
      arguments: { ...validSpecArgs, taskGoal: '   ' },
      agent,
    })
    expect(resEmpty.isError).toBe(true)
  })

  it('cannot bypass prepare with embedded question, referenceAnswer, or unknown keys', async () => {
    const { ctx } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-bypass-test'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    const resQuestion = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-q'),
      name: 'drill_prepare',
      arguments: { ...validSpecArgs, question: 'Bypass question?' },
      agent,
    })
    expect(resQuestion.isError).toBe(true)
    expect(resQuestion.error?.message).toContain('drill_prepare does not accept question or referenceAnswer')

    const resAnswer = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-a'),
      name: 'drill_prepare',
      arguments: { ...validSpecArgs, referenceAnswer: '42' },
      agent,
    })
    expect(resAnswer.isError).toBe(true)
    expect(resAnswer.error?.message).toContain('drill_prepare does not accept question or referenceAnswer')

    const resUnknown = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-unk'),
      name: 'drill_prepare',
      arguments: { ...validSpecArgs, histories: ['fabricated history'] },
      agent,
    })
    expect(resUnknown.isError).toBe(true)
    expect(resUnknown.error?.message).toContain('drill_prepare does not accept parameter')
  })

  it('handles successful generation and exposes ONLY question in tool output', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-success-test'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    mockLlm.streamHandler = () => {
      async function* generate() {
        yield { type: 'text-delta' as const, index: 0, text: JSON.stringify({ question: '计算 2/5 + 1/3', referenceAnswer: '11/15' }) }
        yield { type: 'usage' as const, usage: { inputTokens: 45, outputTokens: 25, totalTokens: 70 } }
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      }
      return generate()
    }

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-success'),
      name: 'drill_prepare',
      arguments: validSpecArgs,
      agent,
    })

    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ question: '计算 2/5 + 1/3' })
    expect(result.content).toEqual([{ type: 'text', text: '计算 2/5 + 1/3' }])

    const drillState = ctx.sessionProjections.stateOf(session, 'errgrindDrill') as DrillState
    expect(drillState.active).not.toBeNull()
    expect(drillState.active?.question).toBe('计算 2/5 + 1/3')
    expect(drillState.active?.referenceAnswer).toBe('11/15')
    expect(drillState.pendingSpec).toBeNull()

    const events = session.snapshotEvents()
    const finishedEvent = events.find(e => e.type === 'errgrind/drill-draft-finished')
    expect(finishedEvent).toBeDefined()
    if (finishedEvent?.type === 'errgrind/drill-draft-finished') {
      expect(finishedEvent.data.status).toBe('success')
      expect(finishedEvent.data.usage?.inputTokens).toBe(45)
    }
  })

  it('keeps TeX math delimiters in the generated question verbatim for the Markdown card', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-tex-delimiters-test'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    mockLlm.streamHandler = () => {
      async function* generate() {
        yield { type: 'text-delta' as const, index: 0, text: JSON.stringify({
          question: '计算 \\(2/5 + 1/3\\) 并化简 $$x + 1$$',
          referenceAnswer: '11/15',
        }) }
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      }
      return generate()
    }

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-tex'),
      name: 'drill_prepare',
      arguments: validSpecArgs,
      agent,
    })

    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ question: '计算 \\(2/5 + 1/3\\) 并化简 $$x + 1$$' })
    const drillState = ctx.sessionProjections.stateOf(session, 'errgrindDrill') as DrillState
    expect(drillState.active?.question).toBe('计算 \\(2/5 + 1/3\\) 并化简 $$x + 1$$')
  })

  it('handles malformed JSON from provider with clear Chinese retry error and retains pendingSpec', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-malformed-json-test'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    mockLlm.streamHandler = () => {
      async function* generate() {
        yield { type: 'text-delta' as const, index: 0, text: 'This is not JSON at all.' }
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      }
      return generate()
    }

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-malformed'),
      name: 'drill_prepare',
      arguments: validSpecArgs,
      agent,
    })

    expect(result.isError).toBe(true)
    expect(result.error?.message).toBe('练习题生成失败，练习规格已保留。请再次调用 drill_prepare 重试。')

    const drillState = ctx.sessionProjections.stateOf(session, 'errgrindDrill') as DrillState
    expect(drillState.active).toBeNull()
    expect(drillState.pendingSpec).not.toBeNull()
    expect(drillState.pendingSpec?.spec.targetMechanism).toBe(validSpecArgs.targetMechanism)

    const finishedEvent = session.snapshotEvents().find(e => e.type === 'errgrind/drill-draft-finished')
    expect(finishedEvent).toBeDefined()
    if (finishedEvent?.type === 'errgrind/drill-draft-finished') {
      expect(finishedEvent.data.status).toBe('failed')
    }
  })

  it('handles provider error chunk with clear Chinese retry error and retains pendingSpec', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-provider-error-test'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    mockLlm.streamHandler = () => {
      async function* generate() {
        yield { type: 'finish' as const, reason: { kind: 'error' as const, failure: { message: 'Internal Server Error', code: 'INTERNAL_ERROR' } } }
      }
      return generate()
    }

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-err'),
      name: 'drill_prepare',
      arguments: validSpecArgs,
      agent,
    })

    expect(result.isError).toBe(true)
    expect(result.error?.message).toBe('练习题生成失败，练习规格已保留。请再次调用 drill_prepare 重试。')

    const drillState = ctx.sessionProjections.stateOf(session, 'errgrindDrill') as DrillState
    expect(drillState.active).toBeNull()
    expect(drillState.pendingSpec).not.toBeNull()
  })

  it('handles max-tokens truncation with specific truncation retry message and retains pendingSpec', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-truncation-test'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    mockLlm.streamHandler = () => {
      async function* generate() {
        yield { type: 'text-delta' as const, index: 0, text: '{"question": "部分截断的' }
        yield { type: 'finish' as const, reason: { kind: 'max-tokens' as const } }
      }
      return generate()
    }

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-trunc'),
      name: 'drill_prepare',
      arguments: validSpecArgs,
      agent,
    })

    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('长度超限截断')

    const drillState = ctx.sessionProjections.stateOf(session, 'errgrindDrill') as DrillState
    expect(drillState.active).toBeNull()
    expect(drillState.pendingSpec).not.toBeNull()
  })

  it('handles cancellation and abort with specific cancellation message and retains pendingSpec', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-abort-test'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    mockLlm.streamHandler = () => {
      async function* generate() {
        yield { type: 'finish' as const, reason: { kind: 'aborted' as const, failure: { message: 'Cancelled by user', code: 'ABORTED' } } }
      }
      return generate()
    }

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-abort'),
      name: 'drill_prepare',
      arguments: validSpecArgs,
      agent,
    })

    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('已取消')

    const drillState = ctx.sessionProjections.stateOf(session, 'errgrindDrill') as DrillState
    expect(drillState.active).toBeNull()
    expect(drillState.pendingSpec).not.toBeNull()

    const finishedEvent = session.snapshotEvents().find(e => e.type === 'errgrind/drill-draft-finished')
    expect(finishedEvent).toBeDefined()
    if (finishedEvent?.type === 'errgrind/drill-draft-finished') {
      expect(finishedEvent.data.status).toBe('aborted')
    }
  })

  it('resumes saved exact spec on failure retry without overwriting with changed arguments', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-resume-test'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    // First attempt fails due to provider error
    mockLlm.streamHandler = () => {
      async function* generate() {
        yield { type: 'finish' as const, reason: { kind: 'error' as const, failure: { message: '503 Service Unavailable', code: 'UNAVAILABLE' } } }
      }
      return generate()
    }

    const firstResult = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-attempt-1'),
      name: 'drill_prepare',
      arguments: validSpecArgs,
      agent,
    })
    expect(firstResult.isError).toBe(true)

    const drillStateAfterFirst = ctx.sessionProjections.stateOf(session, 'errgrindDrill') as DrillState
    expect(drillStateAfterFirst.pendingSpec).not.toBeNull()
    const originalPendingId = drillStateAfterFirst.pendingSpec?.id

    // Second attempt (retry) passes DIFFERENT arguments, but LLM succeeds
    mockLlm.streamHandler = () => {
      async function* generate() {
        yield { type: 'text-delta' as const, index: 0, text: JSON.stringify({ question: '恢复生成的题目', referenceAnswer: '恢复的答案' }) }
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      }
      return generate()
    }

    const changedArgs = {
      ...validSpecArgs,
      targetMechanism: 'CHANGED_TARGET_MECHANISM',
      difficultyLevel: 5,
    }

    const secondResult = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-attempt-2'),
      name: 'drill_prepare',
      arguments: changedArgs,
      agent,
    })

    expect(secondResult.isError).toBe(false)
    expect(secondResult.value).toEqual({ question: '恢复生成的题目' })

    const drillStateAfterSecond = ctx.sessionProjections.stateOf(session, 'errgrindDrill') as DrillState
    expect(drillStateAfterSecond.active).not.toBeNull()
    expect(drillStateAfterSecond.pendingSpec).toBeNull()

    // Must have preserved the original pending spec and ID, not the changed arguments
    expect(drillStateAfterSecond.active?.id).toBe(originalPendingId)
    const activeSpec = drillStateAfterSecond.active?.spec
    if (activeSpec && 'failureBehavior' in activeSpec) {
      expect(activeSpec.targetMechanism).toBe(validSpecArgs.targetMechanism)
      expect(activeSpec.difficultyLevel).toBe(validSpecArgs.difficultyLevel)
    }
  })

  it('prevents overlapping generation on the same session', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-concurrency-test'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    let resolveStream: () => void
    const streamGate = new Promise<void>((resolve) => {
      resolveStream = resolve
    })

    mockLlm.streamHandler = () => {
      async function* generate() {
        await streamGate
        yield { type: 'text-delta' as const, index: 0, text: JSON.stringify({ question: '并发题目', referenceAnswer: '并发答案' }) }
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      }
      return generate()
    }

    // Start first prepare call
    const firstCallPromise = ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-conc-1'),
      name: 'drill_prepare',
      arguments: validSpecArgs,
      agent,
    })

    // Start second prepare call concurrently on the same session
    const secondCallResult = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-conc-2'),
      name: 'drill_prepare',
      arguments: validSpecArgs,
      agent,
    })

    expect(secondCallResult.isError).toBe(true)
    expect(secondCallResult.error?.message).toBe('Drill generation is already in progress for this session')

    // Release first call
    resolveStream!()
    const firstResult = await firstCallPromise
    expect(firstResult.isError).toBe(false)
  })

  it('supports judging attempts after isolated generation (correct, wrong with derived error, and confirmed-image)', async () => {
    const { ctx, mockLlm } = await setupTestApp()
    const session = ctx.sessions.create(SessionId('drill-judge-after-generation'))
    const agent = createTestAgent(ctx, session)
    setupDrillSession(session)

    mockLlm.streamHandler = () => {
      async function* generate() {
        yield { type: 'text-delta' as const, index: 0, text: JSON.stringify({ question: '计算 3/4 + 1/8', referenceAnswer: '7/8' }) }
        yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      }
      return generate()
    }

    const prepResult = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-prep'),
      name: 'drill_prepare',
      arguments: validSpecArgs,
      agent,
    })
    expect(prepResult.isError).toBe(false)

    // User submits wrong answer
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '4/12' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    // Judge wrong
    const wrongJudgeResult = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-judge-wrong'),
      name: 'drill_judge',
      arguments: { isCorrect: false, feedback: '需要通分到分母 8。' },
      agent,
    })
    expect(wrongJudgeResult.isError).toBe(false)

    const drillStateAfterWrong = ctx.sessionProjections.stateOf(session, 'errgrindDrill') as DrillState
    expect(drillStateAfterWrong.active).toBeNull()
    expect(drillStateAfterWrong.attempts).toHaveLength(1)
    expect(drillStateAfterWrong.attempts[0]?.isCorrect).toBe(false)
    expect(drillStateAfterWrong.attempts[0]?.derivedError?.origin).toBe('drill')
    expect(drillStateAfterWrong.attempts[0]?.derivedError?.userResponse).toBe('4/12')
    expect(drillStateAfterWrong.attempts[0]?.derivedError?.referenceAnswer).toBe('7/8')

    // Now prepare another drill for image answer flow
    const prep2Result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-prep-2'),
      name: 'drill_prepare',
      arguments: validSpecArgs,
      agent,
    })
    expect(prep2Result.isError).toBe(false)

    // User submits image answer
    const imgMsg = session.append('user/message', createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'),
          mediaType: 'image/png', bytes: 3, width: 1, height: 1,
        },
      }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    // Judge before transcription review must fail
    const prematureJudge = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-premature'),
      name: 'drill_judge',
      arguments: { isCorrect: true, feedback: 'Correct.' },
      agent,
    })
    expect(prematureJudge.isError).toBe(true)
    expect(prematureJudge.error?.message).toContain('Review the image answer before judging Drill')

    // Transcribe with drill_answer_draft
    const draftResult = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-draft'),
      name: 'drill_answer_draft',
      arguments: { text: '7/8' },
      agent,
    })
    expect(draftResult.isError).toBe(false)

    // Learner confirms transcription
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '确认' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    // Now judge correctly
    const correctJudgeResult = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('call-judge-correct'),
      name: 'drill_judge',
      arguments: { isCorrect: true, feedback: '解答正确！' },
      agent,
    })
    expect(correctJudgeResult.isError).toBe(false)

    const drillStateFinal = ctx.sessionProjections.stateOf(session, 'errgrindDrill') as DrillState
    expect(drillStateFinal.active).toBeNull()
    expect(drillStateFinal.attempts).toHaveLength(2)
    expect(drillStateFinal.attempts[1]?.isCorrect).toBe(true)
    expect(drillStateFinal.attempts[1]?.imageSourceRef).toBe(`user-event:${imgMsg.seq}`)
  })
})
