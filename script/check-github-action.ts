#!/usr/bin/env bun
// github/ is a standalone action outside the bun workspace and cannot import
// from packages/, so SAFE_ATTACHMENT_REGEX is intentionally duplicated between
// the workspace CLI and the action. This check fails when the two definitions
// drift — a one-sided update would create divergent SSRF/attachment validation.
import fs from "node:fs"
import path from "path"

const root = path.resolve(import.meta.dir, "..")

function extract(file: string): string {
  const text = fs.readFileSync(path.join(root, file), "utf8")
  // The literal may sit on the declaration line or the next one (prettier
  // wraps long assignments); it always mentions user-attachments and runs
  // from the first "/" to the last "/" on its line.
  const line = text.split("\n").find((candidate) => candidate.includes("user-attachments"))
  if (!line) throw new Error(`SAFE_ATTACHMENT_REGEX not found in ${file}`)
  return line.slice(line.indexOf("/"), line.lastIndexOf("/") + 1)
}

const cli = extract("packages/opencode/src/cli/cmd/github/helpers.ts")
const action = extract("github/index.ts")

if (cli !== action) {
  console.error(`SAFE_ATTACHMENT_REGEX drifted between the workspace CLI and the standalone action:
  cli:    ${cli}
  action: ${action}`)
  process.exit(1)
}
console.log("SAFE_ATTACHMENT_REGEX matches in both the CLI and the action")
