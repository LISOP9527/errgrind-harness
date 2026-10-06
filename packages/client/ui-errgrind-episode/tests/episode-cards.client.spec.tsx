// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import {
  ConversationEventRegistry,
  ConversationNodeAssembler,
  ConversationViewRegistry,
  type ConversationNodeContext,
  type ConversationStartMatch,
  type ConversationViewDefinition,
  type ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  bindSnapshotSelector,
  chatSnapshot,
  conversationSnapshot,
  workspaceSnapshot,
  makeTranslate,
  sessionSnapshot,
} from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type {} from '@errgrind/episode'
import { EMPTY_CHAT_SNAPSHOT, type ChatConversationViewNode, type ChatNodeDataMap } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import {
  DerivedErrorCard,
  DiagnosisConclusionCard,
  DrillAnswerDraftCard,
  DrillDraftCard,
  type DrillDraftCardProps,
  DrillJudgmentCard,
  DrillQuestionCard,
  ErrorEpisodeCard,
  GrillQuestionCard,
  IntakeClarificationCard,
  TeachStepCard,
} from '../src/client/EpisodeCards.tsx'
import {
  ErrGrindBrandMark,
  ErrGrindBrandName,
  ErrGrindHeroBrandMark,
} from '../src/client/Brand.tsx'
import { en, NS, zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const tEn = makeTranslate(en, commonEn)
const tZh = makeTranslate(zh, commonZh)

type ChatNodeSeatProps = Omit<DrillDraftCardProps, 'node' | 't'>

/** Framework seats the cards never read; an accidental read fails loud. */
const unboundSeat = () => { throw new Error('unstubbed framework seat') }
const observable = <T,>(snapshot: T) => ({ getSnapshot: () => snapshot, subscribe: () => () => {} })
const TEST_SESSION_ID = SessionId('errgrind-test')

const chatNodeOwner: ChatNodeSeatProps = {
  openSkill: vi.fn(), openFile: vi.fn(), inspectCall: undefined, forkAt: vi.fn(),
  loadImage: async () => '', renderMessageImages: () => null, fileMentions: () => undefined,
  useTurnData: () => undefined,
  useDisclosure: () => ({ expanded: false, setExpanded: vi.fn(), toggle: vi.fn() }),
  sessionId: TEST_SESSION_ID,
  useSession: bindSnapshotSelector(observable(sessionSnapshot(TEST_SESSION_ID))),
  useProjection: unboundSeat,
  useSessions: bindSnapshotSelector(observable({
    ids: [], byId: {}, phase: 'ready' as const, projectionsBySession: {},
  })),
  useSessionStatus: bindSnapshotSelector(observable(new Map())),
  useSessionRetainInfo: unboundSeat,
  usePanelInfo: bindSnapshotSelector(observable({ activePanelId: null })),
  useResource: unboundSeat,
  useWorkspaces: bindSnapshotSelector(observable(workspaceSnapshot())),
  useConversation: bindSnapshotSelector(observable(conversationSnapshot())),
  useChat: bindSnapshotSelector(observable(chatSnapshot())),
  useInput: bindSnapshotSelector(observable({
    draft: '', attachmentIds: [], draftRev: 0, phase: 'plain' as const, occurrences: [], queue: [],
  })),
  inputActions: {
    captureInsertion: unboundSeat, insertText: unboundSeat, setDraft: unboundSeat,
    addAttachments: unboundSeat, removeAttachment: unboundSeat, pruneAttachments: unboundSeat,
    submit: unboundSeat,
  },
  useTrajectory: bindSnapshotSelector(observable({
    eventNodes: [], eventLocations: new Map(), requests: [], callSchemas: new Map(),
    partial: null, runningCalls: [],
  })),
}

function createChatNode<Kind extends keyof ChatNodeDataMap>(
  kind: Kind,
  data: ChatNodeDataMap[Kind],
): ChatConversationViewNode & { readonly kind: Kind; readonly data: ChatNodeDataMap[Kind] } {
  return {
    key: `test-${kind}`,
    kind,
    id: `node-${kind}`,
    target: 'chat',
    anchorSeq: 1,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data,
  }
}

function makeEventEntry(event: SessionEvent): SessionEventLikeEntry {
  return {
    type: 'event',
    event,
  }
}

function createTestHarness() {
  const ctx = new Context()
  const slots = new SlotRegistry(ctx)

  const locale: {
    register: ReturnType<typeof vi.fn<(namespace: string, dictionaries: { readonly zh: typeof zh; readonly en: typeof en }) => void>>
    registerOverride: ReturnType<typeof vi.fn<(namespace: string, dictionaries: Record<string, Record<string, string>>) => void>>
  } = {
    register: vi.fn(),
    registerOverride: vi.fn(),
  }
  ctx.provide('locale', locale)

  const events = new ConversationEventRegistry(ctx)
  ctx.provide('uiConversation', { events })
  ctx.provide('sessions', { refresh: vi.fn().mockResolvedValue(undefined) })
  ctx.provide('uiWorkspace', { openSession: vi.fn() })
  ctx.provide('remote', {})
  ctx.provide('remote.commands', { execute: vi.fn() })
  ctx.provide('remote.session', { openDerivedError: vi.fn() })
  return { ctx, slots, events, locale }
}

describe('ui-errgrind-episode browser plugin', () => {
  it('declares the expected Cordis service injections', () => {
    expect(inject).toContain('slots')
    expect(inject).toContain('locale')
    expect(inject).toContain('uiConversation')
  })

  it('registers all event definitions and locale dictionaries on apply', () => {
    const harness = createTestHarness()
    apply(harness.ctx)

    expect(harness.locale.register).toHaveBeenCalledWith(NS, { zh, en })
    expect(harness.locale.registerOverride).toHaveBeenCalledWith('conversation', expect.objectContaining({
      zh: expect.objectContaining({ 'input.commands': '添加题目图片或文件' }),
      en: expect.objectContaining({ 'input.commands': 'Add a problem image or file' }),
    }))

    const registeredKinds = harness.events.entries().map(d => d.kind)
    expect(registeredKinds).toContain('errgrind-episode-card')
    expect(registeredKinds).toContain('errgrind-diagnosis')
    expect(registeredKinds).toContain('errgrind-grill-question')
    expect(registeredKinds).toContain('errgrind-intake-clarification')
    expect(registeredKinds).toContain('errgrind-teach-step')
    expect(registeredKinds).toContain('errgrind-drill-question')
    expect(registeredKinds).toContain('errgrind-drill-answer-draft')
    expect(registeredKinds).toContain('errgrind-drill-judgment')
    expect(registeredKinds).toContain('errgrind-derived-error')
    expect(registeredKinds).toContain('errgrind-drill-draft-card')
  })
})

describe('Drill draft event assembly and visibility', () => {
  it('assembles failed drill draft events into visible timeline nodes', () => {
    const harness = createTestHarness()
    apply(harness.ctx)

    const def = harness.events.entries().find(d => d.kind === 'errgrind-drill-draft-card')
    expect(def).toBeDefined()

    const failedEvent: SessionEvent = {
      seq: SessionSeq(10),
      time: 1_700_000_000_010,
      type: 'errgrind/drill-draft-finished',
      data: { preparationId: 'prep-failed-1', status: 'failed' },
    }

    const match = def?.match(failedEvent)
    expect(match).toEqual({ id: 'seq:10', role: 'start' })

    const startMatch: ConversationStartMatch = {
      event: failedEvent,
      role: 'start',
      location: { kind: 'unresolved' },
    }
    const context: ConversationNodeContext = {
      key: 'test-context',
      kind: 'errgrind-drill-draft-card',
      id: 'seq:10',
      matches: [startMatch],
      start: startMatch,
      state: undefined,
      current: new Map(),
    }
    const state = def?.start(context, startMatch, { previous: () => undefined })
    expect(state).toEqual({ preparationId: 'prep-failed-1', status: 'failed' })

    const viewNode = def?.buildViewNode?.({ ...context, state }) as ChatConversationViewNode | null | undefined
    expect(viewNode).not.toBeNull()
    expect(viewNode?.kind).toBe('errgrind-drill-draft-card')
    expect(viewNode?.visibility).toBe('visible')
    expect(viewNode?.data).toEqual({ preparationId: 'prep-failed-1', status: 'failed', activity: 'practice' })
  })

  it('assembles aborted drill draft events into visible timeline nodes', () => {
    const harness = createTestHarness()
    apply(harness.ctx)

    const def = harness.events.entries().find(d => d.kind === 'errgrind-drill-draft-card')
    expect(def).toBeDefined()

    const abortedEvent: SessionEvent = {
      seq: SessionSeq(11),
      time: 1_700_000_000_011,
      type: 'errgrind/drill-draft-finished',
      data: { preparationId: 'prep-aborted-1', status: 'aborted' },
    }

    const startMatch: ConversationStartMatch = {
      event: abortedEvent,
      role: 'start',
      location: { kind: 'unresolved' },
    }
    const context: ConversationNodeContext = {
      key: 'test-context',
      kind: 'errgrind-drill-draft-card',
      id: 'seq:11',
      matches: [startMatch],
      start: startMatch,
      state: undefined,
      current: new Map(),
    }
    const state = def?.start(context, startMatch, { previous: () => undefined })
    expect(state).toEqual({ preparationId: 'prep-aborted-1', status: 'aborted' })

    const viewNode = def?.buildViewNode?.({ ...context, state }) as ChatConversationViewNode | null | undefined
    expect(viewNode).not.toBeNull()
    expect(viewNode?.kind).toBe('errgrind-drill-draft-card')
    expect(viewNode?.visibility).toBe('visible')
    expect(viewNode?.data).toEqual({ preparationId: 'prep-aborted-1', status: 'aborted', activity: 'practice' })
  })

  it('hides successful drill draft events with no extra timeline card', () => {
    const harness = createTestHarness()
    apply(harness.ctx)

    const def = harness.events.entries().find(d => d.kind === 'errgrind-drill-draft-card')
    expect(def).toBeDefined()

    const successEvent: SessionEvent = {
      seq: SessionSeq(12),
      time: 1_700_000_000_012,
      type: 'errgrind/drill-draft-finished',
      data: { preparationId: 'prep-success-1', status: 'success' },
    }

    const startMatch: ConversationStartMatch = {
      event: successEvent,
      role: 'start',
      location: { kind: 'unresolved' },
    }
    const context: ConversationNodeContext = {
      key: 'test-context',
      kind: 'errgrind-drill-draft-card',
      id: 'seq:12',
      matches: [startMatch],
      start: startMatch,
      state: undefined,
      current: new Map(),
    }
    const state = def?.start(context, startMatch, { previous: () => undefined })
    expect(state).toEqual({ preparationId: 'prep-success-1', status: 'success' })

    const viewNode = def?.buildViewNode?.({ ...context, state }) as ChatConversationViewNode | null | undefined
    expect(viewNode).toBeNull()
  })

  it('ignores unrelated events in drill draft definition match', () => {
    const harness = createTestHarness()
    apply(harness.ctx)

    const def = harness.events.entries().find(d => d.kind === 'errgrind-drill-draft-card')
    const unrelated: SessionEvent = {
      seq: SessionSeq(1),
      time: 1_700_000_000_001,
      type: 'errgrind/drill-prepared',
      data: {
        id: 'drill-1',
        question: 'Solve 2x = 4',
        referenceAnswer: 'x = 2',
        spec: {
          targetMechanism: 'linear', trigger: 'equation', desiredBehavior: 'isolate',
          successSignal: 'correct', novelty: 'low', difficulty: 1,
        },
        sourceRevision: 1,
        sourceDiagnosisRound: 1,
        preparedAtTurn: 1,
      },
    }
    expect(def?.match(unrelated)).toBeNull()
  })

  it('reconstructs failure into visible guidance and hides success through ConversationNodeAssembler', () => {
    const harness = createTestHarness()
    apply(harness.ctx)

    const viewRegistry = new ConversationViewRegistry(harness.ctx)
    const assembledNodes: ConversationViewNode[] = []
    const chatView: ConversationViewDefinition<ConversationViewNode, { nodes: readonly ConversationViewNode[] }> = {
      target: 'chat',
      create: () => ({
        empty: { nodes: [] },
        replace: ({ nodes }) => {
          assembledNodes.length = 0
          assembledNodes.push(...nodes)
          return { nodes }
        },
        apply: ({ upserts }) => {
          assembledNodes.push(...upserts)
          return { nodes: assembledNodes }
        },
      }),
    }
    viewRegistry.register(chatView)

    const assembler = new ConversationNodeAssembler(harness.events, viewRegistry)
    assembler.activateTarget('chat')

    const entries: SessionEventLikeEntry[] = [
      makeEventEntry({
        seq: SessionSeq(1),
        time: 1_700_000_000_001,
        type: 'errgrind/drill-draft-finished',
        data: { preparationId: 'prep-fail', status: 'failed' },
      }),
      makeEventEntry({
        seq: SessionSeq(2),
        time: 1_700_000_000_002,
        type: 'errgrind/drill-draft-finished',
        data: { preparationId: 'prep-ok', status: 'success' },
      }),
    ]

    assembler.replaceWindow(entries, false)
    assembler.flush()

    const drillCards = assembledNodes.filter(n => n.kind === 'errgrind-drill-draft-card')
    expect(drillCards).toHaveLength(1)
    expect(drillCards[0]?.data).toEqual({ preparationId: 'prep-fail', status: 'failed', activity: 'practice' })
  })
})

describe('Error episode card assembly', () => {
  it('starts from the episode-open event so pre-draft updates do not orphan the card', () => {
    const harness = createTestHarness()
    apply(harness.ctx)

    const viewRegistry = new ConversationViewRegistry(harness.ctx)
    const assembledNodes: ConversationViewNode[] = []
    const chatView: ConversationViewDefinition<ConversationViewNode, { nodes: readonly ConversationViewNode[] }> = {
      target: 'chat',
      create: () => ({
        empty: { nodes: [] },
        replace: ({ nodes }) => {
          assembledNodes.length = 0
          assembledNodes.push(...nodes)
          return { nodes }
        },
        apply: ({ upserts }) => {
          assembledNodes.push(...upserts)
          return { nodes: assembledNodes }
        },
      }),
    }
    viewRegistry.register(chatView)

    const assembler = new ConversationNodeAssembler(harness.events, viewRegistry)
    assembler.activateTarget('chat')

    // The reported sequence: the model asked a clarification and probed before
    // it ever published a description draft, so the first matched update had
    // no start Match and assembly threw.
    const entries: SessionEventLikeEntry[] = [
      makeEventEntry({
        seq: SessionSeq(1),
        time: 1_700_000_000_001,
        type: 'errgrind/error-open',
        data: { text: '题目文本', turn: 1 },
      }),
      makeEventEntry({
        seq: SessionSeq(2),
        time: 1_700_000_000_002,
        type: 'errgrind/error-clarify',
        data: { text: '当时用什么方法？', turn: 2 },
      }),
      makeEventEntry({
        seq: SessionSeq(3),
        time: 1_700_000_000_003,
        type: 'errgrind/error-draft',
        data: { revision: 1, text: '根据你目前提供的信息：…' },
      }),
      makeEventEntry({
        seq: SessionSeq(4),
        time: 1_700_000_000_004,
        type: 'errgrind/grill-conclude',
        data: { anchorRevision: 1, diagnosisStatus: 'supported', summary: '暂定结论', turn: 3 },
      }),
      makeEventEntry({
        seq: SessionSeq(5),
        time: 1_700_000_000_005,
        type: 'errgrind/error-confirm',
        data: { revision: 1, commandId: 'cmd-1' },
      }),
    ]

    expect(() => {
      assembler.replaceWindow(entries, false)
      assembler.flush()
    }).not.toThrow()

    const card = assembledNodes.find(n => n.kind === 'errgrind-error-card')
    expect(card?.data).toMatchObject({
      revision: 1,
      description: '根据你目前提供的信息：…',
      confirmed: true,
      diagnosisStatus: 'supported',
    })

    const diagnosis = assembledNodes.find(n => n.kind === 'errgrind-diagnosis')
    expect(diagnosis?.data).toMatchObject({
      summary: '暂定结论',
      remainingUncertainty: null,
    })
  })
})

describe('DrillDraftCard presentation', () => {
  it('renders recovery guidance in English when drill draft fails', () => {
    const node = createChatNode('errgrind-drill-draft-card', {
      preparationId: 'prep-failed-en',
      status: 'failed',
    })

    render(<DrillDraftCard node={node} t={tEn} {...chatNodeOwner} />)

    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(en['drill.draftFailed.title'])
    expect(screen.getByText(en['drill.draftFailed.statusFailed'])).toBeTruthy()
    expect(screen.getByText(en['drill.draftFailed.failed'])).toBeTruthy()

    expect(screen.queryByText(/openai/i)).toBeNull()
    expect(screen.queryByText(/codex/i)).toBeNull()
    expect(screen.queryByText(/error trace/i)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('renders recovery guidance in Chinese when drill draft is aborted', () => {
    const node = createChatNode('errgrind-drill-draft-card', {
      preparationId: 'prep-aborted-zh',
      status: 'aborted',
    })

    render(<DrillDraftCard node={node} t={tZh} {...chatNodeOwner} />)

    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(zh['drill.draftFailed.title'])
    expect(screen.getByText(zh['drill.draftFailed.statusAborted'])).toBeTruthy()
    expect(screen.getByText(zh['drill.draftFailed.aborted'])).toBeTruthy()

    expect(screen.queryByText(/provider/i)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})

describe('Existing conversation cards assembly and presentation', () => {
  it('renders ErrorEpisodeCard, GrillQuestionCard, and TeachStepCard with expected data', () => {
    const errorNode = createChatNode('errgrind-error-card', {
      revision: 1,
      description: 'Misapplied distributive property',
      confirmed: false,
      diagnosisStatus: null,
    })
    const { unmount: unmountError } = render(
      <ErrorEpisodeCard node={errorNode} t={tEn} confirmRevision={vi.fn()} {...chatNodeOwner} />,
    )
    expect(screen.getByText('Misapplied distributive property')).toBeTruthy()
    unmountError()

    const questionNode = createChatNode('errgrind-grill-question', {
      question: 'Did you multiply both terms inside the parentheses?',
    })
    const { unmount: unmountQuestion } = render(
      <GrillQuestionCard node={questionNode} t={tEn} {...chatNodeOwner} />,
    )
    expect(screen.getByText('Did you multiply both terms inside the parentheses?')).toBeTruthy()
    unmountQuestion()

    const teachNode = createChatNode('errgrind-teach-step', {
      kind: 'hint',
      text: 'Remember to multiply every term.',
    })
    const { unmount: unmountTeach } = render(
      <TeachStepCard node={teachNode} t={tEn} {...chatNodeOwner} />,
    )
    expect(screen.getByText('Remember to multiply every term.')).toBeTruthy()
    unmountTeach()
  })

  it('renders DrillQuestionCard, DrillAnswerDraftCard, DrillJudgmentCard, and DerivedErrorCard', () => {
    const questionNode = createChatNode('errgrind-drill-question', {
      question: 'Simplify 3(2x + 4)',
    })
    const { unmount: unmountQ } = render(<DrillQuestionCard node={questionNode} t={tEn} {...chatNodeOwner} />)
    expect(screen.getByText('Simplify 3(2x + 4)')).toBeTruthy()
    unmountQ()

    const draftNode = createChatNode('errgrind-drill-answer-draft', {
      revision: 1,
      preparationId: 'prep-1',
      text: '6x + 12',
    })
    const { unmount: unmountDraft } = render(<DrillAnswerDraftCard node={draftNode} t={tEn} {...chatNodeOwner} />)
    expect(screen.getByText('6x + 12')).toBeTruthy()
    unmountDraft()

    const judgmentNode = createChatNode('errgrind-drill-judgment', {
      preparationId: 'prep-1',
      isCorrect: true,
      feedback: 'Good work on distribution.',
    })
    const { unmount: unmountJudge } = render(
      <DrillJudgmentCard node={judgmentNode} t={tEn} openDerivedError={vi.fn().mockResolvedValue(true)} {...chatNodeOwner} />,
    )
    expect(screen.getByText('Good work on distribution.')).toBeTruthy()
    unmountJudge()

    const derivedNode = createChatNode('errgrind-derived-error', {
      question: 'Simplify 3(2x + 4)',
      userResponse: '6x + 4',
    })
    const { unmount: unmountDerived } = render(<DerivedErrorCard node={derivedNode} t={tEn} {...chatNodeOwner} />)
    expect(screen.getByText(/6x \+ 4/)).toBeTruthy()
    unmountDerived()

    const clarificationNode = createChatNode('errgrind-intake-clarification', {
      text: 'The answer key said 6x + 12.',
      turn: 1,
    })
    const { unmount: unmountClarification } = render(<IntakeClarificationCard node={clarificationNode} t={tEn} {...chatNodeOwner} />)
    expect(screen.getByText('The answer key said 6x + 12.')).toBeTruthy()
    unmountClarification()
  })
})

describe('Prompt card resolution framing', () => {
  function chatWith(order: readonly string[], nodes: readonly ChatConversationViewNode[]) {
    const byKey = new Map(nodes.map(node => [node.key, node]))
    return bindSnapshotSelector(observable(chatSnapshot({
      order,
      nodes: { ...EMPTY_CHAT_SNAPSHOT.nodes, get: key => byKey.get(key) },
    })))
  }

  it('keeps the frame while a Grill prompt is pending and flattens it once the flow moves on', () => {
    const pending = createChatNode('errgrind-grill-question', { question: 'Still open?' })
    const { unmount } = render(<GrillQuestionCard node={pending} t={tEn} {...chatNodeOwner} />)
    expect(screen.getByText(en['question.label'])).toBeTruthy()
    unmount()

    const answered = createChatNode('errgrind-grill-question', { question: 'Earlier question?' })
    const later = createChatNode('errgrind-teach-step', { kind: 'hint', text: 'A later hint.' })
    render(
      <GrillQuestionCard node={answered} t={tEn} {...chatNodeOwner}
        useChat={chatWith([answered.key, later.key], [answered, later])} />,
    )
    expect(screen.queryByText(en['question.label'])).toBeNull()
    expect(screen.getByText('Earlier question?')).toBeTruthy()
  })

  it('does not let a second pending Grill prompt or a missing later node resolve the first', () => {
    const first = createChatNode('errgrind-grill-question', { question: 'First?' })
    const second = { ...createChatNode('errgrind-grill-question', { question: 'Second?' }), key: 'test-grill-second' }
    const useChat = chatWith([first.key, second.key, 'ghost-node'], [first, second])
    render(<GrillQuestionCard node={first} t={tEn} {...chatNodeOwner} useChat={useChat} />)
    expect(screen.getByText(en['question.label'])).toBeTruthy()
  })

  it('flattens an answered Drill question and a reviewed answer draft', () => {
    const question = createChatNode('errgrind-drill-question', { question: 'Compute 3 + 4.' })
    const draft = createChatNode('errgrind-drill-answer-draft', {
      revision: 1, preparationId: 'prep-1', text: '7',
    })
    const judgment = createChatNode('errgrind-drill-judgment', {
      preparationId: 'prep-1', isCorrect: true, feedback: 'Right.',
    })
    const useChat = chatWith(
      [question.key, draft.key, judgment.key],
      [question, draft, judgment],
    )

    const { unmount } = render(
      <DrillQuestionCard node={question} t={tEn} {...chatNodeOwner} useChat={useChat} />,
    )
    expect(screen.queryByText(en['drill.question'])).toBeNull()
    expect(screen.getByText('Compute 3 + 4.')).toBeTruthy()
    unmount()

    render(<DrillAnswerDraftCard node={draft} t={tEn} {...chatNodeOwner} useChat={useChat} />)
    expect(screen.queryByText(en['drill.answerDraft'])).toBeNull()
    expect(screen.queryByText(en['drill.answerDraftReview'])).toBeNull()
    expect(screen.getByText('7')).toBeTruthy()
  })

  it('keeps the review hint while a Drill answer draft still waits for the learner', () => {
    const draft = createChatNode('errgrind-drill-answer-draft', {
      revision: 1, preparationId: 'prep-1', text: '7',
    })
    render(<DrillAnswerDraftCard node={draft} t={tEn} {...chatNodeOwner} useChat={chatWith([draft.key], [draft])} />)
    expect(screen.getByText(en['drill.answerDraft'])).toBeTruthy()
    expect(screen.getByText(en['drill.answerDraftReview'])).toBeTruthy()
  })

  it('renders a clarification as ordinary prose without a prompt frame', () => {
    const pending = createChatNode('errgrind-intake-clarification', { text: 'Which step came first?', turn: 1 })
    const { container, unmount } = render(
      <IntakeClarificationCard node={pending} t={tEn} {...chatNodeOwner}
        useChat={chatWith([pending.key], [pending])} />,
    )
    expect(container.textContent).toBe('Which step came first?')
    unmount()

    const resolved = createChatNode('errgrind-intake-clarification', { text: 'Which step came first?', turn: 1 })
    const later = createChatNode('errgrind-teach-step', { kind: 'hint', text: 'A later hint.' })
    const { container: resolvedContainer } = render(
      <IntakeClarificationCard node={resolved} t={tEn} {...chatNodeOwner}
        useChat={chatWith([resolved.key, later.key], [resolved, later])} />,
    )
    expect(resolvedContainer.textContent).toBe('Which step came first?')
  })

  it('hides a clarification the conclusion restates and keeps one it does not cover', () => {
    const restated = createChatNode('errgrind-intake-clarification', {
      text: 'Evidence cannot separate the two explanations yet.', turn: 1,
    })
    const absorbedBy = diagnosisNode({
      summary: 'Evidence cannot separate the two explanations yet. One more finding follows.',
      remainingUncertainty: null,
    })
    render(
      <IntakeClarificationCard node={restated} t={tEn} {...chatNodeOwner}
        useChat={chatWith([restated.key, absorbedBy.key], [restated, absorbedBy])} />,
    )
    expect(screen.queryByText(/Evidence cannot separate/)).toBeNull()

    const distinct = createChatNode('errgrind-intake-clarification', {
      text: 'A note the conclusion never repeats.', turn: 1,
    })
    const unrelated = diagnosisNode({ summary: 'An unrelated conclusion.', remainingUncertainty: null })
    render(
      <IntakeClarificationCard node={distinct} t={tEn} {...chatNodeOwner}
        useChat={chatWith([distinct.key, unrelated.key], [distinct, unrelated])} />,
    )
    expect(screen.getByText('A note the conclusion never repeats.')).toBeTruthy()
  })

  it('keeps a clarification beside an unrelated diagnosis, a missing order entry, and when empty', () => {
    const stray = createChatNode('errgrind-intake-clarification', { text: 'Off the ordered list.', turn: 1 })
    const { unmount } = render(
      <IntakeClarificationCard node={stray} t={tEn} {...chatNodeOwner}
        useChat={chatWith([], [])} />,
    )
    expect(screen.getByText('Off the ordered list.')).toBeTruthy()
    unmount()

    const blank = createChatNode('errgrind-intake-clarification', { text: '', turn: 1 })
    const diagnosis = diagnosisNode({ remainingUncertainty: null })
    render(
      <IntakeClarificationCard node={blank} t={tEn} {...chatNodeOwner}
        useChat={chatWith([blank.key, diagnosis.key], [blank, diagnosis])} />,
    )
  })
})

function errorCardNode(overrides: Partial<ChatNodeDataMap['errgrind-error-card']> = {}) {
  return createChatNode('errgrind-error-card', {
    revision: 1,
    description: 'Misapplied distributive property',
    confirmed: false,
    diagnosisStatus: null,
    ...overrides,
  })
}

function diagnosisNode(overrides: Partial<ChatNodeDataMap['errgrind-diagnosis']> = {}) {
  return createChatNode('errgrind-diagnosis', {
    summary: 'The learner distributed only to the first term.',
    remainingUncertainty: 'Whether the same slip recurs with fractions.',
    ...overrides,
  })
}

describe('ErrorEpisodeCard states', () => {
  it('shows only the description and confirm control while unconfirmed', async () => {
    const confirmRevision = vi.fn().mockResolvedValue('confirmed' as const)
    render(
      <ErrorEpisodeCard
        node={errorCardNode({ diagnosisStatus: 'supported' })}
        t={tEn}
        confirmRevision={confirmRevision}
        {...chatNodeOwner}
      />,
    )

    expect(screen.getByText(en['card.pending'])).toBeTruthy()
    expect(screen.getByText(en['card.pendingProposalHint'])).toBeTruthy()
    expect(screen.getByText('Misapplied distributive property')).toBeTruthy()

    fireEvent.submit(screen.getByRole('button', { name: en['card.confirm'] }).closest('form')!)
    await waitFor(() => { expect(screen.getByText(en['card.confirmedNotice'])).toBeTruthy() })
    expect(confirmRevision).toHaveBeenCalledWith(1)
  })

  it('shows the revise hint without a status badge while no diagnosis exists', () => {
    render(
      <ErrorEpisodeCard node={errorCardNode()} t={tEn} confirmRevision={vi.fn()} {...chatNodeOwner} />,
    )
    expect(screen.getByText(en['card.reviseHint'])).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders the confirmed card with no confirm form and no diagnosis body', () => {
    render(
      <ErrorEpisodeCard
        node={errorCardNode({ confirmed: true, diagnosisStatus: 'supported' })}
        t={tEn}
        confirmRevision={vi.fn()}
        {...chatNodeOwner}
      />,
    )

    expect(screen.getByText(en['card.confirmed'])).toBeTruthy()
    expect(screen.getByText('Misapplied distributive property')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(en['card.reviseHint'])).toBeNull()
    expect(screen.queryByText(en['card.pendingProposalHint'])).toBeNull()
  })

  it('renders a diagnosis conclusion as ordinary prose without card chrome', () => {
    const { container } = render(
      <DiagnosisConclusionCard node={diagnosisNode()} t={tEn} {...chatNodeOwner} />,
    )

    expect(container.querySelector('article')).toBeNull()
    expect(screen.getByText('The learner distributed only to the first term.')).toBeTruthy()
    expect(screen.getByText('Whether the same slip recurs with fractions.')).toBeTruthy()
  })

  it('omits the uncertainty paragraph when the diagnosis leaves none', () => {
    render(
      <DiagnosisConclusionCard
        node={diagnosisNode({ summary: 'Concluded.', remainingUncertainty: null })}
        t={tEn}
        {...chatNodeOwner}
      />,
    )
    expect(screen.getByText('Concluded.')).toBeTruthy()
    expect(screen.queryByText('Whether the same slip recurs with fractions.')).toBeNull()
  })

  it('reports a stale confirmation attempt', async () => {
    const confirmRevision = vi.fn().mockResolvedValue('stale' as const)
    render(
      <ErrorEpisodeCard
        node={errorCardNode({ diagnosisStatus: 'supported' })}
        t={tEn}
        confirmRevision={confirmRevision}
        {...chatNodeOwner}
      />,
    )
    fireEvent.submit(screen.getByRole('button', { name: en['card.confirm'] }).closest('form')!)
    await waitFor(() => { expect(screen.getByText(en['card.stale'])).toBeTruthy() })
  })

  it('reports a failed confirmation attempt from an error result and from a rejection', async () => {
    const confirmRevision = vi.fn().mockResolvedValue('error' as const)
    const { unmount } = render(
      <ErrorEpisodeCard
        node={errorCardNode({ diagnosisStatus: 'supported' })}
        t={tEn}
        confirmRevision={confirmRevision}
        {...chatNodeOwner}
      />,
    )
    fireEvent.submit(screen.getByRole('button', { name: en['card.confirm'] }).closest('form')!)
    await waitFor(() => { expect(screen.getByText(en['card.confirmFailed'])).toBeTruthy() })
    unmount()

    const rejecting = vi.fn().mockRejectedValue(new Error('offline'))
    render(
      <ErrorEpisodeCard
        node={errorCardNode({ diagnosisStatus: 'supported' })}
        t={tEn}
        confirmRevision={rejecting}
        {...chatNodeOwner}
      />,
    )
    fireEvent.submit(screen.getByRole('button', { name: en['card.confirm'] }).closest('form')!)
    await waitFor(() => { expect(screen.getByText(en['card.confirmFailed'])).toBeTruthy() })
  })

  it('disables the button and shows progress while confirmation is in flight', async () => {
    let settle: (value: 'confirmed') => void = () => {}
    const confirmRevision = vi.fn().mockImplementation(() => new Promise<'confirmed'>((resolve) => { settle = resolve }))
    render(
      <ErrorEpisodeCard
        node={errorCardNode({ diagnosisStatus: 'supported' })}
        t={tEn}
        confirmRevision={confirmRevision}
        {...chatNodeOwner}
      />,
    )
    fireEvent.submit(screen.getByRole('button', { name: en['card.confirm'] }).closest('form')!)
    const busy = await screen.findByRole('button', { name: en['card.confirming'] })
    expect(busy).toHaveProperty('disabled', true)
    settle('confirmed')
    await waitFor(() => { expect(screen.getByText(en['card.confirmedNotice'])).toBeTruthy() })
  })
})

describe('DrillJudgmentCard derived-error action', () => {
  it('opens the derived error on click for an incorrect verdict', async () => {
    const openDerivedError = vi.fn().mockResolvedValue(true)
    const node = createChatNode('errgrind-drill-judgment', {
      preparationId: 'prep-7',
      isCorrect: false,
      feedback: 'You combined like terms incorrectly.',
    })
    render(<DrillJudgmentCard node={node} t={tEn} openDerivedError={openDerivedError} {...chatNodeOwner} />)

    expect(screen.getByText(en['drill.incorrect'])).toBeTruthy()
    expect(screen.getByText('You combined like terms incorrectly.')).toBeTruthy()

    let settle: (value: boolean) => void = () => {}
    openDerivedError.mockImplementation(() => new Promise<boolean>((resolve) => { settle = resolve }))
    fireEvent.click(screen.getByRole('button', { name: en['drill.openDerived'] }))
    const busy = await screen.findByRole('button', { name: en['drill.openingDerived'] })
    expect(busy).toHaveProperty('disabled', true)
    settle(true)
    await waitFor(() => { expect(openDerivedError).toHaveBeenCalledWith('prep-7') })
  })

  it('shows an alert when opening fails and when the call rejects', async () => {
    const openDerivedError = vi.fn().mockResolvedValue(false)
    const node = createChatNode('errgrind-drill-judgment', {
      preparationId: 'prep-8',
      isCorrect: false,
      feedback: 'Incorrect.',
    })
    const { unmount } = render(<DrillJudgmentCard node={node} t={tEn} openDerivedError={openDerivedError} {...chatNodeOwner} />)
    fireEvent.click(screen.getByRole('button', { name: en['drill.openDerived'] }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en['drill.openFailed']) })
    unmount()

    const rejecting = vi.fn().mockRejectedValue(new Error('gone'))
    render(<DrillJudgmentCard node={node} t={tEn} openDerivedError={rejecting} {...chatNodeOwner} />)
    fireEvent.click(screen.getByRole('button', { name: en['drill.openDerived'] }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en['drill.openFailed']) })
  })
})

describe('ErrGrind branding slots and components', () => {
  it('renders ErrGrindBrandMark at requested size with simple typographic mark', () => {
    const { container, rerender } = render(<ErrGrindBrandMark size={24} t={tEn} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('width')).toBe('24')
    expect(svg?.getAttribute('height')).toBe('24')
    expect(svg?.querySelector('text')?.textContent).toBe('EG')

    rerender(<ErrGrindBrandMark size={18} t={tEn} />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('18')
  })

  it('renders ErrGrindHeroBrandMark with requested size and className', () => {
    const { container } = render(<ErrGrindHeroBrandMark size={34} className="hero-fish" t={tEn} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('width')).toBe('34')
    expect(svg?.getAttribute('height')).toBe('34')
    expect(svg?.getAttribute('class')).toContain('hero-fish')
    expect(svg?.querySelector('text')?.textContent).toBe('EG')
  })

  it('renders ErrGrindBrandName using typed locale dictionary', () => {
    const { rerender } = render(<ErrGrindBrandName t={tEn} />)
    expect(screen.getByText('ErrGrind')).toBeTruthy()

    rerender(<ErrGrindBrandName t={tZh} />)
    expect(screen.getByText('ErrGrind')).toBeTruthy()
  })

  it('injects branding slots into declaration points and removes them on teardown', () => {
    const harness = createTestHarness()
    apply(harness.ctx)

    expect(harness.slots.entries('sidebar.brand.mark')).toHaveLength(0)
    expect(harness.slots.entries('sidebar.brand.name')).toHaveLength(0)
    expect(harness.slots.entries('conversation.hero.brand.mark')).toHaveLength(0)

    const unregisterHoles = harness.slots.register({
      name: 'root',
      children: {
        'sidebar.brand.mark': { kind: 'single', scope: 'root' },
        'sidebar.brand.name': { kind: 'single', scope: 'root' },
        'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
      },
    }, (_props: PropsRuntime<'root'> & PropsRenderSlots<'sidebar.brand.mark' | 'sidebar.brand.name' | 'conversation.hero.brand.mark'>) => null)

    expect(harness.slots.entries('sidebar.brand.mark')).toHaveLength(1)
    expect(harness.slots.entries('sidebar.brand.name')).toHaveLength(1)
    expect(harness.slots.entries('conversation.hero.brand.mark')).toHaveLength(1)

    unregisterHoles()
    expect(harness.slots.entries('sidebar.brand.mark')).toHaveLength(0)
    expect(harness.slots.entries('sidebar.brand.name')).toHaveLength(0)
    expect(harness.slots.entries('conversation.hero.brand.mark')).toHaveLength(0)
  })

})
