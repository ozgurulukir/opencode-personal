import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import {
  subagentSessionPermission,
  subagentToolRestrictions,
  resolveParentAgent,
  checkNesting,
  taskDenyGateFromRuleset,
} from "../agent/subagent-permissions"
import { subagentAbortGuard, subagentResultText, subagentTitle } from "../agent/subagent-spawn"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Cause, Effect, Schema } from "effect"
import { EffectBridge } from "@/effect/bridge"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"

export const Parameters = Schema.Struct({
  description: Schema.optional(Schema.String).annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      const description = params.description || params.prompt.slice(0, 50)

      // Check permission ruleset for deny even when bypassAgentCheck is true.
      // bypassAgentCheck only skips the user-facing ask dialog, not deny enforcement.
      // ctx.extra carries the pre-merged ruleset (loop agent permission +
      // session permission, assembled at session/loop/tools.ts:83) — evaluated
      // through the shared gate (agent/subagent-permissions.ts).
      const gate = taskDenyGateFromRuleset({
        permissionRuleset: ctx.extra?.permissionRuleset,
        subagentType: params.subagent_type,
      })
      if (gate.denied) {
        return yield* Effect.fail(new Error(gate.message))
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(
            Effect.catchCause((cause) =>
              Effect.fail(new Error(`Cannot resume task: session ${taskID} not found (${Cause.squash(cause)})`)),
            ),
          )
        : undefined
      if (session && session.parentID !== ctx.sessionID) {
        return yield* Effect.fail(new Error(`task_id ${taskID} does not belong to this session`))
      }
      const parent = yield* sessions.get(ctx.sessionID)
      // Fix 4 + fix 8: pass parent.agent un-gated — resolveParentAgent
      // applies FALLBACK_DENY (with warn) for null/undefined/missing agents
      // (AD-2 fail-closed).
      const parentAgent = yield* resolveParentAgent({
        name: parent.agent,
        get: (name) => agent.get(name),
      })

      yield* checkNesting({
        startID: ctx.sessionID,
        // orDie: a missing ancestor mid-walk is a data-integrity defect
        // (matches the previous execute-boundary orDie on sessions.get).
        get: (id) => sessions.get(id).pipe(Effect.orDie),
      })

      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: subagentTitle(description, next.name),
          permission: subagentSessionPermission({
            parentSessionPermission: parent.permission ?? [],
            parentAgent,
            subagent: next,
            primaryTools: cfg.experimental?.primary_tools,
          }),
        }))

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      yield* ctx.metadata({
        title: description,
        metadata: {
          sessionId: nextSession.id,
          model,
        },
      })

      const ops = ctx.extra?.promptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const messageID = MessageID.ascending()
      const cancel = ops.cancel(nextSession.id)
      const bridge = yield* EffectBridge.make()
      const guard = subagentAbortGuard({ abort: ctx.abort, cancel, bridge })

      return yield* Effect.acquireUseRelease(
        guard.acquire,
        () =>
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(params.prompt)
            const result = yield* ops.prompt({
              messageID,
              sessionID: nextSession.id,
              model: {
                modelID: model.modelID,
                providerID: model.providerID,
              },
              agent: next.name,
              tools: subagentToolRestrictions({
                subagent: next,
                primaryTools: cfg.experimental?.primary_tools,
              }),
              parts,
            })

            return {
              title: description,
              metadata: {
                sessionId: nextSession.id,
                model,
              },
              output: [
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                "",
                "<task_result>",
                subagentResultText(result.parts),
                "</task_result>",
              ].join("\n"),
            }
          }),
        (_, exit) => guard.release(exit),
      )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
