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
  archiveAttempts: SessionId[]
  renames: string[]
  failRename: { value: boolean }
  standingTitleKind: { value: 'user' | 'fallback' | 'provider' | null }
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
  const archiveAttempts: SessionId[] = []
  const failArchive: Harness['failArchive'] = { value: false }
  const workspaces: Harness['workspaces'] = []
  ctx.provide('workspaceRegistry', {
    archivedSessionIds: [] as SessionId[],
    list: () => workspaces,
    get: (id: string) => workspaces.find(workspace => workspace.id === id),
    archiveSession: vi.fn(async (sessionId: SessionId) => {
      archiveAttempts.push(sessionId)
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
  const standingTitleKind: Harness['standingTitleKind'] = { value: null }
  ctx.provide('sessionTitle', {
    get: (_session: Session) => (standingTitleKind.value === null
      ? undefined
      : { title: 'standing', seq: 1, messageSeqs: [], source: { kind: standingTitleKind.value } }),
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
  return { ctx, archives, archiveAttempts, failArchive, episodes, followups, renames, failRename, standingTitleKind, workspaces }
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
    const loggerInfo = vi.spyOn(ctx.logger, 'info')
    const immediate = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-immediate')))
    episodes.set(`${immediate.id}:errgrindEpisode`, { origin: { kind: 'drill' } })
    immediate.session.append('errgrind/drill-judged', attempt(true))
    await vi.waitFor(() => { expect(archives).toEqual([immediate.id]) })
    // The archived Drill leaves no product trace, so the internal Host log records it.
    expect(loggerInfo).toHaveBeenCalledWith(expect.stringContaining('archived after a correct verdict'))

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
    expect(loggerInfo).toHaveBeenCalledTimes(2)
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

  it('keeps the pending archive when a retry still finds the Session active', async () => {
    const { ctx, archives, archiveAttempts, failArchive, episodes } = await harness()
    const drill = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-stuck')))
    episodes.set(`${drill.id}:errgrindEpisode`, { origin: { kind: 'drill' } })
    failArchive.value = 'active'
    drill.session.append('errgrind/drill-judged', attempt(true))
    await vi.waitFor(() => { expect(archiveAttempts).toHaveLength(1) })

    failArchive.value = 'active'
    ctx.emit('agent/status', { agent: drill, status: 'idle' })
    await vi.waitFor(() => { expect(archiveAttempts).toHaveLength(2) })
    expect(archives).toEqual([])
    await Promise.resolve()

    ctx.emit('agent/status', { agent: drill, status: 'idle' })
    await vi.waitFor(() => { expect(archives).toEqual([drill.id]) })
  })

  it('drops the pending archive and logs when a retry fails for another reason', async () => {
    const { ctx, archives, archiveAttempts, failArchive, episodes } = await harness()
    const loggerError = vi.spyOn(ctx.logger, 'error')
    const drill = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-flaky')))
    episodes.set(`${drill.id}:errgrindEpisode`, { origin: { kind: 'drill' } })
    failArchive.value = 'active'
    drill.session.append('errgrind/drill-judged', attempt(true))
    await vi.waitFor(() => { expect(archiveAttempts).toHaveLength(1) })

    failArchive.value = 'generic'
    ctx.emit('agent/status', { agent: drill, status: 'idle' })
    await vi.waitFor(() => { expect(loggerError).toHaveBeenCalledOnce() })
    expect(archiveAttempts).toHaveLength(2)
    expect(archives).toEqual([])

    ctx.emit('agent/status', { agent: drill, status: 'idle' })
    await Promise.resolve()
    expect(archiveAttempts).toHaveLength(2)
  })

  it('archives a pending Drill Session when its Agent is disposed', async () => {
    const { ctx, archives, archiveAttempts, failArchive, episodes } = await harness()
    const drill = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-parked')))
    episodes.set(`${drill.id}:errgrindEpisode`, { origin: { kind: 'drill' } })
    failArchive.value = 'active'
    drill.session.append('errgrind/drill-judged', attempt(true))
    await vi.waitFor(() => { expect(archiveAttempts).toHaveLength(1) })

    ctx.emit('agent/disposed', { agent: drill })
    await vi.waitFor(() => { expect(archives).toEqual([drill.id]) })
  })
})

describe('retireDrill', () => {
  it('archives a judged Drill Session once the learner leaves it', async () => {
    const { ctx, archives, episodes } = await harness()
    const loggerInfo = vi.spyOn(ctx.logger, 'info')
    const drill = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-left')))
    episodes.set(`${drill.id}:errgrindEpisode`, { origin: { kind: 'drill' } })
    episodes.set(`${drill.id}:errgrindDrill`, { attempts: [attempt(false)] })

    await ctx.sessionController.retireDrill({ sessionId: drill.id })
    expect(archives).toEqual([drill.id])
    expect(loggerInfo).toHaveBeenCalledWith(expect.stringContaining('learner left'))
  })

  it('ignores retire calls for non-Drill, unjudged, and unknown Sessions', async () => {
    const { ctx, archives, episodes } = await harness()
    const plain = await liveAgent(ctx, ctx.sessions.create(SessionId('plain')))
    const unjudged = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-unjudged')))
    episodes.set(`${unjudged.id}:errgrindEpisode`, { origin: { kind: 'drill' } })
    episodes.set(`${unjudged.id}:errgrindDrill`, { attempts: [] })

    await ctx.sessionController.retireDrill({ sessionId: plain.id })
    await ctx.sessionController.retireDrill({ sessionId: unjudged.id })
    await ctx.sessionController.retireDrill({ sessionId: SessionId('missing') })
    expect(archives).toEqual([])
  })

  it('defers a learner-departure archive while the Drill Session is still active', async () => {
    const { ctx, archives, archiveAttempts, failArchive, episodes } = await harness()
    const loggerInfo = vi.spyOn(ctx.logger, 'info')
    const drill = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-busy-left')))
    episodes.set(`${drill.id}:errgrindEpisode`, { origin: { kind: 'drill' } })
    episodes.set(`${drill.id}:errgrindDrill`, { attempts: [attempt(false)] })
    failArchive.value = 'active'

    await ctx.sessionController.retireDrill({ sessionId: drill.id })
    expect(archiveAttempts).toEqual([drill.id])
    expect(archives).toEqual([])

    ctx.emit('agent/status', { agent: drill, status: 'idle' })
    await vi.waitFor(() => { expect(archives).toEqual([drill.id]) })
    expect(loggerInfo).toHaveBeenCalledWith(expect.stringContaining('learner left'))
  })

  it('propagates a non-active archive failure from retireDrill', async () => {
    const { ctx, failArchive, episodes } = await harness()
    const drill = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-fail-left')))
    episodes.set(`${drill.id}:errgrindEpisode`, { origin: { kind: 'drill' } })
    episodes.set(`${drill.id}:errgrindDrill`, { attempts: [attempt(false)] })
    failArchive.value = 'generic'

    await expect(ctx.sessionController.retireDrill({ sessionId: drill.id })).rejects.toThrow('registry unavailable')
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

function poolDrillSessionId(sourceIds: readonly SessionId[], index: number): SessionId {
  const identity = `pool\x00${sourceIds.join('\x01')}`
  return SessionId(`errgrind-drill-${createHash('sha256')
    .update(`${identity}\0${index}`).digest('hex').slice(0, 32)}`)
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
    const { ctx, episodes, followups } = await harness()
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
      && 'sourceSessionId' in event.data
      && event.data.sourceSessionId === source.id
      && event.data.sourceRevision === 1)).toBe(true)
    expect(followups.get(expectedId)?.kinds).toEqual(['errgrind-drill-request'])
  })

  it('allocates the next deterministic index for a second Drill', async () => {
    const { ctx, episodes } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('error-source')))
    episodes.set(`${source.id}:errgrindEpisode`, confirmedEpisode())

    const first = await ctx.sessionController.openDrill({ sourceSessionId: source.id })
    const second = await ctx.sessionController.openDrill({ sourceSessionId: source.id })

    expect(first.sessionId).toBe(drillSessionId(source.id, 0))
    expect(first.index).toBe(0)
    expect(first.created).toBe(true)
    expect(second.sessionId).toBe(drillSessionId(source.id, 1))
    expect(second.index).toBe(1)
    expect(second.created).toBe(true)
    const secondOpened = ctx.agents.get(second.sessionId)!.session.snapshotEvents()
    expect(secondOpened.filter(event => event.type === 'errgrind/drill-open')).toHaveLength(1)
  })

  it('queues the kickoff on a reused Drill Session whose earlier run never queued', async () => {
    const { ctx, episodes, followups } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('error-source')))
    episodes.set(`${source.id}:errgrindEpisode`, confirmedEpisode())
    const expectedId = drillSessionId(source.id, 0)
    episodes.set(`${expectedId}:errgrindEpisode`, {
      origin: { kind: 'drill', sourceSessionId: source.id },
      drillCandidates: [],
      derivedContextConsumed: false,
    })

    const result = await ctx.sessionController.openDrill({ sourceSessionId: source.id })

    expect(result.sessionId).toBe(expectedId)
    expect(result.created).toBe(false)
    expect(ctx.agents.get(expectedId)!.session.snapshotEvents()
      .filter(event => event.type === 'errgrind/drill-open')).toHaveLength(0)
    expect(followups.get(expectedId)?.kinds).toEqual(['errgrind-drill-request'])
  })

  it('skips the kickoff when the projected Episode already consumed it', async () => {
    const { ctx, episodes, followups } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('error-source')))
    episodes.set(`${source.id}:errgrindEpisode`, confirmedEpisode())
    const expectedId = drillSessionId(source.id, 0)
    episodes.set(`${expectedId}:errgrindEpisode`, {
      origin: { kind: 'drill', sourceSessionId: source.id },
      drillCandidates: [],
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

  it('rejects an empty pool, repeated candidates, and ineligible candidates', async () => {
    const { ctx, episodes } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('error-source')))
    episodes.set(`${source.id}:errgrindEpisode`, confirmedEpisode())

    await expect(ctx.sessionController.openDrill({ candidateSessionIds: [] }))
      .rejects.toThrow('non-empty list without repeats')
    await expect(ctx.sessionController.openDrill({ candidateSessionIds: [source.id, source.id] }))
      .rejects.toThrow('non-empty list without repeats')

    const plain = await liveAgent(ctx, ctx.sessions.create(SessionId('plain-candidate')))
    await expect(ctx.sessionController.openDrill({ candidateSessionIds: [source.id, plain.id] }))
      .rejects.toThrow('Only a confirmed Error')
  })

  it('seeds a pool Drill Session and wakes it with a pool followup', async () => {
    const { ctx, episodes, followups } = await harness()
    const sourceA = await liveAgent(ctx, ctx.sessions.create(SessionId('error-a')))
    const sourceB = await liveAgent(ctx, ctx.sessions.create(SessionId('error-b')))
    episodes.set(`${sourceA.id}:errgrindEpisode`, {
      ...confirmedEpisode() as Record<string, unknown>,
      draft: { revision: 1, text: 'added numerators' },
    })
    episodes.set(`${sourceB.id}:errgrindEpisode`, {
      ...confirmedEpisode() as Record<string, unknown>,
      draft: { revision: 1, text: 'missed domain check' },
    })

    const result = await ctx.sessionController.openDrill({ candidateSessionIds: [sourceA.id, sourceB.id] })

    expect(result.sessionId).toBe(poolDrillSessionId([sourceA.id, sourceB.id], 0))
    expect(result.created).toBe(true)
    const opened = ctx.agents.get(result.sessionId)!.session.snapshotEvents()
      .filter(event => event.type === 'errgrind/drill-open')
    expect(opened).toHaveLength(1)
    const data = opened[0]!.data
    expect('sourceSessionId' in data).toBe(false)
    if (!('candidates' in data) || data.candidates === undefined) {
      throw new Error('expected a pool drill-open')
    }
    expect(data.candidates).toHaveLength(2)
    expect(data.candidates[1]?.description).toBe('missed domain check')
    expect(followups.get(result.sessionId)?.kinds).toEqual(['errgrind-drill-request'])
  })

  it('reuses the pool Session for the same candidate set and never collides with a single-Error Drill', async () => {
    const { ctx, episodes } = await harness()
    const sourceA = await liveAgent(ctx, ctx.sessions.create(SessionId('error-a')))
    const sourceB = await liveAgent(ctx, ctx.sessions.create(SessionId('error-b')))
    episodes.set(`${sourceA.id}:errgrindEpisode`, confirmedEpisode())
    episodes.set(`${sourceB.id}:errgrindEpisode`, confirmedEpisode())

    const single = await ctx.sessionController.openDrill({ sourceSessionId: sourceA.id })
    const pool = await ctx.sessionController.openDrill({ candidateSessionIds: [sourceA.id, sourceB.id] })
    const poolAgain = await ctx.sessionController.openDrill({ candidateSessionIds: [sourceA.id, sourceB.id] })

    // A pool holding one Session still hashes differently from a single-Error Drill.
    const solo = await ctx.sessionController.openDrill({ candidateSessionIds: [sourceA.id] })
    expect(solo.sessionId).not.toBe(single.sessionId)
    expect(pool.sessionId).not.toBe(single.sessionId)
    // Each call allocates the next deterministic index for that candidate set.
    expect(poolAgain.sessionId).toBe(poolDrillSessionId([sourceA.id, sourceB.id], 1))
    expect(poolAgain.created).toBe(true)
    expect(ctx.agents.get(poolAgain.sessionId)!.session.snapshotEvents()
      .filter(event => event.type === 'errgrind/drill-open')).toHaveLength(1)
  })

  it('adopts a persisted pool Session whose identity is still unclaimed', async () => {
    const { ctx, episodes, followups } = await harness()
    const sourceA = await liveAgent(ctx, ctx.sessions.create(SessionId('error-a')))
    const sourceB = await liveAgent(ctx, ctx.sessions.create(SessionId('error-b')))
    episodes.set(`${sourceA.id}:errgrindEpisode`, confirmedEpisode())
    episodes.set(`${sourceB.id}:errgrindEpisode`, confirmedEpisode())
    const expectedId = poolDrillSessionId([sourceA.id, sourceB.id], 0)
    episodes.set(`${expectedId}:errgrindEpisode`, {
      origin: { kind: 'drill' },
      drillCandidates: [
        { sourceSessionId: sourceA.id }, { sourceSessionId: sourceB.id },
      ],
    })

    const result = await ctx.sessionController.openDrill({ candidateSessionIds: [sourceA.id, sourceB.id] })

    expect(result.sessionId).toBe(expectedId)
    expect(result.created).toBe(false)
    expect(ctx.agents.get(expectedId)!.session.snapshotEvents()
      .filter(event => event.type === 'errgrind/drill-open')).toHaveLength(0)
    expect(followups.get(expectedId)?.kinds).toEqual(['errgrind-drill-request'])
  })

  it('rejects a pool identity already claimed by a different candidate set', async () => {
    const { ctx, episodes } = await harness()
    const sourceA = await liveAgent(ctx, ctx.sessions.create(SessionId('error-a')))
    const sourceB = await liveAgent(ctx, ctx.sessions.create(SessionId('error-b')))
    episodes.set(`${sourceA.id}:errgrindEpisode`, confirmedEpisode())
    episodes.set(`${sourceB.id}:errgrindEpisode`, confirmedEpisode())
    episodes.set(`${poolDrillSessionId([sourceA.id, sourceB.id], 0)}:errgrindEpisode`, {
      origin: { kind: 'drill' },
      drillCandidates: [{ sourceSessionId: sourceA.id }],
    })

    await expect(ctx.sessionController.openDrill({ candidateSessionIds: [sourceA.id, sourceB.id] }))
      .rejects.toThrow('Drill Session identity conflicts')
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
    const { ctx, episodes, followups, renames, standingTitleKind } = await harness()
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
    // not queue a second kickoff. The first pin landed a 'user'-sourced title.
    episodes.set(`${derivedId}:errgrindEpisode`, {
      origin: { kind: 'derived_drill', sourceSessionId: source.id, sourcePreparationId: 'prep-1' },
      derivedContextConsumed: false,
    })
    standingTitleKind.value = 'user'
    const again = await ctx.sessionController.openDerivedError({
      sourceSessionId: source.id, preparationId: 'prep-1',
    })
    expect(again.sessionId).toBe(derivedId)
    expect(target!.session.snapshotEvents()
      .filter(event => event.type === 'errgrind/derived-error-open')).toHaveLength(1)
    expect(followups.get(derivedId)?.count).toBe(1)
    // A 'user'-sourced title is a pin: re-opens must not rename over it.
    expect(renames).toEqual(['新错误 · What is 3/4 + 1/8?'])

    // A generated standing title takes the pin again, healing Sessions
    // materialized before the pin existed.
    standingTitleKind.value = 'fallback'
    await ctx.sessionController.openDerivedError({
      sourceSessionId: source.id, preparationId: 'prep-1',
    })
    expect(renames).toEqual(['新错误 · What is 3/4 + 1/8?', '新错误 · What is 3/4 + 1/8?'])
  })

  it('survives a sessionTitle rename failure on the derived Error', async () => {
    const { ctx, episodes, failRename } = await harness()
    const source = await liveAgent(ctx, ctx.sessions.create(SessionId('drill-source')))
    episodes.set(`${source.id}:errgrindDrill`, { attempts: [attempt(false)] })
    failRename.value = true

    const result = await ctx.sessionController.openDerivedError({
      sourceSessionId: source.id, preparationId: 'prep-1',
    })
    expect(String(result.sessionId)).toContain('errgrind-derived-')
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
