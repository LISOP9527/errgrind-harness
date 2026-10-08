// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ErrorHistory, type ErrorHistoryProps } from '../src/client/ErrorHistory.tsx'
import { en, type ErrGrindKey } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const first = SessionId('error-open')
const second = SessionId('error-complete')
const drillSession = SessionId('drill-practice')
const unrelated = SessionId('generic-session')

type WorkspaceState = Parameters<Parameters<ErrorHistoryProps['useWorkspaces']>[0]>[0]

function workspaces(archivedSessionIds: WorkspaceState['archivedSessionIds']): WorkspaceState {
  return { items: [], archivedSessionIds, pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null }
}

function props(): ErrorHistoryProps {
  const list = {
    ids: [first, second, drillSession, unrelated],
    byId: {
      [first]: { displayTitle: 'first', updatedAt: 1_000, projectionValues: {
        errgrindEpisode: { description: '原来把分母相加', status: 'grill', drillEligible: false, kind: 'error' },
      } },
      [second]: { displayTitle: 'second', updatedAt: 1_000, projectionValues: {
        errgrindEpisode: { description: '忘记检查定义域', status: 'teach', drillEligible: true, kind: 'error' },
      } },
      [drillSession]: { displayTitle: '练习 1 · 定义域错误', updatedAt: 1_000, projectionValues: {
        errgrindEpisode: { description: '通分时忘了找公共分母', status: 'teach', drillEligible: false, kind: 'drill' },
      } },
      [unrelated]: { displayTitle: 'unrelated', updatedAt: 1_000, projectionValues: { errgrindEpisode: null } },
    },
  }
  const translate = (key: ErrGrindKey, params?: Record<string, string | number>): string =>
    en[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match))
  return {
    wide: true,
    expandSidebar: vi.fn(),
    useSessions: (selector: (state: typeof list) => unknown): unknown => selector(list),
    useWorkspaces: <T,>(selector: (state: WorkspaceState) => T): T => selector(workspaces([])),
    openSession: vi.fn(),
    archiveSession: vi.fn().mockResolvedValue(undefined),
    unarchiveSession: vi.fn().mockResolvedValue(undefined),
    t: translate,
  } as unknown as ErrorHistoryProps
}

describe('ErrGrind Error history', () => {
  it('lists Errors and practice Sessions as one-line titled rows', () => {
    const input = props()
    render(<ErrorHistory {...input} />)
    expect(screen.getByText('first')).toBeTruthy()
    expect(screen.getByText('second')).toBeTruthy()
    expect(screen.getByText('练习 1 · 定义域错误')).toBeTruthy()
    // The header counts Errors; practice Sessions share the list but are not Errors.
    expect(document.querySelector('[class*="count"]')?.textContent).toBe('2')

    fireEvent.click(screen.getByText('first'))
    expect(input.openSession).toHaveBeenCalledWith(first)
  })

  it('marks each row status through the shared status dot', () => {
    render(<ErrorHistory {...props()} />)
    const article = (title: string): HTMLElement =>
      screen.getByText(title).closest('article') as HTMLElement
    // grill → ongoing (spinner), teach → done, practice → idle.
    expect(article('first').querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(article('second').querySelector('[data-state="done"]')).not.toBeNull()
    expect(article('练习 1 · 定义域错误').querySelector('[data-state="done"]')).toBeNull()
    expect(article('练习 1 · 定义域错误').querySelector('[data-state="idle"]')).not.toBeNull()
    // Status names still reach assistive tech through the row's accessible name.
    const openButton = (title: string): HTMLElement =>
      article(title).querySelector('button') as HTMLElement
    expect(openButton('first').getAttribute('aria-label')).toContain('Asking follow-ups')
    expect(openButton('second').getAttribute('aria-label')).toContain('Diagnosis completed')
    expect(openButton('练习 1 · 定义域错误').getAttribute('aria-label')).toContain('Practice')
  })

  it('keeps the archive affordance on practice rows only', async () => {
    const input = props()
    render(<ErrorHistory {...input} />)
    expect(screen.getAllByRole('button', { name: 'Archive' })).toHaveLength(1)
    const drillRow = screen.getByText('练习 1 · 定义域错误').closest('article') as HTMLElement
    expect(within(drillRow).getByRole('button', { name: 'Archive' })).toBeTruthy()

    fireEvent.click(within(drillRow).getByRole('button', { name: 'Archive' }))
    await waitFor(() => { expect(input.archiveSession).toHaveBeenCalledWith(drillSession) })
    expect(input.archiveSession).not.toHaveBeenCalledWith(first)
    await waitFor(() => { expect(screen.getByText('Session archived.')).toBeTruthy() })
  })

  it('hides archived sessions from the list', () => {
    const input = props()
    input.useWorkspaces = <T,>(selector: (state: WorkspaceState) => T): T =>
      selector(workspaces([first]))
    render(<ErrorHistory {...input} />)
    expect(screen.queryByText('first')).toBeNull()
    expect(screen.getByText('second')).toBeTruthy()
  })

  it('restores an archived Error through the archived section', async () => {
    const input = props()
    input.useWorkspaces = <T,>(selector: (state: WorkspaceState) => T): T =>
      selector(workspaces([first, unrelated]))
    render(<ErrorHistory {...input} />)

    fireEvent.click(screen.getByRole('button', { name: /^Show archived/ }))
    expect(screen.getByText('Archived')).toBeTruthy()
    const archivedRow = screen.getByText('first').closest('article') as HTMLElement
    // Archived rows explain instead of opening: archived Sessions cannot be viewed.
    fireEvent.click(within(archivedRow).getByRole('button', { name: /first/ }))
    expect(screen.getByText('Archived sessions cannot be opened. Unarchive it to view.')).toBeTruthy()
    // An archived Session without a cached Error classification stays listed by title.
    expect(screen.getByText('unrelated')).toBeTruthy()

    fireEvent.click(within(archivedRow).getByRole('button', { name: 'Unarchive' }))
    await waitFor(() => { expect(input.unarchiveSession).toHaveBeenCalledWith(first) })
    await waitFor(() => { expect(screen.getByText('Session unarchived.')).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: /^Hide archived/ }))
    expect(screen.queryByText('Archived')).toBeNull()
  })

  it('leaves no trace of archived practice Sessions in the archived section', () => {
    const input = props()
    input.useWorkspaces = <T,>(selector: (state: WorkspaceState) => T): T =>
      selector(workspaces([first, drillSession]))
    render(<ErrorHistory {...input} />)

    fireEvent.click(screen.getByRole('button', { name: /^Show archived/ }))
    expect(screen.getByText('first')).toBeTruthy()
    expect(screen.queryByText('练习 1 · 定义域错误')).toBeNull()
  })

  it('surfaces an unarchive failure without dropping the row', async () => {
    const input = props()
    input.useWorkspaces = <T,>(selector: (state: WorkspaceState) => T): T =>
      selector(workspaces([first]))
    const failing = { ...input, unarchiveSession: vi.fn().mockRejectedValue(new Error('nope')) }
    render(<ErrorHistory {...failing} />)
    fireEvent.click(screen.getByRole('button', { name: /^Show archived/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }))
    await waitFor(() => {
      expect(screen.getByText('Could not unarchive this session. Please try again.')).toBeTruthy()
    })
    expect(screen.getByText('first')).toBeTruthy()
  })

  it('narrows the archived section to the search text', () => {
    const input = props()
    input.useWorkspaces = <T,>(selector: (state: WorkspaceState) => T): T =>
      selector(workspaces([first]))
    render(<ErrorHistory {...input} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '定义域' } })
    expect(screen.queryByRole('button', { name: /^Show archived/ })).toBeNull()
  })

  it('filters by title or public description without searching practice Sessions', () => {
    const input = props()
    render(<ErrorHistory {...input} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '定义域' } })
    expect(screen.getByText('second')).toBeTruthy()
    expect(screen.queryByText('first')).toBeNull()
    // The field names Error descriptions: practice Sessions stay listed but
    // never match it even when their own title or description would.
    expect(screen.queryByText('练习 1 · 定义域错误')).toBeNull()
  })
})
