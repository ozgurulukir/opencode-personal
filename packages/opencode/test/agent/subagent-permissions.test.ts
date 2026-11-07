import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import {
  checkNesting,
  deriveSubagentSessionPermission,
  FALLBACK_DENY,
  resolveParentAgent,
  subagentSessionPermission,
  subagentToolRestrictions,
  taskDenyGate,
  taskDenyGateFromRuleset,
} from "../../src/agent/subagent-permissions"
import { Permission } from "../../src/permission"
import { SessionID } from "../../src/session/schema"
import * as Log from "@opencode-ai/core/util/log"

// A subagent with no `task`/`todowrite` allow rules (a deny rule does not
// count as "having" the permission — only allow rules do).
const subagent: Agent.Info = {
  name: "general",
  mode: "subagent",
  permission: [
    { permission: "todowrite", pattern: "*", action: "deny" },
    { permission: "grep", pattern: "*", action: "allow" },
  ],
  options: {},
}

const parentAgent: Agent.Info = {
  name: "plan",
  mode: "primary",
  permission: [
    { permission: "plan_enter", pattern: "*", action: "deny" },
    { permission: "repo_clone", pattern: "*", action: "deny" },
    // allow rules on the parent agent are filtered out (deny-only forwarding
    // for the parent-agent contribution)
    { permission: "question", pattern: "*", action: "allow" },
  ],
  options: {},
}

describe("deriveSubagentSessionPermission", () => {
  test("deriveSubagentSessionPermission forwards the FULL parent session ruleset and appends derived denies after it", () => {
    // allow + ask + deny rules — ALL of them must survive forwarding
    // (locks the truth contra the false "deny-only forwarding" doc claim)
    const parentSessionPermission: Permission.Ruleset = [
      { permission: "read", pattern: "*", action: "allow" },
      { permission: "edit", pattern: "*", action: "ask" },
      { permission: "bash", pattern: "*", action: "deny" },
    ]

    const out = deriveSubagentSessionPermission({ parentSessionPermission, parentAgent, subagent })

    // Full ordering (last-match-wins): every parent session rule first, then
    // the derived todowrite/task denies, then the parent-agent deny rules.
    expect(out).toEqual([
      ...parentSessionPermission,
      { permission: "todowrite", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
      // parent-agent contribution is deny-filtered (question allow dropped)
      { permission: "plan_enter", pattern: "*", action: "deny" },
      { permission: "repo_clone", pattern: "*", action: "deny" },
    ])
  })
})

describe("subagentSessionPermission", () => {
  test("subagentSessionPermission places primary_tools allows LAST", () => {
    const out = subagentSessionPermission({
      parentSessionPermission: [{ permission: "read", pattern: "*", action: "allow" }],
      parentAgent: undefined,
      subagent,
      primaryTools: ["bash", "read"],
    })

    const n = 2
    expect(out.slice(-n)).toEqual([
      { permission: "bash", pattern: "*", action: "allow" },
      { permission: "read", pattern: "*", action: "allow" },
    ])
    // creation-time ordering: allows sit after every derived rule so a later
    // findLast evaluation sees them (the flip side of finding 2)
    expect(out.at(-1)?.action).toBe("allow")
    expect(out.at(-2)?.permission).toBe("bash")
  })
})

describe("subagentToolRestrictions", () => {
  test("subagentToolRestrictions disables todowrite, task, and primary tools when subagent lacks allows", () => {
    expect(subagentToolRestrictions({ subagent, primaryTools: ["bash", "read"] })).toEqual({
      todowrite: false,
      task: false,
      bash: false,
      read: false,
    })
  })
})

describe("resolveParentAgent", () => {
  // Capture `log.warn` from the helper's module-level logger. Deviation from
  // the planned `mock.module("@opencode-ai/core/util/log")` capture: that
  // pattern is import-order brittle — `Log.create` runs AT MODULE LOAD of
  // `subagent-permissions`, so when any earlier test file loads the module
  // first (e.g. `bun test test/agent/` loads plan-mode-subagent-bypass.test.ts
  // first), the mock cannot intercept the already-bound logger (empirically
  // verified: warn assertions fail, shape assertions pass). Instead patch the
  // shared per-service logger object itself — `Log.create` caches one logger
  // per service and `Log._internal` is exported for testing purposes only —
  // which is load-order independent. Restored in `afterEach`.
  const warns: { message?: unknown; data?: Record<string, unknown> }[] = []
  let originalWarn: Log.Logger["warn"] | undefined

  beforeEach(() => {
    const logger = Log._internal.loggers.get("subagent-permissions")
    if (!logger) throw new Error("subagent-permissions logger not found — module failed to load")
    originalWarn = logger.warn
    warns.length = 0
    logger.warn = (message, data) => {
      warns.push({ message, data })
    }
  })

  afterEach(() => {
    const logger = Log._internal.loggers.get("subagent-permissions")
    if (logger && originalWarn) logger.warn = originalWarn
    originalWarn = undefined
  })

  test("resolveParentAgent applies fallback and warns when lookup returns undefined", () => {
    const out = Effect.runSync(
      resolveParentAgent({
        name: "ghost",
        get: () => Effect.succeed(undefined),
      }),
    )

    // Fallback shape: the 5-rule deny set, single-sourced as FALLBACK_DENY
    expect(out?.permission).toEqual(FALLBACK_DENY)
    expect(out?.permission).toEqual([
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "write", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "todowrite", pattern: "*", action: "deny" },
    ])

    // Fix 3: the not-found (`??`) branch now warns with reason "not-found"
    const warn = warns.find((entry) => entry.data?.reason === "not-found")
    expect(warn?.message).toBe("parent agent not found, applying fallback deny rules")
    expect(warn?.data?.parentAgent).toBe("ghost")
  })

  test("resolveParentAgent applies fallback and warns with the squashed cause when lookup defects", () => {
    const out = Effect.runSync(
      resolveParentAgent({
        name: "broken",
        get: () => Effect.die(new Error("agent store exploded")),
      }),
    )

    expect(out?.permission).toEqual(FALLBACK_DENY)
    const warn = warns.find((entry) => entry.data?.parentAgent === "broken")
    expect(warn?.message).toBe("parent agent not found, applying fallback deny rules")
    expect(warn?.data?.cause).toBeInstanceOf(Error)
  })

  test("resolveParentAgent(null) applies fallback and warns (fix 8 / finding 8)", () => {
    // Fix 8 (AD-2): null/undefined parent.agent = unknown provenance →
    // fail-closed with FALLBACK_DENY, same as not-found. No lookup runs.
    const get = () => Effect.die(new Error("lookup must not run for a null agent name"))
    const fromNull = Effect.runSync(resolveParentAgent({ name: null, get }))
    expect(fromNull?.permission).toEqual(FALLBACK_DENY)
    const fromUndefined = Effect.runSync(resolveParentAgent({ name: undefined, get }))
    expect(fromUndefined?.permission).toEqual(FALLBACK_DENY)
    const warn = warns.find((entry) => entry.data?.reason === "null-agent")
    expect(warn?.message).toBe("parent agent not found, applying fallback deny rules")
  })
})

describe("taskDenyGate", () => {
  // Byte-identical to the message V1 (`tool/task.ts`) and V2 (`v2/session.ts`)
  // inlined before consolidation — tests on both sides match on it.
  const deniedMessage = (type: string) =>
    `Permission denied: task tool cannot spawn subagent "${type}" — denied by permission rules`

  test("deny rule on the gate agent denies the spawn with the exact shared message", () => {
    const out = taskDenyGate({
      gateAgentPermission: [{ permission: "task", pattern: "*", action: "deny" }],
      subagentType: "general",
    })
    expect(out.denied).toBe(true)
    expect(out.message).toBe(deniedMessage("general"))
  })

  test("deny wins over an earlier allow (last match wins, matching Permission.evaluate)", () => {
    const out = taskDenyGate({
      gateAgentPermission: [
        { permission: "task", pattern: "*", action: "allow" },
        { permission: "task", pattern: "*", action: "deny" },
      ],
      subagentType: "general",
    })
    expect(out.denied).toBe(true)
  })

  test("allow rule passes the gate", () => {
    const out = taskDenyGate({
      gateAgentPermission: [{ permission: "task", pattern: "*", action: "allow" }],
      subagentType: "general",
    })
    expect(out).toEqual({ denied: false })
  })

  test("undefined permissions pass (no rules → evaluate defaults to ask, not deny)", () => {
    expect(taskDenyGate({ subagentType: "general" })).toEqual({ denied: false })
    expect(taskDenyGate({ gateAgentPermission: undefined, parentSessionPermission: undefined, subagentType: "x" })).toEqual({
      denied: false,
    })
  })

  test("deny pattern matches on the subagent type via wildcard", () => {
    const denied = taskDenyGate({
      parentSessionPermission: [{ permission: "task", pattern: "dangerous-*", action: "deny" }],
      subagentType: "dangerous-agent",
    })
    expect(denied.denied).toBe(true)
    expect(denied.message).toBe(deniedMessage("dangerous-agent"))

    // Non-matching pattern does not deny
    expect(
      taskDenyGate({
        parentSessionPermission: [{ permission: "task", pattern: "dangerous-*", action: "deny" }],
        subagentType: "general",
      }).denied,
    ).toBe(false)
  })

  test("session-level rule overrides agent-level rule on the same key (merge order: agent first, session last)", () => {
    // Locks the merge order replicated from the call sites:
    // merge(gateAgent, session) with findLast evaluation.
    const out = taskDenyGate({
      gateAgentPermission: [{ permission: "task", pattern: "*", action: "deny" }],
      parentSessionPermission: [{ permission: "task", pattern: "*", action: "allow" }],
      subagentType: "general",
    })
    expect(out.denied).toBe(false)
  })

  test("taskDenyGateFromRuleset matches the raw-input gate on the pre-merged ruleset", () => {
    const ruleset: Permission.Ruleset = [
      { permission: "task", pattern: "*", action: "allow" },
      { permission: "task", pattern: "blocked-*", action: "deny" },
    ]
    // Pre-merged path (V1 ctx.extra) agrees with the raw-input path (V2) on
    // the same merged ruleset.
    const merged = Permission.merge(ruleset, [])
    expect(taskDenyGateFromRuleset({ permissionRuleset: ruleset, subagentType: "blocked-agent" }).denied).toBe(true)
    expect(taskDenyGateFromRuleset({ permissionRuleset: merged, subagentType: "general" }).denied).toBe(false)
    // Missing ruleset behaves like the old `?? []` in task.ts
    expect(taskDenyGateFromRuleset({ subagentType: "general" }).denied).toBe(false)
  })
})

describe("checkNesting", () => {
  const start = SessionID.make("ses_start")
  const parent = SessionID.make("ses_parent")
  const root = SessionID.make("ses_root")

  test("checkNesting passes for a 2-level chain", () => {
    // start → parent, parent has no parentID → walk ends within the limit
    const get = (id: SessionID) => Effect.succeed(id === start ? { parentID: parent } : {})
    expect(Effect.runSync(checkNesting({ startID: start, get }))).toBeUndefined()
  })

  test("checkNesting fails at depth 3 with the exact message", () => {
    // start → mid → root: the walk reaches depth 3 (>= MAX) and fails before
    // fetching root — byte-identical to the V1/V2 spawn-path error
    const mid = SessionID.make("ses_mid")
    const get = (id: SessionID) =>
      Effect.succeed(id === start ? { parentID: mid } : id === mid ? { parentID: root } : {})
    expect(() => Effect.runSync(checkNesting({ startID: start, get }))).toThrow(
      new Error("Maximum subagent nesting levels (3) exceeded"),
    )
  })
})
