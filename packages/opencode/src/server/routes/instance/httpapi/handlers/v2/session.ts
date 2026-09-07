import { WorkspaceID } from "@/control-plane/schema"
import * as InstanceState from "@/effect/instance-state"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { SessionShare } from "@/share/session"
import { SessionV2 } from "@/v2/session"
import { Effect, Schema } from "effect"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"

const DefaultSessionsLimit = 50

const SessionCursor = Schema.Struct({
  id: SessionV2.Info.fields.id,
  time: Schema.Finite,
  order: Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")]),
  direction: Schema.Union([Schema.Literal("previous"), Schema.Literal("next")]),
  directory: Schema.String.pipe(Schema.optional),
  path: Schema.String.pipe(Schema.optional),
  workspaceID: WorkspaceID.pipe(Schema.optional),
  roots: Schema.Boolean.pipe(Schema.optional),
  start: Schema.Finite.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
})
type SessionCursor = typeof SessionCursor.Type

const decodeCursor = Schema.decodeUnknownSync(SessionCursor)

function hasCursorFilter(query: {
  readonly order?: unknown
  readonly path?: unknown
  readonly roots?: unknown
  readonly start?: unknown
  readonly search?: unknown
}) {
  return (
    query.order !== undefined ||
    query.path !== undefined ||
    query.roots !== undefined ||
    query.start !== undefined ||
    query.search !== undefined
  )
}

function hasCursorRoutingMismatch(
  query: { readonly directory?: string; readonly workspace?: string },
  decoded: SessionCursor | undefined,
) {
  if (!decoded) return false
  if (query.directory !== undefined && query.directory !== decoded.directory) return true
  return query.workspace !== undefined && query.workspace !== decoded.workspaceID
}

const sessionCursor = {
  encode(
    session: SessionV2.Info,
    order: "asc" | "desc",
    direction: "previous" | "next",
    filters: Pick<SessionCursor, "directory" | "path" | "workspaceID" | "roots" | "start" | "search">,
  ) {
    return Buffer.from(
      JSON.stringify({ id: session.id, time: session.time.created, order, direction, ...filters }),
    ).toString("base64url")
  },
  decode(input: string) {
    return decodeCursor(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const statusSvc = yield* SessionStatus.Service
    const shareSvc = yield* SessionShare.Service
    const todoSvc = yield* Todo.Service
    const summarySvc = yield* SessionSummary.Service
    const promptSvc = yield* SessionPrompt.Service

    return handlers
      .handle(
        "sessions",
        Effect.fn(function* (ctx) {
          if (ctx.query.cursor && hasCursorFilter(ctx.query)) return yield* new HttpApiError.BadRequest({})
          const decoded = yield* Effect.try({
            try: () => (ctx.query.cursor ? sessionCursor.decode(ctx.query.cursor) : undefined),
            catch: () => new HttpApiError.BadRequest({}),
          })
          if (hasCursorRoutingMismatch(ctx.query, decoded)) return yield* new HttpApiError.BadRequest({})
          const order = decoded?.order ?? ctx.query.order ?? "desc"
          const filters = decoded ?? {
            directory: ctx.query.directory,
            path: ctx.query.path,
            workspaceID: ctx.query.workspace ? WorkspaceID.make(ctx.query.workspace) : undefined,
            roots: ctx.query.roots,
            start: ctx.query.start,
            search: ctx.query.search,
          }
          const sessions = yield* session.list({
            limit: ctx.query.limit ?? DefaultSessionsLimit,
            order,
            directory: filters.directory,
            path: filters.path,
            workspaceID: filters.workspaceID,
            roots: filters.roots,
            start: filters.start,
            search: filters.search,
            cursor: decoded ? { id: decoded.id, time: decoded.time, direction: decoded.direction } : undefined,
          })
          const first = sessions[0]
          const last = sessions.at(-1)
          return {
            items: sessions,
            cursor: {
              previous: first ? sessionCursor.encode(first, order, "previous", filters) : undefined,
              next: last ? sessionCursor.encode(last, order, "next", filters) : undefined,
            },
          }
        }),
      )
      .handle(
        "prompt",
        Effect.fn(function* (ctx) {
          return yield* session.prompt({
            sessionID: ctx.params.sessionID,
            prompt: ctx.payload.prompt,
            delivery: ctx.payload.delivery ?? SessionV2.DefaultDelivery,
          })
        }),
      )
      .handle(
        "compact",
        Effect.fn(function* (ctx) {
          yield* session.compact(ctx.params.sessionID)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "wait",
        Effect.fn(function* (ctx) {
          yield* session.wait(ctx.params.sessionID)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "context",
        Effect.fn(function* (ctx) {
          return yield* session.context(ctx.params.sessionID)
        }),
      )
      .handle(
        "get",
        Effect.fn(function* (ctx) {
          return yield* session.get(ctx.params.sessionID)
        }),
      )
      .handle(
        "remove",
        Effect.fn(function* (ctx) {
          yield* session.remove(ctx.params.sessionID)
          return true
        }),
      )
      .handle(
        "update",
        Effect.fn(function* (ctx) {
          return yield* session.update({
            sessionID: ctx.params.sessionID,
            title: ctx.payload.title,
            permission: ctx.payload.permission,
            archived: ctx.payload.time?.archived,
          })
        }),
      )
      .handle(
        "children",
        Effect.fn(function* (ctx) {
          return yield* session.children(ctx.params.sessionID)
        }),
      )
      .handle(
        "abort",
        Effect.fn(function* (ctx) {
          yield* session.abort(ctx.params.sessionID)
          return true
        }),
      )
      .handle("status", Effect.fn(function* () {
        return Object.fromEntries(yield* statusSvc.list())
      }))
      .handle(
        "create",
        Effect.fn(function* (ctx) {
          // Same as the V1 handler: create through the share service so root
          // sessions are auto-shared when auto-share is enabled, then project
          // the created session through the V2 read model. The NoContent
          // payload arm decodes an empty body to undefined.
          const input = ctx.payload === undefined ? undefined : ctx.payload
          const info = yield* shareSvc.create(input)
          return yield* session.get(info.id)
        }),
      )
      .handle(
        "fork",
        Effect.fn(function* (ctx) {
          return yield* session.fork({ sessionID: ctx.params.sessionID, messageID: ctx.payload.messageID })
        }),
      )
      .handle(
        "share",
        Effect.fn(function* (ctx) {
          yield* shareSvc.share(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
          return yield* session.get(ctx.params.sessionID)
        }),
      )
      .handle(
        "unshare",
        Effect.fn(function* (ctx) {
          yield* shareSvc.unshare(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
          return yield* session.get(ctx.params.sessionID)
        }),
      )
      .handle(
        "summarize",
        Effect.fn(function* (ctx) {
          return yield* session.summarize({
            sessionID: ctx.params.sessionID,
            providerID: ctx.payload.providerID,
            modelID: ctx.payload.modelID,
            auto: ctx.payload.auto,
          })
        }),
      )
      .handle(
        "init",
        Effect.fn(function* (ctx) {
          return yield* session.init({
            sessionID: ctx.params.sessionID,
            messageID: ctx.payload.messageID,
            providerID: ctx.payload.providerID,
            modelID: ctx.payload.modelID,
          })
        }),
      )
      .handle(
        "todo",
        Effect.fn(function* (ctx) {
          return yield* todoSvc.get(ctx.params.sessionID)
        }),
      )
      .handle(
        "diff",
        Effect.fn(function* (ctx) {
          return yield* summarySvc.diff({ sessionID: ctx.params.sessionID, messageID: ctx.query.messageID })
        }),
      )
      .handle(
        "command",
        Effect.fn(function* (ctx) {
          yield* session.command({ ...ctx.payload, sessionID: ctx.params.sessionID })
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "shell",
        Effect.fn(function* (ctx) {
          yield* session.shell({ sessionID: ctx.params.sessionID, command: ctx.payload.command })
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "revert",
        Effect.fn(function* (ctx) {
          return yield* session.revert({
            sessionID: ctx.params.sessionID,
            messageID: ctx.payload.messageID,
            partID: ctx.payload.partID,
          })
        }),
      )
      .handle(
        "unrevert",
        Effect.fn(function* (ctx) {
          return yield* session.unrevert(ctx.params.sessionID)
        }),
      )
      .handle(
        "predict",
        Effect.fn(function* (ctx) {
          const instance = yield* InstanceState.context
          const workspace = yield* InstanceState.workspaceID
          // Best-effort: predict never throws upward — the TUI treats an empty
          // string the same as a hidden suggestion.
          const prediction = yield* promptSvc
            .predict({ sessionID: ctx.params.sessionID })
            .pipe(
              Effect.provideService(InstanceRef, instance),
              Effect.provideService(WorkspaceRef, workspace),
              Effect.catch(() => Effect.succeed("")),
            )
          return { prediction }
        }),
      )
  }),
)
