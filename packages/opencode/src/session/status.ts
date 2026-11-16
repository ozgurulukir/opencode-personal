import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"
import { zod } from "@opencode-ai/core/effect-zod"
import { NonNegativeInt, withStatics } from "@opencode-ai/core/schema"
import { Deferred, Effect, Layer, Context, Schema } from "effect"
import z from "zod"
import { SyncEvent } from "@/sync"
import { SessionEvent } from "@/v2/session-event"
import * as DateTime from "effect/DateTime"

export const Info = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("idle"),
  }),
  Schema.Struct({
    type: Schema.Literal("retry"),
    attempt: NonNegativeInt,
    message: Schema.String,
    action: Schema.optional(
      Schema.Struct({
        reason: Schema.String,
        provider: Schema.String,
        title: Schema.String,
        message: Schema.String,
        label: Schema.String,
        link: Schema.optional(Schema.String),
      }),
    ),
    next: NonNegativeInt,
  }),
  Schema.Struct({
    type: Schema.Literal("busy"),
  }),
])
  .annotate({ identifier: "SessionStatus" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export const Event = {
  Status: BusEvent.define(
    "session.status",
    Schema.Struct({
      sessionID: SessionID,
      status: Info,
    }),
  ),
  // deprecated
  Idle: BusEvent.define(
    "session.idle",
    Schema.Struct({
      sessionID: SessionID,
    }),
  ),
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Map<SessionID, Info>>
  readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
  /**
   * Blocks until the session goes idle. Wakeups are delivered through a
   * Deferred registered in per-instance state (not through bus events), so
   * there is no lost-wakeup window: the waiter registers before the status
   * re-check, and any set(idle) that races the registration opens it.
   */
  readonly waitIdle: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

interface State {
  status: Map<SessionID, Info>
  waiters: Map<SessionID, Set<Deferred.Deferred<void>>>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const sync = yield* SyncEvent.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionStatus.state")(() =>
        Effect.succeed({ status: new Map<SessionID, Info>(), waiters: new Map<SessionID, Set<Deferred.Deferred<void>>>() }),
      ),
    )

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      return data.status.get(sessionID) ?? { type: "idle" as const }
    })

    const list = Effect.fn("SessionStatus.list")(function* () {
      return new Map((yield* InstanceState.get(state)).status)
    })

    const openWaiters = (data: State, sessionID: SessionID) => {
      const waiters = data.waiters.get(sessionID)
      if (!waiters) return
      for (const waiter of waiters) {
        Deferred.doneUnsafe(waiter, Effect.void)
      }
      data.waiters.delete(sessionID)
    }

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      const data = yield* InstanceState.get(state)
      yield* bus.publish(Event.Status, { sessionID, status })
      // Native V2 lifecycle emission is published alongside the V1 event
      yield* sync.run(SessionEvent.StatusUpdated.Sync, {
        sessionID,
        timestamp: DateTime.makeUnsafe(Date.now()),
        status,
      })
      if (status.type === "idle") {
        // Open waiters BEFORE publishing the (deprecated) bus event and
        // clearing the in-memory status: a waiter registered concurrently
        // with this call is guaranteed to be either already in the set
        // (opened here) or to observe the cleared status on its re-check.
        openWaiters(data, sessionID)
        yield* bus.publish(Event.Idle, { sessionID })
        data.status.delete(sessionID)
        return
      }
      data.status.set(sessionID, status)
    })

    const waitIdle = Effect.fn("SessionStatus.waitIdle")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const deferred = yield* Deferred.make<void>()
      // Register the waiter BEFORE the re-check: if the session goes idle
      // between the two, this call is opened by set() instead of hanging.
      const waiters = data.waiters.get(sessionID) ?? new Set()
      waiters.add(deferred)
      data.waiters.set(sessionID, waiters)
      const current = data.status.get(sessionID)
      if (current === undefined || current.type === "idle") {
        waiters.delete(deferred)
        return
      }
      yield* Deferred.await(deferred)
    })

    return Service.of({ get, list, set, waitIdle })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(SyncEvent.defaultLayer))

export * as SessionStatus from "./status"
