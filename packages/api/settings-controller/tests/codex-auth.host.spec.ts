import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import AuthorizationService, { type AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { CodexAuthController } from '../src/codex-auth.ts'
import { MemoryCredentials } from '../../../credentials/authorization/tests/memory.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const contexts: Context[] = []

async function harness(run: (session: AuthorizationSession) => Promise<void>) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  ctx.authorization.registerFlow({
    key: KEY,
    label: 'ChatGPT (Codex)',
    methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
    run,
  })
  return { ctx, controller: new CodexAuthController(ctx) }
}

async function settle(controller: CodexAuthController) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const status = await controller.status()
    if (status.phase !== 'waiting') return status
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('Codex authorization did not settle')
}

async function waitForFlowIdle(ctx: Context) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (ctx.authorization.describe(KEY)?.inFlight !== true) return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('Codex authorization slot did not release')
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('fixed Codex OAuth Remote', () => {
  it('returns only a validated device code and safe grant status', async () => {
    const { controller } = await harness(async (session) => {
      session.notify({
        message: 'ignore arbitrary text', url: 'https://evil.example/?token=x', code: 'Bearer-secret',
      })
      session.notify({
        message: 'provider text is ignored', url: 'https://auth.openai.com/codex/device', code: 'WXYZ-1234',
      })
      const answer = await session.prompt({
        kind: 'select', message: 'choose device-code flow', options: [{ id: 'device_code', label: 'Device code' }],
      })
      expect(answer).toBe('device_code')
      await session.commit({
        kind: 'grant', payload: { type: 'oauth', access: 'access-secret', refresh: 'refresh-secret', expires: 123 },
      })
    })

    expect(controller.beginDeviceCode()).toEqual({ started: true })
    expect(await settle(controller)).toMatchObject({ available: true, authorized: true, phase: 'authorized' })
    const view = controller.noticesAfter(0)
    expect(view.notices).toEqual([{
      id: 1, verificationUri: 'https://auth.openai.com/codex/device', userCode: 'WXYZ-1234',
    }])
    expect(JSON.stringify({ status: await controller.status(), view })).not.toContain('access-secret')
    expect(JSON.stringify({ status: await controller.status(), view })).not.toContain('refresh-secret')
    expect(JSON.stringify(view)).not.toContain('evil.example')
  })

  it('declines text and secret prompts without exposing their result', async () => {
    for (const kind of ['text', 'secret'] as const) {
      const { controller } = await harness(async (session) => {
        await session.prompt({ kind, message: 'enter credential material' })
        throw new Error('unreachable')
      })

      expect(controller.beginDeviceCode()).toEqual({ started: true })
      expect(await settle(controller)).toMatchObject({ authorized: false, phase: 'cancelled' })
      expect(controller.noticesAfter(0).notices).toEqual([])
    }
  })

  it('does not let a cancelled attempt publish notices into a restarted attempt', async () => {
    let releaseOld!: () => void
    const oldWork = new Promise<void>((resolve) => { releaseOld = resolve })
    let runs = 0
    const { ctx, controller } = await harness(async (session) => {
      runs++
      if (runs === 1) {
        await oldWork
        session.notify({ url: 'https://auth.openai.com/codex/device', code: 'OLD-CODE' })
        return
      }
      session.notify({ url: 'https://auth.openai.com/codex/device', code: 'NEW-CODE' })
      const answer = await session.prompt({
        kind: 'select', message: 'choose device-code flow', options: [{ id: 'device_code', label: 'Device code' }],
      })
      expect(answer).toBe('device_code')
      await session.commit({ kind: 'grant', payload: { type: 'oauth', access: 'a', refresh: 'r', expires: 1 } })
    })

    controller.beginDeviceCode()
    controller.cancel()
    await waitForFlowIdle(ctx)
    expect(controller.beginDeviceCode()).toEqual({ started: true })
    releaseOld()
    await settle(controller)
    expect(controller.noticesAfter(0).notices.map(notice => notice.userCode)).toEqual(['NEW-CODE'])
    expect(ctx.authorization.describe(KEY)?.inFlight).toBe(false)
  })
})
