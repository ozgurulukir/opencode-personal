import { describe, expect, test, spyOn, beforeEach, afterEach, mock } from "bun:test"
import { Log } from "@opencode-ai/core/util/log"
import * as Global from "@opencode-ai/core/global"
import fs from "fs/promises"
import * as fsSync from "fs"
import path from "path"
import { tmpdir } from "os"

describe("Log", () => {
  let stderrWriteSpy: ReturnType<typeof spyOn>
  let tempLogDir: string
  let originalGlobalPathLogDescriptor: PropertyDescriptor | undefined
  let originalLoggers: Map<string, any>

  beforeEach(async () => {
    // Reset internal state
    originalLoggers = new Map(Log._internal.loggers)
    Log._internal.loggers.clear()

    // Also reset time to make tests predictable
    Log._internal.last = Date.now()

    stderrWriteSpy = spyOn(process.stderr, "write").mockImplementation(() => true)

    // Reset Log state using init to restore defaults for testing
    await Log.init({ print: true, level: "INFO" })

    tempLogDir = await fs.mkdtemp(path.join(tmpdir(), "log-test-"))
    // Mock Global.Path.log to use temp directory
    originalGlobalPathLogDescriptor = Object.getOwnPropertyDescriptor(Global.Path, "log")
    Object.defineProperty(Global.Path, "log", { value: tempLogDir, writable: true, configurable: true })
  })

  afterEach(async () => {
    if (originalGlobalPathLogDescriptor) {
      Object.defineProperty(Global.Path, "log", originalGlobalPathLogDescriptor)
    } else {
      // fallback just in case
      delete (Global.Path as any).log
    }

    Log._internal.loggers.clear()
    for (const [k, v] of originalLoggers.entries()) {
      Log._internal.loggers.set(k, v)
    }

    stderrWriteSpy.mockRestore()
    await fs.rm(tempLogDir, { recursive: true, force: true })
  })

  describe("create and levels", () => {
    test("creates default logger and writes INFO by default", () => {
      const logger = Log.create()
      logger.info("hello")
      expect(stderrWriteSpy).toHaveBeenCalledTimes(1)
      const output = stderrWriteSpy.mock.calls[0][0]
      expect(output).toContain("INFO")
      expect(output).toContain("hello")
    })

    test("filters out DEBUG messages when level is INFO", () => {
      const logger = Log.create()
      logger.debug("hidden")
      expect(stderrWriteSpy).toHaveBeenCalledTimes(0)
    })

    test("allows ERROR messages when level is INFO", () => {
      const logger = Log.create()
      logger.error("error!")
      expect(stderrWriteSpy).toHaveBeenCalledTimes(1)
      expect(stderrWriteSpy.mock.calls[0][0]).toContain("ERROR")
    })
  })

  describe("tags and clone", () => {
    test("includes service tag in output", () => {
      const logger = Log.create({ service: "test-svc" })
      logger.info("msg")
      expect(stderrWriteSpy).toHaveBeenCalledTimes(1)
      const output = stderrWriteSpy.mock.calls[0][0]
      expect(output).toContain("service=test-svc")
    })

    test("clones logger with existing tags", () => {
      const parent = Log.create({ app: "main" })
      const child = parent.clone().tag("module", "sub")

      child.info("test")

      expect(stderrWriteSpy).toHaveBeenCalledTimes(1)
      const output = stderrWriteSpy.mock.calls[0][0]
      expect(output).toContain("app=main")
      expect(output).toContain("module=sub")
    })
  })

  describe("formatError", () => {
    test("formats nested error causes", () => {
      const rootError = new Error("root cause")
      const wrapperError = new Error("wrapper", { cause: rootError })
      const logger = Log.create()

      logger.error("failed", { err: wrapperError })

      expect(stderrWriteSpy).toHaveBeenCalledTimes(1)
      const output = stderrWriteSpy.mock.calls[0][0]
      expect(output).toContain("err=wrapper Caused by: root cause")
    })
  })

  describe("time", () => {
    test("logs start and stop messages with duration", () => {
      const logger = Log.create()
      const t = logger.time("operation", { id: 123 })

      expect(stderrWriteSpy).toHaveBeenCalledTimes(1)
      expect(stderrWriteSpy.mock.calls[0][0]).toContain("status=started")

      t.stop()

      expect(stderrWriteSpy).toHaveBeenCalledTimes(2)
      const stopOutput = stderrWriteSpy.mock.calls[1][0]
      expect(stopOutput).toContain("status=completed")
      expect(stopOutput).toContain("duration=")
      expect(stopOutput).toContain("id=123")
    })

    test("supports explicit using syntax (Symbol.dispose)", () => {
      const logger = Log.create()

      {
        using t = logger.time("block")
        expect(stderrWriteSpy).toHaveBeenCalledTimes(1)
      }

      expect(stderrWriteSpy).toHaveBeenCalledTimes(2)
      expect(stderrWriteSpy.mock.calls[1][0]).toContain("status=completed")
    })
  })

  describe("init and file writing", () => {
    test("initializes file logger and writes to stream", async () => {
      // Mock createWriteStream to intercept writes
      const mockStream = {
        write: mock((msg, cb) => {
          cb(null)
          return true
        }),
      }
      const createStreamSpy = spyOn(fsSync, "createWriteStream").mockReturnValue(mockStream as any)

      await Log.init({ print: false, dev: true, level: "DEBUG" })

      expect(createStreamSpy).toHaveBeenCalledTimes(1)
      expect(Log.file()).toContain("dev.log")

      const logger = Log.create()
      logger.debug("file test")

      // Since file writes are now asynchronous in init(), we need to await a microtask
      await new Promise((r) => setTimeout(r, 0))

      expect(stderrWriteSpy).toHaveBeenCalledTimes(0)
      expect(mockStream.write).toHaveBeenCalledTimes(1)
      expect(mockStream.write.mock.calls[0][0]).toContain("DEBUG")
      expect(mockStream.write.mock.calls[0][0]).toContain("file test")

      createStreamSpy.mockRestore()
    })
  })
})
