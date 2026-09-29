/**
 * Browser-safe failure vocabulary of the configuration surfaces this package
 * serves. The redacted views themselves live with their seam in
 * `@deepseek-ai/dsh-settings/types`, whose Cordis event declarations already
 * register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * Every seam refusal that is not a stale write: an unregistered or malformed
     * namespace, a read-only provider, schema validation, storage.
     */
    'settings/rejected': { readonly ns: string }
    /**
     * The stored revision moved after the caller read it. Its own outcome rather
     * than an invalid request: the caller must re-read and re-apply.
     */
    'settings/conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
    /**
     * The provider refused a valid credential write, for example because a
     * read-only source shadows the reference. The details name only the
     * reference, never the value.
     */
    'credential/rejected': { readonly ref: string }
  }
}

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}

/** Safe lifecycle projection for the fixed Codex OAuth device-code flow. */
export interface CodexAuthStatus {
  readonly available: boolean
  /** True only for a structurally valid pi-ai OAuth grant at the fixed key. */
  readonly authorized: boolean
  readonly inFlight: boolean
  readonly phase: 'idle' | 'waiting' | 'authorized' | 'cancelled' | 'failed'
}

/** Device-code instructions approved for browser display. */
export interface CodexAuthNotice {
  readonly id: number
  readonly verificationUri: 'https://auth.openai.com/codex/device'
  readonly userCode: string
}
