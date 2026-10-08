// @vitest-environment jsdom
/** Episode events anchored outside a step still order the card in the chat snapshot. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import {
  ConversationEventRegistry,
  ConversationNodeAssembler,
  ConversationViewRegistry,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { chatViewDefinition } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts'
import { apply } from '../src/client/index.ts'

const NOW = 1_700_000_000_000

/** Mirrors the imported-session layout: error-open sits between turn/start and step/start. */
const EVENTS: SessionEventLikeEntry[] = ([
  [3, 'turn/start', { turn: 1 }],
  [4, 'errgrind/error-open', { text: 'Solve x^2 = 9', turn: 1 }],
  [5, 'step/start', { turn: 1, step: 1 }],
  [6, 'system/message', { id: 'm6', role: 'system', content: [], source: { kind: 'user' } }],
  [7, 'user/message', { id: 'm7', role: 'user', content: [{ type: 'text', text: 'Solve x^2 = 9' }], source: { kind: 'user' } }],
  [8, 'step/end', { turn: 1, step: 1 }],
  [9, 'turn/end', { turn: 1 }],
  [10, 'errgrind/error-draft', { revision: 1, text: 'x^2 = 9 solution' }],
  [11, 'turn/start', { turn: 2 }],
  [12, 'step/start', { turn: 2, step: 1 }],
] as const).map(([seq, type, data]) => ({
  type: 'event' as const,
  event: { seq, time: NOW + seq, type, data } as never,
}))

describe('step-external episode anchors', () => {
  it('orders the Error card ahead of the first message through the chat builder', () => {
    const ctx = new Context()
    new SlotRegistry(ctx)
    ctx.provide('locale', { register: vi.fn(), registerOverride: vi.fn(), bind: vi.fn(() => (key: string) => key) })
    const events = new ConversationEventRegistry(ctx)
    ctx.provide('uiConversation', { events })
    ctx.provide('sessions', { refresh: vi.fn() })
    ctx.provide('uiWorkspace', { openSession: vi.fn() })
    ctx.provide('remote', {})
    ctx.provide('remote.commands', { execute: vi.fn() })
    ctx.provide('remote.session', { openDerivedError: vi.fn() })
    apply(ctx)

    const views = new ConversationViewRegistry(ctx)
    views.register(chatViewDefinition)
    const assembler = new ConversationNodeAssembler(events, views)
    assembler.activateTarget('chat')
    assembler.replaceWindow(EVENTS, false)
    assembler.flush()

    const snapshot = assembler.get<'chat'>('chat')
    expect(snapshot?.order[0]).toContain('errgrind-episode-card')
  })
})
