import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import type { EffectBridge } from "../../src/effect/bridge"
import { parseSubagentTitle, subagentAbortGuard, subagentResultText, subagentTitle } from "../../src/agent/subagent-spawn"

describe("subagentResultText", () => {
  // Fallback strings are byte-identical to the ones previously inlined in V1
  // (`tool/task.ts`) and V2 (`v2/session.ts`) — tests match on them.
  test("no parts at all → 'Subagent produced no output parts.'", () => {
    expect(subagentResultText([])).toBe("Subagent produced no output parts.")
  })

  test("findLast picks the LAST text part among several", () => {
    const out = subagentResultText([
      { type: "text", text: "first" },
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "final answer" },
    ])
    expect(out).toBe("final answer")
  })

  test("parts but no text part → 'Subagent completed without producing a text response.'", () => {
    expect(subagentResultText([{ type: "tool" }, { type: "tool" }])).toBe(
      "Subagent completed without producing a text response.",
    )
  })

  test("a non-text part's text field is ignored (e.g. reasoning parts carry text)", () => {
    const out = subagentResultText([
      { type: "reasoning", text: "internal monologue" },
      { type: "tool" },
    ])
    expect(out).toBe("Subagent completed without producing a text response.")
  })

  test("empty-string text falls back (|| semantics, not ??)", () => {
    expect(subagentResultText([{ type: "text", text: "" }])).toBe(
      "Subagent completed without producing a text response.",
    )
  })
})

describe("subagentTitle", () => {
  test("format matches the consumer regexes (/@(\\w+) subagent/, /\\s+\\(@[^)]+ subagent\\)$/)", () => {
    const title = subagentTitle("inspect bug", "general")
    expect(title).toBe("inspect bug (@general subagent)")
    expect(/@(\w+) subagent/.exec(title)?.[1]).toBe("general")
    expect(/\s+\(@[^)]+ subagent\)$/.test(title)).toBe(true)
  })

  test("parseSubagentTitle extracts simple, hyphenated, and custom agent names", () => {
    expect(parseSubagentTitle(subagentTitle("inspect bug", "general"))).toEqual({
      description: "inspect bug",
      agent: "general",
    })
    expect(parseSubagentTitle(subagentTitle("review PR", "code-reviewer"))).toEqual({
      description: "review PR",
      agent: "code-reviewer",
    })
    expect(parseSubagentTitle(subagentTitle("nested (parens) task", "my.custom_agent-v2"))).toEqual({
      description: "nested (parens) task",
      agent: "my.custom_agent-v2",
    })
  })

  test("parseSubagentTitle returns undefined for non-subagent titles", () => {
    expect(parseSubagentTitle("Plain session title")).toBeUndefined()
    expect(parseSubagentTitle("")).toBeUndefined()
  })
})

describe("subagentAbortGuard", () => {
  // Minimal EffectBridge.Shape: records each `promise` hand-off and runs the
  // cancel Effect for real, so assertions observe the effect's own side
  // effects rather than the bridge call alone. The cast bridges the generic
  // R parameter — the guard's cancel Effect is R=never.
  function setup() {
    const counter = { promiseCalls: 0, cancelRuns: 0 }
    const pending: Promise<unknown>[] = []
    const bridge: EffectBridge.Shape = {
      promise: (effect) => {
        counter.promiseCalls++
        const p = Effect.runPromise(effect as unknown as Effect.Effect<never, never, never>)
        pending.push(p)
        return p
      },
      // subagentAbortGuard only ever calls `promise`; these stubs just satisfy Shape
      fork: () => {
        throw new Error("fork not supported by the test bridge")
      },
      run: () => {
        throw new Error("run not supported by the test bridge")
      },
    }
    const cancel = Effect.sync(() => {
      counter.cancelRuns++
    })
    const flush = () => Promise.allSettled(pending)
    return { counter, cancel, bridge, flush }
  }

  test("onAbort cancels once via bridge.promise; re-dispatched abort events do not re-cancel", async () => {
    const { counter, cancel, bridge, flush } = setup()
    const abort = new AbortController()
    const guard = subagentAbortGuard({ abort: abort.signal, cancel, bridge })
    Effect.runSync(guard.acquire)
    abort.abort()
    await flush()
    expect(counter.promiseCalls).toBe(1)
    expect(counter.cancelRuns).toBe(1)
    // a second dispatch (signal already aborted, so abort() won't re-fire)
    // hits the guard's cancelled flag, not the bridge
    abort.signal.dispatchEvent(new Event("abort"))
    await flush()
    expect(counter.promiseCalls).toBe(1)
    expect(counter.cancelRuns).toBe(1)
  })

  test("release with an interrupt-only exit cancels when not already cancelled", async () => {
    const { counter, cancel, bridge, flush } = setup()
    const abort = new AbortController()
    const guard = subagentAbortGuard({ abort: abort.signal, cancel, bridge })
    Effect.runSync(guard.acquire)
    Effect.runSync(guard.release(Exit.interrupt()))
    await flush()
    // the release path cancels the Effect directly, not through the bridge
    expect(counter.promiseCalls).toBe(0)
    expect(counter.cancelRuns).toBe(1)
    // the listener was removed before the cancel branch — aborting now is a no-op
    abort.abort()
    await flush()
    expect(counter.cancelRuns).toBe(1)
    expect(counter.promiseCalls).toBe(0)
  })

  test("release with an interrupt exit does not double-cancel after onAbort already cancelled", async () => {
    const { counter, cancel, bridge, flush } = setup()
    const abort = new AbortController()
    const guard = subagentAbortGuard({ abort: abort.signal, cancel, bridge })
    Effect.runSync(guard.acquire)
    abort.abort()
    await flush()
    expect(counter.cancelRuns).toBe(1)
    Effect.runSync(guard.release(Exit.interrupt()))
    await flush()
    expect(counter.cancelRuns).toBe(1)
    expect(counter.promiseCalls).toBe(1)
  })

  test("release removes the abort listener on non-interrupt exits", async () => {
    const { counter, cancel, bridge, flush } = setup()
    const abort = new AbortController()
    const guard = subagentAbortGuard({ abort: abort.signal, cancel, bridge })
    Effect.runSync(guard.acquire)
    Effect.runSync(guard.release(Exit.succeed(undefined)))
    abort.abort()
    await flush()
    expect(counter.promiseCalls).toBe(0)
    expect(counter.cancelRuns).toBe(0)
  })

  test("release with a failure (non-interrupt) exit does not cancel", async () => {
    const { counter, cancel, bridge, flush } = setup()
    const abort = new AbortController()
    const guard = subagentAbortGuard({ abort: abort.signal, cancel, bridge })
    Effect.runSync(guard.acquire)
    Effect.runSync(guard.release(Exit.fail(new Error("prompt failed"))))
    expect(counter.cancelRuns).toBe(0)
    // and the listener is gone — a later abort stays silent
    abort.abort()
    await flush()
    expect(counter.cancelRuns).toBe(0)
    expect(counter.promiseCalls).toBe(0)
  })
})
