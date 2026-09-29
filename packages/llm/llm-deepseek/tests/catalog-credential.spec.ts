import { describe, expect, it, vi } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { DeepSeekAdapter, resolveAdapterOptions } from '../src/index.ts'

function adapter(resolveApiKey: () => Promise<string>, hide: boolean) {
  return new DeepSeekAdapter({
    options: () => resolveAdapterOptions({ models: [{ id: 'deepseek-test' }] }),
    hideModelsWithoutCredential: () => hide,
    resolveApiKey,
    resolveUserId: () => '00000000-0000-4000-8000-000000000001' as never,
    resolveAttachments: () => undefined,
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
  })
}

describe('DeepSeek credential-gated catalog', () => {
  it('hides models in the ErrGrind profile when no key is available', async () => {
    const resolve = vi.fn(async () => { throw new LlmError('missing', 'MISSING_CREDENTIAL') })
    expect(await adapter(resolve, true).listModels('deepseek-official')).toEqual([])
    expect(resolve).toHaveBeenCalledOnce()
  })

  it('still lists models when the key exists', async () => {
    const models = await adapter(async () => 'key', true).listModels('deepseek-official')
    expect(models.map(model => model.id)).toEqual(['deepseek-test'])
  })
})
