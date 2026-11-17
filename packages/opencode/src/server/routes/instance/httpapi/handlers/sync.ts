import { Workspace } from "@/control-plane/workspace"
import * as InstanceState from "@/effect/instance-state"
import { Session } from "@/session/session"
import { SessionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { SyncEvent } from "@/sync"
import { EventTable } from "@/sync/event.sql"
import { and, asc, eq, inArray, lte, not, or } from "drizzle-orm"
import { Effect, Scope } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { HistoryPayload, ReplayPayload, SessionPayload } from "../groups/sync"
import * as Log from "@opencode-ai/core/util/log"
import { errorData } from "@/util/error"

const log = Log.create({ service: "server.sync" })

export const syncHandlers = HttpApiBuilder.group(InstanceHttpApi, "sync", (handlers) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const scope = yield* Scope.Scope
    const sync = yield* SyncEvent.Service

    const start = Effect.fn("SyncHttpApi.start")(function* () {
      yield* workspace
        .startWorkspaceSyncing((yield* InstanceState.context).project.id)
        .pipe(
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
      yield* sync.replayAll(events)
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
      if (!workspaceID) throw new Error("Cannot steal session without workspace context")

      const sessionRow = Database.use((db) =>
        db.select({ projectID: SessionTable.project_id }).from(SessionTable).where(eq(SessionTable.id, ctx.payload.sessionID)).get(),
      )
      if (!sessionRow || sessionRow.projectID !== instance.project.id) {
        return yield* new HttpApiError.NotFound({})
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
