/** Account-visible Codex models; only model identifiers cross into the selector. */

import type { Models } from '@earendil-works/pi-ai'
import { LlmError } from '@deepseek-ai/dsh-llm'

const MODELS_URL = 'https://chatgpt.com/backend-api/codex/models'
// The Codex backend gates its catalog by client version. Keep this protocol
// value separate from the pi-ai package version and update it deliberately.
const CLIENT_VERSION = '0.153.4'
const ACCOUNT_CLAIM = 'https://api.openai.com/auth'

function accountIdFromToken(token: string): string {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('invalid token')
    const encodedPayload = parts[1]
    if (encodedPayload === undefined) throw new Error('invalid token')
    const payload: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    if (typeof payload !== 'object' || payload === null) throw new Error('invalid payload')
    const claim = (payload as Record<string, unknown>)[ACCOUNT_CLAIM]
    const accountId = typeof claim === 'object' && claim !== null
      ? (claim as Record<string, unknown>).chatgpt_account_id : undefined
    if (typeof accountId !== 'string' || accountId.length === 0) throw new Error('missing account')
    return accountId
  } catch {
    throw new LlmError('Codex account metadata is unavailable', 'DISCOVERY_FAILED')
  }
}

/**
 * Fetch only slugs advertised to this signed-in account, with no prompt metadata.
 * @param models - pi-ai Models registry used to resolve the Codex credential.
 * @param fetcher - fetch implementation; defaults to the ambient fetch for tests.
 * @returns account-visible Codex model slugs; empty without a Codex authorization.
 */
export async function currentCodexModelIds(
  models: Pick<Models, 'getAuth'>,
  fetcher: typeof fetch = fetch,
): Promise<ReadonlySet<string>> {
  const token = (await models.getAuth('openai-codex'))?.auth.apiKey
  if (token === undefined) return new Set()
  const accountId = accountIdFromToken(token)
  const url = new URL(MODELS_URL)
  url.searchParams.set('client_version', CLIENT_VERSION)
  let response: Response
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'chatgpt-account-id': accountId,
        originator: 'errgrind',
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new LlmError('Codex model catalog could not be reached', 'DISCOVERY_FAILED')
  }
  if (!response.ok) {
    throw new LlmError(`Codex model catalog returned HTTP ${response.status}`, 'DISCOVERY_FAILED')
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new LlmError('Codex model catalog was invalid', 'DISCOVERY_FAILED')
  }
  if (typeof payload !== 'object' || payload === null
    || !Array.isArray((payload as Record<string, unknown>).models)) {
    throw new LlmError('Codex model catalog was invalid', 'DISCOVERY_FAILED')
  }
  const entries = (payload as { models: unknown[] }).models
  const ids = new Set<string>()
  for (const item of entries) {
    if (typeof item !== 'object' || item === null) continue
    const model = item as Record<string, unknown>
    if (model.visibility === 'list' && typeof model.slug === 'string' && model.slug.length > 0) {
      ids.add(model.slug)
    }
  }
  return ids
}
