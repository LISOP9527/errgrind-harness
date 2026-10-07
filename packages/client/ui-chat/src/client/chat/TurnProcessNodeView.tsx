import { memo, useEffect, useState } from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { isVisibleChatNode } from '../contract/chat-visibility.ts'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { TURN_PROCESS_INDEPENDENT_KINDS, turnProcessAlwaysOpen } from '../contract/turn-process.ts'
import { formatLiveRunDuration, formatRunDuration, LIVE_RUN_CLOCK_INTERVAL_MS } from './message-chrome.ts'
import a11yCss from './accessibility.module.css'
import css from './TurnProcessNodeView.module.css'

/** Node kinds carrying the learner's own input rather than Turn output. */
const TURN_INPUT_KINDS: ReadonlySet<string> = new Set(['user', 'turn-trigger', 'steering'])

/** Turn-level process disclosure controller. */
export const TurnProcessNodeView = memo(function TurnProcessNodeView({
  node, turnProcess, t, useChat,
}: ChatNodeViewProps<'turn-process'>) {
  if (turnProcess === undefined) throw new Error('turn-process node requires Turn process owner state')
  const open = turnProcess.open
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const [now, setNow] = useState(Date.now)
  const ticking = turnProcess.foldable && turn?.status === 'open'
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, LIVE_RUN_CLOCK_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [ticking])
  // A Turn that produced any visible output Node owns a tail row; a Turn made
  // only of learner input does not.
  const hasOutput = useChat((snapshot) => {
    const start = turn?.start?.seq
    const end = turn?.end?.seq
    for (const key of snapshot.order) {
      const candidate = snapshot.nodes.get(key)
      if (candidate === undefined || !isVisibleChatNode(candidate as ChatNode)) continue
      if (TURN_PROCESS_INDEPENDENT_KINDS.has(candidate.kind)) continue
      if (TURN_INPUT_KINDS.has(candidate.kind)) continue
      const location = candidate.location
      if (location.kind === 'turn' || location.kind === 'step') {
        if (location.turn.turn !== node.data.turn) continue
      } else if (start === undefined
        || candidate.anchorSeq < start
        || (end !== undefined && candidate.anchorSeq > end)) continue
      return true
    }
    return false
  })
  if (!turnProcess.foldable) return null
  const canCollapse = turnProcess.hasContent && !turnProcessAlwaysOpen(node)
  const running = turn?.status === 'open'
  const reason = turn?.end?.data.reason.kind
  // A Turn that closed quietly — no process evidence and no visible output — owns no tail row.
  if (!running && reason !== 'aborted' && reason !== 'error'
    && !turnProcess.hasContent && !hasOutput) return null
  const elapsedMs = turn?.start === undefined ? undefined
    : Math.max(1000, (turn.end?.time ?? now) - turn.start.time)
  const duration = elapsedMs === undefined ? undefined
    : running ? formatLiveRunDuration(elapsedMs, t) : formatRunDuration(elapsedMs, t)
  // Other end reasons retain elapsed time; only cancellation and failure replace it.
  const label = running
    ? duration === undefined ? t('chat.deepDiving') : t('message.turnProcess.deepDivingFor', { duration })
    : reason === 'aborted' ? t('message.stopped')
      : reason === 'error' ? t('message.turnProcess.failed')
        : duration === undefined ? t('message.turnProcess.worked')
          : t('message.turnProcess.took', { duration })
  const announcement = running ? t('chat.deepDiving')
    : reason === 'aborted' ? t('message.stopped')
      : reason === 'error' ? t('message.turnProcess.failed')
        : t('message.turnProcess.worked')
  return (
    <>
      <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      <button
        type="button"
        className={css.root}
        data-open={open || undefined}
        data-turn-process={node.data.turn}
        data-turn-process-messages={node.data.messageCount}
        data-turn-process-tool-calls={node.data.toolCallCount}
        data-turn-process-subagents={node.data.subagentCount}
        disabled={!canCollapse}
        aria-expanded={turnProcess.hasContent ? open : undefined}
        onClick={(event) => {
          event.currentTarget.focus()
          turnProcess.setOpen(!open)
        }}
      >
        <span className={css.label}>{label}</span>
        {canCollapse && <IconChevronDownOutlineRegular className={css.chevron} />}
      </button>
    </>
  )
})
