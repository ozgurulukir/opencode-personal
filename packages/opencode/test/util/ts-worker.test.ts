import { describe, expect, test } from "bun:test"
import { WORKER_BUNDLE_VERSION, ensureTreeSitterWorker, workerFilePath } from "@/util/ts-worker"

describe("util.ts-worker", () => {
  test("workerFilePath is versioned under the data dir", () => {
    expect(workerFilePath("/tmp/data")).toBe(`/tmp/data/tree-sitter/parser.worker.bundle-${WORKER_BUNDLE_VERSION}.js`)
  })

  test("ensureTreeSitterWorker returns early when already overridden", async () => {
    const key = "OTUI_TREE_SITTER_WORKER_PATH"
    const prev = process.env[key]
    process.env[key] = "/custom/worker.js"
    try {
      await ensureTreeSitterWorker()
      expect(process.env[key]).toBe("/custom/worker.js")
    } finally {
      if (prev === undefined) delete process.env[key]
      else process.env[key] = prev
    }
  })
})
