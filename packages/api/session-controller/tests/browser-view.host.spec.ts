import { describe, expect, it } from 'vitest'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionAssistantStreamBaseline } from '../src/types.ts'
import {
  browserAssistantBaseline, browserAttachmentId, browserEvent, browserImageAttachment, browserProjectionValues,
  parseBrowserAttachmentId, type BrowserViewPolicy,
} from '../src/browser-view.ts'

const POLICY: BrowserViewPolicy = {
  allowedEventTypes: ['user/message', 'errgrind/grill-probe', 'errgrind/derived-error-open', 'errgrind/drill-answer-draft'],
  privateMessageSourceKinds: ['errgrind-derived-error', 'errgrind-drill-context'],
  publicEventFields: {
    'user/message': ['id', 'role', 'content', 'source.kind', 'source.rpcId'],
    'errgrind/grill-probe': ['anchorRevision', 'turn', 'probe.type', 'probe.question'],
    'errgrind/derived-error-open': ['question', 'userResponse'],
    'errgrind/drill-answer-draft': ['revision', 'preparationId', 'text'],
  },
  allowedProjectionKeys: ['modelSelection'],
  redactDataKeys: ['errgrindOriginal'],
  redactToolArguments: true,
  redactAssistantReasoning: true,
  hideAssistantStream: true,
}

function event(type: string, data: unknown, envelope: Record<string, unknown> = {}): SessionEvent {
  return {
    type,
    seq: 4,
    time: 10,
    data,
    ...envelope,
  } as unknown as SessionEvent
}

describe('strict browser Session view', () => {
  it.each(['errgrind/drill-spec-prepared', 'errgrind/drill-draft-requested', 'errgrind/drill-draft-finished'])(
    'keeps isolated Draft event %s private', (type) => {
      const result = browserEvent(event(type, { spec: 'private mechanism', system: 'private prompt',
        referenceAnswer: 'private answer', usage: { inputTokens: 123 } }), POLICY)
      expect(result.type).toBe('browser/private')
      expect(JSON.stringify(result)).not.toContain('private mechanism')
      expect(JSON.stringify(result)).not.toContain('private prompt')
      expect(JSON.stringify(result)).not.toContain('private answer')
      expect(JSON.stringify(result)).not.toContain('inputTokens')
    },
  )
  it('projects user messages and strips ErrGrind original upload receipts', () => {
    const result = browserEvent(event('user/message', {
      id: 'message-1',
      role: 'user',
      source: { kind: 'user', rpcId: 'request-42', clientTimeZone: 'Asia/Shanghai' },
      content: [
        { type: 'text', text: 'I got 2/5.' },
        {
          type: 'image',
          attachment: {
            attachmentId: 'normalized-image-reference',
            mediaType: 'image/png',
            bytes: 12,
            width: 2,
            height: 2,
            errgrindOriginal: {
              sha256: 'private-sha256',
              fileRef: { attachmentId: 'private-original-file-reference', name: 'source.png', bytes: 12 },
            },
          },
        },
        {
          type: 'file',
          attachment: { attachmentId: 'private-file-reference', name: 'work.txt', bytes: 23 },
        },
      ],
    }, { surfaceOp: 'append', sourceEventSeqs: [2, 3] }), POLICY)

    expect(result.type).toBe('user/message')
    expect(result.surfaceOp).toBe('append')
    expect(result.sourceEventSeqs).toEqual([2, 3])
    expect(result.data).toEqual({
      id: 'message-1',
      role: 'user',
      source: { kind: 'user', rpcId: 'request-42' },
      content: [
        { type: 'text', text: 'I got 2/5.' },
        {
          type: 'image',
          attachment: {
            attachmentId: 'browser-event:4:1',
            mediaType: 'image/png',
            bytes: 12,
            width: 2,
            height: 2,
          },
        },
        {
          type: 'file',
          attachment: { attachmentId: 'browser-event:4:2', name: 'work.txt', bytes: 23 },
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('private-')
    expect(JSON.stringify(result)).not.toContain('normalized-image-reference')
    expect(parseBrowserAttachmentId(browserAttachmentId(4, 1))).toEqual({ seq: 4, contentIndex: 1 })
    expect(parseBrowserAttachmentId('browser-event:04:1')).toBeUndefined()
  })

  it('projects only the public Grill question and preserves sequence for every hidden event', () => {
    const probe = browserEvent(event('errgrind/grill-probe', {
      anchorRevision: 2,
      turn: 3,
      probe: {
        id: 'P1',
        type: 'reasoning_question',
        question: 'What did you do with the denominator?',
        targetHypothesisIds: ['H1'],
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'private prediction sentinel' }],
        answerKey: 'private answer sentinel',
      },
      newHypotheses: [{ id: 'H1', claim: 'private diagnostic claim' }],
    }), POLICY)
    expect(probe.data).toEqual({
      anchorRevision: 2,
      turn: 3,
      probe: { type: 'reasoning_question', question: 'What did you do with the denominator?' },
    })
    expect(JSON.stringify(probe)).not.toMatch(/private (prediction|answer|diagnostic)/)

    const hidden = browserEvent(event('assistant/message', { message: { content: [{ type: 'text', text: 'secret assistant answer' }] } }), POLICY)
    expect(hidden).toEqual({ type: 'browser/private', seq: 4, time: 10, data: {}, ignorable: true })
  })

  it.each(['errgrind-derived-error', 'errgrind-drill-context'])('hides copied model-facing context from %s', (kind) => {
    const opened = browserEvent(event('errgrind/derived-error-open', {
      question: 'What is 3/4 + 1/8?', userResponse: '4/12',
      referenceAnswer: 'private answer', sourceAnswerRef: 'private source',
    }), POLICY)
    expect(opened.data).toEqual({ question: 'What is 3/4 + 1/8?', userResponse: '4/12' })
    const copiedContext = browserEvent(event('user/message', {
      id: 'host-context', role: 'user', source: { kind },
      content: [{ type: 'text', text: 'private answer' }],
    }, { surfaceOp: 'append' }), POLICY)
    expect(copiedContext).toEqual({ type: 'browser/private', seq: 4, time: 10, data: {}, ignorable: true })
  })

  it('shows a reviewable image answer draft without its private image reference', () => {
    const draft = browserEvent(event('errgrind/drill-answer-draft', {
      revision: 1, preparationId: 'practice-1', text: '7/8', imageSourceRef: 'private-image-source',
    }), POLICY)
    expect(draft.data).toEqual({ revision: 1, preparationId: 'practice-1', text: '7/8' })
    expect(JSON.stringify(draft)).not.toContain('private-image-source')
  })

  it('keeps only configured projections and omits reconnect assistant stream baselines', () => {
    expect(browserProjectionValues({
      modelSelection: { next: { provider: 'codex', model: 'gpt-6-astra' } },
      errgrindEpisode: { diagnosis: { summary: 'private ledger sentinel' } },
    }, POLICY)).toEqual({ modelSelection: { next: { provider: 'codex', model: 'gpt-6-astra' } } })

    const baseline = browserAssistantBaseline({
      revision: 13,
      activeAttempt: { attemptId: 'attempt', stream: [{ type: 'text-delta', text: 'private assistant sentinel' }] },
    } as unknown as SessionAssistantStreamBaseline, POLICY)
    expect(baseline).toEqual({ revision: 13 })
  })

  it('projects browser image references without product-owned receipt extensions', () => {
    const source = {
      attachmentId: 'sha256:private-original',
      mediaType: 'image/png', bytes: 64, width: 1, height: 1, name: 'math.png',
      originalDimensions: { width: 2, height: 2 },
      errgrindOriginal: { sha256: 'private-sha', fileRef: { attachmentId: 'sha256:private-original' } },
    } as unknown as ImageAttachmentRef
    const attachment = browserImageAttachment(source, 'browser-event:4:1' as ImageAttachmentRef['attachmentId'])
    expect(attachment).toEqual({
      attachmentId: 'browser-event:4:1',
      mediaType: 'image/png', bytes: 64, width: 1, height: 1, name: 'math.png',
      originalDimensions: { width: 2, height: 2 },
    })
    expect(JSON.stringify(attachment)).not.toMatch(/private-original|private-sha|errgrindOriginal/)
  })
})
