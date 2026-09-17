import { SessionMessageTable, SessionTable } from "@/session/session.sql"
import { MessageID, PartID, RevertMessageID, SessionID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { WorkspaceID } from "@/control-plane/schema"
import { and, asc, desc, eq, gt, gte, inArray, isNull, like, lt, or, sql, type SQL } from "@/storage/db"
import * as Database from "@/storage/db"
import { Cause, Context, DateTime, Effect, Exit, Layer, Option, Schema, Scope, Stream } from "effect"
import { LEGACY_MESSAGE_ID, SessionMessage } from "./session-message"
import { legacyMessageID, matchLegacyMessage, stripLegacyMessageID } from "./legacy-message-id.shared"
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
import { Bus } from "@/bus"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import {
  subagentSessionPermission,
  subagentToolRestrictions,
  MAX_SUBAGENT_NESTING_LEVELS,
} from "@/agent/subagent-permissions"
import { NotFoundError as StorageNotFoundError } from "@/storage/storage"
import { SessionRevert } from "@/session/revert"
import { Command } from "@/command"
import * as Log from "@opencode-ai/core/util/log"
import { EffectBridge } from "@/effect/bridge"

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
  slug: Schema.String,
  directory: Schema.String,
  path: optionalOmitUndefined(Schema.String),
  agent: optionalOmitUndefined(Schema.String),
  model: Modelv2.Ref.pipe(optionalOmitUndefined),
  time: Schema.Struct({
    created: V2Schema.DateTimeUtcFromMillis,
    updated: V2Schema.DateTimeUtcFromMillis,
    archived: optionalOmitUndefined(V2Schema.DateTimeUtcFromMillis),
  }),
  title: Schema.String,
  version: Schema.String,
  permission: optionalOmitUndefined(Permission.Ruleset),
  summary: optionalOmitUndefined(
    Schema.Struct({
      additions: Schema.Finite,
      deletions: Schema.Finite,
      files: Schema.Finite,
    }),
  ),
  share: optionalOmitUndefined(Schema.Struct({ url: Schema.String })),
  // Revert state is a SessionTable JSON column; the field schema is reused from
  // V1 `Session.Info` so both projections stay in sync (SSOT).
  revert: Session.Info.fields.revert,
  // `summary.diffs` is intentionally omitted from the row projection — it lives in
  // session_diff storage and is assembled by V1 separately.
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "Session.NotFoundError",
  {
    sessionID: SessionID,
  },
  { httpApiStatus: 404 },
) {}

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
    scope?: "project"
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
    model?: { providerID: ProviderID; modelID: ModelID }
    variant?: string
    agent?: string
    messageID?: MessageID
    tools?: Record<string, boolean>
  }) => Effect.Effect<{ user: SessionMessage.User | undefined; assistant: SessionMessage.Assistant | undefined }, never>
  readonly shell: (input: {
    id?: EventV2.ID
    sessionID: SessionID
    messageID?: MessageID
    agent?: string
    model?: { providerID: ProviderID; modelID: ModelID }
    command: string
  }) => Effect.Effect<void, never>
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
  readonly children: (sessionID: SessionID) => Effect.Effect<Info[], NotFoundError>
  readonly remove: (sessionID: SessionID) => Effect.Effect<void, NotFoundError>
  readonly update: (input: {
    sessionID: SessionID
    title?: string
    permission?: Permission.Ruleset
    archived?: number
  }) => Effect.Effect<Info, NotFoundError>
  readonly abort: (sessionID: SessionID) => Effect.Effect<void, never>
  readonly fork: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Info, NotFoundError>
  readonly summarize: (input: {
    sessionID: SessionID
    providerID: ProviderID
    modelID: ModelID
    auto?: boolean
  }) => Effect.Effect<boolean, NotFoundError>
  readonly init: (input: {
    sessionID: SessionID
    messageID: MessageID
    providerID: ProviderID
    modelID: ModelID
  }) => Effect.Effect<boolean, never>
  readonly command: (
    input: SessionPrompt.CommandInput,
  ) => Effect.Effect<{ user: SessionMessage.User | undefined; assistant: SessionMessage.Assistant | undefined }, never>
  readonly revert: (input: {
    sessionID: SessionID
    messageID: RevertMessageID
    partID?: PartID
  }) => Effect.Effect<Info, NotFoundError>
  readonly unrevert: (sessionID: SessionID) => Effect.Effect<Info, NotFoundError>
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
    slug: info.slug,
    directory: info.directory,
    path: info.path,
    agent: info.agent,
    model: info.model
      ? {
          id: info.model.id,
          providerID: info.model.providerID,
          variant: Modelv2.VariantID.make(info.model.variant ?? "default"),
        }
      : undefined,
    time: {
      created: DateTime.makeUnsafe(info.time.created),
      updated: DateTime.makeUnsafe(info.time.updated),
      archived: info.time.archived ? DateTime.makeUnsafe(info.time.archived) : undefined,
    },
    title: info.title,
    version: info.version,
    permission: info.permission,
    summary: info.summary
      ? {
          additions: info.summary.additions,
          deletions: info.summary.deletions,
          files: info.summary.files,
        }
      : undefined,
    share: info.share,
    revert: info.revert,
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
    ...(prompt.synthetic ?? []).map((text) => ({ type: "text", text, synthetic: true }) as const),
    ...(prompt.ignored ?? []).map((text) => ({ type: "text", text, ignored: true }) as const),
    ...(prompt.files ?? []).map(
      (file) => ({ type: "file", url: file.uri, mime: file.mime, filename: file.name }) as const,
    ),
    ...(prompt.agents ?? []).map((agent) => ({ type: "agent", name: agent.name }) as const),
  ]
}

/**
 * V1 `PromptInput.model` / `SessionCompaction.create` use `{ modelID, providerID }`,
 * while V2 `Modelv2.Ref` uses `{ id, providerID, variant }`. Pure field-name reshape —
 * the brands themselves are shared with V1 since the brand unification.
 */
function toPromptModel(model: Modelv2.Ref): { modelID: ModelID; providerID: ProviderID } {
  return { modelID: model.id, providerID: model.providerID }
}

type LegacyMessageDefaults = {
  agent: string
  model: Modelv2.Ref
}

const UnknownModel: Modelv2.Ref = {
  id: Modelv2.ID.make("unknown"),
  providerID: Modelv2.ProviderID.make("unknown"),
  variant: Modelv2.VariantID.make("default"),
}

function legacyMessageDefaults(sessionID: SessionID): LegacyMessageDefaults {
  const row = Database.use((db) =>
    db
      .select({ agent: SessionTable.agent, model: SessionTable.model })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get(),
  )
  return {
    agent: row?.agent ?? "build",
    model: row?.model
      ? {
          id: Modelv2.ID.make(row.model.id),
          providerID: Modelv2.ProviderID.make(row.model.providerID),
          variant: Modelv2.VariantID.make(row.model.variant ?? "default"),
        }
      : UnknownModel,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sync = yield* SyncEvent.Service
    // Layer scope: background fibers (the deferred-delivery worker) fork into
    // this so they outlive HTTP requests and die with the instance.
    const scope = yield* Scope.Scope
    const decodeMessage = (data: unknown) =>
      Schema.decodeUnknownSync(SessionMessage.Message)(SessionMessage.normalizeForDecode(data))
    // Compatibility and persistence services are captured lazily via serviceOption
    // so read-only consumers (get/list/messages/context) still work without them.
    const sessionsV1 = yield* Effect.serviceOption(Session.Service)
    const promptEngine = yield* Effect.serviceOption(SessionPrompt.Engine)
    const compactionV1 = yield* Effect.serviceOption(SessionCompaction.Service)
    const statusV1 = yield* Effect.serviceOption(SessionStatus.Service)
    const bus = yield* Effect.serviceOption(Bus.Service)
    const agentsV1 = yield* Effect.serviceOption(Agent.Service)
    const configV1 = yield* Effect.serviceOption(Config.Service)
    const revertV1 = yield* Effect.serviceOption(SessionRevert.Service)

    const requireV1 = <A>(svc: Option.Option<A>, name: string) =>
      Option.isNone(svc)
        ? Effect.die(`V2Session.${name} requires the V1 ${name} service to be provided`)
        : Effect.succeed(svc.value)

    const decode = (row: typeof SessionMessageTable.$inferSelect, defaults: LegacyMessageDefaults) => {
      const data = stripLegacyMessageID({ ...row.data, id: row.id, type: row.type })
      if (row.type !== "user") return decodeMessage(data)
      return decodeMessage({
        ...data,
        agent: data.agent ?? defaults.agent,
        model: data.model ?? defaults.model,
      })
    }

    function fromRows(rows: (typeof SessionTable.$inferSelect)[]): Info[] {
      const reverted = rows.flatMap((row) =>
        row.revert?.messageID.startsWith("msg_") ? [{ row, messageID: row.revert.messageID }] : [],
      )
      const projected = new Map<string, string>()
      for (let offset = 0; offset < reverted.length; offset += 400) {
        const batch = reverted.slice(offset, offset + 400)
        const rowBySession = new Map(batch.map(({ row, messageID }) => [row.id, messageID]))
        const matches = Database.use((db) =>
          db
            .select({
              id: SessionMessageTable.id,
              sessionID: SessionMessageTable.session_id,
              legacyID: sql<string>`json_extract(
                ${SessionMessageTable.data},
                ${sql.raw(`'$.metadata.${LEGACY_MESSAGE_ID}'`)}
              )`,
            })
            .from(SessionMessageTable)
            .where(
              and(
                inArray(
                  SessionMessageTable.session_id,
                  batch.map(({ row }) => row.id),
                ),
                inArray(
                  sql`json_extract(
                    ${SessionMessageTable.data},
                    ${sql.raw(`'$.metadata.${LEGACY_MESSAGE_ID}'`)}
                  )`,
                  batch.map(({ messageID }) => messageID),
                ),
              ),
            )
            .all(),
        )
        for (const match of matches) {
          if (rowBySession.get(match.sessionID) === match.legacyID) projected.set(match.sessionID, match.id)
        }
      }

      return rows.map((row) => fromRow(row, projected.get(row.id)))
    }

    function fromRow(row: typeof SessionTable.$inferSelect, projectedRevertID?: string): Info {
      const sessionID = SessionID.make(row.id)
      return new Info({
        id: sessionID,
        projectID: ProjectID.make(row.project_id),
        workspaceID: row.workspace_id ? WorkspaceID.make(row.workspace_id) : undefined,
        slug: row.slug,
        directory: row.directory,
        title: row.title,
        version: row.version,
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
        summary:
          row.summary_additions !== undefined || row.summary_deletions !== undefined || row.summary_files !== undefined
            ? {
                additions: row.summary_additions ?? 0,
                deletions: row.summary_deletions ?? 0,
                files: row.summary_files ?? 0,
              }
            : undefined,
        share: row.share_url ? { url: row.share_url } : undefined,
        revert:
          row.revert && projectedRevertID ? { ...row.revert, messageID: projectedRevertID } : (row.revert ?? undefined),
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
          model: input?.model,
          workspaceID: input?.workspaceID,
          title: input?.title,
          permission: input?.permission,
        })
        return toV2Info(info)
      }),
      get: Effect.fn("V2Session.get")(function* (sessionID) {
        const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
        if (!row) return yield* new NotFoundError({ sessionID })
        return fromRows([row])[0]
      }),
      list: Effect.fn("V2Session.list")(function* (input) {
        const direction = input.cursor?.direction ?? "next"
        let order = input.order ?? "desc"
        // Query the adjacent rows in reverse, then flip them back into the requested order below.
        if (direction === "previous" && order === "asc") order = "desc"
        if (direction === "previous" && order === "desc") order = "asc"
        const conditions: SQL[] = []
        // scope "project" opts out of the directory filter (V1 listByProject parity)
        if (input.directory && input.scope !== "project") conditions.push(eq(SessionTable.directory, input.directory))
        if (input.path)
          conditions.push(or(eq(SessionTable.path, input.path), like(SessionTable.path, `${input.path}/%`))!)
        if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
        if (input.roots) conditions.push(isNull(SessionTable.parent_id))
        // V1 parity: the TUI's 30-day window filters on last-updated time, not
        // creation time — a long-lived session updated today must still appear.
        if (input.start) conditions.push(gte(SessionTable.time_updated, input.start))
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
        return fromRows(direction === "previous" ? rows.toReversed() : rows)
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
        const defaults = legacyMessageDefaults(input.sessionID)
        return rows.map((row) => decode(row, defaults))
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
        const defaults = legacyMessageDefaults(sessionID)
        return rows.map((row) => decode(row, defaults))
      }),
      prompt: Effect.fn("V2Session.prompt")(function* (input) {
        // Delegates to the shared prompt engine, which owns the agent loop and
        // emits SessionEvent.*.Sync unconditionally. The Prompted projector then
        // populates SessionMessageTable, which the read methods (`messages`/`context`)
        // query. SessionPrompt.Service remains the V1 compatibility facade.
        const engine = yield* requireV1(promptEngine, "SessionPromptEngine")
        const delivery = input.delivery ?? DefaultDelivery
        const parts = promptToParts(input.prompt)

        // `noReply: true` tells V1 to create the user message but NOT run the
        // loop. Used for deferred delivery — the message is staged and the loop
        // runs later via runDeferred().
        yield* engine.prompt({
          sessionID: input.sessionID,
          parts,
          noReply: delivery === "deferred",
          model: input.model,
          variant: input.variant,
          messageID: input.messageID,
          agent: input.agent,
          tools: input.tools,
        })

        // Read back the projected messages: the user message the Prompted
        // event wrote, plus the final assistant message (the loop ran
        // synchronously for immediate delivery) so callers like ACP can
        // report per-turn usage without an extra round-trip.
        const messages = yield* result.messages({ sessionID: input.sessionID, order: "asc" })
        const user = messages.findLast((m): m is SessionMessage.User => m.type === "user")
        const assistant = messages.findLast((m): m is SessionMessage.Assistant => m.type === "assistant")

        if (delivery === "deferred") {
          deferredQueue.add(input.sessionID)
          // Background worker: drain the staged prompt on a layer-scoped fiber
          // so the run survives request completion (the promptAsync HTTP
          // handler relies on this). Forked AFTER the read-back so the
          // response is deterministic — the drain cannot interleave before
          // the caller's result is built. The queue guard makes concurrent
          // drains idempotent; a message staged while the loop is busy is
          // consumed by the running loop's continuation check.
          yield* runDeferred(input.sessionID).pipe(Effect.forkIn(scope))
        }

        return { user, assistant }
      }),
      shell: Effect.fn("V2Session.shell")(function* (input) {
        // The shared prompt engine emits Shell.Started/Ended at
        // prompt.ts:884/907.
        const engine = yield* requireV1(promptEngine, "SessionPromptEngine")
        const session = yield* result.get(input.sessionID).pipe(Effect.orDie)
        yield* engine.shell({
          sessionID: input.sessionID,
          messageID: input.messageID,
          agent: input.agent ?? session.agent ?? "build",
          model: input.model,
          command: input.command,
        })
      }),
      skill: Effect.fn("V2Session.skill")(function* (input) {
        // Invokes a skill by prompting with the skill name as text. The skill
        // loader in the agent loop resolves `/skill-name` into the skill content.
        // Delegates to the shared prompt engine — no dedicated Skill.Invoked event is needed
        // because the prompt flow already emits Prompted.Sync + the tool events.
        const engine = yield* requireV1(promptEngine, "SessionPromptEngine")
        const session = yield* result.get(input.sessionID).pipe(Effect.orDie)
        yield* engine.prompt({
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
              Effect.map(
                (a) =>
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

        for (let depth = 0, currentParentID: SessionID | undefined = input.parentID; currentParentID;) {
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
        const engine = yield* requireV1(promptEngine, "SessionPromptEngine")
        const cancelChild = engine.cancel(session.id)
        const bridge = yield* EffectBridge.make()
        let cancelled = false
        const onAbort = () => {
          if (cancelled) return
          cancelled = true
          bridge.promise(cancelChild).catch((error) => log.warn("subagent cancel failed", { error: String(error) }))
        }
        if (input.abort) input.abort.addEventListener("abort", onAbort)

        yield* Effect.acquireUseRelease(
          Effect.sync(() => {}),
          () =>
            Effect.gen(function* () {
              yield* result.prompt({
                prompt: input.prompt,
                sessionID: session.id,
                model: input.model ? toPromptModel(input.model) : undefined,
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
                  const squashed = Cause.squash(cause)
                  log.error("subagent failed", {
                    cause: Cause.squash(cause),
                    parentID: input.parentID,
                    agent: input.agent,
                  })
                  yield* sync.run(SessionEvent.Synthetic.Sync, {
                    sessionID: input.parentID,
                    timestamp: DateTime.makeUnsafe(Date.now()),
                    text: `Subagent error: ${squashed instanceof Error ? squashed.message : String(squashed)}`,
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
          model: toPromptModel(model),
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
        yield* busSvc.subscribe(SessionStatus.Event.Idle).pipe(
          Stream.filter((e) => e.properties.sessionID === sessionID),
          Stream.take(1),
          Stream.runDrain,
        )
      }),
      children: Effect.fn("V2Session.children")(function* (sessionID) {
        const sessions = yield* requireV1(sessionsV1, "Session")
        const rows = yield* sessions.children(sessionID)
        return rows.map(toV2Info)
      }),
      remove: Effect.fn("V2Session.remove")(function* (sessionID) {
        const sessions = yield* requireV1(sessionsV1, "Session")
        yield* sessions
          .remove(sessionID)
          .pipe(Effect.catchIf(StorageNotFoundError.isInstance, () => Effect.fail(new NotFoundError({ sessionID }))))
      }),
      update: Effect.fn("V2Session.update")(function* (input) {
        const sessions = yield* requireV1(sessionsV1, "Session")
        const current = yield* result.get(input.sessionID)
        if (input.title !== undefined) {
          yield* sessions.setTitle({ sessionID: input.sessionID, title: input.title })
        }
        if (input.permission !== undefined) {
          // Same merge semantics as the V1 HTTP handler: payload rules are
          // appended onto the session's existing ruleset.
          const v1Permission = Permission.merge(current.permission ?? [], input.permission)
          yield* sessions.setPermission({ sessionID: input.sessionID, permission: v1Permission })
        }
        if (input.archived !== undefined) {
          yield* sessions.setArchived({ sessionID: input.sessionID, time: input.archived })
        }
        return yield* result.get(input.sessionID)
      }),
      abort: Effect.fn("V2Session.abort")(function* (sessionID) {
        const engine = yield* requireV1(promptEngine, "SessionPromptEngine")
        yield* engine.cancel(sessionID)
      }),
      fork: Effect.fn("V2Session.fork")(function* (input) {
        const sessions = yield* requireV1(sessionsV1, "Session")
        const info = yield* sessions
          .fork(input)
          .pipe(
            Effect.catchIf(StorageNotFoundError.isInstance, () =>
              Effect.fail(new NotFoundError({ sessionID: input.sessionID })),
            ),
          )
        return toV2Info(info)
      }),
      summarize: Effect.fn("V2Session.summarize")(function* (input) {
        // Same orchestration as the V1 HTTP summarize handler: clean revert
        // state, compact from the last user agent's perspective, then run the
        // loop so the summary is produced immediately.
        const sessions = yield* requireV1(sessionsV1, "Session")
        const revert = yield* requireV1(revertV1, "SessionRevert")
        const compactionSvc = yield* requireV1(compactionV1, "SessionCompaction")
        const engine = yield* requireV1(promptEngine, "SessionPromptEngine")
        const agents = yield* requireV1(agentsV1, "Agent")
        const info = yield* sessions
          .get(input.sessionID)
          .pipe(
            Effect.catchIf(StorageNotFoundError.isInstance, () =>
              Effect.fail(new NotFoundError({ sessionID: input.sessionID })),
            ),
          )
        yield* revert.cleanup(info)
        const messages = yield* sessions.messages({ sessionID: input.sessionID })
        const defaultAgent = yield* agents.defaultAgent()
        const currentAgent = messages.findLast((message) => message.info.role === "user")?.info.agent ?? defaultAgent
        yield* compactionSvc.create({
          sessionID: input.sessionID,
          agent: currentAgent,
          model: { providerID: input.providerID, modelID: input.modelID },
          auto: input.auto ?? false,
        })
        yield* engine.loop({ sessionID: input.sessionID })
        return true
      }),
      init: Effect.fn("V2Session.init")(function* (input) {
        const engine = yield* requireV1(promptEngine, "SessionPromptEngine")
        yield* engine.command({
          sessionID: input.sessionID,
          messageID: input.messageID,
          model: `${input.providerID}/${input.modelID}`,
          command: Command.Default.INIT,
          arguments: "",
        })
        return true
      }),
      command: Effect.fn("V2Session.command")(function* (input) {
        // Mirrors the V2 prompt style: stage the command message through the shared engine
        // (which runs the loop synchronously) and read back the projected
        // user + final assistant messages for per-turn usage reporting.
        const engine = yield* requireV1(promptEngine, "SessionPromptEngine")
        yield* engine.command(input)
        const messages = yield* result.messages({ sessionID: input.sessionID, order: "asc" })
        const user = messages.findLast((m): m is SessionMessage.User => m.type === "user")
        const assistant = messages.findLast((m): m is SessionMessage.Assistant => m.type === "assistant")
        return { user, assistant }
      }),
      revert: Effect.fn("V2Session.revert")(function* (input) {
        const revert = yield* requireV1(revertV1, "SessionRevert")
        yield* result.get(input.sessionID)
        const messageID = input.messageID.startsWith("evt_")
          ? yield* Effect.gen(function* () {
              const sessions = yield* requireV1(sessionsV1, "Session")
              const row = Database.use((db) =>
                db
                  .select({
                    type: SessionMessageTable.type,
                    time_created: SessionMessageTable.time_created,
                    data: SessionMessageTable.data,
                  })
                  .from(SessionMessageTable)
                  .where(
                    and(
                      eq(SessionMessageTable.session_id, input.sessionID),
                      eq(SessionMessageTable.id, SessionMessage.ID.make(input.messageID)),
                    ),
                  )
                  .get(),
              )
              if (!row) return yield* Effect.fail(new NotFoundError({ sessionID: input.sessionID }))
              const messages = yield* sessions.messages({ sessionID: input.sessionID })
              const { target, matchedBy } = matchLegacyMessage(
                messages,
                row.type,
                legacyMessageID(row.data.metadata),
                row.time_created,
              )
              if (matchedBy === "timestamp") {
                log.warn("revert target resolved via timestamp fallback — V2 row missing legacy association", {
                  sessionID: input.sessionID,
                  messageID: input.messageID,
                })
              }
              if (!target) return yield* Effect.fail(new NotFoundError({ sessionID: input.sessionID }))
              return target.info.id
            })
          : input.messageID
        const info = yield* revert.revert({ ...input, messageID })
        const infoV2 = new Info({
          ...toV2Info(info),
          revert: info.revert ? { ...info.revert, messageID: input.messageID } : undefined,
        })
        yield* sync.run(SessionEvent.Updated.Sync, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(Date.now()),
          info: { revert: infoV2.revert },
        })
        return infoV2
      }),
      unrevert: Effect.fn("V2Session.unrevert")(function* (sessionID) {
        const revert = yield* requireV1(revertV1, "SessionRevert")
        yield* result.get(sessionID)
        const info = yield* revert.unrevert({ sessionID })
        return toV2Info(info)
      }),
    }

    /**
     * Drain deferred-delivery prompts for a session by running the shared loop.
     * Exposed via an extended service so tests/callers can trigger deferred
     * processing. The layer-scoped worker invokes this after deferred staging.
     * Delegates to `SessionPromptEngine.loop`; the V1 service is only a
     * compatibility facade.
     */
    const runDeferred = (sessionID: SessionID): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (!deferredQueue.delete(sessionID)) return
        const engine = yield* requireV1(promptEngine, "SessionPromptEngine")
        yield* engine.loop({ sessionID })
      })

    return Service.of(Object.assign(result, { runDeferred }))
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SyncEvent.defaultLayer))

export * as SessionV2 from "./session"
