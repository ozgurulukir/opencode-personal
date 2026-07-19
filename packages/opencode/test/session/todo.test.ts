import { describe, expect, test } from "bun:test"
import { Todo } from "../../src/session/todo"
import { Session as SessionNs } from "../../src/session/session"
import { AppRuntime } from "../../src/effect/app-runtime"
import { WithInstance } from "../../src/project/with-instance"
import { tmpdir } from "../fixture/fixture"

describe("session todo autoclose", () => {
  test("autocloses todo when significant keywords match in diffs", async () => {
    await using tmp = await tmpdir({ git: true })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({ title: "Todo test session" })))
        const sessionID = session.id

        // Seed initial todos
        const initialTodos = [
          { content: "implement verification logic", status: "pending" as const, priority: "high" as const },
          { content: "unrelated task to keep pending", status: "pending" as const, priority: "medium" as const },
          { content: "already completed task", status: "completed" as const, priority: "low" as const },
        ] satisfies Todo.Info[]
        
        await AppRuntime.runPromise(Todo.Service.use((svc) => svc.update({ sessionID, todos: initialTodos })))

        // Verify seeded state
        let seeded = await AppRuntime.runPromise(Todo.Service.use((svc) => svc.get(sessionID)))
        expect(seeded.length).toBe(3)
        expect(seeded[0].status).toBe("pending")

        // Trigger autoclose with a diff that matches the first todo's words
        const fileChanges = [
          {
            filePath: "src/verify.ts",
            diff: "@@ -0,0 +1,5 @@\n+function implement() {\n+  console.log('verification logic here');\n+}",
          },
        ]

        await AppRuntime.runPromise(Todo.Service.use((svc) => svc.autoclose(sessionID, fileChanges)))

        // Verify status changes
        const updated = await AppRuntime.runPromise(Todo.Service.use((svc) => svc.get(sessionID)))
        expect(updated.length).toBe(3)
        
        // The first todo should be completed
        expect(updated[0].content).toBe("implement verification logic")
        expect(updated[0].status).toBe("completed")

        // The second todo (unrelated) should remain pending
        expect(updated[1].content).toBe("unrelated task to keep pending")
        expect(updated[1].status).toBe("pending")

        // The third todo should remain completed
        expect(updated[2].status).toBe("completed")

        await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.remove(sessionID)))
      },
    })
  })
})
