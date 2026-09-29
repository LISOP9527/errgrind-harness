// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ErrorHistory, type ErrorHistoryProps } from '../src/client/ErrorHistory.tsx'
import { en, type ErrGrindKey } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const first = SessionId('error-open')
const second = SessionId('error-complete')
const unrelated = SessionId('generic-session')

function props(): ErrorHistoryProps {
  const list = {
    ids: [first, second, unrelated],
    byId: {
      [first]: { displayTitle: 'first', projectionValues: {
        errgrindEpisode: { description: '原来把分母相加', status: 'grill', drillEligible: false },
      } },
      [second]: { displayTitle: 'second', projectionValues: {
        errgrindEpisode: { description: '忘记检查定义域', status: 'teach', drillEligible: true },
      } },
      [unrelated]: { displayTitle: 'unrelated', projectionValues: { errgrindEpisode: null } },
    },
  }
  const translate = (key: ErrGrindKey): string => en[key]
  return {
    wide: true,
    expandSidebar: vi.fn(),
    useSessions: (selector: (state: typeof list) => unknown): unknown => selector(list),
    openSession: vi.fn(),
    practiceFromError: vi.fn().mockResolvedValue(undefined),
    t: translate,
  } as unknown as ErrorHistoryProps
}

describe('ErrGrind Error history', () => {
  it('lists only Errors and offers Drill only for the selected eligible Error', async () => {
    const input = props()
    render(<ErrorHistory {...input} />)
    expect(screen.getByText('原来把分母相加')).toBeTruthy()
    expect(screen.getByText('忘记检查定义域')).toBeTruthy()
    expect(screen.queryByText('unrelated')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Practice from this Error' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Practice from this Error' }))
    await waitFor(() => { expect(input.practiceFromError).toHaveBeenCalledWith(second) })
    expect(input.practiceFromError).not.toHaveBeenCalledWith(first)
  })

  it('filters public descriptions without searching private Session content', () => {
    const input = props()
    render(<ErrorHistory {...input} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '定义域' } })
    expect(screen.getByText('忘记检查定义域')).toBeTruthy()
    expect(screen.queryByText('原来把分母相加')).toBeNull()
  })
})
