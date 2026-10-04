import { describe, expect, test } from "bun:test"
import { MANIFEST_SUFFIX, manifestPathFor } from "@/search/manifest"

describe("manifestPathFor", () => {
  test("appends MANIFEST_SUFFIX to index path", () => {
    const indexPath = "/path/to/zvec/index"
    expect(manifestPathFor(indexPath)).toBe(`/path/to/zvec/index${MANIFEST_SUFFIX}`)
    expect(manifestPathFor(indexPath)).toBe("/path/to/zvec/index_manifest.json")
  })

  test("handles empty string indexPath", () => {
    expect(manifestPathFor("")).toBe(MANIFEST_SUFFIX)
    expect(manifestPathFor("")).toBe("_manifest.json")
  })

  test("handles paths with existing file extensions or complex paths", () => {
    expect(manifestPathFor("/var/cache/db.index")).toBe("/var/cache/db.index_manifest.json")
    expect(manifestPathFor("./relative/path/index")).toBe("./relative/path/index_manifest.json")
  })
})
