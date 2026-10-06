import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { applyDrillEvent, type DrillPreparation, type DrillState } from '../src/drill.ts'

const initial = (): DrillState => ({ active: null, pendingSpec: null, judgeContextPreparationId: null, pendingImageInput: null,
  pendingAnswerDraft: null, answerSources: [], attempts: [] })
const preparation: DrillPreparation = {
  id: 'practice-1',
  spec: {
    targetMechanism: 'Align denominators', trigger: 'Unlike denominators',
    desiredBehavior: 'Use equal parts', successSignal: 'Explains the common denominator',
    novelty: 'Different fractions', difficulty: 1,
  },
  question: 'What is 3/4 + 1/8?', referenceAnswer: '7/8',
  sourceRevision: 2, sourceDiagnosisRound: 1, preparedAtTurn: 4,
}

describe('Drill attempt boundary', () => {
  it('records the actual answer and wrong-result derived Error in one judged event', () => {
    const session = Session.create(SessionId('drill-wrong'))
    let state = applyDrillEvent(initial(), session.append('errgrind/drill-prepared', preparation))
    const answer = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '4/12' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyDrillEvent(state, answer)
    const sourceRef = `user-event:${answer.seq}`
    const judged = session.append('errgrind/drill-judged', {
      preparationId: preparation.id, answerSourceRef: sourceRef,
      userResponse: '4/12', isCorrect: false, feedback: 'Use eighths.',
      judgeProvider: 'test', judgeModel: 'replay',
      derivedError: {
        id: 'drill:practice-1', origin: 'drill', sourcePreparationId: preparation.id,
        question: preparation.question, userResponse: '4/12', referenceAnswer: '7/8',
      },
      judgedAtTurn: 5,
    })
    state = applyDrillEvent(state, judged)
    expect(state.active).toBeNull()
    expect(state.attempts[0]?.answerSourceRef).toBe(sourceRef)
    expect(state.attempts[0]?.derivedError?.origin).toBe('drill')
    expect(() => applyDrillEvent(state, judged)).toThrow('No matching active Drill')
  })

  it('rejects fabricated answers and a wrong verdict without a derived Error', () => {
    const session = Session.create(SessionId('drill-invalid'))
    let state = applyDrillEvent(initial(), session.append('errgrind/drill-prepared', preparation))
    expect(() => applyDrillEvent(state, session.append('errgrind/drill-judged', {
      preparationId: preparation.id, answerSourceRef: 'user-event:999',
      userResponse: '4/12', isCorrect: false, feedback: 'Use eighths.',
      judgeProvider: 'test', judgeModel: 'replay',
      derivedError: null, judgedAtTurn: 5,
    }))).toThrow('persisted user answer')
    const answer = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '4/12' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyDrillEvent(state, answer)
    expect(() => applyDrillEvent(state, session.append('errgrind/drill-judged', {
      preparationId: preparation.id, answerSourceRef: `user-event:${answer.seq}`,
      userResponse: '4/12', isCorrect: false, feedback: 'Use eighths.',
      judgeProvider: 'test', judgeModel: 'replay',
      derivedError: null, judgedAtTurn: 5,
    }))).toThrow('exactly one derived Error')
  })

  it('keeps a correct attempt without deriving an Error', () => {
    const session = Session.create(SessionId('drill-correct'))
    let state = applyDrillEvent(initial(), session.append('errgrind/drill-prepared', preparation))
    const answer = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '7/8' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyDrillEvent(state, answer)
    state = applyDrillEvent(state, session.append('errgrind/drill-judged', {
      preparationId: preparation.id, answerSourceRef: `user-event:${answer.seq}`,
      userResponse: '7/8', isCorrect: true, feedback: 'Correct common denominator.',
      judgeProvider: 'test', judgeModel: 'replay',
      derivedError: null, judgedAtTurn: 5,
    }))
    expect(state.attempts[0]?.isCorrect).toBe(true)
    expect(state.attempts[0]?.derivedError).toBeNull()
  })

  it('requires a reviewed transcription before judging an image answer and preserves its source', () => {
    const session = Session.create(SessionId('drill-image'))
    let state = applyDrillEvent(initial(), session.append('errgrind/drill-prepared', preparation))
    const image = session.append('user/message', createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'),
          mediaType: 'image/png', bytes: 3, width: 1, height: 1,
        },
      }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyDrillEvent(state, image)
    expect(state.answerSources).toHaveLength(0)
    const imageSourceRef = `user-event:${image.seq}`
    expect(state.pendingImageInput?.sourceRef).toBe(imageSourceRef)
    expect(() => applyDrillEvent(state, session.append('errgrind/drill-judged', {
      preparationId: preparation.id, answerSourceRef: imageSourceRef,
      userResponse: '7/8', isCorrect: true, feedback: 'Correct.',
      judgeProvider: 'test', judgeModel: 'replay', derivedError: null, judgedAtTurn: 5,
    }))).toThrow('Review the image answer')
    state = applyDrillEvent(state, session.append('errgrind/drill-answer-draft', {
      revision: 1, preparationId: preparation.id, imageSourceRef, text: '7/8',
    }))
    expect(state.answerSources).toHaveLength(0)
    const confirmation = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '确认' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyDrillEvent(state, confirmation)
    expect(state.answerSources.at(-1)).toEqual({
      sourceRef: `user-event:${confirmation.seq}`, preparationId: preparation.id,
      text: '7/8', imageSourceRef,
    })
    state = applyDrillEvent(state, session.append('errgrind/drill-judged', {
      preparationId: preparation.id, answerSourceRef: `user-event:${confirmation.seq}`,
      imageSourceRef, userResponse: '7/8', isCorrect: true, feedback: 'Correct.',
      judgeProvider: 'test', judgeModel: 'replay', derivedError: null, judgedAtTurn: 6,
    }))
    expect(state.attempts[0]?.imageSourceRef).toBe(imageSourceRef)
  })

  it('uses the learner correction rather than the model transcription', () => {
    const session = Session.create(SessionId('drill-image-correction'))
    let state = applyDrillEvent(initial(), session.append('errgrind/drill-prepared', preparation))
    const image = session.append('user/message', createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'),
          mediaType: 'image/png', bytes: 3, width: 1, height: 1,
        },
      }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyDrillEvent(state, image)
    state = applyDrillEvent(state, session.append('errgrind/drill-answer-draft', {
      revision: 1, preparationId: preparation.id, imageSourceRef: `user-event:${image.seq}`, text: '7/8',
    }))
    const correction = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '修正：3/4' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyDrillEvent(state, correction)
    expect(state.answerSources.at(-1)?.text).toBe('3/4')
    expect(state.answerSources.at(-1)?.imageSourceRef).toBe(`user-event:${image.seq}`)
  })

  it('accepts the English review keywords and ASCII-colon corrections', () => {
    const session = Session.create(SessionId('drill-image-review-en'))
    let state = applyDrillEvent(initial(), session.append('errgrind/drill-prepared', preparation))
    const image = session.append('user/message', createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'),
          mediaType: 'image/png', bytes: 3, width: 1, height: 1,
        },
      }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyDrillEvent(state, image)
    const imageSourceRef = `user-event:${image.seq}`

    state = applyDrillEvent(state, session.append('errgrind/drill-answer-draft', {
      revision: 1, preparationId: preparation.id, imageSourceRef, text: '7/8',
    }))
    const ignored = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'looks right' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyDrillEvent(state, ignored)
    expect(state.pendingAnswerDraft).not.toBeNull()

    const accepted = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Confirm' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyDrillEvent(state, accepted)
    expect(state.answerSources.at(-1)?.text).toBe('7/8')

    const second = session.append('user/message', createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('sha256:139058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb82'),
          mediaType: 'image/png', bytes: 3, width: 1, height: 1,
        },
      }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyDrillEvent(state, second)
    state = applyDrillEvent(state, session.append('errgrind/drill-answer-draft', {
      revision: 1, preparationId: preparation.id, imageSourceRef: `user-event:${second.seq}`, text: '7/8',
    }))
    const revised = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Revise: 3/4' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyDrillEvent(state, revised)
    expect(state.answerSources.at(-1)?.text).toBe('3/4')

    const third = session.append('user/message', createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('sha256:239058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb83'),
          mediaType: 'image/png', bytes: 3, width: 1, height: 1,
        },
      }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyDrillEvent(state, third)
    const ascii = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '修正: 5/6' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    state = applyDrillEvent(state, ascii)
    expect(state.answerSources.at(-1)?.text).toBe('5/6')
  })

  it('replays legacy preparations without requiring pendingSpec and rejects legacy replacement when pendingSpec exists', () => {
    const session = Session.create(SessionId('drill-legacy-replay'))
    const state = applyDrillEvent(initial(), session.append('errgrind/drill-prepared', preparation))
    expect(state.active?.id).toBe(preparation.id)
    expect(state.pendingSpec).toBeNull()

    const pendingSession = Session.create(SessionId('drill-pending-legacy'))
    const pendingState = applyDrillEvent(initial(), pendingSession.append('errgrind/drill-spec-prepared', {
      id: 'pending-1',
      spec: {
        targetMechanism: 'Align denominators', trigger: 'Unlike denominators',
        failureBehavior: 'Added denominators directly', desiredBehavior: 'Use equal parts',
        successSignal: 'Explains the common denominator', domain: 'fractions',
        taskType: 'calculate', setting: 'arithmetic', taskGoal: 'Compute sum of fractions',
        essentialTrigger: 'Different denominators', solutionStrategy: 'Find common denominator',
        avoid: ['same denominators'], difficultyLevel: 1, reasoningDepth: 1, calculationLoad: 1,
      },
      sourceRevision: 2, sourceDiagnosisRound: 1, preparedAtTurn: 4,
    }))
    expect(() => applyDrillEvent(pendingState, pendingSession.append('errgrind/drill-prepared', preparation)))
      .toThrow('Legacy Drill cannot replace a pending isolated specification')
  })
})
