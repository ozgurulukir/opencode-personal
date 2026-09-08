import * as Log from "@opencode-ai/core/util/log"
import { pathToFileURL } from "url"
import { applyPatch } from "@opencode-ai/diff-wasm"
import type { AgentSideConnection, Role } from "@agentclientprotocol/sdk"
import type { SessionMessage, SessionMessageUser } from "@opencode-ai/sdk/v2"
import { handleShellMessage, handleToolPartUpdate } from "./tool-dispatch"

const log = Log.create({ service: "acp-message-replay" })

export async function processMessage(
  connection: AgentSideConnection,
  shellSnapshots: Map<string, string>,
  toolStarts: Set<string>,
  sessionId: string,
  message: SessionMessage,
) {
  log.debug("process message", message)
  if (message.type === "user") {
    await replayUser(connection, sessionId, message)
    return
  }
  if (message.type === "assistant") {
    for (const item of message.content) {
      if (item.type === "tool") {
        await handleToolPartUpdate(connection, shellSnapshots, toolStarts, sessionId, item)
      } else if (item.type === "text") {
        if (item.text) {
          await connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                messageId: message.id,
                content: {
                  type: "text",
                  text: item.text,
                },
              },
            })
            .catch((err) => {
              log.error("failed to send text to ACP", { error: err })
            })
        }
      } else if (item.type === "reasoning") {
        if (item.text) {
          await connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "agent_thought_chunk",
                messageId: message.id,
                content: {
                  type: "text",
                  text: item.text,
                },
              },
            })
            .catch((err) => {
              log.error("failed to send reasoning to ACP", { error: err })
            })
        }
      }
    }
    return
  }
  if (message.type === "shell") {
    await handleShellMessage(connection, sessionId, message)
    return
  }
  // synthetic / compaction / agent-switched / model-switched: nothing to replay
}

async function replayUser(connection: AgentSideConnection, sessionId: string, message: SessionMessageUser) {
  if (message.text) {
    await connection
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: message.id,
          content: {
            type: "text",
            text: message.text,
          },
        },
      })
      .catch((err) => {
        log.error("failed to send user text to ACP", { error: err })
      })
  }

  for (const file of message.files ?? []) {
    const url = file.uri
    const filename = file.name ?? "file"
    const mime = file.mime || "application/octet-stream"

    if (url.startsWith("file://")) {
      await connection
        .sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            messageId: message.id,
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
              sessionUpdate: "user_message_chunk",
              messageId: message.id,
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
              sessionUpdate: "user_message_chunk",
              messageId: message.id,
              content: { type: "resource", resource },
            },
          })
          .catch((err) => {
            log.error("failed to send resource to ACP", { error: err })
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
