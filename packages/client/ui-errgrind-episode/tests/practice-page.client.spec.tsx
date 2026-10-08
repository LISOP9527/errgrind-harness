// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { PracticePage, type PracticePageProps } from '../src/client/PracticePage.tsx'
import { en, type ErrGrindKey } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const eligible = SessionId('error-eligible')
const secondEligible = SessionId('error-eligible-2')
const unconfirmed = SessionId('error-unconfirmed')
const drillSession = SessionId('drill-practice')
const archivedError = SessionId('error-archived')

type WorkspaceState = Parameters<Parameters<PracticePageProps['useWorkspaces']>[0]>[0]

function workspaces(archivedSessionIds: WorkspaceState['archivedSessionIds']): WorkspaceState {
  return { items: [], archivedSessionIds, pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null }
}

function props(archivedSessionIds: WorkspaceState['archivedSessionIds'] = []): PracticePageProps {
  const list = {
    ids: [eligible, secondEligible, unconfirmed, drillSession, archivedError],
    byId: {
      [eligible]: { displayTitle: '分母相加', updatedAt: 1_000, projectionValues: {
        errgrindEpisode: { description: 'added numerators', status: 'teach', drillEligible: true, kind: 'error' },
      } },
      [secondEligible]: { displayTitle: '定义域', updatedAt: 1_000, projectionValues: {
        errgrindEpisode: { description: 'missed domain', status: 'teach', drillEligible: true, kind: 'error' },
      } },
      [unconfirmed]: { displayTitle: 'unconfirmed', updatedAt: 1_000, projectionValues: {
        errgrindEpisode: { description: 'draft only', status: 'grill', drillEligible: false, kind: 'error' },
      } },
      [drillSession]: { displayTitle: '练习 1 · 分母相加', updatedAt: 1_000, projectionValues: {
        errgrindEpisode: { description: 'added numerators', status: 'teach', drillEligible: false, kind: 'drill' },
      } },
      [archivedError]: { displayTitle: 'archived', updatedAt: 1_000, projectionValues: {
        errgrindEpisode: { description: 'old error', status: 'teach', drillEligible: true, kind: 'error' },
      } },
    },
  }
  const translate = (key: ErrGrindKey, params?: Record<string, string | number>): string =>
    en[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match))
  return {
    wide: true,
    expandSidebar: vi.fn(),
    useSessions: (selector: (state: typeof list) => unknown): unknown => selector(list),
    useWorkspaces: <T,>(selector: (state: WorkspaceState) => T): T => selector(workspaces(archivedSessionIds)),
    openSession: vi.fn(),
    practiceFromError: vi.fn().mockResolvedValue(undefined),
    practiceFromPool: vi.fn().mockResolvedValue(undefined),
    t: translate,
  } as unknown as PracticePageProps
}

describe('Practice page', () => {
  it('lists only drillable confirmed Errors — no drill Sessions, drafts, or archived rows', () => {
    render(<PracticePage {...props([archivedError])} />)
    expect(screen.getByText('分母相加')).toBeTruthy()
    expect(screen.getByText('定义域')).toBeTruthy()
    expect(screen.queryByText('unconfirmed')).toBeNull()
    expect(screen.queryByText('练习 1 · 分母相加')).toBeNull()
    expect(screen.queryByText('archived')).toBeNull()
  })

  it('drills one Error straight from its row', async () => {
    const input = props([archivedError])
    render(<PracticePage {...input} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Practice this one' })[0]!)
    await waitFor(() => {
      expect(input.practiceFromError).toHaveBeenCalledWith(eligible, expect.any(Function))
    })
    const title = vi.mocked(input.practiceFromError).mock.calls[0]![1]
    expect(title(0)).toBe('Practice 1 · 分母相加')
    await waitFor(() => { expect(screen.getByText('Practice Session opened.')).toBeTruthy() })
  })

  it('select-all toggles the whole candidate pool and the pool call carries the selection', async () => {
    const input = props([archivedError])
    render(<PracticePage {...input} />)
    const pool = screen.getByRole('button', { name: 'Pick one from the selected Errors' })
    expect((pool as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(screen.getByText('2 selected')).toBeTruthy()
    fireEvent.click(pool)
    await waitFor(() => {
      expect(input.practiceFromPool).toHaveBeenCalledWith([eligible, secondEligible], expect.any(Function))
    })
    const title = vi.mocked(input.practiceFromPool).mock.calls[0]![1]
    expect(title(0)).toBe('Practice 1 · Pool')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(screen.getByText('0 selected')).toBeTruthy()
  })

  it('narrows the pool to the checked subset', async () => {
    const input = props([archivedError])
    render(<PracticePage {...input} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '定义域' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick one from the selected Errors' }))
    await waitFor(() => {
      expect(input.practiceFromPool).toHaveBeenCalledWith([secondEligible], expect.any(Function))
    })
  })

  it('reports a failed open without losing the selection', async () => {
    const input = props([archivedError])
    const failing = { ...input, practiceFromPool: vi.fn().mockRejectedValue(new Error('offline')) }
    render(<PracticePage {...failing} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick one from the selected Errors' }))
    await waitFor(() => {
      expect(screen.getByText('Could not create the practice Session.')).toBeTruthy()
    })
    expect(screen.getByText('2 selected')).toBeTruthy()
  })

  it('shows the empty state when nothing is drillable', () => {
    const input = props()
    render(<PracticePage {...{
      ...input,
      useSessions: (selector: (state: { ids: string[]; byId: Record<string, never> }) => unknown) =>
        selector({ ids: [], byId: {} }),
    } as PracticePageProps} />)
    expect(screen.getByText(/Nothing to practice yet/)).toBeTruthy()
  })
})
