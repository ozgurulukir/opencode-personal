import { listAdapters } from "@/control-plane/adapters"
import { Workspace } from "@/control-plane/workspace"
import { WorkspaceTable } from "@/control-plane/workspace.sql"
import * as InstanceState from "@/effect/instance-state"
import { Vcs } from "@/project/vcs"
import { SessionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage/db"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ApiVcsApplyError } from "../groups/instance"
import { ApiWorkspaceWarpError, CreatePayload, WarpPayload } from "../groups/workspace"

export const workspaceHandlers = HttpApiBuilder.group(InstanceHttpApi, "workspace", (handlers) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service

    const adapters = Effect.fn("WorkspaceHttpApi.adapters")(function* () {
      const instance = yield* InstanceState.context
      return yield* Effect.sync(() => listAdapters(instance.project.id))
    })

    const list = Effect.fn("WorkspaceHttpApi.list")(function* () {
      return yield* workspace.list((yield* InstanceState.context).project)
    })

    const create = Effect.fn("WorkspaceHttpApi.create")(function* (ctx: { payload: typeof CreatePayload.Type }) {
      const instance = yield* InstanceState.context
      return yield* workspace
        .create({
          ...ctx.payload,
          extra: ctx.payload.extra ?? null,
          projectID: instance.project.id,
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const syncList = Effect.fn("WorkspaceHttpApi.syncList")(function* () {
      yield* workspace.syncList((yield* InstanceState.context).project)
    })

    const status = Effect.fn("WorkspaceHttpApi.status")(function* () {
      const ids = new Set((yield* workspace.list((yield* InstanceState.context).project)).map((item) => item.id))
      return (yield* workspace.status()).filter((item) => ids.has(item.workspaceID))
    })

    const remove = Effect.fn("WorkspaceHttpApi.remove")(function* (ctx: { params: { id: Workspace.Info["id"] } }) {
      const instance = yield* InstanceState.context
      const row = Database.use((db) =>
        db
          .select({ projectID: WorkspaceTable.project_id })
          .from(WorkspaceTable)
          .where(eq(WorkspaceTable.id, ctx.params.id))
          .get(),
      )
      if (!row || row.projectID !== instance.project.id) {
        return yield* new HttpApiError.NotFound({})
      }
      return yield* workspace.remove(ctx.params.id)
    })

    const warp = Effect.fn("WorkspaceHttpApi.warp")(function* (ctx: { payload: typeof WarpPayload.Type }) {
      const instance = yield* InstanceState.context
      const sessionRow = Database.use((db) =>
        db
          .select({ projectID: SessionTable.project_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, ctx.payload.sessionID))
          .get(),
      )
      if (!sessionRow || sessionRow.projectID !== instance.project.id) {
        return yield* new HttpApiError.NotFound({})
      }
      if (ctx.payload.id !== null) {
        const workspaceID = ctx.payload.id
        const workspaceRow = Database.use((db) =>
          db
            .select({ projectID: WorkspaceTable.project_id })
            .from(WorkspaceTable)
            .where(eq(WorkspaceTable.id, workspaceID))
            .get(),
        )
        if (!workspaceRow || workspaceRow.projectID !== instance.project.id) {
          return yield* new HttpApiError.NotFound({})
        }
      }
      yield* workspace
        .sessionWarp({
          workspaceID: ctx.payload.id,
          sessionID: ctx.payload.sessionID,
          copyChanges: ctx.payload.copyChanges,
        })
        .pipe(
          Effect.mapError((error) => {
            if (error instanceof Vcs.PatchApplyError) {
              return new ApiVcsApplyError({
                name: "VcsApplyError",
                data: {
                  message: error.message,
                  reason: error.reason,
                },
              })
            }
            return new ApiWorkspaceWarpError({
              name: "WorkspaceWarpError",
              data: {
                message: error.message,
              },
            })
          }),
        )
    })

    return handlers
      .handle("adapters", adapters)
      .handle("list", list)
      .handle("create", create)
      .handle("syncList", syncList)
      .handle("status", status)
      .handle("remove", remove)
      .handle("warp", warp)
  }),
)
