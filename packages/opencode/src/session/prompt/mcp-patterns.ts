// Extract meaningful patterns from MCP tool arguments for permission scoping.
// Looks for common path/URL fields so "always allow" grants access to a
// specific resource rather than all invocations. Falls back to ["*"] when
// no pattern can be derived.
export function deriveMcpPatterns(args: unknown): string[] {
  if (!args || typeof args !== "object") return ["*"]
  const input = args as Record<string, unknown>
  for (const key of ["filepath", "path", "url", "directory", "file", "pattern", "repo", "repository"]) {
    const val = input[key]
    if (typeof val === "string" && val.length > 0) return [val]
  }
  return ["*"]
}
