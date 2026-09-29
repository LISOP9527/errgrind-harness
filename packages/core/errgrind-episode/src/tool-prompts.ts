/** Load the product-owned, model-visible tool copy from one reviewable file. */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

const NAMES = [
  'error_draft', 'error_clarify', 'grill_probe', 'grill_conclude',
  'teach_step', 'drill_prepare', 'drill_answer_draft', 'drill_judge',
] as const

export type ToolPromptName = typeof NAMES[number]

const entrySchema = z.object({
  description: z.array(z.string().trim().min(1)).min(1),
  parameters: z.record(z.string(), z.string().trim().min(1)),
}).strict()

const catalogSchema = z.record(z.enum(NAMES), entrySchema)

/** A bad or missing prompt file must fail boot before the model gets a partial tool surface. */
export function loadToolPrompts(path = process.env.ERRGRIND_TOOL_PROMPTS_PATH
  ?? join(dirname(process.env.ERRGRIND_PROMPT_PATH
    ?? join(process.env.PWD ?? process.cwd(), 'errgrind-fork/prompts/system.md')), 'tools.json')) {
  const catalog = catalogSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  const draftPromptPath = join(dirname(path), 'drill-draft.md')
  const draftPrompt = readFileSync(draftPromptPath, 'utf8').trim()
  if (draftPrompt.length === 0) throw new Error(`Empty Drill draft prompt: ${draftPromptPath}`)
  return {
    description(name: ToolPromptName): string {
      return catalog[name].description.join('\n')
    },
    parameter(name: ToolPromptName, key: string): string {
      const value = catalog[name].parameters[key]
      if (value === undefined) throw new Error(`Missing ${name}.${key} tool prompt in ${path}`)
      return value
    },
    get drillDraftPrompt(): string {
      return draftPrompt
    },
  }
}

export type ToolPrompts = ReturnType<typeof loadToolPrompts>
