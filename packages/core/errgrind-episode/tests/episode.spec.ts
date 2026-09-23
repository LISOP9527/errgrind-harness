import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { applyEpisodeEvent } from '../src/index.ts'
import type { DiagnosticProbe } from '../src/types.ts'

describe('Error episode event rules', () => {
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
      `user-event:${firstAnswerEvent.seq}`, `user-event:${secondAnswerEvent.seq}`,
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

  it('enforces anchor confirmation before concluding and validates conclusion states', () => {
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

    // Concluding without confirmed draft MUST throw
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported',
      summary: 'Diagnosed subtraction error',
      bestHypothesisId: 'H1',
      hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
      turn: 2,
    }))).toThrow('confirmed')

    // Provide draft but not yet confirmed -> still throws
    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 1, text: 'In 3x = 12, I subtracted 3 to get 9.',
    }))
    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-conclude', {
      diagnosisStatus: 'supported',
      summary: 'Diagnosed subtraction error',
      bestHypothesisId: 'H1',
      hypothesisStatusUpdates: [{ id: 'H1', status: 'supported' }],
      turn: 2,
    }))).toThrow('confirmed')

    // Confirm draft revision 1
    state = applyEpisodeEvent(state, session.append('errgrind/error-confirm', {
      revision: 1, commandId: 'cmd-confirm-1',
    }))
    expect(state?.confirmedRevision).toBe(1)

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

    // Successful supported conclusion
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

    expect(state?.diagnosis.status).toBe('supported')
    expect(state?.diagnosis.bestHypothesisId).toBe('H1')
    expect(state?.diagnosis.anchoredRevision).toBe(1)
    expect(state?.diagnosis.stale).toBe(false)
    expect(state?.diagnosis.currentProbeId).toBeNull()

    // Cannot add probe to concluded diagnosis
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

    expect(() => applyEpisodeEvent(state, session.append('errgrind/grill-probe', {
      probe: {
        id: 'P1', type: 'reasoning_question', question: 'Question after correction',
        targetHypothesisIds: ['H1'], discriminationGoal: 'Recheck',
        predictions: [{ hypothesisId: 'H1', expectedObservation: 'Observation' }],
      },
      newHypotheses: [{ id: 'H1', claim: 'Revised mechanism', status: 'plausible' }],
      turn: 3,
    }))).toThrow('Confirm the corrected Error description')

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
})
