import { expect, test } from "bun:test"
import { toolsToPermissions } from "@/permission/tools"

test("legacy tool permissions preserve literal names unless edit folding is requested", () => {
  const tools = { write: true, patch: false, "mcp_*": true }
  expect(toolsToPermissions(tools)).toEqual({ write: "allow", patch: "deny", "mcp_*": "allow" })
  expect(toolsToPermissions(tools, { foldEdit: true })).toEqual({ edit: "deny", "mcp_*": "allow" })
  expect(tools).toEqual({ write: true, patch: false, "mcp_*": true })
  expect(toolsToPermissions()).toEqual({})
})
