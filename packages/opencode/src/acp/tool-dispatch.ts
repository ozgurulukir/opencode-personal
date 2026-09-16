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
import type { SessionMessageAssistantTool, ToolTextContent } from "@opencode-ai/sdk/v2"

const log = Log.create({ service: "acp-tool-dispatch" })

const decodeTodos = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Array(Todo.Info)))

export type ToolCallInfo = { tool: string; input: Record<string, unknown> }

type V2ToolContent = ToolTextContent | { type: "file"; uri: string; mime: string; name?: string }

function textOutput(content: V2ToolContent[]): string {
  return content
    .filter((item): item is ToolTextContent => item.type === "text")
    .map((item) => item.text)
    .join("\n")
}

function structuredShellOutput(structured: Record<string, unknown>): string | undefined {
  const output = structured["output"]
  return typeof output === "string" ? output : undefined
}

function shellContentText(output: string) {
  const fence = output.includes("```") ? "````" : "```"
  return `${fence}\n${output}\n${fence}`
}

function toolTitle(tool: string, input: Record<string, unknown>) {
  const command = input.command
  return tool === ShellID.ToolID && typeof command === "string" && command.length > 0 ? command : tool
}

function shellCommandContent(tool: string, input: Record<string, unknown>, terminal?: string): ToolCallContent[] {
  const command = input.command
  if (tool !== ShellID.ToolID || typeof command !== "string" || command.length === 0) return []
  return [
    {
      type: "content",
      content: {
        type: "text",
        text: shellContentText(`$ ${command}`),
      },
    },
    ...(terminal ? [{ type: "terminal" as const, terminalId: terminal }] : []),
  ]
}

export async function toolStart(
  connection: AgentSideConnection,
  toolStarts: Set<string>,
  sessionId: string,
  callID: string,
  tool: string,
  input: Record<string, unknown> = {},
  terminal?: string,
) {
  if (toolStarts.has(callID)) {
    if (!terminal) return
    const content = shellCommandContent(tool, input, terminal)
    await connection
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: callID,
          status: "in_progress",
          kind: toToolKind(tool),
          title: toolTitle(tool, input),
          rawInput: input,
          content,
        },
      })
      .catch((error) => {
        log.error("failed to attach terminal to ACP tool call", { error })
      })
    return
  }
  toolStarts.add(callID)
  const content = shellCommandContent(tool, input, terminal)
  await connection
    .sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: callID,
        title: toolTitle(tool, input),
        kind: toToolKind(tool),
        status: "pending",
        locations: [],
        rawInput: input,
        ...(content.length > 0 && { content }),
      },
    })
    .catch((error) => {
      log.error("failed to send tool pending to ACP", { error })
    })
}

export async function handleToolCalled(
  connection: AgentSideConnection,
  shellSnapshots: Map<string, string>,
  toolStarts: Set<string>,
  toolCalls: Map<string, ToolCallInfo>,
  sessionId: string,
  props: { callID: string; tool: string; input: Record<string, unknown> },
) {
  toolCalls.set(props.callID, { tool: props.tool, input: props.input })
  // A re-called tool starts a fresh output stream (V1 cleared the snapshot on
  // the pending state).
  shellSnapshots.delete(props.callID)
  await toolStart(connection, toolStarts, sessionId, props.callID, props.tool)
}

export async function handleShellStarted(
  connection: AgentSideConnection,
  shellSnapshots: Map<string, string>,
  toolStarts: Set<string>,
  toolCalls: Map<string, ToolCallInfo>,
  sessionId: string,
  props: { callID: string; command: string; terminalId?: string },
) {
  const input = { command: props.command }
  toolCalls.set(props.callID, { tool: ShellID.ToolID, input })
  shellSnapshots.delete(props.callID)
  await toolStart(connection, toolStarts, sessionId, props.callID, ShellID.ToolID, input, props.terminalId)
}

export async function handleShellEnded(
  connection: AgentSideConnection,
  shellSnapshots: Map<string, string>,
  toolStarts: Set<string>,
  toolCalls: Map<string, ToolCallInfo>,
  sessionId: string,
  props: { callID: string; output: string },
) {
  await handleToolSuccess(connection, shellSnapshots, toolStarts, toolCalls, sessionId, {
    callID: props.callID,
    structured: { output: props.output },
    content: [],
  })
}

export async function handleToolProgress(
  connection: AgentSideConnection,
  shellSnapshots: Map<string, string>,
  toolCalls: Map<string, ToolCallInfo>,
  sessionId: string,
  props: { callID: string; structured: Record<string, unknown>; content?: V2ToolContent[] },
) {
  const info = toolCalls.get(props.callID)
  if (!info) return
  const output =
    info.tool === ShellID.ToolID
      ? (structuredShellOutput(props.structured) ?? textOutput(props.content ?? []))
      : textOutput(props.content ?? [])
  const content: ToolCallContent[] = []
  if (output) {
    const hash = Hash.fast(output)
    if (shellSnapshots.get(props.callID) === hash) {
      // Identical snapshot: re-assert progress without content (V1 wire parity).
      await connection
        .sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: props.callID,
            status: "in_progress",
            kind: toToolKind(info.tool),
            title: toolTitle(info.tool, info.input),
            locations: toLocations(info.tool, info.input),
            rawInput: info.input,
          },
        })
        .catch((error) => {
          log.error("failed to send tool in_progress to ACP", { error })
        })
      return
    }
    shellSnapshots.set(props.callID, hash)
    content.push({
      type: "content",
      content: {
        type: "text",
        text: info.tool === ShellID.ToolID ? shellContentText(output) : output,
      },
    })
  }
  await connection
    .sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: props.callID,
        status: "in_progress",
        kind: toToolKind(info.tool),
        title: toolTitle(info.tool, info.input),
        locations: toLocations(info.tool, info.input),
        rawInput: info.input,
        ...(content.length > 0 && { content }),
      },
    })
    .catch((error) => {
      log.error("failed to send tool in_progress to ACP", { error })
    })
}

export async function handleToolSuccess(
  connection: AgentSideConnection,
  shellSnapshots: Map<string, string>,
  toolStarts: Set<string>,
  toolCalls: Map<string, ToolCallInfo>,
  sessionId: string,
  props: { callID: string; structured: Record<string, unknown>; content: V2ToolContent[] },
) {
  const info = toolCalls.get(props.callID)
  if (!info) return
  toolStarts.delete(props.callID)
  shellSnapshots.delete(props.callID)
  const kind = toToolKind(info.tool)
  const output = textOutput(props.content) || (info.tool === ShellID.ToolID ? structuredShellOutput(props.structured) : undefined)
  const content = completedToolContent(info.tool, info.input, props.content, kind, output)

  if (info.tool === "todowrite") {
    const parsedTodos = decodeTodos(textOutput(props.content))
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
        toolCallId: props.callID,
        status: "completed",
        kind,
        content,
        title: toolTitle(info.tool, info.input),
        rawInput: info.input,
        rawOutput: {
          output,
          metadata: props.structured,
        },
      },
    })
    .catch((error) => {
      log.error("failed to send tool completed to ACP", { error })
    })
  toolCalls.delete(props.callID)
}

export async function handleToolFailed(
  connection: AgentSideConnection,
  shellSnapshots: Map<string, string>,
  toolStarts: Set<string>,
  toolCalls: Map<string, ToolCallInfo>,
  sessionId: string,
  props: { callID: string; error: { message: string } },
) {
  const info = toolCalls.get(props.callID)
  if (!info) return
  toolStarts.delete(props.callID)
  shellSnapshots.delete(props.callID)
  await connection
    .sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: props.callID,
        status: "failed",
        kind: toToolKind(info.tool),
        title: toolTitle(info.tool, info.input),
        rawInput: info.input,
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: props.error.message,
            },
          },
        ],
        rawOutput: {
          error: props.error.message,
          metadata: {},
        },
      },
    })
    .catch((error) => {
      log.error("failed to send tool error to ACP", { error })
    })
  toolCalls.delete(props.callID)
}

// Replay path: a projected V2 assistant tool item carries its own name and
// state, so no event registry is needed.
export async function handleToolPartUpdate(
  connection: AgentSideConnection,
  shellSnapshots: Map<string, string>,
  toolStarts: Set<string>,
  sessionId: string,
  part: SessionMessageAssistantTool,
) {
  const info: ToolCallInfo = {
    tool: part.name,
    input: part.state.status === "pending" ? {} : part.state.input,
  }
  // Ensure the pending tool_call exists before any state update (the replay
  // path has no prior `tool.called` event).
  await toolStart(connection, toolStarts, sessionId, part.id, part.name, info.input)
  switch (part.state.status) {
    case "pending":
      return

    case "running":
      await handleToolProgress(connection, shellSnapshots, new Map([[part.id, info]]), sessionId, {
        callID: part.id,
        structured: part.state.structured,
      })
      return

    case "completed":
      await handleToolSuccess(connection, shellSnapshots, toolStarts, new Map([[part.id, info]]), sessionId, {
        callID: part.id,
        structured: part.state.structured,
        content: part.state.content,
      })
      return

    case "error":
      await handleToolFailed(connection, shellSnapshots, toolStarts, new Map([[part.id, info]]), sessionId, {
        callID: part.id,
        error: part.state.error,
      })
      return
  }
}

// Replay path for V2 shell messages: the projected shell carries the command
// and final output directly (the assistant has no bash tool item in V2).
export async function handleShellMessage(
  connection: AgentSideConnection,
  sessionId: string,
  shell: { callID: string; command: string; output: string },
) {
  await connection
    .sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: shell.callID,
        title: shell.command,
        kind: toToolKind(ShellID.ToolID),
        status: "completed",
        locations: [],
        rawInput: { command: shell.command },
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: shellContentText(shell.output),
            },
          },
        ],
        rawOutput: {
          output: shell.output,
          metadata: {},
        },
      },
    })
    .catch((error) => {
      log.error("failed to send shell tool call to ACP", { error })
    })
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

export function completedToolContent(
  toolName: string,
  input: Record<string, unknown>,
  content: V2ToolContent[],
  kind: ToolKind,
  output?: string,
): ToolCallContent[] {
  const text =
    output ||
    textOutput(content) ||
    (toolName === ShellID.ToolID && typeof input.command === "string" ? `$ ${input.command}` : "")
  const result: ToolCallContent[] = [
    {
      type: "content",
      content: {
        type: "text",
        text: toolName === ShellID.ToolID ? shellContentText(text) : text,
      },
    },
  ]

  if (kind === "edit") {
    const filePath = typeof input["filePath"] === "string" ? input["filePath"] : ""
    const oldText = typeof input["oldString"] === "string" ? input["oldString"] : ""
    const newText =
      typeof input["newString"] === "string"
        ? input["newString"]
        : typeof input["content"] === "string"
          ? input["content"]
          : ""
    result.push({
      type: "diff",
      path: filePath,
      oldText,
      newText,
    })
  }

  result.push(...imageContents(content))
  return result
}

function imageContents(content: V2ToolContent[]): ToolCallContent[] {
  return content.flatMap((item): ToolCallContent[] => {
    if (item.type !== "file") return []
    const match = item.uri.match(/^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$/)
    const mime = match?.[1] ?? item.mime
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
