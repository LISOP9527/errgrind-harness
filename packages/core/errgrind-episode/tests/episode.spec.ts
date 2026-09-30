import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { applyEpisodeEvent, publicErrorListEntry } from '../src/index.ts'
import type { DiagnosticProbe } from '../src/types.ts'

describe('Error episode event rules', () => {
  it('projects a public history row without original input or private diagnosis', () => {
    const session = Session.create(SessionId('errgrind-history'))
    expect(publicErrorListEntry(null)).toBeNull()
    let state = applyEpisodeEvent(null, session.append('errgrind/error-open', {
      text: 'PRIVATE_ORIGINAL_ANSWER', turn: 1,
    }))
    expect(publicErrorListEntry(state)).toEqual({ description: null, status: 'grill', drillEligible: false })
    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 1, text: '把分数分母直接相加。',
    }))
    expect(publicErrorListEntry(state)).toEqual({ description: '把分数分母直接相加。', status: 'grill', drillEligible: false })
    state = applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      anchorRevision: 1, diagnosisStatus: 'undetermined',
      summary: 'PRIVATE_DIAGNOSIS', remainingUncertainty: '还需证据', turn: 1,
    }))
    expect(publicErrorListEntry(state)).toEqual({ description: '把分数分母直接相加。', status: 'confirm', drillEligible: false })
    state = applyEpisodeEvent(state, session.append('errgrind/error-confirm', {
      revision: 1, commandId: 'reviewed',
    }))
    const visible = publicErrorListEntry(state)
    expect(visible).toEqual({ description: '把分数分母直接相加。', status: 'teach', drillEligible: true })
    expect(JSON.stringify(visible)).not.toContain('PRIVATE_ORIGINAL_ANSWER')
    expect(JSON.stringify(visible)).not.toContain('PRIVATE_DIAGNOSIS')
    expect(publicErrorListEntry({ ...state!, draft: { revision: 1, text: '汉'.repeat(350) } })?.description)
      .toHaveLength(300)
  })

  it('starts Teach only after diagnosis and keeps post-Teach answers out of Error-time evidence', () => {
    const session = Session.create(SessionId('errgrind-teach'))
    let state = applyEpisodeEvent(null, session.append('errgrind/error-open', {
      text: 'I calculated 1/2 + 1/3 as 2/5.', turn: 1,
    }))
    const originalSources = state?.evidenceSources
    const teach = { kind: 'question' as const, text: 'Why do fractions need a common denominator?',
      anchorRevision: 1, diagnosisRound: 1, turn: 2 }
    expect(() => applyEpisodeEvent(state, session.append('errgrind/teach-step', teach)))
      .toThrow('completed diagnosis')
    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 1, text: 'I added both numerators and both denominators.',
    }))
    state = applyEpisodeEvent(state, session.append('errgrind/error-confirm', {
      revision: 1, commandId: 'reviewed',
    }))
    state = applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      anchorRevision: 1, diagnosisStatus: 'undetermined',
      summary: 'The written step is known; its cause is not yet distinguished.',
      remainingUncertainty: 'One answer does not separate a rule misconception from a slip.', turn: 1,
    }))
    expect(() => applyEpisodeEvent(state, session.append('errgrind/teach-step', {
      ...teach, anchorRevision: 2,
    }))).toThrow('not anchored')
    state = applyEpisodeEvent(state, session.append('errgrind/teach-step', teach))
    expect(state?.teachStartedAtTurn).toBe(2)
    const answer = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Because the pieces must be the same size.' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyEpisodeEvent(state, answer)
    expect(state?.evidenceSources).toEqual(originalSources)

    // Teaching changes what later answers can tell us about the original
    // mistake. Keep that investigation anchored and start a new Error later.
    expect(() => applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 2, text: 'I also wrote the intermediate step 1+1 over 2+3.',
    }))).toThrow('locked after Teach begins')
  })

  it('keeps the authentic first input, attachments, and provenance', () => {
    const session = Session.create(SessionId('errgrind-episode'))
    let state = applyEpisodeEvent(null, session.append('errgrind/error-open', {
      text: '  My original solution was wrong.  ',
      turn: 1,
      provenance: { kind: 'direct_user', rpcId: 'rpc-1' },
      attachments: [{
        sha256: 'abc123def456',
        mediaType: 'image/jpeg',
        bytes: 1024,
        name: 'problem.jpg',
      }],
    }))
    expect(state?.firstInput).toBe('  My original solution was wrong.  ')
    expect(state?.firstInputHasImage).toBe(true)
    expect(state?.firstInputTurn).toBe(1)
    expect(state?.provenance.kind).toBe('direct_user')
    expect(state?.attachments).toHaveLength(1)
    expect(state?.attachments[0]?.sha256).toBe('abc123def456')
    expect(state?.draft).toBeNull()
    expect(state?.confirmedRevision).toBeNull()
    expect(state?.diagnosis.status).toBe('active')

    // turn/start when state is null returns null
    expect(applyEpisodeEvent(null, session.append('turn/start', { turn: 1 }))).toBeNull()

    // Unrelated / unchanged turn events pass through without changing reference
    const unrelated = session.append('turn/start', { turn: 1 })
    expect(applyEpisodeEvent(state, unrelated)).toBe(state)
    const clarified = applyEpisodeEvent(state, session.append('errgrind/error-clarify', {
      text: 'Which line did you write first?', turn: 1,
    }))
    expect(clarified?.pendingClarification).toBe(true)
    expect(clarified?.diagnosis.currentProbeId).toBeNull()

    // turn/start with non-number turn falls back to latestTurn and keeps reference
    expect(applyEpisodeEvent(state, session.append('turn/start', { turn: 'bad' as never }))).toBe(state)

    // turn/start with new turn advances latestTurn
    const nextTurnState = applyEpisodeEvent(state, session.append('turn/start', { turn: 2 }))
    expect(nextTurnState?.latestTurn).toBe(2)

    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 1, text: 'I treated two unequal ratios as equal.',
    }))
    expect(state?.confirmedRevision).toBeNull()
    expect(state?.draft?.revision).toBe(1)

    state = applyEpisodeEvent(state, session.append('errgrind/error-confirm', {
      revision: 1, commandId: 'human-command-1',
    }))
    expect(state?.confirmedRevision).toBe(1)

    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 2, text: 'Revised Error description after checking my work.',
    }))
    expect(state?.confirmedRevision).toBeNull()
    expect(state?.draft?.revision).toBe(2)
  })

  it('grounds initial text and image observations without treating them as probe answers', () => {
    const session = Session.create(SessionId('errgrind-initial-evidence'))
    let state = applyEpisodeEvent(null, session.append('errgrind/error-open', {
      text: '当时我写了 1/2+1/3=2/5。', turn: 1,
      attachments: [{ sha256: 'abc', mediaType: 'image/png', bytes: 40 }],
    }))
    expect(state?.evidenceSources.map(source => source.sourceRef))
      .toEqual(['initial-input', 'initial-attachment:1'])
    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 1, text: '用户当时写了 1/2+1/3=2/5，并上传了演算图片。',
    }))
    const probe: DiagnosticProbe = {
      id: 'P1', type: 'reasoning_question', question: '当时为什么分母相加？',
      targetHypothesisIds: ['H1'], discriminationGoal: '检验当时使用的运算规则',
      predictions: [{ hypothesisId: 'H1', expectedObservation: '说分母也应相加' }],
    }
    const initialEvidence = [
      { id: 'E1', sourceRef: 'initial-input', quote: '1/2+1/3=2/5',
        interpretation: '原始文字显示计算步骤，不证明原因', supports: ['H1'], contradicts: [] },
      { id: 'E2', sourceRef: 'initial-attachment:1', quote: '',
        interpretation: '图片为用户上传的演算材料，视觉解读不是原话', supports: [], contradicts: [] },
    ]
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe, newHypotheses: [{ id: 'H1', claim: '认为分母也应相加', status: 'plausible' }],
      newEvidence: [{ ...initialEvidence[1]!, sourceRef: 'initial-attachment:2' }], turn: 1,
    }))).toThrow('recorded input')
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe, newHypotheses: [{ id: 'H1', claim: '认为分母也应相加', status: 'plausible' }],
      newEvidence: [{ ...initialEvidence[1]!, quote: '图片显示错误' }], turn: 1,
    }))).toThrow('empty quote')
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe, newHypotheses: [{ id: 'H1', claim: '认为分母也应相加', status: 'plausible' }],
      newEvidence: [{ ...initialEvidence[0]!, quote: '模型补写的思路' }], turn: 1,
    }))).toThrow('recorded text')
    state = applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe, newHypotheses: [{ id: 'H1', claim: '认为分母也应相加', status: 'plausible' }],
      newEvidence: initialEvidence, turn: 1,
    }))
    expect(state?.diagnosis.evidence).toHaveLength(2)
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported', bestHypothesisId: 'H1', summary: '可能误用分数加法规则',
      hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }], turn: 1,
    }))).toThrow('user\'s answer to a probe')
    const answer = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '我当时以为分母也直接相加。' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyEpisodeEvent(state, answer)
    state = applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported', bestHypothesisId: 'H1', summary: '本次最受支持的是误用分数加法规则',
      hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
      newEvidence: [{ id: 'E3', sourceRef: `user-event:${answer.seq}`, quote: '分母也直接相加',
        interpretation: '用户回忆当时的规则判断', supports: ['H1'], contradicts: [], probeId: 'P1' }],
      turn: 2,
    }))
    expect(state?.pendingConclusion?.status).toBe('supported')
  })

  it('rejects an empty anchor, duplicate open, skipped revision, and stale confirmation', () => {
    const session = Session.create(SessionId('errgrind-invalid'))
    expect(() => applyEpisodeEvent(null, session.append('errgrind/error-open', {
      text: '', hasImage: false, turn: 1,
    }))).toThrow('empty')

    const opened = applyEpisodeEvent(null, session.append('errgrind/error-open', {
      text: '', hasImage: true, turn: 2,
    }))
    expect(opened?.firstInputHasImage).toBe(true)

    expect(() => applyEpisodeEvent(opened, session.append('errgrind/error-open', {
      text: 'second', hasImage: false, turn: 3,
    }))).toThrow('already open')

    expect(() => applyEpisodeEvent(opened, session.append('errgrind/error-draft', {
      revision: 2, text: 'Skipped one version',
    }))).toThrow('revision')

    expect(() => applyEpisodeEvent(opened, session.append('errgrind/error-draft', {
      revision: 1, text: '   ',
    }))).toThrow('revision')

    const draft = applyEpisodeEvent(opened, session.append('errgrind/error-draft', {
      revision: 1, text: 'Image-based draft',
    }))

    expect(() => applyEpisodeEvent(null, session.append('errgrind/error-draft', {
      revision: 1, text: 'No open episode',
    }))).toThrow('not open')

    expect(() => applyEpisodeEvent(opened, session.append('errgrind/error-confirm', {
      revision: 1, commandId: 'too-early',
    }))).toThrow('not current')

    expect(() => applyEpisodeEvent(draft, session.append('errgrind/error-confirm', {
      revision: 2, commandId: 'human-command-2',
    }))).toThrow('not current')

    const confirmed = applyEpisodeEvent(draft, session.append('errgrind/error-confirm', {
      revision: 1, commandId: 'human-command-3',
    }))
    expect(() => applyEpisodeEvent(confirmed, session.append('errgrind/error-confirm', {
      revision: 1, commandId: 'human-command-4',
    }))).toThrow('already confirmed')
  })

  it('handles Grill probes, hypotheses, evidence, and validation rules', () => {
    const session = Session.create(SessionId('errgrind-grill'))
    let state = applyEpisodeEvent(null, session.append('errgrind/error-open', {
      text: 'x/2 = 3 => x = 5', turn: 1,
    }))

    const validProbe: DiagnosticProbe = {
      id: 'P1',
      type: 'reasoning_question',
      question: 'How did you solve for x?',
      targetHypothesisIds: ['H1', 'H2'],
      discriminationGoal: 'Differentiate addition vs multiplication error',
      predictions: [
        { hypothesisId: 'H1', expectedObservation: 'Added 2 and 3' },
        { hypothesisId: 'H2', expectedObservation: 'Multiplied incorrectly' },
      ],
      answerKey: 'Multiply both sides by 2',
      preservedMechanism: 'Multiplication by denominator',
      surfaceChange: 'Different equation',
    }

    // Probe rejected when episode not open
    expect(() => applyEpisodeEvent(null, session.append('errgrind/grill-probe', {
      probe: validProbe, turn: 1,
    }))).toThrow('not open')

    // Hypothesis ID validation
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: validProbe,
      newHypotheses: [{ id: 'INVALID', claim: 'Bad ID', status: 'plausible' }],
      turn: 1,
    }))).toThrow('invalid')

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: validProbe,
      newHypotheses: [{ id: 'H1', claim: '   ', status: 'plausible' }],
      turn: 1,
    }))).toThrow('empty')

    // Valid probe posing with H1, H2
    state = applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: validProbe,
      newHypotheses: [
        { id: 'H1', claim: 'Added 2 to 3 instead of multiplying', status: 'plausible' },
        { id: 'H2', claim: 'Arithmetic confusion with addition', status: 'plausible' },
      ],
      turn: 1,
    }))

    const firstAnswerEvent = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'I subtracted 3.' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyEpisodeEvent(state, firstAnswerEvent)
    expect(state?.diagnosis.currentProbeId).toBe('P1')
    expect(state?.diagnosis.hypotheses).toHaveLength(2)
    expect(state?.diagnosis.probes).toHaveLength(1)

    const secondAnswerEvent = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'I did 2+3=5.' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyEpisodeEvent(state, secondAnswerEvent)
    expect(state?.evidenceSources.map(source => source.sourceRef)).toEqual([
      'initial-input', `user-event:${firstAnswerEvent.seq}`, `user-event:${secondAnswerEvent.seq}`,
    ])

    // Duplicate hypothesis ID
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2' },
      newHypotheses: [{ id: 'H1', claim: 'Duplicate H1', status: 'plausible' }],
      turn: 2,
    }))).toThrow('already exists')

    // Duplicate probe ID
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: validProbe,
      turn: 2,
    }))).toThrow('already exists')

    // Probe validation failures
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'BAD_ID' }, turn: 2,
    }))).toThrow('invalid')

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2', question: '  ' }, turn: 2,
    }))).toThrow('question')

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2', discriminationGoal: ' ' }, turn: 2,
    }))).toThrow('discriminationGoal')

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2', targetHypothesisIds: [] }, turn: 2,
    }))).toThrow('targetHypothesisIds')

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2', targetHypothesisIds: ['H99'] }, turn: 2,
    }))).toThrow('H99')

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2', predictions: [] }, turn: 2,
    }))).toThrow('predictions')

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2', predictions: [{ hypothesisId: 'H99', expectedObservation: 'obs' }] }, turn: 2,
    }))).toThrow('H99')

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2', predictions: [{ hypothesisId: 'H1', expectedObservation: '   ' }] }, turn: 2,
    }))).toThrow('expectedObservation')

    // Evidence validation failures
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2' },
      newEvidence: [{
        id: 'E_BAD', sourceRef: 'turn:1', interpretation: 'note', supports: [], contradicts: [],
      }],
      turn: 2,
    }))).toThrow('invalid')

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2' },
      newEvidence: [{
        id: 'E1', sourceRef: '   ', interpretation: 'note', supports: [], contradicts: [],
      }],
      turn: 2,
    }))).toThrow('sourceRef')

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2' },
      newEvidence: [{
        id: 'E1', sourceRef: 'turn:1', interpretation: '  ', supports: [], contradicts: [],
      }],
      turn: 2,
    }))).toThrow('interpretation')

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2' },
      newEvidence: [{
        id: 'E1', sourceRef: 'turn:1', interpretation: 'note', supports: ['H99'], contradicts: [],
      }],
      turn: 2,
    }))).toThrow('H99')

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2' },
      newEvidence: [{
        id: 'E1', sourceRef: 'turn:1', interpretation: 'note', supports: [], contradicts: ['H99'],
      }],
      turn: 2,
    }))).toThrow('H99')

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2' },
      newEvidence: [{
        id: 'E1', sourceRef: 'turn:1', interpretation: 'note', supports: [], contradicts: [], probeId: 'P99',
      }],
      turn: 2,
    }))).toThrow('P99')

    // Status update for unknown hypothesis
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P2' },
      hypothesisStatusUpdates: [{ id: 'H99', status: 'rejected' }],
      turn: 2,
    }))).toThrow('H99')

    // Valid second probe with evidence and status update
    state = applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: {
        id: 'P2',
        type: 'variant_problem',
        question: 'Solve y/3 = 4',
        targetHypothesisIds: ['H1'],
        discriminationGoal: 'Confirm operator confusion',
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'Answers 7' }],
      },
      hypothesisStatusUpdates: [{ id: 'H2', status: 'weakened' }],
      newEvidence: [{
        id: 'E1',
        sourceRef: `user-event:${secondAnswerEvent.seq}`,
        quote: 'I did 2+3=5',
        interpretation: 'User explicitly confirmed addition',
        supports: ['H1'],
        contradicts: ['H2'],
        probeId: 'P1',
      }],
      turn: 2,
    }))

    expect(state?.diagnosis.currentProbeId).toBe('P2')
    expect(state?.diagnosis.probes).toHaveLength(2)
    expect(state?.diagnosis.evidence).toHaveLength(1)
    expect(state?.diagnosis.hypotheses.find(h => h.id === 'H2')?.status).toBe('weakened')

    // Duplicate evidence ID rejected
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...validProbe, id: 'P3' },
      newEvidence: [{
        id: 'E1', sourceRef: 'turn:2', interpretation: 'repeat', supports: [], contradicts: [],
      }],
      turn: 3,
    }))).toThrow('already exists')
  })

  it('keeps Grill active until the proposed diagnosis and current Error description are confirmed', () => {
    const session = Session.create(SessionId('errgrind-conclude'))
    let state = applyEpisodeEvent(null, session.append('errgrind/error-open', {
      text: '3x = 12 => x = 9', turn: 1,
    }))

    state = applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: {
        id: 'P1',
        type: 'reasoning_question',
        question: 'Why x = 9?',
        targetHypothesisIds: ['H1'],
        discriminationGoal: 'Check subtraction vs division',
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'Subtracted 3' }],
      },
      newHypotheses: [
        { id: 'H1', claim: 'Subtracted coefficient instead of dividing', status: 'plausible' },
      ],
      turn: 1,
    }))

    // A draft is required before a conclusion can be proposed.
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported',
      summary: 'Diagnosed subtraction error',
      bestHypothesisId: 'H1',
      hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
      turn: 2,
    }))).toThrow('grounded in a user')

    // The current draft can anchor a proposal before confirmation.
    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 1, text: 'In 3x = 12, I subtracted 3 to get 9.',
    }))
    // Add the user's probe answer as grounded evidence.

    const conclusionAnswerEvent = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'I subtracted 3.' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyEpisodeEvent(state, conclusionAnswerEvent)

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported', summary: 'Unsupported model claim', bestHypothesisId: 'H1',
      hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }], turn: 2,
    }))).toThrow('grounded in a user')

    // Conclude validation: invalid status
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'invalid' as never,
      summary: 'Bad status',
      turn: 2,
    }))).toThrow('Invalid diagnosis status')

    // Conclude validation: empty summary
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported',
      summary: '   ',
      bestHypothesisId: 'H1',
      hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
      turn: 2,
    }))).toThrow('summary')

    // Supported conclusion requires bestHypothesisId
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported',
      summary: 'Missing best',
      turn: 2,
    }))).toThrow('bestHypothesisId')

    // Supported conclusion requires bestHypothesisId to exist
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported',
      summary: 'Missing best',
      bestHypothesisId: 'H99',
      turn: 2,
    }))).toThrow('H99')

    // Supported conclusion requires best hypothesis to have 'supported' status
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported',
      summary: 'H1 is still plausible',
      bestHypothesisId: 'H1',
      turn: 2,
    }))).toThrow('"supported"')

    // Undetermined conclusion cannot have bestHypothesisId
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'undetermined',
      summary: 'Undetermined',
      bestHypothesisId: 'H1',
      remainingUncertainty: 'Ambiguous responses',
      turn: 2,
    }))).toThrow('cannot have a bestHypothesisId')

    // Undetermined conclusion requires remainingUncertainty
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'undetermined',
      summary: 'Undetermined',
      remainingUncertainty: '   ',
      turn: 2,
    }))).toThrow('remainingUncertainty')

    // Successful supported proposal remains active until the same draft is confirmed.
    state = applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported',
      summary: 'Confirmed subtraction operator confusion on linear coefficient.',
      bestHypothesisId: 'H1',
      hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
      newEvidence: [{
        id: 'E1', sourceRef: `user-event:${conclusionAnswerEvent.seq}`, quote: 'I subtracted 3',
        interpretation: 'User reports subtracting the coefficient',
        supports: ['H1'], contradicts: [], probeId: 'P1',
      }],
      whatWouldChangeJudgment: 'Evidence showing user intended division',
      turn: 2,
    }))

    expect(state?.diagnosis.status).toBe('active')
    expect(state?.diagnosis.summary).toBeNull()
    expect(state?.pendingConclusion).toMatchObject({
      status: 'supported',
      summary: 'Confirmed subtraction operator confusion on linear coefficient.',
      anchorRevision: 1,
    })
    expect(state?.diagnosis.currentProbeId).toBeNull()

    state = applyEpisodeEvent(state, session.append('errgrind/error-confirm', {
      revision: 1, commandId: 'confirm-final-description',
    }))
    expect(state?.confirmedRevision).toBe(1)
    expect(state?.pendingConclusion).toBeNull()
    expect(state?.diagnosis.status).toBe('supported')
    expect(state?.diagnosis.bestHypothesisId).toBe('H1')
    expect(state?.diagnosis.anchoredRevision).toBe(1)
    expect(state?.diagnosis.stale).toBe(false)

    // Cannot add a probe to a confirmed, completed diagnosis.
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: {
        id: 'P2', type: 'reasoning_question', question: 'Too late',
        targetHypothesisIds: ['H1'], discriminationGoal: 'Goal',
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'obs' }],
      },
      turn: 3,
    }))).toThrow('completed')

    // Cannot conclude again
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported', summary: 'Second conclude', bestHypothesisId: 'H1', turn: 3,
    }))).toThrow('already concluded')

    // Substantial correction after diagnosis: new draft revision 2
    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 2, text: 'Actually, the equation was 3x - 1 = 11, and I made a different error.',
    }))
    expect(state?.draft?.revision).toBe(2)
    expect(state?.confirmedRevision).toBeNull()
    expect(state?.diagnosis.stale).toBe(true) // Stale because anchor changed!

    state = applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: {
        id: 'P1', type: 'reasoning_question', question: 'Question after correction',
        targetHypothesisIds: ['H1'], discriminationGoal: 'Recheck',
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'Observation' }],
      },
      newHypotheses: [{ id: 'H1', claim: 'Revised mechanism', status: 'plausible' }],
      turn: 3,
    }))
    expect(state?.diagnosis.status).toBe('active')

    // A later proposal is cleared by a draft revision, and Grill remains active.
    state = applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'undetermined',
      summary: 'The corrected Error still has two plausible explanations.',
      remainingUncertainty: 'The available answer does not distinguish them.',
      turn: 4,
    }))
    expect(state?.diagnosis.status).toBe('active')
    expect(state?.pendingConclusion?.anchorRevision).toBe(2)
    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 3, text: 'The corrected equation and reasoning, revised again.',
    }))
    expect(state?.pendingConclusion).toBeNull()
    expect(state?.diagnosis.status).toBe('active')

    // A new probe also invalidates a pending proposal while keeping Grill open.
    state = applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'undetermined',
      summary: 'The revised Error still has two plausible explanations.',
      remainingUncertainty: 'The available answer does not distinguish them.',
      turn: 5,
    }))
    expect(state?.pendingConclusion?.anchorRevision).toBe(3)
    state = applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      anchorRevision: 3,
      probe: {
        id: 'P2', type: 'reasoning_question', question: 'What did you do next?',
        targetHypothesisIds: ['H1'], discriminationGoal: 'Distinguish the explanations',
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'The next step identifies one mechanism' }],
      },
      turn: 6,
    }))
    expect(state?.pendingConclusion).toBeNull()
    expect(state?.diagnosis.status).toBe('active')
    expect(state?.diagnosis.probes).toHaveLength(2)

    state = applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'undetermined',
      summary: 'The new answer still leaves the cause unclear.',
      remainingUncertainty: 'The learner needs to clarify the original step.',
      turn: 7,
    }))
    expect(state?.pendingConclusion).not.toBeNull()
    state = applyEpisodeEvent(state, session.append('errgrind/error-clarify', {
      text: 'Which step did you actually write?', turn: 8,
    }))
    expect(state?.pendingConclusion).toBeNull()
    expect(state?.diagnosis.status).toBe('active')

    // Concluding when not open throws
    expect(() => applyEpisodeEvent(null, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported', summary: 'No open episode', bestHypothesisId: 'H1', turn: 4,
    }))).toThrow('not open')
  })

  it('supports undetermined diagnosis conclusions', () => {
    const session = Session.create(SessionId('errgrind-undetermined'))
    let state = applyEpisodeEvent(null, session.append('errgrind/error-open', {
      text: 'My calculation was 42 instead of 45.', turn: 1,
    }))
    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 1, text: 'Arithmetic error in multi-digit addition.',
    }))
    // Older fork logs may contain a draft confirmation before the model conclusion.
    state = applyEpisodeEvent(state, session.append('errgrind/error-confirm', {
      revision: 1, commandId: 'confirm-cmd',
    }))

    state = applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'undetermined',
      summary: 'Insufficient scratchpad details to distinguish carry error from recall lapse.',
      remainingUncertainty: 'Both carry error and multiplication fact retrieval explain 42 vs 45.',
      turn: 2,
    }))

    expect(state?.diagnosis.status).toBe('undetermined')
    expect(state?.diagnosis.bestHypothesisId).toBeNull()
    expect(state?.diagnosis.remainingUncertainty).toContain('carry error')
    expect(state?.diagnosis.stale).toBe(false)
  })

  it('handles optional event field defaults in applyEpisodeEvent', () => {
    const session = Session.create(SessionId('errgrind-defaults'))
    // error-open with text empty and hasImage omitted
    let state = applyEpisodeEvent(null, session.append('errgrind/error-open', {
      text: '',
      turn: 1,
      attachments: [{
        sha256: 'img-hash',
        mediaType: 'image/png',
        bytes: 512,
      }],
    }))
    expect(state?.firstInput).toBe('')
    expect(state?.firstInputHasImage).toBe(true)
    expect(state?.provenance.kind).toBe('direct_user')

    const notUser = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Host relay' }], source: { kind: 'agent-message' } as never,
    }), { surfaceOp: 'append' })
    expect(applyEpisodeEvent(null, notUser)).toBeNull()
    expect(applyEpisodeEvent(state, notUser)).toBe(state)
    const beforeProbe = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'No question is pending' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(applyEpisodeEvent(state, beforeProbe)).toBe(state)

    // grill-probe with hypothesis
    state = applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: {
        id: 'P1',
        type: 'reasoning_question',
        question: 'What operation was done?',
        targetHypothesisIds: ['H1'],
        discriminationGoal: 'Check operation',
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'obs' }],
      },
      newHypotheses: [
        { id: 'H1', claim: 'Operator confusion', status: 'plausible' },
      ],
      turn: 1,
    }))
    expect(state?.diagnosis.hypotheses.find(h => h.id === 'H1')?.status).toBe('plausible')
    const emptyAnswer = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(applyEpisodeEvent(state, emptyAnswer)).toBe(state)
  })

  it('locks Error draft and diagnosis after Drill begins without Teach and excludes subsequent answers', () => {
    const session = Session.create(SessionId('errgrind-drill-lock'))
    let state = applyEpisodeEvent(null, session.append('errgrind/error-open', {
      text: 'x + 5 = 10 => x = 15', turn: 1,
    }))
    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 1, text: 'Added 5 instead of subtracting.',
    }))
    state = applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: {
        id: 'P1', type: 'reasoning_question', question: 'How did you solve it?',
        targetHypothesisIds: ['H1'], discriminationGoal: 'Check addition error',
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'Said added 5' }],
      },
      newHypotheses: [{ id: 'H1', claim: 'Operation reversal', status: 'plausible' }],
      turn: 1,
    }))
    const ans = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'I added 5 to 10.' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyEpisodeEvent(state, ans)
    state = applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported', summary: 'Confirmed addition instead of subtraction',
      bestHypothesisId: 'H1', hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
      newEvidence: [{
        id: 'E1', sourceRef: `user-event:${ans.seq}`, quote: 'added 5 to 10',
        interpretation: 'User confirmed addition', supports: ['H1'], contradicts: [], probeId: 'P1',
      }],
      whatWouldChangeJudgment: 'Evidence showing user meant subtraction',
      turn: 2,
    }))
    state = applyEpisodeEvent(state, session.append('errgrind/error-confirm', {
      revision: 1, commandId: 'cmd-confirm-1',
    }))
    expect(state?.diagnosis.status).toBe('supported')
    expect(state?.teachStartedAtTurn).toBeNull()
    expect(state?.drillStartedAtTurn).toBeNull()

    // Drill begins without Teach
    const drillPrep = {
      id: 'drill-1',
      spec: {
        targetMechanism: 'Operation reversal', trigger: 'x + a = b', desiredBehavior: 'subtract a',
        successSignal: 'x = b - a', domain: 'algebra', taskType: 'solve' as const, setting: 'linear equations',
        taskGoal: 'isolate x', essentialTrigger: '+ sign', solutionStrategy: 'inverse operation',
        avoid: ['addition'], difficultyLevel: 1, reasoningDepth: 1, calculationLoad: 1, failureBehavior: 'adds',
      },
      question: 'Solve y + 3 = 7',
      referenceAnswer: 'y = 4',
      sourceRevision: 1,
      sourceDiagnosisRound: 1,
      preparedAtTurn: 3,
    }
    state = applyEpisodeEvent(state, session.append('errgrind/drill-prepared', drillPrep))
    expect(state?.drillStartedAtTurn).toBe(3)
    expect(state?.teachStartedAtTurn).toBeNull()

    // Draft is locked after Drill begins
    expect(() => applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 2, text: 'Trying to update draft after drill',
    }))).toThrow('locked after Drill begins')

    // Grill probe is locked after intervention has begun
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: {
        id: 'P2', type: 'reasoning_question', question: 'Late probe',
        targetHypothesisIds: ['H1'], discriminationGoal: 'late',
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'late' }],
      },
      turn: 4,
    }))).toThrow('intervention has begun')

    // Grill conclude is locked after intervention has begun
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported', summary: 'Late conclude', bestHypothesisId: 'H1', turn: 4,
    }))).toThrow('intervention has begun')

    // Subsequent user messages are excluded from Error-time evidenceSources
    const beforeCount = state?.evidenceSources.length ?? 0
    const lateUserMsg = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'I am answering drill problem: y = 4' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyEpisodeEvent(state, lateUserMsg)
    expect(state?.evidenceSources.length).toBe(beforeCount)

    // Teach after Drill is still allowed, but still treated as post-intervention
    state = applyEpisodeEvent(state, session.append('errgrind/teach-step', {
      kind: 'explanation', text: 'Remember inverse operations undo each other.',
      anchorRevision: 1, diagnosisRound: 1, turn: 5,
    }))
    expect(state?.teachStartedAtTurn).toBe(5)
    expect(state?.drillStartedAtTurn).toBe(3)

    const postTeachUserMsg = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Understood.' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyEpisodeEvent(state, postTeachUserMsg)
    expect(state?.evidenceSources.length).toBe(beforeCount)
  })

  it('grounds image-only and text+image probe evidence with empty quote and rejects invented quotes', () => {
    const session = Session.create(SessionId('errgrind-probe-images'))
    let state = applyEpisodeEvent(null, session.append('errgrind/error-open', {
      text: 'Geometry error.', turn: 1,
    }))
    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 1, text: 'Angle calculation error in triangle.',
    }))
    state = applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: {
        id: 'P1', type: 'reasoning_question', question: 'Please show your scratchpad diagram.',
        targetHypothesisIds: ['H1'], discriminationGoal: 'Inspect diagram labeling',
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'Shows acute angle labeled 120' }],
      },
      newHypotheses: [{ id: 'H1', claim: 'Protractor reading error', status: 'plausible' }],
      turn: 1,
    }))

    // User replies with image only
    const imageMsg = session.append('user/message', createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'),
          mediaType: 'image/png', bytes: 3, width: 1, height: 1,
        },
      }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyEpisodeEvent(state, imageMsg)
    expect(state?.evidenceSources).toContainEqual({
      sourceRef: `user-event:${imageMsg.seq}:attachment:1`,
      text: '',
      probeId: 'P1',
      diagnosisRound: 1,
    })

    // Evidence quoting the image source with empty quote is grounded and valid
    const validImageEvidence = {
      id: 'E1', sourceRef: `user-event:${imageMsg.seq}:attachment:1`, quote: '',
      interpretation: 'Image scratchpad shows angle labeled 120', supports: ['H1'], contradicts: [], probeId: 'P1',
    }

    // Invented quote for image is rejected
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: {
        id: 'P2', type: 'reasoning_question', question: 'Next question',
        targetHypothesisIds: ['H1'], discriminationGoal: 'Next goal',
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'Next obs' }],
      },
      newEvidence: [{ ...validImageEvidence, quote: 'Shows 120 degrees' }],
      turn: 2,
    }))).toThrow('Attachment Evidence E1 must use an empty quote')

    // Valid image evidence accepted on probe P2
    state = applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: {
        id: 'P2', type: 'reasoning_question', question: 'Did you also compute supplementary angles?',
        targetHypothesisIds: ['H1'], discriminationGoal: 'Check supplementary sum',
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'Answers 60' }],
      },
      hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
      newEvidence: [validImageEvidence],
      turn: 2,
    }))
    expect(state?.diagnosis.evidence).toHaveLength(1)

    // User replies with text + image
    const textAndImageMsg = session.append('user/message', createUserMessage({
      content: [
        { type: 'text', text: 'I wrote 180 - 120 = 60 on the margin.' },
        {
          type: 'image',
          attachment: {
            attachmentId: AttachmentId('sha256:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a'),
            mediaType: 'image/png', bytes: 4, width: 1, height: 1,
          },
        },
      ],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyEpisodeEvent(state, textAndImageMsg)
    expect(state?.evidenceSources).toContainEqual({
      sourceRef: `user-event:${textAndImageMsg.seq}`,
      text: 'I wrote 180 - 120 = 60 on the margin.',
      probeId: 'P2',
      diagnosisRound: 1,
    })
    expect(state?.evidenceSources).toContainEqual({
      sourceRef: `user-event:${textAndImageMsg.seq}:attachment:1`,
      text: '',
      probeId: 'P2',
      diagnosisRound: 1,
    })

    // Both text and image evidence from the probe answer are accepted
    state = applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported',
      summary: 'Confirmed protractor misreading with visual scratchpad grounding',
      bestHypothesisId: 'H1',
      whatWouldChangeJudgment: 'Evidence showing angle was correctly drawn',
      newEvidence: [
        {
          id: 'E2', sourceRef: `user-event:${textAndImageMsg.seq}`, quote: '180 - 120 = 60',
          interpretation: 'User confirmed supplementary arithmetic', supports: ['H1'], contradicts: [], probeId: 'P2',
        },
        {
          id: 'E3', sourceRef: `user-event:${textAndImageMsg.seq}:attachment:1`, quote: '',
          interpretation: 'Margin annotation in uploaded photo', supports: ['H1'], contradicts: [], probeId: 'P2',
        },
      ],
      turn: 3,
    }))
    expect(state?.pendingConclusion?.status).toBe('supported')
  })

  it('indexes clarification replies without allowing them alone to satisfy supported diagnosis', () => {
    const session = Session.create(SessionId('errgrind-clarification-indexing'))
    let state = applyEpisodeEvent(null, session.append('errgrind/error-open', {
      text: 'My answer was off by 1.', turn: 1,
    }))
    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 1, text: 'Off-by-one fencepost error in loop bounds.',
    }))
    // Pose clarification
    state = applyEpisodeEvent(state, session.append('errgrind/error-clarify', {
      text: 'Which programming language were you using, and did you write 0 or 1 indexing?', turn: 1,
    }))
    expect(state?.pendingClarification).toBe(true)
    expect(state?.diagnosis.currentProbeId).toBeNull()

    // User replies with text and an image attachment
    const clarReply = session.append('user/message', createUserMessage({
      content: [
        { type: 'text', text: 'I was using Python with range(0, n).' },
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
    state = applyEpisodeEvent(state, clarReply)
    expect(state?.pendingClarification).toBe(false)
    expect(state?.evidenceSources).toContainEqual({
      sourceRef: `user-event:${clarReply.seq}`,
      text: 'I was using Python with range(0, n).',
      probeId: null,
      diagnosisRound: 1,
    })
    expect(state?.evidenceSources).toContainEqual({
      sourceRef: `user-event:${clarReply.seq}:attachment:1`,
      text: '',
      probeId: null,
      diagnosisRound: 1,
    })

    // Clarification evidence can cite exact text and image (empty quote) without probeId
    const clarTextEvidence = {
      id: 'E1', sourceRef: `user-event:${clarReply.seq}`, quote: 'range(0, n)',
      interpretation: 'User clarified loop boundary in Python', supports: ['H1'], contradicts: [],
    }
    const clarImgEvidence = {
      id: 'E2', sourceRef: `user-event:${clarReply.seq}:attachment:1`, quote: '',
      interpretation: 'Clarification IDE screenshot', supports: ['H1'], contradicts: [],
    }

    // Now pose probe P1 with clarification evidence included
    state = applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: {
        id: 'P1', type: 'reasoning_question', question: 'Did the problem state inclusive or exclusive upper bound?',
        targetHypothesisIds: ['H1'], discriminationGoal: 'Distinguish inclusive vs exclusive expectation',
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'Expected inclusive upper bound' }],
      },
      newHypotheses: [{ id: 'H1', claim: 'Expected inclusive range endpoint', status: 'supported' }],
      newEvidence: [clarTextEvidence, clarImgEvidence],
      turn: 2,
    }))
    expect(state?.diagnosis.evidence).toHaveLength(2)

    // Supported diagnosis CANNOT be satisfied by clarification evidence alone (no probe answer evidence)
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported', summary: 'Tried to conclude with clarification alone',
      bestHypothesisId: 'H1', whatWouldChangeJudgment: 'Clearer problem statement', turn: 2,
    }))).toThrow('Supported diagnosis requires evidence grounded in a user\'s answer to a probe')

    // User actually answers probe P1
    const probeReply = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'I expected range(0, n) to include n.' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyEpisodeEvent(state, probeReply)

    // Now supported diagnosis with probe answer evidence succeeds
    state = applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported', summary: 'Confirmed inclusive endpoint misconception',
      bestHypothesisId: 'H1', whatWouldChangeJudgment: 'Proof user intended exclusive range',
      newEvidence: [{
        id: 'E3', sourceRef: `user-event:${probeReply.seq}`, quote: 'include n',
        interpretation: 'User confirmed expecting endpoint inclusion', supports: ['H1'], contradicts: [], probeId: 'P1',
      }],
      turn: 3,
    }))
    expect(state?.pendingConclusion?.status).toBe('supported')
  })

  it('seeds only userResponse as derived-answer source in derived-error-open', () => {
    const session = Session.create(SessionId('errgrind-derived-source'))
    const derivedData = {
      text: 'Practice question: What is 7 * 8?\nLearner response: 54\nReference answer: 56',
      question: 'What is 7 * 8?',
      userResponse: '54',
      referenceAnswer: '56',
      sourceSessionId: 'session-prev',
      sourcePreparationId: 'prep-42',
      sourceAnswerRef: 'answer-ref-1',
    }
    let state = applyEpisodeEvent(null, session.append('errgrind/derived-error-open', derivedData))
    expect(state?.evidenceSources).toEqual([
      { sourceRef: 'derived-answer', text: '54', probeId: null, diagnosisRound: 1 },
    ])
    expect(state?.provenance).toEqual({
      kind: 'derived_drill',
      sourceSessionId: 'session-prev',
      sourcePreparationId: 'prep-42',
      sourceAnswerRef: 'answer-ref-1',
    })
    expect(state?.drillStartedAtTurn).toBeNull()
    expect(state?.pendingClarification).toBe(false)

    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 1, text: 'Multiplication table retrieval error: 7 * 8 = 54 instead of 56.',
    }))

    // Citing derived-answer with quote matching userResponse is valid
    const probe: DiagnosticProbe = {
      id: 'P1', type: 'reasoning_question', question: 'How did you arrive at 54?',
      targetHypothesisIds: ['H1'], discriminationGoal: 'Check table retrieval vs additive slip',
      predictions: [{ hypothesisId: 'H1', expectedObservation: 'States table recall' }],
    }
    state = applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe,
      newHypotheses: [{ id: 'H1', claim: 'Table recall slip', status: 'plausible' }],
      newEvidence: [{
        id: 'E1', sourceRef: 'derived-answer', quote: '54',
        interpretation: 'Learner gave 54 in practice attempt', supports: ['H1'], contradicts: [],
      }],
      turn: 1,
    }))
    expect(state?.diagnosis.evidence).toHaveLength(1)

    // Quoting problem or synthetic wrapper text that is not in userResponse fails
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: { ...probe, id: 'P2' },
      newEvidence: [{
        id: 'E2', sourceRef: 'derived-answer', quote: 'Practice question',
        interpretation: 'Synthetic text should not be quoteable', supports: ['H1'], contradicts: [],
      }],
      turn: 1,
    }))).toThrow('Evidence E2 quote must match the recorded text')
  })
})
