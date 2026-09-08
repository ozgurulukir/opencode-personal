import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { ConfigPermission } from "@/config/permission"
import { InstanceState } from "@/effect/instance-state"
import { ProjectID } from "@/project/schema"
import { MessageID, SessionID } from "@/session/schema"
import { PermissionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import { zod } from "@opencode-ai/core/effect-zod"
import * as Log from "@opencode-ai/core/util/log"
import { withStatics } from "@opencode-ai/core/schema"
import { Wildcard } from "@/util/wildcard"
import { Deferred, Duration, Effect, Layer, Schema, Context, DateTime } from "effect"
import { SyncEvent } from "@/sync"
import { SessionEvent } from "@/v2/session-event"
import os from "os"
import { evaluate as evalRule, evaluateWithSource as evalWithSource } from "./evaluate"
import { PermissionID } from "./schema"

const log = Log.create({ service: "permission" })

// Safety-net timeout for a never-surfaced / never-replied permission prompt. A
// generous default since a real user may legitimately take a while to answer.
export const PERMISSION_ASK_TIMEOUT_MS = 5 * 60_000

export const Action = Schema.Literals(["allow", "deny", "ask"])
  .annotate({ identifier: "PermissionAction" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Action = Schema.Schema.Type<typeof Action>

export const Rule = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: Action,
})
  .annotate({ identifier: "PermissionRule" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Rule = Schema.Schema.Type<typeof Rule>

export const Ruleset = Schema.mutable(Schema.Array(Rule))
  .annotate({ identifier: "PermissionRuleset" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Ruleset = Schema.Schema.Type<typeof Ruleset>

export class Request extends Schema.Class<Request>("PermissionRequest")({
  id: PermissionID,
  sessionID: SessionID,
  permission: Schema.String,
  patterns: Schema.Array(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  always: Schema.Array(Schema.String),
  tool: Schema.optional(
    Schema.Struct({
      messageID: MessageID,
      callID: Schema.String,
    }),
  ),
}) {
  static readonly zod = zod(this)
}

export const Reply = Schema.Literals(["once", "always", "reject"]).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Reply = Schema.Schema.Type<typeof Reply>

const reply = {
  reply: Reply,
  message: Schema.optional(Schema.String),
}

export const ReplyBody = Schema.Struct(reply)
  .annotate({ identifier: "PermissionReplyBody" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ReplyBody = Schema.Schema.Type<typeof ReplyBody>

export class Approval extends Schema.Class<Approval>("PermissionApproval")({
  projectID: ProjectID,
  patterns: Schema.Array(Schema.String),
}) {
  static readonly zod = zod(this)
}

export const Event = {
  Asked: BusEvent.define("permission.asked", Request),
  Replied: BusEvent.define(
    "permission.replied",
    Schema.Struct({
      sessionID: SessionID,
      requestID: PermissionID,
      reply: Reply,
    }),
  ),
}

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
  override get message() {
    return "The user rejected permission to use this specific tool call."
  }
}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionCorrectedError", {
  feedback: Schema.String,
}) {
  override get message() {
    return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`
  }
}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
  ruleset: Schema.Any,
  source: Schema.optional(Schema.String),
}) {
  override get message() {
    const source = this.source ? ` (from ${this.source})` : ""
    return `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(this.ruleset)}${source}`
  }
}

export class TimedOutError extends Schema.TaggedErrorClass<TimedOutError>()("PermissionTimedOutError", {
  timeoutMs: Schema.Number,
}) {
  override get message() {
    return `Permission prompt timed out after ${this.timeoutMs}ms and was rejected.`
  }
}

export type Error = DeniedError | RejectedError | CorrectedError | TimedOutError

export const AskInput = Schema.Struct({
  ...Request.fields,
  id: Schema.optional(PermissionID),
  ruleset: Ruleset,
  timeoutMs: Schema.optional(Schema.Number),
})
  .annotate({ identifier: "PermissionAskInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type AskInput = Schema.Schema.Type<typeof AskInput>

export const ReplyInput = Schema.Struct({
  requestID: PermissionID,
  ...reply,
})
  .annotate({ identifier: "PermissionReplyInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ReplyInput = Schema.Schema.Type<typeof ReplyInput>

export const RemoveApprovedInput = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.optional(Schema.String),
})
  .annotate({ identifier: "PermissionRemoveApprovedInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type RemoveApprovedInput = Schema.Schema.Type<typeof RemoveApprovedInput>

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<void, Error>
  readonly reply: (input: ReplyInput) => Effect.Effect<void>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
  readonly listApproved: () => Effect.Effect<ReadonlyArray<Rule>>
  readonly removeApproved: (input: RemoveApprovedInput) => Effect.Effect<boolean>
  readonly clearApproved: () => Effect.Effect<boolean>
}

interface PendingEntry {
  info: Request
  deferred: Deferred.Deferred<void, RejectedError | CorrectedError | TimedOutError>
}

interface State {
  pending: Map<PermissionID, PendingEntry>
  approved: Ruleset
}

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  return evalRule(permission, pattern, ...rulesets)
}

export function evaluateWithSource(
  permission: string,
  pattern: string,
  ...rulesets: { source: string; rules: Ruleset }[]
): Rule & { source?: string } {
  return evalWithSource(permission, pattern, ...rulesets)
}

/**
 * Deduplicate a permission ruleset by `permission:pattern` key, preserving
 * last-occurrence order (last match wins in Permission.evaluate).
 * Time complexity: O(N), Space complexity: O(N).
 */
export function dedupe(rules: Ruleset): Ruleset {
  const seen = new Set<string>()
  const result: Rule[] = []
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]
    const key = `${rule.permission}:${rule.pattern}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(rule)
  }
  return result.reverse()
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const sync = yield* SyncEvent.Service
    // Native V2 lifecycle emission is published alongside the V1 event
    const publishReplied = (sessionID: SessionID, requestID: PermissionID, reply: Reply) =>
      sync.run(SessionEvent.Permission.Replied.Sync, {
        sessionID,
        timestamp: DateTime.makeUnsafe(Date.now()),
        // The V2 def declares a plain string; PermissionID is a Newtype over
        // string (make() casts string→Self, so the reverse needs the double cast)
        requestID: requestID as unknown as string,
        reply,
      })
    const state = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        const row = Database.use((db) =>
          db.select().from(PermissionTable).where(eq(PermissionTable.project_id, ctx.project.id)).get(),
        )
        const state = {
          pending: new Map<PermissionID, PendingEntry>(),
          approved: dedupe(row?.data ?? []),
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new RejectedError())
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const ask = Effect.fn("Permission.ask")(function* (input: AskInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const { ruleset, timeoutMs, ...request } = input

      // Guard against empty patterns: normalize to ["*"] to enforce fail-closed deny checks
      const patterns = request.patterns.length > 0 ? request.patterns : ["*"]
      const always = request.always.length > 0 ? request.always : patterns
      let needsAsk = false

      for (const pattern of patterns) {
        // Deny rules from config/agent always win (security).
        // DB-persisted "always allow" overrides config "ask" rules — otherwise
        // the user's explicit approval is silently ignored on every subsequent call.
        const configRule = evalRule(request.permission, pattern, ruleset)
        if (configRule.action === "deny") {
          log.info("evaluated", { permission: request.permission, pattern, action: configRule })
          return yield* new DeniedError({
            ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
          })
        }
        const approvedRule = evalRule(request.permission, pattern, approved)
        log.info("evaluated", { permission: request.permission, pattern, config: configRule.action, approved: approvedRule.action })
        if (approvedRule.action === "allow") continue
        if (configRule.action === "allow") continue
        needsAsk = true
      }

      if (!needsAsk) return

      const id = request.id ?? PermissionID.ascending()
      const info = Schema.decodeUnknownSync(Request)({
        id,
        ...request,
        patterns,
        always,
      })
      log.info("asking", { id, permission: info.permission, patterns: info.patterns })

      const timeout = timeoutMs ?? PERMISSION_ASK_TIMEOUT_MS
      const deferred = yield* Deferred.make<void, RejectedError | CorrectedError | TimedOutError>()
      pending.set(id, { info, deferred })
      yield* bus.publish(Event.Asked, info)
      yield* sync.run(SessionEvent.Permission.Asked.Sync, {
        sessionID: info.sessionID,
        timestamp: DateTime.makeUnsafe(Date.now()),
        request: info,
      })
      return yield* Effect.ensuring(
        // raceFirst returns whichever branch completes FIRST (success or failure), so the
        // failing timeout branch wins over a still-pending Deferred.await. Effect.race would
        // only return the first branch to SUCCEED, ignoring the timeout failure and hanging.
        Effect.raceFirst(
          Deferred.await(deferred),
          Effect.gen(function* () {
            yield* Effect.sleep(Duration.millis(timeout))
            // Broadcast a synthetic "reject" so the TUI/run/web stores remove the stale prompt.
            yield* bus.publish(Event.Replied, { sessionID: info.sessionID, requestID: id, reply: "reject" })
            yield* publishReplied(info.sessionID, id, "reject")
            return yield* Effect.fail(new TimedOutError({ timeoutMs: timeout }))
          }),
        ),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const reply = Effect.fn("Permission.reply")(function* (input: ReplyInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const existing = pending.get(input.requestID)
      if (!existing) return

      pending.delete(input.requestID)
      yield* bus.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })
      yield* publishReplied(existing.info.sessionID, existing.info.id, input.reply)

      if (input.reply === "reject") {
        yield* Deferred.fail(
          existing.deferred,
          input.message ? new CorrectedError({ feedback: input.message }) : new RejectedError(),
        )

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          pending.delete(id)
          yield* bus.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "reject",
          })
          yield* publishReplied(item.info.sessionID, item.info.id, "reject")
          yield* Deferred.fail(item.deferred, new RejectedError())
        }
        return
      }

      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply === "once") return

      // Persist approved ruleset to database so "always allow" survives restarts.
      // Commit to SQLite first before mutating in-memory array to prevent state divergence on write failure.
      const ctx = yield* InstanceState.context
      const newRules: Array<{ permission: string; pattern: string; action: "allow" }> = existing.info.always.map((pattern) => ({
        permission: existing.info.permission,
        pattern,
        action: "allow",
      }))
      const nextApproved = dedupe([...approved, ...newRules])
      Database.transaction((db) => {
        db.insert(PermissionTable)
          .values({ project_id: ctx.project.id, data: nextApproved })
          .onConflictDoUpdate({ target: PermissionTable.project_id, set: { data: nextApproved } })
          .run()
      })

      approved.splice(0, approved.length, ...nextApproved)

      for (const [id, item] of pending.entries()) {
        if (item.info.sessionID !== existing.info.sessionID) continue
        const ok = item.info.patterns.every(
          (pattern) => evaluate(item.info.permission, pattern, approved).action === "allow",
        )
        if (!ok) continue
        pending.delete(id)
        yield* bus.publish(Event.Replied, {
          sessionID: item.info.sessionID,
          requestID: item.info.id,
          reply: "always",
        })
        yield* publishReplied(item.info.sessionID, item.info.id, "always")
        yield* Deferred.succeed(item.deferred, undefined)
      }
    })

    const list = Effect.fn("Permission.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (item) => item.info)
    })

    const listApproved = Effect.fn("Permission.listApproved")(function* () {
      const { approved } = yield* InstanceState.get(state)
      return [...approved]
    })

    const removeApproved = Effect.fn("Permission.removeApproved")(function* (input: RemoveApprovedInput) {
      const { approved } = yield* InstanceState.get(state)
      const nextApproved = approved.filter((rule) => {
        if (rule.permission !== input.permission) return true
        if (input.pattern !== undefined && rule.pattern !== input.pattern) return true
        return false
      })
      if (nextApproved.length === approved.length) return false

      const ctx = yield* InstanceState.context
      Database.transaction((db) => {
        if (nextApproved.length === 0) {
          db.delete(PermissionTable)
            .where(eq(PermissionTable.project_id, ctx.project.id))
            .run()
        } else {
          db.insert(PermissionTable)
            .values({ project_id: ctx.project.id, data: nextApproved })
            .onConflictDoUpdate({ target: PermissionTable.project_id, set: { data: nextApproved } })
            .run()
        }
      })

      approved.splice(0, approved.length, ...nextApproved)
      return true
    })

    const clearApproved = Effect.fn("Permission.clearApproved")(function* () {
      const { approved } = yield* InstanceState.get(state)
      if (approved.length === 0) return true

      const ctx = yield* InstanceState.context
      Database.transaction((db) => {
        db.delete(PermissionTable)
          .where(eq(PermissionTable.project_id, ctx.project.id))
          .run()
      })

      approved.splice(0, approved.length)
      return true
    })

    return Service.of({ ask, reply, list, listApproved, removeApproved, clearApproved })
  }),
)

function expand(pattern: string): string {
  const home = os.homedir()
  const normalized = pattern.replace(/\\/g, "/")
  if (normalized.startsWith("~/")) return home + normalized.slice(1)
  if (normalized === "~") return home
  if (normalized.startsWith("$HOME/")) return home + normalized.slice(5)
  if (normalized === "$HOME") return home
  if (process.platform === "win32" && process.env.USERPROFILE) {
    const userProfile = process.env.USERPROFILE.replace(/\\/g, "/")
    if (normalized.startsWith("%USERPROFILE%/")) return home + normalized.slice(13)
    if (normalized === "%USERPROFILE%") return home
  }
  return pattern
}

export function fromConfig(permission: ConfigPermission.Info) {
  const ruleset: Ruleset = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      ruleset.push({ permission: key, action: value, pattern: "*" })
      continue
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
    )
  }
  return ruleset
}

export function merge(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat()
}

const EDIT_TOOLS = ["edit", "write", "apply_patch"]

export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  const result = new Set<string>()
  for (const tool of tools) {
    const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
    const matchingRules = ruleset.filter((rule) => Wildcard.match(permission, rule.permission))
    if (matchingRules.length === 0) continue
    // A tool is disabled only when there's a catch-all deny (pattern === "*")
    // that isn't overridden by a specific allow/ask rule for this tool.
    // Specific pattern denies (e.g., "rm *": "deny") never disable the tool
    // since non-matching patterns default to "ask" at runtime.
    const hasCatchAllDeny = matchingRules.some(
      (rule) => rule.pattern === "*" && rule.action === "deny",
    )
    const hasSpecificOverride = matchingRules.some(
      (rule) => rule.action !== "deny" && (rule.pattern !== "*" || rule.permission !== "*"),
    )
    if (hasCatchAllDeny && !hasSpecificOverride) result.add(tool)
  }
  return result
}

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(SyncEvent.defaultLayer))

export * as Permission from "."
