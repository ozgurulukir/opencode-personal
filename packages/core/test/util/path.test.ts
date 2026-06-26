import { describe, expect, test } from "bun:test"
import {
  getFilename,
  getDirectory,
  getFileExtension,
  getFilenameTruncated,
  truncateMiddle,
} from "@opencode-ai/core/util/path"

describe("getFilename", () => {
  test("returns empty string for undefined", () => {
    expect(getFilename(undefined)).toBe("")
  })

  test("extracts filename from unix path", () => {
    expect(getFilename("/home/user/file.txt")).toBe("file.txt")
  })

  test("extracts filename from windows path", () => {
    expect(getFilename("C:\\Users\\user\\file.txt")).toBe("file.txt")
  })

  test("handles trailing slashes", () => {
    expect(getFilename("/home/user/dir/")).toBe("dir")
  })

  test("returns last component for bare filename", () => {
    expect(getFilename("file.txt")).toBe("file.txt")
  })
})

describe("getDirectory", () => {
  test("returns empty string for undefined", () => {
    expect(getDirectory(undefined)).toBe("")
  })

  test("returns directory from unix path with trailing slash", () => {
    expect(getDirectory("/home/user/file.txt")).toBe("/home/user/")
  })

  test("returns directory from windows path", () => {
    expect(getDirectory("C:\\Users\\user\\file.txt")).toBe("C:/Users/user/")
  })

  test("handles trailing slashes", () => {
    expect(getDirectory("/home/user/dir/")).toBe("/home/user/")
  })

  test("returns root slash for bare filename", () => {
    expect(getDirectory("file.txt")).toBe("/")
  })
})

describe("getFileExtension", () => {
  test("returns empty string for undefined", () => {
    expect(getFileExtension(undefined)).toBe("")
  })

  test("returns extension after last dot", () => {
    expect(getFileExtension("file.txt")).toBe("txt")
  })

  test("handles multiple dots", () => {
    expect(getFileExtension("file.min.js")).toBe("js")
  })

  test("returns full name when no dot", () => {
    expect(getFileExtension("Makefile")).toBe("Makefile")
  })
})

describe("getFilenameTruncated", () => {
  test("returns original if within max length", () => {
    expect(getFilenameTruncated("file.txt", 20)).toBe("file.txt")
  })

  test("truncates long filename with extension", () => {
    expect(getFilenameTruncated("very-long-filename-name.txt", 20)).toContain("…")
    expect(getFilenameTruncated("very-long-filename-name.txt", 20).length).toBeLessThanOrEqual(20)
  })

  test("preserves extension when truncating", () => {
    const result = getFilenameTruncated("very-long-filename-name.txt", 20)
    expect(result.endsWith(".txt")).toBe(true)
  })

  test("handles very short max length", () => {
    const result = getFilenameTruncated("file.txt", 5)
    expect(result.length).toBeLessThanOrEqual(5)
  })

  test("handles filename with no extension", () => {
    const result = getFilenameTruncated("very-long-filename-name", 15)
    expect(result.length).toBeLessThanOrEqual(15)
    expect(result).toContain("…")
  })

  test("handles exact boundary where filename length equals max", () => {
    expect(getFilenameTruncated("file.txt", 8)).toBe("file.txt")
  })
})

describe("truncateMiddle", () => {
  test("returns original if within max length", () => {
    expect(truncateMiddle("hello", 10)).toBe("hello")
  })

  test("truncates with ellipsis in the middle", () => {
    const result = truncateMiddle("abcdefghij", 6)
    expect(result).toContain("…")
    expect(result.length).toBeLessThanOrEqual(6)
  })
})
