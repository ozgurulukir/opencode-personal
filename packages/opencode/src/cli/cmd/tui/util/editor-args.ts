import { Log } from "@opencode-ai/core/util/log"

/**
 * $EDITOR/$VISUAL follow Unix shell-words semantics (the system(3)
 * convention: users legitimately set EDITOR="code -w" or quote paths with
 * spaces), so split with quoting awareness instead of a naive space split.
 * Backslashes stay literal on purpose — Windows paths commonly carry them.
 */
export function shellWords(input: string): string[] {
  const words: string[] = []
  let current = ""
  let quote: '"' | "'" | undefined
  let started = false
  for (const ch of input) {
    if (quote) {
      if (ch === quote) {
        quote = undefined
        continue
      }
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
      continue
    }
    if (ch === " " || ch === "\t") {
      if (started) words.push(current)
      current = ""
      started = false
      continue
    }
    current += ch
    started = true
  }
  if (started) words.push(current)
  return words
}

// Reject interpreter-argument payloads after the split: an editor value whose
// executable is a shell — POSIX ("sh -c '...'", "/bin/bash -lc '...'") or
// Windows ("cmd /c ...", "powershell -Command ...") — is the classic injection
// shape, never a legitimate editor. Also reject stray shell metacharacters
// inside arguments — in a pure argv world they indicate a quoting mistake, and
// Process.spawn validates only cmd[0].
const EDITOR_ARG_METACHARS = /[\0\r\n;|<>&`$]/
const SHELL_EXECUTABLES = new Set(["sh", "bash", "dash", "ash", "zsh", "ksh", "cmd", "powershell", "pwsh"])

function isShellExecutable(executable: string): boolean {
  const base = executable.split(/[\\/]/).pop() ?? executable
  return SHELL_EXECUTABLES.has(base.toLowerCase().replace(/\.exe$/i, ""))
}

/**
 * Split $EDITOR/$VISUAL into spawn-ready arguments. Throws on an empty value,
 * a shell executable (POSIX or Windows), or shell metacharacters (logged
 * first) — the misconfiguration must be loud, not silently turned into a
 * different command.
 */
export function editorArgs(editor: string): string[] {
  const parts = shellWords(editor)
  if (parts.length === 0) {
    Log.Default.warn("invalid $EDITOR/$VISUAL: empty editor command", { editor })
    throw new Error(`Invalid $EDITOR/$VISUAL value: "${editor}"`)
  }
  if (isShellExecutable(parts[0])) {
    Log.Default.warn("invalid $EDITOR/$VISUAL: a shell cannot be the editor command", { editor })
    throw new Error(`Invalid $EDITOR/$VISUAL value: "${editor}"`)
  }
  for (const part of parts) {
    if (EDITOR_ARG_METACHARS.test(part)) {
      Log.Default.warn("invalid $EDITOR/$VISUAL: shell metacharacters are not allowed", { editor })
      throw new Error(`Invalid $EDITOR/$VISUAL value: "${editor}"`)
    }
  }
  return parts
}
