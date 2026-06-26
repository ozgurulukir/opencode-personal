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
import { TodoTable } from "./session.sql"

export const Info = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({ description: "Priority level of the task: high, medium, low" }),
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
    })

    const get = Effect.fn("Todo.get")(function* (sessionID: SessionID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).orderBy(asc(TodoTable.position)).all(),
        ),
      )
      return rows.map((row) => ({
        content: row.content,
        status: row.status,
        priority: row.priority,
      }))
    })
    const autoclose = Effect.fn("Todo.autoclose")(function* (sessionID: SessionID, fileChanges: Array<{ filePath: string; diff: string }>) {
      const currentTodos = yield* get(sessionID)
      if (currentTodos.length === 0) return

      let updated = false
      const nextTodos = currentTodos.map((todo) => {
        if (todo.status === "completed" || todo.status === "cancelled") return todo

        // Simple keyword-based semantic matching in diffs
        const contentLower = todo.content.toLowerCase()
        const words = contentLower.split(/\s+/).filter((w) => w.length > 3)
        if (words.length === 0) return todo

        // Check if all significant words appear in any of the diffs
        const match = fileChanges.some((change) => {
          const diffLower = change.diff.toLowerCase()
          return words.every((word) => diffLower.includes(word))
        })

        if (match) {
          updated = true
          return { ...todo, status: "completed" }
        }
        return todo
      })

      if (updated) {
        yield* update({ sessionID, todos: nextTodos })
      }
    })

    return Service.of({ update, get, autoclose })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as Todo from "./todo"
