import { test, expect } from "bun:test"
import { configEntryNameFromPath } from "../../src/config/entry-name"

test("extracts name with a single search root at root", () => {
  // When the search root starts at position 0, the leading / is preserved
  expect(configEntryNameFromPath("/configs/agent/my-agent.md", ["/configs"])).toBe("/agent/my-agent")
})

test("falls back to basename when search root is not found", () => {
  expect(configEntryNameFromPath("/other/file.md", ["/configs"])).toBe("file")
})

test("strips extension from matched path", () => {
  expect(configEntryNameFromPath("/configs/agent/my-agent.json", ["/configs"])).toBe("/agent/my-agent")
})

test("matches the first matching search root when multiple are provided", () => {
  expect(configEntryNameFromPath("/a/agent/x.md", ["/b", "/a"])).toBe("/agent/x")
})

test("returns basename without extension for a simple file", () => {
  expect(configEntryNameFromPath("/configs/hello.json", ["/configs"])).toBe("/hello")
})
