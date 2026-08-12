import { SessionMessageTable, SessionTable } from "@/session/session.sql"
import { SessionID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { WorkspaceID } from "@/control-plane/schema"
import { and, asc, desc, eq, gt, gte, isNull, like, lt, or, type SQL } from "@/storage/db"
import * as Database from "@/storage/db"
import { Cause, Context, DateTime, Effect, Exit, Layer, Option, Schema, Stream } from "effect"
import { SessionMessage } from "./session-message"
import type { Prompt } from "./session-prompt"
import { EventV2 } from "./event"
import { ProjectID } from "@/project/schema"
import { SessionEvent } from "./session-event"
import { V2Schema } from "./schema"
import { optionalOmitUndefined } from "@opencode-ai/core/schema"
import { Modelv2 } from "./model"
import { SyncEvent } from "@/sync"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionCompaction } from "@/session/compaction"
import { SessionStatus } from "@/session/status"
import { MessageV2 } from "@/session/message-v2"
import { Bus } from "@/bus"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { subagentSessionPermission, subagentToolRestrictions, MAX_SUBAGENT_NESTING_LEVELS } from "@/agent/subagent-permissions"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "v2.session" })

export const Delivery = Schema.Literals(["immediate", "deferred"]).annotate({
  identifier: "Session.Delivery",
})
export type Delivery = Schema.Schema.Type<typeof Delivery>

export const DefaultDelivery = "immediate" satisfies Delivery

export class Info extends Schema.Class<Info>("Session.Info")({
  id: SessionID,
  parentID: optionalOmitUndefined(SessionID),
  projectID: ProjectID,
  workspaceID: optionalOmitUndefined(WorkspaceID),
  path: optionalOmitUndefined(Schema.String),
  agent: optionalOmitUndefined(Schema.String),
  model: Modelv2.Ref.pipe(optionalOmitUndefined),
  time: Schema.Struct({
    created: V2Schema.DateTimeUtcFromMillis,
    updated: V2Schema.DateTimeUtcFromMillis,
    archived: optionalOmitUndefined(V2Schema.DateTimeUtcFromMillis),
  }),
  title: Schema.String,
  permission: optionalOmitUndefined(Permission.Ruleset),
  /*
  slug: Schema.String,
  directory: Schema.String,
  path: optionalOmitUndefined(Schema.String),
  parentID: optionalOmitUndefined(SessionID),
  summary: optionalOmitUndefined(Summary),
  share: optionalOmitUndefined(Share),
  title: Schema.String,
  version: Schema.String,
  time: Time,
  revert: optionalOmitUndefined(Revert),
  */
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Session.NotFoundError", {
  sessionID: SessionID,
}) {}

export interface Interface {
  readonly create: (input?: {
    agent?: string
    model?: Modelv2.Ref
    parentID?: SessionID
    workspaceID?: WorkspaceID
    title?: string
    permission?: Permission.Ruleset
  }) => Effect.Effect<Info>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info, NotFoundError>
  readonly list: (input: {
    limit?: number
    order?: "asc" | "desc"
    directory?: string
    path?: string
    workspaceID?: WorkspaceID
    roots?: boolean
    start?: number
    search?: string
    cursor?: {
      id: SessionID
      time: number
      direction: "previous" | "next"
    }
  }) => Effect.Effect<Info[], never>
  readonly messages: (input: {
    sessionID: SessionID
    limit?: number
    order?: "asc" | "desc"
    cursor?: {
      id: SessionMessage.ID
      time: number
      direction: "previous" | "next"
    }
  }) => Effect.Effect<SessionMessage.Message[], never>
  readonly context: (sessionID: SessionID) => Effect.Effect<SessionMessage.Message[], never>
  readonly prompt: (input: {
    id?: EventV2.ID
    sessionID: SessionID
    prompt: Prompt
    delivery?: Delivery
    model?: Modelv2.Ref
    agent?: string
    tools?: Record<string, boolean>
  }) => Effect.Effect<SessionMessage.User, never>
  readonly shell: (input: { id?: EventV2.ID; sessionID: SessionID; command: string }) => Effect.Effect<void, never>
  readonly skill: (input: { id?: EventV2.ID; sessionID: SessionID; skill: string }) => Effect.Effect<void, never>
  readonly subagent: (input: {
    id?: EventV2.ID
    parentID: SessionID
    prompt: Prompt
    agent: string
    description?: string
    model?: Modelv2.Ref
    abort?: AbortSignal
  }) => Effect.Effect<void, Error>
  readonly switchAgent: (input: { sessionID: SessionID; agent: string }) => Effect.Effect<void, never>
  readonly switchModel: (input: { sessionID: SessionID; model: Modelv2.Ref }) => Effect.Effect<void, never>
  readonly compact: (sessionID: SessionID) => Effect.Effect<void, never>
  readonly wait: (sessionID: SessionID) => Effect.Effect<void, never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Session") {}

/**
 * Map a V1 `Session.Info` to a V2 `Info`.
 * V1 stores timestamps as epoch millis; V2 uses `DateTime`. V1 model shape
 * `{ id, providerID, variant? }` maps directly to `Modelv2.Ref`.
 */
function toV2Info(info: Session.Info): Info {
  return new Info({
    id: info.id,
    parentID: info.parentID,
    projectID: info.projectID,
    workspaceID: info.workspaceID,
    path: info.path,
    agent: info.agent,
    model: info.model
      ? {
          id: Modelv2.ID.make(info.model.id as string),
          providerID: Modelv2.ProviderID.make(info.model.providerID as string),
          variant: Modelv2.VariantID.make((info.model.variant ?? "default") as string),
        }
      : undefined,
    time: {
      created: DateTime.makeUnsafe(info.time.created),
      updated: DateTime.makeUnsafe(info.time.updated),
      archived: info.time.archived ? DateTime.makeUnsafe(info.time.archived) : undefined,
    },
    title: info.title,
    permission: info.permission,
  })
}

/**
 * Translate a V2 `Prompt` into V1 `PromptInput["parts"]`. The V1 prompt loop
 * owns the event emission (`SessionEvent.Prompted.Sync` at `prompt.ts:1440`),
 * so this is a pure data transform.
 */
function promptToParts(prompt: Prompt): SessionPrompt.PromptInput["parts"] {
  return [
    { type: "text", text: prompt.text },
    ...(prompt.files ?? []).map(
      (file) => ({ type: "file", url: file.uri, mime: file.mime, filename: file.name }) as const,
    ),
    ...(prompt.agents ?? []).map((agent) => ({ type: "agent", name: agent.name }) as const),
  ]
}

/**
 * Bridge a V2 `Modelv2.Ref` to V1 model shapes at the delegation boundary.
 * V1 `ModelID` and V2 `Modelv2.ID` are both branded strings over the same
 * underlying `Schema.String`, but with different brand symbols (`ProviderID`
 * vs `Model.ID`), so a cast is structurally required here. Centralized so the
 * brand mismatch has exactly one explanation.
 *
 * V1 has TWO model-ref shapes: `Session.create` uses `{ id, providerID, variant? }`,
 * while `PromptInput.model` / `SessionCompaction.create` use `{ modelID, providerID }`.
 * @see v2/AGENTS.md "V1/V2 model-ID brand mismatch"
 */
function v2ModelToV1Session(model: Modelv2.Ref): { id: ModelID; providerID: ProviderID; variant?: string } {
  return {
    id: model.id as unknown as ModelID,
    providerID: model.providerID as unknown as ProviderID,
    variant: model.variant,
  }
}

function v2ModelToV1Prompt(model: Modelv2.Ref): { modelID: ModelID; providerID: ProviderID } {
  return {
    modelID: model.id as unknown as ModelID,
    providerID: model.providerID as unknown as ProviderID,
  }
}


export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sync = yield* SyncEvent.Service
    const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)
    // V1 services used by the delegation bridge. Captured lazily via serviceOption
    // so read-only consumers (get/list/messages/context) still work without them.
    const sessionsV1 = yield* Effect.serviceOption(Session.Service)
    const promptV1 = yield* Effect.serviceOption(SessionPrompt.Service)
    const compactionV1 = yield* Effect.serviceOption(SessionCompaction.Service)
    const statusV1 = yield* Effect.serviceOption(SessionStatus.Service)
    const bus = yield* Effect.serviceOption(Bus.Service)
    const agentsV1 = yield* Effect.serviceOption(Agent.Service)
    const configV1 = yield* Effect.serviceOption(Config.Service)

    const requireV1 = <A>(svc: Option.Option<A>, name: string) =>
      Option.isNone(svc) ? Effect.die(`V2Session.${name} requires the V1 ${name} service to be provided`) : Effect.succeed(svc.value)

    const decode = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type })

    function fromRow(row: typeof SessionTable.$inferSelect): Info {
      return new Info({
        id: SessionID.make(row.id),
        projectID: ProjectID.make(row.project_id),
        workspaceID: row.workspace_id ? WorkspaceID.make(row.workspace_id) : undefined,
        title: row.title,
        parentID: row.parent_id ? SessionID.make(row.parent_id) : undefined,
        path: row.path ?? "",
        agent: row.agent ?? undefined,
        model: row.model
          ? {
              id: Modelv2.ID.make(row.model.id),
              providerID: Modelv2.ProviderID.make(row.model.providerID),
              variant: Modelv2.VariantID.make(row.model.variant ?? "default"),
            }
          : undefined,
        permission: row.permission ?? undefined,
        time: {
          created: DateTime.makeUnsafe(row.time_created),
          updated: DateTime.makeUnsafe(row.time_updated),
          archived: row.time_archived ? DateTime.makeUnsafe(row.time_archived) : undefined,
        },
      })
    }

    // Deferred delivery queue: sessionIDs with staged-but-not-run user messages.
    // `prompt` with delivery="deferred" stages the message and adds the session;
    // `runDeferred` drains the queue by running the V1 loop for each session.
    const deferredQueue = new Set<SessionID>()

    const result: Interface = {
      create: Effect.fn("V2Session.create")(function* (input) {
        // Delegates to V1 Session.create, which owns projectID/directory/slug/version
        // resolution and inserts the row that `fromRow`/`toV2Info` project back to V2.
        const sessions = yield* requireV1(sessionsV1, "Session")
        const info = yield* sessions.create({
          parentID: input?.parentID,
          agent: input?.agent,
          model: input?.model ? v2ModelToV1Session(input.model) : undefined,
          workspaceID: input?.workspaceID,
          title: input?.title,
          permission: input?.permission,
        })
        return toV2Info(info)
      }),
      get: Effect.fn("V2Session.get")(function* (sessionID) {
        const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
        if (!row) return yield* new NotFoundError({ sessionID })
        return fromRow(row)
      }),
      list: Effect.fn("V2Session.list")(function* (input) {
        const direction = input.cursor?.direction ?? "next"
        let order = input.order ?? "desc"
        // Query the adjacent rows in reverse, then flip them back into the requested order below.
        if (direction === "previous" && order === "asc") order = "desc"
        if (direction === "previous" && order === "desc") order = "asc"
        const conditions: SQL[] = []
        if (input.directory) conditions.push(eq(SessionTable.directory, input.directory))
        if (input.path)
          conditions.push(or(eq(SessionTable.path, input.path), like(SessionTable.path, `${input.path}/%`))!)
        if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
        if (input.roots) conditions.push(isNull(SessionTable.parent_id))
        if (input.start) conditions.push(gte(SessionTable.time_created, input.start))
        if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
        if (input.cursor) {
          conditions.push(
            order === "asc"
              ? or(
                  gt(SessionTable.time_created, input.cursor.time),
                  and(eq(SessionTable.time_created, input.cursor.time), gt(SessionTable.id, input.cursor.id)),
                )!
              : or(
                  lt(SessionTable.time_created, input.cursor.time),
                  and(eq(SessionTable.time_created, input.cursor.time), lt(SessionTable.id, input.cursor.id)),
                )!,
          )
        }
        const query = Database.Client()
          .select()
          .from(SessionTable)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(
            order === "asc" ? asc(SessionTable.time_created) : desc(SessionTable.time_created),
            order === "asc" ? asc(SessionTable.id) : desc(SessionTable.id),
          )

        const rows = input.limit === undefined ? query.all() : query.limit(input.limit).all()
        return (direction === "previous" ? rows.toReversed() : rows).map((row) => fromRow(row))
      }),
      messages: Effect.fn("V2Session.messages")(function* (input) {
        const direction = input.cursor?.direction ?? "next"
        let order = input.order ?? "desc"
        // Query the adjacent rows in reverse, then flip them back into the requested order below.
        if (direction === "previous" && order === "asc") order = "desc"
        if (direction === "previous" && order === "desc") order = "asc"
        const boundary = input.cursor
          ? order === "asc"
            ? or(
                gt(SessionMessageTable.time_created, input.cursor.time),
                and(
                  eq(SessionMessageTable.time_created, input.cursor.time),
                  gt(SessionMessageTable.id, input.cursor.id),
                ),
              )
            : or(
                lt(SessionMessageTable.time_created, input.cursor.time),
                and(
                  eq(SessionMessageTable.time_created, input.cursor.time),
                  lt(SessionMessageTable.id, input.cursor.id),
                ),
              )
          : undefined
        const where = boundary
          ? and(eq(SessionMessageTable.session_id, input.sessionID), boundary)
          : eq(SessionMessageTable.session_id, input.sessionID)

        const rows = Database.use((db) => {
          const query = db
            .select()
            .from(SessionMessageTable)
            .where(where)
            .orderBy(
              order === "asc" ? asc(SessionMessageTable.time_created) : desc(SessionMessageTable.time_created),
              order === "asc" ? asc(SessionMessageTable.id) : desc(SessionMessageTable.id),
            )
          const rows = input.limit === undefined ? query.all() : query.limit(input.limit).all()
          return direction === "previous" ? rows.toReversed() : rows
        })
        return rows.map((row) => decode(row))
      }),
      context: Effect.fn("V2Session.context")(function* (sessionID) {
        const rows = Database.use((db) => {
          const compaction = db
            .select()
            .from(SessionMessageTable)
            .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
            .orderBy(desc(SessionMessageTable.time_created), desc(SessionMessageTable.id))
            .limit(1)
            .get()

          return db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.session_id, sessionID),
                compaction
                  ? or(
                      gt(SessionMessageTable.time_created, compaction.time_created),
                      and(
                        eq(SessionMessageTable.time_created, compaction.time_created),
                        gte(SessionMessageTable.id, compaction.id),
                      ),
                    )
                  : undefined,
              ),
            )
            .orderBy(asc(SessionMessageTable.time_created), asc(SessionMessageTable.id))
            .all()
        })
        return rows.map((row) => decode(row))
      }),
      prompt: Effect.fn("V2Session.prompt")(function* (input) {
        // Delegates to V1 SessionPrompt.prompt, which owns the agent loop and
        // dual-writes SessionEvent.* behind OPENCODE_EXPERIMENTAL_EVENT_SYSTEM.
        // The Prompted projector then populates SessionMessageTable, which the
        // read methods (`messages`/`context`) query. V1 is the writer by design.
        const promptSvc = yield* requireV1(promptV1, "SessionPrompt")
        const delivery = input.delivery ?? DefaultDelivery
        const parts = promptToParts(input.prompt)

        // `noReply: true` tells V1 to create the user message but NOT run the
        // loop. Used for deferred delivery — the message is staged and the loop
        // runs later via runDeferred().
        yield* promptSvc.prompt({
          sessionID: input.sessionID,
          parts,
          noReply: delivery === "deferred",
          model: input.model ? v2ModelToV1Prompt(input.model) : undefined,
          agent: input.agent,
          tools: input.tools,
        })

        if (delivery === "deferred") {
          deferredQueue.add(input.sessionID)
        }

        // Read back the projected user message (the Prompted event wrote it).
        const messages = yield* result.messages({ sessionID: input.sessionID, order: "asc" })
        const user = messages.findLast((m): m is SessionMessage.User => m.type === "user")
        return user ?? ({} as SessionMessage.User)
      }),
      shell: Effect.fn("V2Session.shell")(function* (input) {
        // V1 SessionPrompt.shell already emits Shell.Started/Ended at
        // prompt.ts:884/907.
        const promptSvc = yield* requireV1(promptV1, "SessionPrompt")
        const session = yield* result.get(input.sessionID).pipe(Effect.orDie)
        yield* promptSvc.shell({
          sessionID: input.sessionID,
          agent: session.agent ?? "build",
          command: input.command,
        })
      }),
      skill: Effect.fn("V2Session.skill")(function* (input) {
        // Invokes a skill by prompting with the skill name as text. The skill
        // loader in the agent loop resolves `/skill-name` into the skill content.
        // Delegates to V1 prompt — no dedicated Skill.Invoked event is needed
        // because the prompt flow already emits Prompted.Sync + the tool events.
        const promptSvc = yield* requireV1(promptV1, "SessionPrompt")
        const session = yield* result.get(input.sessionID).pipe(Effect.orDie)
        yield* promptSvc.prompt({
          sessionID: input.sessionID,
          agent: session.agent ?? "build",
          parts: [{ type: "text", text: `/${input.skill}` }],
        })
      }),
      switchAgent: Effect.fn("V2Session.switchAgent")(function* (input) {
        yield* sync.run(SessionEvent.AgentSwitched.Sync, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(Date.now()),
          agent: input.agent,
        })
      }),
      switchModel: Effect.fn("V2Session.switchModel")(function* (input) {
        yield* sync.run(SessionEvent.ModelSwitched.Sync, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(Date.now()),
          model: input.model,
        })
      }),
      subagent: Effect.fn("V2Session.subagent")(function* (input) {
        const agents = yield* requireV1(agentsV1, "Agent")
        const cfg = yield* requireV1(configV1, "Config")
        const cfgInfo = yield* cfg.get()
        const parent = yield* result.get(input.parentID)

        const subagent = yield* agents.get(input.agent)
        if (!subagent) {
          // Die (not fail) because an invalid agent name is a programming error
          // — the LLM is given the available agents in the task tool description.
          // V1 TaskTool also treats this as a defect via Effect.fail + orDie.
          // NotFoundError in the return type is for the parent session lookup.
          return yield* Effect.die(new Error(`Unknown agent type: ${input.agent} is not a valid agent type`))
        }
        const parentAgent = parent.agent
          ? yield* agents.get(parent.agent).pipe(
              Effect.map((a) =>
                a ??
                ({
                  permission: [
                    { permission: "edit", pattern: "*", action: "deny" },
                    { permission: "write", pattern: "*", action: "deny" },
                    { permission: "bash", pattern: "*", action: "deny" },
                  ],
                } as Agent.Info),
              ),
              Effect.catchCause((cause) =>
                Effect.sync(() => {
                  log.warn("parent agent not found, applying fallback deny rules", {
                    parentAgent: parent.agent,
                    cause: Cause.squash(cause),
                  })
                  return {
                    permission: [
                      { permission: "edit", pattern: "*", action: "deny" },
                      { permission: "write", pattern: "*", action: "deny" },
                      { permission: "bash", pattern: "*", action: "deny" },
                    ],
                  } as Agent.Info
                }),
              ),
            )
          : undefined

        const permission = subagentSessionPermission({
          parentSessionPermission: parent.permission ?? [],
          parentAgent,
          subagent,
          primaryTools: cfgInfo.experimental?.primary_tools,
        })

        for (let depth = 0, currentParentID: SessionID | undefined = input.parentID; currentParentID; ) {
          depth++
          if (depth >= MAX_SUBAGENT_NESTING_LEVELS) {
            return yield* Effect.fail(
              new Error(`Maximum subagent nesting levels (${MAX_SUBAGENT_NESTING_LEVELS}) exceeded`),
            )
          }
          const ancestor: Info = yield* result.get(currentParentID)
          currentParentID = ancestor.parentID
        }

        const session = yield* result.create({
          agent: input.agent,
          model: input.model,
          parentID: input.parentID,
          workspaceID: parent.workspaceID,
          title: `${input.description ?? "Subagent"} @${input.agent}`,
          permission,
        })

        const tools = subagentToolRestrictions({
          subagent,
          primaryTools: cfgInfo.experimental?.primary_tools,
        })

        // Abort handling: cancel the child session if the parent's abort
        // signal fires. The prompt call blocks until the child loop finishes,
        // so we don't need a separate wait() — the result is available
        // immediately after prompt returns.
        const promptSvc = yield* requireV1(promptV1, "SessionPrompt")
        const cancelChild = promptSvc.cancel(session.id)
        let cancelled = false
        const onAbort = () => {
          if (cancelled) return
          cancelled = true
          Effect.runPromise(cancelChild).catch((error) => log.warn("subagent cancel failed", { error: String(error) }))
        }
        if (input.abort) input.abort.addEventListener("abort", onAbort)

        yield* Effect.acquireUseRelease(
          Effect.sync(() => {}),
          () =>
            Effect.gen(function* () {
              yield* result.prompt({
                prompt: input.prompt,
                sessionID: session.id,
                model: input.model,
                agent: input.agent,
                tools,
              })
              // After the subagent's loop finishes, post its final text back to
              // the parent as a synthetic message so callers observing the parent
              // can see the result. The `subagent()` interface returns void by
              // design — callers read the synthetic message from the parent's
              // `messages()`. @see v2/AGENTS.md "V2 subagent() posts results synthetically".
              const messages = yield* result.messages({ sessionID: session.id, order: "desc" })
              // V2 messages() returns DB rows ordered by id DESC; find() gives
              // the chronologically latest assistant. No compaction reordering
              // in V2, so array position matches id order (MessageID is monotonic).
              const assistant = messages.find((msg) => msg.type === "assistant")
              if (!assistant || assistant.type !== "assistant") {
                yield* sync.run(SessionEvent.Synthetic.Sync, {
                  sessionID: input.parentID,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                  text: "Subagent completed without producing a text response.",
                })
                return
              }
              if (assistant.content.length === 0) {
                yield* sync.run(SessionEvent.Synthetic.Sync, {
                  sessionID: input.parentID,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                  text: "Subagent produced no output parts.",
                })
                return
              }
              const textPart = assistant.content.findLast((part) => part.type === "text")
              const text = textPart?.text || "Subagent completed without producing a text response."
              yield* sync.run(SessionEvent.Synthetic.Sync, {
                sessionID: input.parentID,
                timestamp: DateTime.makeUnsafe(Date.now()),
                text,
              })
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.gen(function* () {
                  log.error("subagent failed", {
                    cause: cause,
                    parentID: input.parentID,
                    agent: input.agent,
                  })
                  yield* sync.run(SessionEvent.Synthetic.Sync, {
                    sessionID: input.parentID,
                    timestamp: DateTime.makeUnsafe(Date.now()),
                    text: `Subagent error: ${Cause.squash(cause)}`,
                  })
                }),
              ),
            ),
          (_, exit) =>
            Effect.gen(function* () {
              if (input.abort) input.abort.removeEventListener("abort", onAbort)
              if (Exit.hasInterrupts(exit) && !cancelled) {
                cancelled = true
                yield* cancelChild.pipe(
                  Effect.catch((error) =>
                    Effect.sync(() => log.warn("subagent cancel failed", { error: String(error) })),
                  ),
                )
              }
            }),
        )
      }),
      compact: Effect.fn("V2Session.compact")(function* (sessionID) {
        // Delegates to V1 SessionCompaction.create, which appends a CompactionPart
        // and emits SessionEvent.Compaction.Started.Sync. The actual summarization
        // runs on the next loop iteration (manual trigger: the caller should call
        // prompt() or the loop must be running). V1 owns the compaction lifecycle.
        const compactionSvc = yield* requireV1(compactionV1, "SessionCompaction")
        const session = yield* result.get(sessionID).pipe(Effect.orDie)
        const model = session.model ?? {
          id: Modelv2.ID.make("default"),
          providerID: Modelv2.ProviderID.make("opencode"),
          variant: Modelv2.VariantID.make("default"),
        }
        yield* compactionSvc.create({
          sessionID,
          agent: session.agent ?? "build",
          model: v2ModelToV1Prompt(model),
          auto: false,
        })
      }),
      wait: Effect.fn("V2Session.wait")(function* (sessionID) {
        // Block until the session's agent loop goes idle. V1 has no explicit
        // "wait" primitive — it uses Runner.ensureRunning to join in-flight runs.
        // Here we subscribe to the SessionStatus bus: if currently busy, wait for
        // the next idle event for this session.
        const status = Option.isSome(statusV1) ? statusV1.value : null
        const busSvc = Option.isSome(bus) ? bus.value : null
        if (!status || !busSvc) return // no status service available — nothing to wait on
        const current = yield* status.get(sessionID)
        if (current.type === "idle") return
        yield* busSvc
          .subscribe(SessionStatus.Event.Idle)
          .pipe(
            Stream.filter((e) => e.properties.sessionID === sessionID),
            Stream.take(1),
            Stream.runDrain,
          )
      }),
    }

    /**
     * Drain deferred-delivery prompts for a session by running the V1 loop.
     * Exposed via an extended service so tests/callers can trigger deferred
     * processing. A real background worker can be wired later. Delegates to V1
     * `SessionPrompt.loop` by design — V1 owns the loop execution.
     */
    const runDeferred = (sessionID: SessionID): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (!deferredQueue.delete(sessionID)) return
        const promptSvc = yield* requireV1(promptV1, "SessionPrompt")
        yield* promptSvc.loop({ sessionID })
      })

    return Service.of(Object.assign(result, { runDeferred }))
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SyncEvent.defaultLayer))

export * as SessionV2 from "./session"
