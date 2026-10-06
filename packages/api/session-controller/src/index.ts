/** Session Remote owner: cold reads, explicit Agent commands, and live control state. */

import { hostname } from 'node:os'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import { canOpenNativePath, nativeFileManager, nativeFileApplications, openNativeFileApplication, openNativeAssociatedPath, revealNativePath } from '@deepseek-ai/dsh-native-command'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { WorkspaceActiveSessionError } from '@deepseek-ai/dsh-workspace'
import type { DrillAttempt } from '@errgrind/episode'
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  ApiSessionAgentController,
  inspectApiSession,
  type ApiSessionAgentResult,
} from './agent.ts'
import { SessionCommandController } from './commands.ts'
import { SessionControlController } from './control.ts'
import { SessionHistoryController } from './history.ts'
import { browserProjectionValues, type BrowserViewPolicy } from './browser-view.ts'
import { SessionFileReferences } from './file-references.ts'
import { ApiSessionList } from './list.ts'
import { buildModelCatalog } from './catalog.ts'
import { installModelSelectionProjection } from './model-selection-projection.ts'
import { SessionSkillCatalog } from './skill-catalog.ts'
import { SessionMediaReferences } from './media-references.ts'
import { ArchivedSessionGate } from './archived-session-gate.ts'
import type {
  ModelCatalog,
  SessionWorkspacePathApplication,
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionControlFrame,
  SessionCreateRequest,
  SessionCreateValue,
  DerivedErrorOpenRequest,
  DerivedErrorOpenValue,
  DrillOpenRequest,
  DrillOpenValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionForkRequest,
  SessionForkValue,
  SessionListRequest,
  SessionListValue,
  SessionOpenWorkspacePathRequest,
  SessionOpenWorkspacePathValue,
  SessionPage,
  SessionPageRequest,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSearchRequest,
  SessionSearchValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionProjectionsRequest,
  SessionProjectionsValue,
  SessionProjectionValues,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from './types.ts'

export type * from './types.ts'
export { ApiSessionNotFound } from './agent.ts'
export { SessionFileReferences } from './file-references.ts'
export { SessionSkillCatalog } from './skill-catalog.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Session business API and Remote namespace owner. */
    sessionController: SessionController
  }
}

/** Session Controller deployment policy. */
export interface Config {
  /** Override platform desktop-opener detection. */
  readonly nativeOpen?: boolean
  /** Optional public journal policy; the durable Session log remains unchanged. */
  readonly browserView?: BrowserViewPolicy
}

/** Host integrations replaceable by direct unit tests. */
export interface SessionControllerInternals {
  /** Native default-application handoff. */
  readonly openPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native file-association query. */
  readonly fileApplications?: typeof nativeFileApplications
  /** Explicit registered-application handoff. */
  readonly openFileApplication?: typeof openNativeFileApplication
  /** Native file-manager handoff. */
  readonly revealPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native handoff availability probe. */
  readonly canOpenPath?: () => boolean
}

/** Host service backing the generated `ctx.remote.session` namespace. */
export class SessionController extends TypertRemoteService {
  static inject = [
    'agentDefaultModel',
    'agents',
    'attachments',
    'fileUploads',
    'fs',
    'llm',
    'sessions',
    'sessionProjections',
    'sessionQuery',
    'typert',
    'workspaceRegistry',
  ]

  static Config: z<Config> = z.object({
    nativeOpen: z.boolean(),
    browserView: z.object({
      privateEventTypes: z.array(z.string()),
      privateMessageSourceKinds: z.array(z.string()).default([]),
      allowedEventTypes: z.array(z.string()),
      publicEventFields: z.dict(z.array(z.string())),
      allowedProjectionKeys: z.array(z.string()),
      redactDataKeys: z.array(z.string()),
      redactToolArguments: z.boolean(),
      redactAssistantReasoning: z.boolean(),
      hideAssistantStream: z.boolean(),
    }),
  })

  private readonly agents: ApiSessionAgentController
  private readonly commands: SessionCommandController
  private readonly controlState: SessionControlController
  private readonly history: SessionHistoryController
  private readonly listState: ApiSessionList
  private readonly browserView: BrowserViewPolicy | undefined
  private readonly openPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly fileApplications: typeof nativeFileApplications
  private readonly openFileApplication: typeof openNativeFileApplication
  private readonly revealPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly canOpenPath: () => boolean
  private readonly promotions = new Set<Promise<void>>()

  /**
   * @param ctx - Host context containing the Session capability assembly.
   * @param config - native-opener deployment policy.
   * @param internals - host integrations replaceable by direct unit tests.
   */
  constructor(ctx: Context, config: Config, internals: SessionControllerInternals = {}) {
    super(ctx, 'sessionController', { namespace: 'session' })
    this.browserView = config.browserView
    installModelSelectionProjection(ctx)
    this.agents = new ApiSessionAgentController(ctx)
    this.commands = new SessionCommandController(ctx, this.agents, process.cwd(), config.browserView)
    ctx.effect(() => ctx.fileUploads.registerAgentResolver(async (sessionId) => {
      const result = await this.agents.resolveAgent(sessionId)
      if ('error' in result) throw result.error
      return result.agent
    }), 'session-controller: file-upload Agent resolver')
    this.controlState = new SessionControlController(ctx, config.browserView)
    // Registered before history so reverse-order teardown closes every
    // follower before waiting for already-admitted promotions.
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.promotions])
    }, 'session-controller.promotions')
    this.history = new SessionHistoryController(ctx, (observation) => { this.promote(observation) }, config.browserView)
    this.listState = new ApiSessionList(ctx, config.browserView)
    this.fileApplications = internals.fileApplications ?? nativeFileApplications
    this.openFileApplication = internals.openFileApplication ?? openNativeFileApplication
    this.openPath = internals.openPath ?? openNativeAssociatedPath
    this.revealPath = internals.revealPath ?? revealNativePath
    this.canOpenPath = internals.canOpenPath
      ?? (() => config.nativeOpen ?? (internals.openPath !== undefined || canOpenNativePath()))
    ctx.plugin(SessionFileReferences)
    ctx.plugin(SessionMediaReferences)
    ctx.plugin(SessionSkillCatalog)
    // An archived Session, or a subagent descendant of one, runs no model step
    // until it is restored; what it still runs is stopped by the owners that
    // answer the Workspace registry's archive-admission events.
    ctx.plugin(ArchivedSessionGate)

    ctx.on('session/created', (session) => {
      ctx.emit('api-session/added', this.listState.summaryFor(session))
    })
    ctx.on('session/disposed', (session) => {
      ctx.emit('api-session/removed', session.id)
    })
    const publishAgentAvailability = ({ agent }: { agent: Agent }): undefined => {
      if (ctx.sessions.get(agent.id) === agent.session) {
        ctx.emit('api-session/added', this.listState.summaryFor(agent.session))
      }
    }
    ctx.on('agent/created', publishAgentAvailability)
    ctx.on('agent/disposed', publishAgentAvailability)
    ctx.on('agent/status', ({ agent, status }) => {
      ctx.emit('api-session/status', agent.id, status === 'running')
      // A Drill Session judged correct while its turn still runs is archived
      // here once the Agent goes idle; the verdict event is already durable.
      if (status === 'running' || !this.pendingDrillArchives.has(agent.id)) return
      this.pendingDrillArchives.delete(agent.id)
      void this.ctx.workspaceRegistry.archiveSession(agent.id).catch((error: unknown) => {
        this.ctx.logger.error(`session-controller: Drill Session archive for "${agent.id}" failed: ${errorChain(error)}`)
      })
    })
    ctx.on('agent/error', ({ agent, error }) => {
      ctx.emit('api-session/error', agent.id, errorChain(error))
    })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'request/header') {
        const agent = ctx.agents.get(session.id)
        if (agent?.session === session) this.agents.consumeSelection(
          agent,
          event.data.header.config.provider,
          event.data.header.config.model,
          event.data.header.config.reasoningEffort,
        )
      }
      if (event.type === 'errgrind/drill-judged') {
        void this.settleDrillSession(session, event.data).catch((error: unknown) => {
          this.ctx.logger.error(`session-controller: Drill Session settle for "${session.id}" failed: ${errorChain(error)}`)
        })
      }
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
      ctx.emit('api-session/activity', session.id, event.time)
    })
  }

  private promote(observation: SessionObservation): void {
    const sessionId = observation.header.id
    const task = (async () => {
      using ownedObservation = observation
      const result = await this.agents.resolveObservedAgent(ownedObservation)
      if ('error' in result) this.ctx.emit('api-session/error', sessionId, result.error.message)
    })().catch((error: unknown) => {
      this.ctx.logger.error(`session-controller: background activation for "${sessionId}" failed: ${errorChain(error)}`)
    })
    this.promotions.add(task)
    void task.finally(() => { this.promotions.delete(task) })
  }

  /** Drill Sessions judged correct archive once their turn settles (agent/status retry). */
  private readonly pendingDrillArchives = new Set<SessionId>()

  /**
   * Close out a judged Drill Session: archive a correct practice, materialize an incorrect one.
   * @param session - Session that committed the Drill judgment event.
   * @param attempt - Folded Drill attempt carrying the verdict and derived Error payload.
   */
  private async settleDrillSession(session: Session, attempt: DrillAttempt): Promise<void> {
    const episode = this.ctx.sessionProjections.stateOf(session, 'errgrindEpisode')
    if (episode?.origin.kind !== 'drill') return
    if (!attempt.isCorrect) {
      await this.materializeDerivedError(session.id, attempt.preparationId)
      return
    }
    try {
      await this.ctx.workspaceRegistry.archiveSession(session.id)
    } catch (error) {
      if (!(error instanceof WorkspaceActiveSessionError)) throw error
      this.pendingDrillArchives.add(session.id)
    }
  }

  /**
   * Resolve or resume one ordinary Session for another Host API domain.
   * @param sessionId - Session identity whose Agent owns the operation.
   * @returns the live Agent or the stable Session-domain failure.
   */
  resolveAgent(sessionId: SessionId): Promise<ApiSessionAgentResult> {
    return this.agents.resolveAgent(sessionId)
  }

  /**
   * Inspect one attached or persisted Session without activating its Agent.
   * @param sessionId - durable Session identity.
   * @param signal - optional caller cancellation for persistence reads.
   * @returns the current attached state or persisted header and event prefix.
   */
  inspect(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionInspection> {
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined) {
      return Promise.resolve({
        meta: attached.header,
        inheritedEventCount: attached.inheritedEventCount,
        // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
        events: attached.snapshotEvents(),
      })
    }
    return inspectApiSession(this.ctx, sessionId, signal)
  }

  /**
   * Read all visible Session rows without resuming an Agent.
   * @param _request - reserved empty list request.
   * @param signal - cancellation for persistence reads.
   * @returns visible Session summaries ordered by activity.
   */
  @Remote('list')
  async list(_request: SessionListRequest, signal: AbortSignal): Promise<SessionListValue> {
    return { items: await this.listState.list(signal) }
  }

  /**
   * Search visible Session content without resuming an Agent.
   * @param request - literal message-content query.
   * @param signal - cancellation for list and search reads.
   * @returns authorized bounded Session search results.
   */
  @Remote('search')
  search(request: SessionSearchRequest, signal: AbortSignal): Promise<SessionSearchValue> {
    return this.listState.search(request.query, signal)
  }

  /**
   * Create or idempotently adopt one ordinary Session.
   * @param request - requested identity, location, and Agent preset.
   * @returns the Session identity and resolved preset when configured.
   */
  @Remote('create')
  create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    return this.commands.create(request)
  }

  /**
   * Materialize one incorrect Drill attempt as an idempotent, separately recoverable Error Session.
   * @param request - Source Session and the exact judged Drill preparation to promote.
   * @returns The stable target Session identity; repeated calls return the same Error.
   */
  @Remote('openDerivedError')
  async openDerivedError(request: DerivedErrorOpenRequest): Promise<DerivedErrorOpenValue> {
    const source = await this.resolveAgent(request.sourceSessionId)
    if ('error' in source) throw source.error
    const drill = this.ctx.sessionProjections.stateOf(source.agent.session, 'errgrindDrill')
    const attempt = drill?.attempts.find(item => item.preparationId === request.preparationId)
    if (attempt === undefined || attempt.derivedError === null) {
      throw new RemoteError('gateway/bad-request', 'No incorrect Drill attempt matches this request', {})
    }
    await this.materializeDerivedError(request.sourceSessionId, request.preparationId)
    return { sessionId: SessionId(`errgrind-derived-${createHash('sha256')
      .update(`${request.sourceSessionId}\0${request.preparationId}`).digest('hex').slice(0, 32)}`) }
  }

  /**
   * Create or reuse the derived Error Session for one judged incorrect Drill attempt.
   * @param sourceSessionId - Session that holds the judged Drill attempt.
   * @param preparationId - Exact Drill preparation whose derived Error materializes.
   * @returns The materialized Session identity.
   */
  private async materializeDerivedError(sourceSessionId: SessionId, preparationId: string): Promise<DerivedErrorOpenValue> {
    const source = await this.resolveAgent(sourceSessionId)
    if ('error' in source) throw source.error
    const drill = this.ctx.sessionProjections.stateOf(source.agent.session, 'errgrindDrill')
    const attempt = drill?.attempts.find(item => item.preparationId === preparationId)
    const derived = attempt?.derivedError
    if (attempt === undefined || derived === undefined || derived === null) {
      throw new RemoteError('gateway/bad-request', 'No incorrect Drill attempt matches this request', {})
    }
    const identity = createHash('sha256')
      .update(`${sourceSessionId}\0${preparationId}`).digest('hex').slice(0, 32)
    const sessionId = SessionId(`errgrind-derived-${identity}`)
    // Keep the derived Error in the source Error's Workspace. A Session
    // created by cwd alone is absent from Workspace navigation after opening.
    const sourceWorkspace = this.ctx.workspaceRegistry.list()
      .find(workspace => workspace.sessionIds.includes(sourceSessionId))
    await this.commands.create(sourceWorkspace === undefined
      ? { sessionId, cwd: source.agent.session.header.cwd ?? process.cwd() }
      : { sessionId, workspaceId: sourceWorkspace.id })
    const target = await this.resolveAgent(sessionId)
    if ('error' in target) throw target.error
    const session = target.agent.session
    const existing = this.ctx.sessionProjections.stateOf(session, 'errgrindEpisode')
    if (existing != null && (existing.origin.kind !== 'derived_drill'
      || existing.origin.sourceSessionId !== sourceSessionId
      || existing.origin.sourcePreparationId !== preparationId)) {
      throw new RemoteError('gateway/internal', 'Derived Error Session identity conflicts with another Error', {})
    }
    const text = `Practice question: ${derived.question}\nLearner answer: ${derived.userResponse}`
    if (existing == null) {
      session.append('errgrind/derived-error-open', {
        text, sourceSessionId,
        sourcePreparationId: preparationId,
        sourceAnswerRef: attempt.answerSourceRef,
        question: derived.question, userResponse: derived.userResponse,
        referenceAnswer: derived.referenceAnswer,
      })
    }
    const alreadyQueued = [...target.agent.inbox.nextTurn, ...target.agent.inbox.nextStep]
      .some(message => message.source.kind === 'errgrind-derived-error')
    const alreadyConsumed = existing?.derivedContextConsumed ?? false
    if (!alreadyQueued && !alreadyConsumed) {
      target.agent.followup(createUserMessage({
        content: [{ type: 'text', text: `${text}\nChecked reference answer: ${derived.referenceAnswer}. This is a derived Drill Error; distinguish the learner's earlier answer from this Host context.` }],
        source: { kind: 'errgrind-derived-error', sourceSessionId, preparationId },
      }))
    }
    return { sessionId }
  }

  /**
   * Open a dedicated Drill Session for one confirmed Error.
   * @param request - Source Session whose concluded diagnosis seeds the practice.
   * @returns The new Drill Session identity; each Error spawns sessions in index order.
   */
  @Remote('openDrill')
  async openDrill(request: DrillOpenRequest): Promise<DrillOpenValue> {
    const source = await this.resolveAgent(request.sourceSessionId)
    if ('error' in source) throw source.error
    const episode = this.ctx.sessionProjections.stateOf(source.agent.session, 'errgrindEpisode')
    if (episode == null || episode.origin.kind === 'drill'
      || episode.diagnosis.status === 'active' || episode.diagnosis.stale
      || episode.confirmedRevision === null || episode.draft === null
      || episode.draft.revision !== episode.confirmedRevision
      || episode.diagnosis.anchoredRevision !== episode.confirmedRevision
      || episode.diagnosis.summary === null) {
      throw new RemoteError('gateway/bad-request', 'Only a confirmed Error with a concluded diagnosis can open a Drill Session', {})
    }
    // Deterministic per (source, index): a fresh slot must miss every live,
    // persisted, and archived Session already holding that identity.
    const occupied = new Set<SessionId>((await this.listState.list()).map(item => item.sessionId))
    for (const sessionId of this.ctx.workspaceRegistry.archivedSessionIds) occupied.add(sessionId)
    let index = 0
    while (occupied.has(SessionId(`errgrind-drill-${createHash('sha256')
      .update(`${request.sourceSessionId}\0${index}`).digest('hex').slice(0, 32)}`))) index += 1
    const sessionId = SessionId(`errgrind-drill-${createHash('sha256')
      .update(`${request.sourceSessionId}\0${index}`).digest('hex').slice(0, 32)}`)
    const sourceWorkspace = this.ctx.workspaceRegistry.list()
      .find(workspace => workspace.sessionIds.includes(request.sourceSessionId))
    await this.commands.create(sourceWorkspace === undefined
      ? { sessionId, cwd: source.agent.session.header.cwd ?? process.cwd() }
      : { sessionId, workspaceId: sourceWorkspace.id })
    const target = await this.resolveAgent(sessionId)
    if ('error' in target) throw target.error
    const session = target.agent.session
    const existing = this.ctx.sessionProjections.stateOf(session, 'errgrindEpisode')
    if (existing != null && (existing.origin.kind !== 'drill'
      || existing.origin.sourceSessionId !== request.sourceSessionId)) {
      throw new RemoteError('gateway/internal', 'Drill Session identity conflicts with another Session', {})
    }
    const text = `Practice target: confirmed Error description (revision ${episode.confirmedRevision}):\n${episode.draft.text}`
    if (existing == null) {
      session.append('errgrind/drill-open', {
        text,
        sourceSessionId: request.sourceSessionId,
        sourceRevision: episode.confirmedRevision,
        description: episode.draft.text,
        diagnosisStatus: episode.diagnosis.status,
        diagnosisSummary: episode.diagnosis.summary,
        remainingUncertainty: episode.diagnosis.remainingUncertainty,
        whatWouldChangeJudgment: episode.diagnosis.whatWouldChangeJudgment,
      })
    }
    const alreadyQueued = [...target.agent.inbox.nextTurn, ...target.agent.inbox.nextStep]
      .some(message => message.source.kind === 'errgrind-drill-request')
    const alreadyConsumed = existing?.derivedContextConsumed ?? false
    if (!alreadyQueued && !alreadyConsumed) {
      target.agent.followup(createUserMessage({
        content: [{ type: 'text', text: `${text}\n\nConfirmed diagnosis (${episode.diagnosis.status}): ${episode.diagnosis.summary}\n${episode.diagnosis.remainingUncertainty ? `Remaining uncertainty: ${episode.diagnosis.remainingUncertainty}\n` : ''}This is a dedicated Drill Session for that already-confirmed Error. Call drill_prepare exactly once to generate one practice question for the learner. Do not re-investigate the Error: Grill and confirmation are already complete.` }],
        source: { kind: 'errgrind-drill-request', sourceSessionId: request.sourceSessionId },
      }))
    }
    try {
      this.ctx.get('sessionTitle')?.rename(session, `练习 · ${Array.from(episode.draft.text.trim()).slice(0, 40).join('')}`)
    } catch (error) {
      this.ctx.logger.warn(`session-controller: Drill Session title for "${sessionId}" skipped: ${errorChain(error)}`)
    }
    return { sessionId }
  }

  /**
   * Select one Session-local model after explicitly resuming the Session.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection installed for the Session.
   */
  @Remote('selectModel')
  selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    return this.commands.selectModel(request)
  }

  /**
   * Describe every currently routable model for Host-generation selectors.
   * @returns provider-grouped models, the deployment default, and isolated provider failures.
   */
  @Remote('modelCatalog')
  modelCatalog(): Promise<ModelCatalog> {
    return buildModelCatalog(this.ctx)
  }

  /**
   * Report whether this deployment can hand a Session workspace path to a native desktop.
   * @returns true when the matching open operation is available.
   */
  @Remote
  canOpenWorkspacePath(): boolean {
    return this.canOpenPath()
  }

  /**
   * Describe the serving desktop for authenticated file-action routes.
   * @returns Host name, configured availability, and platform-specific file-manager behavior.
   */
  workspaceDesktop(): { name: string; available: boolean; fileManager: 'finder' | 'explorer' | 'directory' | null } {
    const fileManager = nativeFileManager()
    return { name: hostname(), available: fileManager !== null && this.canOpenPath(), fileManager }
  }

  /**
   * Verify one path through the composed filesystem and open it on the Host desktop.
   * @param request - path after best-effort Session workspace resolution.
   * @param signal - caller lifetime; abort terminates the native command.
   * @returns confirmation after the native opener accepts the path.
   * @throws RemoteError when the request is invalid, has no verified Host mapping, is cancelled, or the opener fails.
   */
  @Remote('openWorkspacePath')
  async openWorkspacePath(
    request: SessionOpenWorkspacePathRequest,
    signal: AbortSignal,
  ): Promise<SessionOpenWorkspacePathValue> {
    try {
      const path = await this.verifyDesktopPath(request.path, signal)
      if (request.action === 'reveal') await this.revealPath(path, signal)
      else if (request.application !== undefined) await this.openFileApplication(path, request.application, signal)
      else await this.openPath(path, signal)
      return { opened: true }
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'path open was aborted', {})
      if (error instanceof RemoteError) throw error
      throw new RemoteError(
        'gateway/internal',
        'path open failed',
        {},
        { cause: error },
      )
    }
  }

  /**
   * Query current file handlers on the serving desktop without activating an Agent.
   * @param request - file path in Host filesystem syntax.
   * @param signal - caller lifetime, propagated to filesystem and desktop queries.
   * @returns OS application names, icons, and default selection; empty when desktop opening is unavailable.
   * @throws RemoteError when the path is invalid, the query is cancelled, or native discovery fails.
   */
  @Remote('workspacePathApplications')
  async workspacePathApplications(
    request: { readonly path: string }, signal: AbortSignal,
  ): Promise<readonly SessionWorkspacePathApplication[]> {
    if (!this.canOpenPath()) return []
    try {
      const path = await this.verifyDesktopPath(request.path, signal)
      return await this.fileApplications(path, signal)
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'application query was aborted', {})
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', 'file application query failed', {}, { cause: error })
    }
  }

  private async verifyDesktopPath(path: string, signal: AbortSignal): Promise<string> {
    if (path.length === 0) throw new RemoteError('gateway/bad-request', 'A non-empty file path is required', {})
    signal.throwIfAborted()
    const hostPath = resolve(path)
    const { fs } = this.ctx
    const mapped = fs.processPathFromHostPath(hostPath)
    if (mapped === undefined || fs.processPath(await fs.resolve(mapped, { signal })) !== hostPath) {
      throw new RemoteError('gateway/bad-request', 'Path has no verified Host path', {})
    }
    signal.throwIfAborted()
    return hostPath
  }

  /**
   * Rename one Session after explicitly resuming it.
   * @param request - Session identity and proposed title.
   * @returns the accepted title and durable event sequence.
   */
  @Remote('rename')
  rename(request: SessionRenameRequest): Promise<SessionRenameValue> {
    return this.commands.rename(request)
  }

  /**
   * Fork one cold-readable exact event prefix into a new Session. An omitted
   * boundary selects the latest completed-turn prefix; an open cut receives
   * synthetic fork closers.
   * @param request - source Session and optional exact inclusive event boundary.
   * @returns the new Session identity.
   */
  @Remote('fork')
  fork(request: SessionForkRequest): Promise<SessionForkValue> {
    return this.commands.fork(request)
  }

  /**
   * Admit one prompt after explicitly resuming its Session.
   * @param request - Session identity, prompt content, source metadata, and delivery mode.
   * @param signal - caller cancellation before prompt admission begins.
   * @returns acknowledgement that the Agent accepted the prompt.
   */
  @Remote('prompt')
  prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue> {
    signal.throwIfAborted()
    return this.commands.prompt(request)
  }

  /**
   * Read one image proven reachable from the addressed Session log.
   * @param request - Session and attachment identities used for authorization.
   * @returns the durable attachment reference and base64-encoded bytes.
   */
  @Remote('attachment')
  attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    return this.commands.attachment(request)
  }

  /**
   * Mutate one still-pending queue occurrence, resuming a cold Agent first.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   */
  @Remote('updateQueue')
  updateQueue(request: SessionUpdateQueueRequest): Promise<SessionUpdateQueueValue> {
    return this.commands.updateQueue(request)
  }

  /**
   * Cancel one active Agent turn without dropping its pending inbox.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   */
  @Remote('cancel')
  cancel(request: SessionCancelRequest): SessionCancelValue {
    return this.commands.cancel(request)
  }

  /**
   * Read one cold-safe, message-aligned Session history page.
   * @param request - durable address, backward cursor, and page budget.
   * @param signal - cancellation for persistence reads.
   * @returns one chronological page.
   */
  @Remote('page')
  page(request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage> {
    return this.history.page(request, signal)
  }

  /**
   * Follow one Session log from its opening or resume cursor.
   * @param request - durable address and last committed sequence already held by the caller.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns a complete opening snapshot followed by gap-free durable event
   *   frames and optional cursorless assistant-stream frames.
   */
  @Remote({ mode: 'stream' })
  follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    return this.history.follow(request, signal)
  }

  /**
   * Read all registered projections without activating an Agent.
   * @param request - Session whose current values are required.
   * @param signal - cancellation for the Session observation.
   * @returns complete baseline, or null when the Session does not exist.
   */
  @Remote('projections')
  async projections(request: SessionProjectionsRequest, signal: AbortSignal): Promise<SessionProjectionsValue> {
    const { sessionId } = request
    if (sessionId.length === 0) {
      throw new RemoteError('gateway/bad-request', 'sessionId must not be empty', {})
    }
    try {
      using observation = await this.ctx.sessionQuery.observeSession(sessionId, { signal })
      const projections = observation.projections
      if (projections === undefined) {
        throw new RemoteError('session/projections-unavailable', 'Session projections are unavailable', {})
      }
      return {
        asOfSeq: projections.asOfSeq,
        values: browserProjectionValues(projections.values, this.browserView) as SessionProjectionValues,
      }
    } catch (error: unknown) {
      if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') return null
      if (signal.aborted
        || (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED')) {
        throw new RemoteError('gateway/cancelled', 'Session projection read was cancelled', {}, { cause: error })
      }
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', 'Session projection read failed', {}, { cause: error })
    }
  }

  /**
   * Stream a complete live-control baseline followed by replacement frames.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns one complete baseline followed by live replacement frames.
   */
  @Remote({ mode: 'stream' })
  control(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    return this.controlState.control(signal)
  }


}

export { buildModelCatalog }
export default SessionController
