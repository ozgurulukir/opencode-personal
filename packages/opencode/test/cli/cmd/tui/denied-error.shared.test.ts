import { describe, expect, test } from "bun:test"
import { isDeniedErrorMessage } from "../../../../src/cli/cmd/tui/util/denied-error.shared"

describe("isDeniedErrorMessage (characterization)", () => {
  test.each(["QuestionRejectedError", "rejected permission", "specified a rule", "user dismissed"])(
    "true for message containing %s",
    (needle) => {
      expect(isDeniedErrorMessage(`tool failed: ${needle} for bash`)).toBe(true)
    },
  )

  test("false for undefined and empty messages", () => {
    expect(isDeniedErrorMessage(undefined)).toBe(false)
    expect(isDeniedErrorMessage("")).toBe(false)
  })

  test("false for unrelated error messages", () => {
    expect(isDeniedErrorMessage("Command timed out after 30s")).toBe(false)
    expect(isDeniedErrorMessage("ENOENT: no such file or directory")).toBe(false)
  })
})
