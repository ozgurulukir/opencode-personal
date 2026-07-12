import type { Permission } from "../permission"
import type { Agent } from "./agent"

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent **agent's** deny rules — Plan Mode and other agent-level
 *    restrictions live on the agent ruleset, not on the session, so a
 *    subagent that only inherited the parent SESSION's permission would
 *    silently bypass them. (#26514)
 * 2. The parent **session's** deny rules and external_directory rules —
 *    same forwarding the original code already did.
 * 3. Default `todowrite` and `task` denies if the subagent's own ruleset
 *    doesn't already permit them.
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: Permission.Ruleset
  parentAgent: Agent.Info | undefined
  subagent: Agent.Info
}): Permission.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")
  const parentAgentDenies = input.parentAgent?.permission.filter((rule) => rule.action === "deny") ?? []
  return [
    ...parentAgentDenies,
    ...input.parentSessionPermission.filter(
      (rule) => rule.permission === "external_directory" || rule.action === "deny",
    ),
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
  ]
}

/**
 * Full permission array for a subagent's session. Combines
 * `deriveSubagentSessionPermission` with `primary_tools` allow rules.
 *
 * `primary_tools` are `allow`ed in the session permission so slash-command
 * invocations don't block, but `false`d in the tools list (see
 * `subagentToolRestrictions`) so the LLM can't call them directly. This is
 * intentional: primary tools are for the primary agent only, but indirect
 * access via slash commands is permitted.
 */
export function subagentSessionPermission(input: {
  parentSessionPermission: Permission.Ruleset
  parentAgent: Agent.Info | undefined
  subagent: Agent.Info
  primaryTools?: string[]
}): Permission.Ruleset {
  return [
    ...deriveSubagentSessionPermission(input),
    ...(input.primaryTools?.map((item) => ({
      pattern: "*",
      action: "allow" as const,
      permission: item,
    })) ?? []),
  ]
}

/**
 * Tool restrictions map (`{ tool: false }`) to disable tools the subagent
 * shouldn't call directly. Disables `todowrite` and `task` (recursive
 * subagent spawning) unless the subagent's own permission explicitly allows
 * them, plus all `primary_tools`.
 */
export function subagentToolRestrictions(input: {
  subagent: Agent.Info
  primaryTools?: string[]
}): Record<string, boolean> {
  const has = (id: string) => input.subagent.permission.some((r) => r.permission === id)
  return {
    ...(has("todowrite") ? {} : { todowrite: false }),
    ...(has("task") ? {} : { task: false }),
    ...Object.fromEntries((input.primaryTools ?? []).map((item) => [item, false])),
  }
}
