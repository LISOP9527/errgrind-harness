import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceActiveSessionError } from '@deepseek-ai/dsh-workspace'
import type { SessionProjectionStateMap } from '@deepseek-ai/dsh-session-projection/types'
import type { DrillAttempt } from '@errgrind/episode'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createSessionTestController, installSessionReadTestServices, testSessionPersistence } from './test-remote.ts'

const defaults = {
  defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
  cwd: '/tmp',
}

interface Harness {
  ctx: Context
  archives: SessionId[]
  failArchive: { value: 'active' | 'generic' | false }
  episodes: Map<string, unknown>
  followups: Map<string, { count: number; kinds: string[] }>
  renames: string[]
  failRename: { value: boolean }
  workspaces: { id: string; path: string; sessionIds: SessionId[]; attachSession: (id: SessionId) => Promise<void> }[]
}

/** Direct Session Controller harness with episodic state and archive doubles. */
async function harness(): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    list: () => Promise.resolve([]),
  }) as never)
  const episodes = new Map<string, unknown>()
  installSessionReadTestServices(ctx)
  const readState = ctx.sessionProjections.stateOf.bind(ctx.sessionProjections)
  vi.spyOn(ctx.sessionProjections, 'stateOf').mockImplementation(((session: Session, key: keyof SessionProjectionStateMap) =>
    episodes.has(`${session.id}:${key}`) ? episodes.get(`${session.id}:${key}`) : readState(session, key)) as never)
  const archives: SessionId[] = []
  const failArchive: Harness['failArchive'] = { value: false }
  const workspaces: Harness['workspaces'] = []
  ctx.provide('workspaceRegistry', {
    archivedSessionIds: [] as SessionId[],
    list: () => workspaces,
    get: (id: string) => workspaces.find(workspace => workspace.id === id),
    archiveSession: vi.fn(async (sessionId: SessionId) => {
      const failure = failArchive.value
      failArchive.value = false
      if (failure === 'active') throw new WorkspaceActiveSessionError(sessionId, [])
      if (failure === 'generic') throw new Error('registry unavailable')
      archives.push(sessionId)
    }),
  } as never)
  const followups = new Map<string, { count: number; kinds: string[] }>()
  const renames: string[] = []
  const failRename: Harness['failRename'] = { value: false }
  ctx.provide('sessionTitle', {
    rename: (_session: Session, title: string) => {
      if (failRename.value) throw new Error('rename backend down')
      renames.push(title)
    },
  } as never)
  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const nextTurn: { source?: { kind: string } }[] = []
      const agent = {
        id: session.id,
        options: {},
        session,
        inbox: { nextTurn, nextStep: [] },
        status: 'idle',
        ctx,
        send: () => {},
        followup: (message: { source?: { kind: string } }) => {
          const entry = followups.get(session.id) ?? { count: 0, kinds: [] as string[] }
          entry.count += 1
          entry.kinds.push(message.source?.kind ?? 'user')
          followups.set(session.id, entry)
          nextTurn.push(message)
        },
        steer: () => {},
        inject: () => {},
        cancel: () => {},
        runMaintenance: (task: (signal: AbortSignal) => unknown) => task(new AbortController().signal),
        whenIdle: () => Promise.resolve(),
      } as unknown as Agent
      await options.setup?.(ctx, agent)
      const unregister = await ctx.agents.register(agent)
      return { agent, dispose: async () => { await unregister() } }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  createSessionTestController(ctx, defaults)
  return { ctx, archives, failArchive, episodes, followups, renames, failRename, workspaces }
}

function attempt(isCorrect: boolean): DrillAttempt {
  return {
    preparationId: 'prep-1', answerSourceRef: 'answer-1', userResponse: '4/12',
    isCorrect, feedback: 'verdict', judgeProvider: 'fixture', judgeModel: 'fixture-model',
    derivedError: isCorrect ? null : {
      id: 'drill:prep-1', origin: 'drill', sourcePreparationId: 'prep-1',
      question: 'What is 3/4 + 1/8?', userResponse: '4/12', referenceAnswer: '7/8',
    },
    judgedAtTurn: 1,
  }
}

/** An idle Agent double; the settle path reads only its Session and inbox. */
function agentDouble(ctx: Context, session: Session): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: { nextTurn: [], nextStep: [] } as never,
    status: 'idle',
    ctx,
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** A registered idle Agent double; the settle path reads only its Session. */
async function liveAgent(ctx: Context, session: Session): Promise<Agent> {
  const agent = agentDouble(ctx, session)
  await ctx.agents.register(agent)
  return agent
}

describe('Drill Session settle', () => {
  it('ignores Drill judgments outside a dedicated Drill Session', async () => {
    const { ctx, archives, episodes } = await harness()
    const plain = await liveAgent(ctx, ctx.sessions.create(SessionId('plain-session')))
    plain.session.append('errgrind/drill-judged', attempt(true))
    await Promise.resolve()
    expect(archives).toEqual([])

    const derived = await liveAgent(ctx, ctx.sessions.create(SessionId('derived-session')))
    episodes.set(`${derived.id}:errgrindEpisode`, { origin: { kind: 'derived_drill' } })
    derived.session.append('errgrind/drill-judged', attempt(true))
    await Promise.resolve()
    expect(archives).toEqual([])
  })

  it('archives a correct Drill verdict immediately or after the turn idles', async () => {
    const { ctx, archives, failArchive, episodes } = await harness()
    const immediate = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-immediate')))
    episodes.set(`${immediate.id}:errgrindEpisode`, { origin: { kind: 'drill' } })
    immediate.session.append('errgrind/drill-judged', attempt(true))
    await vi.waitFor(() => { expect(archives).toEqual([immediate.id]) })

    // A judgment committed mid-turn defers the archive until the Agent idles.
    const busy = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-busy')))
    episodes.set(`${busy.id}:errgrindEpisode`, { origin: { kind: 'drill' } })
    failArchive.value = 'active'
    busy.session.append('errgrind/drill-judged', attempt(true))
    await vi.waitFor(() => { expect(archives).toHaveLength(1) })
    ctx.emit('agent/status', { agent: busy, status: 'running' })
    expect(archives).toHaveLength(1)
    ctx.emit('agent/status', { agent: busy, status: 'idle' })
    await vi.waitFor(() => { expect(archives).toEqual([immediate.id, busy.id]) })
  })

  it('ignores an idle transition with no pending Drill archive', async () => {
    const { ctx, archives } = await harness()
    const idle = await liveAgent(ctx, ctx.sessions.create(SessionId('idle-session')))
    ctx.emit('agent/status', { agent: idle, status: 'idle' })
    expect(archives).toEqual([])
  })

  it('logs a non-active archive failure instead of retrying', async () => {
    const { ctx, archives, failArchive, episodes } = await harness()
    const loggerError = vi.spyOn(ctx.logger, 'error')
    const failing = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-failing')))
    episodes.set(`${failing.id}:errgrindEpisode`, { origin: { kind: 'drill' } })
    failArchive.value = 'generic'
    failing.session.append('errgrind/drill-judged', attempt(true))
    await vi.waitFor(() => { expect(loggerError).toHaveBeenCalledOnce() })
    expect(archives).toEqual([])
    ctx.emit('agent/status', { agent: failing, status: 'idle' })
    expect(archives).toEqual([])
  })
})

/** The confirmed-Error projection state that satisfies the Drill gate. */
function confirmedEpisode(): unknown {
  return {
    origin: { kind: 'user' },
    diagnosis: {
      status: 'supported', stale: false, summary: 'diag', anchoredRevision: 1,
      remainingUncertainty: null, whatWouldChangeJudgment: null,
    },
    confirmedRevision: 1,
    draft: { revision: 1, text: 'added numerators' },
  }
}

function drillSessionId(sourceId: SessionId, index: number): SessionId {
  return SessionId(`errgrind-drill-${createHash('sha256')
    .update(`${sourceId}\0${index}`).digest('hex').slice(0, 32)}`)
}

describe('openDrill', () => {
  it('rejects an unknown or unconfirmed source Session', async () => {
    const { ctx } = await harness()
    await expect(ctx.sessionController.openDrill({ sourceSessionId: SessionId('missing-source') }))
      .rejects.toThrow()

    const plain = await liveAgent(ctx, ctx.sessions.create(SessionId('plain-source')))
    await expect(ctx.sessionController.openDrill({ sourceSessionId: plain.id }))
      .rejects.toThrow('Only a confirmed Error')
  })

  it('rejects Drill Sessions and unresolved confirmations as sources', async () => {
    const { ctx, episodes } = await harness()
    const drillSource = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-source')))
    episodes.set(`${drillSource.id}:errgrindEpisode`, {
      ...confirmedEpisode() as Record<string, unknown>,
      origin: { kind: 'drill' },
    })
    await expect(ctx.sessionController.openDrill({ sourceSessionId: drillSource.id }))
      .rejects.toThrow('Only a confirmed Error')

    const unconfirmed = await liveAgent(ctx, ctx.sessions.create(SessionId('unconfirmed-source')))
    episodes.set(`${unconfirmed.id}:errgrindEpisode`, {
      ...confirmedEpisode() as Record<string, unknown>,
      confirmedRevision: null,
    })
    await expect(ctx.sessionController.openDrill({ sourceSessionId: unconfirmed.id }))
      .rejects.toThrow('Only a confirmed Error')
  })

  it('creates a Drill Session, seeds the episode, and wakes it with a followup', async () => {
    const { ctx, episodes, followups, renames } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('error-source')))
    episodes.set(`${source.id}:errgrindEpisode`, {
      ...confirmedEpisode() as Record<string, unknown>,
      diagnosis: {
        status: 'supported', stale: false, summary: 'diag', anchoredRevision: 1,
        remainingUncertainty: 'which rule failed', whatWouldChangeJudgment: null,
      },
    })

    const result = await ctx.sessionController.openDrill({ sourceSessionId: source.id })

    const expectedId = drillSessionId(source.id, 0)
    expect(result.sessionId).toBe(expectedId)
    const target = ctx.agents.get(expectedId)
    expect(target).toBeDefined()
    const opened = target!.session.snapshotEvents()
    expect(opened.some(event => event.type === 'errgrind/drill-open'
      && event.data.sourceSessionId === source.id
      && event.data.sourceRevision === 1)).toBe(true)
    expect(followups.get(expectedId)?.kinds).toEqual(['errgrind-drill-request'])
    expect(renames).toEqual(['练习 · added numerators'])
  })

  it('allocates the next deterministic index for a second Drill', async () => {
    const { ctx, episodes } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('error-source')))
    episodes.set(`${source.id}:errgrindEpisode`, confirmedEpisode())

    const first = await ctx.sessionController.openDrill({ sourceSessionId: source.id })
    const second = await ctx.sessionController.openDrill({ sourceSessionId: source.id })

    expect(first.sessionId).toBe(drillSessionId(source.id, 0))
    expect(second.sessionId).toBe(drillSessionId(source.id, 1))
    const secondOpened = ctx.agents.get(second.sessionId)!.session.snapshotEvents()
    expect(secondOpened.filter(event => event.type === 'errgrind/drill-open')).toHaveLength(1)
  })

  it('survives a sessionTitle rename failure', async () => {
    const { ctx, episodes, failRename } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('error-source')))
    episodes.set(`${source.id}:errgrindEpisode`, confirmedEpisode())
    failRename.value = true

    const result = await ctx.sessionController.openDrill({ sourceSessionId: source.id })
    expect(result.sessionId).toBe(drillSessionId(source.id, 0))
  })

  it('skips the kickoff when the projected Episode already consumed it', async () => {
    const { ctx, episodes, followups } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('error-source')))
    episodes.set(`${source.id}:errgrindEpisode`, confirmedEpisode())
    const expectedId = drillSessionId(source.id, 0)
    episodes.set(`${expectedId}:errgrindEpisode`, {
      origin: { kind: 'drill', sourceSessionId: source.id },
      derivedContextConsumed: true,
    })

    const result = await ctx.sessionController.openDrill({ sourceSessionId: source.id })

    expect(result.sessionId).toBe(expectedId)
    expect(ctx.agents.get(expectedId)!.session.snapshotEvents()
      .filter(event => event.type === 'errgrind/drill-open')).toHaveLength(0)
    expect(followups.get(expectedId)).toBeUndefined()
  })

  it('rejects a Drill identity already claimed by another Episode kind', async () => {
    const { ctx, episodes } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('error-source')))
    episodes.set(`${source.id}:errgrindEpisode`, confirmedEpisode())
    episodes.set(`${drillSessionId(source.id, 0)}:errgrindEpisode`, {
      origin: { kind: 'user' },
    })

    await expect(ctx.sessionController.openDrill({ sourceSessionId: source.id }))
      .rejects.toThrow('Drill Session identity conflicts')
  })

  it('attaches the Drill Session to the source Error workspace', async () => {
    const { ctx, episodes, workspaces } = await harness()
    const attachSession = vi.fn(async (_id: SessionId) => {})
    const workspace = { id: 'ws-1', path: '/tmp', sessionIds: [] as SessionId[], attachSession }
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('error-source')))
    workspace.sessionIds.push(source.id)
    workspaces.push(workspace)
    episodes.set(`${source.id}:errgrindEpisode`, confirmedEpisode())

    const result = await ctx.sessionController.openDrill({ sourceSessionId: source.id })

    expect(result.sessionId).toBe(drillSessionId(source.id, 0))
    expect(attachSession).toHaveBeenCalledWith(result.sessionId)
  })

  it('skips an identity already held by an archived Session', async () => {
    const { ctx, episodes } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('error-source')))
    episodes.set(`${source.id}:errgrindEpisode`, confirmedEpisode())
    ;(ctx.workspaceRegistry as unknown as { archivedSessionIds: SessionId[] })
      .archivedSessionIds.push(drillSessionId(source.id, 0))

    const result = await ctx.sessionController.openDrill({ sourceSessionId: source.id })
    expect(result.sessionId).toBe(drillSessionId(source.id, 1))
  })

  it('rejects when the created Drill identity fails to resolve', async () => {
    const { ctx, episodes } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('error-source')))
    episodes.set(`${source.id}:errgrindEpisode`, confirmedEpisode())
    const controller = ctx.sessionController as unknown as {
      resolveAgent: (sessionId: SessionId) => Promise<unknown>
    }
    const realResolve = controller.resolveAgent.bind(controller)
    const targetId = drillSessionId(source.id, 0)
    vi.spyOn(controller, 'resolveAgent').mockImplementation((sessionId: SessionId) =>
      sessionId === targetId
        ? Promise.resolve({ error: new RemoteError('gateway/internal', 'target vanished', {}) })
        : realResolve(sessionId))

    await expect(ctx.sessionController.openDrill({ sourceSessionId: source.id }))
      .rejects.toThrow('target vanished')
  })

  it('skips the kickoff while one is still queued on the target Agent', async () => {
    const { ctx, episodes, followups } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('error-source')))
    episodes.set(`${source.id}:errgrindEpisode`, confirmedEpisode())
    const controller = ctx.sessionController as unknown as {
      resolveAgent: (sessionId: SessionId) => Promise<unknown>
    }
    const realResolve = controller.resolveAgent.bind(controller)
    const targetId = drillSessionId(source.id, 0)
    vi.spyOn(controller, 'resolveAgent').mockImplementation(async (sessionId: SessionId) => {
      const resolved = await realResolve(sessionId) as { agent?: Agent; error?: unknown }
      if (sessionId === targetId && 'agent' in resolved && resolved.agent !== undefined) {
        resolved.agent.followup({ source: { kind: 'errgrind-drill-request' } } as never)
      }
      return resolved
    })

    const result = await ctx.sessionController.openDrill({ sourceSessionId: source.id })

    expect(result.sessionId).toBe(targetId)
    // Only the pre-seeded kickoff ran; openDrill did not queue a second one.
    expect(followups.get(targetId)).toEqual({ count: 1, kinds: ['errgrind-drill-request'] })
  })
})

describe('openDerivedError', () => {
  it('rejects when no incorrect Drill attempt matches', async () => {
    const { ctx, episodes } = await harness()
    await expect(ctx.sessionController.openDerivedError({
      sourceSessionId: SessionId('missing-source'), preparationId: 'prep-1',
    })).rejects.toThrow()

    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-source')))
    await expect(ctx.sessionController.openDerivedError({
      sourceSessionId: source.id, preparationId: 'prep-1',
    })).rejects.toThrow('No incorrect Drill attempt')

    episodes.set(`${source.id}:errgrindDrill`, { attempts: [attempt(true)] })
    await expect(ctx.sessionController.openDerivedError({
      sourceSessionId: source.id, preparationId: 'prep-1',
    })).rejects.toThrow('No incorrect Drill attempt')
  })

  it('materializes the derived Error Session once and reuses it', async () => {
    const { ctx, episodes, followups } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-source')))
    episodes.set(`${source.id}:errgrindDrill`, { attempts: [attempt(false)] })
    const derivedId = SessionId(`errgrind-derived-${createHash('sha256')
      .update(`${source.id}\0prep-1`).digest('hex').slice(0, 32)}`)

    const result = await ctx.sessionController.openDerivedError({
      sourceSessionId: source.id, preparationId: 'prep-1',
    })
    expect(result.sessionId).toBe(derivedId)
    const target = ctx.agents.get(derivedId)
    expect(target).toBeDefined()
    const opened = target!.session.snapshotEvents()
    expect(opened.filter(event => event.type === 'errgrind/derived-error-open')).toHaveLength(1)
    expect(followups.get(derivedId)?.kinds).toEqual(['errgrind-derived-error'])

    // A repeat request on a live derived Episode keeps one open event and does
    // not queue a second kickoff.
    episodes.set(`${derivedId}:errgrindEpisode`, {
      origin: { kind: 'derived_drill', sourceSessionId: source.id, sourcePreparationId: 'prep-1' },
      derivedContextConsumed: false,
    })
    const again = await ctx.sessionController.openDerivedError({
      sourceSessionId: source.id, preparationId: 'prep-1',
    })
    expect(again.sessionId).toBe(derivedId)
    expect(target!.session.snapshotEvents()
      .filter(event => event.type === 'errgrind/derived-error-open')).toHaveLength(1)
    expect(followups.get(derivedId)?.count).toBe(1)
  })

  it('rejects a derived identity already claimed by another Episode kind', async () => {
    const { ctx, episodes } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-source')))
    episodes.set(`${source.id}:errgrindDrill`, { attempts: [attempt(false)] })
    const derivedId = SessionId(`errgrind-derived-${createHash('sha256')
      .update(`${source.id}\0prep-1`).digest('hex').slice(0, 32)}`)
    episodes.set(`${derivedId}:errgrindEpisode`, {
      origin: { kind: 'drill', sourceSessionId: source.id },
    })

    await expect(ctx.sessionController.openDerivedError({
      sourceSessionId: source.id, preparationId: 'prep-1',
    })).rejects.toThrow('identity conflicts')
  })

  it('materializes the derived Error itself on an incorrect verdict', async () => {
    const { ctx, episodes, followups, archives } = await harness()
    const drill = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-wrong')))
    episodes.set(`${drill.id}:errgrindEpisode`, { origin: { kind: 'drill' } })
    episodes.set(`${drill.id}:errgrindDrill`, { attempts: [attempt(false)] })
    const derivedId = SessionId(`errgrind-derived-${createHash('sha256')
      .update(`${drill.id}\0prep-1`).digest('hex').slice(0, 32)}`)

    drill.session.append('errgrind/drill-judged', attempt(false))

    await vi.waitFor(() => { expect(ctx.agents.get(derivedId)).toBeDefined() })
    expect(archives).toEqual([])
    expect(followups.get(derivedId)?.kinds).toEqual(['errgrind-derived-error'])
  })

  it('logs when the judged attempt no longer matches the Drill projection', async () => {
    const { ctx, episodes } = await harness()
    const loggerError = vi.spyOn(ctx.logger, 'error')
    const drill = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-stale')))
    episodes.set(`${drill.id}:errgrindEpisode`, { origin: { kind: 'drill' } })
    episodes.set(`${drill.id}:errgrindDrill`, { attempts: [{ ...attempt(false), preparationId: 'prep-other' }] })

    drill.session.append('errgrind/drill-judged', attempt(false))

    await vi.waitFor(() => { expect(loggerError).toHaveBeenCalled() })
  })

  it('attaches the derived Error to the source Drill workspace', async () => {
    const { ctx, episodes, workspaces } = await harness()
    const attachSession = vi.fn(async (_id: SessionId) => {})
    const workspace = { id: 'ws-1', path: '/tmp', sessionIds: [] as SessionId[], attachSession }
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-source')))
    workspace.sessionIds.push(source.id)
    workspaces.push(workspace)
    episodes.set(`${source.id}:errgrindDrill`, { attempts: [attempt(false)] })
    const derivedId = SessionId(`errgrind-derived-${createHash('sha256')
      .update(`${source.id}\0prep-1`).digest('hex').slice(0, 32)}`)

    const result = await ctx.sessionController.openDerivedError({
      sourceSessionId: source.id, preparationId: 'prep-1',
    })

    expect(result.sessionId).toBe(derivedId)
    expect(attachSession).toHaveBeenCalledWith(derivedId)
  })

  it('rejects when the created derived identity fails to resolve', async () => {
    const { ctx, episodes } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-source')))
    episodes.set(`${source.id}:errgrindDrill`, { attempts: [attempt(false)] })
    const derivedId = SessionId(`errgrind-derived-${createHash('sha256')
      .update(`${source.id}\0prep-1`).digest('hex').slice(0, 32)}`)
    const controller = ctx.sessionController as unknown as {
      resolveAgent: (sessionId: SessionId) => Promise<unknown>
    }
    const realResolve = controller.resolveAgent.bind(controller)
    vi.spyOn(controller, 'resolveAgent').mockImplementation((sessionId: SessionId) =>
      sessionId === derivedId
        ? Promise.resolve({ error: new RemoteError('gateway/internal', 'target vanished', {}) })
        : realResolve(sessionId))

    await expect(ctx.sessionController.openDerivedError({
      sourceSessionId: source.id, preparationId: 'prep-1',
    })).rejects.toThrow('target vanished')
  })

  it('logs when the source Agent vanishes between gate and materialize', async () => {
    const { ctx, episodes } = await harness()
    const loggerError = vi.spyOn(ctx.logger, 'error')
    const drill = agentDouble(ctx, ctx.sessions.create(SessionId('drill-vanish')))
    const unregister = await ctx.agents.register(drill)
    episodes.set(`${drill.id}:errgrindEpisode`, { origin: { kind: 'drill' } })
    episodes.set(`${drill.id}:errgrindDrill`, { attempts: [attempt(false)] })
    await unregister()

    drill.session.append('errgrind/drill-judged', attempt(false))

    await vi.waitFor(() => { expect(loggerError).toHaveBeenCalled() })
  })
})
