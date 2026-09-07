import type { Message, Session } from "@opencode-ai/sdk/v2/client"
import { batch } from "solid-js"
import { type ContextItem, type ImageAttachmentPart, type Prompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useSync } from "@/context/sync"
import { Identifier } from "@/utils/id"
import { buildRequestParts } from "./build-request-parts"
import { detectCommand } from "./detectCommand"
import { optimisticAdd, optimisticRemove } from "./useOptimisticSend"

export type FollowupDraft = {
  sessionID: string
  sessionDirectory: string
  prompt: Prompt
  context: (ContextItem & { key: string })[]
  agent: string
  model: { providerID: string; modelID: string }
  variant?: string
}

export type FollowupSendInput = {
  client: ReturnType<typeof useSDK>["client"]
  globalSync: ReturnType<typeof useGlobalSync>
  sync: ReturnType<typeof useSync>
  draft: FollowupDraft
  messageID?: string
  optimisticBusy?: boolean
  before?: () => Promise<boolean> | boolean
}

const draftText = (prompt: Prompt) => prompt.map((part) => ("content" in part ? part.content : "")).join("")

const draftImages = (prompt: Prompt) => prompt.filter((part): part is ImageAttachmentPart => part.type === "image")

export async function sendFollowupDraft(input: FollowupSendInput) {
  const text = draftText(input.draft.prompt)
  const images = draftImages(input.draft.prompt)
  const [, setStore] = input.globalSync.child(input.draft.sessionDirectory)

  const setBusy = () => {
    if (!input.optimisticBusy) return
    setStore("session_status", input.draft.sessionID, { type: "busy" })
  }

  const setIdle = () => {
    if (!input.optimisticBusy) return
    setStore("session_status", input.draft.sessionID, { type: "idle" })
  }

  const wait = async () => {
    const ok = await input.before?.()
    if (ok === false) return false
    return true
  }

  const cmd = detectCommand(text, input.sync.data.command)
  if (cmd) {
    setBusy()
    try {
      if (!(await wait())) {
        setIdle()
        return false
      }

      await input.client.v2.session.command({
        sessionID: input.draft.sessionID,
        command: cmd.name,
        arguments: cmd.arguments,
        agent: input.draft.agent,
        model: `${input.draft.model.providerID}/${input.draft.model.modelID}`,
        variant: input.draft.variant,
        parts: images.map((attachment) => ({
          id: Identifier.ascending("part"),
          type: "file" as const,
          mime: attachment.mime,
          url: attachment.dataUrl,
          filename: attachment.filename,
        })),
      })
      return true
    } catch (err) {
      setIdle()
      throw err
    }
  }

  const messageID = input.messageID ?? Identifier.ascending("message")
  const { requestParts, optimisticParts } = buildRequestParts({
    prompt: input.draft.prompt,
    context: input.draft.context,
    images,
    text,
    sessionID: input.draft.sessionID,
    messageID,
    sessionDirectory: input.draft.sessionDirectory,
  })

  const message: Message = {
    id: messageID,
    sessionID: input.draft.sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: input.draft.agent,
    model: { ...input.draft.model, variant: input.draft.variant },
  }

  batch(() => {
    setBusy()
    optimisticAdd(input.sync, input.draft.sessionDirectory, input.draft.sessionID, message, optimisticParts)
  })

  try {
    if (!(await wait())) {
      batch(() => {
        setIdle()
        optimisticRemove(input.sync, input.draft.sessionDirectory, input.draft.sessionID, messageID)
      })
      return false
    }

    await input.client.v2.session.promptAsync({
      sessionID: input.draft.sessionID,
      agent: input.draft.agent,
      model: input.draft.model,
      messageID,
      parts: requestParts,
      variant: input.draft.variant,
    })
    return true
  } catch (err) {
    batch(() => {
      setIdle()
      optimisticRemove(input.sync, input.draft.sessionDirectory, input.draft.sessionID, messageID)
    })
    throw err
  }
}
