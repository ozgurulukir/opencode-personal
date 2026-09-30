import { describe, expect, it } from "bun:test"
import type { SessionMessage, SessionMessageAssistant, SessionMessageUser } from "@opencode-ai/sdk/v2"
import {
  dropRevertedRange,
  firstUserAfterBoundary,
  lastUserBeforeBoundary,
  revertClearDropBoundary,
  usersFromBoundary,
} from "@/cli/cmd/tui/routes/session/revert-boundary.shared"

// Render-order slice (oldest-first), as produced by the route's messages()
// memo over the newest-first V2 store slice.
// Full SessionMessage objects are unnecessary: the helpers only read id/type.
const user = (id: string) =>
  ({
    id,
    type: "user",
    text: "",
    files: [],
    agents: [],
    agent: "build",
    model: { id: "m", providerID: "p", variant: "default" },
    time: { created: 0 },
  }) as SessionMessageUser
const assistant = (id: string) =>
  ({
    id,
    type: "assistant",
    agent: "build",
    model: { id: "m", providerID: "p", variant: "default" },
    content: [],
    time: { created: 0 },
  }) as SessionMessageAssistant

const slice: SessionMessage[] = [
  user("evt_1"),
  assistant("evt_2"),
  user("evt_3"),
  assistant("evt_4"),
  user("evt_5"),
  assistant("evt_6"),
]

describe("revert boundary helpers", () => {
  it("lastUserBeforeBoundary picks the newest user message below the boundary", () => {
    expect(lastUserBeforeBoundary(slice, "evt_5")?.id).toBe("evt_3")
    expect(lastUserBeforeBoundary(slice, "evt_4")?.id).toBe("evt_3")
  })

  it("lastUserBeforeBoundary without a boundary picks the newest user message", () => {
    expect(lastUserBeforeBoundary(slice, undefined)?.id).toBe("evt_5")
  })

  it("lastUserBeforeBoundary returns undefined when nothing is below the boundary", () => {
    expect(lastUserBeforeBoundary(slice, "evt_1")).toBeUndefined()
  })

  it("firstUserAfterBoundary picks the oldest user message above the boundary", () => {
    expect(firstUserAfterBoundary(slice, "evt_3")?.id).toBe("evt_5")
    expect(firstUserAfterBoundary(slice, "evt_4")?.id).toBe("evt_5")
  })

  it("firstUserAfterBoundary returns undefined at the top of the slice", () => {
    expect(firstUserAfterBoundary(slice, "evt_5")).toBeUndefined()
  })

  it("usersFromBoundary returns every user message at or above the boundary", () => {
    expect(usersFromBoundary(slice, "evt_3").map((m) => m.id)).toEqual(["evt_3", "evt_5"])
    expect(usersFromBoundary(slice, "evt_4").map((m) => m.id)).toEqual(["evt_5"])
    expect(usersFromBoundary(slice, "evt_5").map((m) => m.id)).toEqual(["evt_5"])
    expect(usersFromBoundary(slice, "evt_6")).toEqual([])
  })

  it("dropRevertedRange keeps only messages below the boundary", () => {
    expect(dropRevertedRange(slice, "evt_5").map((m) => m.id)).toEqual(["evt_1", "evt_2", "evt_3", "evt_4"])
    expect(dropRevertedRange(slice, "evt_1")).toEqual([])
    expect(dropRevertedRange(slice, "evt_9").map((m) => m.id)).toEqual(slice.map((m) => m.id))
  })

  it("dropRevertedRange is ordering-agnostic (newest-first store slice)", () => {
    const newestFirst = [...slice].reverse()
    expect(dropRevertedRange(newestFirst, "evt_5").map((m) => m.id)).toEqual(["evt_4", "evt_3", "evt_2", "evt_1"])
  })

  it("revertClearDropBoundary returns the boundary only for armed cleanup clears", () => {
    expect(revertClearDropBoundary("evt_5", true, true)).toBe("evt_5")
    // unrevert: marker clears without a preceding removal — rows must stay
    expect(revertClearDropBoundary("evt_5", true, false)).toBeUndefined()
    // patch that merely omits revert is not a clear
    expect(revertClearDropBoundary("evt_5", false, true)).toBeUndefined()
    expect(revertClearDropBoundary(undefined, true, true)).toBeUndefined()
  })
})
