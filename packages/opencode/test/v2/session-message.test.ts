import { describe, expect, test } from "bun:test"
import { normalizeForDecode } from "@/v2/session-message"

const ISO = "2024-01-02T03:04:05.000Z"
const MILLIS = Date.parse(ISO)

type TimeRecord = { time: Record<string, unknown> }

describe("normalizeForDecode time revival", () => {
  test("revives an ISO time.created on a user row", () => {
    const out = normalizeForDecode({ type: "user", time: { created: ISO } }) as TimeRecord
    expect(out.time.created).toBe(MILLIS)
  })

  test("revives a synthetic row (agent/model/synthetic share the shape)", () => {
    const out = normalizeForDecode({ type: "synthetic", time: { created: ISO } }) as TimeRecord
    expect(out.time.created).toBe(MILLIS)
  })

  test("revives shell created and completed", () => {
    const out = normalizeForDecode({ type: "shell", time: { created: ISO, completed: ISO } }) as TimeRecord
    expect(out.time).toEqual({ created: MILLIS, completed: MILLIS })
  })

  test("revives compaction time.created", () => {
    const out = normalizeForDecode({ type: "compaction", time: { created: ISO } }) as TimeRecord
    expect(out.time.created).toBe(MILLIS)
  })

  test("leaves already-numeric times untouched (same reference)", () => {
    const value = { type: "user", time: { created: MILLIS } }
    expect(normalizeForDecode(value)).toBe(value)
  })

  test("leaves unparseable time strings untouched so the schema error stays precise", () => {
    const value = { type: "user", time: { created: "not-a-date" } }
    expect(normalizeForDecode(value)).toBe(value)
  })

  test("revives assistant top-level time and content[].time, then normalizes tool input", () => {
    const out = normalizeForDecode({
      type: "assistant",
      time: { created: ISO },
      content: [
        {
          type: "tool",
          id: "call_1",
          name: "bash",
          time: { created: ISO, ran: ISO, completed: ISO, pruned: ISO },
          state: { status: "completed", input: JSON.stringify({ command: "pwd" }) },
        },
      ],
    }) as TimeRecord & {
      content: Array<{ time: Record<string, unknown>; state: { input: unknown } }>
    }

    expect(out.time.created).toBe(MILLIS)
    expect(out.content[0].time).toEqual({ created: MILLIS, ran: MILLIS, completed: MILLIS, pruned: MILLIS })
    expect(out.content[0].state.input).toEqual({ command: "pwd" })
  })

  test("revives content[].time before the assistant-only gate", () => {
    const out = normalizeForDecode({
      type: "user",
      time: { created: ISO },
      content: [{ type: "tool", id: "call_1", name: "bash", time: { ran: ISO } }],
    }) as { time: Record<string, unknown>; content: Array<{ time: Record<string, unknown> }> }
    expect(out.time.created).toBe(MILLIS)
    expect(out.content[0].time.ran).toBe(MILLIS)
  })

  test("still normalizes tool input when content times are already numeric", () => {
    const out = normalizeForDecode({
      type: "assistant",
      time: { created: MILLIS },
      content: [
        {
          type: "tool",
          id: "call_1",
          name: "bash",
          time: { created: MILLIS },
          state: { status: "running", input: "not-json" },
        },
      ],
    }) as { content: Array<{ state: { input: unknown } }> }
    expect(out.content[0].state.input).toEqual({})
  })

  test("returns non-record values unchanged", () => {
    expect(normalizeForDecode("x")).toBe("x")
    expect(normalizeForDecode(null)).toBeNull()
    expect(normalizeForDecode(undefined)).toBeUndefined()
  })
})
