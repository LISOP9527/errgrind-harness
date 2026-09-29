/** Durable, session-local ErrGrind Error episode facts. */

import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

declare module '@deepseek-ai/dsh-attachment' {
  interface ImageAttachmentRef {
    /** ErrGrind's byte-exact upload receipt, carried with this exact admitted image reference. */
    errgrindOriginal?: {
      sha256: string
      bytes: number
      mediaType: string
      fileRef: FileAttachmentRef
    }
  }
}

/** Verbatim upload facts and the normalized image reference when applicable. */
export interface ErrorAttachment {
  readonly sha256: string
  readonly mediaType: string
  readonly bytes: number
  readonly name?: string | undefined
  readonly originalFileRef?: FileAttachmentRef | undefined
  readonly normalizedImageRef?: ImageAttachmentRef | undefined
}

/** Whether the first Error input came directly from the learner or through an agent host. */
export type InputProvenanceKind = 'direct_user' | 'host_relay' | 'derived_drill'

/** Source metadata for the first Error input. */
export interface InputProvenance {
  readonly kind: InputProvenanceKind
  readonly rpcId?: string | undefined
  readonly clientTimeZone?: string | undefined
  readonly senderSessionId?: string | undefined
  readonly sourceSessionId?: string | undefined
  readonly sourcePreparationId?: string | undefined
  readonly sourceAnswerRef?: string | undefined
}

/** The current public description is model authored until the user confirms it. */
export interface ErrorDescriptionDraft {
  readonly revision: number
  readonly text: string
}

/** Current episode-level standing of a proposed error mechanism. */
export type HypothesisStatus = 'plausible' | 'supported' | 'weakened' | 'rejected'

/** One candidate explanation of the Error-time failure. */
export interface Hypothesis {
  readonly id: string
  readonly claim: string
  readonly status: HypothesisStatus
}

/** Internal expected observation under one candidate mechanism. */
export interface ProbePrediction {
  readonly hypothesisId: string
  readonly expectedObservation: string
}

/** Diagnostic question or mechanism-preserving variant problem. */
export type ProbeType = 'reasoning_question' | 'variant_problem'

/** One probe and its internal discriminating metadata. */
export interface DiagnosticProbe {
  readonly id: string
  readonly type: ProbeType
  readonly question: string
  readonly targetHypothesisIds: readonly string[]
  readonly discriminationGoal: string
  readonly predictions: readonly ProbePrediction[]
  readonly answerKey?: string | undefined
  readonly preservedMechanism?: string | undefined
  readonly surfaceChange?: string | undefined
}

/** Model interpretation linked to one exact user answer and probe. */
export interface DiagnosticEvidence {
  readonly id: string
  readonly sourceRef: string
  readonly quote?: string | undefined
  readonly interpretation: string
  readonly supports: readonly string[]
  readonly contradicts: readonly string[]
  readonly probeId?: string | undefined
}

/** Whether the episode diagnosis remains open or has concluded. */
export type DiagnosisStatus = 'active' | 'supported' | 'undetermined'

/** One episode-level diagnosis, without any long-term Pattern claim. */
export interface DiagnosticLedger {
  readonly status: DiagnosisStatus
  readonly hypotheses: readonly Hypothesis[]
  readonly probes: readonly DiagnosticProbe[]
  readonly evidence: readonly DiagnosticEvidence[]
  readonly currentProbeId: string | null
  readonly bestHypothesisId: string | null
  readonly remainingUncertainty: string
  readonly whatWouldChangeJudgment: string
  readonly summary: string | null
  readonly concludedAtTurn: number | null
  readonly anchoredRevision: number | null
  readonly stale: boolean
}

/** Validated model conclusion awaiting the learner's approval of its Error description anchor. */
export interface PendingDiagnosisConclusion {
  readonly status: 'supported' | 'undetermined'
  readonly summary: string
  readonly bestHypothesisId: string | null
  readonly remainingUncertainty: string
  readonly whatWouldChangeJudgment: string
  readonly turn: number
  readonly anchorRevision: number
}

/** One Error investigation in one DSH Session. */
export interface ErrorEpisode {
  readonly firstInput: string
  readonly firstInputHasImage: boolean
  readonly firstInputTurn: number
  readonly latestTurn: number
  readonly provenance: InputProvenance
  readonly attachments: readonly ErrorAttachment[]
  readonly draft: ErrorDescriptionDraft | null
  readonly confirmedRevision: number | null
  /** Increments when a confirmed correction starts a new diagnosis ledger. */
  readonly diagnosisRound: number
  /** Earlier conclusions retained when a stale description is explicitly re-probed. */
  readonly diagnosisHistory: readonly DiagnosticLedger[]
  /** Exact user-authored source excerpts available for grounded evidence. */
  readonly evidenceSources: readonly {
    readonly sourceRef: string
    readonly text: string
    readonly probeId: string | null
    readonly diagnosisRound: number
  }[]
  readonly diagnosis: DiagnosticLedger
  /** A proposed conclusion does not finish Grill until the current description is confirmed. */
  readonly pendingConclusion: PendingDiagnosisConclusion | null
  /** Whether the private Host context for a derived Drill Error reached a model turn. */
  readonly derivedContextConsumed: boolean
  /** First explicit teaching intervention; later answers are post-intervention observations. */
  readonly teachStartedAtTurn: number | null
  /** First drill practice intervention; later answers are post-intervention practice attempts. */
  readonly drillStartedAtTurn: number | null
  /** Whether a factual clarification has been posed and is awaiting a user reply. */
  readonly pendingClarification: boolean
}

/** Public, minimal Error row for the Session list; no diagnostic ledger or original attachments. */
export interface ErrorListEntry {
  readonly description: string | null
  readonly status: 'grill' | 'confirm' | 'teach'
  readonly drillEligible: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** First user-sourced input, saved before the first model request. */
    'errgrind/error-open': {
      text: string
      turn: number
      hasImage?: boolean | undefined
      provenance?: InputProvenance | undefined
      attachments?: readonly ErrorAttachment[] | undefined
    }
    /** A wrong Drill answer promoted into a separate Error investigation with exact source lineage. */
    'errgrind/derived-error-open': {
      text: string
      sourceSessionId: string
      sourcePreparationId: string
      sourceAnswerRef: string
      question: string
      userResponse: string
      referenceAnswer: string
    }
    /** Model-authored public description; each call replaces the draft. */
    'errgrind/error-draft': { revision: number; text: string }
    /** Public factual clarification during Grill; a new question invalidates a pending conclusion. */
    'errgrind/error-clarify': { text: string; turn: number }
    /** Explicit human command accepting the current description revision and pending diagnosis together. */
    'errgrind/error-confirm': { revision: number; commandId: string }
    /** Model-authored diagnostic probe and hypotheses/evidence updates during Grill. */
    'errgrind/grill-probe': {
      /** Current Error description this diagnostic question investigates. */
      anchorRevision?: number | undefined
      probe: DiagnosticProbe
      newHypotheses?: readonly Hypothesis[] | undefined
      hypothesisStatusUpdates?: readonly { id: string; status: HypothesisStatus }[] | undefined
      newEvidence?: readonly DiagnosticEvidence[] | undefined
      turn: number
    }
    /** Model conclusion proposal; the diagnosis remains active until human confirmation. */
    'errgrind/grill-conclude': {
      /** Current Error description this conclusion investigates. */
      anchorRevision?: number | undefined
      diagnosisStatus: 'supported' | 'undetermined'
      summary: string
      bestHypothesisId?: string | undefined
      remainingUncertainty?: string | undefined
      whatWouldChangeJudgment?: string | undefined
      newHypotheses?: readonly Hypothesis[] | undefined
      hypothesisStatusUpdates?: readonly { id: string; status: HypothesisStatus }[] | undefined
      newEvidence?: readonly DiagnosticEvidence[] | undefined
      turn: number
    }
    /** Public model-authored teaching move after this episode's diagnosis. */
    'errgrind/teach-step': {
      kind: 'question' | 'hint' | 'explanation'
      text: string
      anchorRevision: number
      diagnosisRound: number
      turn: number
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    errgrindEpisode: ErrorEpisode | null
  }
  interface SessionProjectionMap {
    /** Public Error history row; null means this Session is not an Error. */
    errgrindEpisode: ErrorListEntry | null
  }
}
