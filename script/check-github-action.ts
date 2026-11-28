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

// Binary-name drift check: install.sh installs only COMMAND (the fork name)
// into ~/.opencode-personal/bin, so every workflow/action/SDK invocation must
// use that name — a bare `opencode` call would resolve to an unrelated
// upstream install or fail outright on runners without one.
const installSh = fs.readFileSync(path.join(root, "install.sh"), "utf8")
const command = installSh.match(/^COMMAND=(\S+)$/m)?.[1]
if (!command) throw new Error("COMMAND not found in install.sh")
if (command !== "opencode-personal") {
  // The assertions below expect the fork command name; update them together
  // with install.sh if it ever changes.
  throw new Error(`Unexpected COMMAND in install.sh: ${command}`)
}

const invocationFiles = [
  "github/action.yml",
  ".github/workflows/review.yml",
  ".github/workflows/triage.yml",
  ".github/workflows/duplicate-issues.yml",
  ".github/workflows/pr-management.yml",
]

for (const file of invocationFiles) {
  const text = fs.readFileSync(path.join(root, file), "utf8")
  // A bare `opencode` command is either at the start of a run line (after
  // indentation) or directly after `run: `. Model refs like `opencode/gpt-5.5`
  // and env vars like OPENCODE_* are not command invocations.
  const offender = text
    .split("\n")
    .find((line) => /(?:^\s*|run:\s*)opencode\s/.test(line) && !line.includes(command))
  if (offender) {
    console.error(`${file} invokes bare \`opencode\` but install.sh only installs \`${command}\`:
    ${offender.trim()}`)
    process.exit(1)
  }
}

const actionYml = fs.readFileSync(path.join(root, "github/action.yml"), "utf8")
if (!actionYml.includes("~/.opencode-personal/bin")) {
  console.error("github/action.yml does not point cache/PATH at ~/.opencode-personal/bin")
  process.exit(1)
}

const duplicatePr = fs.readFileSync(path.join(root, "script/duplicate-pr.ts"), "utf8")
if (!duplicatePr.includes(`command: "${command}"`)) {
  console.error(`script/duplicate-pr.ts does not pass command: "${command}" to the SDK server launcher`)
  process.exit(1)
}

const actionIndex = fs.readFileSync(path.join(root, "github/index.ts"), "utf8")
if (/spawn\((['`])opencode\1/.test(actionIndex)) {
  console.error(`github/index.ts spawns bare \`opencode\` but install.sh only installs \`${command}\``)
  process.exit(1)
}

console.log(`all workflow invocations use \`${command}\` (matching install.sh)`)
