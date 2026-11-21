/**
 * Escapes the five HTML-significant characters so untrusted strings can be
 * interpolated into the OAuth success/error pages rendered by the MCP and
 * codex plugin flows.
 */
export function escapeHtml(str: string): string {
  return str.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] || c,
  )
}
