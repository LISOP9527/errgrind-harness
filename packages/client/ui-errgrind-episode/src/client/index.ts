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
import { DerivedErrorCard, DrillAnswerDraftCard, DrillDraftCard, DrillJudgmentCard, DrillQuestionCard, ErrorEpisodeCard, GrillQuestionCard, IntakeClarificationCard, TeachStepCard } from './EpisodeCards.tsx'
import { ErrGrindBrandMark, ErrGrindBrandName, ErrGrindHeroBrandMark } from './Brand.tsx'
import { en, NS, zh } from './locales.ts'
import { CodexAuthSettings } from './CodexAuthSettings.tsx'
import { ModelOnboarding } from './ModelOnboarding.tsx'
import type { CodexAuthRemote } from './CodexAuthSettings.tsx'
import type { ErrorCardProps, EpisodeCardInjected, TeachStepProps, DrillDraftCardProps } from './EpisodeCards.tsx'
import { ErrorHistory } from './ErrorHistory.tsx'

/** Safe fields displayed in the Error card. */
export interface ErrorCardData {
  readonly revision: number
  readonly description: string
  readonly confirmed: boolean
  readonly probeCount: number
  readonly diagnosisStatus: 'supported' | 'undetermined' | null
  readonly summary: string | null
  readonly remainingUncertainty: string | null
}

/** Safe question displayed in a Grill timeline row. */
export interface GrillQuestionData {
  readonly question: string
}

/** Safe intake question displayed before the first Grill probe. */
export interface IntakeClarificationData {
  readonly text: string
  readonly turn: number
}

/** Discriminator for public Teach step messages. */
export type TeachStepKind = 'question' | 'hint' | 'explanation'

/** Safe Teach step displayed in a Teach timeline row. */
export interface TeachStepData {
  readonly kind: TeachStepKind
  readonly text: string
}

export interface DrillQuestionData { readonly question: string }
export interface DrillAnswerDraftData {
  readonly revision: number
  readonly preparationId: string
  readonly text: string
}
export interface DrillJudgmentData {
  readonly preparationId: string
  readonly isCorrect: boolean
  readonly feedback: string
}
export interface DerivedErrorData { readonly question: string; readonly userResponse: string }
export type DrillDraftCardStatus = 'failed' | 'aborted'
export interface DrillDraftCardData {
  readonly preparationId: string
  readonly status: DrillDraftCardStatus
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'errgrind-error-card': ErrorCardData
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
  readonly probeCount: number
  readonly diagnosisStatus: 'supported' | 'undetermined' | null
  readonly summary: string | null
  readonly remainingUncertainty: string | null
}

interface QuestionState {
  readonly question: string
}

/** Convert one assembled Context into a final Chat node at its first matched event. */
function chatNode<Kind extends 'errgrind-error-card' | 'errgrind-grill-question' | 'errgrind-intake-clarification' | 'errgrind-teach-step' | 'errgrind-drill-question' | 'errgrind-drill-answer-draft' | 'errgrind-drill-judgment' | 'errgrind-derived-error' | 'errgrind-drill-draft-card'>(
  context: ConversationNodeContext,
  kind: Kind,
  data: ChatNodeDataMap[Kind],
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
    data,
  }
}

const episodeDefinition: ConversationNodeDefinition<EpisodeState> = {
  kind: 'errgrind-episode-card',
  target: 'chat',
  match(event) {
    if (event.type === 'errgrind/error-draft') {
      return { id: 'episode', role: event.data.revision === 1 ? 'start' : 'update' }
    }
    if (event.type === 'errgrind/error-confirm'
      || event.type === 'errgrind/error-clarify'
      || event.type === 'errgrind/grill-probe'
      || event.type === 'errgrind/grill-conclude') return { id: 'episode', role: 'update' }
    return null
  },
  start(_context, match) {
    if (match.event.type !== 'errgrind/error-draft') throw new Error('ErrGrind Error card must start from a draft')
    return {
      revision: match.event.data.revision,
      description: match.event.data.text,
      confirmed: false,
      probeCount: 0,
      diagnosisStatus: null,
      summary: null,
      remainingUncertainty: null,
    }
  },
  update({ state }, match) {
    switch (match.event.type) {
      case 'errgrind/error-draft':
        return {
          revision: match.event.data.revision,
          description: match.event.data.text,
          confirmed: false,
          probeCount: 0,
          diagnosisStatus: null,
          summary: null,
          remainingUncertainty: null,
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
          summary: null,
          remainingUncertainty: null,
        }
      case 'errgrind/grill-probe':
        return match.event.data.anchorRevision === undefined || match.event.data.anchorRevision === state.revision
          ? {
            ...state,
            confirmed: false,
            probeCount: state.probeCount + 1,
            diagnosisStatus: null,
            summary: null,
            remainingUncertainty: null,
          }
          : state
      case 'errgrind/grill-conclude':
        return match.event.data.anchorRevision === undefined || match.event.data.anchorRevision === state.revision
          ? {
            ...state,
            diagnosisStatus: match.event.data.diagnosisStatus,
            summary: match.event.data.summary,
            remainingUncertainty: match.event.data.remainingUncertainty ?? null,
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
      probeCount: context.state.probeCount,
      diagnosisStatus: context.state.diagnosisStatus,
      summary: context.state.summary,
      remainingUncertainty: context.state.remainingUncertainty,
    }
    return chatNode(context, 'errgrind-error-card', data)
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
export const inject = ['slots', 'locale', 'sessions', 'uiConversation', 'uiWorkspace', 'remote', 'remote.commands', 'remote.session', 'remote.errgrindCodexAuth']

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
      'placeholder.default': '',
      'placeholder.hero': '',
      'input.commands': '添加题目图片或文件',
      'error.sessionInUse': '这条 Error 正在另一处使用。请关闭占用它的其他窗口或程序后重试。',
    },
    en: {
      'hero.headline': 'Start with a math mistake',
      'hero.preview': '',
      'placeholder.default': '',
      'placeholder.hero': '',
      'input.commands': 'Add a problem image or file',
      'error.sessionInUse': 'This Error is open elsewhere. Close the other window or app using it, then try again.',
    },
  }), 'ui-errgrind-episode: composer copy')
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
    name: 'sidebar.workspaces',
    priority: -100,
    locale: NS,
    inject: () => ({
      openSession: (sessionId: SessionId) => { ctx.uiWorkspace.openSession(sessionId) },
      practiceFromError: async (sessionId: SessionId): Promise<void> => {
        ctx.uiWorkspace.openSession(sessionId)
        const result = await ctx.sessions.using(
          sessionId,
          { source: 'workspaceOperation' },
          reference => reference.binding.session.prompt(
            [{ type: 'text', text: '请基于这条已确认的 Error 生成一道独立 Drill 练习。' }],
            'queue',
          ),
        )
        if (!result.ok) throw new Error(`Drill request failed: ${result.error.code}`)
      },
    }),
  }, ErrorHistory))
  ctx.effect(() => ctx.uiConversation.events.register(episodeDefinition), 'ui-errgrind-episode: Error card')
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
      auth: ctx.remote.errgrindCodexAuth,
      catalog: modelCatalog,
    }),
  }, ModelOnboarding))
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer',
    id: 'errgrind-codex-auth',
    order: 20,
    locale: NS,
    inject: (): { auth: CodexAuthRemote } => ({ auth: ctx.remote.errgrindCodexAuth }),
  }, CodexAuthSettings))
}

export type { DrillDraftCardProps, ErrorCardProps, TeachStepProps }
