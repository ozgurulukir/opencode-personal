import {
  type AgentSideConnection,
  type PlanEntry,
  type ToolCallContent,
  type ToolKind,
} from "@agentclientprotocol/sdk"
import * as Log from "@opencode-ai/core/util/log"
import { Hash } from "@opencode-ai/core/util/hash"
import { ShellID } from "@/tool/shell/id"
import { Todo } from "@/session/todo"
import { Result, Schema } from "effect"
import type { ToolPart } from "@opencode-ai/sdk/v2"

const log = Log.create({ service: "acp-tool-dispatch" })

const decodeTodos = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Array(Todo.Info)))

export function shellOutput(part: ToolPart): string | undefined {
  if (part.tool !== ShellID.ToolID) return
  if (!("metadata" in part.state) || !part.state.metadata || typeof part.state.metadata !== "object") return
  const output = part.state.metadata["output"]
  if (typeof output !== "string") return
  return output
}

export async function toolStart(
  connection: AgentSideConnection,
  toolStarts: Set<string>,
  sessionId: string,
  part: ToolPart,
) {
  if (toolStarts.has(part.callID)) return
  toolStarts.add(part.callID)
  await connection
    .sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: part.callID,
        title: part.tool,
        kind: toToolKind(part.tool),
        status: "pending",
        locations: [],
        rawInput: {},
      },
    })
    .catch((error) => {
      log.error("failed to send tool pending to ACP", { error })
    })
}

export async function handleToolPartUpdate(
  connection: AgentSideConnection,
  shellSnapshots: Map<string, string>,
  toolStarts: Set<string>,
  sessionId: string,
  part: ToolPart,
) {
  await toolStart(connection, toolStarts, sessionId, part)
  switch (part.state.status) {
    case "pending":
      shellSnapshots.delete(part.callID)
      return

    case "running": {
      const output = shellOutput(part)
      const content: ToolCallContent[] = []
      if (output) {
        const hash = Hash.fast(output)
        if (part.tool === ShellID.ToolID) {
          if (shellSnapshots.get(part.callID) === hash) {
            await connection
              .sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: part.callID,
                  status: "in_progress",
                  kind: toToolKind(part.tool),
                  title: part.tool,
                  locations: toLocations(part.tool, part.state.input),
                  rawInput: part.state.input,
                },
              })
              .catch((error) => {
                log.error("failed to send tool in_progress to ACP", { error })
              })
            return
          }
          shellSnapshots.set(part.callID, hash)
        }
        content.push({
          type: "content",
          content: {
            type: "text",
            text: output,
          },
        })
      }
      await connection
        .sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: part.callID,
            status: "in_progress",
            kind: toToolKind(part.tool),
            title: part.tool,
            locations: toLocations(part.tool, part.state.input),
            rawInput: part.state.input,
            ...(content.length > 0 && { content }),
          },
        })
        .catch((error) => {
          log.error("failed to send tool in_progress to ACP", { error })
        })
      return
    }

    case "completed": {
      toolStarts.delete(part.callID)
      shellSnapshots.delete(part.callID)
      const kind = toToolKind(part.tool)
      const content = completedToolContent(part, kind)

      if (part.tool === "todowrite") {
        const parsedTodos = decodeTodos(part.state.output)
        if (Result.isSuccess(parsedTodos)) {
          await connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "plan",
                entries: parsedTodos.success.map((todo) => {
                  const status: PlanEntry["status"] =
                    todo.status === "cancelled" ? "completed" : (todo.status as PlanEntry["status"])
                  return {
                    priority: "medium",
                    status,
                    content: todo.content,
                  }
                }),
              },
            })
            .catch((error) => {
              log.error("failed to send session update for todo", { error })
            })
        } else {
          log.error("failed to parse todo output", { error: parsedTodos.failure })
        }
      }

      await connection
        .sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: part.callID,
            status: "completed",
            kind,
            content,
            title: part.state.title,
            rawInput: part.state.input,
            rawOutput: completedToolRawOutput(part),
          },
        })
        .catch((error) => {
          log.error("failed to send tool completed to ACP", { error })
        })
      return
    }

    case "error":
      toolStarts.delete(part.callID)
      shellSnapshots.delete(part.callID)
      await connection
        .sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: part.callID,
            status: "failed",
            kind: toToolKind(part.tool),
            title: part.tool,
            rawInput: part.state.input,
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: part.state.error,
                },
              },
            ],
            rawOutput: {
              error: part.state.error,
              metadata: part.state.metadata,
            },
          },
        })
        .catch((error) => {
          log.error("failed to send tool error to ACP", { error })
        })
      return
  }
}

export function toToolKind(toolName: string): ToolKind {
  const tool = toolName.toLocaleLowerCase()

  switch (tool) {
    case ShellID.ToolID:
      return "execute"

    case "webfetch":
      return "fetch"

    case "edit":
    case "patch":
    case "write":
      return "edit"

    case "grep":
    case "glob":
    case "repo_clone":
    case "repo_overview":
    case "context7_resolve_library_id":
    case "context7_get_library_docs":
      return "search"

    case "read":
      return "read"

    default:
      return "other"
  }
}

export function toLocations(toolName: string, input: Record<string, any>): { path: string }[] {
  const tool = toolName.toLocaleLowerCase()

  switch (tool) {
    case "read":
    case "edit":
    case "write":
      return input["filePath"] ? [{ path: input["filePath"] }] : []
    case "glob":
    case "grep":
      return input["path"] ? [{ path: input["path"] }] : []
    case "repo_clone":
      return input["path"] ? [{ path: input["path"] }] : []
    case "repo_overview":
      return input["path"] ? [{ path: input["path"] }] : []
    case ShellID.ToolID:
      return []
    default:
      return []
  }
}

export function completedToolContent(part: ToolPart, kind: ToolKind): ToolCallContent[] {
  if (part.state.status !== "completed") return []

  const content: ToolCallContent[] = [
    {
      type: "content",
      content: {
        type: "text",
        text: part.state.output,
      },
    },
  ]

  if (kind === "edit") {
    const input = part.state.input
    const filePath = typeof input["filePath"] === "string" ? input["filePath"] : ""
    const oldText = typeof input["oldString"] === "string" ? input["oldString"] : ""
    const newText =
      typeof input["newString"] === "string"
        ? input["newString"]
        : typeof input["content"] === "string"
          ? input["content"]
          : ""
    content.push({
      type: "diff",
      path: filePath,
      oldText,
      newText,
    })
  }

  content.push(...imageContents(part.state.attachments ?? []))
  return content
}

export function completedToolRawOutput(part: ToolPart) {
  if (part.state.status !== "completed") return {}
  return {
    output: part.state.output,
    metadata: part.state.metadata,
    ...(part.state.attachments?.length ? { attachments: part.state.attachments } : {}),
  }
}

function imageContents(attachments: Array<{ mime: string; url: string }>): ToolCallContent[] {
  return attachments.flatMap((attachment): ToolCallContent[] => {
    const match = attachment.url.match(/^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$/)
    const mime = match?.[1] ?? attachment.mime
    if (!mime.startsWith("image/")) return []
    const data = match?.[2]
    if (data === undefined) return []
    return [
      {
        type: "content" as const,
        content: {
          type: "image" as const,
          mimeType: mime,
          data,
        },
      },
    ]
  })
}
