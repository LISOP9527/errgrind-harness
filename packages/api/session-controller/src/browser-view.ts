/** Optional public Session journal view for products with private model state. */

import type { AttachmentIdType, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { AssistantStreamRecord, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SurfaceEvent } from '@deepseek-ai/dsh-session'
import { isJsonValue, snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionAssistantStreamBaseline, SessionWireEvent } from './types.ts'

/** Host policy applied before Session history, projections, or assistant frames reach a browser. */
export interface BrowserViewPolicy {
  /** Session event types replaced by an ignorable browser placeholder. */
  readonly privateEventTypes?: string[]
  /** User-role context sources that the Host may send to the model but not present as learner messages. */
  readonly privateMessageSourceKinds?: string[]
  /** If set, every other Session event is replaced by a placeholder. */
  readonly allowedEventTypes?: string[]
  /** Data paths retained for each event in the strict allowlist. */
  readonly publicEventFields?: Record<string, string[]>
  /** Projection keys exposed by history, list hints, and live control. */
  readonly allowedProjectionKeys?: string[]
  /** Recursively remove these object properties from allowed event data. */
  readonly redactDataKeys?: string[]
  /** Remove tool-call arguments from durable messages, history, and live frames. */
  readonly redactToolArguments?: boolean
  /** Remove Assistant reasoning blocks and deltas from browser output. */
  readonly redactAssistantReasoning?: boolean
  /** Do not send any live or reconnect Assistant stream data. */
  readonly hideAssistantStream?: boolean
}

function jsonData(value: unknown): JsonValue {
  const json = snapshotJsonValue(value)
  if (!isJsonSnapshot(json)) throw new TypeError('Browser event data must be JSON')
  return json
}

function isJsonSnapshot(value: unknown): value is JsonValue {
  return isJsonValue(value)
}

function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPath(value: JsonValue, path: readonly string[]): JsonValue | undefined {
  let current: JsonValue | undefined = value
  for (const segment of path) {
    if (!isJsonObject(current) || !Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

function assignPath(target: { [key: string]: JsonValue }, path: readonly string[], value: JsonValue): void {
  let current = target
  for (const segment of path.slice(0, -1)) {
    const existing = current[segment]
    if (isJsonObject(existing)) {
      current = existing
    } else {
      const nested: { [key: string]: JsonValue } = {}
      current[segment] = nested
      current = nested
    }
  }
  const leaf = path.at(-1)
  if (leaf !== undefined) current[leaf] = value
}

function sanitizeJson(value: JsonValue, redactedKeys: ReadonlySet<string>): JsonValue {
  if (Array.isArray(value)) return value.map(item => sanitizeJson(item, redactedKeys))
  if (!isJsonObject(value)) return value
  const output = Object.create(null) as { [key: string]: JsonValue }
  for (const [key, nested] of Object.entries(value)) {
    if (redactedKeys.has(key)) continue
    output[key] = sanitizeJson(nested, redactedKeys)
  }
  return output
}

function projectedData(event: SessionEvent, policy: BrowserViewPolicy): JsonValue {
  const data = jsonData(event.data)
  const fields = policy.publicEventFields?.[event.type] ?? []
  const output: { [key: string]: JsonValue } = {}
  for (const field of fields) {
    const path = field.split('.')
    // The policy is deployment configuration, but still reject prototype paths
    // so a malformed overlay cannot mutate the projection object.
    if (path.some(segment => segment.length === 0 || ['__proto__', 'prototype', 'constructor'].includes(segment))) continue
    const value = readPath(data, path)
    if (value !== undefined) assignPath(output, path, value)
  }
  if (event.type === 'user/message' && fields.includes('content') && Array.isArray(output.content)) {
    output.content = publicMessageContent(output.content, event.seq)
  }
  return sanitizeJson(output, new Set(policy.redactDataKeys ?? []))
}

/** Preserve only the structural surface metadata required to reconstruct visible messages. */
function publicSurfaceMetadata(event: SessionEvent): Pick<SurfaceEvent, 'surfaceOp' | 'sourceEventSeqs'> | Record<string, never> {
  if (!['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'].includes(event.type)) return {}
  const surface = event as SurfaceEvent
  const surfaceOp = typeof surface.surfaceOp === 'string' ? surface.surfaceOp : { ...surface.surfaceOp }
  if (surface.sourceEventSeqs === undefined) return { surfaceOp }
  return { surfaceOp, sourceEventSeqs: [...surface.sourceEventSeqs] }
}

/**
 * Return a non-storage locator for an image or file in one public Session event.
 * @param seq - sequence number of the public message event.
 * @param contentIndex - position of the attachment in that message.
 * @returns a browser-visible event-position locator.
 */
export function browserAttachmentId(seq: number, contentIndex: number): string {
  return `browser-event:${String(seq)}:${String(contentIndex)}`
}

/**
 * Keep browser image metadata public while dropping product-owned reference extensions.
 * @param ref - stored Host image reference.
 * @param publicId - session-scoped browser locator.
 * @returns image metadata without storage receipts or extensions.
 */
export function browserImageAttachment(ref: ImageAttachmentRef, publicId: AttachmentIdType): ImageAttachmentRef {
  return {
    attachmentId: publicId,
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...(ref.name === undefined ? {} : { name: ref.name }),
    ...(ref.originalDimensions === undefined ? {} : {
      originalDimensions: { width: ref.originalDimensions.width, height: ref.originalDimensions.height },
    }),
  }
}

/**
 * Parse a public attachment locator without accepting partial or non-canonical numbers.
 * @param value - locator supplied by the browser.
 * @returns event position, or undefined for an invalid locator.
 */
export function parseBrowserAttachmentId(value: string): { seq: number; contentIndex: number } | undefined {
  const match = /^browser-event:(0|[1-9]\d*):(0|[1-9]\d*)$/u.exec(value)
  if (match === null) return undefined
  const seq = Number(match[1])
  const contentIndex = Number(match[2])
  if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(contentIndex)) return undefined
  return { seq, contentIndex }
}

function publicMessageContent(content: readonly JsonValue[], seq: number): JsonValue[] {
  const output: JsonValue[] = []
  for (const [index, value] of content.entries()) {
    if (!isJsonObject(value)) continue
    if (value.type === 'text' && typeof value.text === 'string') {
      output.push({ type: 'text', text: value.text })
      continue
    }
    if ((value.type !== 'image' && value.type !== 'file') || !isJsonObject(value.attachment)) continue
    const source = value.attachment
    const attachment: { [key: string]: JsonValue } = {
      attachmentId: browserAttachmentId(seq, index),
    }
    for (const key of ['name', 'bytes', 'mediaType', 'width', 'height'] as const) {
      const field = source[key]
      if (typeof field === 'string' || typeof field === 'number') attachment[key] = field
    }
    output.push({ type: value.type, attachment })
  }
  return output
}

/**
 * Keep sequence positions while withholding internal event payloads.
 * @param event - committed Host event.
 * @param policy - public journal policy.
 * @returns browser event at the original sequence position.
 */
export function browserEvent(event: SessionEvent, policy: BrowserViewPolicy): SessionWireEvent {
  if (policy.privateEventTypes?.includes(event.type)
    || (event.type === 'user/message' && policy.privateMessageSourceKinds?.includes(event.data.source.kind))
    || (policy.allowedEventTypes !== undefined && !policy.allowedEventTypes.includes(event.type))) {
    return { type: 'browser/private', seq: event.seq, time: event.time, data: {}, ignorable: true }
  }
  if (policy.allowedEventTypes !== undefined) {
    return {
      type: event.type,
      seq: event.seq,
      time: event.time,
      data: projectedData(event, policy),
      ...publicSurfaceMetadata(event),
      ...event.ignorable === true ? { ignorable: true as const } : {},
    }
  }
  if (event.type === 'tool/call' && policy.redactToolArguments) {
    return { ...event, data: { ...event.data, arguments: '{}' } }
  }
  if (event.type === 'assistant/message') {
    return {
      ...event,
      data: jsonData({
        ...event.data,
        message: {
          ...event.data.message,
          content: event.data.message.content.map((block) => {
            if (block.type === 'tool-call' && policy.redactToolArguments) return { ...block, arguments: '{}' }
            if (block.type === 'reasoning' && policy.redactAssistantReasoning) return { ...block, text: '' }
            return block
          }),
        },
        stream: event.data.stream.map(record => browserStreamRecord(record, policy)),
      }),
    }
  }
  if (event.type === 'assistant/attempt') {
    return { ...event, data: jsonData({ ...event.data, stream: event.data.stream.map(record => browserStreamRecord(record, policy)) }) }
  }
  if (event.type === 'tool/result' && policy.redactToolArguments && event.data.meta !== undefined) {
    const { meta: _meta, ...data } = event.data
    return { ...event, data: jsonData(data) }
  }
  return event as SessionWireEvent
}

/**
 * Restrict the opaque projection registry to the selected public capabilities.
 * @param values - validated Host projection values.
 * @param policy - public journal policy.
 * @returns selected projection keys, or the original values when no allowlist is configured.
 */
export function browserProjectionValues(
  values: object,
  policy?: BrowserViewPolicy,
): typeof values {
  const keys = policy?.allowedProjectionKeys
  if (keys === undefined) return values
  const output = Object.create(null) as typeof values
  for (const key of keys) {
    if (!Object.hasOwn(values, key)) continue
    const value: unknown = Reflect.get(values, key)
    Object.defineProperty(output, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return output
}

/**
 * Remove private deltas while preserving frame indexes and stream structure.
 * @param chunk - Host Assistant chunk.
 * @param policy - public journal policy.
 * @returns projected browser chunk.
 */
export function browserChunk(chunk: StreamChunk, policy: BrowserViewPolicy): StreamChunk {
  if (chunk.type === 'tool-call-delta' && policy.redactToolArguments) {
    return { ...chunk, argumentsDelta: '' }
  }
  if (chunk.type === 'reasoning-delta' && policy.redactAssistantReasoning) {
    return { ...chunk, text: '' }
  }
  if (chunk.type === 'block-end') {
    if (chunk.block.type === 'tool-call' && policy.redactToolArguments) {
      return { ...chunk, block: { ...chunk.block, arguments: '{}' } }
    }
    if (chunk.block.type === 'reasoning' && policy.redactAssistantReasoning) {
      return { ...chunk, block: { ...chunk.block, text: '' } }
    }
  }
  return chunk
}

/**
 * Project compact durable and reconnect streams with the same rule as live chunks.
 * @param record - compact Host stream member.
 * @param policy - public journal policy.
 * @returns projected compact member.
 */
export function browserStreamRecord(record: AssistantStreamRecord, policy: BrowserViewPolicy): AssistantStreamRecord {
  if (record.type === 'tool-call-chunks' && policy.redactToolArguments) {
    return { ...record, args: record.args.map(() => '') }
  }
  if (record.type === 'reasoning-chunks' && policy.redactAssistantReasoning) {
    return { ...record, texts: record.texts.map(() => '') }
  }
  if (record.type === 'chunk') return { ...record, chunk: browserChunk(record.chunk, policy) }
  return record
}

/**
 * Project a reconnect baseline without changing its revision or dense index.
 * @param baseline - latest Host stream snapshot.
 * @param policy - public journal policy.
 * @returns browser reconnect baseline.
 */
export function browserAssistantBaseline(
  baseline: SessionAssistantStreamBaseline,
  policy: BrowserViewPolicy,
): SessionAssistantStreamBaseline {
  if (policy.hideAssistantStream || baseline.activeAttempt === undefined) return { revision: baseline.revision }
  return {
    ...baseline,
    activeAttempt: {
      ...baseline.activeAttempt,
      stream: baseline.activeAttempt.stream.map(record => browserStreamRecord(record as AssistantStreamRecord, policy) as JsonValue),
    },
  }
}
