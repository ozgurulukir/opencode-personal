import { describe, expect, it } from "bun:test"
import projectorsNext from "@/session/projectors-next"

/**
 * Characterization lock for the projector registry: every SessionEvent.* Sync
 * definition must keep a registration in projectors-next, otherwise
 * SyncEvent.run throws "Projector not found" when the event is published.
 */
const expectedTypes = [
  "session.next.agent.switched",
  "session.next.model.switched",
  "session.next.prompted",
  "session.next.synthetic",
  "session.next.shell.started",
  "session.next.shell.ended",
  "session.next.step.started",
  "session.next.step.ended",
  "session.next.step.failed",
  "session.next.text.started",
  "session.next.text.delta",
  "session.next.text.ended",
  "session.next.tool.input.started",
  "session.next.tool.input.delta",
  "session.next.tool.input.ended",
  "session.next.tool.progress",
  "session.next.tool.called",
  "session.next.tool.success",
  "session.next.tool.failed",
  "session.next.reasoning.started",
  "session.next.reasoning.delta",
  "session.next.reasoning.ended",
  "session.next.retried",
  "session.next.compaction.started",
  "session.next.compaction.delta",
  "session.next.compaction.ended",
  "session.next.deleted",
  "session.next.diff",
  "session.next.permission.asked",
  "session.next.permission.replied",
  "session.next.status",
  "session.next.todo",
  "session.next.updated",
]

describe("projectors-next registry", () => {
  it("registers exactly one projector per known SessionEvent Sync type", () => {
    const types = projectorsNext.map(([def]) => def.type).sort()
    expect(types).toEqual([...expectedTypes].sort())
    const unique = new Set(projectorsNext.map(([def]) => def.type))
    expect(unique.size).toBe(projectorsNext.length)
  })
})
