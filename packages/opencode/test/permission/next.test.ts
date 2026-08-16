import { afterEach, test, expect } from "bun:test"
import os from "os"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { Bus } from "../../src/bus"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Permission } from "../../src/permission"
import { PermissionID } from "../../src/permission/schema"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { InstanceRuntime } from "../../src/project/instance-runtime"
import {
  disposeAllInstances,
  provideInstance,
  provideTmpdirInstance,
  reloadTestInstance,
  tmpdirScoped,
} from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { MessageID, SessionID } from "../../src/session/schema"

const bus = Bus.layer
const env = Layer.mergeAll(Permission.layer.pipe(Layer.provide(bus)), bus, CrossSpawnSpawner.defaultLayer)
const it = testEffect(env)

afterEach(async () => {
  await disposeAllInstances()
})

const rejectAll = (message?: string) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    for (const req of yield* permission.list()) {
      yield* permission.reply({
        requestID: req.id,
        reply: "reject",
        message,
      })
    }
  })

const waitForPending = (count: number) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    for (let i = 0; i < 100; i++) {
      const list = yield* permission.list()
      if (list.length === count) return list
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error(`timed out waiting for ${count} pending permission request(s)`))
  })

const fail = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* self.pipe(Effect.exit)
    if (Exit.isFailure(exit)) return Cause.squash(exit.cause)
    throw new Error("expected permission effect to fail")
  })

const ask = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

const reply = (input: Parameters<Permission.Interface["reply"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.reply(input)
  })

const list = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.list()
  })

const listApproved = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.listApproved()
  })

const removeApproved = (input: Parameters<Permission.Interface["removeApproved"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.removeApproved(input)
  })

const clearApproved = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.clearApproved()
  })

function withDir(options: { git?: boolean } | undefined, self: (dir: string) => Effect.Effect<any, any, any>) {
  return provideTmpdirInstance(self, options)
}

function withProvided(dir: string) {
  return <A, E, R>(self: Effect.Effect<A, E, R>) => self.pipe(provideInstance(dir))
}

// fromConfig tests

test("fromConfig - string value becomes wildcard rule", () => {
  const result = Permission.fromConfig({ bash: "allow" })
  expect(result).toEqual([{ permission: "bash", pattern: "*", action: "allow" }])
})

test("fromConfig - object value converts to rules array", () => {
  const result = Permission.fromConfig({ bash: { "*": "allow", rm: "deny" } })
  expect(result).toEqual([
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "rm", action: "deny" },
  ])
})

test("fromConfig - mixed string and object values", () => {
  const result = Permission.fromConfig({
    bash: { "*": "allow", rm: "deny" },
    edit: "allow",
    webfetch: "ask",
  })
  expect(result).toEqual([
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "rm", action: "deny" },
    { permission: "edit", pattern: "*", action: "allow" },
    { permission: "webfetch", pattern: "*", action: "ask" },
  ])
})

test("fromConfig - empty object", () => {
  const result = Permission.fromConfig({})
  expect(result).toEqual([])
})

test("fromConfig - expands tilde to home directory", () => {
  const result = Permission.fromConfig({ external_directory: { "~/projects/*": "allow" } })
  expect(result).toEqual([{ permission: "external_directory", pattern: `${os.homedir()}/projects/*`, action: "allow" }])
})

test("fromConfig - expands $HOME to home directory", () => {
  const result = Permission.fromConfig({ external_directory: { "$HOME/projects/*": "allow" } })
  expect(result).toEqual([{ permission: "external_directory", pattern: `${os.homedir()}/projects/*`, action: "allow" }])
})

test("fromConfig - expands $HOME without trailing slash", () => {
  const result = Permission.fromConfig({ external_directory: { $HOME: "allow" } })
  expect(result).toEqual([{ permission: "external_directory", pattern: os.homedir(), action: "allow" }])
})

test("fromConfig - does not expand tilde in middle of path", () => {
  const result = Permission.fromConfig({ external_directory: { "/some/~/path": "allow" } })
  expect(result).toEqual([{ permission: "external_directory", pattern: "/some/~/path", action: "allow" }])
})

// Permission precedence follows config insertion order. `evaluate()` uses the
// last matching rule, so later config entries intentionally override earlier
// entries even when a wildcard appears after a specific permission.

test("fromConfig - preserves top-level config key order", () => {
  const wildcardFirst = Permission.fromConfig({ "*": "deny", bash: "allow" })
  const specificFirst = Permission.fromConfig({ bash: "allow", "*": "deny" })

  expect(wildcardFirst.map((r) => r.permission)).toEqual(["*", "bash"])
  expect(specificFirst.map((r) => r.permission)).toEqual(["bash", "*"])

  expect(Permission.evaluate("bash", "ls", wildcardFirst).action).toBe("allow")
  expect(Permission.evaluate("bash", "ls", specificFirst).action).toBe("deny")
})

test("fromConfig - wildcard acts as fallback when it appears before specifics", () => {
  const ruleset = Permission.fromConfig({ "*": "ask", bash: "allow" })
  expect(Permission.evaluate("edit", "foo.ts", ruleset).action).toBe("ask")
  expect(Permission.evaluate("bash", "ls", ruleset).action).toBe("allow")
})

test("fromConfig - top-level ordering is not sorted by wildcard specificity", () => {
  const ruleset = Permission.fromConfig({
    bash: "allow",
    "*": "ask",
    edit: "deny",
    "mcp_*": "allow",
  })
  expect(ruleset.map((r) => r.permission)).toEqual(["bash", "*", "edit", "mcp_*"])
})

test("fromConfig - sub-pattern insertion order inside a tool key is preserved", () => {
  const ruleset = Permission.fromConfig({ bash: { "*": "deny", "git *": "allow" } })
  expect(ruleset.map((r) => r.pattern)).toEqual(["*", "git *"])
  expect(Permission.evaluate("bash", "rm foo", ruleset).action).toBe("deny")
  expect(Permission.evaluate("bash", "git status", ruleset).action).toBe("allow")
})

test("fromConfig - documented fallback-first example", () => {
  const ruleset = Permission.fromConfig({ "*": "ask", bash: "allow", edit: "deny" })
  expect(Permission.evaluate("bash", "ls", ruleset).action).toBe("allow")
  expect(Permission.evaluate("edit", "foo.ts", ruleset).action).toBe("deny")
  expect(Permission.evaluate("read", "foo.ts", ruleset).action).toBe("ask")
})

test("fromConfig - expands exact tilde to home directory", () => {
  const result = Permission.fromConfig({ external_directory: { "~": "allow" } })
  expect(result).toEqual([{ permission: "external_directory", pattern: os.homedir(), action: "allow" }])
})

test("evaluate - matches expanded tilde pattern", () => {
  const ruleset = Permission.fromConfig({ external_directory: { "~/projects/*": "allow" } })
  const result = Permission.evaluate("external_directory", `${os.homedir()}/projects/file.txt`, ruleset)
  expect(result.action).toBe("allow")
})

test("evaluate - matches expanded $HOME pattern", () => {
  const ruleset = Permission.fromConfig({ external_directory: { "$HOME/projects/*": "allow" } })
  const result = Permission.evaluate("external_directory", `${os.homedir()}/projects/file.txt`, ruleset)
  expect(result.action).toBe("allow")
})

// merge tests

test("merge - simple concatenation", () => {
  const result = Permission.merge(
    [{ permission: "bash", pattern: "*", action: "allow" }],
    [{ permission: "bash", pattern: "*", action: "deny" }],
  )
  expect(result).toEqual([
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "*", action: "deny" },
  ])
})

test("merge - adds new permission", () => {
  const result = Permission.merge(
    [{ permission: "bash", pattern: "*", action: "allow" }],
    [{ permission: "edit", pattern: "*", action: "deny" }],
  )
  expect(result).toEqual([
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "edit", pattern: "*", action: "deny" },
  ])
})

test("merge - concatenates rules for same permission", () => {
  const result = Permission.merge(
    [{ permission: "bash", pattern: "foo", action: "ask" }],
    [{ permission: "bash", pattern: "*", action: "deny" }],
  )
  expect(result).toEqual([
    { permission: "bash", pattern: "foo", action: "ask" },
    { permission: "bash", pattern: "*", action: "deny" },
  ])
})

test("merge - multiple rulesets", () => {
  const result = Permission.merge(
    [{ permission: "bash", pattern: "*", action: "allow" }],
    [{ permission: "bash", pattern: "rm", action: "ask" }],
    [{ permission: "edit", pattern: "*", action: "allow" }],
  )
  expect(result).toEqual([
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "rm", action: "ask" },
    { permission: "edit", pattern: "*", action: "allow" },
  ])
})

test("merge - empty ruleset does nothing", () => {
  const result = Permission.merge([{ permission: "bash", pattern: "*", action: "allow" }], [])
  expect(result).toEqual([{ permission: "bash", pattern: "*", action: "allow" }])
})

test("merge - preserves rule order", () => {
  const result = Permission.merge(
    [
      { permission: "edit", pattern: "src/*", action: "allow" },
      { permission: "edit", pattern: "src/secret/*", action: "deny" },
    ],
    [{ permission: "edit", pattern: "src/secret/ok.ts", action: "allow" }],
  )
  expect(result).toEqual([
    { permission: "edit", pattern: "src/*", action: "allow" },
    { permission: "edit", pattern: "src/secret/*", action: "deny" },
    { permission: "edit", pattern: "src/secret/ok.ts", action: "allow" },
  ])
})

test("merge - config permission overrides default ask", () => {
  const defaults: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "ask" }]
  const config: Permission.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
  const merged = Permission.merge(defaults, config)

  expect(Permission.evaluate("bash", "ls", merged).action).toBe("allow")
  expect(Permission.evaluate("edit", "foo.ts", merged).action).toBe("ask")
})

test("merge - config ask overrides default allow", () => {
  const defaults: Permission.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
  const config: Permission.Ruleset = [{ permission: "bash", pattern: "*", action: "ask" }]
  const merged = Permission.merge(defaults, config)

  expect(Permission.evaluate("bash", "ls", merged).action).toBe("ask")
})

// evaluate tests

test("evaluate - exact pattern match", () => {
  const result = Permission.evaluate("bash", "rm", [{ permission: "bash", pattern: "rm", action: "deny" }])
  expect(result.action).toBe("deny")
})

test("evaluate - wildcard pattern match", () => {
  const result = Permission.evaluate("bash", "rm", [{ permission: "bash", pattern: "*", action: "allow" }])
  expect(result.action).toBe("allow")
})

test("evaluate - last matching rule wins", () => {
  const result = Permission.evaluate("bash", "rm", [
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "rm", action: "deny" },
  ])
  expect(result.action).toBe("deny")
})

test("evaluate - last matching rule wins (wildcard after specific)", () => {
  const result = Permission.evaluate("bash", "rm", [
    { permission: "bash", pattern: "rm", action: "deny" },
    { permission: "bash", pattern: "*", action: "allow" },
  ])
  expect(result.action).toBe("allow")
})

test("evaluate - glob pattern match", () => {
  const result = Permission.evaluate("edit", "src/foo.ts", [{ permission: "edit", pattern: "src/*", action: "allow" }])
  expect(result.action).toBe("allow")
})

test("evaluate - last matching glob wins", () => {
  const result = Permission.evaluate("edit", "src/components/Button.tsx", [
    { permission: "edit", pattern: "src/*", action: "deny" },
    { permission: "edit", pattern: "src/components/*", action: "allow" },
  ])
  expect(result.action).toBe("allow")
})

test("evaluate - order matters for specificity", () => {
  const result = Permission.evaluate("edit", "src/components/Button.tsx", [
    { permission: "edit", pattern: "src/components/*", action: "allow" },
    { permission: "edit", pattern: "src/*", action: "deny" },
  ])
  expect(result.action).toBe("deny")
})

test("evaluate - unknown permission returns ask", () => {
  const result = Permission.evaluate("unknown_tool", "anything", [
    { permission: "bash", pattern: "*", action: "allow" },
  ])
  expect(result.action).toBe("ask")
})

test("evaluate - empty ruleset returns ask", () => {
  const result = Permission.evaluate("bash", "rm", [])
  expect(result.action).toBe("ask")
})

test("evaluate - no matching pattern returns ask", () => {
  const result = Permission.evaluate("edit", "etc/passwd", [{ permission: "edit", pattern: "src/*", action: "allow" }])
  expect(result.action).toBe("ask")
})

test("evaluate - empty rules array returns ask", () => {
  const result = Permission.evaluate("bash", "rm", [])
  expect(result.action).toBe("ask")
})

test("evaluate - multiple matching patterns, last wins", () => {
  const result = Permission.evaluate("edit", "src/secret.ts", [
    { permission: "edit", pattern: "*", action: "ask" },
    { permission: "edit", pattern: "src/*", action: "allow" },
    { permission: "edit", pattern: "src/secret.ts", action: "deny" },
  ])
  expect(result.action).toBe("deny")
})

test("evaluate - non-matching patterns are skipped", () => {
  const result = Permission.evaluate("edit", "src/foo.ts", [
    { permission: "edit", pattern: "*", action: "ask" },
    { permission: "edit", pattern: "test/*", action: "deny" },
    { permission: "edit", pattern: "src/*", action: "allow" },
  ])
  expect(result.action).toBe("allow")
})

test("evaluate - exact match at end wins over earlier wildcard", () => {
  const result = Permission.evaluate("bash", "/bin/rm", [
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "/bin/rm", action: "deny" },
  ])
  expect(result.action).toBe("deny")
})

test("evaluate - wildcard at end overrides earlier exact match", () => {
  const result = Permission.evaluate("bash", "/bin/rm", [
    { permission: "bash", pattern: "/bin/rm", action: "deny" },
    { permission: "bash", pattern: "*", action: "allow" },
  ])
  expect(result.action).toBe("allow")
})

// wildcard permission tests

test("evaluate - wildcard permission matches any permission", () => {
  const result = Permission.evaluate("bash", "rm", [{ permission: "*", pattern: "*", action: "deny" }])
  expect(result.action).toBe("deny")
})

test("evaluate - wildcard permission with specific pattern", () => {
  const result = Permission.evaluate("bash", "rm", [{ permission: "*", pattern: "rm", action: "deny" }])
  expect(result.action).toBe("deny")
})

test("evaluate - glob permission pattern", () => {
  const result = Permission.evaluate("mcp_server_tool", "anything", [
    { permission: "mcp_*", pattern: "*", action: "allow" },
  ])
  expect(result.action).toBe("allow")
})

test("evaluate - specific permission and wildcard permission combined", () => {
  const result = Permission.evaluate("bash", "rm", [
    { permission: "*", pattern: "*", action: "deny" },
    { permission: "bash", pattern: "*", action: "allow" },
  ])
  expect(result.action).toBe("allow")
})

test("evaluate - wildcard permission does not match when specific exists", () => {
  const result = Permission.evaluate("edit", "src/foo.ts", [
    { permission: "*", pattern: "*", action: "deny" },
    { permission: "edit", pattern: "src/*", action: "allow" },
  ])
  expect(result.action).toBe("allow")
})

test("evaluate - multiple matching permission patterns combine rules", () => {
  const result = Permission.evaluate("mcp_dangerous", "anything", [
    { permission: "*", pattern: "*", action: "ask" },
    { permission: "mcp_*", pattern: "*", action: "allow" },
    { permission: "mcp_dangerous", pattern: "*", action: "deny" },
  ])
  expect(result.action).toBe("deny")
})

test("evaluate - wildcard permission fallback for unknown tool", () => {
  const result = Permission.evaluate("unknown_tool", "anything", [
    { permission: "*", pattern: "*", action: "ask" },
    { permission: "bash", pattern: "*", action: "allow" },
  ])
  expect(result.action).toBe("ask")
})

test("evaluate - later wildcard permission can override earlier specific permission", () => {
  const result = Permission.evaluate("bash", "rm", [
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "*", pattern: "*", action: "deny" },
  ])
  expect(result.action).toBe("deny")
})

test("evaluate - merges multiple rulesets", () => {
  const config: Permission.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
  const approved: Permission.Ruleset = [{ permission: "bash", pattern: "rm", action: "deny" }]
  const result = Permission.evaluate("bash", "rm", config, approved)
  expect(result.action).toBe("deny")
})

// disabled tests

test("disabled - returns empty set when all tools allowed", () => {
  const result = Permission.disabled(["bash", "edit", "read"], [{ permission: "*", pattern: "*", action: "allow" }])
  expect(result.size).toBe(0)
})

test("disabled - disables tool when denied", () => {
  const result = Permission.disabled(
    ["bash", "edit", "read"],
    [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "*", action: "deny" },
    ],
  )
  expect(result.has("bash")).toBe(true)
  expect(result.has("edit")).toBe(false)
  expect(result.has("read")).toBe(false)
})

test("disabled - disables edit/write/apply_patch when edit denied", () => {
  const result = Permission.disabled(
    ["edit", "write", "apply_patch", "bash"],
    [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "edit", pattern: "*", action: "deny" },
    ],
  )
  expect(result.has("edit")).toBe(true)
  expect(result.has("write")).toBe(true)
  expect(result.has("apply_patch")).toBe(true)
  expect(result.has("bash")).toBe(false)
})

test("disabled - does not disable when partially denied", () => {
  const result = Permission.disabled(
    ["bash"],
    [
      { permission: "bash", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "rm *", action: "deny" },
    ],
  )
  expect(result.has("bash")).toBe(false)
})

test("disabled - does not disable when action is ask", () => {
  const result = Permission.disabled(["bash", "edit"], [{ permission: "*", pattern: "*", action: "ask" }])
  expect(result.size).toBe(0)
})

test("disabled - does not disable when specific allow after wildcard deny", () => {
  const result = Permission.disabled(
    ["bash"],
    [
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "echo *", action: "allow" },
    ],
  )
  expect(result.has("bash")).toBe(false)
})

test("disabled - does not disable when wildcard allow after deny", () => {
  const result = Permission.disabled(
    ["bash"],
    [
      { permission: "bash", pattern: "rm *", action: "deny" },
      { permission: "bash", pattern: "*", action: "allow" },
    ],
  )
  expect(result.has("bash")).toBe(false)
})

test("disabled - disables multiple tools", () => {
  const result = Permission.disabled(
    ["bash", "edit", "webfetch"],
    [
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "webfetch", pattern: "*", action: "deny" },
    ],
  )
  expect(result.has("bash")).toBe(true)
  expect(result.has("edit")).toBe(true)
  expect(result.has("webfetch")).toBe(true)
})

test("disabled - wildcard permission denies all tools", () => {
  const result = Permission.disabled(["bash", "edit", "read"], [{ permission: "*", pattern: "*", action: "deny" }])
  expect(result.has("bash")).toBe(true)
  expect(result.has("edit")).toBe(true)
  expect(result.has("read")).toBe(true)
})

test("disabled - specific allow overrides wildcard deny", () => {
  const result = Permission.disabled(
    ["bash", "edit", "read"],
    [
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "allow" },
    ],
  )
  expect(result.has("bash")).toBe(false)
  expect(result.has("edit")).toBe(true)
  expect(result.has("read")).toBe(true)
})

test("disabled - specific pattern allow overrides wildcard deny", () => {
  const result = Permission.disabled(
    ["edit"],
    [
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "*", pattern: "*.md", action: "allow" },
    ],
  )
  expect(result.has("edit")).toBe(false)
})

test("disabled - specific permission allow overrides wildcard deny", () => {
  const result = Permission.disabled(
    ["edit"],
    [
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "edit", pattern: "*", action: "allow" },
    ],
  )
  expect(result.has("edit")).toBe(false)
})

// ask tests

it.live("ask - resolves immediately when action is allow", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const result = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "allow" }],
      })
      expect(result).toBeUndefined()
    }),
  ),
)

it.live("ask - throws DeniedError when action is deny", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const err = yield* fail(
        ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: {},
          always: [],
          ruleset: [{ permission: "bash", pattern: "*", action: "deny" }],
        }),
      )
      expect(err).toBeInstanceOf(Permission.DeniedError)
    }),
  ),
)

it.live("ask - stays pending when action is ask", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
      }).pipe(Effect.forkScoped)

      expect(yield* waitForPending(1)).toHaveLength(1)
      yield* rejectAll()
      yield* Fiber.await(fiber)
    }),
  ),
)

it.live("ask - adds request to pending list", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["unique-pattern-pending-list"],
        metadata: { cmd: "ls" },
        always: ["unique-pattern-pending-list"],
        tool: {
          messageID: MessageID.make("msg_test"),
          callID: "call_test",
        },
        ruleset: [],
      }).pipe(Effect.forkScoped)

      const items = yield* waitForPending(1)
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["unique-pattern-pending-list"],
        metadata: { cmd: "ls" },
        always: ["unique-pattern-pending-list"],
        tool: {
          messageID: MessageID.make("msg_test"),
          callID: "call_test",
        },
      })

      yield* rejectAll()
      yield* Fiber.await(fiber)
    }),
  ),
)

it.live("ask - publishes asked event", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      let seen: Permission.Request | undefined
      const unsub = yield* bus.subscribeCallback(Permission.Event.Asked, (event) => {
        seen = event.properties
      })

      try {
        const fiber = yield* ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["unique-pattern-asked-event"],
          metadata: { cmd: "ls" },
          always: ["unique-pattern-asked-event"],
          tool: {
            messageID: MessageID.make("msg_test"),
            callID: "call_test",
          },
          ruleset: [],
        }).pipe(Effect.forkScoped)

        expect(yield* waitForPending(1)).toHaveLength(1)
        expect(seen).toBeDefined()
        expect(seen).toMatchObject({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["unique-pattern-asked-event"],
        })

        yield* rejectAll()
        yield* Fiber.await(fiber)
      } finally {
        unsub()
      }
    }),
  ),
)

// reply tests

it.live("reply - once resolves the pending ask", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionID.make("per_test1"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)
      yield* reply({ requestID: PermissionID.make("per_test1"), reply: "once" })
      yield* Fiber.join(fiber)
    }),
  ),
)

it.live("reply - reject throws RejectedError", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionID.make("per_test2"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)
      yield* reply({ requestID: PermissionID.make("per_test2"), reply: "reject" })

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.RejectedError)
    }),
  ),
)

it.live("reply - reject with message throws CorrectedError", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionID.make("per_test2b"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)
      yield* reply({
        requestID: PermissionID.make("per_test2b"),
        reply: "reject",
        message: "Use a safer command",
      })

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(err).toBeInstanceOf(Permission.CorrectedError)
        expect(String(err)).toContain("Use a safer command")
      }
    }),
  ),
)

it.live("reply - always persists approval and resolves", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionID.make("per_test3"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["unique-pattern-persist"],
        metadata: {},
        always: ["unique-pattern-persist"],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)
      yield* reply({ requestID: PermissionID.make("per_test3"), reply: "always" })
      yield* Fiber.join(fiber)

      const result = yield* ask({
        sessionID: SessionID.make("session_test2"),
        permission: "bash",
        patterns: ["unique-pattern-persist"],
        metadata: {},
        always: [],
        ruleset: [],
      })
      expect(result).toBeUndefined()
    }),
  ),
)

it.live("reply - always approval overrides config ask rule on subsequent calls", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const askRuleset: Permission.Ruleset = [{ permission: "external_directory", pattern: "*", action: "ask" }]

      const fiber = yield* ask({
        id: PermissionID.make("per_always_ask"),
        sessionID: SessionID.make("session_sub"),
        permission: "external_directory",
        patterns: ["/tmp/ext/*"],
        metadata: {},
        always: ["/tmp/ext/*"],
        ruleset: askRuleset,
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)
      yield* reply({ requestID: PermissionID.make("per_always_ask"), reply: "always" })
      yield* Fiber.join(fiber)

      // Same ruleset with "ask" — the DB-persisted "always allow" must win
      const result = yield* ask({
        sessionID: SessionID.make("session_sub2"),
        permission: "external_directory",
        patterns: ["/tmp/ext/*"],
        metadata: {},
        always: [],
        ruleset: askRuleset,
      })
      expect(result).toBeUndefined()
    }),
  ),
)

it.live("reply - always approval does not override config deny rule", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const askRuleset: Permission.Ruleset = [{ permission: "edit", pattern: "*", action: "ask" }]

      const fiber = yield* ask({
        id: PermissionID.make("per_always_deny"),
        sessionID: SessionID.make("session_deny"),
        permission: "edit",
        patterns: ["src/foo.ts"],
        metadata: {},
        always: ["*"],
        ruleset: askRuleset,
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)
      yield* reply({ requestID: PermissionID.make("per_always_deny"), reply: "always" })
      yield* Fiber.join(fiber)

      // Deny rule must still win over DB-persisted "always allow"
      const err = yield* fail(
        ask({
          sessionID: SessionID.make("session_deny2"),
          permission: "edit",
          patterns: ["src/foo.ts"],
          metadata: {},
          always: [],
          ruleset: [{ permission: "edit", pattern: "*", action: "deny" }],
        }),
      )
      expect(err).toBeInstanceOf(Permission.DeniedError)
    }),
  ),
)

it.live("reply - reject cancels all pending for same session", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const a = yield* ask({
        id: PermissionID.make("per_test4a"),
        sessionID: SessionID.make("session_same"),
        permission: "bash",
        patterns: ["unique-pattern-reject-a"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      const b = yield* ask({
        id: PermissionID.make("per_test4b"),
        sessionID: SessionID.make("session_same"),
        permission: "edit",
        patterns: ["unique-pattern-reject-b"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* Effect.yieldNow
      yield* waitForPending(2)
      yield* reply({ requestID: PermissionID.make("per_test4a"), reply: "reject" })

      const [ea, eb] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
      expect(Exit.isFailure(ea)).toBe(true)
      expect(Exit.isFailure(eb)).toBe(true)
      if (Exit.isFailure(ea)) expect(Cause.squash(ea.cause)).toBeInstanceOf(Permission.RejectedError)
      if (Exit.isFailure(eb)) expect(Cause.squash(eb.cause)).toBeInstanceOf(Permission.RejectedError)
    }),
  ),
)

it.live("reply - always resolves matching pending requests in same session", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const a = yield* ask({
        id: PermissionID.make("per_test5a"),
        sessionID: SessionID.make("session_same"),
        permission: "bash",
        patterns: ["unique-pattern-same-session"],
        metadata: {},
        always: ["unique-pattern-same-session"],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      const b = yield* ask({
        id: PermissionID.make("per_test5b"),
        sessionID: SessionID.make("session_same"),
        permission: "bash",
        patterns: ["unique-pattern-same-session"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(2)
      yield* reply({ requestID: PermissionID.make("per_test5a"), reply: "always" })

      yield* Fiber.join(a)
      yield* Fiber.join(b)
      expect(yield* list()).toHaveLength(0)
    }),
  ),
)

it.live("reply - concurrent always replies for different patterns both persist", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const a = yield* ask({
        id: PermissionID.make("per_concurrent_a"),
        sessionID: SessionID.make("session_concurrent"),
        permission: "bash",
        patterns: ["unique-pattern-concurrent-a"],
        metadata: {},
        always: ["unique-pattern-concurrent-a"],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      const b = yield* ask({
        id: PermissionID.make("per_concurrent_b"),
        sessionID: SessionID.make("session_concurrent"),
        permission: "bash",
        patterns: ["unique-pattern-concurrent-b"],
        metadata: {},
        always: ["unique-pattern-concurrent-b"],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(2)
      yield* reply({ requestID: PermissionID.make("per_concurrent_a"), reply: "always" })
      yield* reply({ requestID: PermissionID.make("per_concurrent_b"), reply: "always" })

      yield* Fiber.join(a)
      yield* Fiber.join(b)

      // Both patterns should be approved on subsequent calls
      const resultA = yield* ask({
        sessionID: SessionID.make("session_concurrent_verify"),
        permission: "bash",
        patterns: ["unique-pattern-concurrent-a"],
        metadata: {},
        always: [],
        ruleset: [],
      })
      expect(resultA).toBeUndefined()

      const resultB = yield* ask({
        sessionID: SessionID.make("session_concurrent_verify2"),
        permission: "bash",
        patterns: ["unique-pattern-concurrent-b"],
        metadata: {},
        always: [],
        ruleset: [],
      })
      expect(resultB).toBeUndefined()
    }),
  ),
)

it.live("reply - always keeps other session pending", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const a = yield* ask({
        id: PermissionID.make("per_test6a"),
        sessionID: SessionID.make("session_a"),
        permission: "bash",
        patterns: ["unique-pattern-a"],
        metadata: {},
        always: ["unique-pattern-a"],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      const b = yield* ask({
        id: PermissionID.make("per_test6b"),
        sessionID: SessionID.make("session_b"),
        permission: "bash",
        patterns: ["unique-pattern-b"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(2)
      yield* reply({ requestID: PermissionID.make("per_test6a"), reply: "always" })

      yield* Fiber.join(a)
      expect((yield* list()).map((item) => item.id)).toEqual([PermissionID.make("per_test6b")])

      yield* rejectAll()
      yield* Fiber.await(b)
    }),
  ),
)

it.live("reply - publishes replied event", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      let resolve!: (value: { sessionID: SessionID; requestID: PermissionID; reply: Permission.Reply }) => void
      const seen = Effect.promise<{
        sessionID: SessionID
        requestID: PermissionID
        reply: Permission.Reply
      }>(
        () =>
          new Promise((res) => {
            resolve = res
          }),
      )

      const fiber = yield* ask({
        id: PermissionID.make("per_test7"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["unique-pattern-pub"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)

      const unsub = yield* bus.subscribeCallback(Permission.Event.Replied, (event) => {
        resolve(event.properties)
      })

      try {
        yield* reply({ requestID: PermissionID.make("per_test7"), reply: "once" })
        yield* Fiber.join(fiber)
        expect(yield* seen).toEqual({
          sessionID: SessionID.make("session_test"),
          requestID: PermissionID.make("per_test7"),
          reply: "once",
        })
      } finally {
        unsub()
      }
    }),
  ),
)

it.live("permission requests stay isolated by directory", () =>
  Effect.gen(function* () {
    const one = yield* tmpdirScoped({ git: true })
    const two = yield* tmpdirScoped({ git: true })

    const a = yield* ask({
      id: PermissionID.make("per_dir_a"),
      sessionID: SessionID.make("session_dir_a"),
      permission: "bash",
      patterns: ["ls"],
      metadata: {},
      always: [],
      ruleset: [],
    }).pipe(provideInstance(one), Effect.forkScoped)

    const b = yield* ask({
      id: PermissionID.make("per_dir_b"),
      sessionID: SessionID.make("session_dir_b"),
      permission: "bash",
      patterns: ["pwd"],
      metadata: {},
      always: [],
      ruleset: [],
    }).pipe(provideInstance(two), Effect.forkScoped)

    const onePending = yield* waitForPending(1).pipe(provideInstance(one))
    const twoPending = yield* waitForPending(1).pipe(provideInstance(two))

    expect(onePending).toHaveLength(1)
    expect(twoPending).toHaveLength(1)
    expect(onePending[0].id).toBe(PermissionID.make("per_dir_a"))
    expect(twoPending[0].id).toBe(PermissionID.make("per_dir_b"))

    yield* reply({ requestID: onePending[0].id, reply: "reject" }).pipe(provideInstance(one))
    yield* reply({ requestID: twoPending[0].id, reply: "reject" }).pipe(provideInstance(two))

    yield* Fiber.await(a)
    yield* Fiber.await(b)
  }),
)

it.live("pending permission rejects on instance dispose", () =>
  withDir({ git: true }, (dir) =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionID.make("per_dispose"),
        sessionID: SessionID.make("session_dispose"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      expect(yield* waitForPending(1)).toHaveLength(1)
      yield* Effect.promise(() =>
        WithInstance.provide({ directory: dir, fn: () => void InstanceRuntime.disposeInstance(Instance.current) }),
      )

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.RejectedError)
    }),
  ),
)

it.live("pending permission rejects on instance reload", () =>
  withDir({ git: true }, (dir) =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionID.make("per_reload"),
        sessionID: SessionID.make("session_reload"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      expect(yield* waitForPending(1)).toHaveLength(1)
      yield* Effect.promise(() => reloadTestInstance({ directory: dir }))

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.RejectedError)
    }),
  ),
)

it.live("reply - does nothing for unknown requestID", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      yield* reply({ requestID: PermissionID.make("per_unknown"), reply: "once" })
      expect(yield* list()).toHaveLength(0)
    }),
  ),
)

it.live("ask - checks all patterns and stops on first deny", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const err = yield* fail(
        ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["echo hello", "rm -rf /"],
          metadata: {},
          always: [],
          ruleset: [
            { permission: "bash", pattern: "*", action: "allow" },
            { permission: "bash", pattern: "rm *", action: "deny" },
          ],
        }),
      )
      expect(err).toBeInstanceOf(Permission.DeniedError)
    }),
  ),
)

it.live("ask - allows all patterns when all match allow rules", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const result = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["echo hello", "ls -la", "pwd"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "allow" }],
      })
      expect(result).toBeUndefined()
    }),
  ),
)

it.live("ask - should deny even when an earlier pattern is ask", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const err = yield* fail(
        ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["echo hello", "rm -rf /"],
          metadata: {},
          always: [],
          ruleset: [
            { permission: "bash", pattern: "echo *", action: "ask" },
            { permission: "bash", pattern: "rm *", action: "deny" },
          ],
        }),
      )

      expect(err).toBeInstanceOf(Permission.DeniedError)
      expect(yield* list()).toHaveLength(0)
    }),
  ),
)

it.live("ask - abort should clear pending request", () =>
  withDir({ git: true }, (dir) =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionID.make("per_reload"),
        sessionID: SessionID.make("session_reload"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
      }).pipe(Effect.forkScoped)

      const pending = yield* waitForPending(1)
      expect(pending).toHaveLength(1)
      yield* Effect.promise(() => reloadTestInstance({ directory: dir }))

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.RejectedError)
    }),
  ),
)

// --- ask timeout (safety net) ---
//
// The permission layer needs a real instance (InstanceState backed by ScopedCache),
// which the TestClock-based `it.effect` runtime cannot provide, so these timeout
// tests use `it.live` with short `timeoutMs` overrides rather than TestClock.

it.live("ask - resolves when reply arrives before the timeout override", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionID.make("per_to_reply_first"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
        timeoutMs: 60_000,
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)
      yield* reply({ requestID: PermissionID.make("per_to_reply_first"), reply: "once" })
      yield* Fiber.join(fiber)
    }),
  ),
)

it.live("ask - fails with TimedOutError after the timeout override expires", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionID.make("per_to_expire"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
        timeoutMs: 50,
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.TimedOutError)
      // The pending entry is removed by the `ensuring` finalizer once the timeout branch wins.
      expect(yield* list()).toHaveLength(0)
    }),
  ),
)

it.live("ask - publishes Event.Replied(reject) on timeout with the correct requestID", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const requestID = PermissionID.make("per_to_pub")
      let resolve!: (value: { sessionID: SessionID; requestID: PermissionID; reply: Permission.Reply }) => void
      const seen = Effect.promise<{ sessionID: SessionID; requestID: PermissionID; reply: Permission.Reply }>(
        () =>
          new Promise((res) => {
            resolve = res
          }),
      )

      const unsub = yield* bus.subscribeCallback(Permission.Event.Replied, (event) => {
        resolve(event.properties)
      })

      try {
        const fiber = yield* ask({
          id: requestID,
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: [],
          timeoutMs: 50,
        }).pipe(Effect.forkScoped)

        yield* waitForPending(1)
        expect(yield* seen).toEqual({
          sessionID: SessionID.make("session_test"),
          requestID,
          reply: "reject",
        })
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.TimedOutError)
      } finally {
        unsub()
      }
    }),
  ),
)

it.live("ask - long timeout override waits instead of timing out early", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionID.make("per_to_long"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
        timeoutMs: 60_000,
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)
      // A short window that would exceed a small default must not expire a 60s override.
      yield* Effect.sleep("100 millis")
      expect(yield* list()).toHaveLength(1)
      yield* rejectAll()
      yield* Fiber.await(fiber)
    }),
  ),
)

test("dedupe - eliminates duplicate rules preserving last match", () => {
  const rules = [
    { permission: "bash", pattern: "ls", action: "allow" as const },
    { permission: "read", pattern: "file.txt", action: "allow" as const },
    { permission: "bash", pattern: "ls", action: "allow" as const },
  ]
  const result = Permission.dedupe(rules)
  expect(result).toHaveLength(2)
  expect(result).toEqual([
    { permission: "read", pattern: "file.txt", action: "allow" },
    { permission: "bash", pattern: "ls", action: "allow" },
  ])
})

test("fromConfig - expand handles ~/ and $HOME without corrupting variables", () => {
  const home = os.homedir()
  const result = Permission.fromConfig({
    read: {
      "~/foo": "allow",
      "$HOME/bar": "allow",
      "$HOME_DIR/baz": "allow",
    },
  })
  expect(result).toContainEqual({ permission: "read", pattern: `${home}/foo`, action: "allow" })
  expect(result).toContainEqual({ permission: "read", pattern: `${home}/bar`, action: "allow" })
  expect(result).toContainEqual({ permission: "read", pattern: "$HOME_DIR/baz", action: "allow" })
})

it.live("ask - empty patterns array is normalized to catch-all and enforces deny rule", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const err = yield* fail(
        ask({
          id: PermissionID.make("per_empty_patterns_deny"),
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: [],
          metadata: {},
          always: [],
          ruleset: [{ permission: "bash", pattern: "*", action: "deny" }],
        }),
      )
      expect(err).toBeInstanceOf(Permission.DeniedError)
    }),
  ),
)

it.live("reply - deduplicates approved rules on always reply", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionID.make("per_dup_1"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["unique-dup-cmd"],
        metadata: {},
        always: ["unique-dup-cmd", "unique-dup-cmd"],
        ruleset: [],
      }).pipe(Effect.forkScoped)
      yield* waitForPending(1)
      yield* reply({ requestID: PermissionID.make("per_dup_1"), reply: "always" })
      yield* Fiber.await(fiber)

      const approved = yield* listApproved()
      expect(approved).toHaveLength(1)
      expect(approved).toEqual([{ permission: "bash", pattern: "unique-dup-cmd", action: "allow" }])
    }),
  ),
)

it.live("removeApproved & clearApproved - removes rules and persists across reload", () =>
  withDir({ git: true }, (dir) =>
    Effect.gen(function* () {
      const fiber1 = yield* ask({
        id: PermissionID.make("per_crud_1"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["unique-crud-cmd-1"],
        metadata: {},
        always: ["unique-crud-cmd-1"],
        ruleset: [],
      }).pipe(Effect.forkScoped)
      yield* waitForPending(1)
      yield* reply({ requestID: PermissionID.make("per_crud_1"), reply: "always" })
      yield* Fiber.await(fiber1)

      const fiber2 = yield* ask({
        id: PermissionID.make("per_crud_2"),
        sessionID: SessionID.make("session_test"),
        permission: "edit",
        patterns: ["unique-crud-cmd-2"],
        metadata: {},
        always: ["unique-crud-cmd-2"],
        ruleset: [],
      }).pipe(Effect.forkScoped)
      yield* waitForPending(1)
      yield* reply({ requestID: PermissionID.make("per_crud_2"), reply: "always" })
      yield* Fiber.await(fiber2)

      const before = yield* listApproved()
      expect(before).toHaveLength(2)

      // Remove single rule
      const removed = yield* removeApproved({ permission: "bash", pattern: "unique-crud-cmd-1" })
      expect(removed).toBe(true)

      const afterRemove = yield* listApproved()
      expect(afterRemove).toHaveLength(1)
      expect(afterRemove[0]).toEqual({ permission: "edit", pattern: "unique-crud-cmd-2", action: "allow" })

      // Reload instance to verify persistence in SQLite
      yield* Effect.promise(() => reloadTestInstance({ directory: dir }))
      const afterReload = yield* listApproved()
      expect(afterReload).toHaveLength(1)
      expect(afterReload[0]).toEqual({ permission: "edit", pattern: "unique-crud-cmd-2", action: "allow" })

      // Clear all approved rules
      const cleared = yield* clearApproved()
      expect(cleared).toBe(true)
      expect(yield* listApproved()).toHaveLength(0)

      // Reload instance again and verify still empty
      yield* Effect.promise(() => reloadTestInstance({ directory: dir }))
      expect(yield* listApproved()).toHaveLength(0)
    }),
  ),
)
