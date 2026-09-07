import { WorkspaceID } from "@/control-plane/schema"
import { Bus } from "@/bus"
import * as InstanceState from "@/effect/instance-state"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { Permission } from "@/permission"
import { SessionPrompt } from "@/session/prompt"
import { MessageV2 } from "@/session/message-v2"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { Session as SessionV1 } from "@/session/session"
import { SessionShare } from "@/share/session"
import { NotFoundError as StorageNotFoundError } from "@/storage/storage"
import { SessionV2 } from "@/v2/session"
import { NamedError } from "@opencode-ai/core/util/error"
import { Cause, Effect, Schema, Scope } from "effect"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"
import { notFound } from "../../errors"

// V1 error-shape parity: the V2 service's typed NotFoundError serializes as
// `{_tag, sessionID}` (no `message`), which the SDK's error wrapper cannot
// turn into a useful message. Map to the V1 `ApiNotFoundError` body
// (`data.message`) so consumers see "Session not found: ses_..." as before.
const withNotFound = <A, R>(self: Effect.Effect<A, SessionV2.NotFoundError, R>) =>
  Effect.mapError(self, (error) => notFound(`Session not found: ${error.sessionID}`))

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
  scope: Schema.Literal("project").pipe(Schema.optional),
  start: Schema.Finite.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
})
type SessionCursor = typeof SessionCursor.Type

const decodeCursor = Schema.decodeUnknownSync(SessionCursor)

function hasCursorFilter(query: {
  readonly order?: unknown
  readonly path?: unknown
  readonly roots?: unknown
  readonly scope?: unknown
  readonly start?: unknown
  readonly search?: unknown
}) {
  return (
    query.order !== undefined ||
    query.path !== undefined ||
    query.roots !== undefined ||
    query.scope !== undefined ||
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
    filters: Pick<SessionCursor, "directory" | "path" | "workspaceID" | "roots" | "scope" | "start" | "search">,
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
    const sessionV1 = yield* SessionV1.Service
    const runState = yield* SessionRunState.Service
    const permissionSvc = yield* Permission.Service
    const bus = yield* Bus.Service
    const scope = yield* Scope.Scope

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
            scope: ctx.query.scope,
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
            scope: filters.scope,
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
            agent: ctx.payload.agent,
            model: ctx.payload.model,
            variant: ctx.payload.variant,
            messageID: ctx.payload.messageID,
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
          return yield* withNotFound(session.get(ctx.params.sessionID))
        }),
      )
      .handle(
        "remove",
        Effect.fn(function* (ctx) {
          yield* withNotFound(session.remove(ctx.params.sessionID))
          return true
        }),
      )
      .handle(
        "update",
        Effect.fn(function* (ctx) {
          return yield* withNotFound(session.update({
            sessionID: ctx.params.sessionID,
            title: ctx.payload.title,
            permission: ctx.payload.permission,
            archived: ctx.payload.time?.archived,
          }))
        }),
      )
      .handle(
        "children",
        Effect.fn(function* (ctx) {
          return yield* withNotFound(session.children(ctx.params.sessionID))
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
          return yield* withNotFound(session.get(info.id))
        }),
      )
      .handle(
        "fork",
        Effect.fn(function* (ctx) {
          return yield* withNotFound(session.fork({ sessionID: ctx.params.sessionID, messageID: ctx.payload.messageID }))
        }),
      )
      .handle(
        "share",
        Effect.fn(function* (ctx) {
          yield* shareSvc.share(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
          return yield* withNotFound(session.get(ctx.params.sessionID))
        }),
      )
      .handle(
        "unshare",
        Effect.fn(function* (ctx) {
          yield* shareSvc.unshare(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
          return yield* withNotFound(session.get(ctx.params.sessionID))
        }),
      )
      .handle(
        "summarize",
        Effect.fn(function* (ctx) {
          return yield* withNotFound(session.summarize({
            sessionID: ctx.params.sessionID,
            providerID: ctx.payload.providerID,
            modelID: ctx.payload.modelID,
            auto: ctx.payload.auto,
          }))
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
          return yield* session.command({ ...ctx.payload, sessionID: ctx.params.sessionID })
        }),
      )
      .handle(
        "shell",
        Effect.fn(function* (ctx) {
          yield* session.shell({
            sessionID: ctx.params.sessionID,
            messageID: ctx.payload.messageID,
            agent: ctx.payload.agent,
            model: ctx.payload.model,
            command: ctx.payload.command,
          })
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "revert",
        Effect.fn(function* (ctx) {
          return yield* withNotFound(session.revert({
            sessionID: ctx.params.sessionID,
            messageID: ctx.payload.messageID,
            partID: ctx.payload.partID,
          }))
        }),
      )
      .handle(
        "unrevert",
        Effect.fn(function* (ctx) {
          return yield* withNotFound(session.unrevert(ctx.params.sessionID))
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
      .handle(
        "message",
        Effect.fn(function* (ctx) {
          return yield* Effect.try({
            try: () => MessageV2.get({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID }),
            catch: (error) => error,
          }).pipe(
            Effect.catch((error) => (StorageNotFoundError.isInstance(error) ? Effect.fail(error) : Effect.die(error))),
            Effect.mapError((error) => notFound(error.data.message)),
          )
        }),
      )
      .handle(
        "deleteMessage",
        Effect.fn(function* (ctx) {
          yield* runState.assertNotBusy(ctx.params.sessionID)
          yield* sessionV1.removeMessage(ctx.params)
          return true
        }),
      )
      .handle(
        "deletePart",
        Effect.fn(function* (ctx) {
          yield* sessionV1.removePart(ctx.params)
          return true
        }),
      )
      .handle(
        "updatePart",
        Effect.fn(function* (ctx) {
          // Schema decode produces readonly attachment arrays; the V1 handler
          // bridges the same decode artifact with this assertion.
          const payload = ctx.payload as MessageV2.Part
          if (
            payload.id !== ctx.params.partID ||
            payload.messageID !== ctx.params.messageID ||
            payload.sessionID !== ctx.params.sessionID
          ) {
            throw new Error(
              `Part mismatch: body.id='${payload.id}' vs partID='${ctx.params.partID}', body.messageID='${payload.messageID}' vs messageID='${ctx.params.messageID}', body.sessionID='${payload.sessionID}' vs sessionID='${ctx.params.sessionID}'`,
            )
          }
          return yield* sessionV1.updatePart(payload)
        }),
      )
      .handle(
        "permission",
        Effect.fn(function* (ctx) {
          yield* permissionSvc.reply({ requestID: ctx.params.permissionID, reply: ctx.payload.response })
          return true
        }),
      )
      .handle(
        "promptAsync",
        Effect.fn(function* (ctx) {
          yield* promptSvc
            .prompt({ ...ctx.payload, sessionID: ctx.params.sessionID })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.gen(function* () {
                  yield* Effect.logError("prompt_async failed", { sessionID: ctx.params.sessionID, cause })
                  yield* bus.publish(SessionV1.Event.Error, {
                    sessionID: ctx.params.sessionID,
                    error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
                  })
                }),
              ),
              Effect.forkIn(scope, { startImmediately: true }),
            )
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
