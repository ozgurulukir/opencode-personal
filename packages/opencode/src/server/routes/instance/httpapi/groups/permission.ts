import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/permission"
const ReplyPayload = Schema.Struct({
  reply: Permission.Reply,
  message: Schema.optional(Schema.String),
})

export const PermissionApi = HttpApi.make("permission")
  .add(
    HttpApiGroup.make("permission")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Permission.Request), "List of pending permissions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.list",
            summary: "List pending permissions",
            description: "Get all pending permission requests across all sessions.",
          }),
        ),
        HttpApiEndpoint.post("reply", `${root}/:requestID/reply`, {
          params: { requestID: PermissionID },
          query: WorkspaceRoutingQuery,
          payload: ReplyPayload,
          success: described(Schema.Boolean, "Permission processed successfully"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.reply",
            summary: "Respond to permission request",
            description: "Approve or deny a permission request from the AI assistant.",
          }),
        ),
        HttpApiEndpoint.get("listApproved", `${root}/approved`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Permission.Rule), "List of approved permissions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.listApproved",
            summary: "List approved permissions",
            description: "Get all persisted always-allow permission rules for this project.",
          }),
        ),
        HttpApiEndpoint.post("removeApproved", `${root}/approved/remove`, {
          query: WorkspaceRoutingQuery,
          payload: Schema.Struct({
            permission: Schema.String,
            pattern: Schema.optional(Schema.String),
          }),
          success: described(Schema.Boolean, "Approved permission rule removed successfully"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.removeApproved",
            summary: "Revoke approved permission",
            description: "Revoke a specific always-allowed permission rule or all rules for a permission key.",
          }),
        ),
        HttpApiEndpoint.post("clearApproved", `${root}/approved/clear`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "All approved permissions cleared successfully"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.clearApproved",
            summary: "Clear all approved permissions",
            description: "Clear all persisted always-allow permission rules for this project.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "permission",
          description: "Experimental HttpApi permission routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
