/**
 * Narrow browser surface for the one Codex device-code authorization flow.
 * The browser may start and cancel this flow, but cannot select another
 * credential, answer arbitrary prompts, or read credential material.
 * @module @deepseek-ai/dsh-api-settings-controller/src/codex-auth
 */

import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
import type { AuthorizationService } from '@deepseek-ai/dsh-authorization'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { CodexAuthNotice, CodexAuthStatus } from './types.ts'

const CODEX_KEY = credentialKey('llm-pi-ai', 'openai-codex')
const DEVICE_URI = 'https://auth.openai.com/codex/device'
const MAX_NOTICES = 4

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the fixed Codex device-code Remote namespace. */
    codexAuthController: CodexAuthController
  }
}

/** Host Remote owner for the fixed `errgrindCodexAuth` namespace. */
export class CodexAuthController extends TypertRemoteService {
  private phase: CodexAuthStatus['phase'] = 'idle'
  private generation = 0
  private nextNotice = 1
  private notices: CodexAuthNotice[] = []

  /** @param ctx - Host context carrying authorization and credential services. */
  constructor(ctx: Context) {
    super(ctx, 'codexAuthController', { namespace: 'errgrindCodexAuth' })
    // A Host profile reload must not leave a device-code flow holding the key.
    ctx.effect(function* (this: CodexAuthController) {
      yield () => { this.cancelAttempt() }
    }.bind(this), 'CodexAuthController lifecycle')
  }

  /**
   * Read whether the fixed device-code flow is available and its safe lifecycle state.
   * @returns no credential or authorization payload.
   */
  @Remote
  async status(): Promise<CodexAuthStatus> {
    const authorization = this.authorization()
    const credentials = this.credentials()
    const flow = authorization?.describe(CODEX_KEY)
    let authorized = false
    try {
      const record = credentials === undefined ? undefined : await credentials.readRecord(CODEX_KEY)
      authorized = isPiOAuthGrant(record)
    } catch {
      // A store or provider error must not turn into browser-visible details.
      if (this.phase !== 'waiting') this.phase = 'failed'
    }
    return {
      available: flow?.methods.some(method => method.id === 'oauth') ?? false,
      authorized,
      inFlight: flow?.inFlight ?? false,
      phase: this.phase,
    }
  }

  /**
   * Start the fixed Codex OAuth flow and return immediately; callers poll `notices` and `status`.
   * @returns whether this call admitted a new attempt.
   */
  @Remote
  beginDeviceCode(): { readonly started: boolean } {
    const authorization = this.authorization()
    const flow = authorization?.describe(CODEX_KEY)
    if (authorization === undefined || flow?.methods.some(method => method.id === 'oauth') !== true || flow.inFlight) {
      return { started: false }
    }
    this.notices = []
    this.phase = 'waiting'
    const generation = ++this.generation
    // begin() claims the key synchronously before its first await. Keep the
    // Remote request short, and intentionally do not relay provider errors.
    void authorization.begin({
      key: CODEX_KEY,
      method: 'oauth',
      interaction: {
        notify: (notice) => {
          if (generation === this.generation) this.captureDeviceCodeNotice(notice)
        },
        prompt: (prompt) => {
          if (generation !== this.generation) return Promise.reject(new AuthorizationDeclinedError())
          if (prompt.kind === 'select' && prompt.options.some(option => option.id === 'device_code')) {
            return Promise.resolve('device_code')
          }
          return Promise.reject(new AuthorizationDeclinedError())
        },
      },
    }).then((outcome) => {
      if (generation === this.generation) this.phase = outcome.status === 'authorized' ? 'authorized' : 'cancelled'
    }, () => {
      if (generation === this.generation) this.phase = 'failed'
    })
    return { started: true }
  }

  /**
   * Poll only validated device-code instructions emitted by this attempt.
   * @param after - last notice id already displayed by the caller.
   * @returns bounded safe notices and the latest cursor.
   */
  @Remote
  noticesAfter(after: number): { readonly notices: readonly CodexAuthNotice[]; readonly next: number } {
    const cursor = Number.isSafeInteger(after) && after >= 0 ? after : 0
    return {
      notices: this.notices.filter(notice => notice.id > cursor).map(notice => ({ ...notice })),
      next: this.nextNotice - 1,
    }
  }

  /** Cancel the in-flight attempt for the fixed credential key. */
  @Remote
  cancel(): void {
    this.cancelAttempt()
  }

  private captureDeviceCodeNotice(notice: { readonly url?: string; readonly code?: string }): void {
    if (notice.url !== DEVICE_URI || notice.code === undefined || !/^[A-Z0-9-]{4,16}$/.test(notice.code)) return
    const captured: CodexAuthNotice = {
      id: this.nextNotice++,
      verificationUri: DEVICE_URI,
      userCode: notice.code,
    }
    this.notices.push(captured)
    if (this.notices.length > MAX_NOTICES) this.notices.shift()
  }

  private cancelAttempt(): void {
    if (this.phase !== 'waiting') return
    const authorization = this.authorization()
    this.generation++
    if (authorization?.describe(CODEX_KEY)?.inFlight === true) authorization.cancel(CODEX_KEY)
    this.phase = 'cancelled'
    this.notices = []
  }

  private authorization(): AuthorizationService | undefined { return this.ctx.get('authorization') }
  private credentials(): CredentialProvider | undefined { return this.ctx.get('credentials') }
}

/** Validate only the non-secret structural discriminants needed for the safe status bit. */
function isPiOAuthGrant(record: CredentialRecord | undefined): boolean {
  if (record?.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) return false
  const payload = record.payload as Record<string, unknown>
  return payload.type === 'oauth'
    && typeof payload.access === 'string' && payload.access.length > 0
    && typeof payload.refresh === 'string' && payload.refresh.length > 0
    && typeof payload.expires === 'number' && Number.isFinite(payload.expires)
}
