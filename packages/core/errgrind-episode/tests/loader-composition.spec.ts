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
import {
  AttachmentId,
  type FileAttachmentRef,
  type ImageAttachmentLimits,
  type ImageAttachmentRef,
  type ImageMediaType,
} from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as episodePlugin from '../src/index.ts'
import { loadToolPrompts } from '../src/tool-prompts.ts'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class MockAttachmentStore extends Service {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 1_000_000,
    maxImageBytes: 100_000,
    maxImagePixels: 1_000_000,
    maxImageDimension: 10_000,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  }
  savedFiles: { data: Uint8Array; name?: string }[] = []
  shouldFailSaveFile = false
  shouldFailValidation = false

  validateImage(): Promise<void> {
    return this.shouldFailValidation
      ? Promise.reject(new Error('Invalid image batch'))
      : Promise.resolve()
  }

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
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
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
  it('keeps original image bytes readable after prompt admission and a cold store reopen', async () => {
    root = await mkdtemp(join(tmpdir(), 'errgrind-image-original-'))
    const ctx = context = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    episodePlugin.apply(ctx)

    const source = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC',
      'base64',
    )
    const admitted = await ctx.attachments.admitPromptContent([
      { type: 'text', text: '我把分母约掉后得到了错误答案。' },
      { type: 'image', data: source.toString('base64'), mediaType: 'image/png', name: 'scratch.png' },
    ])
    const image = admitted.find(part => part.type === 'image')
    if (image?.type !== 'image') throw new Error('image admission did not return a reference')
    expect(image.attachment.errgrindOriginal?.sha256).toBe(createHash('sha256').update(source).digest('hex'))

    const session = ctx.sessions.create(SessionId('original-image'))
    const agent = { id: session.id, ctx, session, status: 'idle', options: {}, reserveTurnAdmission: () => () => undefined } as unknown as Agent
    const message = createUserMessage({ content: admitted, source: { kind: 'user' } })
    const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages: [message], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [message] }))
    expect(decision.kind).toBe('enter')

    const publicListValue = ctx.sessionProjections.cachedSnapshot(session)?.values.errgrindEpisode
    expect(publicListValue).toEqual({ description: null, status: 'grill', drillEligible: false })
    expect(JSON.stringify(publicListValue)).not.toContain('errgrindOriginal')
    expect(JSON.stringify(publicListValue)).not.toContain('sha256')

    const persisted = JSON.parse(JSON.stringify(session.snapshotEvents())) as ReturnType<Session['snapshotEvents']>
    const opened = persisted.find(event => event.type === 'errgrind/error-open')
    if (opened?.type !== 'errgrind/error-open') throw new Error('original image was not committed to the session')
    const original = opened.data.attachments?.[0]?.originalFileRef
    if (original === undefined) throw new Error('the committed Error has no original-file receipt')
    const coldStore = new LocalAttachmentStore(new Context(), { dshHome: root })
    const chunks: Uint8Array[] = []
    for await (const chunk of coldStore.readFileStream(original)) chunks.push(chunk)
    expect(Buffer.concat(chunks)).toEqual(source)
  })

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
    expect(ctx.tools.schemas(agent).map(t => t.name)).toContain('error_clarify')
    expect(ctx.tools.schemas(agent).map(t => t.name)).toContain('grill_probe')
    expect(ctx.tools.schemas(agent).map(t => t.name)).toContain('grill_conclude')
    expect(ctx.tools.schemas(agent).map(t => t.name)).toContain('drill_answer_draft')
    expect(ctx.tools.schemas(agent).find(tool => tool.name === 'grill_probe')?.description)
      .toBe(loadToolPrompts().description('grill_probe'))

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
    await expect(ctx.attachments.saveImage({ data: new Uint8Array([9, 9]), mediaType: 'image/jpeg', name: 'fail.jpg' })).rejects.toThrow('saveFile')
    await expect(ctx.attachments.saveImage({ data: new Uint8Array([9, 9]), mediaType: 'image/jpeg' })).rejects.toThrow('saveFile')
    await expect(ctx.attachments.saveImages([
      { data: new Uint8Array([8, 8]), mediaType: 'image/jpeg', name: 'fail2.jpg' },
      { data: new Uint8Array([8, 8]), mediaType: 'image/jpeg' },
    ])).rejects.toThrow('saveFile')
    mockAttachments.shouldFailSaveFile = false

    const savedBeforeInvalidBatch = mockAttachments.savedFiles.length
    mockAttachments.shouldFailValidation = true
    await expect(ctx.attachments.saveImages([
      { data: new Uint8Array([5, 5]), mediaType: 'image/png' },
    ])).rejects.toThrow('Invalid image batch')
    expect(mockAttachments.savedFiles).toHaveLength(savedBeforeInvalidBatch)
    await expect(ctx.attachments.saveImage({ data: new Uint8Array([6]), mediaType: 'image/png' })).rejects.toThrow('Invalid image batch')
    expect(mockAttachments.savedFiles).toHaveLength(savedBeforeInvalidBatch)
    mockAttachments.shouldFailValidation = false

    await expect(ctx.attachments.saveImages(Array.from({ length: 21 }, () => ({
      data: new Uint8Array([1]), mediaType: 'image/png' as const,
    })))).rejects.toThrow('image-count limit')
    await expect(ctx.attachments.saveImages([{
      data: new Uint8Array(1_000_001), mediaType: 'image/png',
    }])).rejects.toThrow('aggregate image-byte limit')
    await expect(ctx.attachments.saveImages([{
      data: new Uint8Array([1]), mediaType: 'image/svg+xml' as never,
    }])).rejects.toThrow('not accepted')
    expect(mockAttachments.savedFiles).toHaveLength(savedBeforeInvalidBatch)

    // Edge case: saveImages returns fewer image refs than inputs
    mockAttachments.saveImagesReturnsEmpty = true
    await expect(ctx.attachments.saveImages([{ data: new Uint8Array([1]), mediaType: 'image/png' }])).rejects.toThrow('incomplete image batch')
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
        ...batchImages.map(attachment => ({ type: 'image' as const, attachment })),
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
    await expect(agentEvents(ctx, unmappedAgent).waterfall('agent/pre-step', {
      messages: [unmappedImageMsg], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [unmappedImageMsg] }))).rejects.toThrow('durable original-file receipt')
    const unmappedEp = ctx.sessionProjections.stateOf(unmappedSession, 'errgrindEpisode')
    expect(unmappedEp).toBeNull()

    // Test /error-status when attachment has no name
    const unmappedStatus = await ctx.commands.execute(unmappedAgent, '/error-status', [], new AbortController().signal)
    expect(unmappedStatus?.result.text).toContain('尚未记录 Error 输入')

    // Test /error-confirm when draft is null
    const unmappedConfirm = await ctx.commands.execute(unmappedAgent, '/error-confirm', [], new AbortController().signal)
    expect(unmappedConfirm?.result.kind).toBe('error')

    const episode = ctx.sessionProjections.stateOf(session, 'errgrindEpisode')
    expect(episode).toMatchObject({
      firstInput: direct.content[0]?.type === 'text' ? direct.content[0].text : '',
      firstInputHasImage: true,
      firstInputTurn: 1,
      origin: { kind: 'direct_user', rpcId: 'rpc-prompt-1', clientTimeZone: 'Asia/Shanghai' },
      draft: null,
      confirmedRevision: null,
    })
    expect(episode?.attachments).toHaveLength(4)
    expect(episode?.attachments[0]?.name).toBe('math-scratch.png')
    expect(episode?.attachments[1]?.name).toBe('extra.png')
    expect(episode?.attachments[2]?.name).toBeUndefined()
    expect(episode?.attachments[3]?.name).toBe('notes.txt')
    expect(episode?.attachments[0]?.sha256).toBe(createHash('sha256').update(rawImageBytes).digest('hex'))
    expect(episode?.attachments[0]?.bytes).toBe(rawImageBytes.byteLength)
    expect(episode?.attachments[0]?.originalFileRef).toEqual({
      attachmentId: AttachmentId(`sha256:${createHash('sha256').update(rawImageBytes).digest('hex')}`),
      name: 'math-scratch.png',
      bytes: rawImageBytes.byteLength,
    })
    expect(episode?.attachments[1]?.sha256).toBe(createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex'))
    expect(episode?.attachments[2]?.sha256).toBe(createHash('sha256').update(new Uint8Array([4, 5, 6])).digest('hex'))

    if (episode === null || episode === undefined) throw new Error('expected the Error episode projection')
    const legacyEpisode = {
      firstInput: episode.firstInput,
      firstInputHasImage: episode.firstInputHasImage,
      firstInputTurn: episode.firstInputTurn,
      latestTurn: episode.latestTurn,
      origin: episode.origin,
      attachments: episode.attachments,
      draft: episode.draft,
      confirmedRevision: episode.confirmedRevision,
      diagnosis: episode.diagnosis,
    }
    const legacyCheckpoint = {
      errgrindEpisode: {
        ver: 1,
        seq: SessionSeq(session.snapshotEvents().at(-1)?.seq ?? 0),
        val: legacyEpisode,
      },
    }
    const restored = ctx.sessionProjections.restore(
      legacyCheckpoint,
      session.snapshotEvents(),
      SessionLogOffset(0),
      session.header,
      session.inheritedEventCount,
    )
    expect(restored.checkpoint.errgrindEpisode).toMatchObject({
      ver: 9,
      val: {
        evidenceSources: [
          { sourceRef: 'initial-input', probeId: null, diagnosisRound: 1, text: episode.firstInput },
          ...episode.attachments.map((_, index) => ({
            sourceRef: `initial-attachment:${index + 1}`, probeId: null, diagnosisRound: 1, text: '',
          })),
        ],
        diagnosisHistory: [], diagnosisRound: 1,
      },
    })

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

    const projectionBeforeClarification = ctx.sessionProjections.stateOf(session, 'errgrindEpisode')
    const clarification = await ctx.tools.execute({
      name: 'error_clarify', callId: ToolCallId('clarify-before-grill'), agent,
      arguments: { text: 'Which step did you write first?' },
      signal: new AbortController().signal,
    })
    expect(clarification.isError).toBe(false)
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')).toEqual({
      ...projectionBeforeClarification, pendingClarification: true,
    })
    expect(session.snapshotEvents().find(event => event.type === 'errgrind/error-clarify')?.data)
      .toEqual({ text: 'Which step did you write first?', turn: 1 })
    expect((await ctx.tools.execute({
      name: 'error_clarify', callId: ToolCallId('clarify-empty'), agent,
      arguments: { text: '  ' }, signal: new AbortController().signal,
    })).isError).toBe(true)
    expect((await ctx.tools.execute({
      name: 'error_clarify', callId: ToolCallId('clarify-too-long'), agent,
      arguments: { text: 'x'.repeat(4001) }, signal: new AbortController().signal,
    })).isError).toBe(true)

    // Check status when active diagnosis has no current probe
    const statusNoProbe = await ctx.commands.execute(agent, '/error-status', [], new AbortController().signal)
    expect(statusNoProbe?.result.text).toContain('当前探针: 无待回答探针')

    // A conclusion without a supported hypothesis/evidence still fails.
    const concludeEarly = await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('conclude-early'), agent,
      arguments: { diagnosisStatus: 'supported', summary: 'Too early' },
      signal: new AbortController().signal,
    })
    expect(concludeEarly.isError).toBe(true)

    // Model poses Grill probe P1 before final description confirmation.
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
    const answerEvent = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '我直接把分母去掉了，后面的1没动。' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const missingQuote = await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('probe-missing-quote'), agent,
      arguments: {
        probe: {
          id: 'P9', type: 'reasoning_question', question: 'What did you do?',
          targetHypothesisIds: ['H1'], discriminationGoal: 'Check source',
          predictions: [{ hypothesisId: 'H1', expectedObservation: 'Explains omitted term' }],
        },
        newEvidence: [{
          id: 'E9', sourceRef: `user-event:${answerEvent.seq}`,
          interpretation: 'Missing exact quote', supports: ['H1'], contradicts: [], probeId: 'P1',
        }],
      },
      signal: new AbortController().signal,
    })
    expect(missingQuote.isError).toBe(true)
    const missingProbeRef = await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('probe-missing-id'), agent,
      arguments: {
        probe: {
          id: 'P9', type: 'reasoning_question', question: 'What did you do?',
          targetHypothesisIds: ['H1'], discriminationGoal: 'Check source',
          predictions: [{ hypothesisId: 'H1', expectedObservation: 'Explains omitted term' }],
        },
        newEvidence: [{
          id: 'E9', sourceRef: `user-event:${answerEvent.seq}`, quote: '我直接把分母去掉了',
          interpretation: 'Missing probe reference', supports: ['H1'], contradicts: [],
        }],
      },
      signal: new AbortController().signal,
    })
    expect(missingProbeRef.isError).toBe(true)

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
            sourceRef: 'latest-probe-answer',
            quote: '我直接把分母去掉了',
            interpretation: '用户混淆除法与减法',
            supports: ['H1'],
            contradicts: ['H2'],
            probeId: 'P1',
          },
          {
            id: 'E2',
            sourceRef: `user-event:${answerEvent.seq}`,
            quote: '我直接把分母去掉了',
            interpretation: '草稿纸记录',
            supports: ['H1'],
            contradicts: [],
            probeId: 'P1',
          },
          {
            id: 'E6',
            sourceRef: 'initial-input',
            quote: '我把两个不等比值当成相等',
            interpretation: '模型对未绑定来源提交空 probeId',
            supports: ['H1'],
            contradicts: [],
            probeId: '',
          },
        ],
      },
      signal: new AbortController().signal,
    })
    expect(probe2Call.isError).toBe(false)
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.diagnosis.evidence
      .find(item => item.id === 'E1')?.sourceRef).toBe(`user-event:${answerEvent.seq}`)
    // An empty probeId was the old persisted form of "not tied to a probe";
    // the tool boundary normalizes it away instead of writing it back out.
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.diagnosis.evidence
      .find(item => item.id === 'E6')).not.toHaveProperty('probeId')

    // Checkpoints persisted before the normalization still carry probeId: ""
    // on unbound evidence; viewCheckpoint must keep serving the row.
    const currentState = ctx.sessionProjections.stateOf(session, 'errgrindEpisode')
    if (currentState === null || currentState === undefined) throw new Error('expected the Error episode projection')
    const legacyVal = JSON.parse(JSON.stringify(currentState)) as { diagnosis: { evidence: { probeId?: string }[] } }
    const legacyUnbound = legacyVal.diagnosis.evidence.find(item => item.probeId === undefined)
    if (legacyUnbound === undefined) throw new Error('expected unbound evidence')
    legacyUnbound.probeId = ''
    const legacyRow = {
      errgrindEpisode: {
        ver: 9,
        seq: SessionSeq(session.snapshotEvents().at(-1)?.seq ?? 0),
        val: legacyVal,
      },
    }
    expect(ctx.sessionProjections.viewCheckpoint(legacyRow).errgrindEpisode)
      .toMatchObject({ status: 'grill' })

    // Check status during active probe
    const statusWithProbe = await ctx.commands.execute(agent, '/error-status', [], new AbortController().signal)
    expect(statusWithProbe?.result.text).toContain('当前探针: P2')

    // The draft cannot be confirmed while Grill has no pending conclusion.
    const confirmTooEarly = await ctx.commands.execute(agent, '/error-confirm 1', [], new AbortController().signal)
    expect(confirmTooEarly?.result.kind).toBe('error')

    const fabricatedEvidence = await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('conclude-fabricated'), agent,
      arguments: {
        diagnosisStatus: 'supported', summary: 'Model asserted a diagnosis without a user answer.',
        bestHypothesisId: 'H1',
        hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
        newEvidence: [{
          id: 'E_FAKE', sourceRef: 'turn:999:user', quote: 'the user agreed',
          interpretation: 'fabricated', supports: ['H1'], contradicts: [], probeId: 'P1',
        }],
      },
      signal: new AbortController().signal,
    })
    expect(fabricatedEvidence.isError).toBe(true)

    for (const [callId, argumentsValue] of [
      ['missing-best', { diagnosisStatus: 'supported', summary: 'Missing best' }],
      ['unsupported-best', { diagnosisStatus: 'supported', summary: 'Unproven best', bestHypothesisId: 'H2' }],
      ['no-answer', {
        diagnosisStatus: 'supported', summary: 'No evidence for H2', bestHypothesisId: 'H2',
        hypothesisStatusUpdates: [{ id: 'H2', status: 'supported' }],
      }],
      ['missing-uncertainty', { diagnosisStatus: 'undetermined', summary: 'Still uncertain' }],
    ] as const) {
      const invalidConclusion = await ctx.tools.execute({
        name: 'grill_conclude', callId: ToolCallId(callId), agent,
        arguments: argumentsValue, signal: new AbortController().signal,
      })
      expect(invalidConclusion.isError).toBe(true)
    }

    const wrongQuote = await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('wrong-quote'), agent,
      arguments: {
        diagnosisStatus: 'supported', summary: 'Quote is fabricated', bestHypothesisId: 'H1',
        hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
        newEvidence: [{
          id: 'E9', sourceRef: `user-event:${answerEvent.seq}`, quote: '我做了另一件事',
          interpretation: 'Invented answer', supports: ['H1'], contradicts: [], probeId: 'P1',
        }],
      },
      signal: new AbortController().signal,
    })
    expect(wrongQuote.isError).toBe(true)

    const missingConclusionQuote = await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('missing-conclusion-quote'), agent,
      arguments: {
        diagnosisStatus: 'supported', summary: 'Quote is missing', bestHypothesisId: 'H1',
        hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
        newEvidence: [{
          id: 'E9', sourceRef: `user-event:${answerEvent.seq}`,
          interpretation: 'Missing quote', supports: ['H1'], contradicts: [], probeId: 'P1',
        }],
      },
      signal: new AbortController().signal,
    })
    expect(missingConclusionQuote.isError).toBe(true)

    const missingConclusionProbe = await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('missing-conclusion-probe'), agent,
      arguments: {
        diagnosisStatus: 'supported', summary: 'Probe reference is missing', bestHypothesisId: 'H1',
        hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
        newEvidence: [{
          id: 'E9', sourceRef: `user-event:${answerEvent.seq}`, quote: '我直接把分母去掉了',
          interpretation: 'Missing probe', supports: ['H1'], contradicts: [],
        }],
      },
      signal: new AbortController().signal,
    })
    expect(missingConclusionProbe.isError).toBe(true)

    // Conclude diagnosis with supported finding and whatWouldChangeJudgment
    const concludeTool = ctx.tools.get('grill_conclude', agent)
    expect(concludeTool?.presentCall?.({
      diagnosisStatus: 'supported',
      summary: '用户去分母时确实遗漏常数项',
    })).toEqual({
      card: 'generic', title: 'Diagnosis Proposed', kind: 'other',
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
            sourceRef: `user-event:${answerEvent.seq}`,
            quote: '我直接把分母去掉了，后面的1没动。',
            interpretation: '用户亲口确认常数项未乘公分母',
            supports: ['H1'],
            contradicts: ['H2'],
            probeId: 'P1',
          },
          {
            id: 'E4',
            sourceRef: `user-event:${answerEvent.seq}`,
            quote: '后面的1没动',
            interpretation: '补充观察',
            supports: ['H1'],
            contradicts: [],
            probeId: 'P1',
          },
          {
            id: 'E5',
            sourceRef: 'initial-input',
            quote: '我把两个不等比值当成相等',
            interpretation: '结论阶段同样收到空 probeId',
            supports: ['H1'],
            contradicts: [],
            probeId: '',
          },
        ],
      },
      signal: new AbortController().signal,
    })
    expect(concludeCall.isError).toBe(false)
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.diagnosis.evidence
      .find(item => item.id === 'E5')).not.toHaveProperty('probeId')

    const diag = ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.diagnosis
    expect(diag?.status).toBe('active')
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.pendingConclusion?.bestHypothesisId).toBe('H1')
    expect(diag?.currentProbeId).toBeNull()
    const pendingReplay = Session.create(SessionId('pending-confirmation-replay'), session.snapshotEvents())
    expect(ctx.sessionProjections.stateOf(pendingReplay, 'errgrindEpisode')?.diagnosis.status).toBe('active')
    expect(ctx.sessionProjections.stateOf(pendingReplay, 'errgrindEpisode')?.pendingConclusion?.anchorRevision).toBe(1)
    const pendingStatus = await ctx.commands.execute(agent, '/error-status', [], new AbortController().signal)
    expect(pendingStatus?.result.text).toContain('Grill 未结束')
    const confirmFinal = await ctx.commands.execute(agent, '/error-confirm 1', [], new AbortController().signal)
    expect(confirmFinal?.result.kind).toBe('success')
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.diagnosis.status).toBe('supported')

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
    const oldRevisionConfirm = await ctx.commands.execute(agent, '/error-confirm 1', [], new AbortController().signal)
    expect(oldRevisionConfirm?.result.kind).toBe('error')
    expect(oldRevisionConfirm?.result.text).toContain('已有更新')
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.confirmedRevision).toBeNull()
    expect(session.snapshotEvents().filter(event => event.type === 'errgrind/error-confirm')).toHaveLength(1)
    const earlyReprobe = await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('reprobe-before-confirm'), agent,
      arguments: {
        probe: {
          id: 'P1', type: 'reasoning_question', question: 'What happened?',
          targetHypothesisIds: ['H1'], discriminationGoal: 'Recheck',
          predictions: [{ hypothesisId: 'H1', expectedObservation: 'Answer' }],
        },
        newHypotheses: [{ id: 'H1', claim: 'Revised mechanism' }],
      },
      signal: new AbortController().signal,
    })
    expect(earlyReprobe.isError).toBe(false)
    const statusStale = await ctx.commands.execute(agent, '/error-status', [], new AbortController().signal)
    expect(statusStale?.result.text).toContain('诊断状态: active')

    // Revision 2 still requires a matching conclusion proposal before confirmation.
    const prematureRevisionConfirm = await ctx.commands.execute(agent, '/error-confirm 2', [], new AbortController().signal)
    expect(prematureRevisionConfirm?.result.kind).toBe('error')
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.confirmedRevision).toBeNull()

    expect((await ctx.tools.execute({
      name: 'error_clarify', callId: ToolCallId('clarify-before-stale-reprobe'), agent,
      arguments: { text: 'Please clarify the revised Error before another diagnostic probe.' },
      signal: new AbortController().signal,
    })).isError).toBe(false)

    const reprobe = await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('reprobe-1'), agent,
      arguments: {
        probe: {
          id: 'P2', type: 'reasoning_question', question: '乘负数时，不等号的方向如何处理？',
          targetHypothesisIds: ['H1'], discriminationGoal: '复核不等号方向处理',
          predictions: [{ hypothesisId: 'H1', expectedObservation: '没有翻转方向' }],
        },
      },
      signal: new AbortController().signal,
    })
    expect(reprobe.isError).toBe(false)
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.diagnosisHistory).toHaveLength(1)
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.diagnosis.currentProbeId).toBe('P2')

    // Cold session replay verifies full deterministic recovery
    const replayed = Session.create(SessionId('replayed-math-error'), session.snapshotEvents())
    expect(ctx.sessionProjections.stateOf(replayed, 'errgrindEpisode')?.draft?.revision).toBe(2)
    expect(ctx.sessionProjections.stateOf(replayed, 'errgrindEpisode')?.diagnosis.status).toBe('active')
    expect(ctx.sessionProjections.stateOf(replayed, 'errgrindEpisode')?.diagnosisHistory).toHaveLength(1)

    const reusedOldAnswer = await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('reprobe-old-answer'), agent,
      arguments: {
        diagnosisStatus: 'supported', summary: '旧回答不能证明更正后的新机制', bestHypothesisId: 'H1',
        hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
        newEvidence: [{
          id: 'E1', sourceRef: `user-event:${answerEvent.seq}`, quote: '我直接把分母去掉了',
          interpretation: '旧轮次回答', supports: ['H1'], contradicts: [], probeId: 'P1',
        }],
      },
      signal: new AbortController().signal,
    })
    expect(reusedOldAnswer.isError).toBe(true)

    const newAnswerEvent = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '这次我把不等式两边同时乘了负数，却忘记翻转方向。' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const newConclusion = await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('reprobe-new-answer'), agent,
      arguments: {
        diagnosisStatus: 'supported', summary: '更正后确认不等号方向处理错误', bestHypothesisId: 'H1',
        whatWouldChangeJudgment: '发现两边乘的是正数',
        hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
        newEvidence: [{
          id: 'E3', sourceRef: `user-event:${newAnswerEvent.seq}`, quote: '忘记翻转方向',
          interpretation: '本轮用户回答', supports: ['H1'], contradicts: [], probeId: 'P2',
        }],
      },
      signal: new AbortController().signal,
    })
    expect(newConclusion.isError).toBe(false)
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.diagnosisRound).toBe(2)
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.diagnosis.status).toBe('active')
    await ctx.commands.execute(agent, '/error-confirm 2', [], new AbortController().signal)
    expect(ctx.sessionProjections.stateOf(session, 'errgrindEpisode')?.diagnosis.status).toBe('supported')

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
    expect(secondEpisode?.origin.kind).toBe('host_relay')
    expect(secondEpisode?.origin.senderSessionId).toBe('parent-agent')

    // Test undetermined conclusion on second session
    await ctx.tools.execute({
      name: 'error_draft', callId: ToolCallId('second-draft-1'), agent: secondAgent,
      arguments: { description: '分子相加、分母相加的分数加法错误。' },
      signal: new AbortController().signal,
    })
    await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('second-conclude'), agent: secondAgent,
      arguments: {
        diagnosisStatus: 'undetermined',
        summary: '无法区分直觉模式套用与通分概念未建立。',
        remainingUncertainty: '需要进一步的异分母练习。',
      },
      signal: new AbortController().signal,
    })
    expect(ctx.sessionProjections.stateOf(second, 'errgrindEpisode')?.diagnosis.status).toBe('active')
    await ctx.commands.execute(secondAgent, '/error-confirm 1', [], new AbortController().signal)
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

  it('enforces live observation requirement and change-judgment validation in registered tools', async () => {
    root = await mkdtemp(join(tmpdir(), 'errgrind-observation-reg-'))
    const ctx = context = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    episodePlugin.apply(ctx)

    const session = ctx.sessions.create(SessionId('observation-reg-session'))
    const agent = { id: session.id, ctx, session, status: 'idle', options: {}, reserveTurnAdmission: () => () => undefined } as unknown as Agent

    // Open error via pre-step
    const firstMsg = createUserMessage({
      content: [{ type: 'text', text: '5 - 2 * 3 = 9' }], source: { kind: 'user' },
    })
    await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages: [firstMsg], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [firstMsg] }))

    // Draft error description
    await ctx.tools.execute({
      name: 'error_draft', callId: ToolCallId('draft-1'), agent,
      arguments: { description: 'Computed subtraction before multiplication: (5-2)*3 = 9.' },
      signal: new AbortController().signal,
    })

    // Pose probe P1
    const p1Call = await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('probe-1'), agent,
      arguments: {
        probe: {
          id: 'P1', type: 'reasoning_question', question: 'Which operation did you perform first?',
          targetHypothesisIds: ['H1', 'H2'], discriminationGoal: 'Distinguish order of operations from arithmetic mistake',
          predictions: [
            { hypothesisId: 'H1', expectedObservation: 'Subtracted first' },
            { hypothesisId: 'H2', expectedObservation: 'Multiplied first' },
          ],
        },
        newHypotheses: [
          { id: 'H1', claim: 'Left-to-right evaluation order ignoring precedence' },
          { id: 'H2', claim: 'Multiplication arithmetic mistake' },
        ],
      },
      signal: new AbortController().signal,
    })
    expect(p1Call.isError).toBe(false)

    // User answers probe P1 with contradictory / discriminating reply
    session.append('turn/start', { turn: 2 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'I did 5 minus 2 first, which is 3, then 3 times 3 is 9.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    // 1. Attempting next grill_probe while omitting observation of the latest reply fails
    const probeOmitted = await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('probe-2-omitted'), agent,
      arguments: {
        probe: {
          id: 'P2', type: 'variant_problem', question: 'What is 10 - 2 * 4?',
          targetHypothesisIds: ['H1'], discriminationGoal: 'Confirm left to right',
          predictions: [{ hypothesisId: 'H1', expectedObservation: 'Answers 32' }],
        },
      },
      signal: new AbortController().signal,
    })
    expect(probeOmitted.isError).toBe(true)

    // 2. Attempting grill_conclude while omitting observation of the latest reply fails
    const concludeOmitted = await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('conclude-omitted'), agent,
      arguments: {
        diagnosisStatus: 'supported', summary: 'Left-to-right error without observing answer',
        bestHypothesisId: 'H1',
        whatWouldChangeJudgment: 'Evidence showing multiplication was done first',
        hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
      },
      signal: new AbortController().signal,
    })
    expect(concludeOmitted.isError).toBe(true)

    // 3. Supplying an observation for the latest reply that is nondiscriminating (supports/contradicts empty) is accepted
    const probeWithNondiscriminating = await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('probe-2-nondiscriminating'), agent,
      arguments: {
        probe: {
          id: 'P2', type: 'variant_problem', question: 'What is 10 - 2 * 4?',
          targetHypothesisIds: ['H1'], discriminationGoal: 'Confirm left to right',
          predictions: [{ hypothesisId: 'H1', expectedObservation: 'Answers 32' }],
        },
        newEvidence: [{
          id: 'E1', sourceRef: 'latest-probe-answer', quote: '5 minus 2 first',
          interpretation: 'Recorded step order from user reply',
          supports: [], contradicts: [], probeId: 'P1',
        }],
      },
      signal: new AbortController().signal,
    })
    expect(probeWithNondiscriminating.isError).toBe(false)

    // Now P1 answer is represented in the ledger. User answers P2:
    session.append('turn/start', { turn: 3 })
    const answerP2 = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '10 minus 2 is 8, 8 times 4 is 32.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    // 4. Missing whatWouldChangeJudgment in supported conclusion fails
    const missingChangeJudgment = await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('conclude-missing-judgment'), agent,
      arguments: {
        diagnosisStatus: 'supported',
        summary: 'Confirmed left-to-right precedence misunderstanding.',
        bestHypothesisId: 'H1',
        hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
        newEvidence: [{
          id: 'E2', sourceRef: `user-event:${answerP2.seq}`, quote: '10 minus 2 is 8',
          interpretation: 'Repeated left-to-right evaluation on variant',
          supports: ['H1'], contradicts: ['H2'], probeId: 'P2',
        }],
      },
      signal: new AbortController().signal,
    })
    expect(missingChangeJudgment.isError).toBe(true)

    // 5. With whatWouldChangeJudgment and grounded observation, conclude succeeds
    const successfulConclusion = await ctx.tools.execute({
      name: 'grill_conclude', callId: ToolCallId('conclude-valid'), agent,
      arguments: {
        diagnosisStatus: 'supported',
        summary: 'Confirmed left-to-right precedence misunderstanding.',
        bestHypothesisId: 'H1',
        whatWouldChangeJudgment: 'Counter-evidence showing standard operator precedence was applied',
        hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
        newEvidence: [{
          id: 'E2', sourceRef: `user-event:${answerP2.seq}`, quote: '10 minus 2 is 8',
          interpretation: 'Repeated left-to-right evaluation on variant',
          supports: ['H1'], contradicts: ['H2'], probeId: 'P2',
        }],
      },
      signal: new AbortController().signal,
    })
    expect(successfulConclusion.isError).toBe(false)
  })

  it('resolves latest probe and clarification aliases to durable references including image attachments', async () => {
    root = await mkdtemp(join(tmpdir(), 'errgrind-aliases-reg-'))
    const ctx = context = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    episodePlugin.apply(ctx)

    const session = ctx.sessions.create(SessionId('aliases-reg-session'))
    const agent = { id: session.id, ctx, session, status: 'idle', options: {}, reserveTurnAdmission: () => () => undefined } as unknown as Agent

    const firstMsg = createUserMessage({
      content: [{ type: 'text', text: 'Equation problem.' }], source: { kind: 'user' },
    })
    await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages: [firstMsg], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [firstMsg] }))

    await ctx.tools.execute({
      name: 'error_draft', callId: ToolCallId('draft-1'), agent,
      arguments: { description: 'Algebraic equation draft.' },
      signal: new AbortController().signal,
    })

    // Clarification asked
    await ctx.tools.execute({
      name: 'error_clarify', callId: ToolCallId('clarify-1'), agent,
      arguments: { text: 'Which formula did you use?' },
      signal: new AbortController().signal,
    })

    // User replies to clarification with text + image
    const clarMsg = session.append('user/message', createUserMessage({
      content: [
        { type: 'text', text: 'I used quadratic formula.' },
        {
          type: 'image',
          attachment: {
            attachmentId: AttachmentId('sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'),
            mediaType: 'image/png', bytes: 3, width: 1, height: 1,
          },
        },
      ],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    // Pose probe P1 resolving latest-clarification-answer and latest-clarification-attachment:1
    const p1Call = await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('probe-1'), agent,
      arguments: {
        probe: {
          id: 'P1', type: 'reasoning_question', question: 'How did you calculate discriminant?',
          targetHypothesisIds: ['H1'], discriminationGoal: 'Check discriminant calculation',
          predictions: [{ hypothesisId: 'H1', expectedObservation: 'Answers negative' }],
        },
        newHypotheses: [{ id: 'H1', claim: 'Discriminant sign error' }],
        newEvidence: [
          {
            id: 'E1', sourceRef: 'latest-clarification-answer', quote: 'quadratic formula',
            interpretation: 'Learner stated quadratic formula', supports: ['H1'], contradicts: [],
          },
          {
            id: 'E2', sourceRef: 'latest-clarification-attachment:1', quote: '',
            interpretation: 'Photo of scratchpad from clarification', supports: ['H1'], contradicts: [],
          },
        ],
      },
      signal: new AbortController().signal,
    })
    expect(p1Call.isError).toBe(false)

    const episodeState = ctx.sessionProjections.stateOf(session, 'errgrindEpisode')
    expect(episodeState?.diagnosis.evidence.find(e => e.id === 'E1')?.sourceRef).toBe(`user-event:${clarMsg.seq}`)
    expect(episodeState?.diagnosis.evidence.find(e => e.id === 'E2')?.sourceRef).toBe(`user-event:${clarMsg.seq}:attachment:1`)

    // User replies to P1 with image only
    session.append('turn/start', { turn: 2 })
    const p1ImgReply = session.append('user/message', createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('sha256:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a'),
          mediaType: 'image/png', bytes: 4, width: 1, height: 1,
        },
      }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    // latest-probe-answer must resolve to the image reply, NOT mis-binding to older text
    const p2Call = await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('probe-2'), agent,
      arguments: {
        probe: {
          id: 'P2', type: 'variant_problem', question: 'Check discriminant of x^2 + 4x + 5 = 0',
          targetHypothesisIds: ['H1'], discriminationGoal: 'Confirm negative discriminant',
          predictions: [{ hypothesisId: 'H1', expectedObservation: 'Finds -4' }],
        },
        newEvidence: [
          {
            id: 'E3', sourceRef: 'latest-probe-answer', quote: '',
            interpretation: 'Image-only scratchpad reply observed for P1', supports: ['H1'], contradicts: [], probeId: 'P1',
          },
        ],
      },
      signal: new AbortController().signal,
    })
    expect(p2Call.isError).toBe(false)
    const ep2 = ctx.sessionProjections.stateOf(session, 'errgrindEpisode')
    expect(ep2?.diagnosis.evidence.find(e => e.id === 'E3')?.sourceRef).toBe(`user-event:${p1ImgReply.seq}:attachment:1`)

    // Missing alias target throws error
    const missingAtt = await ctx.tools.execute({
      name: 'grill_probe', callId: ToolCallId('probe-missing-att'), agent,
      arguments: {
        probe: {
          id: 'P3', type: 'reasoning_question', question: 'Next probe',
          targetHypothesisIds: ['H1'], discriminationGoal: 'Goal',
          predictions: [{ hypothesisId: 'H1', expectedObservation: 'Obs' }],
        },
        newEvidence: [
          {
            id: 'E4', sourceRef: 'latest-probe-attachment:99', quote: '',
            interpretation: 'Nonexistent attachment', supports: [], contradicts: [], probeId: 'P1',
          },
        ],
      },
      signal: new AbortController().signal,
    })
    expect(missingAtt.isError).toBe(true)
  })
})
