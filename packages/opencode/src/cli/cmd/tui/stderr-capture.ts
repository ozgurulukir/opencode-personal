import * as Log from "@opencode-ai/core/util/log"
import { appendFileSync } from "node:fs"

/**
 * Redirects process.stderr.write to the log file during TUI rendering.
 *
 * OpenTUI only intercepts process.stdout.write (and only in "capture-stdout" mode).
 * process.stderr.write is never intercepted, so any stderr output — Bun JIT warnings,
 * console.error calls, unhandled rejection traces — leaks directly onto the alternate
 * screen buffer and corrupts the TUI display.
 *
 * This module saves the original stderr.write, replaces it with a log-file writer,
 * and provides a restore() function to undo the override on TUI shutdown.
 */

let original: typeof process.stderr.write | undefined

export function capture() {
  if (original) return // already captured

  original = process.stderr.write.bind(process.stderr)
  const logpath = Log.file()

  process.stderr.write = ((chunk, encoding, callback) => {
    const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : ""
    if (logpath) {
      appendFileSync(logpath, text)
    }
    const cb = typeof encoding === "function" ? encoding : callback
    if (typeof cb === "function") cb()
    return true
  }) as typeof process.stderr.write
}

export function restore() {
  if (!original) return
  process.stderr.write = original
  original = undefined
}
