import { describe, expect, test } from "bun:test"
import { Session } from "@/session/session"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { Permission } from "@/permission"
import { ProjectID } from "@/project/schema"
import { WorkspaceID } from "@/control-plane/schema"

describe("Session schemas — characterization", () => {
  test("Info roundtrip through zod", () => {
    const raw = {
      id: SessionID.make("ses_123"),
      slug: "test-slug",
      projectID: ProjectID.make("proj_1"),
      directory: "/tmp/test",
      title: "Test Session",
      version: "1",
      time: { created: 1000, updated: 2000 },
    }
    const parsed = Session.Info.zod.parse(raw)
    expect(parsed.id).toBe(raw.id)
    expect(parsed.slug).toBe(raw.slug)
    expect(parsed.title).toBe(raw.title)
  })

  test("Info with optional fields roundtrip", () => {
    const raw = {
      id: SessionID.make("ses_456"),
      slug: "slug",
      projectID: ProjectID.make("proj_1"),
      directory: "/tmp/test",
      title: "Session with options",
      version: "1",
      time: { created: 1000, updated: 2000 },
      parentID: SessionID.make("ses_parent"),
      workspaceID: WorkspaceID.make("wrk_1"),
      agent: "plan",
      model: { id: ModelID.make("m1"), providerID: ProviderID.make("p1") },
      permission: [],
      summary: { additions: 10, deletions: 5, files: 2 },
      share: { url: "https://example.com/share" },
      revert: { messageID: MessageID.make("msg_1") },
    }
    const parsed = Session.Info.zod.parse(raw)
    expect(parsed.parentID).toBe(raw.parentID)
    expect(parsed.workspaceID).toBe(raw.workspaceID)
    expect(parsed.agent).toBe("plan")
    expect(parsed.model?.id).toBe(raw.model!.id)
    expect(parsed.permission).toEqual([])
    expect(parsed.summary?.additions).toBe(10)
    expect(parsed.share?.url).toBe("https://example.com/share")
    expect(parsed.revert?.messageID).toBe(raw.revert!.messageID)
  })

  test("ProjectInfo roundtrip", () => {
    const raw = {
      id: ProjectID.make("proj_1"),
      name: "My Project",
      worktree: "/home/user/project",
    }
    const parsed = Session.ProjectInfo.zod.parse(raw)
    expect(parsed.id).toBe(raw.id)
    expect(parsed.name).toBe("My Project")
    expect(parsed.worktree).toBe("/home/user/project")
  })

  test("CreateInput accepts minimal fields", () => {
    const raw = { title: "New Session" }
    const parsed = Session.CreateInput.zod.parse(raw)
    expect(parsed!.title).toBe("New Session")
  })

  test("ForkInput requires sessionID", () => {
    const raw = { sessionID: SessionID.make("ses_1") }
    const parsed = Session.ForkInput.zod.parse(raw)
    expect(parsed.sessionID).toBe(raw.sessionID)
  })

  test("SetArchivedInput accepts optional time", () => {
    const raw = { sessionID: SessionID.make("ses_1") }
    const parsed = Session.SetArchivedInput.zod.parse(raw)
    expect(parsed.sessionID).toBe(raw.sessionID)
    expect(parsed.time).toBeUndefined()
  })

  test("SetPermissionInput accepts ruleset", () => {
    const raw = { sessionID: SessionID.make("ses_1"), permission: [{ permission: "read", pattern: "**", action: "allow" as const }] }
    const parsed = Session.SetPermissionInput.zod.parse(raw)
    expect(parsed.sessionID).toBe(raw.sessionID)
    expect(parsed.permission).toHaveLength(1)
  })

  test("MessagesInput accepts limit", () => {
    const raw = { sessionID: SessionID.make("ses_1"), limit: 50 }
    const parsed = Session.MessagesInput.zod.parse(raw)
    expect(parsed.sessionID).toBe(raw.sessionID)
    expect(parsed.limit).toBe(50)
  })

  test("Event.Created definition is accessible", () => {
    expect(() => Session.Event.Created).not.toThrow()
    expect(Session.Event.Created.type).toBe("session.created")
  })
})
