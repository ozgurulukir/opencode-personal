import { Workspace } from "@/control-plane/workspace"
import * as InstanceState from "@/effect/instance-state"
import { Session } from "@/session/session"
import { SessionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { SyncEvent } from "@/sync"
import { EventTable } from "@/sync/event.sql"
import { and, asc, eq, inArray, lte, not, or } from "drizzle-orm"
import { Effect, Scope } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { badRequest, notFound } from "../errors"
import { HistoryPayload, ReplayPayload, SessionPayload } from "../groups/sync"
import * as Log from "@opencode-ai/core/util/log"
import { errorData } from "@/util/error"

const log = Log.create({ service: "server.sync" })

// Mirrors the schema-error middleware's reason cap: validation messages echo
// client-supplied event data (aggregate ids, seq values), so the 400 body must
// stay bounded instead of mirroring an entire payload.
const REJECTION_LIMIT = 1024
function truncateRejection(reason: string) {
  const message = reason.length <= REJECTION_LIMIT ? reason : reason.slice(0, REJECTION_LIMIT)
  return `Replay rejected: ${message}`
}

export const syncHandlers = HttpApiBuilder.group(InstanceHttpApi, "sync", (handlers) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const scope = yield* Scope.Scope
    const sync = yield* SyncEvent.Service

    const start = Effect.fn("SyncHttpApi.start")(function* () {
      yield* workspace.startWorkspaceSyncing((yield* InstanceState.context).project.id).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => log.error("failed to start workspace syncing", { error: errorData(error) })),
        ),
        Effect.forkIn(scope),
      )
      return true
    })

    const replay = Effect.fn("SyncHttpApi.replay")(function* (ctx: { payload: typeof ReplayPayload.Type }) {
      const events: SyncEvent.SerializedEvent[] = ctx.payload.events.map((event) => ({
        id: event.id,
        aggregateID: event.aggregateID,
        seq: event.seq,
        type: event.type,
        data: { ...event.data },
      }))
      const source = events[0].aggregateID
      log.info("sync replay requested", {
        sessionID: source,
        events: events.length,
        first: events[0]?.seq,
        last: events.at(-1)?.seq,
        directory: ctx.payload.directory,
      })
      // SyncEvent.replay/replayAll signal client-caused validation failures
      // (sequence mismatch, cross-aggregate batch, unknown event type) with a
      // typed SyncEvent.ValidationError, which surfaces as a defect; the route
      // declares a 400 error, so map exactly that class to the declared error
      // body and re-raise anything else (infra faults keep the sanitized 500).
      // The message echoes client-supplied data, so cap it like the
      // schema-error middleware does.
      yield* sync.replayAll(events).pipe(
        Effect.catchDefect((defect) =>
          defect instanceof SyncEvent.ValidationError
            ? Effect.fail(badRequest(truncateRejection(defect.message)))
            : Effect.die(defect),
        ),
      )
      log.info("sync replay complete", {
        sessionID: source,
        events: events.length,
        first: events[0]?.seq,
        last: events.at(-1)?.seq,
      })
      return { sessionID: source }
    })

    const steal = Effect.fn("SyncHttpApi.steal")(function* (ctx: { payload: typeof SessionPayload.Type }) {
      const instance = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      if (!workspaceID) return yield* badRequest("Cannot steal session without workspace context")

      const sessionRow = Database.use((db) =>
        db
          .select({ projectID: SessionTable.project_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, ctx.payload.sessionID))
          .get(),
      )
      if (!sessionRow || sessionRow.projectID !== instance.project.id) {
        return yield* notFound(`Session not found: ${ctx.payload.sessionID}`)
      }

      yield* sync.run(Session.Event.Updated, {
        sessionID: ctx.payload.sessionID,
        info: {
          workspaceID,
        },
      })

      log.info("sync session stolen", {
        sessionID: ctx.payload.sessionID,
        workspaceID,
      })

      return { sessionID: ctx.payload.sessionID }
    })

    const HISTORY_LIMIT = 1000

    const history = Effect.fn("SyncHttpApi.history")(function* (ctx: { payload: typeof HistoryPayload.Type }) {
      const instance = yield* InstanceState.context
      const exclude = Object.entries(ctx.payload)
      return Database.use((db) => {
        const projectSessions = db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(eq(SessionTable.project_id, instance.project.id))
        const projectFilter = inArray(EventTable.aggregate_id, projectSessions)
        const excludeFilter =
          exclude.length > 0
            ? not(or(...exclude.map(([id, seq]) => and(eq(EventTable.aggregate_id, id), lte(EventTable.seq, seq))))!)
            : undefined
        return db
          .select()
          .from(EventTable)
          .where(excludeFilter ? and(projectFilter, excludeFilter) : projectFilter)
          .orderBy(asc(EventTable.seq))
          .limit(HISTORY_LIMIT)
          .all()
      })
    })

    return handlers.handle("start", start).handle("replay", replay).handle("steal", steal).handle("history", history)
  }),
)
