/**
 * Detects "user denied this tool call" error messages, rendered with a
 * strikethrough in the session views. The substrings match permission-question
 * rejections and rule-based dismissals on both the v1 and v2 session views.
 * Pinned by test/cli/cmd/tui/denied-error.shared.test.ts.
 */
export function isDeniedErrorMessage(message: string | undefined): boolean {
  if (!message) return false
  return (
    message.includes("QuestionRejectedError") ||
    message.includes("rejected permission") ||
    message.includes("specified a rule") ||
    message.includes("user dismissed")
  )
}
