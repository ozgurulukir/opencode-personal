// Ghost-text next-prompt prediction constants + output cleaner.
// The TUI surfaces predictions as gray text in the empty input after each turn
// and accepts it with Tab. Exported from prompt.ts via re-export for unit tests.

export const PREDICT_SYSTEM = `You predict the single most likely next message a user will send to a coding assistant, based on the conversation so far. Output only that next message as one short, natural first-person request (what the user would type). No preamble, no quotes, no explanation, no markdown. Keep it under 100 characters.`

export const PREDICT_NUDGE = `Based on the conversation above, write the user's most likely next message:`

// Cleans the raw LLM output of a predict call. Drops any <think>…</think>
// blocks the model may have emitted, picks the first non-empty line, trims
// matching surrounding quotes, and caps the result at 120 chars (ellipsised).
// Exported for unit tests; keep the regex list tight — every rule here is one
// the user would otherwise see leaking into the input.
export function cleanPrediction(raw: string): string {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!cleaned) return ""
  const stripped = cleaned.replace(/^["'`]+|["'`]+$/g, "")
  return stripped.length > 120 ? stripped.substring(0, 117) + "..." : stripped
}
