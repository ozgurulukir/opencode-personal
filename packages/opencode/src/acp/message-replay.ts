import * as Log from "@opencode-ai/core/util/log"
import { pathToFileURL } from "url"
import { applyPatch } from "diff"
import type { AgentSideConnection, Role } from "@agentclientprotocol/sdk"
import type { SessionMessageResponse, ToolPart } from "@opencode-ai/sdk/v2"
import { handleToolPartUpdate } from "./tool-dispatch"

const log = Log.create({ service: "acp-message-replay" })

export async function processMessage(
  connection: AgentSideConnection,
  shellSnapshots: Map<string, string>,
  toolStarts: Set<string>,
  message: SessionMessageResponse,
) {
  log.debug("process message", message)
  if (message.info.role !== "assistant" && message.info.role !== "user") return
  const sessionId = message.info.sessionID

  for (const part of message.parts) {
    if (part.type === "tool") {
      await handleToolPartUpdate(connection, shellSnapshots, toolStarts, sessionId, part as ToolPart)
    } else if (part.type === "text") {
      if (part.text) {
        const audience: Role[] | undefined = part.synthetic ? ["assistant"] : part.ignored ? ["user"] : undefined
        await connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk",
              messageId: message.info.id,
              content: {
                type: "text",
                text: part.text,
                ...(audience && { annotations: { audience } }),
              },
            },
          })
          .catch((err) => {
            log.error("failed to send text to ACP", { error: err })
          })
      }
    } else if (part.type === "file") {
      const url = part.url
      const filename = part.filename ?? "file"
      const mime = part.mime || "application/octet-stream"
      const messageChunk = message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk"

      if (url.startsWith("file://")) {
        await connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: messageChunk,
              messageId: message.info.id,
              content: { type: "resource_link", uri: url, name: filename, mimeType: mime },
            },
          })
          .catch((err) => {
            log.error("failed to send resource_link to ACP", { error: err })
          })
      } else if (url.startsWith("data:")) {
        const base64Match = url.match(/^data:([^;]+);base64,(.*)$/)
        const dataMime = base64Match?.[1]
        const base64Data = base64Match?.[2] ?? ""
        const effectiveMime = dataMime || mime

        if (effectiveMime.startsWith("image/")) {
          await connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: messageChunk,
                messageId: message.info.id,
                content: {
                  type: "image",
                  mimeType: effectiveMime,
                  data: base64Data,
                  uri: pathToFileURL(filename).href,
                },
              },
            })
            .catch((err) => {
              log.error("failed to send image to ACP", { error: err })
            })
        } else {
          const isText = effectiveMime.startsWith("text/") || effectiveMime === "application/json"
          const fileUri = pathToFileURL(filename).href
          const resource = isText
            ? {
                uri: fileUri,
                mimeType: effectiveMime,
                text: Buffer.from(base64Data, "base64").toString("utf-8"),
              }
            : { uri: fileUri, mimeType: effectiveMime, blob: base64Data }

          await connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: messageChunk,
                messageId: message.info.id,
                content: { type: "resource", resource },
              },
            })
            .catch((err) => {
              log.error("failed to send resource to ACP", { error: err })
            })
        }
      }
    } else if (part.type === "reasoning") {
      if (part.text) {
        await connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "agent_thought_chunk",
              messageId: message.info.id,
              content: {
                type: "text",
                text: part.text,
              },
            },
          })
          .catch((err) => {
            log.error("failed to send reasoning to ACP", { error: err })
          })
      }
    }
  }
}

export function parseUri(
  uri: string,
): { type: "file"; url: string; filename: string; mime: string } | { type: "text"; text: string } {
  try {
    if (uri.startsWith("file://")) {
      const path = uri.slice(7)
      const name = path.split("/").pop() || path
      return {
        type: "file",
        url: uri,
        filename: name,
        mime: "text/plain",
      }
    }
    if (uri.startsWith("zed://")) {
      const url = new URL(uri)
      const path = url.searchParams.get("path")
      if (path) {
        const name = path.split("/").pop() || path
        return {
          type: "file",
          url: pathToFileURL(path).href,
          filename: name,
          mime: "text/plain",
        }
      }
    }
    return {
      type: "text",
      text: uri,
    }
  } catch {
    return {
      type: "text",
      text: uri,
    }
  }
}

export function getNewContent(fileOriginal: string, unifiedDiff: string): string | undefined {
  const result = applyPatch(fileOriginal, unifiedDiff)
  if (result === false) {
    log.error("Failed to apply unified diff (context mismatch)")
    return undefined
  }
  return result
}
