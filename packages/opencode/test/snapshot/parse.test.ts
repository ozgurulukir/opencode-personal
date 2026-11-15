import { describe, expect, test } from "bun:test"
import { parseNameStatus, parseNumstat } from "@/snapshot/parse"

describe("snapshot/parse", () => {
  test("parseNameStatus correctly maps A, D, M codes", () => {
    const text = "A\tnew-file.ts\nD\told-file.ts\nM\tedited-file.ts\n"
    const map = parseNameStatus(text)
    expect(map.get("new-file.ts")).toBe("added")
    expect(map.get("old-file.ts")).toBe("deleted")
    expect(map.get("edited-file.ts")).toBe("modified")
    expect(map.get("nonexistent")).toBeUndefined()
  })

  test("parseNumstat parses additions, deletions, and binary files", () => {
    const status = new Map<string, "added" | "deleted" | "modified">([
      ["foo.ts", "modified"],
      ["image.png", "added"],
    ])
    const numstat = "10\t5\tfoo.ts\n-\t-\timage.png\n"
    const rows = parseNumstat(numstat, status)

    expect(rows).toEqual([
      {
        file: "foo.ts",
        status: "modified",
        binary: false,
        additions: 10,
        deletions: 5,
      },
      {
        file: "image.png",
        status: "added",
        binary: true,
        additions: 0,
        deletions: 0,
      },
    ])
  })
})
