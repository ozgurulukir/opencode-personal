import type { ConfigPermission } from "@/config/permission"

export function toolsToPermissions(tools: Record<string, boolean> = {}, options: { foldEdit?: boolean } = {}) {
  return Object.fromEntries<ConfigPermission.Action>(
    Object.entries(tools).map(([tool, enabled]) => [
      options.foldEdit && (tool === "write" || tool === "edit" || tool === "patch") ? "edit" : tool,
      enabled ? "allow" : "deny",
    ]),
  )
}
