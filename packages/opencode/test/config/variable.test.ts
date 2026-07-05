import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { substitute } from "@/config/variable"

describe("ConfigVariable.substitute", () => {
  test("replaces environment variables", async () => {
    process.env.TEST_OPCODE_VAR = "hello-world"
    const result = await substitute({
      type: "virtual",
      source: "test",
      dir: "/dummy",
      text: "Value is {env:TEST_OPCODE_VAR}",
    })
    expect(result).toBe("Value is hello-world")
    delete process.env.TEST_OPCODE_VAR
  })

  test("replaces file references in virtual mode", async () => {
    await using tmp = await tmpdir()
    const testFile = path.join(tmp.path, "info.txt")
    await Bun.write(testFile, "secret-data")

    const result = await substitute({
      type: "virtual",
      source: "test",
      dir: tmp.path,
      text: "Data: {file:info.txt}",
    })
    expect(result).toBe("Data: secret-data")
  })

  test("ignores file references on commented lines", async () => {
    const result = await substitute({
      type: "virtual",
      source: "test",
      dir: "/dummy",
      text: "// This is a comment: {file:ignored.txt}\nUse: {env:PATH_DUMMY}",
    })
    expect(result).toContain("// This is a comment: {file:ignored.txt}")
  })

  test("handles missing file reference with empty mode", async () => {
    const result = await substitute({
      type: "virtual",
      source: "test",
      dir: "/dummy",
      text: "Value: {file:nonexistent.txt}",
      missing: "empty",
    })
    expect(result).toBe("Value: ")
  })

  test("throws InvalidError on missing file reference in error mode", async () => {
    expect(
      substitute({
        type: "virtual",
        source: "test",
        dir: "/dummy",
        text: "Value: {file:nonexistent.txt}",
        missing: "error",
      }),
    ).rejects.toThrow()
  })
})
