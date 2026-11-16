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

  test("listen() posts rpc.error when the handler throws", async () => {
    const posted: string[] = []
    const originalPost = (globalThis as any).postMessage
    ;(globalThis as any).postMessage = (data: string) => posted.push(data)
    const originalOn = (globalThis as any).onmessage
    try {
      Rpc.listen({
        explode: () => {
          throw new Error("handler exploded")
        },
      })
      const handler = (globalThis as any).onmessage as (evt: { data: string }) => Promise<void>
      await handler({ data: JSON.stringify({ type: "rpc.request", method: "explode", input: null, id: 7 }) })
      expect(posted).toHaveLength(1)
      const message = JSON.parse(posted[0]!)
      expect(message.type).toBe("rpc.error")
      expect(message.id).toBe(7)
      expect(message.message).toBe("handler exploded")
    } finally {
      ;(globalThis as any).postMessage = originalPost
      ;(globalThis as any).onmessage = originalOn
    }
  })

  test("client() rejects the pending call on rpc.error and deletes it from pending", async () => {
    const target = {
      postMessage: () => null,
      onmessage: null as ((evt: { data: string }) => Promise<void>) | null,
    }
    const c = Rpc.client<{ explode: (input: null) => void }>(target)
    const pending = c.call("explode", null)
    await target.onmessage!(
      await Promise.resolve({ data: JSON.stringify({ type: "rpc.error", id: 0, message: "handler exploded" }) }),
    )
    expect(pending).rejects.toThrow("handler exploded")
    await expect(pending).rejects.toThrow("handler exploded")
    expect(c.pendingCount()).toBe(0)
  })

  test("rejectPending() rejects every in-flight call", async () => {
    const target = {
      postMessage: () => null,
      onmessage: null as ((evt: { data: string }) => Promise<void>) | null,
    }
    const c = Rpc.client<{ a: (input: null) => void; b: (input: null) => void }>(target)
    const first = c.call("a", null)
    const second = c.call("b", null)
    c.rejectPending(new Error("worker exited"))
    await expect(first).rejects.toThrow("worker exited")
    await expect(second).rejects.toThrow("worker exited")
    expect(c.pendingCount()).toBe(0)
  })
})
