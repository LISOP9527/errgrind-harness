import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
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

/**
 * Localized code-fence and footnote chrome for ErrGrind card prose. The keys
 * live in the shared common vocabulary, which every namespace's `t` reaches
 * through its fallback chain.
 */
function markdownLabels(t: TranslateNS<typeof NS>): MarkdownLabels {
  return {
    code: {
      copyLabel: t('copy'),
      copiedLabel: t('copied'),
      toolbarLabels: {
        codeLabel: t('codeBlock.title'),
        wrapLabel: t('codeBlock.wrap'),
        unwrapLabel: t('codeBlock.unwrap'),
      },
    },
    footnotes: t('markdown.footnotes'),
  }
}

/**
 * Author-facing question or notice: a quiet bordered block with a plain-word
 * label. Authoring prompts keep the frame; model output below flows inline.
 */
function PromptBlock({ label, hint, children }: {
  label: string
  hint?: string | undefined
  children: ReactNode
}) {
  return (
    <div className={css.promptBlock}>
      <span className={css.cardLabel}>{label}</span>
      {children}
      {hint !== undefined && <p className={css.hint}>{hint}</p>}
    </div>
  )
}

/** Render the current full Error description and its public investigation state. */
export function ErrorEpisodeCard({ node, t, confirmRevision }: ErrorCardProps) {
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState('')
  const labels = useMemo(() => markdownLabels(t), [t])
  const description = node.data

  async function confirm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
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
        <span className={css.status} aria-live="polite">{status}</span>
      </header>
      <MarkdownText text={description.description} labels={labels} />
      {!description.confirmed && (
        <p className={css.hint}>
          {description.diagnosisStatus === null ? t('card.reviseHint') : t('card.pendingProposalHint')}
        </p>
      )}
      <footer className={css.footer}>
        <span className={css.statusLine}>
          {description.probeCount === 1
            ? t('card.grillProgressOne')
            : description.probeCount > 1
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
          <MarkdownText text={description.summary} labels={labels} />
          {description.remainingUncertainty !== null && (
            <>
              <span className={css.uncertaintyLabel}>{t('card.remainingUncertainty')}</span>
              <MarkdownText text={description.remainingUncertainty} labels={labels} />
            </>
          )}
        </section>
      )}
    </article>
  )
}

/** Render one public Grill prompt in its chronological position. */
export function GrillQuestionCard({ node, t }: GrillQuestionProps) {
  const labels = useMemo(() => markdownLabels(t), [t])
  return (
    <PromptBlock label={t('question.label')}>
      <MarkdownText text={node.data.question} labels={labels} />
    </PromptBlock>
  )
}

/** Render one durable intake clarification at its chronological position. */
export function IntakeClarificationCard({ node, t }: IntakeClarificationProps) {
  const labels = useMemo(() => markdownLabels(t), [t])
  return (
    <PromptBlock label={t('clarification.label')}>
      <MarkdownText text={node.data.text} labels={labels} />
    </PromptBlock>
  )
}

/** Render one public Teach step as ordinary agent prose — no card chrome. */
export function TeachStepCard({ node, t }: TeachStepProps) {
  const labels = useMemo(() => markdownLabels(t), [t])
  return (
    <div className={css.flow}>
      <MarkdownText text={node.data.text} labels={labels} />
    </div>
  )
}

/** Show a new practice question without the private specification or answer. */
export function DrillQuestionCard({ node, t }: DrillQuestionProps) {
  const labels = useMemo(() => markdownLabels(t), [t])
  return (
    <PromptBlock label={t('drill.question')}>
      <MarkdownText text={node.data.question} labels={labels} />
    </PromptBlock>
  )
}

/** Show a transcribed image answer for explicit learner review before judging. */
export function DrillAnswerDraftCard({ node, t }: DrillAnswerDraftProps) {
  const labels = useMemo(() => markdownLabels(t), [t])
  return (
    <PromptBlock label={t('drill.answerDraft')} hint={t('drill.answerDraftReview')}>
      <MarkdownText text={node.data.text} labels={labels} />
    </PromptBlock>
  )
}

/** Show the recorded verdict and feedback after the learner has answered. */
export function DrillJudgmentCard({ node, t, openDerivedError }: DrillJudgmentProps) {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const labels = useMemo(() => markdownLabels(t), [t])
  async function open(): Promise<void> {
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
    <div className={css.flow}>
      <p className={css.verdict} data-correct={node.data.isCorrect || undefined}>
        {node.data.isCorrect ? t('drill.correct') : t('drill.incorrect')}
      </p>
      <MarkdownText text={node.data.feedback} labels={labels} />
      {!node.data.isCorrect && (
        <button className={css.confirmButton} type="button" disabled={pending} onClick={() => { void open() }}>
          {pending ? t('drill.openingDerived') : t('drill.openDerived')}
        </button>
      )}
      {failed && <p role="alert">{t('drill.openFailed')}</p>}
    </div>
  )
}

/** Make the Drill origin visible without presenting copied context as a new user message. */
export function DerivedErrorCard({ node, t }: DerivedErrorProps) {
  const labels = useMemo(() => markdownLabels(t), [t])
  return (
    <PromptBlock label={t('derived.title')} hint={t('derived.origin')}>
      <MarkdownText
        text={`**${t('derived.question')}**\n\n${node.data.question}\n\n**${t('derived.answer')}**\n\n${node.data.userResponse}`}
        labels={labels}
      />
    </PromptBlock>
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
