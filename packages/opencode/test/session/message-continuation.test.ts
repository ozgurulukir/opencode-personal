import { describe, expect, test } from "bun:test"
import { wrapMessageContinuation } from "@/session/message-continuation"

describe("wrapMessageContinuation", () => {
  test("wraps user messages after lastFinished id with system reminder", () => {
    const msgs = [
      {
        info: { role: "user", id: "u1" },
        parts: [{ type: "text", text: "first message", ignored: false, synthetic: false }],
      },
      { info: { role: "assistant", id: "a1" }, parts: [] },
      {
        info: { role: "user", id: "u2" },
        parts: [{ type: "text", text: "follow-up", ignored: false, synthetic: false }],
      },
    ]
    const result = wrapMessageContinuation(msgs, "u1")
    expect(result[1].parts).toEqual([])
    expect(result[2].parts[0].text).toContain("<system-reminder>")
    expect(result[2].parts[0].text).toContain("follow-up")
    expect(msgs[2].parts[0].text).toBe("follow-up")
  })

  test("does not wrap messages at or before lastFinished id", () => {
    const msgs = [
      { info: { role: "user", id: "u1" }, parts: [{ type: "text", text: "old", ignored: false, synthetic: false }] },
      { info: { role: "assistant", id: "a1" }, parts: [] },
    ]
    const result = wrapMessageContinuation(msgs, "u1")
    expect(result[0].parts[0].text).toBe("old")
    expect(msgs[0].parts[0].text).toBe("old")
  })

  test("skips non-user roles", () => {
    const msgs = [
      {
        info: { role: "assistant", id: "a1" },
        parts: [{ type: "text", text: "reply", ignored: false, synthetic: false }],
      },
      { info: { role: "user", id: "u1" }, parts: [{ type: "text", text: "hi", ignored: false, synthetic: false }] },
    ]
    const result = wrapMessageContinuation(msgs, "u1")
    expect(result[0].parts[0].text).toBe("reply")
    expect(msgs[0].parts[0].text).toBe("reply")
  })

  test("skips empty text parts", () => {
    const msgs = [
      { info: { role: "user", id: "u1" }, parts: [{ type: "text", text: "", ignored: false, synthetic: false }] },
      { info: { role: "user", id: "u2" }, parts: [{ type: "text", text: "real", ignored: false, synthetic: false }] },
    ]
    const result = wrapMessageContinuation(msgs, "u1")
    expect(result[1].parts[0].text).toContain("real")
    expect(msgs[1].parts[0].text).toBe("real")
  })

  test("does not re-compact after auto-compaction continue marker", () => {
    const msgs = [
      {
        info: { role: "user", id: "u1" },
        parts: [{ type: "compaction", auto: true, overflow: true, ignored: false, synthetic: false }],
      },
      {
        info: { role: "user", id: "u2" },
        parts: [
          {
            type: "text",
            text: "Continue...",
            ignored: false,
            synthetic: false,
            metadata: { compaction_continue: true },
          },
        ],
      },
      {
        info: { role: "assistant", id: "a1" },
        parts: [{ type: "text", text: "summary text", ignored: false, synthetic: false }],
      },
    ]
    const result = wrapMessageContinuation(msgs, "u1")
    const part = result[2].parts[0] as { type: string; text: string }
    expect(part.text).toBe("summary text")
    expect((msgs[2].parts[0] as { type: string; text: string }).text).toBe("summary text")
  })
})
