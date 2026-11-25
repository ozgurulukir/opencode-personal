import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { WORKER_BUNDLE_VERSION, ensureTreeSitterWorker, workerFilePath, workerNeedsWrite } from "@/util/ts-worker"

describe("util.ts-worker", () => {
  test("workerFilePath is versioned under the data dir", () => {
    expect(workerFilePath("/tmp/data")).toBe(
      path.join("/tmp/data", "tree-sitter", `parser.worker.bundle-${WORKER_BUNDLE_VERSION}.js`),
    )
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

  describe("workerNeedsWrite", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-worker-test-"))

    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })

    test("writes when the file is missing", () => {
      expect(workerNeedsWrite(path.join(dir, "missing.js"), "source")).toBe(true)
    })

    test("skips the write when content matches", () => {
      const file = path.join(dir, "same.js")
      fs.writeFileSync(file, "source")
      expect(workerNeedsWrite(file, "source")).toBe(false)
    })

    test("rewrites on content drift (stale worker after an upgrade without a version bump)", () => {
      const file = path.join(dir, "stale.js")
      fs.writeFileSync(file, "old bundle")
      expect(workerNeedsWrite(file, "new bundle")).toBe(true)
    })
  })
})
