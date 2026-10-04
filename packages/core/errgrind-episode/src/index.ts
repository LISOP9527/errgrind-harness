/** Session-backed authentic Error intake, draft revisions, human confirmation, and Grill diagnosis. */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  DiagnosticEvidence,
  DiagnosticProbe,
  DiagnosticLedger,
  ErrorAttachment,
  ErrorEpisode,
  ErrorListEntry,
  Hypothesis,
  HypothesisStatus,
  InputOrigin,
  PendingDiagnosisConclusion,
} from './types.ts'
import { applyDrill } from './drill.ts'
import { loadToolPrompts } from './tool-prompts.ts'

export type * from './types.ts'
export type * from './drill.ts'

export const name = 'errgrind-episode'
export const inject = ['sessionProjections', 'tools', 'commands']

/** Product-specific command visibility. */
export interface Config {
  /** Register the diagnostic ledger inspection command; enabled for core and disabled in browser products. */
  readonly statusCommand?: boolean
}

/** Loader-validated ErrGrind plugin configuration. */
export const Config: z<Config> = z.object({ statusCommand: z.boolean().default(true) })

const errorListEntrySchema: ZodType<ErrorListEntry | null> = zod.object({
  description: zod.string().nullable(),
  status: zod.enum(['grill', 'confirm', 'teach']),
  drillEligible: zod.boolean(),
}).strict().nullable()

/** Expose only the learner-facing Error description and coarse workflow state. */
export function publicErrorListEntry(episode: ErrorEpisode | null): ErrorListEntry | null {
  if (episode === null) return null
  const drillEligible = episode.diagnosis.status !== 'active'
    && !episode.diagnosis.stale
    && episode.confirmedRevision !== null
    && episode.confirmedRevision === episode.diagnosis.anchoredRevision
  const status = drillEligible ? 'teach' : episode.pendingConclusion !== null ? 'confirm' : 'grill'
  const description = episode.draft?.text === undefined
    ? null
    : Array.from(episode.draft.text).slice(0, 300).join('')
  return { description, status, drillEligible }
}

const MAX_DESCRIPTION_CHARS = 12_000
const MAX_CLARIFICATION_CHARS = 4_000
const MAX_TEACH_STEP_CHARS = 4_000
const HYPOTHESIS_ID_PATTERN = /^H[1-9][0-9]*$/
const PROBE_ID_PATTERN = /^P[1-9][0-9]*$/
const EVIDENCE_ID_PATTERN = /^E[1-9][0-9]*$/

const hypothesisSchema = zod.object({
  id: zod.string().regex(HYPOTHESIS_ID_PATTERN),
  claim: zod.string().min(1),
  status: zod.enum(['plausible', 'supported', 'weakened', 'rejected']),
}).strict()

const probePredictionSchema = zod.object({
  hypothesisId: zod.string().regex(HYPOTHESIS_ID_PATTERN),
  expectedObservation: zod.string().min(1),
}).strict()

const diagnosticProbeSchema = zod.object({
  id: zod.string().regex(PROBE_ID_PATTERN),
  type: zod.enum(['reasoning_question', 'variant_problem']),
  question: zod.string().min(1),
  targetHypothesisIds: zod.array(zod.string().regex(HYPOTHESIS_ID_PATTERN)).min(1),
  discriminationGoal: zod.string().min(1),
  predictions: zod.array(probePredictionSchema).min(1),
  answerKey: zod.string().optional(),
  preservedMechanism: zod.string().optional(),
  surfaceChange: zod.string().optional(),
}).strict()

const diagnosticEvidenceSchema = zod.object({
  id: zod.string().regex(EVIDENCE_ID_PATTERN),
  sourceRef: zod.string().min(1),
  quote: zod.string().optional(),
  interpretation: zod.string().min(1),
  supports: zod.array(zod.string().regex(HYPOTHESIS_ID_PATTERN)),
  contradicts: zod.array(zod.string().regex(HYPOTHESIS_ID_PATTERN)),
  probeId: zod.string().regex(PROBE_ID_PATTERN).optional(),
}).strict()

const diagnosticLedgerSchema = zod.object({
  status: zod.enum(['active', 'supported', 'undetermined']),
  hypotheses: zod.array(hypothesisSchema),
  probes: zod.array(diagnosticProbeSchema),
  evidence: zod.array(diagnosticEvidenceSchema),
  currentProbeId: zod.string().nullable(),
  bestHypothesisId: zod.string().nullable(),
  remainingUncertainty: zod.string(),
  whatWouldChangeJudgment: zod.string(),
  summary: zod.string().nullable(),
  concludedAtTurn: zod.number().int().positive().nullable(),
  anchoredRevision: zod.number().int().positive().nullable(),
  stale: zod.boolean(),
}).strict()

const pendingConclusionSchema = zod.object({
  status: zod.enum(['supported', 'undetermined']),
  summary: zod.string().min(1),
  bestHypothesisId: zod.string().nullable(),
  remainingUncertainty: zod.string(),
  whatWouldChangeJudgment: zod.string(),
  turn: zod.number().int().positive(),
  anchorRevision: zod.number().int().positive(),
}).strict()

const attachmentSchema = zod.object({
  sha256: zod.string(),
  mediaType: zod.string(),
  bytes: zod.number().int().nonnegative(),
  name: zod.string().optional(),
  originalFileRef: zod.any().optional(),
  normalizedImageRef: zod.any().optional(),
}).strict()

const originSchema = zod.object({
  kind: zod.enum(['direct_user', 'host_relay', 'derived_drill']),
  rpcId: zod.string().optional(),
  clientTimeZone: zod.string().optional(),
  senderSessionId: zod.string().optional(),
  sourceSessionId: zod.string().optional(),
  sourcePreparationId: zod.string().optional(),
  sourceAnswerRef: zod.string().optional(),
}).strict()

const episodeSchema: ZodType<ErrorEpisode | null> = zod.union([
  zod.object({
    firstInput: zod.string(),
    firstInputHasImage: zod.boolean(),
    firstInputTurn: zod.number().int().positive(),
    latestTurn: zod.number().int().positive(),
    origin: originSchema,
    attachments: zod.array(attachmentSchema),
    draft: zod.object({ revision: zod.number().int().positive(), text: zod.string().min(1) }).nullable(),
    confirmedRevision: zod.number().int().positive().nullable(),
    diagnosisRound: zod.number().int().positive(),
    diagnosisHistory: zod.array(diagnosticLedgerSchema),
    evidenceSources: zod.array(zod.object({
      sourceRef: zod.string(), text: zod.string(), probeId: zod.string().nullable(),
      diagnosisRound: zod.number().int().positive(),
    }).strict()),
    diagnosis: diagnosticLedgerSchema,
    pendingConclusion: pendingConclusionSchema.nullable(),
    derivedContextConsumed: zod.boolean(),
    teachStartedAtTurn: zod.number().int().positive().nullable(),
    drillStartedAtTurn: zod.number().int().positive().nullable(),
    pendingClarification: zod.boolean(),
  }).strict(),
  zod.null(),
])

/**
 * Create the empty diagnostic ledger for one Error investigation.
 * @returns A new active ledger without hypotheses, probes, or evidence.
 */
export function initialDiagnosticLedger(): DiagnosticLedger {
  return {
    status: 'active',
    hypotheses: [],
    probes: [],
    evidence: [],
    currentProbeId: null,
    bestHypothesisId: null,
    remainingUncertainty: '',
    whatWouldChangeJudgment: '',
    summary: null,
    concludedAtTurn: null,
    anchoredRevision: null,
    stale: false,
  }
}

/** Commit a validated proposal when the learner confirms its exact Error description revision. */
function completeDiagnosis(ledger: DiagnosticLedger, proposal: PendingDiagnosisConclusion): DiagnosticLedger {
  return {
    ...ledger,
    status: proposal.status,
    currentProbeId: null,
    bestHypothesisId: proposal.bestHypothesisId,
    remainingUncertainty: proposal.remainingUncertainty,
    whatWouldChangeJudgment: proposal.whatWouldChangeJudgment,
    summary: proposal.summary,
    concludedAtTurn: proposal.turn,
    anchoredRevision: proposal.anchorRevision,
    stale: false,
  }
}

function mergeHypotheses(
  current: readonly Hypothesis[],
  newHypotheses: readonly Hypothesis[] | undefined,
  statusUpdates: readonly { id: string; status: HypothesisStatus }[] | undefined,
): Hypothesis[] {
  const map = new Map<string, Hypothesis>()
  for (const h of current) map.set(h.id, h)

  if (newHypotheses) {
    for (const h of newHypotheses) {
      if (!HYPOTHESIS_ID_PATTERN.test(h.id)) {
        throw new Error(`Hypothesis ID ${h.id} is invalid; must match H1, H2...`)
      }
      if (map.has(h.id)) {
        throw new Error(`Hypothesis ID ${h.id} already exists`)
      }
      if (h.claim.trim().length === 0) {
        throw new Error(`Hypothesis ${h.id} claim cannot be empty`)
      }
      map.set(h.id, { id: h.id, claim: h.claim, status: h.status })
    }
  }

  if (statusUpdates) {
    for (const update of statusUpdates) {
      const existing = map.get(update.id)
      if (existing === undefined) {
        throw new Error(`Hypothesis ${update.id} does not exist for status update`)
      }
      map.set(update.id, { ...existing, status: update.status })
    }
  }

  return Array.from(map.values())
}

function mergeEvidence(
  current: readonly DiagnosticEvidence[],
  newEvidence: readonly DiagnosticEvidence[] | undefined,
  hypotheses: readonly Hypothesis[],
  probes: readonly DiagnosticProbe[],
  sources: ErrorEpisode['evidenceSources'],
  diagnosisRound: number,
): DiagnosticEvidence[] {
  const ids = new Set(current.map(e => e.id))
  const hypIds = new Set(hypotheses.map(h => h.id))
  const probeIds = new Set(probes.map(p => p.id))
  const result = [...current]

  if (newEvidence) {
    for (const e of newEvidence) {
      if (!EVIDENCE_ID_PATTERN.test(e.id)) {
        throw new Error(`Evidence ID ${e.id} is invalid; must match E1, E2...`)
      }
      if (ids.has(e.id)) {
        throw new Error(`Evidence ID ${e.id} already exists`)
      }
      if (e.sourceRef.trim().length === 0) {
        throw new Error(`Evidence ${e.id} sourceRef cannot be empty`)
      }
      if (e.interpretation.trim().length === 0) {
        throw new Error(`Evidence ${e.id} interpretation cannot be empty`)
      }
      if (e.probeId && !probeIds.has(e.probeId)) {
        throw new Error(`Evidence ${e.id} probeId ${e.probeId} does not exist`)
      }
      for (const hId of e.supports) {
        if (!hypIds.has(hId)) throw new Error(`Evidence ${e.id} supports unknown hypothesis ${hId}`)
      }
      for (const hId of e.contradicts) {
        if (!hypIds.has(hId)) throw new Error(`Evidence ${e.id} contradicts unknown hypothesis ${hId}`)
      }
      const source = sources.find(item => item.sourceRef === e.sourceRef)
      if (source === undefined) throw new Error(`Evidence ${e.id} must reference recorded input`)
      const isAttachment = source.sourceRef.includes('attachment:')
      if (source.probeId === null) {
        if (e.probeId !== undefined && e.probeId.length > 0) {
          throw new Error(source.sourceRef.startsWith('initial-')
            ? `Initial Evidence ${e.id} cannot claim a probe answer`
            : `Evidence ${e.id} cannot claim a probe answer for a non-probe source`)
        }
        if (isAttachment) {
          if (e.quote !== '') throw new Error(`Attachment Evidence ${e.id} must use an empty quote`)
        } else if (e.quote === undefined || e.quote.trim().length === 0 || !source.text.includes(e.quote)) {
          throw new Error(source.sourceRef.startsWith('initial-')
            ? `Initial Evidence ${e.id} quote must match the recorded text`
            : `Evidence ${e.id} quote must match the recorded text`)
        }
      } else {
        if (source.diagnosisRound !== diagnosisRound || source.probeId !== e.probeId) {
          throw new Error(`Evidence ${e.id} must reference an actual user answer to its probe`)
        }
        if (isAttachment) {
          if (e.quote !== '') throw new Error(`Attachment Evidence ${e.id} must use an empty quote`)
        } else if (e.quote === undefined || e.quote.trim().length === 0 || !source.text.includes(e.quote)) {
          throw new Error(`Evidence ${e.id} quote must match the referenced user answer`)
        }
      }
      ids.add(e.id)
      result.push(e)
    }
  }

  return result
}

function extractUserEventSeq(sourceRef: string): number {
  const match = sourceRef.match(/^user-event:(\d+)/)
  return match ? Number(match[1]) : 0
}

/** Resolve model-friendly aliases to exact durable references before logging. */
function resolveEvidenceAliases(
  evidence: readonly DiagnosticEvidence[] | undefined,
  sources: ErrorEpisode['evidenceSources'],
  diagnosisRound: number,
): DiagnosticEvidence[] | undefined {
  if (!evidence) return undefined

  return evidence.map((item) => {
    const ref = item.sourceRef

    if (ref === 'derived-answer') {
      const exists = sources.some(s => s.sourceRef === 'derived-answer')
      if (!exists) throw new Error('No persisted source is available for derived-answer')
      return item
    }

    if (ref === 'latest-probe-answer') {
      const probeSources = sources.filter(
        s => s.probeId !== null && s.diagnosisRound === diagnosisRound && s.sourceRef.startsWith('user-event:'),
      )
      if (probeSources.length === 0) {
        throw new Error('No persisted probe answer is available for latest-probe-answer')
      }
      const maxSeq = Math.max(...probeSources.map(s => extractUserEventSeq(s.sourceRef)))
      const latestSources = probeSources.filter(s => extractUserEventSeq(s.sourceRef) === maxSeq)
      const textSource = latestSources.find(s => !s.sourceRef.includes(':attachment:'))
      const resolved = textSource ?? latestSources.find(s => s.sourceRef.includes(':attachment:'))
      if (!resolved) {
        throw new Error('No persisted probe answer is available for latest-probe-answer')
      }
      return { ...item, sourceRef: resolved.sourceRef }
    }

    const probeAttMatch = ref.match(/^latest-probe-attachment:([1-9][0-9]*)$/)
    if (probeAttMatch) {
      const n = probeAttMatch[1]
      const probeSources = sources.filter(
        s => s.probeId !== null && s.diagnosisRound === diagnosisRound && s.sourceRef.startsWith('user-event:'),
      )
      if (probeSources.length === 0) {
        throw new Error(`No persisted probe answer is available for ${ref}`)
      }
      const maxSeq = Math.max(...probeSources.map(s => extractUserEventSeq(s.sourceRef)))
      const targetRef = `user-event:${maxSeq}:attachment:${n}`
      const attSource = probeSources.find(s => s.sourceRef === targetRef)
      if (!attSource) {
        throw new Error(`No persisted probe attachment ${n} is available for ${ref}`)
      }
      return { ...item, sourceRef: targetRef }
    }

    if (ref === 'latest-clarification-answer') {
      const clarSources = sources.filter(
        s => s.probeId === null && s.diagnosisRound === diagnosisRound && s.sourceRef.startsWith('user-event:'),
      )
      if (clarSources.length === 0) {
        throw new Error('No persisted clarification answer is available for latest-clarification-answer')
      }
      const maxSeq = Math.max(...clarSources.map(s => extractUserEventSeq(s.sourceRef)))
      const latestSources = clarSources.filter(s => extractUserEventSeq(s.sourceRef) === maxSeq)
      const textSource = latestSources.find(s => !s.sourceRef.includes(':attachment:'))
      const resolved = textSource ?? latestSources.find(s => s.sourceRef.includes(':attachment:'))
      if (!resolved) {
        throw new Error('No persisted clarification answer is available for latest-clarification-answer')
      }
      return { ...item, sourceRef: resolved.sourceRef }
    }

    const clarAttMatch = ref.match(/^latest-clarification-attachment:([1-9][0-9]*)$/)
    if (clarAttMatch) {
      const n = clarAttMatch[1]
      const clarSources = sources.filter(
        s => s.probeId === null && s.diagnosisRound === diagnosisRound && s.sourceRef.startsWith('user-event:'),
      )
      if (clarSources.length === 0) {
        throw new Error(`No persisted clarification answer is available for ${ref}`)
      }
      const maxSeq = Math.max(...clarSources.map(s => extractUserEventSeq(s.sourceRef)))
      const targetRef = `user-event:${maxSeq}:attachment:${n}`
      const attSource = clarSources.find(s => s.sourceRef === targetRef)
      if (!attSource) {
        throw new Error(`No persisted clarification attachment ${n} is available for ${ref}`)
      }
      return { ...item, sourceRef: targetRef }
    }

    return item
  })
}

function assertLatestProbeReplyObserved(
  sources: ErrorEpisode['evidenceSources'],
  diagnosisEvidence: readonly DiagnosticEvidence[],
  newEvidence: readonly DiagnosticEvidence[] | undefined,
  diagnosisRound: number,
  isReopening: boolean,
): void {
  if (isReopening) return

  const roundProbeSources = sources.filter(
    s => s.probeId !== null && s.diagnosisRound === diagnosisRound && s.sourceRef.startsWith('user-event:'),
  )
  if (roundProbeSources.length === 0) return

  const maxSeq = Math.max(...roundProbeSources.map(s => extractUserEventSeq(s.sourceRef)))
  if (maxSeq === 0) return

  const latestReplySources = roundProbeSources.filter(s => extractUserEventSeq(s.sourceRef) === maxSeq)
  if (latestReplySources.length === 0) return

  const alreadyRepresented = latestReplySources.some(
    latest => diagnosisEvidence.some(e => e.sourceRef === latest.sourceRef),
  )
  if (alreadyRepresented) return

  const observedInNew = newEvidence?.some(
    e => latestReplySources.some(latest => latest.sourceRef === e.sourceRef),
  )
  if (!observedInNew) {
    throw new Error('Latest probe reply must be observed in evidence before continuing diagnosis')
  }
}

function validateProbe(probe: DiagnosticProbe, probes: readonly DiagnosticProbe[], hypotheses: readonly Hypothesis[]): void {
  if (!PROBE_ID_PATTERN.test(probe.id)) {
    throw new Error(`Probe ID ${probe.id} is invalid; must match P1, P2...`)
  }
  if (probes.some(p => p.id === probe.id)) {
    throw new Error(`Probe ID ${probe.id} already exists`)
  }
  if (probe.question.trim().length === 0) {
    throw new Error('Probe question cannot be empty')
  }
  if (probe.discriminationGoal.trim().length === 0) {
    throw new Error('Probe discriminationGoal cannot be empty')
  }
  const hypIds = new Set(hypotheses.map(h => h.id))
  if (probe.targetHypothesisIds.length === 0) {
    throw new Error('Probe targetHypothesisIds cannot be empty')
  }
  const targetIds = new Set(probe.targetHypothesisIds)
  if (targetIds.size !== probe.targetHypothesisIds.length) {
    throw new Error('Probe targetHypothesisIds contains duplicates')
  }
  for (const hId of probe.targetHypothesisIds) {
    if (!hypIds.has(hId)) throw new Error(`Probe target hypothesis ${hId} does not exist`)
  }
  if (probe.predictions.length === 0) {
    throw new Error('Probe predictions cannot be empty')
  }
  const predictedIds = new Set<string>()
  for (const pred of probe.predictions) {
    if (!hypIds.has(pred.hypothesisId)) {
      throw new Error(`Probe prediction references unknown hypothesis ${pred.hypothesisId}`)
    }
    if (!targetIds.has(pred.hypothesisId)) {
      throw new Error(`Probe prediction ${pred.hypothesisId} is not among the target hypotheses`)
    }
    if (predictedIds.has(pred.hypothesisId)) {
      throw new Error(`Probe prediction duplicates hypothesis ${pred.hypothesisId}`)
    }
    predictedIds.add(pred.hypothesisId)
    if (pred.expectedObservation.trim().length === 0) {
      throw new Error('Probe prediction expectedObservation cannot be empty')
    }
  }
  for (const hId of probe.targetHypothesisIds) {
    if (!predictedIds.has(hId)) {
      throw new Error(`Probe is missing a prediction for target hypothesis ${hId}`)
    }
  }
}

/**
 * Read the input source written under the retired durable field name by logs saved before the rename.
 * The concrete-terms note permits reconstructing the retired key at runtime; the literal token stays out of source.
 * @param data - The raw event payload, which may still carry the retired key when folding older logs.
 * @returns The recorded input source, or undefined when the payload carries none or an invalid one.
 */
function readRetiredInputOrigin(data: unknown): InputOrigin | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const retired = (data as Record<string, unknown>)['prove' + 'nance']
  const parsed = originSchema.safeParse(retired)
  return parsed.success ? parsed.data : undefined
}

/**
 * Fold Error events and user answers into one durable episode projection.
 * @param state - Episode state before this committed Session event.
 * @param event - Event to fold, including user answers used as evidence sources.
 * @returns Updated episode, or the same state for an unrelated event.
 */
export function applyEpisodeEvent(state: ErrorEpisode | null, event: SessionEvent): ErrorEpisode | null {
  switch (event.type) {
    case 'errgrind/error-open': {
      if (state !== null) throw new Error('Error episode already open')
      const text = event.data.text
      const attachments = event.data.attachments ?? []
      const hasImage = event.data.hasImage ?? attachments.some(a => a.mediaType.startsWith('image/'))
      if (text.length === 0 && !hasImage && attachments.length === 0) throw new Error('Error input is empty')
      const origin: InputOrigin = event.data.origin ?? readRetiredInputOrigin(event.data) ?? { kind: 'direct_user' }
      const prefix = origin.kind === 'host_relay' ? 'host-relay' : 'initial'
      const evidenceSources: ErrorEpisode['evidenceSources'] = [
        ...(text.trim().length > 0 ? [{ sourceRef: `${prefix}-input`, text, probeId: null, diagnosisRound: 1 }] : []),
        ...attachments.map((_, index) => ({
          sourceRef: `${prefix}-attachment:${index + 1}`, text: '', probeId: null, diagnosisRound: 1,
        })),
      ]
      return {
        firstInput: text,
        firstInputHasImage: hasImage,
        firstInputTurn: event.data.turn,
        latestTurn: event.data.turn,
        origin,
        attachments,
        draft: null,
        confirmedRevision: null,
        diagnosisRound: 1,
        diagnosisHistory: [],
        evidenceSources,
        diagnosis: initialDiagnosticLedger(),
        pendingConclusion: null,
        derivedContextConsumed: false,
        teachStartedAtTurn: null,
        drillStartedAtTurn: null,
        pendingClarification: false,
      }
    }
    case 'errgrind/derived-error-open': {
      if (state !== null) throw new Error('Error episode already open')
      const data = event.data
      if (!data.text.includes(data.question) || !data.text.includes(data.userResponse)
        || !data.sourceSessionId || !data.sourcePreparationId || !data.sourceAnswerRef
        || !data.referenceAnswer.trim()) {
        throw new Error('Derived Error must retain its Drill source and original answer')
      }
      return {
        firstInput: data.text,
        firstInputHasImage: false,
        firstInputTurn: 1,
        latestTurn: 1,
        origin: {
          kind: 'derived_drill', sourceSessionId: data.sourceSessionId,
          sourcePreparationId: data.sourcePreparationId, sourceAnswerRef: data.sourceAnswerRef,
        },
        attachments: [], draft: null, confirmedRevision: null,
        diagnosisRound: 1, diagnosisHistory: [],
        evidenceSources: [
          { sourceRef: 'derived-answer', text: data.userResponse, probeId: null, diagnosisRound: 1 },
        ],
        diagnosis: initialDiagnosticLedger(), pendingConclusion: null,
        derivedContextConsumed: false,
        teachStartedAtTurn: null,
        drillStartedAtTurn: null,
        pendingClarification: false,
      }
    }
    case 'errgrind/error-draft': {
      if (state === null) throw new Error('Error episode is not open')
      if (state.teachStartedAtTurn !== null) {
        throw new Error('The original Error description is locked after Teach begins; open a new Error for later observations')
      }
      if (state.drillStartedAtTurn !== null) {
        throw new Error('The original Error description is locked after Drill begins; open a new Error for later observations')
      }
      if (event.data.revision !== (state.draft?.revision ?? 0) + 1 || event.data.text.trim().length === 0) {
        throw new Error('Error description revision is invalid')
      }
      const stale = state.diagnosis.status !== 'active'
        && state.diagnosis.anchoredRevision !== null
        && state.diagnosis.anchoredRevision !== event.data.revision
      return {
        ...state,
        draft: { revision: event.data.revision, text: event.data.text },
        confirmedRevision: null,
        pendingConclusion: null,
        diagnosis: stale ? { ...state.diagnosis, stale: true } : state.diagnosis,
      }
    }
    case 'errgrind/error-clarify': {
      if (state === null) return null
      return {
        ...state,
        pendingClarification: true,
        pendingConclusion: null,
        diagnosis: {
          ...state.diagnosis,
          currentProbeId: null,
        },
      }
    }
    case 'errgrind/error-confirm': {
      if (state?.draft == null || state.draft.revision !== event.data.revision) {
        throw new Error('Error description revision is not current')
      }
      if (state.confirmedRevision === event.data.revision) throw new Error('Error description already confirmed')
      const proposal = state.pendingConclusion
      if (proposal !== null && proposal.anchorRevision !== event.data.revision) {
        throw new Error('Pending diagnosis does not match this Error description revision')
      }
      const stale = state.diagnosis.status !== 'active'
        && state.diagnosis.anchoredRevision !== null
        && state.diagnosis.anchoredRevision !== event.data.revision
      return {
        ...state,
        confirmedRevision: event.data.revision,
        pendingConclusion: null,
        // Older fork sessions confirmed the draft before the model conclusion.
        diagnosis: proposal === null
          ? { ...state.diagnosis, stale }
          : completeDiagnosis(state.diagnosis, proposal),
      }
    }
    case 'errgrind/grill-probe': {
      if (state === null) throw new Error('Error episode is not open')
      if (state.teachStartedAtTurn !== null || state.drillStartedAtTurn !== null) {
        throw new Error('Cannot add probe after intervention has begun')
      }
      if (event.data.anchorRevision !== undefined
        && event.data.anchorRevision !== state.draft?.revision) {
        throw new Error('Grill probe must use the current Error description')
      }
      if (state.diagnosis.status !== 'active' && !state.diagnosis.stale) throw new Error('Cannot add probe to completed diagnosis')
      const reopening = state.diagnosis.status !== 'active' && state.diagnosis.stale
      const prior = reopening ? initialDiagnosticLedger() : state.diagnosis
      const hypotheses = mergeHypotheses(prior.hypotheses, event.data.newHypotheses, event.data.hypothesisStatusUpdates)
      validateProbe(event.data.probe, prior.probes, hypotheses)
      const probes = [...prior.probes, event.data.probe]
      const diagnosisRound = reopening ? state.diagnosisRound + 1 : state.diagnosisRound
      const evidence = mergeEvidence(prior.evidence, event.data.newEvidence, hypotheses, probes, state.evidenceSources, diagnosisRound)
      return {
        ...state,
        diagnosisRound,
        diagnosisHistory: reopening ? [...state.diagnosisHistory, state.diagnosis] : state.diagnosisHistory,
        pendingConclusion: null,
        pendingClarification: false,
        diagnosis: {
          ...prior,
          hypotheses,
          probes,
          evidence,
          currentProbeId: event.data.probe.id,
        },
      }
    }
    case 'errgrind/grill-conclude': {
      if (state === null) throw new Error('Error episode is not open')
      if (state.teachStartedAtTurn !== null || state.drillStartedAtTurn !== null) {
        throw new Error('Cannot conclude diagnosis after intervention has begun')
      }
      if (event.data.anchorRevision !== undefined
        && event.data.anchorRevision !== state.draft?.revision) {
        throw new Error('Diagnosis conclusion must use the current Error description')
      }
      if (state.diagnosis.status !== 'active') throw new Error('Diagnosis already concluded')
      const hypotheses = mergeHypotheses(state.diagnosis.hypotheses, event.data.newHypotheses, event.data.hypothesisStatusUpdates)
      const evidence = mergeEvidence(
        state.diagnosis.evidence, event.data.newEvidence, hypotheses, state.diagnosis.probes,
        state.evidenceSources, state.diagnosisRound,
      )

      const status: string = event.data.diagnosisStatus
      if (status !== 'supported' && status !== 'undetermined') {
        throw new Error(`Invalid diagnosis status: ${status}`)
      }
      if (event.data.summary.trim().length === 0) {
        throw new Error('Diagnosis summary cannot be empty')
      }

      let bestId: string | null = null
      const remainingUncertainty = event.data.remainingUncertainty ?? ''
      if (status === 'supported') {
        if (!event.data.bestHypothesisId) {
          throw new Error('Supported diagnosis requires bestHypothesisId')
        }
        const best = hypotheses.find(h => h.id === event.data.bestHypothesisId)
        if (!best) {
          throw new Error(`Best hypothesis ${event.data.bestHypothesisId} not found`)
        }
        if (best.status !== 'supported') {
          throw new Error(`Best hypothesis ${best.id} must have status "supported", got "${best.status}"`)
        }
        if (!evidence.some(item => item.supports.includes(best.id)
          && state.evidenceSources.some(source => source.sourceRef === item.sourceRef
            && source.diagnosisRound === state.diagnosisRound
            && source.probeId !== null && source.probeId === item.probeId))) {
          throw new Error('Supported diagnosis requires evidence grounded in a user\'s answer to a probe')
        }
        bestId = best.id
      } else {
        if (event.data.bestHypothesisId) {
          throw new Error('Undetermined diagnosis cannot have a bestHypothesisId')
        }
        if (remainingUncertainty.trim().length === 0) {
          throw new Error('Undetermined diagnosis must specify remainingUncertainty')
        }
      }

      const anchorRevision = event.data.anchorRevision ?? state.draft?.revision
      if (anchorRevision === undefined) throw new Error('Diagnosis conclusion requires an Error description')
      const proposal: PendingDiagnosisConclusion = {
        status,
        summary: event.data.summary,
        bestHypothesisId: bestId,
        remainingUncertainty,
        whatWouldChangeJudgment: event.data.whatWouldChangeJudgment ?? '',
        turn: event.data.turn,
        anchorRevision,
      }
      const diagnosis: DiagnosticLedger = {
        ...state.diagnosis,
        hypotheses,
        evidence,
        currentProbeId: null,
      }
      const legacyConfirmed = state.confirmedRevision === anchorRevision
      return {
        ...state,
        pendingClarification: false,
        diagnosis: legacyConfirmed ? completeDiagnosis(diagnosis, proposal) : diagnosis,
        pendingConclusion: legacyConfirmed ? null : proposal,
      }
    }
    case 'errgrind/teach-step': {
      if (state === null) throw new Error('Teach requires an Error episode')
      if (!['question', 'hint', 'explanation'].includes(event.data.kind)) {
        throw new Error('Teach step kind is invalid')
      }
      if (state.diagnosis.status === 'active' || state.diagnosis.stale) {
        throw new Error('Teach requires a current completed diagnosis')
      }
      if (state.confirmedRevision !== event.data.anchorRevision
        || state.diagnosis.anchoredRevision !== event.data.anchorRevision
        || state.diagnosisRound !== event.data.diagnosisRound) {
        throw new Error('Teach step is not anchored to the current diagnosis')
      }
      if (event.data.text.trim().length === 0 || event.data.text.length > MAX_TEACH_STEP_CHARS) {
        throw new Error('Teach step text is invalid')
      }
      return {
        ...state,
        teachStartedAtTurn: state.teachStartedAtTurn ?? event.data.turn,
        pendingClarification: false,
      }
    }
    case 'errgrind/drill-prepared': {
      if (state === null) return null
      return {
        ...state,
        drillStartedAtTurn: state.drillStartedAtTurn ?? event.data.preparedAtTurn,
        pendingClarification: false,
      }
    }
    case 'turn/start': {
      if (state === null) return null
      const data = event.data as { turn?: unknown }
      const turn = typeof data.turn === 'number' ? data.turn : state.latestTurn
      if (turn === state.latestTurn) return state
      return { ...state, latestTurn: turn }
    }
    case 'user/message': {
      if (state !== null && (event.data.source as { kind: string }).kind === 'errgrind-derived-error') {
        return { ...state, derivedContextConsumed: true }
      }
      if (state === null || event.data.source.kind !== 'user') return state
      if (state.teachStartedAtTurn !== null || state.drillStartedAtTurn !== null) return state
      if (state.diagnosis.status !== 'active' && !state.diagnosis.stale) return state
      if (state.diagnosis.currentProbeId === null && !state.pendingClarification) return state

      const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      const newSources: ErrorEpisode['evidenceSources'][number][] = []
      if (text.length > 0) {
        newSources.push({
          sourceRef: `user-event:${event.seq}`,
          text,
          probeId: state.diagnosis.currentProbeId,
          diagnosisRound: state.diagnosisRound,
        })
      }
      let imageIndex = 1
      for (const block of event.data.content) {
        if (block.type === 'image') {
          newSources.push({
            sourceRef: `user-event:${event.seq}:attachment:${imageIndex++}`,
            text: '',
            probeId: state.diagnosis.currentProbeId,
            diagnosisRound: state.diagnosisRound,
          })
        }
      }
      if (newSources.length === 0) return state
      return {
        ...state,
        pendingClarification: false,
        evidenceSources: [...state.evidenceSources, ...newSources],
      }
    }
    default:
      return state
  }
}

/** Read the current episode from the committed session projection. */
function currentEpisode(ctx: Context, session: Session): ErrorEpisode | null {
  const state = ctx.sessionProjections.stateOf(session, 'errgrindEpisode')
  if (state === undefined) throw new Error('ErrGrind episode projection is unavailable')
  return state
}

/** Register the authentic Error intake, draft tool, Grill diagnostic tools, and human commands. */
export function apply(ctx: Context, config: Config = { statusCommand: true }): void {
  const toolPrompts = loadToolPrompts()
  ctx.sessionProjections.register({
    key: 'errgrindEpisode',
    stateSchema: episodeSchema,
    stateVersion: 9,
    init: () => null,
    apply: applyEpisodeEvent,
    wire: { viewSchema: errorListEntrySchema, view: publicErrorListEntry },
  })
  applyDrill(ctx, toolPrompts)

  // Carry the raw receipt on the exact normalized reference. A process-local
  // digest map cannot distinguish different source files that normalize alike.
  const attachments = ctx.get('attachments')
  if (attachments !== undefined) {
    const batchSave = new AsyncLocalStorage<boolean>()
    const originalSaveImage = attachments.saveImage.bind(attachments)
    const originalSaveImages = attachments.saveImages.bind(attachments)

    attachments.saveImage = async (input: SaveImageAttachment) => {
      if (batchSave.getStore()) return originalSaveImage(input)
      const snapshot = { ...input, data: new Uint8Array(input.data) }
      await attachments.validateImage(snapshot)
      const fileRef = await attachments.saveFile({
        data: snapshot.data,
        ...(snapshot.name !== undefined ? { name: snapshot.name } : {}),
      })
      const imageRef = await originalSaveImage(snapshot)
      return {
        ...imageRef,
        errgrindOriginal: {
          sha256: fileRef.attachmentId.replace(/^sha256:/, ''),
          bytes: snapshot.data.byteLength,
          mediaType: snapshot.mediaType,
          fileRef,
        },
      }
    }

    attachments.saveImages = async (inputs: readonly SaveImageAttachment[]) => {
      const snapshots = inputs.map(input => ({ ...input, data: new Uint8Array(input.data) }))
      const limits = attachments.imageLimits
      if (snapshots.length > limits.maxImagesPerMessage) throw new Error('Image batch exceeds the configured image-count limit')
      if (snapshots.reduce((sum, input) => sum + input.data.byteLength, 0) > limits.maxMessageImageBytes) {
        throw new Error('Image batch exceeds the configured aggregate image-byte limit')
      }
      for (const input of snapshots) {
        if (!limits.mediaTypes.includes(input.mediaType)) throw new Error(`Image type ${input.mediaType} is not accepted`)
      }
      await Promise.all(snapshots.map(input => attachments.validateImage(input)))
      const fileRefs = await Promise.all(snapshots.map(input => attachments.saveFile({
        data: input.data,
        ...(input.name !== undefined ? { name: input.name } : {}),
      })))
      const imageRefs = await batchSave.run(true, () => originalSaveImages(snapshots))
      if (imageRefs.length !== snapshots.length) throw new Error('Attachment store returned an incomplete image batch')
      return imageRefs.map((imageRef, index) => {
        const input = snapshots[index]
        const fileRef = fileRefs[index]
        /* v8 ignore next -- map indices are valid after saveImages returned the exact input count. */
        if (input === undefined || fileRef === undefined) throw new Error('Attachment batch origin was lost')
        return {
          ...imageRef,
          errgrindOriginal: {
            sha256: fileRef.attachmentId.replace(/^sha256:/, ''),
            bytes: input.data.byteLength,
            mediaType: input.mediaType,
            fileRef,
          },
        }
      })
    }

    ctx.effect(() => () => {
      attachments.saveImage = originalSaveImage
      attachments.saveImages = originalSaveImages
    })
  }

  // pre-step runs after the inbox is claimed but before its first model call.
  ctx.on('agent/pre-step', async ({ agent, turn }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || currentEpisode(ctx, agent.session) !== null) return decision
    const userSourced = decision.messages.find(
      message => message.source.kind === 'user' || (message.source as { form?: string }).form === 'relay',
    )
    if (userSourced === undefined) return decision

    const isRelay = (userSourced.source as { form?: string }).form === 'relay' || userSourced.source.kind !== 'user'
    const sourceRecord = userSourced.source as Record<string, unknown>
    const origin: InputOrigin = {
      kind: isRelay ? 'host_relay' : 'direct_user',
      ...(typeof sourceRecord.rpcId === 'string' ? { rpcId: sourceRecord.rpcId } : {}),
      ...(typeof sourceRecord.clientTimeZone === 'string' ? { clientTimeZone: sourceRecord.clientTimeZone } : {}),
      ...(typeof sourceRecord.senderSessionId === 'string' ? { senderSessionId: sourceRecord.senderSessionId } : {}),
    }

    const text = userSourced.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    const episodeAttachments: ErrorAttachment[] = []
    for (const block of userSourced.content) {
      if (block.type === 'image') {
        const original = block.attachment.errgrindOriginal
        if (original === undefined) throw new Error('Image upload is missing its durable original-file receipt')
        episodeAttachments.push({
          sha256: original.sha256,
          mediaType: original.mediaType,
          bytes: original.bytes,
          ...(block.attachment.name ? { name: block.attachment.name } : {}),
          originalFileRef: original.fileRef,
          normalizedImageRef: block.attachment,
        })
      } else if (block.type === 'file') {
        const sha256 = String(block.attachment.attachmentId).replace(/^sha256:/, '')
        episodeAttachments.push({
          sha256,
          mediaType: 'application/octet-stream',
          bytes: block.attachment.bytes,
          name: block.attachment.name,
          originalFileRef: block.attachment,
        })
      }
    }
    const hasImage = episodeAttachments.some(a => a.mediaType.startsWith('image/'))
    if (text.length !== 0 || episodeAttachments.length !== 0) {
      agent.session.append('errgrind/error-open', {
        text,
        turn,
        hasImage,
        origin,
        attachments: episodeAttachments,
      })
    }
    return decision
  })

  ctx.tools.register(defineTool({
    name: 'error_draft',
    description: toolPrompts.description('error_draft'),
    parameters: {
      description: { type: 'string', required: true, description: toolPrompts.parameter('error_draft', 'description') },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          revision: { type: 'integer', required: true },
          description: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Error draft #${value.revision}: ${value.description}` }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('error_draft requires an agent session')
      const episode = currentEpisode(ctx, exec.agent.session)
      if (episode === null) throw new Error('No Error input has been recorded')
      if (episode.teachStartedAtTurn !== null) {
        throw new Error('The original Error description is locked after Teach begins; open a new Error for later observations')
      }
      if (episode.drillStartedAtTurn !== null) {
        throw new Error('The original Error description is locked after Drill begins; open a new Error for later observations')
      }
      const description = args.description.trim()
      if (description.length === 0 || description.length > MAX_DESCRIPTION_CHARS) {
        throw new Error(`Error description must contain 1–${MAX_DESCRIPTION_CHARS} characters`)
      }
      const revision = (episode.draft?.revision ?? 0) + 1
      exec.agent.session.append('errgrind/error-draft', { revision, text: description })
      return Promise.resolve({ revision, description })
    },
    presentCall: args => ({ card: 'generic', title: 'Draft Error', kind: 'other', rawInput: args.description }),
  }))

  ctx.tools.register(defineTool({
    name: 'error_clarify',
    description: toolPrompts.description('error_clarify'),
    parameters: {
      text: { type: 'string', required: true, description: toolPrompts.parameter('error_clarify', 'text') },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { accepted: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.accepted ? 'Clarification shown.' : 'Clarification not shown.' }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('error_clarify requires an agent session')
      const episode = currentEpisode(ctx, exec.agent.session)
      if (episode === null) throw new Error('No Error episode has been opened')
      const text = args.text.trim()
      if (text.length === 0 || text.length > MAX_CLARIFICATION_CHARS) {
        throw new Error(`Clarification must contain 1–${MAX_CLARIFICATION_CHARS} characters`)
      }
      if (episode.diagnosis.status !== 'active') throw new Error('Cannot clarify a completed Grill diagnosis')
      if (episode.teachStartedAtTurn !== null || episode.drillStartedAtTurn !== null) {
        throw new Error('Cannot clarify after intervention has begun')
      }
      exec.agent.session.append('errgrind/error-clarify', { text, turn: episode.latestTurn })
      return Promise.resolve({ accepted: true })
    },
    presentCall: args => ({ card: 'generic', title: 'Clarify Error', kind: 'other', rawInput: args.text }),
  }))

  ctx.tools.register(defineTool({
    name: 'grill_probe',
    description: toolPrompts.description('grill_probe'),
    parameters: {
      probe: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true, description: toolPrompts.parameter('grill_probe', 'probe.id') },
          type: { type: 'string', required: true, enum: ['reasoning_question', 'variant_problem'], description: toolPrompts.parameter('grill_probe', 'probe.type') },
          question: { type: 'string', required: true, description: toolPrompts.parameter('grill_probe', 'probe.question') },
          targetHypothesisIds: { type: 'array', required: true, items: { type: 'string' }, description: toolPrompts.parameter('grill_probe', 'probe.targetHypothesisIds') },
          discriminationGoal: { type: 'string', required: true, description: toolPrompts.parameter('grill_probe', 'probe.discriminationGoal') },
          predictions: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                hypothesisId: { type: 'string', required: true },
                expectedObservation: { type: 'string', required: true },
              },
            },
            description: toolPrompts.parameter('grill_probe', 'probe.predictions'),
          },
          answerKey: { type: 'string', description: toolPrompts.parameter('grill_probe', 'probe.answerKey') },
          preservedMechanism: { type: 'string', description: toolPrompts.parameter('grill_probe', 'probe.preservedMechanism') },
          surfaceChange: { type: 'string', description: toolPrompts.parameter('grill_probe', 'probe.surfaceChange') },
        },
      },
      newHypotheses: {
        type: 'array',
        description: toolPrompts.parameter('grill_probe', 'newHypotheses'),
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: toolPrompts.parameter('grill_probe', 'newHypotheses.id') },
            claim: { type: 'string', required: true, description: toolPrompts.parameter('grill_probe', 'newHypotheses.claim') },
          },
        },
      },
      hypothesisStatusUpdates: {
        type: 'array',
        description: toolPrompts.parameter('grill_probe', 'hypothesisStatusUpdates'),
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: toolPrompts.parameter('grill_probe', 'hypothesisStatusUpdates.id') },
            status: { type: 'string', required: true, enum: ['plausible', 'supported', 'weakened', 'rejected'], description: toolPrompts.parameter('grill_probe', 'hypothesisStatusUpdates.status') },
          },
        },
      },
      newEvidence: {
        type: 'array',
        description: toolPrompts.parameter('grill_probe', 'newEvidence'),
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: toolPrompts.parameter('grill_probe', 'newEvidence.id') },
            sourceRef: { type: 'string', required: true, description: toolPrompts.parameter('grill_probe', 'newEvidence.sourceRef') },
            quote: { type: 'string', description: toolPrompts.parameter('grill_probe', 'newEvidence.quote') },
            interpretation: { type: 'string', required: true, description: toolPrompts.parameter('grill_probe', 'newEvidence.interpretation') },
            supports: { type: 'array', required: true, items: { type: 'string' }, description: toolPrompts.parameter('grill_probe', 'newEvidence.supports') },
            contradicts: { type: 'array', required: true, items: { type: 'string' }, description: toolPrompts.parameter('grill_probe', 'newEvidence.contradicts') },
            probeId: { type: 'string', description: toolPrompts.parameter('grill_probe', 'newEvidence.probeId') },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          probeId: { type: 'string', required: true },
          question: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Diagnostic question (${value.probeId}): ${value.question}` }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('grill_probe requires an agent session')
      const episode = currentEpisode(ctx, exec.agent.session)
      if (episode === null) throw new Error('No Error episode has been opened')
      if (episode.teachStartedAtTurn !== null || episode.drillStartedAtTurn !== null) {
        throw new Error('Cannot add probe after intervention has begun')
      }
      if (episode.diagnosis.status !== 'active' && !episode.diagnosis.stale) throw new Error('Diagnosis already concluded')
      if (episode.draft === null) throw new Error('Create an Error description before starting Grill')
      const turn = episode.latestTurn

      const newHypotheses = args.newHypotheses?.map(h => ({
        id: h.id,
        claim: h.claim,
        status: 'plausible' as const,
      }))

      const hypothesisStatusUpdates = args.hypothesisStatusUpdates?.map(u => ({
        id: u.id,
        status: u.status,
      }))

      const newEvidence = args.newEvidence?.map(e => ({
        id: e.id,
        sourceRef: e.sourceRef,
        ...(e.quote !== undefined ? { quote: e.quote } : {}),
        interpretation: e.interpretation,
        supports: e.supports,
        contradicts: e.contradicts,
        ...(e.probeId !== undefined ? { probeId: e.probeId } : {}),
      }))

      const probe: DiagnosticProbe = {
        id: args.probe.id,
        type: args.probe.type,
        question: args.probe.question,
        targetHypothesisIds: args.probe.targetHypothesisIds,
        discriminationGoal: args.probe.discriminationGoal,
        predictions: args.probe.predictions.map(p => ({
          hypothesisId: p.hypothesisId,
          expectedObservation: p.expectedObservation,
        })),
        ...(args.probe.answerKey !== undefined ? { answerKey: args.probe.answerKey } : {}),
        ...(args.probe.preservedMechanism !== undefined ? { preservedMechanism: args.probe.preservedMechanism } : {}),
        ...(args.probe.surfaceChange !== undefined ? { surfaceChange: args.probe.surfaceChange } : {}),
      }

      const diagnosisRound = episode.diagnosisRound + (episode.diagnosis.stale ? 1 : 0)
      const groundedEvidence = resolveEvidenceAliases(newEvidence, episode.evidenceSources, diagnosisRound)
      assertLatestProbeReplyObserved(
        episode.evidenceSources, episode.diagnosis.evidence, groundedEvidence, episode.diagnosisRound, episode.diagnosis.stale,
      )
      const prior = episode.diagnosis.stale ? initialDiagnosticLedger() : episode.diagnosis
      const mergedHypotheses = mergeHypotheses(prior.hypotheses, newHypotheses, hypothesisStatusUpdates)
      validateProbe(probe, prior.probes, mergedHypotheses)
      const mergedProbes = [...prior.probes, probe]
      mergeEvidence(prior.evidence, groundedEvidence, mergedHypotheses, mergedProbes,
        episode.evidenceSources, diagnosisRound)

      exec.agent.session.append('errgrind/grill-probe', {
        anchorRevision: episode.draft.revision,
        probe,
        ...(newHypotheses !== undefined ? { newHypotheses } : {}),
        ...(hypothesisStatusUpdates !== undefined ? { hypothesisStatusUpdates } : {}),
        ...(groundedEvidence !== undefined ? { newEvidence: groundedEvidence } : {}),
        turn,
      })
      return Promise.resolve({ probeId: args.probe.id, question: args.probe.question })
    },
    presentCall: args => ({ card: 'generic', title: 'Grill Question', kind: 'other', rawInput: args.probe.question }),
  }))

  ctx.tools.register(defineTool({
    name: 'grill_conclude',
    description: toolPrompts.description('grill_conclude'),
    parameters: {
      diagnosisStatus: {
        type: 'string',
        enum: ['supported', 'undetermined'],
        required: true,
        description: toolPrompts.parameter('grill_conclude', 'diagnosisStatus'),
      },
      summary: {
        type: 'string',
        required: true,
        description: toolPrompts.parameter('grill_conclude', 'summary'),
      },
      bestHypothesisId: {
        type: 'string',
        description: toolPrompts.parameter('grill_conclude', 'bestHypothesisId'),
      },
      remainingUncertainty: {
        type: 'string',
        description: toolPrompts.parameter('grill_conclude', 'remainingUncertainty'),
      },
      whatWouldChangeJudgment: {
        type: 'string',
        description: toolPrompts.parameter('grill_conclude', 'whatWouldChangeJudgment'),
      },
      hypothesisStatusUpdates: {
        type: 'array',
        description: toolPrompts.parameter('grill_conclude', 'hypothesisStatusUpdates'),
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: toolPrompts.parameter('grill_conclude', 'hypothesisStatusUpdates.id') },
            status: { type: 'string', required: true, enum: ['plausible', 'supported', 'weakened', 'rejected'], description: toolPrompts.parameter('grill_conclude', 'hypothesisStatusUpdates.status') },
          },
        },
      },
      newEvidence: {
        type: 'array',
        description: toolPrompts.parameter('grill_conclude', 'newEvidence'),
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: toolPrompts.parameter('grill_conclude', 'newEvidence.id') },
            sourceRef: { type: 'string', required: true, description: toolPrompts.parameter('grill_conclude', 'newEvidence.sourceRef') },
            quote: { type: 'string', description: toolPrompts.parameter('grill_conclude', 'newEvidence.quote') },
            interpretation: { type: 'string', required: true, description: toolPrompts.parameter('grill_conclude', 'newEvidence.interpretation') },
            supports: { type: 'array', required: true, items: { type: 'string' }, description: toolPrompts.parameter('grill_conclude', 'newEvidence.supports') },
            contradicts: { type: 'array', required: true, items: { type: 'string' }, description: toolPrompts.parameter('grill_conclude', 'newEvidence.contradicts') },
            probeId: { type: 'string', description: toolPrompts.parameter('grill_conclude', 'newEvidence.probeId') },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          diagnosisStatus: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          bestHypothesisId: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Diagnosis proposed (${value.diagnosisStatus}): ${value.summary}`,
      }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('grill_conclude requires an agent session')
      const episode = currentEpisode(ctx, exec.agent.session)
      if (episode === null) throw new Error('No Error episode has been opened')
      if (episode.teachStartedAtTurn !== null || episode.drillStartedAtTurn !== null) {
        throw new Error('Cannot conclude diagnosis after intervention has begun')
      }
      if (episode.diagnosis.status !== 'active') throw new Error('Diagnosis already concluded; re-probe a stale diagnosis first')
      if (episode.draft === null) throw new Error('Create an Error description before concluding diagnosis')

      const turn = episode.latestTurn

      const hypothesisStatusUpdates = args.hypothesisStatusUpdates?.map(u => ({
        id: u.id,
        status: u.status,
      }))

      const newEvidence = args.newEvidence?.map(e => ({
        id: e.id,
        sourceRef: e.sourceRef,
        ...(e.quote !== undefined ? { quote: e.quote } : {}),
        interpretation: e.interpretation,
        supports: e.supports,
        contradicts: e.contradicts,
        ...(e.probeId !== undefined ? { probeId: e.probeId } : {}),
      }))
      const groundedEvidence = resolveEvidenceAliases(newEvidence, episode.evidenceSources, episode.diagnosisRound)
      assertLatestProbeReplyObserved(
        episode.evidenceSources, episode.diagnosis.evidence, groundedEvidence, episode.diagnosisRound, false,
      )

      const summary = args.summary.trim()
      const bestHypothesisId = args.bestHypothesisId?.trim() || undefined
      const remainingUncertainty = args.remainingUncertainty?.trim() || undefined
      const whatWouldChangeJudgment = args.whatWouldChangeJudgment?.trim() || undefined

      const hypotheses = mergeHypotheses(episode.diagnosis.hypotheses, undefined, hypothesisStatusUpdates)
      const evidence = mergeEvidence(episode.diagnosis.evidence, groundedEvidence, hypotheses,
        episode.diagnosis.probes, episode.evidenceSources, episode.diagnosisRound)
      if (args.diagnosisStatus === 'supported') {
        if (bestHypothesisId === undefined) throw new Error('Supported diagnosis requires bestHypothesisId')
        const best = hypotheses.find(hypothesis => hypothesis.id === bestHypothesisId)
        if (best?.status !== 'supported') throw new Error(`Best hypothesis ${bestHypothesisId} must have status "supported"`)
        if (!evidence.some(item => item.supports.includes(best.id)
          && episode.evidenceSources.some(source => source.sourceRef === item.sourceRef
            && source.diagnosisRound === episode.diagnosisRound
            && source.probeId !== null && source.probeId === item.probeId))) {
          throw new Error('Supported diagnosis requires evidence grounded in a user\'s answer to a probe')
        }
        if (whatWouldChangeJudgment === undefined || whatWouldChangeJudgment.length === 0) {
          throw new Error('Supported diagnosis requires whatWouldChangeJudgment')
        }
      } else if (remainingUncertainty === undefined || remainingUncertainty.length === 0) {
        throw new Error('Undetermined diagnosis must specify remainingUncertainty')
      }

      exec.agent.session.append('errgrind/grill-conclude', {
        anchorRevision: episode.draft.revision,
        diagnosisStatus: args.diagnosisStatus,
        summary,
        ...(bestHypothesisId !== undefined ? { bestHypothesisId } : {}),
        ...(remainingUncertainty !== undefined ? { remainingUncertainty } : {}),
        ...(whatWouldChangeJudgment !== undefined ? { whatWouldChangeJudgment } : {}),
        ...(hypothesisStatusUpdates !== undefined ? { hypothesisStatusUpdates } : {}),
        ...(groundedEvidence !== undefined ? { newEvidence: groundedEvidence } : {}),
        turn,
      })
      return Promise.resolve({
        diagnosisStatus: args.diagnosisStatus,
        summary,
        ...(bestHypothesisId !== undefined ? { bestHypothesisId } : {}),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Diagnosis Proposed', kind: 'other', rawInput: args.summary }),
  }))

  ctx.tools.register(defineTool({
    name: 'teach_step',
    description: toolPrompts.description('teach_step'),
    parameters: {
      kind: { type: 'string', required: true, enum: ['question', 'hint', 'explanation'], description: toolPrompts.parameter('teach_step', 'kind') },
      text: { type: 'string', required: true, description: toolPrompts.parameter('teach_step', 'text') },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { accepted: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.accepted ? 'Teach step shown.' : 'Teach step not shown.' }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('teach_step requires an agent session')
      const episode = currentEpisode(ctx, exec.agent.session)
      if (episode === null) throw new Error('No Error episode has been opened')
      if (episode.diagnosis.status === 'active' || episode.diagnosis.stale) {
        throw new Error('Finish the current Grill diagnosis before Teach')
      }
      if (episode.confirmedRevision === null
        || episode.confirmedRevision !== episode.draft?.revision
        || episode.diagnosis.anchoredRevision !== episode.confirmedRevision) {
        throw new Error('Confirm the final Error description after diagnosis before Teach')
      }
      const text = args.text.trim()
      if (text.length === 0 || text.length > MAX_TEACH_STEP_CHARS) {
        throw new Error(`Teach step must contain 1–${MAX_TEACH_STEP_CHARS} characters`)
      }
      exec.agent.session.append('errgrind/teach-step', {
        kind: args.kind,
        text,
        anchorRevision: episode.confirmedRevision,
        diagnosisRound: episode.diagnosisRound,
        turn: episode.latestTurn,
      })
      return Promise.resolve({ accepted: true })
    },
    presentCall: args => ({ card: 'generic', title: 'Teach Step', kind: 'other', rawInput: args.text }),
  }))

  ctx.commands.register({
    name: 'error-confirm',
    description: 'Confirm the reviewed final Error description and finish Grill together, for example /error-confirm 2',
    // Without the input declaration the composer treats `/error-confirm <n>` as
    // ordinary chat text: the argued line never reaches this handler, so the
    // revision-bound confirmation path must advertise its free-form tail.
    input: { hint: '<revision>' },
    handler: (invocation) => {
      const revisionText = invocation.rawInput.trim()
      if (!/^[1-9][0-9]*$/.test(revisionText)) {
        return { kind: 'error', text: '请使用 /error-confirm <修订号>，并确认你刚刚查看的版本。' }
      }
      const expectedRevision = Number(revisionText)
      if (!Number.isSafeInteger(expectedRevision)) return { kind: 'error', text: '修订号无效，请查看当前描述卡片。' }
      const session = invocation.agent.session
      const episode = currentEpisode(ctx, session)
      if (episode?.draft == null) return { kind: 'error', text: '请先生成 Error 描述。' }
      if (expectedRevision !== episode.draft.revision) {
        return { kind: 'error', text: 'Error 描述已有更新，请先查看最新修订，再确认。' }
      }
      if (episode.confirmedRevision === episode.draft.revision) {
        return { kind: 'success', text: '这版 Error 描述已经确认。' }
      }
      if (episode.pendingConclusion?.anchorRevision !== expectedRevision) {
        return { kind: 'error', text: 'Grill 仍在进行；请先继续核对 Error 描述和诊断。' }
      }
      session.append('errgrind/error-confirm', {
        revision: expectedRevision,
        commandId: invocation.commandId,
      })
      return { kind: 'success', text: `已确认 Error 描述第 ${expectedRevision} 版，Grill 已完成。` }
    },
  })

  if (config.statusCommand !== false) ctx.commands.register({
    name: 'error-status',
    description: 'Display the current status of the Error episode, draft, and diagnosis',
    handler: (invocation) => {
      if (invocation.rawInput.trim().length !== 0) return { kind: 'error', text: '使用 /error-status 查看当前状态。' }
      const session = invocation.agent.session
      const episode = currentEpisode(ctx, session)
      if (episode === null) return { kind: 'success', text: '当前会话尚未记录 Error 输入。' }

      const lines: string[] = ['【Error Episode 状态】']
      lines.push(`• 来源: ${episode.origin.kind === 'direct_user' ? '用户直接输入' : '宿主转述'}`)
      lines.push(`• 原始输入: ${episode.firstInput.length} 字，附件 ${episode.attachments.length} 个`)
      if (episode.attachments.length > 0) {
        const hashes = episode.attachments.map(a => `${a.name ?? 'image'}: ${a.sha256.slice(0, 8)}... (${a.bytes}B)`).join(', ')
        lines.push(`  附件清单: ${hashes}`)
      }
      if (episode.draft === null) {
        lines.push('• 描述草稿: 尚未起草')
      } else {
        const confirmed = episode.confirmedRevision === episode.draft.revision ? '已确认' : '待确认'
        lines.push(`• 描述草稿: 第 ${episode.draft.revision} 版（${confirmed}）`)
      }

      const diag = episode.diagnosis
      const staleNotice = diag.stale ? ' [草稿已更正，诊断待复核]' : ''
      lines.push(`• 诊断状态: ${diag.status}${staleNotice}`)
      if (episode.pendingConclusion !== null) {
        lines.push(`  暂定结论: ${episode.pendingConclusion.status}（等待确认第 ${episode.pendingConclusion.anchorRevision} 版描述；Grill 未结束）`)
      }
      if (diag.status === 'active') {
        lines.push(`  当前探针: ${diag.currentProbeId ?? '无待回答探针'}`)
      } else if (diag.status === 'supported') {
        const hyp = diag.hypotheses.find(h => h.id === diag.bestHypothesisId)
        const hypText = hyp !== undefined ? ` (${hyp.claim})` : ''
        lines.push(`  确立机制: ${diag.bestHypothesisId}${hypText}`)
        lines.push(`  诊断摘要: ${diag.summary}`)
      } else {
        lines.push(`  不确定性: ${diag.remainingUncertainty}`)
        lines.push(`  诊断摘要: ${diag.summary}`)
      }
      lines.push(`• 诊断账本: 候选假设 ${diag.hypotheses.length} 个，探针 ${diag.probes.length} 个，证据 ${diag.evidence.length} 条`)

      return { kind: 'success', text: lines.join('\n') }
    },
  })
}
