import { describe, expect, test } from "bun:test"
import { toKind } from "../../../src/tool/shell/id"

describe("tool/shell/id", () => {
  describe("toKind", () => {
    test("returns the exact kind for valid inputs", () => {
      expect(toKind("bash")).toBe("bash")
      expect(toKind("pwsh")).toBe("pwsh")
      expect(toKind("powershell")).toBe("powershell")
      expect(toKind("cmd")).toBe("cmd")
    })

    test("defaults to 'bash' for invalid inputs", () => {
      expect(toKind("sh")).toBe("bash")
      expect(toKind("zsh")).toBe("bash")
      expect(toKind("unknown")).toBe("bash")
      expect(toKind("")).toBe("bash")
    })
  })
})
