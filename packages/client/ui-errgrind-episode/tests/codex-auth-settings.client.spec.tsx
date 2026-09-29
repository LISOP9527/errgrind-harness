// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexAuthSettings } from '../src/client/CodexAuthSettings.tsx'
import type { CodexAuthRemote } from '../src/client/CodexAuthSettings.tsx'
import { en, type ErrGrindKey } from '../src/client/locales.ts'

const notice = {
  id: 1,
  verificationUri: 'https://auth.openai.com/codex/device',
  userCode: 'ABCD-1234',
}

const ok = <Value,>(value: Value) => ({ ok: true as const, value })

function auth(overrides: Partial<CodexAuthRemote> = {}): CodexAuthRemote {
  return {
    status: vi.fn().mockResolvedValue(ok({ available: true, authorized: false, inFlight: false, phase: 'idle' })),
    beginDeviceCode: vi.fn().mockResolvedValue(ok({ started: true })),
    noticesAfter: vi.fn().mockResolvedValue(ok({ notices: [notice], next: notice.id })),
    cancel: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  }
}

function mount(remote: CodexAuthRemote) {
  return render(<CodexAuthSettings auth={remote} t={(key: ErrGrindKey) => en[key]} />)
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ErrGrind Codex authorization settings', () => {
  it('shows the fixed device URL and copyable one-time code after starting sign-in', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const status = vi.fn()
      .mockResolvedValueOnce(ok({ available: true, authorized: false, inFlight: false, phase: 'idle' }))
      .mockResolvedValue(ok({ available: true, authorized: false, inFlight: true, phase: 'waiting' }))
    const remote = auth({ status })
    mount(remote)

    fireEvent.click(await screen.findByRole('button', { name: en['codex.signIn'] }))

    const link = await screen.findByRole('link', { name: en['codex.open'] })
    expect(link.getAttribute('href')).toBe(notice.verificationUri)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(screen.getByText(notice.userCode).tagName).toBe('CODE')
    fireEvent.click(screen.getByRole('button', { name: en['codex.copy'] }))
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith(notice.userCode) })
    expect(screen.getByRole('button', { name: en['codex.copied'] })).toBeTruthy()
    expect(remote.beginDeviceCode).toHaveBeenCalledOnce()
  })

  it('shows a safe failure and lets the user retry when the Host cannot start sign-in', async () => {
    const remote = auth({ beginDeviceCode: vi.fn().mockRejectedValue(new Error('private host detail')) })
    mount(remote)

    fireEvent.click(await screen.findByRole('button', { name: en['codex.signIn'] }))

    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(en['codex.failed']) })
    expect(screen.queryByText('private host detail')).toBeNull()
    expect(screen.getByRole('button', { name: en['codex.retry'] })).toBeTruthy()
  })

  it('cancels an active device flow and displays its terminal state', async () => {
    const status = vi.fn()
      .mockResolvedValueOnce(ok({ available: true, authorized: false, inFlight: true, phase: 'waiting' }))
      .mockResolvedValue(ok({ available: true, authorized: false, inFlight: false, phase: 'cancelled' }))
    const remote = auth({ status })
    mount(remote)

    fireEvent.click(await screen.findByRole('button', { name: en['codex.cancel'] }))

    await waitFor(() => { expect(remote.cancel).toHaveBeenCalledOnce() })
    expect(await screen.findByText(en['codex.cancelled'])).toBeTruthy()
  })

  it('clears its polling timer when the card unmounts', async () => {
    vi.useFakeTimers()
    const remote = auth()
    const rendered = mount(remote)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(remote.status).toHaveBeenCalledOnce()

    rendered.unmount()
    await act(async () => { vi.advanceTimersByTime(3000) })

    expect(remote.status).toHaveBeenCalledOnce()
  })
})
