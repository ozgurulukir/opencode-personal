import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const permissionHandlers = HttpApiBuilder.group(InstanceHttpApi, "permission", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Permission.Service

    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
      params: { requestID: PermissionID }
      payload: Permission.ReplyBody
    }) {
      yield* svc.reply({
        requestID: ctx.params.requestID,
        reply: ctx.payload.reply,
        message: ctx.payload.message,
      })
      return true
    })

    const listApproved = Effect.fn("PermissionHttpApi.listApproved")(function* () {
      return yield* svc.listApproved()
    })

    const removeApproved = Effect.fn("PermissionHttpApi.removeApproved")(function* (ctx: {
      payload: { permission: string; pattern?: string }
    }) {
      return yield* svc.removeApproved(ctx.payload)
    })

    const clearApproved = Effect.fn("PermissionHttpApi.clearApproved")(function* () {
      return yield* svc.clearApproved()
    })

    return handlers
      .handle("list", list)
      .handle("reply", reply)
      .handle("listApproved", listApproved)
      .handle("removeApproved", removeApproved)
      .handle("clearApproved", clearApproved)
  }),
)
