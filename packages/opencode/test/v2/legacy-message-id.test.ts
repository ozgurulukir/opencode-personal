import { describe, expect, it } from "bun:test"
import { legacyMessageID, matchLegacyMessage, stripLegacyMessageID } from "@/v2/legacy-message-id.shared"

const message = (id: string, role: string, created: number) => ({
  info: { id, role, time: { created } },
})

describe("legacyMessageID", () => {
  it("extracts a msg_ association from metadata", () => {
    expect(legacyMessageID({ opencodeLegacyMessageID: "msg_123" })).toBe("msg_123")
  })

  it("rejects non-msg_ values and non-object metadata", () => {
    expect(legacyMessageID({ opencodeLegacyMessageID: "evt_123" })).toBeUndefined()
    expect(legacyMessageID({})).toBeUndefined()
    expect(legacyMessageID(undefined)).toBeUndefined()
    expect(legacyMessageID(["msg_123"])).toBeUndefined()
    expect(legacyMessageID("msg_123")).toBeUndefined()
  })
})

describe("stripLegacyMessageID", () => {
  it("removes the association key from metadata", () => {
    const data = { type: "user", metadata: { opencodeLegacyMessageID: "msg_1", agent: "build" } }
    expect(stripLegacyMessageID(data)).toEqual({ type: "user", metadata: { agent: "build" } })
  })

  it("drops metadata entirely when the association was the only entry", () => {
    const data = { type: "user", metadata: { opencodeLegacyMessageID: "msg_1" } }
    expect(stripLegacyMessageID(data)).toEqual({ type: "user", metadata: undefined })
  })

  it("returns the input unchanged when metadata is absent or lacks the key", () => {
    expect(stripLegacyMessageID({ type: "user" })).toEqual({ type: "user" })
    expect(stripLegacyMessageID({ type: "user", metadata: { agent: "build" } })).toEqual({
      type: "user",
      metadata: { agent: "build" },
    })
  })
})

describe("matchLegacyMessage", () => {
  const messages = [
    message("msg_aaa", "user", 100),
    message("msg_bbb", "assistant", 100),
    message("msg_ccc", "user", 200),
  ]

  it("matches by legacy id first, regardless of timestamp", () => {
    const { target, matchedBy } = matchLegacyMessage(messages, "user", "msg_ccc", 100)
    expect(matchedBy).toBe("legacy-id")
    expect(target?.info.id).toBe("msg_ccc")
  })

  it("falls back to same-role + same-millisecond timestamp when no legacy id", () => {
    const { target, matchedBy } = matchLegacyMessage(messages, "user", undefined, 100)
    expect(matchedBy).toBe("timestamp")
    expect(target?.info.id).toBe("msg_aaa")
  })

  it("does not fall back across roles", () => {
    const { target, matchedBy } = matchLegacyMessage(messages, "assistant", undefined, 200)
    expect(matchedBy).toBe("none")
    expect(target).toBeUndefined()
  })

  it("returns none when nothing matches", () => {
    const { target, matchedBy } = matchLegacyMessage(messages, "user", undefined, 999)
    expect(matchedBy).toBe("none")
    expect(target).toBeUndefined()
  })

  it("prefers legacy id over the timestamp fallback", () => {
    const { target, matchedBy } = matchLegacyMessage(messages, "user", "msg_ccc", 999)
    expect(matchedBy).toBe("legacy-id")
    expect(target?.info.id).toBe("msg_ccc")
  })
})
