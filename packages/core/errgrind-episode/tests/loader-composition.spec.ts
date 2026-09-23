import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as episodePlugin from '../src/index.ts'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('ErrGrind episode real Loader composition', () => {
  it('saves direct input before a model step and allows only a human command to confirm the current draft', async () => {
    root = await mkdtemp(join(tmpdir(), 'errgrind-episode-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@errgrind/episode'",
      '',
    ].join('\n'))

    const ctx = context = new Context()
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@errgrind/episode', episodePlugin],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`Unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()

    const session = ctx.sessions.create(SessionId('math-error'))
    const agent = { id: session.id, ctx, session, status: 'idle', options: {}, reserveTurnAdmission: () => () => undefined } as unknown as Agent
    expect(ctx.commands.list(agent).map(command => command.name)).toContain('error-confirm')
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')).toBeNull()
    expect(ctx.tools.schemas(agent).find(schema => schema.name === 'error_draft')).toMatchInlineSnapshot(`
      {
        "description": "Save a draft of the current mathematics Error as one complete description. Describe only what is known, distinguish the user’s account from your interpretation, and ask the user to review it. This tool cannot confirm the draft for the user.",
        "name": "error_draft",
        "parameters": {
          "properties": {
            "description": {
              "description": "One complete, user-readable Error description.",
              "type": "string",
            },
          },
          "required": [
            "description",
          ],
          "type": "object",
        },
      }
    `)
    const direct = createUserMessage({
      content: [{ type: 'text', text: '原题与我当时的解法：我把两个不等比值当成相等。' }],
      source: { kind: 'user' },
    })
    const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages: [direct], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [direct] }))
    expect(decision.kind).toBe('enter')
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')).toMatchObject({
      firstInput: direct.content[0]?.type === 'text' ? direct.content[0].text : '',
      firstInputTurn: 1,
      draft: null,
    })

    const draft = await ctx.tools.execute({
      name: 'error_draft', callId: ToolCallId('draft-1'), agent,
      arguments: { description: '我在原题中把两个不等比值当作相等；这是对当时思路的回忆。' },
      signal: new AbortController().signal,
    })
    expect(draft.isError).toBe(false)
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.confirmedRevision).toBeNull()
    expect(ctx.commands.list(agent).map(command => command.name)).toContain('error-confirm')

    const confirmation = await ctx.commands.execute(agent, '/error-confirm', [], new AbortController().signal)
    expect(confirmation?.result.kind).toBe('success')
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.confirmedRevision).toBe(1)
    expect(session.snapshotEvents().map(event => event.type)).toEqual([
      'errgrind/error-open', 'errgrind/error-draft', 'command/run', 'errgrind/error-confirm', 'command/done',
    ])
    const events = session.snapshotEvents()
    const confirmedEvent = events.find(event => event.type === 'errgrind/error-confirm')
    const commandEvent = events.find(event => event.type === 'command/run')
    expect(confirmedEvent?.type === 'errgrind/error-confirm' && confirmedEvent.data.commandId)
      .toBe(commandEvent?.type === 'command/run' && commandEvent.data.commandId)
    const resumed = Session.create(SessionId('replayed-math-error'), events)
    expect(ctx.sessionProjections.stateOf(resumed, 'errgrindEpisode')?.confirmedRevision).toBe(1)

    const duplicate = await ctx.commands.execute(agent, '/error-confirm', [], new AbortController().signal)
    expect(duplicate?.result.text).toContain('已经确认')
    expect(session.snapshotEvents().filter(event => event.type === 'errgrind/error-confirm')).toHaveLength(1)
    const withArgs = await ctx.commands.execute(agent, '/error-confirm now', [], new AbortController().signal)
    expect(withArgs?.result.kind).toBe('error')
    expect(ctx.tools.get('error_draft', agent)?.presentCall?.({ description: 'preview' })).toMatchObject({
      title: 'Draft Error', rawInput: 'preview',
    })

    const second = ctx.sessions.create(SessionId('unopened-error'))
    const secondAgent = { ...agent, id: second.id, session: second } as Agent
    const beforeDraft = await ctx.commands.execute(secondAgent, '/error-confirm', [], new AbortController().signal)
    expect(beforeDraft?.result.kind).toBe('error')
    const missingAnchor = await ctx.tools.execute({
      name: 'error_draft', callId: ToolCallId('draft-missing-anchor'), agent: secondAgent,
      arguments: { description: 'No anchor' }, signal: new AbortController().signal,
    })
    expect(missingAnchor.isError).toBe(true)
    const missingAgent = await ctx.tools.execute({
      name: 'error_draft', callId: ToolCallId('draft-missing-agent'),
      arguments: { description: 'No agent' }, signal: new AbortController().signal,
    })
    expect(missingAgent.isError).toBe(true)

    const noInput = await agentEvents(ctx, secondAgent).waterfall('agent/pre-step', {
      messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
    expect(noInput.kind).toBe('enter')
    expect(ctx.sessionProjections.stateOf(second, 'errgrindEpisode')).toBeNull()
    const emptyInput = createUserMessage({ content: [{ type: 'text', text: '' }], source: { kind: 'user' } })
    await agentEvents(ctx, secondAgent).waterfall('agent/pre-step', {
      messages: [emptyInput], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [emptyInput] }))
    expect(ctx.sessionProjections.stateOf(second, 'errgrindEpisode')).toBeNull()
    await agentEvents(ctx, secondAgent).waterfall('agent/pre-step', {
      messages: [direct], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'reject' as const }))
    expect(ctx.sessionProjections.stateOf(second, 'errgrindEpisode')).toBeNull()

    const image = createUserMessage({
      content: [{ type: 'image', attachment: {
        attachmentId: AttachmentId('test-image'), mediaType: 'image/png', bytes: 67, width: 1, height: 1,
      } }], source: { kind: 'user' },
    })
    await agentEvents(ctx, secondAgent).waterfall('agent/pre-step', {
      messages: [image], turn: 2, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [image] }))
    expect(ctx.sessionProjections.stateOf(second, 'errgrindEpisode')).toMatchObject({
      firstInput: '', firstInputHasImage: true,
    })
    await agentEvents(ctx, secondAgent).waterfall('agent/pre-step', {
      messages: [direct], turn: 3, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [direct] }))
    expect(second.snapshotEvents().filter(event => event.type === 'errgrind/error-open')).toHaveLength(1)

    for (const [callId, description] of [
      ['draft-empty', '   '], ['draft-long', 'x'.repeat(12_001)],
    ] as const) {
      const rejected = await ctx.tools.execute({
        name: 'error_draft', callId: ToolCallId(callId), agent: secondAgent,
        arguments: { description }, signal: new AbortController().signal,
      })
      expect(rejected.isError).toBe(true)
    }
    const missingProjection = vi.spyOn(ctx.sessionProjections, 'stateOf').mockReturnValue(undefined)
    const unavailable = await ctx.tools.execute({
      name: 'error_draft', callId: ToolCallId('draft-projection-unavailable'), agent: secondAgent,
      arguments: { description: 'Cannot access projection' }, signal: new AbortController().signal,
    })
    expect(unavailable.isError).toBe(true)
    missingProjection.mockRestore()
  })
})
