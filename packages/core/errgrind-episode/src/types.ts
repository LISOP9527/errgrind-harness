/** Durable, session-local ErrGrind Error episode facts. */

/** The current public description is model authored until the user confirms it. */
export interface ErrorDescriptionDraft {
  readonly revision: number
  readonly text: string
}

/** One Error investigation in one DSH Session. */
export interface ErrorEpisode {
  readonly firstInput: string
  readonly firstInputHasImage: boolean
  readonly firstInputTurn: number
  readonly draft: ErrorDescriptionDraft | null
  readonly confirmedRevision: number | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** First user-sourced input, saved before the first model request. */
    'errgrind/error-open': { text: string; hasImage: boolean; turn: number }
    /** Model-authored public description; each call replaces the draft. */
    'errgrind/error-draft': { revision: number; text: string }
    /** Explicit human command accepting the current description revision. */
    'errgrind/error-confirm': { revision: number; commandId: string }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    errgrindEpisode: ErrorEpisode | null
  }
}
