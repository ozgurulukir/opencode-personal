// Characterization tests (Rule 3, #380 Phase 1/2): lock the context-tool-group
// helper surface (contextToolDetail / contextToolTrigger) in message-part.tsx
// before the god-file split. They import from message-part.tsx now and follow
// the helpers into message-part-context.tsx.
import { afterAll, describe, expect, mock, test } from "bun:test"

// message-part.tsx imports @solidjs/router, which reads window.history at module
// load (node_modules/@solidjs/router/dist/index.js:43) — bun test has no DOM.
mock.module("@solidjs/router", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => () => {},
}))
// contextToolTrigger resolves directories via useData(); getToolInfo reads i18n.
// Both throw outside a real provider — stub them with fixed test values.
mock.module("../context", () => ({
  useData: () => ({ directory: "/proj", store: {} }),
}))
afterAll(() => mock.restore())

// Static import would run before mock.module (imports are hoisted) — dynamic
// import after the mock is required.
import { dict as en } from "../i18n/en"

const { contextToolDetail, contextToolTrigger } = await import("./message-part")

// Real en dict behind a minimal accessor - contextToolTrigger takes the i18n
// object as a parameter, so the translations double as assertions.
const i18n = {
  locale: () => "en",
  t: (key: string) => en[key] ?? key,
} as Parameters<typeof contextToolTrigger>[1]

const part = (overrides: Record<string, unknown>): ToolPartLike =>
  ({
    id: "p1",
    type: "tool",
    tool: "__unknown_test_tool",
    state: { status: "pending", input: {} },
    ...overrides,
  }) as ToolPartLike

type ToolPartLike = Parameters<typeof contextToolDetail>[0]

describe("contextToolDetail", () => {
  test("prefers the registry subtitle", () => {
    const p = part({ tool: "read", state: { status: "completed", input: { filePath: "/proj/src/a.ts" } } })
    expect(contextToolDetail(p)).toBe("a.ts")
  })

  test("returns the state error for error status when the registry has no subtitle", () => {
    const p = part({ state: { status: "error", input: {}, error: "boom" } })
    expect(contextToolDetail(p)).toBe("boom")
  })

  test("falls back to the state title for running/completed status", () => {
    expect(contextToolDetail(part({ state: { status: "running", input: {}, title: "T" } }))).toBe("T")
    expect(contextToolDetail(part({ state: { status: "completed", input: {}, title: "T" } }))).toBe("T")
  })

  test("ignores the state title for pending status", () => {
    expect(contextToolDetail(part({ state: { status: "pending", input: {}, title: "T" } }))).toBeUndefined()
  })

  test("falls back to a string input description", () => {
    expect(contextToolDetail(part({ state: { status: "pending", input: { description: "do it" } } }))).toBe("do it")
  })

  test("ignores a non-string description and returns undefined when nothing applies", () => {
    expect(
      contextToolDetail(part({ state: { status: "pending", input: { description: 42 } } })),
    ).toBeUndefined()
  })

  test("metadata passed through to the registry lookup does not break the fallback chain", () => {
    const p = part({
      tool: "read",
      state: { status: "pending", input: { description: "desc" }, metadata: { ignored: true } },
    })
    expect(contextToolDetail(p)).toBe("desc")
  })
})

describe("contextToolTrigger", () => {
  test("read shows the filename plus offset/limit args", () => {
    const p = part({ tool: "read", state: { status: "pending", input: { filePath: "/proj/src/a.ts", offset: 5, limit: 20 } } })
    expect(contextToolTrigger(p, i18n)).toEqual({
      title: "Read",
      subtitle: "a.ts",
      args: ["offset=5", "limit=20"],
    })
  })

  test("read without a filePath has an empty subtitle and no args", () => {
    const p = part({ tool: "read", state: { status: "pending", input: {} } })
    expect(contextToolTrigger(p, i18n)).toEqual({ title: "Read", subtitle: "", args: [] })
  })

  test("list relativizes the path against the data directory", () => {
    const p = part({ tool: "list", state: { status: "pending", input: { path: "/proj/sub/dir" } } })
    expect(contextToolTrigger(p, i18n)).toEqual({ title: "List", subtitle: "/sub/" })
  })

  test("glob carries the pattern arg and relativized directory", () => {
    const p = part({ tool: "glob", state: { status: "pending", input: { path: "/proj/sub/dir", pattern: "*.ts" } } })
    expect(contextToolTrigger(p, i18n)).toEqual({
      title: "Glob",
      subtitle: "/sub/",
      args: ["pattern=*.ts"],
    })
  })

  test("grep lists pattern before include", () => {
    const p = part({
      tool: "grep",
      state: { status: "pending", input: { path: "/proj/sub/dir", include: "*.go", pattern: "TODO" } },
    })
    expect(contextToolTrigger(p, i18n)).toEqual({
      title: "Grep",
      subtitle: "/sub/",
      args: ["pattern=TODO", "include=*.go"],
    })
  })

  test("non-string input values are ignored for read args", () => {
    const p = part({ tool: "read", state: { status: "pending", input: { filePath: "/proj/a.ts", offset: "x" } } })
    const result = contextToolTrigger(p, i18n)
    expect(result.args).toEqual([])
  })

  test("unknown tools fall back to the registry title/detail chain", () => {
    const p = part({ state: { status: "pending", input: { description: "desc" } } })
    expect(contextToolTrigger(p, i18n)).toEqual({ title: "__unknown_test_tool", subtitle: "desc", args: [] })
  })
})
