import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import os from "os"
import path from "path"
import {
  unquote,
  home,
  envValue,
  auto,
  expand,
  provider,
  dynamic,
  prefix,
  preview,
  tail,
  getChangedRanges,
  MAX_METADATA_LENGTH,
} from "../../../src/tool/shell/helpers"

describe("Shell Helpers", () => {
  describe("unquote", () => {
    test("removes matching double quotes", () => {
      expect(unquote('"hello"')).toBe("hello")
    })
    test("removes matching single quotes", () => {
      expect(unquote("'hello'")).toBe("hello")
    })
    test("leaves unquoted text alone", () => {
      expect(unquote("hello")).toBe("hello")
    })
    test("leaves mismatched quotes alone", () => {
      expect(unquote("\"hello'")).toBe("\"hello'")
      expect(unquote("'hello\"")).toBe("'hello\"")
    })
    test("handles empty string", () => {
      expect(unquote("")).toBe("")
    })
    test("handles single char", () => {
      expect(unquote('"')).toBe('"')
    })
  })

  describe("home", () => {
    test("replaces ~ with home dir", () => {
      expect(home("~")).toBe(os.homedir())
    })
    test("replaces ~/ with home dir + path", () => {
      expect(home("~/foo")).toBe(path.join(os.homedir(), "foo"))
    })
    test("replaces ~\\ with home dir + path", () => {
      expect(home("~\\foo")).toBe(path.join(os.homedir(), "foo"))
    })
    test("leaves other text alone", () => {
      expect(home("~foo")).toBe("~foo")
      expect(home("foo")).toBe("foo")
    })
  })

  describe("envValue", () => {
    const originalEnv = process.env
    beforeEach(() => {
      process.env = { ...originalEnv, TEST_VAR: "test_value" }
    })
    afterEach(() => {
      process.env = originalEnv
    })

    test("gets exact match", () => {
      expect(envValue("TEST_VAR")).toBe("test_value")
    })

    if (process.platform === "win32") {
      test("gets case-insensitive match on Windows", () => {
        expect(envValue("test_var")).toBe("test_value")
      })
    } else {
      test("requires exact case on non-Windows", () => {
        expect(envValue("test_var")).toBeUndefined()
      })
    }

    test("returns undefined for missing var", () => {
      expect(envValue("MISSING_VAR")).toBeUndefined()
    })
  })

  describe("auto", () => {
    test("resolves HOME", () => {
      expect(auto("HOME", "/cwd", "/shell")).toBe(os.homedir())
    })
    test("resolves PWD", () => {
      expect(auto("PWD", "/cwd", "/shell")).toBe("/cwd")
    })
    test("resolves PSHOME", () => {
      expect(auto("PSHOME", "/cwd", "/path/to/shell")).toBe("/path/to")
    })
    test("returns undefined for others", () => {
      expect(auto("OTHER", "/cwd", "/shell")).toBeUndefined()
    })
  })

  describe("expand", () => {
    const originalEnv = process.env
    beforeEach(() => {
      process.env = { ...originalEnv, TEST_VAR: "test_value" }
    })
    afterEach(() => {
      process.env = originalEnv
    })

    test("expands ${env:VAR}", () => {
      expect(expand("echo ${env:TEST_VAR}", "/cwd", "/shell")).toBe("echo test_value")
    })
    test("expands $env:VAR", () => {
      expect(expand("echo $env:TEST_VAR", "/cwd", "/shell")).toBe("echo test_value")
    })
    test("expands missing env var to empty string", () => {
      expect(expand("echo ${env:MISSING}", "/cwd", "/shell")).toBe("echo ")
    })
    test("expands $HOME, $PWD, $PSHOME", () => {
      expect(expand("echo $HOME", "/cwd", "/shell")).toBe(`echo ${os.homedir()}`)
      expect(expand("echo $PWD", "/cwd", "/shell")).toBe("echo /cwd")
      expect(expand("echo $PSHOME", "/cwd", "/path/to/shell")).toBe("echo /path/to")
    })
    test("unquotes and expands home", () => {
      expect(expand('"~"', "/cwd", "/shell")).toBe(os.homedir())
    })
  })

  describe("provider", () => {
    test("extracts filesystem provider path", () => {
      expect(provider("FileSystem::C:\\foo")).toBe("C:\\foo")
      expect(provider("filesystem::/foo")).toBe("/foo")
    })
    test("returns undefined for other providers", () => {
      expect(provider("Registry::HKLM\\foo")).toBeUndefined()
    })
    test("ignores single char drive letters", () => {
      expect(provider("C:\\foo")).toBe("C:\\foo")
    })
    test("returns text unchanged if no prefix", () => {
      expect(provider("foo/bar")).toBe("foo/bar")
    })
  })

  describe("dynamic", () => {
    test("detects subexpressions () @()", () => {
      expect(dynamic("(1+1)", false)).toBeTrue()
      expect(dynamic("@(1,2)", false)).toBeTrue()
    })
    test("detects string interpolation $() ${} `", () => {
      expect(dynamic("$(1+1)", false)).toBeTrue()
      expect(dynamic("${var}", false)).toBeTrue()
      expect(dynamic("`t", false)).toBeTrue()
    })
    test("detects powershell variables (except env:)", () => {
      expect(dynamic("$var", true)).toBeTrue()
      expect(dynamic("$env:var", true)).toBeFalse()
    })
    test("detects basic vars in non-ps", () => {
      expect(dynamic("$var", false)).toBeTrue()
    })
    test("returns false for static strings", () => {
      expect(dynamic("hello world", false)).toBeFalse()
      expect(dynamic("hello world", true)).toBeFalse()
    })
  })

  describe("prefix", () => {
    test("returns string before first glob char", () => {
      expect(prefix("foo*bar")).toBe("foo")
      expect(prefix("foo?bar")).toBe("foo")
      expect(prefix("foo[a-z]bar")).toBe("foo")
    })
    test("returns undefined if glob is at start", () => {
      expect(prefix("*foo")).toBeUndefined()
    })
    test("returns text unchanged if no glob", () => {
      expect(prefix("foo/bar")).toBe("foo/bar")
    })
  })

  describe("preview", () => {
    test("returns text if within limit", () => {
      expect(preview("hello")).toBe("hello")
    })
    test("truncates and adds prefix if over limit", () => {
      const longText = "a".repeat(MAX_METADATA_LENGTH + 10)
      const result = preview(longText)
      expect(result.startsWith("...\n\n")).toBeTrue()
      expect(result.length).toBe(MAX_METADATA_LENGTH + 5) // "...\n\n".length = 5
      expect(result.endsWith("a")).toBeTrue()
    })
  })

  describe("tail", () => {
    test("returns text unchanged if within limits", () => {
      expect(tail("line1\nline2", 10, 100)).toEqual({ text: "line1\nline2", cut: false })
    })
    test("limits by lines", () => {
      expect(tail("line1\nline2\nline3", 2, 100)).toEqual({ text: "line2\nline3", cut: true })
    })
    test("limits by bytes without cutting within the previous lines", () => {
      // line3 is 5 bytes, line22222 is 9 bytes. total 5+9+1 = 15 > 10.
      // It stops before adding line22222
      const result = tail("line1\nline22222\nline3", 10, 10)
      expect(result.cut).toBeTrue()
      expect(result.text).toBe("line3")
    })
    test("handles single huge line exceeding byte limit", () => {
      const result = tail("very_long_line_here", 10, 10)
      expect(result.cut).toBeTrue()
      expect(result.text.length).toBeLessThanOrEqual(10)
      // will be exactly 10 since it slices from end
      expect(result.text).toBe("_line_here")
    })
  })

  describe("getChangedRanges", () => {
    test("parses unified diff header", () => {
      const diff = `@@ -1,5 +1,5 @@
 foo
@@ -10 +10,2 @@
 bar`
      expect(getChangedRanges(diff)).toEqual([
        { start: 1, end: 5 },
        { start: 10, end: 11 },
      ])
    })
    test("handles empty diff", () => {
      expect(getChangedRanges("")).toEqual([])
    })
    test("ignores non-header lines", () => {
      expect(getChangedRanges("foo\nbar\n@@ -1 +1 @@\nbaz")).toEqual([{ start: 1, end: 1 }])
    })
  })
})
