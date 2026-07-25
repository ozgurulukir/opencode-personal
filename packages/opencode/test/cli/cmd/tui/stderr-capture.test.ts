/**
 * Regression tests for TUI stderr/console capture.
 *
 * The TUI runs on the alternate screen with externalOutputMode: "passthrough",
 * so any stdout/stderr write leaks onto the TUI display. This file verifies
 * that:
 *   1. process.stderr.write is redirected to the log file
 *   2. console.error/warn/log/info/debug are also redirected (Bun does NOT
 *      route these through process.std{out,err}.write — they write directly
 *      to fd 1/2, so the original stderr-only capture was incomplete)
 *   3. capture() is idempotent and restore() cleanly returns to originals
 *
 * We mock Log.file() per test so each test gets an isolated log path. Using
 * Log.init + Global.Path.log would race with the shared Log module state
 * across the rest of the suite and leave dangling WriteStream handles on
 * tmp dirs.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { capture, restore } from "@/cli/cmd/tui/stderr-capture"
import * as Log from "@opencode-ai/core/util/log"
import { tmpdir } from "../../../fixture/fixture"

describe("stderr-capture", () => {
  // Snapshot the original console methods once. stderr-capture captures them
  // at module load, so any further mutation in tests starts from that baseline.
  const baselineConsole = {
    error: console.error,
    warn: console.warn,
    log: console.log,
    info: console.info,
    debug: console.debug,
  } as const

  let logFile: string
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    tmp = await tmpdir()
    logFile = path.join(tmp.path, "tui.log")
    // Point stderr-capture at our per-test log path. The mock replaces
    // Log.file() globally for the test file; restore happens in afterEach.
    void mock.module("@opencode-ai/core/util/log", () => ({
      ...Log,
      file: () => logFile,
    }))
  })

  afterEach(async () => {
    restore()
    mock.restore()
    await tmp[Symbol.asyncDispose]()
  })

  test("capture() routes console.error to log file (not terminal)", async () => {
    capture()
    const sensitive = { messages: [{ role: "user", content: "secret-prompt-content" }] }
    console.error("[tui.plugin] failed to load plugin", sensitive)

    const content = await fs.readFile(logFile, "utf-8")
    expect(content).toContain("[tui.plugin] failed to load plugin")
    expect(content).toContain("secret-prompt-content")
  })

  test("capture() routes console.warn to log file", async () => {
    capture()
    console.warn("[tui.plugin] deprecated API", { api: "v1.command" })

    const content = await fs.readFile(logFile, "utf-8")
    expect(content).toContain("[tui.plugin] deprecated API")
    expect(content).toContain("v1.command")
  })

  test("capture() routes console.log/info/debug to log file", async () => {
    capture()
    console.log("log message")
    console.info("info message")
    console.debug("debug message")

    const content = await fs.readFile(logFile, "utf-8")
    expect(content).toContain("log message")
    expect(content).toContain("info message")
    expect(content).toContain("debug message")
  })

  test("capture() routes process.stderr.write to log file", async () => {
    capture()
    process.stderr.write("native stderr warning\n")

    const content = await fs.readFile(logFile, "utf-8")
    expect(content).toContain("native stderr warning")
  })

  test("console.error serializes nested Error cause objects (AI message leak vector)", async () => {
    capture()

    const cause = { messages: [{ role: "assistant", content: "leaked via cause" }] }
    const error = new Error("API request failed")
    error.cause = cause

    // Mirrors the runtime.ts:fail() call shape: a leading message plus a data
    // object containing the error. The fix must route the entire payload
    // (including the non-enumerable Error.cause chain) to the log file.
    console.error("[tui.plugin] failed", { path: "/plugin/path", error })

    const content = await fs.readFile(logFile, "utf-8")
    expect(content).toContain("[tui.plugin] failed")
    expect(content).toContain("API request failed")
    expect(content).toContain("leaked via cause")
  })

  test("capture() is idempotent — second call does not double-wrap console methods", () => {
    capture()
    const firstWrapped = console.error
    capture()
    const secondWrapped = console.error

    expect(firstWrapped).toBe(secondWrapped)
  })

  test("restore() returns console methods to their pre-capture references", () => {
    capture()
    expect(console.error).not.toBe(baselineConsole.error)

    restore()
    expect(console.error).toBe(baselineConsole.error)
    expect(console.warn).toBe(baselineConsole.warn)
    expect(console.log).toBe(baselineConsole.log)
    expect(console.info).toBe(baselineConsole.info)
    expect(console.debug).toBe(baselineConsole.debug)
  })

  test("restore() without prior capture() is a no-op", () => {
    expect(() => restore()).not.toThrow()
  })

  test("after restore, console.error no longer writes to log file", async () => {
    capture()
    console.error("during-capture")
    restore()

    // Truncate so we can clearly observe post-restore behavior.
    await fs.writeFile(logFile, "")

    console.error("after-restore")
    const content = await fs.readFile(logFile, "utf-8")
    expect(content).not.toContain("after-restore")
  })
})
