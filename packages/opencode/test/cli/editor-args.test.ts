import { describe, expect, test } from "bun:test"
import { editorArgs, shellWords } from "../../src/cli/cmd/tui/util/editor-args"

describe("shellWords", () => {
  test("splits on spaces", () => {
    expect(shellWords("code -w")).toEqual(["code", "-w"])
    expect(shellWords("nvim")).toEqual(["nvim"])
    expect(shellWords("  code   -w  ")).toEqual(["code", "-w"])
    expect(shellWords("")).toEqual([])
  })

  test("respects single and double quotes (paths with spaces)", () => {
    expect(shellWords('"/path with spaces/ed" -w')).toEqual(["/path with spaces/ed", "-w"])
    expect(shellWords("'/path with spaces/ed' -w")).toEqual(["/path with spaces/ed", "-w"])
    expect(shellWords("code -w 'note title.md'")).toEqual(["code", "-w", "note title.md"])
  })

  test("keeps backslashes literal (Windows paths)", () => {
    expect(shellWords("C:\\Tools\\editor.exe -w")).toEqual(["C:\\Tools\\editor.exe", "-w"])
  })
})

describe("editorArgs", () => {
  test("returns split args for a well-formed editor", () => {
    expect(editorArgs("code -w")).toEqual(["code", "-w"])
  })

  test("throws on empty editor value", () => {
    expect(() => editorArgs("   ")).toThrow(/Invalid \$EDITOR/)
  })

  test("throws on interpreter-argument payloads with shell metacharacters", () => {
    // The classic injection shape: an interpreter + a script payload argument.
    expect(() => editorArgs("sh -c 'rm -rf /'")).toThrow(/Invalid \$EDITOR/)
    expect(() => editorArgs('bash -c "echo pwned"')).toThrow(/Invalid \$EDITOR/)
    // Windows shells are interpreters too.
    expect(() => editorArgs("powershell -Command 'nvim'")).toThrow(/Invalid \$EDITOR/)
    expect(() => editorArgs("cmd /c notepad")).toThrow(/Invalid \$EDITOR/)
    // Metacharacters hiding inside a quoted payload are still rejected.
    expect(() => editorArgs('nvim "foo|bar"')).toThrow(/Invalid \$EDITOR/)
  })
})
