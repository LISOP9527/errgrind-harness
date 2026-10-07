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
      [drillSession]: { displayTitle: '练习 · 定义域错误', updatedAt: 1_000, projectionValues: {
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
    practiceFromError: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
    archiveSession: vi.fn().mockResolvedValue(undefined),
    unarchiveSession: vi.fn().mockResolvedValue(undefined),
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
    await waitFor(() => {
      expect(input.practiceFromError).toHaveBeenCalledWith(second, expect.any(Function))
    })
    const title = vi.mocked(input.practiceFromError).mock.calls[0]![1]
    expect(title(0)).toBe('Practice · 忘记检查定义域')
    expect(title(1)).toBe('Practice 2 · 忘记检查定义域')
    expect(input.practiceFromError).not.toHaveBeenCalledWith(first, expect.anything())
  })

  it('labels Drill Sessions as practice and gates archiving to them', async () => {
    const input = props()
    render(<ErrorHistory {...input} />)
    const drillCard = screen.getByText('练习 · 定义域错误').closest('article')
    expect(drillCard?.textContent).toContain('Practice')
    expect(within(drillCard as HTMLElement).queryByRole('button', { name: 'Practice from this Error' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Archive' })).toHaveLength(1)
    // The header counts Errors; practice Sessions share the list but are not Errors.
    expect(document.querySelector('[class*="count"]')?.textContent).toBe('2')

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(() => { expect(input.archiveSession).toHaveBeenCalledWith(drillSession) })
    expect(input.archiveSession).not.toHaveBeenCalledWith(first)
  })

  it('renames the session title in place', async () => {
    const input = props()
    render(<ErrorHistory {...input} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0]!)
    const editor = screen.getByRole('textbox', { name: 'New session title' })
    fireEvent.change(editor, { target: { value: '新的名字' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(input.renameSession).toHaveBeenCalledWith(first, '新的名字') })
  })

  it('hides archived sessions from the list', () => {
    const input = props()
    input.useWorkspaces = <T,>(selector: (state: WorkspaceState) => T): T =>
      selector(workspaces([first]))
    render(<ErrorHistory {...input} />)
    expect(screen.queryByText('原来把分母相加')).toBeNull()
    expect(screen.getByText('忘记检查定义域')).toBeTruthy()
  })

  it('restores an archived Error through the archived section', async () => {
    const input = props()
    input.useWorkspaces = <T,>(selector: (state: WorkspaceState) => T): T =>
      selector(workspaces([first, unrelated]))
    render(<ErrorHistory {...input} />)

    fireEvent.click(screen.getByRole('button', { name: /^Show archived/ }))
    const archivedCard = screen.getByText('first').closest('article')
    expect(archivedCard).not.toBeNull()
    expect(archivedCard?.textContent).toContain('Archived')
    // Archived rows explain instead of opening: archived Sessions cannot be viewed.
    fireEvent.click(within(archivedCard as HTMLElement).getByRole('button', { name: /first/ }))
    expect(screen.getByText('Archived sessions cannot be opened. Unarchive it to view.')).toBeTruthy()
    // An archived Session without a cached Error classification stays listed by title.
    expect(screen.getByText('unrelated')).toBeTruthy()

    fireEvent.click(within(archivedCard as HTMLElement).getByRole('button', { name: 'Unarchive' }))
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
    expect(screen.queryByText('练习 · 定义域错误')).toBeNull()
    expect(screen.queryByText('通分时忘了找公共分母')).toBeNull()
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

  it('filters public descriptions without searching private Session content', () => {
    const input = props()
    render(<ErrorHistory {...input} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '定义域' } })
    expect(screen.getByText('忘记检查定义域')).toBeTruthy()
    expect(screen.queryByText('原来把分母相加')).toBeNull()
  })
})
