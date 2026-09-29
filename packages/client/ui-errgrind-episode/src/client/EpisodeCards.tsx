import { useState, type FormEvent } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, type ErrGrindKey } from './locales.ts'
import css from './EpisodeCards.module.css'

/** Safe result channel for the revision-bound confirmation command. */
export type ConfirmRevisionResult = 'confirmed' | 'stale' | 'error'

/** Client action injected by the plugin; no Remote response text crosses into React. */
export interface EpisodeCardInjected {
  confirmRevision: (revision: number) => Promise<ConfirmRevisionResult>
}

/** Complete props for the public Error card. */
export type ErrorCardProps = PropsRuntime<'conversation.chat.node', 'errgrind-error-card'>
  & PropsLocale<typeof NS>
  & EpisodeCardInjected

/** Complete props for a Grill question row. */
export type GrillQuestionProps = PropsRuntime<'conversation.chat.node', 'errgrind-grill-question'> & PropsLocale<typeof NS>

/** Complete props for a public intake clarification. */
export type IntakeClarificationProps = PropsRuntime<'conversation.chat.node', 'errgrind-intake-clarification'> & PropsLocale<typeof NS>

/** Complete props for a public Teach step row. */
export type TeachStepProps = PropsRuntime<'conversation.chat.node', 'errgrind-teach-step'> & PropsLocale<typeof NS>
export type DrillQuestionProps = PropsRuntime<'conversation.chat.node', 'errgrind-drill-question'> & PropsLocale<typeof NS>
export type DrillAnswerDraftProps = PropsRuntime<'conversation.chat.node', 'errgrind-drill-answer-draft'> & PropsLocale<typeof NS>
export type DrillJudgmentProps = PropsRuntime<'conversation.chat.node', 'errgrind-drill-judgment'>
  & PropsLocale<typeof NS>
  & { openDerivedError: (preparationId: string) => Promise<boolean> }
export type DerivedErrorProps = PropsRuntime<'conversation.chat.node', 'errgrind-derived-error'> & PropsLocale<typeof NS>
export type DrillDraftCardProps = PropsRuntime<'conversation.chat.node', 'errgrind-drill-draft-card'> & PropsLocale<typeof NS>

/** Render the current full Error description and its public investigation state. */
export function ErrorEpisodeCard({ node, t, confirmRevision }: ErrorCardProps) {
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState('')
  const description = node.data

  async function confirm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (pending || description.confirmed) return
    setPending(true)
    setFeedback('')
    try {
      const result = await confirmRevision(description.revision)
      if (result === 'confirmed') {
        setFeedback(t('card.confirmedNotice'))
      } else if (result === 'stale') {
        setFeedback(t('card.stale'))
      } else {
        setFeedback(t('card.confirmFailed'))
      }
    } catch {
      setFeedback(t('card.confirmFailed'))
    } finally {
      setPending(false)
    }
  }

  const status = description.confirmed
    ? t('card.confirmed')
    : description.diagnosisStatus !== null ? t('card.pending') : t('card.grillActive')
  return (
    <article className={css.episodeCard} aria-label={t('card.title')}>
      <header className={css.header}>
        <h3 className={css.title}>{t('card.title')}</h3>
        <span className={css.revision}>{t('card.revision', { revision: description.revision })}</span>
        <span className={css.status} aria-live="polite">{status}</span>
      </header>
      <div className={css.description}>{description.description}</div>
      {!description.confirmed && (
        <p className={css.hint}>
          {description.diagnosisStatus === null ? t('card.reviseHint') : t('card.pendingProposalHint')}
        </p>
      )}
      <footer className={css.footer}>
        <span className={css.statusLine}>
          {description.probeCount > 0
            ? t('card.grillProgress', { count: description.probeCount })
            : description.diagnosisStatus === null ? t('card.grillActive') : ''}
        </span>
        {!description.confirmed && description.diagnosisStatus !== null && (
          <form onSubmit={(event) => { void confirm(event) }}>
            <button className={css.confirmButton} type="submit" disabled={pending}>
              {pending ? t('card.confirming') : t('card.confirm')}
            </button>
          </form>
        )}
        {feedback !== '' && <span className={css.feedback} role="status">{feedback}</span>}
      </footer>
      {description.summary !== null && (
        <section>
          <span className={css.statusLine}>
            {!description.confirmed
              ? t('card.proposal')
              : description.diagnosisStatus === 'supported'
                ? t('card.conclusion.supported')
                : t('card.conclusion.undetermined')}
          </span>
          <p className={css.summary}>{description.summary}</p>
          {description.remainingUncertainty !== null && (
            <>
              <span className={css.uncertaintyLabel}>{t('card.remainingUncertainty')}</span>
              <p className={css.uncertainty}>{description.remainingUncertainty}</p>
            </>
          )}
        </section>
      )}
    </article>
  )
}

/** Render one public Grill prompt in its chronological position. */
export function GrillQuestionCard({ node, t }: GrillQuestionProps) {
  return (
    <article className={css.questionCard} aria-label={t('question.label')}>
      <h3 className={css.title}>{t('question.label')}</h3>
      <p className={css.question}>{node.data.question}</p>
    </article>
  )
}

/** Render one durable intake clarification at its chronological position. */
export function IntakeClarificationCard({ node, t }: IntakeClarificationProps) {
  return (
    <article className={css.questionCard} aria-label={t('clarification.label')}>
      <h3 className={css.title}>{t('clarification.label')}</h3>
      <p className={css.question}>{node.data.text}</p>
    </article>
  )
}

const kindLabelKeyMap: Record<'question' | 'hint' | 'explanation', ErrGrindKey> = {
  question: 'teach.kind.question',
  hint: 'teach.kind.hint',
  explanation: 'teach.kind.explanation',
}

/** Render one public Teach step in its chronological position. */
export function TeachStepCard({ node, t }: TeachStepProps) {
  const { kind, text } = node.data
  const kindLabel = t(kindLabelKeyMap[kind])
  return (
    <article
      className={css.teachCard}
      data-kind={kind}
      aria-label={t('teach.label', { kind: kindLabel })}
    >
      <header className={css.header}>
        <h3 className={css.title}>{t('teach.title')}</h3>
        <span className={css.teachKind}>{kindLabel}</span>
      </header>
      <p className={css.teachText}>{text}</p>
    </article>
  )
}

/** Show a new practice question without the private specification or answer. */
export function DrillQuestionCard({ node, t }: DrillQuestionProps) {
  return (
    <article className={css.questionCard} aria-label={t('drill.question')}>
      <h3 className={css.title}>{t('drill.question')}</h3>
      <p className={css.question}>{node.data.question}</p>
    </article>
  )
}

/** Show a transcribed image answer for explicit learner review before judging. */
export function DrillAnswerDraftCard({ node, t }: DrillAnswerDraftProps) {
  return (
    <article className={css.questionCard} aria-label={t('drill.answerDraft')}>
      <header className={css.header}>
        <h3 className={css.title}>{t('drill.answerDraft')}</h3>
        <span className={css.revision}>{t('drill.answerDraftRevision', { revision: node.data.revision })}</span>
      </header>
      <p className={css.question}>{node.data.text}</p>
      <p className={css.hint}>{t('drill.answerDraftReview')}</p>
    </article>
  )
}

/** Show the recorded verdict and feedback after the learner has answered. */
export function DrillJudgmentCard({ node, t, openDerivedError }: DrillJudgmentProps) {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  async function open(): Promise<void> {
    if (pending) return
    setPending(true)
    setFailed(false)
    try {
      if (!await openDerivedError(node.data.preparationId)) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }
  return (
    <article className={css.teachCard} aria-label={t('drill.judgment')}>
      <h3 className={css.title}>{t('drill.judgment')}</h3>
      <p className={css.status}>
        {node.data.isCorrect ? t('drill.correct') : t('drill.incorrect')}
      </p>
      <p className={css.teachText}>{node.data.feedback}</p>
      {!node.data.isCorrect && (
        <button className={css.confirmButton} type="button" disabled={pending} onClick={() => { void open() }}>
          {pending ? t('drill.openingDerived') : t('drill.openDerived')}
        </button>
      )}
      {failed && <p role="alert">{t('drill.openFailed')}</p>}
    </article>
  )
}

/** Make the Drill origin visible without presenting copied context as a new user message. */
export function DerivedErrorCard({ node, t }: DerivedErrorProps) {
  return (
    <article className={css.episodeCard} aria-label={t('derived.title')}>
      <h3 className={css.title}>{t('derived.title')}</h3>
      <p className={css.hint}>{t('derived.origin')}</p>
      <p className={css.description}>{t('derived.question')}: {node.data.question}</p>
      <p className={css.description}>{t('derived.answer')}: {node.data.userResponse}</p>
    </article>
  )
}

/** Render recovery guidance when an isolated Drill draft call fails or is cancelled. */
export function DrillDraftCard({ node, t }: DrillDraftCardProps) {
  const { status } = node.data
  return (
    <article className={css.episodeCard} aria-label={t('drill.draftFailed.title')}>
      <header className={css.header}>
        <h3 className={css.title}>{t('drill.draftFailed.title')}</h3>
        <span className={css.status}>
          {status === 'aborted' ? t('drill.draftFailed.statusAborted') : t('drill.draftFailed.statusFailed')}
        </span>
      </header>
      <p className={css.description}>
        {status === 'aborted' ? t('drill.draftFailed.aborted') : t('drill.draftFailed.failed')}
      </p>
    </article>
  )
}
