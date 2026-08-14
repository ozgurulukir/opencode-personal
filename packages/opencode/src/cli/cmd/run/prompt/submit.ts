// Pure submit validation logic for the prompt textarea.
//
// Handles slash command parsing, exit detection, and prompt validation.
// All functions are pure — no TUI or SolidJS dependencies.
import { isExitCommand, isNewCommand } from "../prompt.shared"
import { slashHead } from "./autocomplete"
import type { RunCommand, RunPrompt } from "../types"

export type SlashCommand = {
  name: string
  arguments: string
}

export type SlashResult =
  | { type: "none" }
  | { type: "pending" }
  | { type: "command"; command: SlashCommand }

export type ValidationResult =
  | { type: "empty" }
  | { type: "exit" }
  | { type: "pending" }
  | { type: "valid"; command?: SlashCommand }

export function parseSlashCommand(text: string, commands: RunCommand[] | undefined): SlashResult {
  const head = slashHead(text)
  if (!head || head.name.length === 0) {
    return { type: "none" as const }
  }

  if (!commands) {
    return { type: "pending" as const }
  }

  if (!commands.some((item) => item.name === head.name)) {
    return { type: "none" as const }
  }

  return { type: "command" as const, command: { name: head.name, arguments: head.arguments } }
}

export function shouldExit(prompt: RunPrompt): boolean {
  return isExitCommand(prompt.text)
}

export function validateSubmit(prompt: RunPrompt, commands: RunCommand[] | undefined): ValidationResult {
  if (!prompt.text.trim()) {
    return { type: "empty" }
  }

  if (isExitCommand(prompt.text)) {
    return { type: "exit" }
  }

  const parsed = isNewCommand(prompt.text) ? undefined : parseSlashCommand(prompt.text, commands)
  if (parsed?.type === "pending") {
    return { type: "pending" }
  }

  return { type: "valid", command: parsed?.type === "command" ? parsed.command : undefined }
}
