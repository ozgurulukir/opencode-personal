import { BusEvent } from "@/bus/bus-event"
import { SessionID, MessageID, PartID } from "./schema"
import { NamedError } from "@opencode-ai/core/util/error"
import { APICallError, convertToModelMessages, LoadAPIKeyError, type ModelMessage, type UIMessage } from "ai"
import { SyncEvent } from "../sync"
import { Database } from "@/storage/db"
import { NotFoundError } from "@/storage/storage"
import { and } from "drizzle-orm"
import { asc } from "drizzle-orm"
import { desc } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { inArray } from "drizzle-orm"
import { lt } from "drizzle-orm"
import { or } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { MessageTable, PartTable, SessionTable } from "./session.sql"
import * as ProviderError from "@/provider/error"
import { iife } from "@/util/iife"
import { errorMessage } from "@/util/error"
import { isMedia } from "@/util/media"
import type { SystemError } from "bun"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { ProviderTransform } from "@/provider/transform"
import { Effect, Schema } from "effect"
import { zod } from "@opencode-ai/core/effect-zod"
import { NonNegativeInt, withStatics } from "@opencode-ai/core/schema"
import * as EffectLogger from "@opencode-ai/core/effect/logger"

/** Error shape thrown by Bun's fetch() when gzip/br decompression fails mid-stream */
interface FetchDecompressionError extends Error {
  code: "ZlibError"
  errno: number
  path: string
}

export const SYNTHETIC_ATTACHMENT_PROMPT = "Attached media from tool result:"
export { isMedia }

export * from "./message.schema"

// Runtime-only helpers not in message.schema.ts
function truncateToolOutput(text: string, maxChars?: number) {
  if (!maxChars || text.length <= maxChars) return text
  const omitted = text.length - maxChars
  return `${text.slice(0, maxChars)}\n[Tool output truncated for compaction: omitted ${omitted} chars]`
}

// Import symbols from message.schema.ts used by runtime code below
import { Info, Part, Assistant, CompactionPart } from "./message.schema"
import { AbortedError, APIError, AuthError, ContextOverflowError, OutputLengthError } from "./message.schema"

const UpdatedEventSchema = Schema.Struct({
  sessionID: SessionID,
  info: Info,
})

const RemovedEventSchema = Schema.Struct({
  sessionID: SessionID,
  messageID: MessageID,
})

const PartUpdatedEventSchema = Schema.Struct({
  sessionID: SessionID,
  part: Part,
  time: NonNegativeInt,
})

const PartUpdatedBatchEventSchema = Schema.Struct({
  sessionID: SessionID,
  parts: Schema.Array(Part),
  time: NonNegativeInt,
})

const MessageUpdatedBatchEventSchema = Schema.Struct({
  sessionID: SessionID,
  infos: Schema.Array(Info),
  time_created: NonNegativeInt,
})

const PartRemovedEventSchema = Schema.Struct({
  sessionID: SessionID,
  messageID: MessageID,
  partID: PartID,
})

export const Event = {
  Updated: SyncEvent.define({
    type: "message.updated",
    version: 1,
    aggregate: "sessionID",
    schema: UpdatedEventSchema,
  }),
  Removed: SyncEvent.define({
    type: "message.removed",
    version: 1,
    aggregate: "sessionID",
    schema: RemovedEventSchema,
  }),
  PartUpdated: SyncEvent.define({
    type: "message.part.updated",
    version: 1,
    aggregate: "sessionID",
    schema: PartUpdatedEventSchema,
  }),
  PartUpdatedBatch: SyncEvent.define({
    type: "message.part.updated.batch",
    version: 1,
    aggregate: "sessionID",
    schema: PartUpdatedBatchEventSchema,
  }),
  PartDelta: BusEvent.define(
    "message.part.delta",
    Schema.Struct({
      sessionID: SessionID,
      messageID: MessageID,
      partID: PartID,
      field: Schema.String,
      delta: Schema.String,
    }),
  ),
  PartRemoved: SyncEvent.define({
    type: "message.part.removed",
    version: 1,
    aggregate: "sessionID",
    schema: PartRemovedEventSchema,
  }),
  MessageUpdatedBatch: SyncEvent.define({
    type: "message.updated.batch",
    version: 1,
    aggregate: "sessionID",
    schema: MessageUpdatedBatchEventSchema,
  }),
}

export const WithParts = Schema.Struct({
  info: Info,
  parts: Schema.Array(Part),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type WithParts = {
  info: Info
  parts: Part[]
}

const Cursor = Schema.Struct({
  id: MessageID,
  time: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
})
type Cursor = typeof Cursor.Type

const decodeCursor = Schema.decodeUnknownSync(Cursor)

export const cursor = {
  encode(input: Cursor) {
    return Buffer.from(JSON.stringify(input)).toString("base64url")
  },
  decode(input: string) {
    return decodeCursor(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

const info = (row: typeof MessageTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
  }) as Info

const part = (row: typeof PartTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id,
  }) as Part

const older = (row: Cursor) =>
  or(lt(MessageTable.time_created, row.time), and(eq(MessageTable.time_created, row.time), lt(MessageTable.id, row.id)))

function hydrate(rows: (typeof MessageTable.$inferSelect)[]) {
  const ids = rows.map((row) => row.id)
  const partByMessage = new Map<string, Part[]>()
  if (ids.length > 0) {
    const partRows = Database.use((db) =>
      db
        .select()
        .from(PartTable)
        .where(inArray(PartTable.message_id, ids))
        .orderBy(PartTable.message_id, PartTable.id)
        .all(),
    )
    for (const row of partRows) {
      const next = part(row)
      const list = partByMessage.get(row.message_id)
      if (list) list.push(next)
      else partByMessage.set(row.message_id, [next])
    }
  }

  return rows.map((row) => ({
    info: info(row),
    parts: partByMessage.get(row.id) ?? [],
  }))
}

function providerMeta(metadata: Record<string, any> | undefined) {
  if (!metadata) return undefined
  const { providerExecuted: _, ...rest } = metadata
  return Object.keys(rest).length > 0 ? rest : undefined
}

export const toModelMessagesEffect = Effect.fnUntraced(function* (
  input: WithParts[],
  model: Provider.Model,
  options?: { stripMedia?: boolean; toolOutputMaxChars?: number },
) {
  const result: UIMessage[] = []
  const toolNames = new Set<string>()
  // Track media from tool results that need to be injected as user messages
  // for providers that don't support that media type in tool results.
  //
  // OpenAI-compatible APIs only support string content in tool results, so we need
  // to extract media and inject as user messages. Some SDKs only support a subset
  // of media in tool results; e.g. Bedrock supports images but not PDFs there.
  //
  // Only apply this workaround if the model actually supports that media input -
  // otherwise unsupportedParts() will turn it into a user-visible error.
  const supportsMediaInToolResult = (attachment: { mime: string }) =>
    ProviderTransform.supportsMediaInToolResult(model, attachment.mime)

  const toModelOutput = (options: { toolCallId: string; input: unknown; output: unknown }) => {
    const output = options.output
    if (typeof output === "string") {
      return { type: "text", value: output }
    }

    if (typeof output === "object") {
      const outputObject = output as {
        text: string
        attachments?: Array<{ mime: string; url: string }>
      }
      const attachments = (outputObject.attachments ?? []).filter((attachment) => {
        return attachment.url.startsWith("data:") && attachment.url.includes(",")
      })

      return {
        type: "content",
        value: [
          ...(outputObject.text ? [{ type: "text", text: outputObject.text }] : []),
          ...attachments.map((attachment) => ({
            type: "media",
            mediaType: attachment.mime,
            data: iife(() => {
              const commaIndex = attachment.url.indexOf(",")
              return commaIndex === -1 ? attachment.url : attachment.url.slice(commaIndex + 1)
            }),
          })),
        ],
      }
    }

    return { type: "json", value: output as never }
  }

  for (const msg of input) {
    if (msg.parts.length === 0) continue

    if (msg.info.role === "user") {
      const userMessage: UIMessage = {
        id: msg.info.id,
        role: "user",
        parts: [],
      }
      for (const part of msg.parts) {
        // User message parts should never be empty
        if (part.type === "text" && !part.ignored && part.text !== "")
          userMessage.parts.push({
            type: "text",
            text: part.text,
          })
        // text/plain and directory files are converted into text parts, ignore them
        if (part.type === "file" && part.mime !== "text/plain" && part.mime !== "application/x-directory") {
          if (options?.stripMedia && isMedia(part.mime)) {
            userMessage.parts.push({
              type: "text",
              text: `[Attached ${part.mime}: ${part.filename ?? "file"}]`,
            })
          } else {
            userMessage.parts.push({
              type: "file",
              url: part.url,
              mediaType: part.mime,
              filename: part.filename,
            })
          }
        }

        if (part.type === "compaction") {
          userMessage.parts.push({
            type: "text",
            text: "What did we do so far?",
          })
        }
        if (part.type === "subtask") {
          userMessage.parts.push({
            type: "text",
            text: "The following tool was executed by the user",
          })
        }
      }
      if (userMessage.parts.length > 0) result.push(userMessage)
    }

    if (msg.info.role === "assistant") {
      const differentModel = `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`
      const media: Array<{ mime: string; url: string; filename?: string }> = []

      if (
        msg.info.error &&
        !(
          AbortedError.isInstance(msg.info.error) &&
          msg.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
        )
      ) {
        continue
      }
      const assistantMessage: UIMessage = {
        id: msg.info.id,
        role: "assistant",
        parts: [],
      }
      // Anthropic adaptive thinking can persist assistant turns like:
      // step-start, reasoning(signature), text(""), step-start,
      // reasoning(signature). The empty text part is a structural separator,
      // but it does not carry the signature metadata itself. Dropping it shifts
      // signed thinking positions after step-start splitting/provider regrouping;
      // keeping it as "" is filtered by the AI SDK and rejected by Anthropic.
      // It is unclear whether this shape originates in our stream processing,
      // a proxy, or a lower-level library, but preserving a non-empty separator
      // here is the only safe replay point we have.
      // Use a single space so the separator survives replay without changing
      // the neighboring signed reasoning blocks.
      const hasSignedReasoning = msg.parts.some((part) => {
        if (part.type !== "reasoning") return false
        return part.metadata?.anthropic?.signature != null
      })
      for (const part of msg.parts) {
        if (part.type === "text") {
          const text = part.text === "" && hasSignedReasoning ? " " : part.text
          assistantMessage.parts.push({
            type: "text",
            text,
            ...(differentModel ? {} : { providerMetadata: part.metadata }),
          })
        }
        if (part.type === "step-start")
          assistantMessage.parts.push({
            type: "step-start",
          })
        if (part.type === "tool") {
          toolNames.add(part.tool)
          if (part.state.status === "completed") {
            const outputText = part.state.time.compacted
              ? "[Old tool result content cleared]"
              : truncateToolOutput(part.state.output, options?.toolOutputMaxChars)
            const attachments = part.state.time.compacted || options?.stripMedia ? [] : (part.state.attachments ?? [])

            // For providers that don't support media in tool results, extract media files
            // (images, PDFs) to be sent as a separate user message
            // ⚡ Bolt Optimization: Replace multiple .filter() calls with a single loop to reduce GC pressure and O(N) traversals
            const extractedMedia: typeof attachments = []
            const finalAttachments: typeof attachments = []
            for (let i = 0; i < attachments.length; i++) {
              const a = attachments[i]
              if (isMedia(a.mime) && !supportsMediaInToolResult(a)) {
                extractedMedia.push(a)
              } else {
                finalAttachments.push(a)
              }
            }
            if (extractedMedia.length > 0) {
              media.push(...extractedMedia)
            }

            const output =
              finalAttachments.length > 0
                ? {
                    text: outputText,
                    attachments: finalAttachments,
                  }
                : outputText

            assistantMessage.parts.push({
              type: ("tool-" + part.tool) as `tool-${string}`,
              state: "output-available",
              toolCallId: part.callID,
              input: part.state.input,
              output,
              ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
              ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
            })
          }
          if (part.state.status === "error") {
            const output = part.state.metadata?.interrupted === true ? part.state.metadata.output : undefined
            if (typeof output === "string") {
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-available",
                toolCallId: part.callID,
                input: part.state.input,
                output,
                ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
                ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
              })
            } else {
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-error",
                toolCallId: part.callID,
                input: part.state.input,
                errorText: part.state.error,
                ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
                ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
              })
            }
          }
          // Handle pending/running tool calls to prevent dangling tool_use blocks
          // Anthropic/Claude APIs require every tool_use to have a corresponding tool_result
          if (part.state.status === "pending" || part.state.status === "running")
            assistantMessage.parts.push({
              type: ("tool-" + part.tool) as `tool-${string}`,
              state: "output-error",
              toolCallId: part.callID,
              input: part.state.input,
              errorText: "[Tool execution was interrupted]",
              ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
              ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
            })
        }
        if (part.type === "reasoning") {
          if (differentModel) {
            if (part.text.trim().length > 0)
              assistantMessage.parts.push({
                type: "text",
                text: part.text,
              })
            continue
          }
          assistantMessage.parts.push({
            type: "reasoning",
            text: part.text,
            providerMetadata: part.metadata,
          })
        }
      }
      if (assistantMessage.parts.length > 0) {
        result.push(assistantMessage)
        // Inject pending media as a user message for providers that don't support
        // media (images, PDFs) in tool results
        if (media.length > 0) {
          result.push({
            id: MessageID.ascending(),
            role: "user",
            parts: [
              {
                type: "text" as const,
                text: SYNTHETIC_ATTACHMENT_PROMPT,
              },
              ...media.map((attachment) => ({
                type: "file" as const,
                url: attachment.url,
                mediaType: attachment.mime,
                filename: attachment.filename,
              })),
            ],
          })
        }
      }
    }
  }

  const tools = Object.fromEntries(Array.from(toolNames).map((toolName) => [toolName, { toModelOutput }]))

  return yield* Effect.promise(() =>
    convertToModelMessages(
      result.filter((msg) => msg.parts.some((part) => part.type !== "step-start")),
      {
        //@ts-expect-error (convertToModelMessages expects a ToolSet but only actually needs tools[name]?.toModelOutput)
        tools,
      },
    ),
  )
})

export function toModelMessages(
  input: WithParts[],
  model: Provider.Model,
  options?: { stripMedia?: boolean; toolOutputMaxChars?: number },
): Promise<ModelMessage[]> {
  return Effect.runPromise(toModelMessagesEffect(input, model, options).pipe(Effect.provide(EffectLogger.layer)))
}

export function page(input: { sessionID: SessionID; limit: number; before?: string }) {
  const before = input.before ? cursor.decode(input.before) : undefined
  const where = before
    ? and(eq(MessageTable.session_id, input.sessionID), older(before))
    : eq(MessageTable.session_id, input.sessionID)
  const rows = Database.use((db) =>
    db
      .select()
      .from(MessageTable)
      .where(where)
      .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
      .limit(input.limit + 1)
      .all(),
  )
  if (rows.length === 0) {
    const row = Database.use((db) =>
      db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.id, input.sessionID)).get(),
    )
    if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
    return {
      items: [] as WithParts[],
      more: false,
    }
  }

  const more = rows.length > input.limit
  const slice = more ? rows.slice(0, input.limit) : rows
  const items = hydrate(slice)
  items.reverse()
  const tail = slice.at(-1)
  return {
    items,
    more,
    cursor: more && tail ? cursor.encode({ id: tail.id, time: tail.time_created }) : undefined,
  }
}

export function* stream(sessionID: SessionID) {
  const size = 50
  let before: string | undefined
  while (true) {
    const next = page({ sessionID, limit: size, before })
    if (next.items.length === 0) break
    for (let i = next.items.length - 1; i >= 0; i--) {
      yield next.items[i]
    }
    if (!next.more || !next.cursor) break
    before = next.cursor
  }
}

export function parts(message_id: MessageID) {
  const rows = Database.use((db) =>
    db.select().from(PartTable).where(eq(PartTable.message_id, message_id)).orderBy(PartTable.id).all(),
  )
  return rows.map(
    (row) =>
      ({
        ...row.data,
        id: row.id,
        sessionID: row.session_id,
        messageID: row.message_id,
      }) as Part,
  )
}

// Cheap existence check used by summarize's early-return (replaces reading all messages).
export function hasMessages(sessionID: SessionID): boolean {
  const row = Database.use((db) =>
    db.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.session_id, sessionID)).limit(1).get(),
  )
  return row !== undefined
}

// Session-wide diff boundaries: the first `step-start` part snapshot (immutable after
// step 1) and the last `step-finish` part snapshot. Replaces scanning every message.
export function boundarySnapshots(sessionID: SessionID): { from?: string; to?: string } {
  const pick = (type: string, direction: "asc" | "desc") =>
    Database.use((db) =>
      db
        .select({ snapshot: sql<string | null>`${PartTable.data}->>'$.snapshot'`.as("snapshot") })
        .from(PartTable)
        .where(
          and(
            eq(PartTable.session_id, sessionID),
            sql`${PartTable.data}->>'$.type' = ${type}`,
            sql`${PartTable.data}->>'$.snapshot' IS NOT NULL`,
          ),
        )
        .orderBy(direction === "asc" ? asc(PartTable.id) : desc(PartTable.id))
        .limit(1)
        .get(),
    )
  const fromRow = pick("step-start", "asc")
  const toRow = pick("step-finish", "desc")
  return { from: fromRow?.snapshot ?? undefined, to: toRow?.snapshot ?? undefined }
}

// The target user message + its assistant children (one turn), used for per-turn diffs.
// Replaces `messages()` (full history) + filter.
export function messagesForSummary(input: { sessionID: SessionID; messageID: MessageID }): WithParts[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(MessageTable)
      .where(
        and(
          eq(MessageTable.session_id, input.sessionID),
          or(
            eq(MessageTable.id, input.messageID),
            and(
              sql`${MessageTable.data}->>'$.role' = 'assistant'`,
              sql`${MessageTable.data}->>'$.parentID' = ${input.messageID}`,
            ),
          ),
        ),
      )
      .orderBy(MessageTable.time_created, MessageTable.id)
      .all(),
  )
  return hydrate(rows)
}

export function get(input: { sessionID: SessionID; messageID: MessageID }): WithParts {
  const row = Database.use((db) =>
    db
      .select()
      .from(MessageTable)
      .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
      .get(),
  )
  if (!row) throw new NotFoundError({ message: `Message not found: ${input.messageID}` })
  return {
    info: info(row),
    parts: parts(input.messageID),
  }
}

export function filterCompacted(msgs: Iterable<WithParts>) {
  const result = [] as WithParts[]
  const completed = new Set<string>()
  let retain: MessageID | undefined
  for (const msg of msgs) {
    result.push(msg)
    if (retain) {
      if (msg.info.id === retain) break
      continue
    }
    if (msg.info.role === "user" && completed.has(msg.info.id)) {
      const part = msg.parts.find((item): item is CompactionPart => item.type === "compaction")
      if (!part) continue
      if (!part.tail_start_id) break
      retain = part.tail_start_id
      if (msg.info.id === retain) break
      continue
    }
    if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish && !msg.info.error)
      completed.add(msg.info.parentID)
  }
  result.reverse()
  const compactionIndex = result.findLastIndex(
    (msg) =>
      msg.info.role === "user" &&
      msg.parts.some((item): item is CompactionPart => item.type === "compaction" && item.tail_start_id !== undefined),
  )
  const compaction = result[compactionIndex]
  const part = compaction?.parts.find(
    (item): item is CompactionPart => item.type === "compaction" && item.tail_start_id !== undefined,
  )
  const summaryIndex = compaction
    ? result.findIndex(
        (msg, index) =>
          index > compactionIndex &&
          msg.info.role === "assistant" &&
          msg.info.summary &&
          msg.info.parentID === compaction.info.id,
      )
    : -1
  const tailIndex = part?.tail_start_id ? result.findIndex((msg) => msg.info.id === part.tail_start_id) : -1
  if (tailIndex >= 0 && tailIndex < compactionIndex && summaryIndex > compactionIndex) {
    return [
      ...result.slice(compactionIndex, summaryIndex + 1),
      ...result.slice(tailIndex, compactionIndex),
      ...result.slice(summaryIndex + 1),
    ]
  }
  return result
}

export const filterCompactedEffect = Effect.fnUntraced(function* (sessionID: SessionID) {
  return filterCompacted(stream(sessionID))
})

function handleAbortError(e: DOMException): NonNullable<Assistant["error"]> {
  return new AbortedError({ message: e.message }, { cause: e }).toObject()
}

function handleOutputLengthError(e: unknown): NonNullable<Assistant["error"]> {
  return e as NonNullable<Assistant["error"]>
}

function handleLoadAPIKeyError(e: LoadAPIKeyError, providerID: ProviderID): NonNullable<Assistant["error"]> {
  return new AuthError({ providerID, message: e.message }, { cause: e }).toObject()
}

function handleECONNRESET(e: SystemError): NonNullable<Assistant["error"]> {
  return new APIError(
    {
      message: "Connection reset by server",
      isRetryable: true,
      metadata: {
        code: e.code ?? "",
        syscall: e.syscall ?? "",
        message: e.message ?? "",
      },
    },
    { cause: e },
  ).toObject()
}

function handleZlibError(e: FetchDecompressionError, aborted?: boolean): NonNullable<Assistant["error"]> {
  if (aborted) {
    return new AbortedError({ message: e.message }, { cause: e }).toObject()
  }
  return new APIError(
    {
      message: "Response decompression failed",
      isRetryable: true,
      metadata: {
        code: e.code,
        message: e.message,
      },
    },
    { cause: e },
  ).toObject()
}

function handleAPICallError(e: APICallError, providerID: ProviderID): NonNullable<Assistant["error"]> {
  const parsed = ProviderError.parseAPICallError({
    providerID,
    error: e,
  })
  if (parsed.type === "context_overflow") {
    return new ContextOverflowError(
      {
        message: parsed.message,
        responseBody: parsed.responseBody,
      },
      { cause: e },
    ).toObject()
  }

  return new APIError(
    {
      message: parsed.message,
      statusCode: parsed.statusCode,
      isRetryable: parsed.isRetryable,
      responseHeaders: parsed.responseHeaders,
      responseBody: parsed.responseBody,
      metadata: parsed.metadata,
    },
    { cause: e },
  ).toObject()
}

function handleGenericError(e: Error): NonNullable<Assistant["error"]> {
  return new NamedError.Unknown({ message: errorMessage(e) }, { cause: e }).toObject()
}

function handleUnknownError(e: unknown): NonNullable<Assistant["error"]> {
  try {
    const parsed = ProviderError.parseStreamError(e)
    if (parsed) {
      if (parsed.type === "context_overflow") {
        return new ContextOverflowError(
          {
            message: parsed.message,
            responseBody: parsed.responseBody,
          },
          { cause: e },
        ).toObject()
      }
      return new APIError(
        {
          message: parsed.message,
          isRetryable: parsed.isRetryable,
          responseBody: parsed.responseBody,
        },
        { cause: e },
      ).toObject()
    }
  } catch {}
  return new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e }).toObject()
}

export function fromError(
  e: unknown,
  ctx: { providerID: ProviderID; aborted?: boolean },
): NonNullable<Assistant["error"]> {
  if (e instanceof DOMException && e.name === "AbortError") return handleAbortError(e)
  if (OutputLengthError.isInstance(e)) return handleOutputLengthError(e)
  if (LoadAPIKeyError.isInstance(e)) return handleLoadAPIKeyError(e, ctx.providerID)
  if ((e as SystemError)?.code === "ECONNRESET") return handleECONNRESET(e as SystemError)
  if (e instanceof Error && (e as FetchDecompressionError).code === "ZlibError")
    return handleZlibError(e as FetchDecompressionError, ctx.aborted)
  if (APICallError.isInstance(e)) return handleAPICallError(e, ctx.providerID)
  if (e instanceof Error) return handleGenericError(e)
  return handleUnknownError(e)
}

export * as MessageV2 from "./message-v2"
