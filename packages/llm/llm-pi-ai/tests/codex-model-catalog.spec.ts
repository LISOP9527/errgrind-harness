import { describe, expect, it, vi } from 'vitest'
import { currentCodexModelIds } from '../src/codex-model-catalog.ts'
import { catalogModels } from '../src/catalog.ts'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'

const token = `header.${Buffer.from(JSON.stringify({
  'https://api.openai.com/auth': { chatgpt_account_id: 'account-test' },
})).toString('base64url')}.signature`

describe('Codex account model catalog', () => {
  it('has routable metadata for Sol and Luna even with the older installed pi-ai catalog', () => {
    const catalog = catalogModels('openai-codex')
    for (const id of ['gpt-6-sol', 'gpt-6-luna']) {
      const model = catalog.get(id)
      expect(model?.api).toBe('openai-codex-responses')
      expect(model?.input).toContain('image')
      expect(model?.contextWindow).toBe(272000)
      expect(model?.thinkingLevelMap?.off).toBe('none')
    }
  })

  it('keeps only visible slugs and sends credentials only to the fixed endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ models: [
      { slug: 'gpt-6-sol', visibility: 'list', base_instructions: 'private' },
      { slug: 'retired', visibility: 'hidden' },
      { slug: 'gpt-6-luna', visibility: 'list' },
    ] }), { status: 200 })) as unknown as typeof fetch
    const models = { getAuth: vi.fn(async () => ({ auth: { apiKey: token } })) }
    const ids = await currentCodexModelIds(models, fetcher)
    expect([...ids]).toEqual(['gpt-6-sol', 'gpt-6-luna'])
    const [url, options] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://chatgpt.com')
    expect(url.pathname).toBe('/backend-api/codex/models')
    expect(url.searchParams.get('client_version')).toBe('0.153.4')
    expect(options.method).toBe('GET')
    expect(options.redirect).toBe('error')
    expect(options.headers).toMatchObject({ 'chatgpt-account-id': 'account-test' })
    expect(JSON.stringify([...ids])).not.toContain('private')
  })

  it('returns no choices without Codex authorization', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const ids = await currentCodexModelIds({ getAuth: async () => undefined }, fetcher)
    expect(ids.size).toBe(0)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('lists only account-visible Sol and Luna and resolves both for requests', async () => {
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({ 'openai-codex': {} }),
      resolveApiKey: async () => undefined,
      auth: memoryAuth(),
      codexModelIds: async () => new Set(['gpt-6-sol', 'gpt-6-luna', 'retired']),
    })
    expect((await adapter.listModels('openai-codex')).map(model => model.id))
      .toEqual(['gpt-6-sol', 'gpt-6-luna'])
    for (const id of ['gpt-6-sol', 'gpt-6-luna']) {
      const model = await adapter.resolveModel('openai-codex', id)
      expect(model.id).toBe(id)
      expect(model.inputModalities).toContain('image')
    }
  })
})
