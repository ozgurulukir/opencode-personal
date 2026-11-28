import { describe, expect, test } from "bun:test"
import { mergeSessionLists } from "../../../../src/cli/cmd/tui/context/sync"
import type { Session } from "@opencode-ai/sdk/v2"

function session(id: string, title = id): Session {
  return { id, title } as Session
}

describe("mergeSessionLists", () => {
  test("keeps a store-only session absent from the fetched snapshot", () => {
    // A session.created event landed in the store before the list resolved;
    // the server-side snapshot does not know it yet.
    const merged = mergeSessionLists([session("ses_b")], [session("ses_a"), session("ses_b"), session("ses_c")])
    expect(merged.map((s) => s.id)).toEqual(["ses_a", "ses_b", "ses_c"])
  })

  test("fetched rows win for ids present in both", () => {
    const merged = mergeSessionLists([{ ...session("ses_b"), title: "from-server" } as Session], [
      { ...session("ses_b"), title: "from-event" } as Session,
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].title).toBe("from-server")
  })

  test("output is sorted by id", () => {
    const merged = mergeSessionLists([session("ses_z"), session("ses_a")], [session("ses_m")])
    expect(merged.map((s) => s.id)).toEqual(["ses_a", "ses_m", "ses_z"])
  })

  test("an empty snapshot does not wipe the store", () => {
    const merged = mergeSessionLists([], [session("ses_a"), session("ses_b")])
    expect(merged.map((s) => s.id)).toEqual(["ses_a", "ses_b"])
  })
})
