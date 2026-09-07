import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { InstanceRef } from "@/effect/instance-ref"
import { SyncEvent } from "@/sync"
import { Context, DateTime, Effect, Layer } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { SessionEvent } from "./session-event"

const log = Log.create({ service: "v2.event-bridge" })

export interface Interface {
  /**
   * Materializes the per-instance subscription that forwards V1 bus events to
   * the V2 event stream. Called once per instance from the bootstrap sequence.
   */
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/EventBridge") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sync = yield* SyncEvent.Service
    const bus = yield* Bus.Service

    const translate = (type: string, props: any): Effect.Effect<void> => {
      // NOTE: the schema declares V2Schema.DateTimeUtcFromMillis (millis on the
      // wire) but sync.run publishes raw values, so this DateTime JSON-serializes
      // as an ISO string over SSE. The TUI sync context normalizes both shapes.
      // Root fix (encode at publish) is deferred to phase 5.
      const timestamp = DateTime.makeUnsafe(Date.now())
      switch (type) {
        case "session.updated":
          return sync.run(SessionEvent.Updated.Sync, { sessionID: props.sessionID, timestamp, info: props.info })
        case "session.deleted":
          return sync.run(SessionEvent.Deleted.Sync, { sessionID: props.sessionID, timestamp, info: props.info })
        case "session.status":
          return sync.run(SessionEvent.StatusUpdated.Sync, { sessionID: props.sessionID, timestamp, status: props.status })
        case "todo.updated":
          return sync.run(SessionEvent.TodoUpdated.Sync, { sessionID: props.sessionID, timestamp, todos: props.todos })
        case "session.diff":
          return sync.run(SessionEvent.DiffUpdated.Sync, { sessionID: props.sessionID, timestamp, diff: props.diff })
        case "permission.asked":
          return sync.run(SessionEvent.Permission.Asked.Sync, { sessionID: props.sessionID, timestamp, request: props })
        case "permission.replied":
          return sync.run(SessionEvent.Permission.Replied.Sync, {
            sessionID: props.sessionID,
            timestamp,
            requestID: props.requestID,
            reply: props.reply,
          })
        default:
          return Effect.void
      }
    }

    const state = yield* InstanceState.make<void>(() =>
      Effect.gen(function* () {
        // Subscribe synchronously (the PubSub subscription buffers events) so
        // nothing published right after bootstrap is missed while a lazily
        // scheduled fiber gets its first timeslice. The instance context is
        // captured here because the bus delivers events on fibers without one,
        // and translations are serialized to preserve event order — a failing
        // translation must not kill the subscription.
        const instance = yield* InstanceState.context
        let queue: Promise<void> = Promise.resolve()
        const unsubscribe = yield* bus.subscribeAllCallback((event) => {
          queue = queue
            .then(() =>
              Effect.runPromise(
                translate(event.type, event.properties).pipe(Effect.provideService(InstanceRef, instance)),
              ),
            )
            .catch((cause) => log.error("translate failed", { type: event.type, cause }))
        })
        yield* Effect.addFinalizer(() => Effect.sync(() => unsubscribe()))
      }),
    )

    const init = Effect.fn("V2EventBridge.init")(function* () {
      yield* InstanceState.get(state)
    })

    return Service.of({ init })
  }),
)

export * as EventBridge from "./event-bridge"
