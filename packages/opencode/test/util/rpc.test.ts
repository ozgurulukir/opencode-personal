import { describe, expect, test } from "bun:test"
import { Rpc } from "../../src/util/rpc"

describe("util/rpc", () => {
  test("listen() swallows malformed messages instead of throwing", async () => {
    Rpc.listen({})
    const handler = (globalThis as any).onmessage as (evt: { data: string }) => Promise<void>
    expect(handler).toBeDefined()
    await handler({ data: "{not valid json" })
    ;(globalThis as any).onmessage = undefined
  })

  test("client() swallows malformed messages instead of throwing", async () => {
    const target = {
      postMessage: () => null,
      onmessage: null as ((evt: { data: string }) => Promise<void>) | null,
    }
    Rpc.client(target)
    expect(target.onmessage).toBeDefined()
    await target.onmessage!({ data: "\x00 garbage" })
  })

  test("client() round-trips a valid rpc.result", async () => {
    const posted: string[] = []
    const target = {
      postMessage: (data: string) => {
        posted.push(data)
      },
      onmessage: null as ((evt: { data: string }) => Promise<void>) | null,
    }
    const c = Rpc.client<{ double: (input: number) => number }>(target)
    const pending = c.call("double", 21)
    await target.onmessage!(await Promise.resolve({ data: JSON.stringify({ type: "rpc.result", result: 42, id: 0 }) }))
    expect(posted.length).toBe(1)
    expect(JSON.parse(posted[0]!).type).toBe("rpc.request")
    expect(await pending).toBe(42)
  })
})
