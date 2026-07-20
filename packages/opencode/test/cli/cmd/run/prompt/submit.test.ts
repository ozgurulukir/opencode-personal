import { describe, expect, test } from "bun:test"
import { parseSlashCommand, shouldExit, validateSubmit } from "@/cli/cmd/run/prompt/submit"
import type { RunCommand, RunPrompt } from "@/cli/cmd/run/types"

function prompt(text: string, parts: RunPrompt["parts"] = []): RunPrompt {
  return { text, parts }
}

const commands: RunCommand[] = [
  { name: "test", description: "run tests", source: "command", template: "", hints: [] },
  { name: "lint", description: "lint code", source: "command", template: "", hints: [] },
]

describe("parseSlashCommand", () => {
  test("returns none for non-slash text", () => {
    expect(parseSlashCommand("hello", commands)).toEqual({ type: "none" })
  })

  test("returns none for empty name after slash", () => {
    expect(parseSlashCommand("/", commands)).toEqual({ type: "none" })
  })

  test("returns pending when commands are undefined", () => {
    expect(parseSlashCommand("/test", undefined)).toEqual({ type: "pending" })
  })

  test("returns none for unknown command", () => {
    expect(parseSlashCommand("/unknown", commands)).toEqual({ type: "none" })
  })

  test("returns command for known command", () => {
    expect(parseSlashCommand("/test", commands)).toEqual({
      type: "command",
      command: { name: "test", arguments: "" },
    })
  })

  test("parses command arguments", () => {
    expect(parseSlashCommand("/test foo bar", commands)).toEqual({
      type: "command",
      command: { name: "test", arguments: "foo bar" },
    })
  })
})

describe("shouldExit", () => {
  test("detects /exit", () => {
    expect(shouldExit(prompt("/exit"))).toBe(true)
  })

  test("detects /quit", () => {
    expect(shouldExit(prompt("/quit"))).toBe(true)
  })

  test("detects :q", () => {
    expect(shouldExit(prompt(":q"))).toBe(true)
  })

  test("detects /EXIT case-insensitively", () => {
    expect(shouldExit(prompt(" /EXIT "))).toBe(true)
  })

  test("returns false for non-exit text", () => {
    expect(shouldExit(prompt("hello"))).toBe(false)
  })
})

describe("validateSubmit", () => {
  test("returns empty for blank text", () => {
    expect(validateSubmit(prompt("   "), commands)).toEqual({ type: "empty" })
  })

  test("returns exit for exit command", () => {
    expect(validateSubmit(prompt("/exit"), commands)).toEqual({ type: "exit" })
  })

  test("returns pending when commands not loaded", () => {
    expect(validateSubmit(prompt("/test"), undefined)).toEqual({ type: "pending" })
  })

  test("returns valid with no command for plain text", () => {
    expect(validateSubmit(prompt("hello"), commands)).toEqual({ type: "valid", command: undefined })
  })

  test("returns valid with command for known slash command", () => {
    expect(validateSubmit(prompt("/test"), commands)).toEqual({
      type: "valid",
      command: { name: "test", arguments: "" },
    })
  })

  test("returns valid with no command for /new (bypasses slash parsing)", () => {
    expect(validateSubmit(prompt("/new"), commands)).toEqual({ type: "valid", command: undefined })
  })
})
