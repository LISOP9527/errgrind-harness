import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { applyEpisodeEvent } from '../src/index.ts'

describe('Error episode event rules', () => {
  it('keeps the authentic first input and requires a human confirmation for a draft', () => {
    const session = Session.create(SessionId('errgrind-episode'))
    let state = applyEpisodeEvent(null, session.append('errgrind/error-open', {
      text: '  My original solution was wrong.  ', hasImage: false, turn: 1,
    }))
    expect(state?.firstInput).toBe('  My original solution was wrong.  ')
    expect(state?.draft).toBeNull()
    expect(state?.confirmedRevision).toBeNull()

    state = applyEpisodeEvent(state, session.append('errgrind/error-draft', {
      revision: 1, text: 'I treated two unequal ratios as equal.',
    }))
    expect(state?.confirmedRevision).toBeNull()
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
})
