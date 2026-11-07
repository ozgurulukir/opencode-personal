import { Permission } from "../permission"
import type { Agent } from "./agent"
import type { SessionID } from "../session/schema"
import { Cause, Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"

export const MAX_SUBAGENT_NESTING_LEVELS = 3

const log = Log.create({ service: "subagent-permissions" })

/**
 * Fallback deny ruleset applied when the parent session's agent cannot be
 * resolved during a subagent spawn. Single source for the 5-rule set that was
 * previously inlined 4× in V1 (`tool/task.ts`) and V2 (`v2/session.ts`).
 */
export const FALLBACK_DENY: Permission.Ruleset = [
  { permission: "edit", pattern: "*", action: "deny" },
  { permission: "write", pattern: "*", action: "deny" },
  { permission: "bash", pattern: "*", action: "deny" },
  { permission: "task", pattern: "*", action: "deny" },
  { permission: "todowrite", pattern: "*", action: "deny" },
]

/**
 * Deny gate evaluated BEFORE a subagent spawn (before agent resolution and any
 * child session creation). Single source for the check previously inlined in
 * V1 (`tool/task.ts`) and V2 (`v2/session.ts`).
 *
 * Semantics match the call sites byte-for-behavior: the merged ruleset is
 * evaluated with `Permission.evaluate("task", subagentType, ...)` (last match
 * wins) and a matching `deny` rule blocks the spawn — including the exact
 * "Permission denied: task tool cannot spawn subagent ..." message both V1
 * and V2 tests match on. Rules are merged agent-first, session-second, so a
 * session-level rule overrides an agent-level rule on the same key.
 *
 * CRITICAL: `gateAgentPermission` must be the gate agent's RAW permission (V1:
 * the loop's live agent permission from `session/loop/tools.ts`; V2: the
 * parent's live agent permission re-resolved for the gate) — NEVER
 * `resolveParentAgent`'s output. The `FALLBACK_DENY` exclusion is deliberate
 * (see v2/AGENTS.md): the fallback carries `task:*`, which would refuse every
 * spawn from an agent-less parent, while the fallback legitimately applies to
 * CHILD permission derivation only.
 */
export function taskDenyGate(input: {
  gateAgentPermission?: Permission.Ruleset
  parentSessionPermission?: Permission.Ruleset
  subagentType: string
}): { denied: boolean; message?: string } {
  return taskDenyGateFromRuleset({
    permissionRuleset: Permission.merge(input.gateAgentPermission ?? [], input.parentSessionPermission ?? []),
    subagentType: input.subagentType,
  })
}

/**
 * Pre-merged-ruleset entry point for `taskDenyGate`. V1's `ctx.extra`
 * (`session/loop/tools.ts` / `session/loop/subtask.ts`) assembles a single
 * merged ruleset (agent permission + session permission, in that order), so
 * TaskTool evaluates the gate through this variant; V2 uses the raw-input
 * `taskDenyGate`. Behavior is identical.
 */
export function taskDenyGateFromRuleset(input: {
  permissionRuleset?: Permission.Ruleset
  subagentType: string
}): { denied: boolean; message?: string } {
  const rule = Permission.evaluate("task", input.subagentType, input.permissionRuleset ?? [])
  if (rule.action === "deny") {
    return {
      denied: true,
      message: `Permission denied: task tool cannot spawn subagent "${input.subagentType}" — denied by permission rules`,
    }
  }
  return { denied: false }
}

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent **session's** permissions (including allowed directory/tool permissions)
 * 2. Default `todowrite` and `task` denies if the subagent's own ruleset doesn't permit them
 * 3. The parent **agent's** deny rules — Plan Mode and other agent-level restrictions
 *    take precedence over session permissions by being placed last (last match wins in evaluate)
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: Permission.Ruleset
  parentAgent: { permission: Permission.Ruleset } | undefined
  subagent: Agent.Info
}): Permission.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task" && rule.action === "allow")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite" && rule.action === "allow")
  const parentAgentDenies = input.parentAgent?.permission.filter((rule) => rule.action === "deny") ?? []
  return Permission.dedupe([
    ...input.parentSessionPermission,
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
    ...parentAgentDenies,
  ])
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
  parentAgent: { permission: Permission.Ruleset } | undefined
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
  const has = (id: string) => input.subagent.permission.some((r) => r.permission === id && r.action === "allow")
  return {
    ...(has("todowrite") ? {} : { todowrite: false }),
    ...(has("task") ? {} : { task: false }),
    ...Object.fromEntries((input.primaryTools ?? []).map((item) => [item, false])),
  }
}

/**
 * Resolve the parent session's agent for a subagent spawn, applying
 * `FALLBACK_DENY` when the agent cannot be resolved. Shared by V1
 * (`tool/task.ts`) and V2 (`v2/session.ts`):
 *
 * - `name` null/undefined → warn (`reason: "null-agent"`) + `FALLBACK_DENY`
 *   (fix 8 / AD-2: null agent = unknown provenance, fail-closed).
 * - lookup returns undefined → warn (`reason: "not-found"`) + `FALLBACK_DENY`
 *   (fix 3).
 * - lookup defects → warn with squashed cause + `FALLBACK_DENY`.
 *
 * Returns only `{ permission }` (a structural supertype of `Agent.Info`) —
 * consumers only read the parent agent's deny rules, and the fallback branches
 * have no agent identity to fabricate. The returned ruleset feeds CHILD
 * permission derivation (`subagentSessionPermission`); it must NOT feed the
 * spawn deny gate (`taskDenyGate`) — FALLBACK_DENY carries `task:*`, which
 * would refuse every spawn from an agent-less parent.
 */
export function resolveParentAgent(input: {
  name: string | null | undefined
  get: (name: string) => Effect.Effect<Agent.Info | undefined>
}): Effect.Effect<{ permission: Permission.Ruleset } | undefined> {
  const name = input.name
  if (!name) {
    // Fix 8 (AD-2): null/unknown provenance fails closed — same treatment
    // as not-found. No lookup runs (there is no name to look up).
    log.warn("parent agent not found, applying fallback deny rules", {
      parentAgent: name ?? null,
      reason: "null-agent",
    })
    return Effect.succeed({ permission: FALLBACK_DENY })
  }
  return input.get(name).pipe(
    Effect.map((found) => {
      if (found) return found
      log.warn("parent agent not found, applying fallback deny rules", {
        parentAgent: name,
        reason: "not-found",
      })
      return { permission: FALLBACK_DENY }
    }),
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        log.warn("parent agent not found, applying fallback deny rules", {
          parentAgent: name,
          cause: Cause.squash(cause),
        })
        return { permission: FALLBACK_DENY }
      }),
    ),
  )
}

/**
 * Walk the `parentID` chain from `startID` before a subagent spawn and fail
 * with the byte-identical nesting error once the chain reaches
 * `MAX_SUBAGENT_NESTING_LEVELS`. Verbatim extraction of the iterative walk in
 * V1 (`tool/task.ts`) / V2 (`v2/session.ts`); `get` is injected so each side
 * passes its own lookup adapter.
 */
export function checkNesting(input: {
  startID: SessionID
  get: (id: SessionID) => Effect.Effect<{ parentID?: SessionID }>
  max?: number // default MAX_SUBAGENT_NESTING_LEVELS
}): Effect.Effect<void, Error> {
  const max = input.max ?? MAX_SUBAGENT_NESTING_LEVELS
  return Effect.gen(function* () {
    for (let depth = 0, currentParentID: SessionID | undefined = input.startID; currentParentID; ) {
      depth++
      if (depth >= max) {
        return yield* Effect.fail(
          new Error(`Maximum subagent nesting levels (${MAX_SUBAGENT_NESTING_LEVELS}) exceeded`),
        )
      }
      const ancestor: { parentID?: SessionID } = yield* input.get(currentParentID)
      currentParentID = ancestor.parentID
    }
  })
}
