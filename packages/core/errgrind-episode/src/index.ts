/** Session-backed first Error input, model draft, and explicit human confirmation. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ErrorEpisode } from './types.ts'

export type * from './types.ts'

export const name = 'errgrind-episode'
export const inject = ['sessionProjections', 'tools', 'commands']

const MAX_DESCRIPTION_CHARS = 12_000

const episodeSchema: ZodType<ErrorEpisode | null> = zod.union([
  zod.object({
    firstInput: zod.string(),
    firstInputHasImage: zod.boolean(),
    firstInputTurn: zod.number().int().positive(),
    draft: zod.object({ revision: zod.number().int().positive(), text: zod.string().min(1) }).nullable(),
    confirmedRevision: zod.number().int().positive().nullable(),
  }).strict(),
  zod.null(),
])

/** Fold only ErrGrind-owned events; unrelated chat preserves the same state reference. */
export function applyEpisodeEvent(state: ErrorEpisode | null, event: SessionEvent): ErrorEpisode | null {
  switch (event.type) {
    case 'errgrind/error-open':
      if (state !== null) throw new Error('Error episode already open')
      if (event.data.text.length === 0 && !event.data.hasImage) throw new Error('Error input is empty')
      return {
        firstInput: event.data.text,
        firstInputHasImage: event.data.hasImage,
        firstInputTurn: event.data.turn,
        draft: null,
        confirmedRevision: null,
      }
    case 'errgrind/error-draft':
      if (state === null) throw new Error('Error episode is not open')
      if (event.data.revision !== (state.draft?.revision ?? 0) + 1 || event.data.text.trim().length === 0) {
        throw new Error('Error description revision is invalid')
      }
      return { ...state, draft: { revision: event.data.revision, text: event.data.text }, confirmedRevision: null }
    case 'errgrind/error-confirm':
      if (state?.draft == null || state.draft.revision !== event.data.revision) {
        throw new Error('Error description revision is not current')
      }
      if (state.confirmedRevision === event.data.revision) throw new Error('Error description already confirmed')
      return { ...state, confirmedRevision: event.data.revision }
    default:
      return state
  }
}

/** Read the current episode from the committed session projection. */
function currentEpisode(ctx: Context, session: Session): ErrorEpisode | null {
  const state = ctx.sessionProjections.stateOf(session, 'errgrindEpisode')
  if (state === undefined) throw new Error('ErrGrind episode projection is unavailable')
  return state
}

/** Register the first-text intake, draft tool, and human confirmation command. */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register({
    key: 'errgrindEpisode',
    stateSchema: episodeSchema,
    stateVersion: 1,
    init: () => null,
    apply: applyEpisodeEvent,
  })

  // pre-step runs after the inbox is claimed but before its first model call.
  // The domain event is committed separately from DSH's operational chat log.
  ctx.on('agent/pre-step', async ({ agent, turn }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || currentEpisode(ctx, agent.session) !== null) return decision
    const userSourced = decision.messages.find(message => message.source.kind === 'user')
    if (userSourced === undefined) return decision
    const text = userSourced.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    const hasImage = userSourced.content.some(block => block.type === 'image')
    if (text.length !== 0 || hasImage) {
      agent.session.append('errgrind/error-open', { text, hasImage, turn })
    }
    return decision
  })

  ctx.tools.register(defineTool({
    name: 'error_draft',
    description: 'Save a draft of the current mathematics Error as one complete description. '
      + 'Describe only what is known, distinguish the user’s account from your interpretation, '
      + 'and ask the user to review it. This tool cannot confirm the draft for the user.',
    parameters: {
      description: { type: 'string', required: true, description: 'One complete, user-readable Error description.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          revision: { type: 'integer', required: true },
          description: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Error draft #${value.revision}: ${value.description}` }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('error_draft requires an agent session')
      const episode = currentEpisode(ctx, exec.agent.session)
      if (episode === null) throw new Error('No Error input has been recorded')
      const description = args.description.trim()
      if (description.length === 0 || description.length > MAX_DESCRIPTION_CHARS) {
        throw new Error(`Error description must contain 1–${MAX_DESCRIPTION_CHARS} characters`)
      }
      const revision = (episode.draft?.revision ?? 0) + 1
      exec.agent.session.append('errgrind/error-draft', { revision, text: description })
      return Promise.resolve({ revision, description })
    },
    presentCall: args => ({ card: 'generic', title: 'Draft Error', kind: 'other', rawInput: args.description }),
  }))

  ctx.commands.register({
    name: 'error-confirm',
    description: 'Confirm the current Error description after reviewing it',
    handler: (invocation) => {
      if (invocation.rawInput.trim().length !== 0) return { kind: 'error', text: '使用 /error-confirm 确认当前描述。' }
      const session = invocation.agent.session
      const episode = currentEpisode(ctx, session)
      if (episode?.draft == null) return { kind: 'error', text: '请先生成并核对 Error 描述。' }
      if (episode.confirmedRevision === episode.draft.revision) {
        return { kind: 'success', text: '这版 Error 描述已经确认。' }
      }
      // The command registry commits a user-sourced command/run before invoking this handler.
      // Keep its correlation id; historical event scans would break cold-session reads.
      session.append('errgrind/error-confirm', {
        revision: episode.draft.revision,
        commandId: invocation.commandId,
      })
      return { kind: 'success', text: `已确认 Error 描述第 ${episode.draft.revision} 版。` }
    },
  })
}
