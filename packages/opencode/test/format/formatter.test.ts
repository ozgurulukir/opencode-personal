import { mock, describe, expect, test, afterAll } from "bun:test"

let mockedWhich: (cmd: string) => string | null = () => null
mock.module("../../src/util/which", () => ({
  which: (cmd: string) => mockedWhich(cmd),
}))

// mock.module() persists across test files — restore to prevent leakage (AGENTS.md).
afterAll(() => mock.restore())

import { gofmt, mix } from "../../src/format/formatter"

describe("Formatter Status Checks", () => {
  test("gofmt is enabled when binary exists", async () => {
    mockedWhich = (cmd) => (cmd === "gofmt" ? "/path/to/gofmt" : null)
    const result = await gofmt.enabled({ directory: "/dummy", worktree: "/dummy" })
    expect(result).toEqual(["/path/to/gofmt", "-w", "$FILE"])
  })

  test("gofmt is disabled when binary does not exist", async () => {
    mockedWhich = () => null
    const result = await gofmt.enabled({ directory: "/dummy", worktree: "/dummy" })
    expect(result).toBe(false)
  })

  test("mix is enabled when binary exists", async () => {
    mockedWhich = (cmd) => (cmd === "mix" ? "/path/to/mix" : null)
    const result = await mix.enabled({ directory: "/dummy", worktree: "/dummy" })
    expect(result).toEqual(["/path/to/mix", "format", "$FILE"])
  })

  test("mix is disabled when binary does not exist", async () => {
    mockedWhich = () => null
    const result = await mix.enabled({ directory: "/dummy", worktree: "/dummy" })
    expect(result).toBe(false)
  })
})
