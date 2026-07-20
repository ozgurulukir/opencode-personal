// Prompt textarea component and its state machine for direct interactive mode.
//
// createPromptState() wires keybinds, history navigation, leader-key sequences,
// and `@` autocomplete for files, subagents, and MCP resources.
// It produces a PromptState that RunPromptBody renders as an OpenTUI textarea,
// while the footer view renders the current menu state below it.
//
// This file is a thin re-export of the decomposed modules in prompt/.
// See prompt/autocomplete.ts, prompt/submit.ts, prompt/parts.ts, and prompt/prompt-state.tsx.
/** @jsxImportSource @opentui/solid */
export {
  TEXTAREA_MIN_ROWS,
  TEXTAREA_MAX_ROWS,
  PROMPT_MAX_ROWS,
  HINT_BREAKPOINTS,
  hintFlags,
  RunPromptBody,
  createPromptState,
  type PromptState,
} from "./prompt/prompt-state"
