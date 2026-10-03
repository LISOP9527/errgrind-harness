// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
import type { ChatConversationViewNode, ChatNodeDataMap } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import {
  DerivedErrorCard,
  DrillAnswerDraftCard,
  DrillDraftCard,
  type DrillDraftCardProps,
  DrillJudgmentCard,
  DrillQuestionCard,
  ErrorEpisodeCard,
  GrillQuestionCard,
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
      // oxlint-disable-next-line typescript/no-unsafe-assignment
      zh: expect.objectContaining({ 'input.commands': '添加题目图片或文件' }),
      // oxlint-disable-next-line typescript/no-unsafe-assignment
      en: expect.objectContaining({ 'input.commands': 'Add a problem image or file' }),
    }))

    const registeredKinds = harness.events.entries().map(d => d.kind)
    expect(registeredKinds).toContain('errgrind-episode-card')
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
    expect(viewNode?.data).toEqual({ preparationId: 'prep-failed-1', status: 'failed' })
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
    expect(viewNode?.data).toEqual({ preparationId: 'prep-aborted-1', status: 'aborted' })
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
    expect(drillCards[0]?.data).toEqual({ preparationId: 'prep-fail', status: 'failed' })
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
      probeCount: 2,
      diagnosisStatus: null,
      summary: null,
      remainingUncertainty: null,
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
