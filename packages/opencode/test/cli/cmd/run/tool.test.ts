import { describe, expect, test } from "bun:test"
import {
  toolInlineInfo,
  toolScroll,
  toolPermissionInfo,
  toolSnapshot,
  toolView,
  toolStructuredFinal,
  toolEntryBody,
  toolPath,
} from "../../../../src/cli/cmd/run/tool"

function makePart(overrides: Record<string, unknown> = {}): any {
  return {
    id: "part_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool: "read",
    state: {
      status: "completed",
      input: { filePath: "/tmp/test.txt" },
      output: "file content",
      title: "read",
      metadata: {},
    },
    ...overrides,
  }
}

function makeFrame(overrides: Record<string, unknown> = {}): any {
  return {
    raw: "raw output",
    name: "read",
    input: { filePath: "/tmp/test.txt" },
    meta: {},
    state: { status: "completed", output: "file content", time: { start: 1000, end: 2000 } },
    status: "completed",
    error: "",
    ...overrides,
  }
}

function makeCommit(overrides: Record<string, unknown> = {}): any {
  return {
    kind: "tool",
    text: "text",
    phase: "final",
    source: "tool",
    tool: "read",
    part: makePart(),
    toolState: "completed",
    toolError: "",
    ...overrides,
  }
}

describe("tool.inline", () => {
  test("fallback when no rule matches", () => {
    const part = makePart({ tool: "unknown_tool" })
    const info = toolInlineInfo(part)
    expect(info.icon).toBe("⚙")
    expect(info.title).toContain("unknown_tool")
  })

  test("returns rule output for known tool", () => {
    const part = makePart({
      tool: "bash",
      state: { status: "completed", input: { command: "ls" }, output: "", title: "bash", metadata: {} },
    })
    const info = toolInlineInfo(part)
    expect(info.icon).toBe("$")
    expect(info.title).toBe("ls")
  })

  test("fallback for invalid bash input", () => {
    const part = makePart({
      tool: "bash",
      state: { status: "completed", input: undefined, output: "", title: "bash", metadata: {} },
    })
    const info = toolInlineInfo(part)
    expect(info.icon).toBe("$")
    expect(info.title).toBe("")
  })
})

describe("tool.scroll", () => {
  test("fallback start for unknown tool", () => {
    const result = toolScroll("start", makeFrame({ name: "unknown" }))
    expect(result).toContain("⚙")
    expect(result).toContain("unknown")
  })

  test("fallback progress returns raw", () => {
    const result = toolScroll("progress", makeFrame({ name: "unknown", raw: "some output" }))
    expect(result).toBe("some output")
  })

  test("fallback final shows duration with decimal", () => {
    const result = toolScroll(
      "final",
      makeFrame({
        name: "unknown",
        status: "completed",
        state: { status: "completed", time: { start: 1000, end: 2000 } },
      }),
    )
    expect(result).toBe("unknown completed · 1.0s")
  })

  test("fallback final shows error for failed tool", () => {
    const result = toolScroll("final", makeFrame({ name: "unknown", status: "error", error: "boom" }))
    expect(result).toContain("failed")
    expect(result).toContain("boom")
  })

  test("uses rule scroll when available", () => {
    const result = toolScroll("start", makeFrame({ name: "read" }))
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })
})

describe("tool.permissionInfo", () => {
  test("returns undefined when no rule matches", () => {
    const result = toolPermissionInfo("unknown_tool", {}, {}, [])
    expect(result).toBeUndefined()
  })

  test("returns permission info for known tool", () => {
    const result = toolPermissionInfo("edit", { filePath: "/tmp/test.txt" }, {}, ["**/*.ts"])
    expect(result).toBeDefined()
    expect(result!.icon).toBeTruthy()
    expect(result!.title).toBeTruthy()
  })

  test("returns permission info for read tool", () => {
    const result = toolPermissionInfo("read", { filePath: "/tmp/test.txt" }, {}, [])
    expect(result).toBeDefined()
    expect(result!.icon).toBeTruthy()
  })
})

describe("tool.snapshot", () => {
  test("returns undefined when no rule matches", () => {
    const result = toolSnapshot(makeCommit({ tool: "unknown_tool" }), "raw")
    expect(result).toBeUndefined()
  })

  test("returns undefined when not completed", () => {
    const result = toolSnapshot(makeCommit({ toolState: "running" }), "raw")
    expect(result).toBeUndefined()
  })

  test("returns snapshot for edit tool with diff metadata", () => {
    const commit = makeCommit({
      tool: "edit",
      part: makePart({
        tool: "edit",
        state: {
          status: "completed",
          input: { filePath: "/tmp/test.txt" },
          output: "edited",
          title: "edit",
          metadata: { diff: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new" },
        },
      }),
    })
    const result = toolSnapshot(commit, "raw")
    expect(result).toBeDefined()
    expect(result!.kind).toBe("diff")
    expect((result as any).items[0].file).toBe("/tmp/test.txt")
  })

  test("catches errors and returns undefined", () => {
    const commit = makeCommit({
      tool: "edit",
      part: makePart({
        tool: "edit",
        state: { status: "completed", input: null as any, output: "", title: "edit", metadata: {} },
      }),
    })
    const result = toolSnapshot(commit, "raw")
    expect(result).toBeUndefined()
  })
})

describe("tool.view", () => {
  test("returns default view for unknown tool", () => {
    const view = toolView("unknown")
    expect(view.output).toBe(true)
    expect(view.final).toBe(true)
    expect(view.snap).toBeUndefined()
  })

  test("returns rule view for known tool", () => {
    const view = toolView("read")
    expect(typeof view.output).toBe("boolean")
    expect(typeof view.final).toBe("boolean")
  })
})

describe("tool.structuredFinal", () => {
  test("returns false for non-tool commits", () => {
    expect(toolStructuredFinal({ ...makeCommit(), kind: "user" })).toBe(false)
  })

  test("returns false for non-final phase", () => {
    expect(toolStructuredFinal({ ...makeCommit(), phase: "start" })).toBe(false)
  })

  test("returns false for non-completed state", () => {
    expect(toolStructuredFinal({ ...makeCommit(), toolState: "running" })).toBe(false)
  })

  test("returns true for completed tool with snap view", () => {
    const result = toolStructuredFinal(
      makeCommit({
        tool: "edit",
        part: makePart({
          tool: "edit",
          state: {
            status: "completed",
            input: { filePath: "/tmp/test.txt" },
            output: "edited",
            title: "edit",
            metadata: { diff: "diff" },
          },
        }),
      }),
    )
    expect(result).toBe(true)
  })
})

describe("tool.path", () => {
  test("returns empty string for empty input", () => {
    expect(toolPath("")).toBe("")
    expect(toolPath()).toBe("")
  })

  test("resolves relative path", () => {
    const result = toolPath("src/file.ts")
    expect(result).toBe("src/file.ts")
  })

  test("returns absolute path for absolute input", () => {
    const result = toolPath("/tmp/test.txt")
    expect(result).toBe("/tmp/test.txt")
  })
})

describe("tool.entryBody", () => {
  test("returns undefined for task start", () => {
    const commit = makeCommit({ tool: "task", phase: "start", part: makePart({ tool: "task" }) })
    expect(toolEntryBody(commit, "raw")).toBeUndefined()
  })

  test("returns structured body for completed edit with snap", () => {
    const commit = makeCommit({
      tool: "edit",
      phase: "final",
      part: makePart({
        tool: "edit",
        state: {
          status: "completed",
          input: { filePath: "/tmp/test.txt", oldString: "old", newString: "new" },
          output: "edited",
          title: "edit",
          metadata: { diff: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new" },
        },
      }),
    })
    const body = toolEntryBody(commit, "raw")
    expect(body).toBeDefined()
    expect(body!.type).toBe("structured")
  })
})
