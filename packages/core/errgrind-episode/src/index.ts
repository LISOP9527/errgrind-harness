/** Session-backed authentic Error intake, draft revisions, human confirmation, and Grill diagnosis. */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
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
  Hypothesis,
  HypothesisStatus,
  InputProvenance,
} from './types.ts'

export type * from './types.ts'

export const name = 'errgrind-episode'
export const inject = ['sessionProjections', 'tools', 'commands']

const MAX_DESCRIPTION_CHARS = 12_000
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

const attachmentSchema = zod.object({
  sha256: zod.string(),
  mediaType: zod.string(),
  bytes: zod.number().int().nonnegative(),
  name: zod.string().optional(),
  originalFileRef: zod.any().optional(),
  normalizedImageRef: zod.any().optional(),
}).strict()

const provenanceSchema = zod.object({
  kind: zod.enum(['direct_user', 'host_relay']),
  rpcId: zod.string().optional(),
  clientTimeZone: zod.string().optional(),
  senderSessionId: zod.string().optional(),
}).strict()

const episodeSchema: ZodType<ErrorEpisode | null> = zod.union([
  zod.object({
    firstInput: zod.string(),
    firstInputHasImage: zod.boolean(),
    firstInputTurn: zod.number().int().positive(),
    latestTurn: zod.number().int().positive(),
    provenance: provenanceSchema,
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
      if (source === undefined || source.diagnosisRound !== diagnosisRound
        || source.probeId === null || source.probeId !== e.probeId) {
        throw new Error(`Evidence ${e.id} must reference an actual user answer to its probe`)
      }
      if (e.quote === undefined || e.quote.trim().length === 0 || !source.text.includes(e.quote)) {
        throw new Error(`Evidence ${e.id} quote must match the referenced user answer`)
      }
      ids.add(e.id)
      result.push(e)
    }
  }

  return result
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
  for (const hId of probe.targetHypothesisIds) {
    if (!hypIds.has(hId)) throw new Error(`Probe target hypothesis ${hId} does not exist`)
  }
  if (probe.predictions.length === 0) {
    throw new Error('Probe predictions cannot be empty')
  }
  for (const pred of probe.predictions) {
    if (!hypIds.has(pred.hypothesisId)) {
      throw new Error(`Probe prediction references unknown hypothesis ${pred.hypothesisId}`)
    }
    if (pred.expectedObservation.trim().length === 0) {
      throw new Error('Probe prediction expectedObservation cannot be empty')
    }
  }
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
      const provenance: InputProvenance = event.data.provenance ?? { kind: 'direct_user' }
      return {
        firstInput: text,
        firstInputHasImage: hasImage,
        firstInputTurn: event.data.turn,
        latestTurn: event.data.turn,
        provenance,
        attachments,
        draft: null,
        confirmedRevision: null,
        diagnosisRound: 1,
        diagnosisHistory: [],
        evidenceSources: [],
        diagnosis: initialDiagnosticLedger(),
      }
    }
    case 'errgrind/error-draft': {
      if (state === null) throw new Error('Error episode is not open')
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
        diagnosis: stale ? { ...state.diagnosis, stale: true } : state.diagnosis,
      }
    }
    case 'errgrind/error-confirm': {
      if (state?.draft == null || state.draft.revision !== event.data.revision) {
        throw new Error('Error description revision is not current')
      }
      if (state.confirmedRevision === event.data.revision) throw new Error('Error description already confirmed')
      const stale = state.diagnosis.status !== 'active'
        && state.diagnosis.anchoredRevision !== null
        && state.diagnosis.anchoredRevision !== event.data.revision
      return {
        ...state,
        confirmedRevision: event.data.revision,
        diagnosis: { ...state.diagnosis, stale },
      }
    }
    case 'errgrind/grill-probe': {
      if (state === null) throw new Error('Error episode is not open')
      if (state.diagnosis.status !== 'active' && !state.diagnosis.stale) throw new Error('Cannot add probe to completed diagnosis')
      const reopening = state.diagnosis.status !== 'active' && state.diagnosis.stale
      if (reopening && state.confirmedRevision !== state.draft?.revision) {
        throw new Error('Confirm the corrected Error description before re-probing the stale diagnosis')
      }
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
      if (state.diagnosis.status !== 'active') throw new Error('Diagnosis already concluded')
      if (state.confirmedRevision === null) {
        throw new Error('Cannot conclude diagnosis before Error description draft is confirmed')
      }
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

      return {
        ...state,
        diagnosis: {
          status,
          hypotheses,
          probes: state.diagnosis.probes,
          evidence,
          currentProbeId: null,
          bestHypothesisId: bestId,
          remainingUncertainty,
          whatWouldChangeJudgment: event.data.whatWouldChangeJudgment ?? '',
          summary: event.data.summary,
          concludedAtTurn: event.data.turn,
          anchoredRevision: state.confirmedRevision,
          stale: false,
        },
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
      if (state === null || event.data.source.kind !== 'user') return state
      const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      if (text.length === 0 || state.diagnosis.currentProbeId === null) return state
      const sourceRef = `user-event:${event.seq}`
      return {
        ...state,
        evidenceSources: [...state.evidenceSources, {
          sourceRef, text, probeId: state.diagnosis.currentProbeId, diagnosisRound: state.diagnosisRound,
        }],
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
export function apply(ctx: Context): void {
  ctx.sessionProjections.register({
    key: 'errgrindEpisode',
    stateSchema: episodeSchema,
    stateVersion: 3,
    init: () => null,
    apply: applyEpisodeEvent,
  })

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
        if (input === undefined || fileRef === undefined) throw new Error('Attachment batch provenance was lost')
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
    const provenance: InputProvenance = {
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
        provenance,
        attachments: episodeAttachments,
      })
    }
    return decision
  })

  ctx.tools.register(defineTool({
    name: 'error_draft',
    description: 'Save a draft of the current mathematics Error as one complete description. '
      + 'Describe only what is known, distinguish the user’s account from your interpretation, '
      + 'and ask the user to review it. This tool cannot confirm the draft for the user.',
    parameters: {
      description: { type: 'string', required: true, description: 'One complete, user-readable Error description.' },
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
    name: 'grill_probe',
    description: 'Pose a discriminative diagnostic question or variant problem during Grill to differentiate candidate error hypotheses. '
      + 'Internal predictions and answer keys are diagnostic metadata; ask only the question in user-visible prose.',
    parameters: {
      probe: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true, description: 'Probe identifier, e.g. P1, P2.' },
          type: { type: 'string', required: true, enum: ['reasoning_question', 'variant_problem'], description: 'Type of diagnostic probe.' },
          question: { type: 'string', required: true, description: 'The question or problem presented to the user.' },
          targetHypothesisIds: { type: 'array', required: true, items: { type: 'string' }, description: 'Hypothesis IDs to discriminate.' },
          discriminationGoal: { type: 'string', required: true, description: 'What this probe is designed to differentiate.' },
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
            description: 'Expected observation per hypothesis.',
          },
          answerKey: { type: 'string', description: 'Hidden reference answer for variant problems.' },
          preservedMechanism: { type: 'string' },
          surfaceChange: { type: 'string' },
        },
      },
      newHypotheses: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            claim: { type: 'string', required: true },
          },
        },
      },
      hypothesisStatusUpdates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            status: { type: 'string', required: true, enum: ['plausible', 'supported', 'weakened', 'rejected'] },
          },
        },
      },
      newEvidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            sourceRef: { type: 'string', required: true },
            quote: { type: 'string' },
            interpretation: { type: 'string', required: true },
            supports: { type: 'array', required: true, items: { type: 'string' } },
            contradicts: { type: 'array', required: true, items: { type: 'string' } },
            probeId: { type: 'string' },
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
      if (episode.diagnosis.status !== 'active' && !episode.diagnosis.stale) throw new Error('Diagnosis already concluded')
      if (episode.diagnosis.stale && episode.confirmedRevision !== episode.draft?.revision) {
        throw new Error('Confirm the corrected Error description before re-probing the stale diagnosis')
      }

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

      const prior = episode.diagnosis.stale ? initialDiagnosticLedger() : episode.diagnosis
      const mergedHypotheses = mergeHypotheses(prior.hypotheses, newHypotheses, hypothesisStatusUpdates)
      validateProbe(probe, prior.probes, mergedHypotheses)
      const mergedProbes = [...prior.probes, probe]
      mergeEvidence(prior.evidence, newEvidence, mergedHypotheses, mergedProbes,
        episode.evidenceSources, episode.diagnosisRound + (episode.diagnosis.stale ? 1 : 0))

      exec.agent.session.append('errgrind/grill-probe', {
        probe,
        ...(newHypotheses !== undefined ? { newHypotheses } : {}),
        ...(hypothesisStatusUpdates !== undefined ? { hypothesisStatusUpdates } : {}),
        ...(newEvidence !== undefined ? { newEvidence } : {}),
        turn,
      })
      return Promise.resolve({ probeId: args.probe.id, question: args.probe.question })
    },
    presentCall: args => ({ card: 'generic', title: 'Grill Question', kind: 'other', rawInput: args.probe.question }),
  }))

  ctx.tools.register(defineTool({
    name: 'grill_conclude',
    description: 'Conclude the episode diagnosis after collecting sufficient evidence. '
      + 'Requires that the user has reviewed and confirmed the Error description draft via /error-confirm. '
      + 'Supported diagnoses require a validated best hypothesis; undetermined diagnoses require explicit remaining uncertainty.',
    parameters: {
      diagnosisStatus: {
        type: 'string',
        enum: ['supported', 'undetermined'],
        required: true,
        description: 'Conclusion status of the diagnosis.',
      },
      summary: {
        type: 'string',
        required: true,
        description: 'Readable summary of the diagnostic finding and error mechanism.',
      },
      bestHypothesisId: {
        type: 'string',
        description: 'ID of the supported error mechanism hypothesis. Required if status is supported.',
      },
      remainingUncertainty: {
        type: 'string',
        description: 'Reasoning about remaining ambiguity. Required if status is undetermined.',
      },
      whatWouldChangeJudgment: {
        type: 'string',
        description: 'What future observations or facts would alter this conclusion.',
      },
      hypothesisStatusUpdates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            status: { type: 'string', required: true, enum: ['plausible', 'supported', 'weakened', 'rejected'] },
          },
        },
      },
      newEvidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            sourceRef: { type: 'string', required: true },
            quote: { type: 'string' },
            interpretation: { type: 'string', required: true },
            supports: { type: 'array', required: true, items: { type: 'string' } },
            contradicts: { type: 'array', required: true, items: { type: 'string' } },
            probeId: { type: 'string' },
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
        text: `Diagnosis concluded (${value.diagnosisStatus}): ${value.summary}`,
      }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('grill_conclude requires an agent session')
      const episode = currentEpisode(ctx, exec.agent.session)
      if (episode === null) throw new Error('No Error episode has been opened')
      if (episode.diagnosis.status !== 'active') throw new Error('Diagnosis already concluded; re-probe a stale diagnosis first')
      if (episode.confirmedRevision === null) {
        throw new Error('Cannot conclude diagnosis before Error description draft is confirmed by the user (/error-confirm).')
      }

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

      const summary = args.summary.trim()
      const bestHypothesisId = args.bestHypothesisId?.trim() || undefined
      const remainingUncertainty = args.remainingUncertainty?.trim() || undefined
      const whatWouldChangeJudgment = args.whatWouldChangeJudgment?.trim() || undefined

      const hypotheses = mergeHypotheses(episode.diagnosis.hypotheses, undefined, hypothesisStatusUpdates)
      const evidence = mergeEvidence(episode.diagnosis.evidence, newEvidence, hypotheses,
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
      } else if (remainingUncertainty === undefined || remainingUncertainty.length === 0) {
        throw new Error('Undetermined diagnosis must specify remainingUncertainty')
      }

      exec.agent.session.append('errgrind/grill-conclude', {
        diagnosisStatus: args.diagnosisStatus,
        summary,
        ...(bestHypothesisId !== undefined ? { bestHypothesisId } : {}),
        ...(remainingUncertainty !== undefined ? { remainingUncertainty } : {}),
        ...(whatWouldChangeJudgment !== undefined ? { whatWouldChangeJudgment } : {}),
        ...(hypothesisStatusUpdates !== undefined ? { hypothesisStatusUpdates } : {}),
        ...(newEvidence !== undefined ? { newEvidence } : {}),
        turn,
      })
      return Promise.resolve({
        diagnosisStatus: args.diagnosisStatus,
        summary,
        ...(bestHypothesisId !== undefined ? { bestHypothesisId } : {}),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Diagnosis Concluded', kind: 'other', rawInput: args.summary }),
  }))

  ctx.commands.register({
    name: 'error-confirm',
    description: 'Confirm the current Error description after reviewing it',
    handler: (invocation) => {
      if (invocation.rawInput.trim().length !== 0) return { kind: 'error', text: '使用 /error-confirm 确认当前描述。' }
      const session = invocation.agent.session
      const episode = currentEpisode(ctx, session)
      if (episode?.draft == null) return { kind: 'error', text: '请先生成并核对 Error 描述。' }
      if (episode.confirmedRevision === episode.draft.revision) {
        return { kind: 'success', text: '这版 Error 描述已经确认。' }
      }
      session.append('errgrind/error-confirm', {
        revision: episode.draft.revision,
        commandId: invocation.commandId,
      })
      return { kind: 'success', text: `已确认 Error 描述第 ${episode.draft.revision} 版。` }
    },
  })

  ctx.commands.register({
    name: 'error-status',
    description: 'Display the current status of the Error episode, draft, and diagnosis',
    handler: (invocation) => {
      if (invocation.rawInput.trim().length !== 0) return { kind: 'error', text: '使用 /error-status 查看当前状态。' }
      const session = invocation.agent.session
      const episode = currentEpisode(ctx, session)
      if (episode === null) return { kind: 'success', text: '当前会话尚未记录 Error 输入。' }

      const lines: string[] = ['【Error Episode 状态】']
      lines.push(`• 来源: ${episode.provenance.kind === 'direct_user' ? '用户直接输入' : '宿主转述'}`)
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
