import * as Log from "@opencode-ai/core/util/log"
import { appendFileSync } from "node:fs"

/**
 * Redirects process.stderr.write AND console.* methods to the log file
 * during TUI rendering.
 *
 * OpenTUI renders to the alternate screen buffer. It only intercepts
 * process.stdout.write when configured with `externalOutputMode: "capture-stdout"`,
 * but the TUI uses `passthrough` mode (see app.tsx rendererConfig). In passthrough
 * mode anything written to fd 1 or fd 2 leaks onto the alternate screen and
 * corrupts the TUI display.
 *
 * Two layers of capture are required because Bun does not route console.* through
 * process.std{out,err}.write — the optimized console implementation writes
 * directly to the underlying file descriptors. Overriding process.stderr.write
 * alone leaves every `console.error`/`console.warn`/`console.log` call
 * (including the `[tui.plugin] failed to load` path in plugin/runtime.ts:127
 * which serializes error.cause via JSON.stringify and can include API
 * request/response bodies) leaking onto the terminal.
 *
 * `process.stdout.write` is intentionally NOT captured — tui/util/clipboard.ts
 * uses it for OSC 52 escape sequences which must reach the terminal emulator.
 */

type CapturableConsole = Pick<Console, "error" | "warn" | "log" | "info" | "debug">

let originalStderrWrite: typeof process.stderr.write | undefined

const originalConsole: CapturableConsole = {
  error: console.error,
  warn: console.warn,
  log: console.log,
  info: console.info,
  debug: console.debug,
}

function formatError(err: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { name: err.name, message: err.message, stack: err.stack }
  if (err.cause !== undefined) {
    out.cause = err.cause instanceof Error ? formatError(err.cause) : err.cause
  }
  return out
}

function formatValue(arg: unknown): string {
  if (typeof arg === "string") return arg
  if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint") return String(arg)
  if (arg === null || arg === undefined) return String(arg)
  if (arg instanceof Error) return JSON.stringify(formatError(arg))
  if (Array.isArray(arg)) {
    return JSON.stringify(arg.map(formatValue))
  }
  if (typeof arg === "object") {
    // oxlint-disable-next-line no-unsafe-type-assertion -- typeof narrowed to "object" but TypeScript can't see through nested function returns
    const obj = arg as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      out[k] = v instanceof Error ? formatError(v) : v
    }
    try {
      return JSON.stringify(out)
    } catch {
      // oxlint-disable-next-line no-base-to-string -- intentional fallback when value is not JSON-serializable
      return String(arg)
    }
  }
  // oxlint-disable-next-line no-base-to-string -- intentional final fallback for unexpected types (symbols, functions)
  return String(arg)
}

function formatArgs(args: unknown[]): string {
  return args.map(formatValue).join(" ")
}

export function capture() {
  if (originalStderrWrite) return // already captured

  originalStderrWrite = process.stderr.write.bind(process.stderr)
  const logpath = Log.file()

  const writeToLog = (text: string) => {
    if (logpath) {
      appendFileSync(logpath, text)
    }
  }

  process.stderr.write = ((chunk, encoding, callback) => {
    const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : ""
    writeToLog(text)
    const cb = typeof encoding === "function" ? encoding : callback
    if (typeof cb === "function") cb()
    return true
  }) as typeof process.stderr.write

  // Route console.* to the log file. Bun does not pipe console methods through
  // process.std{out,err}.write, so the override above is insufficient.
  console.error = (...args: unknown[]) => {
    writeToLog("ERROR " + formatArgs(args) + "\n")
  }
  console.warn = (...args: unknown[]) => {
    writeToLog("WARN " + formatArgs(args) + "\n")
  }
  console.log = (...args: unknown[]) => {
    writeToLog("INFO " + formatArgs(args) + "\n")
  }
  console.info = (...args: unknown[]) => {
    writeToLog("INFO " + formatArgs(args) + "\n")
  }
  console.debug = (...args: unknown[]) => {
    writeToLog("DEBUG " + formatArgs(args) + "\n")
  }
}

export function restore() {
  if (!originalStderrWrite) return
  process.stderr.write = originalStderrWrite
  console.error = originalConsole.error
  console.warn = originalConsole.warn
  console.log = originalConsole.log
  console.info = originalConsole.info
  console.debug = originalConsole.debug
  originalStderrWrite = undefined
}
