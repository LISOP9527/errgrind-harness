/** Browser contribution for the ErrGrind Error episode conversation cards. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationNodeContext, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode, ChatNodeDataMap } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@errgrind/episode'
import { DerivedErrorCard, DiagnosisConclusionCard, DrillAnswerDraftCard, DrillDraftCard, DrillJudgmentCard, DrillQuestionCard, ErrorEpisodeCard, GrillQuestionCard, IntakeClarificationCard, TeachStepCard } from './EpisodeCards.tsx'
import { ErrGrindBrandMark, ErrGrindBrandName, ErrGrindHeroBrandMark } from './Brand.tsx'
import { en, NS, zh } from './locales.ts'
import { ModelOnboarding } from './ModelOnboarding.tsx'
import type { ErrorCardProps, EpisodeCardInjected, TeachStepProps, DrillDraftCardProps } from './EpisodeCards.tsx'
import { ErrorHistory } from './ErrorHistory.tsx'

/** Activity ids an ErrGrind node publishes for the shared Turn-tail label. */
export type TurnActivity =
  'recorded' | 'asked' | 'clarified' | 'diagnosed' | 'explained' | 'practice' | 'drafted' | 'scored'

/** Safe fields displayed in the Error card. */
export interface ErrorCardData {
  readonly activity?: TurnActivity
  readonly revision: number
  readonly description: string
  readonly confirmed: boolean
  readonly diagnosisStatus: 'supported' | 'undetermined' | null
}

/** Safe fields displayed by one diagnosis conclusion row. */
export interface DiagnosisData {
  readonly activity?: TurnActivity
  readonly summary: string
  readonly remainingUncertainty: string | null
}

/** Safe question displayed in a Grill timeline row. */
export interface GrillQuestionData {
  readonly activity?: TurnActivity
  readonly question: string
}

/** Safe intake question displayed before the first Grill probe. */
export interface IntakeClarificationData {
  readonly activity?: TurnActivity
  readonly text: string
  readonly turn: number
}

/** Discriminator for public Teach step messages. */
export type TeachStepKind = 'question' | 'hint' | 'explanation'

/** Safe Teach step displayed in a Teach timeline row. */
export interface TeachStepData {
  readonly activity?: TurnActivity
  readonly kind: TeachStepKind
  readonly text: string
}

/** Public practice question text shown to the learner. */
export interface DrillQuestionData {
  readonly activity?: TurnActivity
  readonly question: string
}
/** Model-transcribed image answer awaiting the learner's explicit review. */
export interface DrillAnswerDraftData {
  readonly activity?: TurnActivity
  readonly revision: number
  readonly preparationId: string
  readonly text: string
}
/** Verdict and feedback of one judged practice answer. */
export interface DrillJudgmentData {
  readonly activity?: TurnActivity
  readonly preparationId: string
  readonly isCorrect: boolean
  readonly feedback: string
}
/** Opening snapshot of an Error derived from a wrong practice answer. */
export interface DerivedErrorData {
  readonly activity?: TurnActivity
  readonly question: string
  readonly userResponse: string
}
/** Draft-generation outcomes that need learner-facing recovery guidance. */
export type DrillDraftCardStatus = 'failed' | 'aborted'
/** Failure notice of one answer-draft generation. */
export interface DrillDraftCardData {
  readonly activity?: TurnActivity
  readonly preparationId: string
  readonly status: DrillDraftCardStatus
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'errgrind-error-card': ErrorCardData
    'errgrind-diagnosis': DiagnosisData
    'errgrind-grill-question': GrillQuestionData
    'errgrind-intake-clarification': IntakeClarificationData
    'errgrind-teach-step': TeachStepData
    'errgrind-drill-question': DrillQuestionData
    'errgrind-drill-answer-draft': DrillAnswerDraftData
    'errgrind-drill-judgment': DrillJudgmentData
    'errgrind-derived-error': DerivedErrorData
    'errgrind-drill-draft-card': DrillDraftCardData
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Public Error and Grill card copy. */
    errgrind: import('./locales.ts').ErrGrindKey
  }
}

interface EpisodeState {
  readonly revision: number
  readonly description: string
  readonly confirmed: boolean
  readonly diagnosisStatus: 'supported' | 'undetermined' | null
}

interface QuestionState {
  readonly question: string
}

/** Turn-tail activity each ErrGrind node kind reports for the shared process label. */
const KIND_TURN_ACTIVITY: {
  readonly [Kind in keyof Pick<ChatNodeDataMap,
    'errgrind-error-card' | 'errgrind-diagnosis' | 'errgrind-grill-question' | 'errgrind-intake-clarification' | 'errgrind-teach-step'
    | 'errgrind-drill-question' | 'errgrind-drill-answer-draft' | 'errgrind-drill-judgment'
    | 'errgrind-derived-error' | 'errgrind-drill-draft-card'>]: TurnActivity
} = {
  'errgrind-error-card': 'recorded',
  'errgrind-diagnosis': 'diagnosed',
  'errgrind-grill-question': 'asked',
  'errgrind-intake-clarification': 'clarified',
  'errgrind-teach-step': 'explained',
  'errgrind-drill-question': 'practice',
  'errgrind-drill-answer-draft': 'drafted',
  'errgrind-drill-judgment': 'scored',
  'errgrind-derived-error': 'recorded',
  'errgrind-drill-draft-card': 'practice',
}

/** Convert one assembled Context into a final Chat node at its first matched event. */
function chatNode<Kind extends keyof typeof KIND_TURN_ACTIVITY>(
  context: ConversationNodeContext,
  kind: Kind,
  data: Omit<ChatNodeDataMap[Kind], 'activity'>,
): ChatConversationViewNode & { readonly kind: Kind; readonly data: ChatNodeDataMap[Kind] } {
  const anchor = context.start?.event ?? context.matches[0]?.event
  return {
    key: context.key,
    kind,
    id: context.id,
    target: 'chat',
    anchorSeq: anchor?.seq ?? 0,
    // Domain cards stay at their event position without joining Chat's foldable Turn process.
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data: { ...data, activity: KIND_TURN_ACTIVITY[kind] } as ChatNodeDataMap[Kind],
  }
}

const episodeDefinition: ConversationNodeDefinition<EpisodeState> = {
  kind: 'errgrind-episode-card',
  target: 'chat',
  match(event) {
    if (event.type === 'errgrind/error-open' || event.type === 'errgrind/derived-error-open'
      || event.type === 'errgrind/drill-open') {
      return { id: 'episode', role: 'start' }
    }
    if (event.type === 'errgrind/error-draft'
      || event.type === 'errgrind/error-confirm'
      || event.type === 'errgrind/error-clarify'
      || event.type === 'errgrind/grill-probe'
      || event.type === 'errgrind/grill-conclude') return { id: 'episode', role: 'update' }
    return null
  },
  start(_context, match) {
    // The episode-open event is the only guaranteed lead event: clarifications,
    // probes, and conclusions may all precede the first description draft.
    if (match.event.type === 'errgrind/drill-open') {
      // A Drill Session opens already confirmed: the card shows the practiced
      // Error's description with its concluded diagnosis standing.
      return {
        revision: match.event.data.sourceRevision,
        description: match.event.data.description,
        confirmed: true,
        diagnosisStatus: match.event.data.diagnosisStatus,
      }
    }
    if (match.event.type !== 'errgrind/error-open' && match.event.type !== 'errgrind/derived-error-open') {
      throw new Error('ErrGrind Error card must start from the episode-open event')
    }
    return {
      revision: 0,
      description: match.event.data.text,
      confirmed: false,
      diagnosisStatus: null,
    }
  },
  update({ state }, match) {
    switch (match.event.type) {
      case 'errgrind/error-draft':
        return {
          revision: match.event.data.revision,
          description: match.event.data.text,
          confirmed: false,
          diagnosisStatus: null,
        }
      case 'errgrind/error-confirm':
        return match.event.data.revision === state.revision && state.diagnosisStatus !== null
          ? { ...state, confirmed: true }
          : state
      case 'errgrind/error-clarify':
        return {
          ...state,
          confirmed: false,
          diagnosisStatus: null,
        }
      case 'errgrind/grill-probe':
        return match.event.data.anchorRevision === undefined || match.event.data.anchorRevision === state.revision
          ? {
            ...state,
            confirmed: false,
            diagnosisStatus: null,
          }
          : state
      case 'errgrind/grill-conclude':
        return match.event.data.anchorRevision === undefined || match.event.data.anchorRevision === state.revision
          ? {
            ...state,
            diagnosisStatus: match.event.data.diagnosisStatus,
          }
          : state
      default:
        return state
    }
  },
  buildViewNode(context) {
    if (context.state === undefined) return null
    const data: ErrorCardData = {
      revision: context.state.revision,
      description: context.state.description,
      confirmed: context.state.confirmed,
      diagnosisStatus: context.state.diagnosisStatus,
    }
    return chatNode(context, 'errgrind-error-card', data)
  },
}

/** Diagnosis conclusion: same grill-conclude event, rendered as ordinary prose. */
const diagnosisDefinition: ConversationNodeDefinition<DiagnosisData> = {
  kind: 'errgrind-diagnosis',
  target: 'chat',
  match(event) {
    return event.type === 'errgrind/grill-conclude'
      ? { id: `seq:${event.seq}`, role: 'start' }
      : null
  },
  start(_context, match) {
    if (match.event.type !== 'errgrind/grill-conclude') throw new Error('Diagnosis conclusion must start from its conclude event')
    return {
      summary: match.event.data.summary,
      remainingUncertainty: match.event.data.remainingUncertainty ?? null,
    }
  },
  update({ state }) { return state },
  buildViewNode(context) {
    if (context.state === undefined) return null
    return chatNode(context, 'errgrind-diagnosis', context.state)
  },
}

const questionDefinition: ConversationNodeDefinition<QuestionState> = {
  kind: 'errgrind-grill-question',
  target: 'chat',
  match(event) {
    return event.type === 'errgrind/grill-probe'
      ? { id: `seq:${event.seq}`, role: 'start' }
      : null
  },
  start(_context, match) {
    if (match.event.type !== 'errgrind/grill-probe') throw new Error('Grill question must start from a public probe')
    return { question: match.event.data.probe.question }
  },
  update({ state }) { return state },
  buildViewNode(context) {
    if (context.state === undefined) return null
    return chatNode(context, 'errgrind-grill-question', { question: context.state.question })
  },
}

const clarificationDefinition: ConversationNodeDefinition<IntakeClarificationData> = {
  kind: 'errgrind-intake-clarification',
  target: 'chat',
  match(event) {
    return event.type === 'errgrind/error-clarify'
      ? { id: `seq:${event.seq}`, role: 'start' }
      : null
  },
  start(_context, match) {
    if (match.event.type !== 'errgrind/error-clarify') throw new Error('Intake clarification must start from its durable event')
    return { text: match.event.data.text, turn: match.event.data.turn }
  },
  update({ state }) { return state },
  buildViewNode(context) {
    if (context.state === undefined) return null
    return chatNode(context, 'errgrind-intake-clarification', context.state)
  },
}

const teachStepDefinition: ConversationNodeDefinition<TeachStepData> = {
  kind: 'errgrind-teach-step',
  target: 'chat',
  match(event) {
    return event.type === 'errgrind/teach-step'
      ? { id: `seq:${event.seq}`, role: 'start' }
      : null
  },
  start(_context, match) {
    if (match.event.type !== 'errgrind/teach-step') throw new Error('Teach step must start from a public teach step event')
    return {
      kind: match.event.data.kind,
      text: match.event.data.text,
    }
  },
  update({ state }) { return state },
  buildViewNode(context) {
    if (context.state === undefined) return null
    return chatNode(context, 'errgrind-teach-step', context.state)
  },
}

const drillQuestionDefinition: ConversationNodeDefinition<DrillQuestionData> = {
  kind: 'errgrind-drill-question', target: 'chat',
  match(event) {
    return event.type === 'errgrind/drill-prepared' ? { id: `seq:${event.seq}`, role: 'start' } : null
  },
  start(_context, match) {
    if (match.event.type !== 'errgrind/drill-prepared') throw new Error('Drill question requires a prepared event')
    return { question: match.event.data.question }
  },
  update({ state }) { return state },
  buildViewNode(context) {
    if (context.state === undefined) return null
    return chatNode(context, 'errgrind-drill-question', context.state)
  },
}

const drillAnswerDraftDefinition: ConversationNodeDefinition<DrillAnswerDraftData> = {
  kind: 'errgrind-drill-answer-draft', target: 'chat',
  match(event) {
    return event.type === 'errgrind/drill-answer-draft' ? { id: `seq:${event.seq}`, role: 'start' } : null
  },
  start(_context, match) {
    if (match.event.type !== 'errgrind/drill-answer-draft') throw new Error('Drill answer draft requires its public event')
    return {
      revision: match.event.data.revision,
      preparationId: match.event.data.preparationId,
      text: match.event.data.text,
    }
  },
  update({ state }) { return state },
  buildViewNode(context) {
    if (context.state === undefined) return null
    return chatNode(context, 'errgrind-drill-answer-draft', context.state)
  },
}

const drillJudgmentDefinition: ConversationNodeDefinition<DrillJudgmentData> = {
  kind: 'errgrind-drill-judgment', target: 'chat',
  match(event) {
    return event.type === 'errgrind/drill-judged' ? { id: `seq:${event.seq}`, role: 'start' } : null
  },
  start(_context, match) {
    if (match.event.type !== 'errgrind/drill-judged') throw new Error('Drill judgment requires a judged event')
    return {
      preparationId: match.event.data.preparationId,
      isCorrect: match.event.data.isCorrect,
      feedback: match.event.data.feedback,
    }
  },
  update({ state }) { return state },
  buildViewNode(context) {
    if (context.state === undefined) return null
    return chatNode(context, 'errgrind-drill-judgment', context.state)
  },
}

const derivedErrorDefinition: ConversationNodeDefinition<DerivedErrorData> = {
  kind: 'errgrind-derived-error', target: 'chat',
  match(event) {
    return event.type === 'errgrind/derived-error-open' ? { id: `seq:${event.seq}`, role: 'start' } : null
  },
  start(_context, match) {
    if (match.event.type !== 'errgrind/derived-error-open') throw new Error('Derived Error requires its source event')
    return { question: match.event.data.question, userResponse: match.event.data.userResponse }
  },
  update({ state }) { return state },
  buildViewNode(context) {
    if (context.state === undefined) return null
    return chatNode(context, 'errgrind-derived-error', context.state)
  },
}

interface DrillDraftState {
  readonly preparationId: string
  readonly status: 'success' | 'failed' | 'aborted'
}

const drillDraftDefinition: ConversationNodeDefinition<DrillDraftState> = {
  kind: 'errgrind-drill-draft-card',
  target: 'chat',
  match(event) {
    return event.type === 'errgrind/drill-draft-finished' ? { id: `seq:${event.seq}`, role: 'start' } : null
  },
  start(_context, match) {
    if (match.event.type !== 'errgrind/drill-draft-finished') throw new Error('Drill draft finished requires its public event')
    return {
      preparationId: match.event.data.preparationId,
      status: match.event.data.status,
    }
  },
  update({ state }) { return state },
  buildViewNode(context) {
    if (context.state === undefined || context.state.status === 'success') return null
    return chatNode(context, 'errgrind-drill-draft-card', {
      preparationId: context.state.preparationId,
      status: context.state.status,
    })
  },
}

/** Required services: browser locale, shared Conversation/Chat registries, and the Session command Remote. */
export const inject = ['slots', 'locale', 'sessions', 'uiConversation', 'uiWorkspace', 'remote', 'remote.commands', 'remote.session']

/** Mount ErrGrind event Definitions and keyed Chat views. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-errgrind-episode: dictionaries')
  ctx.effect(() => ctx.locale.registerOverride('common', {
    zh: { 'brand.localBuild': 'ErrGrind' },
    en: { 'brand.localBuild': 'ErrGrind' },
  }), 'ui-errgrind-episode: document title')
  ctx.effect(() => ctx.locale.registerOverride('sidebar', {
    zh: {
      'session.new': '新建 Error',
      'session.new.label': '新建 Error',
    },
    en: {
      'session.new': 'New Error',
      'session.new.label': 'New Error',
    },
  }), 'ui-errgrind-episode: sidebar copy')
  ctx.effect(() => ctx.locale.registerOverride('conversation', {
    zh: {
      'hero.headline': '从一道错题开始',
      'hero.preview': '',
      'placeholder.default': '描述错题或输入回答, / 调用指令',
      'placeholder.hero': '描述你的错题和当时的做法, / 调用指令',
      'input.commands': '添加题目图片或文件',
      'error.sessionInUse': '这条 Error 正在另一处使用。请关闭占用它的其他窗口或程序后重试。',
    },
    en: {
      'hero.headline': 'Start with a math mistake',
      'hero.preview': '',
      'placeholder.default': 'Describe the problem or type an answer, / for commands',
      'placeholder.hero': 'Describe the mistake and what you tried, / for commands',
      'input.commands': 'Add a problem image or file',
      'error.sessionInUse': 'This Error is open elsewhere. Close the other window or app using it, then try again.',
    },
  }), 'ui-errgrind-episode: composer copy')
  ctx.slots.inject('sidebar.workspaces', () => {
    const renameSession = async (sessionId: SessionId, title: string): Promise<void> => {
      const result = await ctx.sessions.using(
        sessionId,
        { source: 'workspaceOperation' },
        reference => reference.binding.session.rename(title),
      )
      if (!result.ok) throw new Error(result.error.message)
    }
    return ctx.slots.register({
      name: 'sidebar.workspaces',
      priority: -100,
      locale: NS,
      inject: () => ({
        openSession: (sessionId: SessionId) => { ctx.uiWorkspace.openSession(sessionId) },
        practiceFromError: async (sessionId: SessionId, title: string): Promise<void> => {
          const result = await ctx.remote.session.openDrill({ sourceSessionId: sessionId })
          if (!result.ok) throw new Error(`Drill request failed: ${result.error.code}`)
          await ctx.sessions.refresh()
          try {
            await renameSession(result.value.sessionId, title)
          } catch (error) {
            // A missed practice title still leaves the ordinary title fallback.
            ctx.logger.warn(`ui-errgrind-episode: practice title rename skipped: ${String(error)}`)
          }
          ctx.uiWorkspace.openSession(result.value.sessionId)
        },
        renameSession,
        archiveSession: async (sessionId: SessionId): Promise<void> => {
          await ctx.uiWorkspace.archiveSession(sessionId)
        },
        unarchiveSession: async (sessionId: SessionId): Promise<void> => {
          await ctx.uiWorkspace.unarchiveSession(sessionId)
        },
      }),
    }, ErrorHistory)
  })
  ctx.effect(() => ctx.uiConversation.events.register(episodeDefinition), 'ui-errgrind-episode: Error card')
  ctx.effect(() => ctx.uiConversation.events.register(diagnosisDefinition), 'ui-errgrind-episode: diagnosis conclusions')
  ctx.effect(() => ctx.uiConversation.events.register(questionDefinition), 'ui-errgrind-episode: Grill questions')
  ctx.effect(() => ctx.uiConversation.events.register(clarificationDefinition), 'ui-errgrind-episode: intake clarifications')
  ctx.effect(() => ctx.uiConversation.events.register(teachStepDefinition), 'ui-errgrind-episode: Teach steps')
  ctx.effect(() => ctx.uiConversation.events.register(drillQuestionDefinition), 'ui-errgrind-episode: Drill question')
  ctx.effect(() => ctx.uiConversation.events.register(drillAnswerDraftDefinition), 'ui-errgrind-episode: Drill answer draft')
  ctx.effect(() => ctx.uiConversation.events.register(drillJudgmentDefinition), 'ui-errgrind-episode: Drill judgment')
  ctx.effect(() => ctx.uiConversation.events.register(derivedErrorDefinition), 'ui-errgrind-episode: derived Error')
  ctx.effect(() => ctx.uiConversation.events.register(drillDraftDefinition), 'ui-errgrind-episode: Drill draft card')

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'errgrind-error-card',
    locale: NS,
    inject: (sessionId: SessionId): EpisodeCardInjected => ({
      confirmRevision: async (revision) => {
        try {
          const result = await ctx.remote.commands.execute(sessionId, `/error-confirm ${revision}`, [])
          if (!result.ok || result.value === undefined) return 'error'
          return result.value.result.kind === 'success' ? 'confirmed' : 'stale'
        } catch {
          return 'error'
        }
      },
    }),
  }, ErrorEpisodeCard))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'errgrind-diagnosis',
    locale: NS,
  }, DiagnosisConclusionCard))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'errgrind-grill-question',
    locale: NS,
  }, GrillQuestionCard))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'errgrind-intake-clarification',
    locale: NS,
  }, IntakeClarificationCard))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'errgrind-teach-step',
    locale: NS,
  }, TeachStepCard))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'errgrind-drill-question', locale: NS,
  }, DrillQuestionCard))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'errgrind-drill-answer-draft', locale: NS,
  }, DrillAnswerDraftCard))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'errgrind-drill-judgment', locale: NS,
    inject: (sessionId: SessionId) => ({
      openDerivedError: async (preparationId: string): Promise<boolean> => {
        const result = await ctx.remote.session.openDerivedError({ sourceSessionId: sessionId, preparationId })
        if (!result.ok) {
          return false
        }
        await ctx.sessions.refresh()
        ctx.uiWorkspace.openSession(result.value.sessionId)
        return true
      },
    }),
  }, DrillJudgmentCard))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'errgrind-derived-error', locale: NS,
  }, DerivedErrorCard))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'errgrind-drill-draft-card', locale: NS,
  }, DrillDraftCard))
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({
        name: 'sidebar.brand.mark',
        locale: NS,
      }, ErrGrindBrandMark)
      yield ctx.slots.register({
        name: 'sidebar.brand.name',
        locale: NS,
      }, ErrGrindBrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({
      name: 'conversation.hero.brand.mark',
      locale: NS,
    }, ErrGrindHeroBrandMark))
  const modelCatalog = () => ctx.remote.session.modelCatalog()
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'errgrind-model-onboarding',
    order: -100,
    locale: NS,
    inject: () => ({
      catalog: modelCatalog,
    }),
  }, ModelOnboarding))
}

export type { DrillDraftCardProps, ErrorCardProps, TeachStepProps }
