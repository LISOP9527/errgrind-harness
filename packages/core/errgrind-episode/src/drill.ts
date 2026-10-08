/** Session-local Drill preparation and judged attempts, kept separate from Error-time evidence. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BlockAssembler, createUserMessage, type GenerateOptions, type LlmCallConfig, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import type { ToolPrompts } from './tool-prompts.ts'

const MAX_TEXT = 4_000

/** Whole-text acceptance of a pending answer draft. */
const DRAFT_ACCEPT = /^(?:确认|confirm)$/i
/** `确认:`/`修正:`/`revise:`-style prefix carrying the corrected answer. */
const DRAFT_REVISE = /^(?:修正|revise)\s*[:：]\s*/i

/**
 * Split one learner reply into the answer-draft fold vocabulary: bare
 * acceptance, a corrected answer after the revise marker, or neither.
 * @param text - trimmed learner message text.
 * @returns the recognized intent, or null when the reply is ordinary content.
 */
function parseDraftReview(text: string): { readonly kind: 'accept' } | { readonly kind: 'revise'; readonly text: string } | null {
  if (DRAFT_ACCEPT.test(text)) return { kind: 'accept' }
  const revise = DRAFT_REVISE.exec(text)
  if (revise === null) return null
  const corrected = text.slice(revise[0].length).trim()
  return corrected.length === 0 ? null : { kind: 'revise', text: corrected }
}

/**
 * Complete private specification of one practice problem: the contract the
 * Judge scores against; withheld from the learner and the browser.
 */
export interface DrillSpec {
  readonly targetMechanism: string
  readonly trigger: string
  readonly failureBehavior: string
  readonly desiredBehavior: string
  readonly successSignal: string
  readonly domain: string
  readonly taskType: 'calculate' | 'simplify' | 'solve' | 'prove' | 'classify' | 'construct' | 'optimize' | 'explain' | 'determine_truth'
  readonly setting: string
  readonly taskGoal: string
  readonly essentialTrigger: string
  readonly solutionStrategy: string
  readonly avoid: string[]
  readonly difficultyLevel: number
  readonly reasoningDepth: number
  readonly calculationLoad: number
}

/** Older stored preparations remain replayable after the isolated Draft migration. */
export interface LegacyDrillSpec {
  readonly targetMechanism: string
  readonly trigger: string
  readonly desiredBehavior: string
  readonly successSignal: string
  readonly novelty: string
  readonly difficulty: number
}

/** Specification staged by `drill_prepare` ahead of the isolated Draft call; replayed until `errgrind/drill-prepared` activates it. */
export interface PendingDrillSpec {
  readonly id: string
  readonly spec: DrillSpec
  readonly sourceRevision: number
  readonly sourceDiagnosisRound: number
  readonly preparedAtTurn: number
}

/** Exact isolated Draft-call input committed before the LLM request starts. */
export interface DrillDraftRequested {
  readonly preparationId: string
  readonly prompt: string
  readonly spec: DrillSpec
  readonly config: LlmCallConfig
}

/** Terminal outcome of one isolated Draft call. */
export type DrillDraftStatus = 'success' | 'failed' | 'aborted'

/** Settlement record of one isolated Draft call; only `success` yields the practice problem. */
export interface DrillDraftFinished {
  readonly preparationId: string
  readonly status: DrillDraftStatus
  readonly usage?: TokenUsage | undefined
}

/** Activated practice problem binding the private spec to the public question, reference answer, and source diagnosis anchor. */
export interface DrillPreparation {
  readonly id: string
  readonly spec: DrillSpec | LegacyDrillSpec
  readonly question: string
  readonly referenceAnswer: string
  readonly sourceRevision: number
  readonly sourceDiagnosisRound: number
  readonly preparedAtTurn: number
  readonly draftProvider?: string | undefined
  readonly draftModel?: string | undefined
  readonly draftUsage?: TokenUsage | undefined
}

/** One persisted learner answer contribution bound to its source message event. */
export interface DrillAnswerSource {
  readonly sourceRef: string
  readonly preparationId: string
  readonly text: string
  readonly imageSourceRef?: string | undefined
}

/** The last image submission is held until the learner reviews a transcription. */
export interface PendingDrillImageInput {
  readonly sourceRef: string
  readonly preparationId: string
}

/** Model-authored answer transcription awaiting an explicit learner response. */
export interface DrillAnswerDraft {
  readonly revision: number
  readonly preparationId: string
  readonly imageSourceRef: string
  readonly text: string
}

/** Snapshot of an Error derived from a wrong Drill attempt; the browser opens it as a new pending-Grill Session. */
export interface DerivedDrillError {
  readonly id: string
  readonly origin: 'drill'
  readonly sourcePreparationId: string
  readonly question: string
  readonly userResponse: string
  readonly referenceAnswer: string
}

/** One judged learner attempt with its source references, verdict, feedback, and the judge that produced it. */
export interface DrillAttempt {
  readonly preparationId: string
  readonly answerSourceRef: string
  readonly imageSourceRef?: string | undefined
  readonly userResponse: string
  readonly isCorrect: boolean
  readonly feedback: string
  readonly judgeProvider: string
  readonly judgeModel: string
  readonly derivedError: DerivedDrillError | null
  readonly judgedAtTurn: number
}

/** Folded Drill projection: active and pending problems, held image input, draft review, answer sources, and attempts. */
export interface DrillState {
  readonly active: DrillPreparation | null
  readonly pendingSpec: PendingDrillSpec | null
  readonly judgeContextPreparationId: string | null
  readonly pendingImageInput: PendingDrillImageInput | null
  readonly pendingAnswerDraft: DrillAnswerDraft | null
  readonly answerSources: DrillAnswerSource[]
  readonly attempts: DrillAttempt[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Private, source-linked and allowlisted specification committed before the isolated Draft call. */
    'errgrind/drill-spec-prepared': PendingDrillSpec
    /** Exact isolated request prompt, spec, and config stored before the draft LLM call starts. */
    'errgrind/drill-draft-requested': DrillDraftRequested
    /** Settlement status and token usage of the isolated draft LLM call. */
    'errgrind/drill-draft-finished': DrillDraftFinished
    /** A private DrillSpec and reference answer with the public practice question and exact source diagnosis anchor. */
    'errgrind/drill-prepared': DrillPreparation
    /** Visible model transcription of an image answer; judgment waits for the learner's review. */
    'errgrind/drill-answer-draft': DrillAnswerDraft
    /** One judged, user-grounded attempt; an incorrect verdict includes its derived Error in this same atomic event. */
    'errgrind/drill-judged': DrillAttempt
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    errgrindDrill: DrillState
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Private answer key copied from the validated independent Draft. */
    'errgrind-drill-context': { kind: 'errgrind-drill-context'; preparationId: string }
    /** Host-copied confirmed Error context for a dedicated Drill Session, never learner-authored. */
    'errgrind-drill-request': { kind: 'errgrind-drill-request'; sourceSessionId: string }
  }
}

const legacySpecSchema = z.object({
  targetMechanism: z.string().min(1),
  trigger: z.string().min(1),
  desiredBehavior: z.string().min(1),
  successSignal: z.string().min(1),
  novelty: z.string().min(1),
  difficulty: z.number().int().min(1).max(5),
}).strict()

const specSchema = z.object({
  targetMechanism: z.string().min(1), trigger: z.string().min(1),
  failureBehavior: z.string().min(1), desiredBehavior: z.string().min(1),
  successSignal: z.string().min(1), domain: z.string().min(1),
  taskType: z.enum(['calculate', 'simplify', 'solve', 'prove', 'classify', 'construct', 'optimize', 'explain', 'determine_truth']),
  setting: z.string().min(1), taskGoal: z.string().min(1),
  essentialTrigger: z.string().min(1), solutionStrategy: z.string().min(1),
  avoid: z.array(z.string().min(1)),
  difficultyLevel: z.number().int().min(1).max(5),
  reasoningDepth: z.number().int().min(1).max(5),
  calculationLoad: z.number().int().min(1).max(5),
}).strict()

const pendingSpecSchema = z.object({
  id: z.string().min(1), spec: specSchema,
  sourceRevision: z.number().int().positive(),
  sourceDiagnosisRound: z.number().int().positive(),
  preparedAtTurn: z.number().int().positive(),
}).strict()

const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
}).strict().transform((usage): TokenUsage => ({
  inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
  ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
  ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
  ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
  ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
}))

const preparationSchema = z.object({
  id: z.string().min(1), spec: z.union([specSchema, legacySpecSchema]),
  question: z.string().min(1), referenceAnswer: z.string().min(1),
  sourceRevision: z.number().int().positive(),
  sourceDiagnosisRound: z.number().int().positive(),
  preparedAtTurn: z.number().int().positive(),
  draftProvider: z.string().min(1).optional(), draftModel: z.string().min(1).optional(),
  draftUsage: usageSchema.optional(),
}).strict()

const derivedSchema = z.object({
  id: z.string().min(1), origin: z.literal('drill'),
  sourcePreparationId: z.string().min(1), question: z.string().min(1),
  userResponse: z.string().min(1), referenceAnswer: z.string().min(1),
}).strict()

const answerSourceSchema = z.object({
  sourceRef: z.string().min(1), preparationId: z.string().min(1), text: z.string().min(1),
  imageSourceRef: z.string().min(1).optional(),
}).strict()

const pendingImageSchema = z.object({ sourceRef: z.string().min(1), preparationId: z.string().min(1) }).strict()
const answerDraftSchema = z.object({
  revision: z.number().int().positive(), preparationId: z.string().min(1),
  imageSourceRef: z.string().min(1), text: z.string().min(1),
}).strict()

const attemptSchema = z.object({
  preparationId: z.string().min(1), answerSourceRef: z.string().min(1),
  imageSourceRef: z.string().min(1).optional(),
  userResponse: z.string().min(1), isCorrect: z.boolean(), feedback: z.string().min(1),
  judgeProvider: z.string().min(1), judgeModel: z.string().min(1),
  derivedError: derivedSchema.nullable(), judgedAtTurn: z.number().int().positive(),
}).strict()

const stateSchema = z.object({
  active: preparationSchema.nullable(),
  pendingSpec: pendingSpecSchema.nullable(),
  judgeContextPreparationId: z.string().nullable(),
  pendingImageInput: pendingImageSchema.nullable(),
  pendingAnswerDraft: answerDraftSchema.nullable(),
  answerSources: z.array(answerSourceSchema),
  attempts: z.array(attemptSchema),
}).strict()

const draftResponseSchema = z.object({
  question: z.string().min(1),
  referenceAnswer: z.string().min(1),
}).strict()

function bounded(value: string, label: string): string {
  const text = value.trim()
  if (text.length === 0 || text.length > MAX_TEXT) throw new Error(`${label} must contain 1–${MAX_TEXT} characters`)
  return text
}

/** Reject distinctive source text before the specification crosses into the isolated Draft request. */
function rejectSourceLeak(spec: DrillSpec, sourceText: string): void {
  const forwarded = JSON.stringify(spec).toLowerCase()
  if (/原题|旧题|历史题|源题|原始题目/u.test(forwarded)) {
    throw new Error('Drill specification must describe the new problem without referring to the original')
  }
  // The target mechanism may legitimately repeat the learner's error words;
  // the planned NEW problem may not carry distinctive source details.
  const newProblem = JSON.stringify({
    domain: spec.domain, taskType: spec.taskType, setting: spec.setting,
    taskGoal: spec.taskGoal, essentialTrigger: spec.essentialTrigger,
    solutionStrategy: spec.solutionStrategy, avoid: spec.avoid,
  }).toLowerCase()
  const source = sourceText.toLowerCase()
  const terms = new Set<string>()
  for (const match of source.matchAll(/[a-z_][a-z0-9_]{11,}/gu)) terms.add(match[0])
  for (const match of source.matchAll(/\d{3,}(?:\.\d+)?/gu)) terms.add(match[0])
  for (const match of source.matchAll(/[\u3400-\u9fff]{10,}/gu)) terms.add(match[0])
  for (const match of source.matchAll(/[a-z0-9_+\-*/^=().°√]{6,}/gu)) {
    if (/[+\-*/^=]/u.test(match[0])) terms.add(match[0])
  }
  for (const generic of ['denominators', 'numerators', 'denominator', 'numerator', 'mathematics']) terms.delete(generic)
  for (const term of terms) {
    if (newProblem.includes(term)) throw new Error('Drill specification contains distinctive text from the original Error')
  }
}

const inFlightSessions = new Set<string>()

/**
 * Advance the Drill projection by one committed event.
 * @param state - projection state before the event.
 * @param event - next committed Session event.
 * @returns the advanced state; unrelated events return the original value.
 */
export function applyDrillEvent(state: DrillState, event: SessionEvent): DrillState {
  switch (event.type) {
    case 'errgrind/drill-spec-prepared': {
      if (state.active !== null || state.pendingSpec !== null) throw new Error('Finish the current Drill before preparing another')
      if (state.attempts.some(attempt => attempt.preparationId === event.data.id)) {
        throw new Error('Drill specification ID already exists')
      }
      return { ...state, pendingSpec: event.data }
    }
    case 'errgrind/drill-draft-requested': {
      if (state.pendingSpec === null || state.pendingSpec.id !== event.data.preparationId) {
        throw new Error('Draft request must reference the pending Drill specification')
      }
      return state
    }
    case 'errgrind/drill-draft-finished': {
      // Attempts rejected before a specification persisted still record their
      // failure marker; with no pending specification any preparationId is a
      // standalone record. Once a specification is staged, the marker must
      // still reference it exactly.
      if (state.pendingSpec !== null && state.pendingSpec.id !== event.data.preparationId) {
        throw new Error('Draft settlement must reference the pending Drill specification')
      }
      return state
    }
    case 'errgrind/drill-prepared': {
      if (state.active !== null) throw new Error('Finish the current Drill before preparing another')
      if (state.attempts.some(attempt => attempt.preparationId === event.data.id)) {
        throw new Error('Drill preparation ID already exists')
      }
      if ('failureBehavior' in event.data.spec) {
        const pending = state.pendingSpec
        if (pending === null || pending.id !== event.data.id
          || JSON.stringify(pending.spec) !== JSON.stringify(event.data.spec)
          || pending.sourceRevision !== event.data.sourceRevision
          || pending.sourceDiagnosisRound !== event.data.sourceDiagnosisRound) {
          throw new Error('Isolated Drill draft must match the persisted specification')
        }
      } else if (state.pendingSpec !== null) {
        throw new Error('Legacy Drill cannot replace a pending isolated specification')
      }
      return { ...state, active: event.data, pendingSpec: null, pendingImageInput: null, pendingAnswerDraft: null }
    }
    case 'user/message': {
      if (event.data.source.kind === 'errgrind-drill-context') {
        return { ...state, judgeContextPreparationId: event.data.source.preparationId }
      }
      if (state.active === null || event.data.source.kind !== 'user') return state
      const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
      const sourceRef = `user-event:${event.seq}`
      if (event.data.content.some(block => block.type === 'image')) {
        return { ...state, pendingImageInput: { sourceRef, preparationId: state.active.id }, pendingAnswerDraft: null }
      }
      const draft = state.pendingAnswerDraft
      if (draft !== null) {
        const review = parseDraftReview(text)
        if (review === null) return state
        return {
          ...state, pendingImageInput: null, pendingAnswerDraft: null,
          answerSources: [...state.answerSources, {
            sourceRef, preparationId: state.active.id,
            text: review.kind === 'accept' ? draft.text : review.text,
            imageSourceRef: draft.imageSourceRef,
          }],
        }
      }
      if (state.pendingImageInput !== null) {
        const review = parseDraftReview(text)
        if (review?.kind !== 'revise') return state
        return { ...state, pendingImageInput: null, answerSources: [...state.answerSources, {
          sourceRef, preparationId: state.active.id, text: review.text,
          imageSourceRef: state.pendingImageInput.sourceRef,
        }] }
      }
      if (text.length === 0 || DRAFT_ACCEPT.test(text)) return state
      return { ...state, pendingImageInput: null, answerSources: [...state.answerSources, {
        sourceRef, preparationId: state.active.id, text,
      }] }
    }
    case 'errgrind/drill-answer-draft': {
      const active = state.active
      const pending = state.pendingImageInput
      if (active === null || pending === null || event.data.preparationId !== active.id
        || event.data.imageSourceRef !== pending.sourceRef) {
        throw new Error('Drill answer draft must reference the pending image answer')
      }
      if (event.data.revision !== (state.pendingAnswerDraft?.revision ?? 0) + 1
        || event.data.text.trim().length === 0) {
        throw new Error('Drill answer draft revision or text is invalid')
      }
      return { ...state, pendingAnswerDraft: event.data }
    }
    case 'errgrind/drill-judged': {
      const active = state.active
      if (active === null || active.id !== event.data.preparationId) throw new Error('No matching active Drill')
      if (state.pendingImageInput !== null) throw new Error('Review the image answer before judging Drill')
      const answer = state.answerSources.find(source => source.sourceRef === event.data.answerSourceRef
        && source.preparationId === active.id)
      if (answer === undefined || answer.text !== event.data.userResponse) {
        throw new Error('Drill judgment must reference the persisted user answer')
      }
      if (answer.imageSourceRef !== event.data.imageSourceRef) {
        throw new Error('Drill judgment must preserve image answer origin')
      }
      if (event.data.feedback.trim().length === 0) throw new Error('Drill feedback cannot be empty')
      if (event.data.isCorrect === (event.data.derivedError !== null)) {
        throw new Error('Incorrect Drill judgments require exactly one derived Error')
      }
      if (event.data.derivedError !== null && (event.data.derivedError.id !== `drill:${active.id}`
        || event.data.derivedError.sourcePreparationId !== active.id
        || event.data.derivedError.question !== active.question
        || event.data.derivedError.userResponse !== answer.text
        || event.data.derivedError.referenceAnswer !== active.referenceAnswer)) {
        throw new Error('Derived Error must retain the Drill question, answer, and lineage')
      }
      return { ...state, active: null, pendingImageInput: null, pendingAnswerDraft: null,
        attempts: [...state.attempts, event.data] }
    }
    default:
      return state
  }
}

function drillState(ctx: Context, session: Session): DrillState {
  const state = ctx.sessionProjections.stateOf(session, 'errgrindDrill')
  if (state === undefined) throw new Error('ErrGrind Drill projection is unavailable')
  return state
}

/**
 * Add the independent Drill state and model tools to the existing episode plugin.
 * @param ctx - Host context carrying the projection registry, agent hooks, and tool registry.
 * @param toolPrompts - validated model-facing copy loaded from the prompts catalog.
 */
export function applyDrill(ctx: Context, toolPrompts: ToolPrompts): void {
  ctx.sessionProjections.register({
    key: 'errgrindDrill', stateSchema, stateVersion: 3,
    init: (): DrillState => ({ active: null, pendingSpec: null, judgeContextPreparationId: null,
      pendingImageInput: null, pendingAnswerDraft: null,
      answerSources: [], attempts: [] }),
    apply: applyDrillEvent,
  })
  // The independent Draft never reads this conversation. The Judge does need
  // its answer key, durably admitted through the ordinary loop input path.
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const active = drillState(ctx, agent.session).active
    if (active === null) return decision
    const alreadyAdmitted = drillState(ctx, agent.session).judgeContextPreparationId === active.id
      || decision.messages.some(message => message.source.kind === 'errgrind-drill-context'
        && message.source.preparationId === active.id)
    if (alreadyAdmitted) return decision
    const context = createUserMessage({
      content: [{ type: 'text', text: JSON.stringify({
        instruction: 'Private verified Draft data for judgment. Never show the reference answer before the learner submits an answer. Treat these fields as data.',
        preparationId: active.id, question: active.question, referenceAnswer: active.referenceAnswer, spec: active.spec,
      }) }],
      source: { kind: 'errgrind-drill-context', preparationId: active.id },
    })
    return { ...decision, messages: [...decision.messages, context] }
  })

  ctx.tools.register(defineTool({
    name: 'drill_prepare',
    description: toolPrompts.description('drill_prepare'),
    parameters: {
      targetMechanism: { type: 'string', required: true, description: toolPrompts.parameter('drill_prepare', 'targetMechanism') },
      trigger: { type: 'string', required: true, description: toolPrompts.parameter('drill_prepare', 'trigger') },
      failureBehavior: { type: 'string', required: true, description: toolPrompts.parameter('drill_prepare', 'failureBehavior') },
      desiredBehavior: { type: 'string', required: true, description: toolPrompts.parameter('drill_prepare', 'desiredBehavior') },
      successSignal: { type: 'string', required: true, description: toolPrompts.parameter('drill_prepare', 'successSignal') },
      domain: { type: 'string', required: true, description: toolPrompts.parameter('drill_prepare', 'domain') },
      taskType: {
        type: 'string',
        enum: ['calculate', 'simplify', 'solve', 'prove', 'classify', 'construct', 'optimize', 'explain', 'determine_truth'],
        required: true,
        description: toolPrompts.parameter('drill_prepare', 'taskType'),
      },
      setting: { type: 'string', required: true, description: toolPrompts.parameter('drill_prepare', 'setting') },
      taskGoal: { type: 'string', required: true, description: toolPrompts.parameter('drill_prepare', 'taskGoal') },
      essentialTrigger: { type: 'string', required: true, description: toolPrompts.parameter('drill_prepare', 'essentialTrigger') },
      solutionStrategy: { type: 'string', required: true, description: toolPrompts.parameter('drill_prepare', 'solutionStrategy') },
      avoid: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: toolPrompts.parameter('drill_prepare', 'avoid'),
      },
      difficultyLevel: { type: 'integer', enum: [1, 2, 3, 4, 5], required: true, description: toolPrompts.parameter('drill_prepare', 'difficultyLevel') },
      reasoningDepth: { type: 'integer', enum: [1, 2, 3, 4, 5], required: true, description: toolPrompts.parameter('drill_prepare', 'reasoningDepth') },
      calculationLoad: { type: 'integer', enum: [1, 2, 3, 4, 5], required: true, description: toolPrompts.parameter('drill_prepare', 'calculationLoad') },
      sourceSessionId: { type: 'string', description: toolPrompts.parameter('drill_prepare', 'sourceSessionId') },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        question: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: value.question }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('drill_prepare requires an agent session')

      const argsRecord = args as Record<string, unknown>
      if ('question' in argsRecord || 'referenceAnswer' in argsRecord) {
        throw new Error('drill_prepare does not accept question or referenceAnswer')
      }
      const allowedKeys = new Set([
        'targetMechanism', 'trigger', 'failureBehavior', 'desiredBehavior', 'successSignal',
        'domain', 'taskType', 'setting', 'taskGoal', 'essentialTrigger', 'solutionStrategy',
        'avoid', 'difficultyLevel', 'reasoningDepth', 'calculationLoad', 'sourceSessionId',
      ])
      for (const key of Object.keys(argsRecord)) {
        if (!allowedKeys.has(key)) {
          throw new Error(`drill_prepare does not accept parameter "${key}"`)
        }
      }

      let episode = ctx.sessionProjections.stateOf(exec.agent.session, 'errgrindEpisode')
      if (episode === undefined || episode === null || episode.origin.kind !== 'drill') {
        throw new Error('drill_prepare only runs inside a dedicated Drill Session')
      }
      // Models send "" or null where the schema says "omit"; treat them as omitted.
      const pickArg = args.sourceSessionId || undefined
      if (episode.drillCandidates.length > 0) {
        // Pool mode: this call's pick becomes the practiced Error for the
        // whole Session; the selection event pins it in the log.
        const candidate = episode.drillCandidates
          .find(entry => entry.sourceSessionId === pickArg)
        if (candidate === undefined) {
          throw new Error('Pick one listed practice candidate: pass its session id as sourceSessionId')
        }
        exec.agent.session.append('errgrind/drill-source-selected', {
          sourceSessionId: candidate.sourceSessionId,
          sourceRevision: candidate.sourceRevision,
          description: candidate.description,
          diagnosisStatus: candidate.diagnosisStatus,
          diagnosisSummary: candidate.diagnosisSummary,
          remainingUncertainty: candidate.remainingUncertainty,
          whatWouldChangeJudgment: candidate.whatWouldChangeJudgment,
        })
        episode = ctx.sessionProjections.stateOf(exec.agent.session, 'errgrindEpisode') ?? episode
      } else if (pickArg !== undefined
        && pickArg !== episode.origin.sourceSessionId) {
        // Once the pick is locked, retries keep resubmitting it; only a
        // different id is a real conflict.
        throw new Error('sourceSessionId must match the locked practice source for this Drill Session')
      }
      if (episode.diagnosis.status === 'active'
        || episode.diagnosis.stale || episode.confirmedRevision === null
        || episode.confirmedRevision !== episode.diagnosis.anchoredRevision) {
        throw new Error('Drill requires a current completed Error diagnosis')
      }

      const state = drillState(ctx, exec.agent.session)
      if (state.active !== null) throw new Error('Finish the current Drill first')

      const agentSession = exec.agent.session
      const sessionId = agentSession.id
      // A duplicate call while generation runs is a rejection, not a failed
      // attempt: it must not mint a failure marker.
      if (inFlightSessions.has(sessionId)) {
        throw new Error('Drill generation is already in progress for this session')
      }
      let pending: PendingDrillSpec | undefined
      let draftSettled = false
      // An attempt rejected past this point still leaves a settlement marker
      // so the browser renders the generation-failure card instead of a
      // silently empty turn. Attempts rejected before their specification
      // persisted mint an unattached marker; the fold admits it only while
      // nothing is pending.
      const settleDraft = (status: DrillDraftStatus, usage?: TokenUsage): void => {
        if (draftSettled) return
        draftSettled = true
        agentSession.append('errgrind/drill-draft-finished', {
          preparationId: pending?.id ?? state.pendingSpec?.id ?? randomUUID(),
          status,
          ...(usage === undefined ? {} : { usage }),
        })
      }

      try {
        if (state.pendingSpec !== null) {
          // A Drill Session's confirmedRevision and diagnosisRound are seeded
          // immutable, so a staged specification can never outlive its anchor.
          pending = state.pendingSpec
        } else {
          if (!Number.isInteger(args.difficultyLevel) || args.difficultyLevel < 1 || args.difficultyLevel > 5) {
            throw new Error('Drill difficultyLevel must be an integer from 1 through 5')
          }
          if (!Number.isInteger(args.reasoningDepth) || args.reasoningDepth < 1 || args.reasoningDepth > 5) {
            throw new Error('Drill reasoningDepth must be an integer from 1 through 5')
          }
          if (!Number.isInteger(args.calculationLoad) || args.calculationLoad < 1 || args.calculationLoad > 5) {
            throw new Error('Drill calculationLoad must be an integer from 1 through 5')
          }
          if (!Array.isArray(args.avoid)) {
            throw new Error('Drill avoid must be an array of strings')
          }
          const spec: DrillSpec = {
            targetMechanism: bounded(args.targetMechanism, 'Target mechanism'),
            trigger: bounded(args.trigger, 'Trigger'),
            failureBehavior: bounded(args.failureBehavior, 'Failure behavior'),
            desiredBehavior: bounded(args.desiredBehavior, 'Desired behavior'),
            successSignal: bounded(args.successSignal, 'Success signal'),
            domain: bounded(args.domain, 'Domain'),
            taskType: args.taskType,
            setting: bounded(args.setting, 'Setting'),
            taskGoal: bounded(args.taskGoal, 'Task goal'),
            essentialTrigger: bounded(args.essentialTrigger, 'Essential trigger'),
            solutionStrategy: bounded(args.solutionStrategy, 'Solution strategy'),
            avoid: args.avoid.map(item => bounded(item, 'Avoid item')),
            difficultyLevel: args.difficultyLevel,
            reasoningDepth: args.reasoningDepth,
            calculationLoad: args.calculationLoad,
          }
          specSchema.parse(spec)
          rejectSourceLeak(spec, `${episode.firstInput}\n${episode.draft?.text ?? ''}`)

          pending = {
            id: randomUUID(),
            spec,
            sourceRevision: episode.confirmedRevision,
            sourceDiagnosisRound: episode.diagnosisRound,
            preparedAtTurn: episode.latestTurn,
          }
          exec.agent.session.append('errgrind/drill-spec-prepared', pending)
        }

        inFlightSessions.add(sessionId)

        let lastFinishKind: string | undefined
        try {
          const llm = ctx.get('llm')
          if (!llm) throw new Error('LLM service is unavailable')

          const headerConfig = exec.agent.session.requestHeader()?.config
          const agentOptions = exec.agent.options
          const selectedProvider = headerConfig?.provider ?? agentOptions.provider
          const selectedModel = headerConfig?.model ?? agentOptions.model
          const selectedReasoningEffort = headerConfig?.reasoningEffort ?? agentOptions.reasoningEffort

          if (!selectedProvider || !selectedModel) {
            throw new Error('No provider or model available for Drill generation')
          }

          const requestedConfig: LlmCallConfig = {
            provider: selectedProvider,
            model: selectedModel,
            ...(selectedReasoningEffort !== undefined ? { reasoningEffort: selectedReasoningEffort } : {}),
          }

          const effectiveConfig = await llm.resolveCallConfig(requestedConfig, exec.signal)

          const systemPrompt = toolPrompts.drillDraftPrompt
          exec.agent.session.append('errgrind/drill-draft-requested', {
            preparationId: pending.id,
            prompt: systemPrompt,
            spec: pending.spec,
            config: effectiveConfig,
          })

          const options: GenerateOptions = {
            provider: effectiveConfig.provider,
            model: effectiveConfig.model,
            ...(effectiveConfig.reasoningEffort !== undefined ? { reasoningEffort: effectiveConfig.reasoningEffort } : {}),
            ...(effectiveConfig.temperature !== undefined ? { temperature: effectiveConfig.temperature } : {}),
            ...(effectiveConfig.maxTokens !== undefined ? { maxTokens: effectiveConfig.maxTokens } : {}),
            ...(effectiveConfig.stop !== undefined ? { stop: effectiveConfig.stop } : {}),
            system: systemPrompt,
            messages: [
              Object.freeze({
                role: 'user' as const,
                content: Object.freeze([{ type: 'text' as const, text: JSON.stringify(pending.spec) }]),
              }),
            ],
            signal: exec.signal,
          }

          const assembler = new BlockAssembler()
          let hasFinishChunk = false
          let draftStatus: DrillDraftStatus = 'failed'
          let parsedQuestion: string | undefined
          let parsedReferenceAnswer: string | undefined

          try {
            for await (const chunk of llm.stream(options)) {
              if (chunk.type === 'finish') {
                hasFinishChunk = true
              }
              assembler.push(chunk)
            }

            lastFinishKind = assembler.finish.kind

            if (exec.signal.aborted) {
              draftStatus = 'aborted'
              throw new Error('Aborted')
            }

            if (!hasFinishChunk) {
              draftStatus = 'failed'
              throw new Error('Absent finish chunk')
            }

            if (assembler.finish.kind === 'aborted') {
              draftStatus = 'aborted'
              throw new Error('Stream aborted')
            }

            if (assembler.finish.kind !== 'stop') {
              draftStatus = 'failed'
              throw new Error(`Invalid finish reason: ${assembler.finish.kind}`)
            }

            const blocks = assembler.blocks()
            if (blocks.some(b => b.type === 'tool-call')) {
              draftStatus = 'failed'
              throw new Error('Model produced tool calls')
            }

            const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('').trim()
            if (text.length === 0) {
              draftStatus = 'failed'
              throw new Error('Empty model output')
            }

            let rawJson: unknown
            try {
              rawJson = JSON.parse(text)
            } catch {
              draftStatus = 'failed'
              throw new Error('Malformed JSON output')
            }

            const parsedResult = draftResponseSchema.safeParse(rawJson)
            if (!parsedResult.success) {
              draftStatus = 'failed'
              throw new Error('Output does not match required schema')
            }

            parsedQuestion = bounded(parsedResult.data.question, 'Drill question')
            parsedReferenceAnswer = bounded(parsedResult.data.referenceAnswer, 'Reference answer')
            draftStatus = 'success'
          } catch (err) {
            if (exec.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
              draftStatus = 'aborted'
            }
            throw err
          } finally {
            settleDraft(draftStatus, assembler.usage)
          }

          exec.signal.throwIfAborted()

          const currentEpisodeState = ctx.sessionProjections.stateOf(exec.agent.session, 'errgrindEpisode')
          if (currentEpisodeState === undefined || currentEpisodeState === null
            || currentEpisodeState.diagnosis.status === 'active'
            || currentEpisodeState.diagnosis.stale
            || currentEpisodeState.confirmedRevision === null
            || currentEpisodeState.confirmedRevision !== pending.sourceRevision
            || currentEpisodeState.diagnosisRound !== pending.sourceDiagnosisRound) {
            throw new Error('诊断锚点已变更，练习题生成终止。练习规格已保留。')
          }

          const prepared: DrillPreparation = {
            id: pending.id,
            spec: pending.spec,
            question: parsedQuestion,
            referenceAnswer: parsedReferenceAnswer,
            sourceRevision: pending.sourceRevision,
            sourceDiagnosisRound: pending.sourceDiagnosisRound,
            preparedAtTurn: currentEpisodeState.latestTurn,
            draftProvider: effectiveConfig.provider,
            draftModel: effectiveConfig.model,
            ...(assembler.usage !== undefined ? { draftUsage: assembler.usage } : {}),
          }
          exec.agent.session.append('errgrind/drill-prepared', prepared)

          return { question: parsedQuestion }
        } catch (err) {
          if (lastFinishKind === 'aborted' || exec.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
            throw new Error('练习题生成已取消。练习规格已保留，可再次调用 drill_prepare 恢复生成。')
          }
          if (err instanceof Error && err.message.startsWith('诊断锚点已变更')) {
            throw err
          }
          if (lastFinishKind === 'max-tokens' || (err instanceof Error && err.message.includes('截断'))) {
            throw new Error('练习题生成因长度超限截断失败。练习规格已保留，请再次调用 drill_prepare 重试。')
          }
          throw new Error('练习题生成失败，练习规格已保留。请再次调用 drill_prepare 重试。')
        } finally {
          inFlightSessions.delete(sessionId)
        }
      } catch (err) {
        settleDraft(exec.signal.aborted ? 'aborted' : 'failed')
        throw err
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Drill Question', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'drill_answer_draft',
    description: toolPrompts.description('drill_answer_draft'),
    parameters: {
      text: { type: 'string', required: true, description: toolPrompts.parameter('drill_answer_draft', 'text') },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        revision: { type: 'integer', required: true }, text: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: `Drill answer draft #${value.revision}: ${value.text}` }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('drill_answer_draft requires an agent session')
      const state = drillState(ctx, exec.agent.session)
      const pending = state.pendingImageInput
      if (state.active === null || pending === null) throw new Error('No image answer awaits review')
      const text = bounded(args.text, 'Drill answer draft')
      const revision = (state.pendingAnswerDraft?.revision ?? 0) + 1
      exec.agent.session.append('errgrind/drill-answer-draft', {
        revision, preparationId: state.active.id, imageSourceRef: pending.sourceRef, text,
      })
      return Promise.resolve({ revision, text })
    },
    presentCall: args => ({ card: 'generic', title: 'Review Image Answer', kind: 'other', rawInput: args.text }),
  }))

  ctx.tools.register(defineTool({
    name: 'drill_judge',
    description: toolPrompts.description('drill_judge'),
    parameters: {
      isCorrect: { type: 'boolean', required: true, description: toolPrompts.parameter('drill_judge', 'isCorrect') },
      feedback: { type: 'string', required: true, description: toolPrompts.parameter('drill_judge', 'feedback') },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        isCorrect: { type: 'boolean', required: true }, feedback: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: value.isCorrect ? 'verdict: correct' : 'verdict: incorrect' }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('drill_judge requires an agent session')
      const state = drillState(ctx, exec.agent.session)
      const active = state.active
      if (active === null) throw new Error('No active Drill question')
      if (state.pendingImageInput !== null) throw new Error('Review the image answer before judging Drill')
      const answer = state.answerSources.findLast(source => source.preparationId === active.id)
      if (answer === undefined) throw new Error('Wait for the learner answer before judging Drill')
      const feedback = bounded(args.feedback, 'Drill feedback')
      const requestConfig = exec.agent.session.requestHeader()?.config
      const attempt: DrillAttempt = {
        preparationId: active.id, answerSourceRef: answer.sourceRef,
        ...(answer.imageSourceRef !== undefined ? { imageSourceRef: answer.imageSourceRef } : {}),
        userResponse: answer.text, isCorrect: args.isCorrect, feedback,
        judgeProvider: requestConfig?.provider ?? 'unknown',
        judgeModel: requestConfig?.model ?? 'unknown',
        derivedError: args.isCorrect ? null : {
          id: `drill:${active.id}`, origin: 'drill', sourcePreparationId: active.id,
          question: active.question, userResponse: answer.text,
          referenceAnswer: active.referenceAnswer,
        },
        judgedAtTurn: ctx.sessionProjections.stateOf(exec.agent.session, 'errgrindEpisode')?.latestTurn ?? active.preparedAtTurn,
      }
      exec.agent.session.append('errgrind/drill-judged', attempt)
      return Promise.resolve({ isCorrect: args.isCorrect, feedback })
    },
    presentCall: () => ({ card: 'generic', title: 'Drill Judgment', kind: 'other' }),
  }))
}
