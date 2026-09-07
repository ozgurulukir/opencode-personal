import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { Session } from "@/session/session"
import { Permission } from "@/permission"
import { SessionMessage } from "@/v2/session-message"
import { Prompt } from "@/v2/session-prompt"
import { SessionV2 } from "@/v2/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../../middleware/authorization"
import { InstanceContextMiddleware } from "../../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery, WorkspaceRoutingQueryFields } from "../../middleware/workspace-routing"
import { QueryBoolean } from "../query"

export const SessionsQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)),
  ).annotate({
    description: "Maximum number of sessions to return. Defaults to the newest 50 sessions.",
  }),
  order: Schema.optional(Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")])).annotate({
    description: "Session order for the first page. Use desc for newest first or asc for oldest first.",
  }),
  path: Schema.optional(Schema.String),
  roots: Schema.optional(QueryBoolean),
  start: Schema.optional(Schema.NumberFromString),
  search: Schema.optional(Schema.String),
  cursor: Schema.optional(
    Schema.String.annotate({
      description:
        "Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response. Do not combine with order or filters.",
    }),
  ),
}).annotate({ identifier: "V2SessionsQuery" })

export const SessionGroup = HttpApiGroup.make("v2.session")
  .add(
    HttpApiEndpoint.get("sessions", "/api/session", {
      query: SessionsQuery,
      success: Schema.Struct({
        items: Schema.Array(SessionV2.Info),
        cursor: Schema.Struct({
          previous: Schema.String.pipe(Schema.optional),
          next: Schema.String.pipe(Schema.optional),
        }),
      }).annotate({ identifier: "V2SessionsResponse" }),
      error: HttpApiError.BadRequest,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.list",
        summary: "List v2 sessions",
        description:
          "Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or cursor.previous to move through the ordered list.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("prompt", "/api/session/:sessionID/prompt", {
      params: { sessionID: SessionID },
      query: WorkspaceRoutingQuery,
      payload: Schema.Struct({
        prompt: Prompt,
        delivery: SessionV2.Delivery.pipe(Schema.optional),
      }),
      success: SessionMessage.Message,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.prompt",
        summary: "Send v2 message",
        description: "Create a v2 session message and queue it for the agent loop.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("compact", "/api/session/:sessionID/compact", {
      params: { sessionID: SessionID },
      query: WorkspaceRoutingQuery,
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.compact",
        summary: "Compact v2 session",
        description: "Compact a v2 session conversation.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("wait", "/api/session/:sessionID/wait", {
      params: { sessionID: SessionID },
      query: WorkspaceRoutingQuery,
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.wait",
        summary: "Wait for v2 session",
        description: "Wait for a v2 session agent loop to become idle.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("context", "/api/session/:sessionID/context", {
      params: { sessionID: SessionID },
      query: WorkspaceRoutingQuery,
      success: Schema.Array(SessionMessage.Message),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.context",
        summary: "Get v2 session context",
        description: "Retrieve the active context messages for a v2 session (all messages after the last compaction).",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("get", "/api/session/:sessionID", {
      params: { sessionID: SessionID },
      query: WorkspaceRoutingQuery,
      success: SessionV2.Info,
      error: SessionV2.NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.get",
        summary: "Get v2 session",
        description: "Retrieve a single v2 session by id.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("remove", "/api/session/:sessionID", {
      params: { sessionID: SessionID },
      query: WorkspaceRoutingQuery,
      success: Schema.Boolean,
      error: SessionV2.NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.remove",
        summary: "Remove v2 session",
        description: "Remove a v2 session and its children.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("update", "/api/session/:sessionID", {
      params: { sessionID: SessionID },
      query: WorkspaceRoutingQuery,
      payload: Schema.Struct({
        title: Schema.optional(Schema.String),
        permission: Schema.optional(Permission.Ruleset),
        time: Schema.optional(Schema.Struct({ archived: Schema.optional(Session.ArchivedTimestamp) })),
      }),
      success: SessionV2.Info,
      error: SessionV2.NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.update",
        summary: "Update v2 session",
        description: "Update properties of an existing v2 session, such as title, permission, or archived time.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("children", "/api/session/:sessionID/children", {
      params: { sessionID: SessionID },
      query: WorkspaceRoutingQuery,
      success: Schema.Array(SessionV2.Info),
      error: SessionV2.NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.children",
        summary: "Get v2 session children",
        description: "Retrieve the child sessions of a v2 session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("abort", "/api/session/:sessionID/abort", {
      params: { sessionID: SessionID },
      query: WorkspaceRoutingQuery,
      success: Schema.Boolean,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.abort",
        summary: "Abort v2 session",
        description: "Abort the running agent loop for a v2 session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("status", "/api/session/status", {
      query: WorkspaceRoutingQuery,
      success: Schema.Record(Schema.String, SessionStatus.Info),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.status",
        summary: "Get v2 session statuses",
        description: "Retrieve the agent-loop status for all sessions in the instance.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "v2",
      description: "Experimental v2 routes.",
    }),
  )
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)
