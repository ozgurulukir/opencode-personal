import { afterAll, describe, expect, mock, test } from "bun:test"

// message-part.tsx imports @solidjs/router, which reads window.history at module
// load (node_modules/@solidjs/router/dist/index.js:43) — bun test has no DOM.
// Stub only what the module graph needs; no other ui test imports the router.
mock.module("@solidjs/router", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => () => {},
}))
afterAll(() => mock.restore())

// Static import would run before mock.module (imports are hoisted) — dynamic import
// after the mock is required. Top-level await is supported in bun test files.
const { ToolRegistry, registerTool, getTool, getToolInfo, PART_MAPPING, registerPartComponent } = await import(
  "./message-part"
)

describe("ToolRegistry", () => {
  test("registerTool stores the renderer under the given name and returns the input", () => {
    const render = () => null
    const input = { name: "__mp_test_store", render }
    const result = registerTool(input)
    expect(result).toBe(input)
    expect(getTool("__mp_test_store")).toBe(render)
  })

  test("getTool returns the registered renderer for a known tool", () => {
    const render = () => null
    registerTool({ name: "__mp_test_known", render })
    expect(getTool("__mp_test_known")).toBe(render)
  })

  test("getTool returns undefined for an unregistered tool name", () => {
    expect(getTool("__mp_test_unregistered")).toBeUndefined()
  })

  test("registering the same tool name twice keeps only the latest renderer", () => {
    const first = () => null
    const second = () => null
    registerTool({ name: "__mp_test_override", render: first })
    registerTool({ name: "__mp_test_override", render: second })
    expect(getTool("__mp_test_override")).toBe(second)
    expect(getTool("__mp_test_override")).not.toBe(first)
  })

  test("registering a tool without a renderer leaves lookup returning undefined", () => {
    registerTool({ name: "__mp_test_norender" })
    expect(getTool("__mp_test_norender")).toBeUndefined()
  })

  test("ToolRegistry exposes register and render as aliases of the standalone functions", () => {
    expect(ToolRegistry.register).toBe(registerTool)
    expect(ToolRegistry.render).toBe(getTool)
  })

  test("ToolRegistry surface is exactly register and render", () => {
    expect(Object.keys(ToolRegistry).sort()).toEqual(["register", "render"])
  })

  test("every built-in tool registered at module load resolves to a renderer", () => {
    const builtins = [
      "read",
      "list",
      "glob",
      "grep",
      "webfetch",
      "websearch",
      "task",
      "bash",
      "edit",
      "write",
      "apply_patch",
      "todowrite",
      "question",
      "skill",
    ]
    const missing = builtins.filter((name) => typeof getTool(name) !== "function")
    expect(missing).toEqual([])
  })

  test("unknown tool lookup yields undefined so ToolPartDisplay falls back to GenericTool", () => {
    // Locks the `getTool(...) ?? GenericTool` composition at message-part.tsx:1392
    // from the registry side: a miss falls through to the fallback, a hit wins.
    const fallback = () => null
    expect(getTool("definitely_missing")).toBeUndefined()
    expect(getTool("definitely_missing") ?? fallback).toBe(fallback)
    const render = () => null
    registerTool({ name: "__mp_test_fallback_hit", render })
    expect(getTool("__mp_test_fallback_hit") ?? fallback).toBe(render)
  })
})

describe("PART_MAPPING", () => {
  test("built-in part types tool, text, reasoning and compaction have renderers after module load", () => {
    const builtins = ["tool", "text", "reasoning", "compaction"]
    const missing = builtins.filter((type) => typeof PART_MAPPING[type] !== "function")
    expect(missing).toEqual([])
  })

  test("unknown part types have no renderer so Part renders nothing", () => {
    expect(PART_MAPPING["__mp_missing__"]).toBeUndefined()
  })

  test("registerPartComponent adds a renderer for a new part type", () => {
    const component = () => null
    registerPartComponent("__mp_test_part_new", component)
    expect(PART_MAPPING["__mp_test_part_new"]).toBe(component)
  })

  test("registerPartComponent replaces the renderer for an existing part type", () => {
    const first = () => null
    const second = () => null
    registerPartComponent("__mp_test_part_override", first)
    registerPartComponent("__mp_test_part_override", second)
    expect(PART_MAPPING["__mp_test_part_override"]).toBe(second)
    expect(PART_MAPPING["__mp_test_part_override"]).not.toBe(first)
  })
})

describe("getToolInfo", () => {
  test("read tool info shows the file basename as the subtitle", () => {
    expect(getToolInfo("read", { filePath: "/a/b.ts" })).toEqual({
      icon: "glasses",
      title: "Read",
      subtitle: "b.ts",
    })
  })

  test("read tool info has no subtitle when filePath is missing", () => {
    expect(getToolInfo("read")).toEqual({ icon: "glasses", title: "Read", subtitle: undefined })
  })

  test("list tool info shows the file basename from the path", () => {
    expect(getToolInfo("list", { path: "/x/y" })).toEqual({
      icon: "bullet-list",
      title: "List",
      subtitle: "y",
    })
  })

  test("glob and grep tool info surface the search pattern as the subtitle", () => {
    expect(getToolInfo("glob", { pattern: "*.ts" })).toEqual({
      icon: "magnifying-glass-menu",
      title: "Glob",
      subtitle: "*.ts",
    })
    expect(getToolInfo("grep", { pattern: "TODO" })).toEqual({
      icon: "magnifying-glass-menu",
      title: "Grep",
      subtitle: "TODO",
    })
  })

  test("webfetch tool info shows the url as the subtitle", () => {
    expect(getToolInfo("webfetch", { url: "https://example.com" })).toEqual({
      icon: "window-cursor",
      title: "Webfetch",
      subtitle: "https://example.com",
    })
  })

  test("websearch tool info labels parallel and exa providers", () => {
    expect(getToolInfo("websearch", { query: "solidjs" }, { provider: "parallel" })).toEqual({
      icon: "window-cursor",
      title: "Parallel Web Search",
      subtitle: "solidjs",
    })
    expect(getToolInfo("websearch", { query: "solidjs" }, { provider: "exa" })).toEqual({
      icon: "window-cursor",
      title: "Exa Web Search",
      subtitle: "solidjs",
    })
  })

  test("websearch tool info falls back to Web Search for unknown providers", () => {
    expect(getToolInfo("websearch", { query: "solidjs" }, { provider: "unknown" }).title).toBe("Web Search")
  })

  test("task tool info capitalizes the subagent type in the title", () => {
    expect(getToolInfo("task", { subagent_type: "plan" }).title).toBe("Plan Agent")
  })

  test("task tool info defaults to Agent when no subagent type is given", () => {
    expect(getToolInfo("task", { description: "do it" })).toEqual({
      icon: "task",
      title: "Agent",
      subtitle: "do it",
    })
    expect(getToolInfo("task", { subagent_type: "", description: "do it" }).title).toBe("Agent")
  })

  test("bash tool info shows the description as the subtitle", () => {
    expect(getToolInfo("bash", { description: "ls -la" })).toEqual({
      icon: "console",
      title: "Shell",
      subtitle: "ls -la",
    })
  })

  test("edit and write tool info show the file basename", () => {
    expect(getToolInfo("edit", { filePath: "/a/b.ts" })).toEqual({
      icon: "code-lines",
      title: "Edit",
      subtitle: "b.ts",
    })
    expect(getToolInfo("write", { filePath: "/a/c.ts" })).toEqual({
      icon: "code-lines",
      title: "Write",
      subtitle: "c.ts",
    })
  })

  test("apply_patch tool info pluralizes the file count", () => {
    expect(getToolInfo("apply_patch", { files: ["a.ts"] }).subtitle).toBe("1 file")
    expect(getToolInfo("apply_patch", { files: ["a.ts", "b.ts"] }).subtitle).toBe("2 files")
  })

  test("unknown tools fall back to the mcp icon and the raw tool name", () => {
    expect(getToolInfo("__mp_unknown_tool")).toEqual({
      icon: "mcp",
      title: "__mp_unknown_tool",
    })
  })
})
