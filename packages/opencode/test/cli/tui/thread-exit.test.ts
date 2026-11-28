import { describe, expect, spyOn, test } from "bun:test"
import { TuiThreadCommand } from "../../../src/cli/cmd/tui/thread"

describe("tui thread exit codes", () => {
  test("failed --fork records exit code 1", async () => {
    const exit = spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit)
    const prevCode = process.exitCode
    try {
      process.exitCode = undefined
      await TuiThreadCommand.handler({ fork: true } as never)
      // The validation paths return before the wrapper's explicit exit; the
      // recorded code is what the CLI entry's final process.exit propagates.
      expect(process.exitCode ?? 0).toBe(1)
    } finally {
      // Bun ignores an `undefined` assignment here (the recorded code would
      // leak into the runner's own exit status).
      process.exitCode = prevCode ?? 0
      exit.mockRestore()
    }
  })
})
