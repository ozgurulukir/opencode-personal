import { describe, expect, test } from "bun:test"
import { MCP } from "../../src/mcp/index"

function tool(name: string) {
  return { name, description: name, inputSchema: { type: "object", properties: {} } } as any
}

describe("MCP tool key collisions", () => {
  test("first tool wins when two tool names sanitize to the same key", () => {
    const client = {} as any
    const map = MCP.buildToolMap([
      { clientName: "server", client, tools: [tool("get.weather")] },
      { clientName: "server", client, tools: [tool("get_weather")] },
    ])

    expect(Object.keys(map)).toEqual(["mcp_server_get_weather"])
  })

  test("collisions across servers whose names sanitize identically are detected", () => {
    const client = {} as any
    const map = MCP.buildToolMap([
      { clientName: "my.server", client, tools: [tool("run")] },
      { clientName: "my_server", client, tools: [tool("run")] },
    ])

    expect(Object.keys(map)).toEqual(["mcp_my_server_run"])
  })

  test("distinct sanitized keys are all kept", () => {
    const client = {} as any
    const map = MCP.buildToolMap([{ clientName: "server", client, tools: [tool("get-weather"), tool("get.weather")] }])

    expect(Object.keys(map).sort()).toEqual(["mcp_server_get-weather", "mcp_server_get_weather"])
  })
})

describe("MCP cross-client prompt/resource key collisions", () => {
  test("first client wins when two servers sanitize to the same key", () => {
    const merged = MCP.mergeClientEntries("prompts", [
      ["my_server:run", { name: "run", client: "my.server" }],
      ["my_server:run", { name: "run", client: "my_server" }],
    ])

    expect(Object.keys(merged)).toEqual(["my_server:run"])
    expect(merged["my_server:run"].client).toBe("my.server")
  })

  test("distinct keys are all kept", () => {
    const merged = MCP.mergeClientEntries("resources", [
      ["a_server:run", { name: "run", client: "a" }],
      ["b_server:run", { name: "run", client: "b" }],
    ])

    expect(Object.keys(merged).sort()).toEqual(["a_server:run", "b_server:run"])
  })
})
