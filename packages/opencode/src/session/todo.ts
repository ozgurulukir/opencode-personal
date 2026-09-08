import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import { zod } from "@opencode-ai/core/effect-zod"
import { withStatics } from "@opencode-ai/core/schema"
import { Effect, Layer, Context, Schema } from "effect"
import z from "zod"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import { asc } from "drizzle-orm"
import { SyncEvent } from "@/sync"
import { SessionEvent } from "@/v2/session-event"
import * as DateTime from "effect/DateTime"
import { TodoTable } from "./session.sql"
import { applyAutoclose } from "./todo-autoclose"

export const TodoStatus = Schema.Union([
  Schema.Literal("pending"),
  Schema.Literal("in_progress"),
  Schema.Literal("completed"),
  Schema.Literal("cancelled"),
]).annotate({
  description: "Current status of the task: pending, in_progress, completed, cancelled",
})
export type TodoStatus = Schema.Schema.Type<typeof TodoStatus>

export const TodoPriority = Schema.Union([
  Schema.Literal("high"),
  Schema.Literal("medium"),
  Schema.Literal("low"),
]).annotate({
  description: "Priority level of the task: high, medium, low",
})
export type TodoPriority = Schema.Schema.Type<typeof TodoPriority>

/**
 * Normalize a raw status string to a valid TodoStatus.
 * Falls back to "pending" for unknown values (backward compatibility with old data).
 */
export function normalizeStatus(raw: string): TodoStatus {
  if (raw === "pending" || raw === "in_progress" || raw === "completed" || raw === "cancelled") return raw
  return "pending"
}

/**
 * Normalize a raw priority string to a valid TodoPriority.
 * Falls back to "medium" for unknown values (backward compatibility with old data).
 */
export function normalizePriority(raw: string): TodoPriority {
  if (raw === "high" || raw === "medium" || raw === "low") return raw
  return "medium"
}

export const Info = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: TodoStatus,
  priority: TodoPriority,
})
  .annotate({ identifier: "Todo" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export const Event = {
  Updated: BusEvent.define(
    "todo.updated",
    Schema.Struct({
      sessionID: SessionID,
      todos: Schema.Array(Info),
    }),
  ),
}

export interface Interface {
  readonly update: (input: { sessionID: SessionID; todos: Info[] }) => Effect.Effect<void>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info[]>
  readonly autoclose: (sessionID: SessionID, fileChanges: Array<{ filePath: string; diff: string }>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionTodo") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const sync = yield* SyncEvent.Service

    const update = Effect.fn("Todo.update")(function* (input: { sessionID: SessionID; todos: Info[] }) {
      yield* Effect.sync(() =>
        Database.transaction((db) => {
          db.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
          if (input.todos.length === 0) return
          db.insert(TodoTable)
            .values(
              input.todos.map((todo, position) => ({
                session_id: input.sessionID,
                content: todo.content,
                status: todo.status,
                priority: todo.priority,
                position,
              })),
            )
            .run()
        }),
      )
      yield* bus.publish(Event.Updated, input)
      // Native V2 lifecycle emission is published alongside the V1 event
      yield* sync.run(SessionEvent.TodoUpdated.Sync, {
        sessionID: input.sessionID,
        timestamp: DateTime.makeUnsafe(Date.now()),
        todos: input.todos,
      })
    })

    const get = Effect.fn("Todo.get")(function* (sessionID: SessionID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).orderBy(asc(TodoTable.position)).all(),
        ),
      )
      return rows.map((row) => ({
        content: row.content,
        status: normalizeStatus(row.status),
        priority: normalizePriority(row.priority),
      }))
    })
    const autoclose = Effect.fn("Todo.autoclose")(function* (sessionID: SessionID, fileChanges: Array<{ filePath: string; diff: string }>) {
      const currentTodos = yield* get(sessionID)
      const nextTodos = applyAutoclose(currentTodos, fileChanges)
      if (nextTodos !== currentTodos) {
        yield* update({ sessionID, todos: nextTodos })
      }
    })

    return Service.of({ update, get, autoclose })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(SyncEvent.defaultLayer))

export * as Todo from "./todo"
