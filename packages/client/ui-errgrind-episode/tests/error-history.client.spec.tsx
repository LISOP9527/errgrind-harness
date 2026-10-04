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

type WorkspaceState = Parameters<Parameters<ErrorHistoryProps['useWorkspaces']>[0]>[0]

function workspaces(archivedSessionIds: WorkspaceState['archivedSessionIds']): WorkspaceState {
  return { items: [], archivedSessionIds, pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null }
}

function props(): ErrorHistoryProps {
  const list = {
    ids: [first, second, unrelated],
    byId: {
      [first]: { displayTitle: 'first', updatedAt: 1_000, projectionValues: {
        errgrindEpisode: { description: '原来把分母相加', status: 'grill', drillEligible: false },
      } },
      [second]: { displayTitle: 'second', updatedAt: 1_000, projectionValues: {
        errgrindEpisode: { description: '忘记检查定义域', status: 'teach', drillEligible: true },
      } },
      [unrelated]: { displayTitle: 'unrelated', updatedAt: 1_000, projectionValues: { errgrindEpisode: null } },
    },
  }
  const translate = (key: ErrGrindKey): string => en[key]
  return {
    wide: true,
    expandSidebar: vi.fn(),
    useSessions: (selector: (state: typeof list) => unknown): unknown => selector(list),
    useWorkspaces: <T,>(selector: (state: WorkspaceState) => T): T => selector(workspaces([])),
    openSession: vi.fn(),
    practiceFromError: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
    archiveSession: vi.fn().mockResolvedValue(undefined),
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

  it('renames the session title in place and archives a row', async () => {
    const input = props()
    render(<ErrorHistory {...input} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0]!)
    const editor = screen.getByRole('textbox', { name: 'New session title' })
    fireEvent.change(editor, { target: { value: '新的名字' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(input.renameSession).toHaveBeenCalledWith(first, '新的名字') })

    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[1]!)
    await waitFor(() => { expect(input.archiveSession).toHaveBeenCalledWith(second) })
  })

  it('hides archived sessions from the list', () => {
    const input = props()
    input.useWorkspaces = <T,>(selector: (state: WorkspaceState) => T): T =>
      selector(workspaces([first]))
    render(<ErrorHistory {...input} />)
    expect(screen.queryByText('原来把分母相加')).toBeNull()
    expect(screen.getByText('忘记检查定义域')).toBeTruthy()
  })

  it('filters public descriptions without searching private Session content', () => {
    const input = props()
    render(<ErrorHistory {...input} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '定义域' } })
    expect(screen.getByText('忘记检查定义域')).toBeTruthy()
    expect(screen.queryByText('原来把分母相加')).toBeNull()
  })
})
