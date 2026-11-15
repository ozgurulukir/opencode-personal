import { describe, expect, test } from "bun:test"
import type { Event } from "@opencode-ai/sdk/v2/client"
import { coalesceEventKey } from "./global-sdk"

describe("coalesceEventKey", () => {
  test("coalesces full-state idempotent status events", () => {
    const event = {
      type: "session.next.status",
      properties: { sessionID: "ses_1", status: { type: "busy" } },
    } as unknown as Event

    expect(coalesceEventKey("/tmp/repo", event)).toBe("session.next.status:/tmp/repo:ses_1")
  })

  test("coalesces lsp.updated, session.next.todo, session.next.diff, and tool.progress", () => {
    const lsp = { type: "lsp.updated", properties: {} } as unknown as Event
    const todo = { type: "session.next.todo", properties: { sessionID: "s1" } } as unknown as Event
    const diff = { type: "session.next.diff", properties: { sessionID: "s1" } } as unknown as Event
    const progress = { type: "session.next.tool.progress", properties: { callID: "c1" } } as unknown as Event

    expect(coalesceEventKey("/tmp/repo", lsp)).toBe("lsp.updated:/tmp/repo")
    expect(coalesceEventKey("/tmp/repo", todo)).toBe("session.next.todo:/tmp/repo:s1")
    expect(coalesceEventKey("/tmp/repo", diff)).toBe("session.next.diff:/tmp/repo:s1")
    expect(coalesceEventKey("/tmp/repo", progress)).toBe("session.next.tool.progress:/tmp/repo:c1")
  })

  test("does NOT coalesce session.next.updated partial patches to prevent dropping titles", () => {
    const titleUpdate = {
      type: "session.next.updated",
      properties: { sessionID: "ses_1", info: { title: "Generated Title" } },
    } as unknown as Event

    const touchUpdate = {
      type: "session.next.updated",
      properties: { sessionID: "ses_1", info: { time: { updated: 100 } } },
    } as unknown as Event

    expect(coalesceEventKey("/tmp/repo", titleUpdate)).toBeUndefined()
    expect(coalesceEventKey("/tmp/repo", touchUpdate)).toBeUndefined()
  })
})
