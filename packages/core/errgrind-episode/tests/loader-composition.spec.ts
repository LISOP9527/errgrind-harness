import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId, type FileAttachmentRef, type ImageAttachmentRef, type ImageMediaType } from '@deepseek-ai/dsh-attachment'
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

class MockAttachmentStore extends Service {
  savedFiles: { data: Uint8Array; name?: string }[] = []
  shouldFailSaveFile = false

  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  saveFile(input: { data: Uint8Array; name?: string }): Promise<FileAttachmentRef> {
    if (this.shouldFailSaveFile) {
      return Promise.reject(new Error('Backend does not support saveFile'))
    }
    this.savedFiles.push(input)
    const sha = createHash('sha256').update(input.data).digest('hex')
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${sha}`),
      name: input.name ?? 'file',
      bytes: input.data.byteLength,
    })
  }

  saveImage(input: { data: Uint8Array; name?: string; mediaType: ImageMediaType }): Promise<ImageAttachmentRef> {
    const sha = createHash('sha256').update(input.data).digest('hex')
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${sha}`),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 100,
      height: 100,
      ...(input.name !== undefined ? { name: input.name } : {}),
    })
  }

  saveImagesReturnsEmpty = false

  saveImages(inputs: readonly { data: Uint8Array; name?: string; mediaType: ImageMediaType }[]): Promise<readonly ImageAttachmentRef[]> {
    if (this.saveImagesReturnsEmpty) return Promise.resolve([])
    return Promise.all(inputs.map(i => this.saveImage(i)))
  }
}

describe('ErrGrind episode real Loader composition', () => {
  it('saves direct input, supports Grill investigation, and enforces human confirmation', async () => {
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

    // Provide mock attachments service to test raw image interception
    const mockAttachments = new MockAttachmentStore(ctx)

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

    // Check command and tool registrations
    expect(ctx.commands.list(agent).map(c => c.name)).toContain('error-confirm')
    expect(ctx.commands.list(agent).map(c => c.name)).toContain('error-status')
    expect(ctx.tools.schemas(agent).map(t => t.name)).toContain('error_draft')
    expect(ctx.tools.schemas(agent).map(t => t.name)).toContain('grill_probe')
    expect(ctx.tools.schemas(agent).map(t => t.name)).toContain('grill_conclude')

    // Initial status check when no episode is open
    const initialStatus = await ctx.commands.execute(agent, '/error-status', [], new AbortController().signal)
    expect(initialStatus?.result.text).toContain('尚未记录 Error 输入')

    // Test image upload through attachment interception
    const rawImageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
    const singleImageRef = await ctx.attachments.saveImage({
      data: rawImageBytes,
      mediaType: 'image/png',
      name: 'math-scratch.png',
    })
    expect(mockAttachments.savedFiles).toHaveLength(1)
    expect(mockAttachments.savedFiles[0]?.name).toBe('math-scratch.png')

    // Test saveImage without name
    await ctx.attachments.saveImage({
      data: new Uint8Array([7, 7, 7]),
      mediaType: 'image/png',
    })

    // Test batch image upload through saveImages with and without name
    const batchImages = await ctx.attachments.saveImages([
      { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', name: 'extra.png' },
      { data: new Uint8Array([4, 5, 6]), mediaType: 'image/png' },
    ])
    expect(batchImages).toHaveLength(2)
    expect(mockAttachments.savedFiles).toHaveLength(4)

    // Fallback coverage when saveFile rejects (with and without name)
    mockAttachments.shouldFailSaveFile = true
    await ctx.attachments.saveImage({ data: new Uint8Array([9, 9]), mediaType: 'image/jpeg', name: 'fail.jpg' })
    await ctx.attachments.saveImage({ data: new Uint8Array([9, 9]), mediaType: 'image/jpeg' })
    await ctx.attachments.saveImages([
      { data: new Uint8Array([8, 8]), mediaType: 'image/jpeg', name: 'fail2.jpg' },
      { data: new Uint8Array([8, 8]), mediaType: 'image/jpeg' },
    ])
    mockAttachments.shouldFailSaveFile = false

    // Edge case: saveImages returns fewer image refs than inputs
    mockAttachments.saveImagesReturnsEmpty = true
    await ctx.attachments.saveImages([{ data: new Uint8Array([1]), mediaType: 'image/png' }])
    mockAttachments.saveImagesReturnsEmpty = false

    // Pre-step edge case: non-enter decision
    const rejectDecision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'reject' as const }))
    expect(rejectDecision.kind).toBe('reject')

    // Pre-step edge case: non-user-sourced message
    const nonUserMsg = {
      id: 'asst-1',
      source: { kind: 'assistant' as const },
      content: [{ type: 'text' as const, text: 'System greeting' }],
      createdAt: Date.now(),
    }
    const nonUserDecision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages: [nonUserMsg as never], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [nonUserMsg as never] }))
    expect(nonUserDecision.kind).toBe('enter')

    // Pre-step edge case: empty message (text empty and no attachments)
    const emptyMsg = createUserMessage({
      content: [{ type: 'text', text: '' }],
      source: { kind: 'user' },
    })
    const emptyDecision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages: [emptyMsg], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [emptyMsg] }))
    expect(emptyDecision.kind).toBe('enter')
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')).toBeNull()

    // User direct input with text, image, and file
    const fileRef: FileAttachmentRef = {
      attachmentId: AttachmentId('sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'),
      name: 'notes.txt',
      bytes: 120,
    }
    const direct = createUserMessage({
      content: [
        { type: 'text', text: '原题与我当时的解法：我把两个不等比值当成相等。' },
        { type: 'image', attachment: singleImageRef },
        { type: 'file', attachment: fileRef },
      ],
      source: { kind: 'user', rpcId: 'rpc-prompt-1', clientTimeZone: 'Asia/Shanghai' },
    })

    const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages: [direct], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [direct] }))
    expect(decision.kind).toBe('enter')

    // Pre-step edge case: second turn when episode is already open
    const secondTurnDecision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages: [direct], turn: 2, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [direct] }))
    expect(secondTurnDecision.kind).toBe('enter')

    // Pre-step edge case: unmapped image attachment without name
    const unmappedSession = ctx.sessions.create(SessionId('unmapped-image-session'))
    const unmappedAgent = { ...agent, id: unmappedSession.id, session: unmappedSession } as Agent
    const unmappedImageMsg = createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('sha256:unknown1234567890abcdef1234567890abcdef'),
          mediaType: 'image/png',
          bytes: 100,
          width: 100,
          height: 100,
        },
      }],
      source: { kind: 'user' },
    })
    await agentEvents(ctx, unmappedAgent).waterfall('agent/pre-step', {
      messages: [unmappedImageMsg], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [unmappedImageMsg] }))
    const unmappedEp = ctx.sessionProjections.stateOf(unmappedSession, 'errgrindEpisode')
    expect(unmappedEp?.attachments[0]?.sha256).toBe('unknown1234567890abcdef1234567890abcdef')
    expect(unmappedEp?.attachments[0]?.name).toBeUndefined()
    expect(unmappedEp?.attachments[0]?.originalFileRef).toBeUndefined()

    // Test /error-status when attachment has no name
    const unmappedStatus = await ctx.commands.execute(unmappedAgent, '/error-status', [], new AbortController().signal)
    expect(unmappedStatus?.result.text).toContain('image: unknown1...')

    // Test /error-confirm when draft is null
    const unmappedConfirm = await ctx.commands.execute(unmappedAgent, '/error-confirm', [], new AbortController().signal)
    expect(unmappedConfirm?.result.kind).toBe('error')

    const episode = ctx.sessionProjections.stateOf(session, 'errgrindEpisode')
    expect(episode).toMatchObject({
      firstInput: direct.content[0]?.type === 'text' ? direct.content[0].text : '',
      firstInputHasImage: true,
      firstInputTurn: 1,
      provenance: { kind: 'direct_user', rpcId: 'rpc-prompt-1', clientTimeZone: 'Asia/Shanghai' },
      draft: null,
      confirmedRevision: null,
    })
    expect(episode?.attachments).toHaveLength(2)
    expect(episode?.attachments[0]?.name).toBe('math-scratch.png')
    expect(episode?.attachments[1]?.name).toBe('notes.txt')

    // Check /error-status with open episode and no draft
    const statusNoDraft = await ctx.commands.execute(agent, '/error-status', [], new AbortController().signal)
    expect(statusNoDraft?.result.text).toContain('用户直接输入')
    expect(statusNoDraft?.result.text).toContain('尚未起草')

    // Model saves draft 1
    // PresentCall and validation for error_draft
    const draftTool = ctx.tools.get('error_draft', agent)
    expect(draftTool?.presentCall?.({ description: 'Draft description' })).toEqual({
      card: 'generic', title: 'Draft Error', kind: 'other', rawInput: 'Draft description',
    })

    expect((await ctx.tools.execute({
      name: 'error_draft', callId: ToolCallId('draft-no-agent'), arguments: { description: 'draft' }, signal: new AbortController().signal,
    })).isError).toBe(true)

    const unstarted = ctx.sessions.create(SessionId('unstarted'))
    const unstartedAgent = { ...agent, id: unstarted.id, session: unstarted } as Agent
    expect((await ctx.tools.execute({
      name: 'error_draft', callId: ToolCallId('draft-no-ep'), agent: unstartedAgent, arguments: { description: 'draft' }, signal: new AbortController().signal,
    })).isError).toBe(true)

    expect((await ctx.tools.execute({
      name: 'error_draft', callId: ToolCallId('draft-empty'), agent, arguments: { description: '   ' }, signal: new AbortController().signal,
    })).isError).toBe(true)

    expect((await ctx.tools.execute({
      name: 'error_draft', callId: ToolCallId('draft-too-long'), agent, arguments: { description: 'x'.repeat(12001) }, signal: new AbortController().signal,
    })).isError).toBe(true)

    const draft1 = await ctx.tools.execute({
      name: 'error_draft', callId: ToolCallId('draft-1'), agent,
      arguments: { description: '我在解分式方程时把两个不等比值当作相等，忽略了分子不同。' },
      signal: new AbortController().signal,
    })
    expect(draft1.isError).toBe(false)
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.draft?.revision).toBe(1)

    // Check status when active diagnosis has no current probe
    const statusNoProbe = await ctx.commands.execute(agent, '/error-status', [], new AbortController().signal)
    expect(statusNoProbe?.result.text).toContain('当前探针: 无待回答探针')

    // Trying grill_conclude before confirmation MUST fail
    const concludeEarly = await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('conclude-early'), agent,
      arguments: { diagnosisStatus: 'supported', summary: 'Too early' },
      signal: new AbortController().signal,
    })
    expect(concludeEarly.isError).toBe(true)

    // Model poses Grill probe P1 (without turn/start event in session; falls back to turn 1)
    const probeTool = ctx.tools.get('grill_probe', agent)
    expect(probeTool?.presentCall?.({
      probe: {
        id: 'P1', type: 'reasoning_question', question: '请问第一步去分母时，右边常数项是否乘了公分母？',
        targetHypothesisIds: ['H1', 'H2'], discriminationGoal: '核对常数项处理',
        predictions: [{ hypothesisId: 'H1', expectedObservation: '回答没乘' }],
        answerKey: 'SECRET_ANSWER_KEY',
      },
    })).toEqual({
      card: 'generic', title: 'Grill Question', kind: 'other',
      rawInput: '请问第一步去分母时，右边常数项是否乘了公分母？',
    })

    const probeCall = await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('probe-1'), agent,
      arguments: {
        probe: {
          id: 'P1',
          type: 'reasoning_question',
          question: '请问第一步去分母时，右边常数项是否乘了公分母？',
          targetHypothesisIds: ['H1', 'H2'],
          discriminationGoal: '核对去分母时的常数项项展开',
          predictions: [
            { hypothesisId: 'H1', expectedObservation: '承认遗漏常数项' },
            { hypothesisId: 'H2', expectedObservation: '认为常数项也乘了但符号错' },
          ],
          answerKey: '必须每项都乘以公分母',
        },
        newHypotheses: [
          { id: 'H1', claim: '去分母时遗漏不含未知数的常数项' },
          { id: 'H2', claim: '移项变号失误' },
        ],
      },
      signal: new AbortController().signal,
    })
    expect(probeCall.isError).toBe(false)
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.diagnosis.currentProbeId).toBe('P1')

    // Append turn/start event so subsequent probe/conclude exercises turn extraction with actual turn number
    session.append('turn/start', { turn: 2 })

    // Model poses Grill probe P2 with preservedMechanism, surfaceChange, hypothesisStatusUpdates, and newEvidence
    const probe2Call = await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('probe-2'), agent,
      arguments: {
        probe: {
          id: 'P2',
          type: 'variant_problem',
          question: '请解 2x = 8',
          targetHypothesisIds: ['H1'],
          discriminationGoal: '核对变式',
          predictions: [{ hypothesisId: 'H1', expectedObservation: '回答 6' }],
          preservedMechanism: '未知数系数除法',
          surfaceChange: '数字更换',
        },
        hypothesisStatusUpdates: [{ id: 'H2', status: 'weakened' }],
        newEvidence: [
          {
            id: 'E1',
            sourceRef: 'turn:1',
            quote: '直接移项减去了',
            interpretation: '用户混淆除法与减法',
            supports: ['H1'],
            contradicts: ['H2'],
            probeId: 'P1',
          },
          {
            id: 'E2',
            sourceRef: 'turn:1',
            interpretation: '草稿纸记录',
            supports: ['H1'],
            contradicts: [],
          },
        ],
      },
      signal: new AbortController().signal,
    })
    expect(probe2Call.isError).toBe(false)

    // Check status during active probe
    const statusWithProbe = await ctx.commands.execute(agent, '/error-status', [], new AbortController().signal)
    expect(statusWithProbe?.result.text).toContain('当前探针: P2')

    // Confirm draft revision 1
    const confirm = await ctx.commands.execute(agent, '/error-confirm', [], new AbortController().signal)
    expect(confirm?.result.kind).toBe('success')
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.confirmedRevision).toBe(1)

    // Confirming again returns already confirmed message
    const confirmDuplicate = await ctx.commands.execute(agent, '/error-confirm', [], new AbortController().signal)
    expect(confirmDuplicate?.result.text).toContain('已经确认')

    // Conclude diagnosis with supported finding and whatWouldChangeJudgment
    const concludeTool = ctx.tools.get('grill_conclude', agent)
    expect(concludeTool?.presentCall?.({
      diagnosisStatus: 'supported',
      summary: '用户去分母时确实遗漏常数项',
    })).toEqual({
      card: 'generic', title: 'Diagnosis Concluded', kind: 'other',
      rawInput: '用户去分母时确实遗漏常数项',
    })

    const concludeCall = await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('conclude-1'), agent,
      arguments: {
        diagnosisStatus: 'supported',
        summary: '经探针证实：去分母过程中常数项未乘以公分母，导致分子项与常数项量纲失衡。',
        bestHypothesisId: 'H1',
        whatWouldChangeJudgment: '发现用户是笔误而非运算混淆',
        hypothesisStatusUpdates: [
          { id: 'H1', status: 'supported' },
          { id: 'H2', status: 'rejected' },
        ],
        newEvidence: [
          {
            id: 'E3',
            sourceRef: 'turn:2:user',
            quote: '我直接把分母去掉了，后面的1没动',
            interpretation: '用户亲口确认常数项未乘公分母',
            supports: ['H1'],
            contradicts: ['H2'],
            probeId: 'P1',
          },
          {
            id: 'E4',
            sourceRef: 'turn:2:user',
            interpretation: '补充观察',
            supports: ['H1'],
            contradicts: [],
          },
        ],
      },
      signal: new AbortController().signal,
    })
    expect(concludeCall.isError).toBe(false)

    const diag = ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.diagnosis
    expect(diag?.status).toBe('supported')
    expect(diag?.bestHypothesisId).toBe('H1')
    expect(diag?.currentProbeId).toBeNull()

    // Check status after supported conclusion
    const statusSupported = await ctx.commands.execute(agent, '/error-status', [], new AbortController().signal)
    expect(statusSupported?.result.text).toContain('确立机制: H1')
    expect(statusSupported?.result.text).toContain('诊断摘要')

    // Post-conclusion revision: model drafts revision 2
    await ctx.tools.execute({
      name: 'error_draft', callId: ToolCallId('draft-2'), agent,
      arguments: { description: '实质更正：原题实际为不等式，并非方程。' },
      signal: new AbortController().signal,
    })

    const stateStale = ctx.sessionProjections.stateOf(session, 'errgrindEpisode')
    expect(stateStale?.diagnosis.stale).toBe(true)
    const statusStale = await ctx.commands.execute(agent, '/error-status', [], new AbortController().signal)
    expect(statusStale?.result.text).toContain('待复核')

    // Confirm revision 2
    await ctx.commands.execute(agent, '/error-confirm', [], new AbortController().signal)
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.confirmedRevision).toBe(2)

    // Cold session replay verifies full deterministic recovery
    const replayed = Session.create(SessionId('replayed-math-error'), session.snapshotEvents())
    expect(ctx.sessionProjections.stateOf(replayed, 'errgrindEpisode')?.draft?.revision).toBe(2)
    expect(ctx.sessionProjections.stateOf(replayed, 'errgrindEpisode')?.diagnosis.status).toBe('supported')

    // Test relay input on a second session
    const second = ctx.sessions.create(SessionId('relay-session'))
    const secondAgent = { ...agent, id: second.id, session: second } as Agent
    const relayMessage = createUserMessage({
      content: [{ type: 'text', text: '宿主转述的错题：计算 1/3 + 1/4 = 2/7' }],
      source: { kind: 'agent-message', form: 'relay', senderSessionId: 'parent-agent' } as never,
    })
    await agentEvents(ctx, secondAgent).waterfall('agent/pre-step', {
      messages: [relayMessage], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [relayMessage] }))

    const secondEpisode = ctx.sessionProjections.stateOf(second, 'errgrindEpisode')
    expect(secondEpisode?.provenance.kind).toBe('host_relay')
    expect(secondEpisode?.provenance.senderSessionId).toBe('parent-agent')

    // Test undetermined conclusion on second session
    await ctx.tools.execute({
      name: 'error_draft', callId: ToolCallId('second-draft-1'), agent: secondAgent,
      arguments: { description: '分子相加、分母相加的分数加法错误。' },
      signal: new AbortController().signal,
    })
    await ctx.commands.execute(secondAgent, '/error-confirm', [], new AbortController().signal)
    await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('second-conclude'), agent: secondAgent,
      arguments: {
        diagnosisStatus: 'undetermined',
        summary: '无法区分直觉模式套用与通分概念未建立。',
        remainingUncertainty: '需要进一步的异分母练习。',
      },
      signal: new AbortController().signal,
    })
    const secondStatus = await ctx.commands.execute(secondAgent, '/error-status', [], new AbortController().signal)
    expect(secondStatus?.result.text).toContain('宿主转述')
    expect(secondStatus?.result.text).toContain('undetermined')
    expect(secondStatus?.result.text).toContain('不确定性')

    // Test error cases for commands and tools
    expect((await ctx.commands.execute(agent, '/error-confirm extra', [], new AbortController().signal))?.result.kind).toBe('error')
    expect((await ctx.commands.execute(agent, '/error-status extra', [], new AbortController().signal))?.result.kind).toBe('error')

    // Tool executions with missing agent or missing episode
    const validProbeArgs = {
      probe: {
        id: 'P1',
        type: 'reasoning_question',
        question: 'Q?',
        targetHypothesisIds: ['H1'],
        discriminationGoal: 'Goal',
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'Obs' }],
      },
    }

    expect((await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('no-agent'), arguments: validProbeArgs, signal: new AbortController().signal,
    })).isError).toBe(true)

    expect((await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('no-agent'), arguments: { diagnosisStatus: 'supported', summary: 'x' }, signal: new AbortController().signal,
    })).isError).toBe(true)

    expect((await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('no-episode'), agent: unstartedAgent, arguments: validProbeArgs, signal: new AbortController().signal,
    })).isError).toBe(true)

    expect((await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('no-episode'), agent: unstartedAgent, arguments: { diagnosisStatus: 'supported', summary: 'x' }, signal: new AbortController().signal,
    })).isError).toBe(true)

    // Cannot probe or conclude completed diagnosis
    expect((await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('completed-probe'), agent: secondAgent,
      arguments: validProbeArgs, signal: new AbortController().signal,
    })).isError).toBe(true)

    expect((await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('completed-conclude'), agent: secondAgent,
      arguments: { diagnosisStatus: 'supported', summary: 'x' }, signal: new AbortController().signal,
    })).isError).toBe(true)

    // /error-status when supported diagnosis has unknown hypothesis
    vi.spyOn(ctx.sessionProjections, 'stateOf').mockReturnValueOnce({
      ...ctx.sessionProjections.stateOf(session, 'errgrindEpisode')!,
      diagnosis: {
        ...ctx.sessionProjections.stateOf(session, 'errgrindEpisode')!.diagnosis,
        status: 'supported',
        bestHypothesisId: 'H99',
        hypotheses: [],
      },
    })
    const unknownHypStatus = await ctx.commands.execute(agent, '/error-status', [], new AbortController().signal)
    expect(unknownHypStatus?.result.text).toContain('确立机制: H99')

    // currentEpisode throws if projection state is unavailable
    vi.spyOn(ctx.sessionProjections, 'stateOf').mockReturnValueOnce(undefined)
    await expect(ctx.commands.execute(agent, '/error-status', [], new AbortController().signal)).rejects.toThrow('unavailable')
  })

  it('applies cleanly when attachments service is not registered', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'errgrind-no-att-'))
    const configPath = join(tempDir, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@errgrind/episode'",
      '',
    ].join('\n'))

    const standaloneCtx = new Context()
    standaloneCtx.baseUrl = pathToFileURL(tempDir).href + '/'
    await standaloneCtx.plugin(Loader)
    standaloneCtx.loader.builtins.include = Include

    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@errgrind/episode', episodePlugin],
    ])
    standaloneCtx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`Unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof standaloneCtx.loader.internal>
    await standaloneCtx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await standaloneCtx.loader.await()

    expect(standaloneCtx.get('attachments')).toBeUndefined()
    await standaloneCtx.fiber.dispose()
    await rm(tempDir, { recursive: true, force: true })
  })
})
