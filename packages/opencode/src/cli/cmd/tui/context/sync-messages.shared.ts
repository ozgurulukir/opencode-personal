import type {
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  Event,
} from "@opencode-ai/sdk/v2"

/**
 * The session.next.* events that mutate per-session message state. Extracted
 * verbatim from the former inline switch in sync.tsx so the state machine can
 * be tested directly (no render fixture) and later unified with the server
 * updater's Adapter seam.
 *
 * Deliberately narrower than the server-side SessionMessageUpdater: no
 * `metadata`/`LEGACY_MESSAGE_ID` bookkeeping, no attachment derivation on
 * tool.success, and no agent/model.switched cases — preserving the exact TUI
 * behavior this module was extracted from.
 */
export type MessageSyncEvent = Extract<Event, { type: `session.next.${string}` }>

// V2 event timestamps are declared as epoch millis on the wire and
// SyncEvent.process now encodes DateTime instances to millis at publish.
// Kept as a cheap normalizer because legacy EventTable rows (experimental
// workspaces replay) still carry ISO strings from before that fix.
function eventTime(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Date.parse(value)
  if (value && typeof value === "object" && "epochMilliseconds" in value)
    return (value as { epochMilliseconds: number }).epochMilliseconds
  return Date.now()
}

function activeAssistant(messages: SessionMessage[]) {
  const index = messages.findIndex((message) => message.type === "assistant" && !message.time.completed)
  if (index < 0) return
  const assistant = messages[index]
  return assistant?.type === "assistant" ? assistant : undefined
}

function activeCompaction(messages: SessionMessage[]) {
  const index = messages.findIndex((message) => message.type === "compaction")
  if (index < 0) return
  const compaction = messages[index]
  return compaction?.type === "compaction" ? compaction : undefined
}

function activeShell(messages: SessionMessage[], callID: string) {
  const index = messages.findIndex((message) => message.type === "shell" && message.callID === callID)
  if (index < 0) return
  const shell = messages[index]
  return shell?.type === "shell" ? shell : undefined
}

function latestTool(assistant: SessionMessageAssistant | undefined, callID?: string) {
  return assistant?.content.findLast(
    (item): item is SessionMessageAssistantTool => item.type === "tool" && (callID === undefined || item.id === callID),
  )
}

function latestText(assistant: SessionMessageAssistant | undefined) {
  return assistant?.content.findLast((item): item is SessionMessageAssistantText => item.type === "text")
}

function latestReasoning(assistant: SessionMessageAssistant | undefined, reasoningID: string) {
  return assistant?.content.findLast(
    (item): item is SessionMessageAssistantReasoning => item.type === "reasoning" && item.id === reasoningID,
  )
}

/**
 * Applies one message-state event to the session's message slice **in place**
 * (newest-first ordering, matching the V2 read model). The caller owns the
 * array — a SolidJS store draft — so mutation must stay side-effect free
 * beyond it. Unknown event types are ignored.
 */
export function reduceMessageEvent(messages: SessionMessage[], event: MessageSyncEvent): void {
  switch (event.type) {
    case "session.next.prompted": {
      messages.unshift({
        id: event.id,
        type: "user",
        text: event.properties.prompt.text,
        files: event.properties.prompt.files,
        agents: event.properties.prompt.agents,
        subtask: event.properties.prompt.subtask,
        agent: event.properties.agent,
        model: event.properties.model,
        time: { created: eventTime(event.properties.timestamp) },
      })
      break
    }
    case "session.next.synthetic": {
      messages.unshift({
        id: event.id,
        type: "synthetic",
        sessionID: event.properties.sessionID,
        text: event.properties.text,
        time: { created: eventTime(event.properties.timestamp) },
      })
      break
    }
    case "session.next.shell.started": {
      messages.unshift({
        id: event.id,
        type: "shell",
        callID: event.properties.callID,
        command: event.properties.command,
        output: "",
        time: { created: eventTime(event.properties.timestamp) },
      })
      break
    }
    case "session.next.shell.ended": {
      const match = activeShell(messages, event.properties.callID)
      if (!match) return
      match.output = event.properties.output
      match.time.completed = eventTime(event.properties.timestamp)
      break
    }
    case "session.next.step.started": {
      const currentAssistant = activeAssistant(messages)
      if (currentAssistant) currentAssistant.time.completed = eventTime(event.properties.timestamp)
      messages.unshift({
        id: event.id,
        type: "assistant",
        agent: event.properties.agent,
        model: event.properties.model,
        content: [],
        snapshot: event.properties.snapshot ? { start: event.properties.snapshot } : undefined,
        time: { created: eventTime(event.properties.timestamp) },
      })
      break
    }
    case "session.next.step.ended": {
      const currentAssistant = activeAssistant(messages)
      if (!currentAssistant) return
      currentAssistant.time.completed = eventTime(event.properties.timestamp)
      currentAssistant.finish = event.properties.finish
      currentAssistant.cost = event.properties.cost
      currentAssistant.tokens = event.properties.tokens
      if (event.properties.snapshot)
        currentAssistant.snapshot = { ...currentAssistant.snapshot, end: event.properties.snapshot }
      break
    }
    case "session.next.step.failed": {
      const currentAssistant = activeAssistant(messages)
      if (!currentAssistant) return
      currentAssistant.time.completed = eventTime(event.properties.timestamp)
      currentAssistant.finish = "error"
      currentAssistant.error = event.properties.error
      break
    }
    case "session.next.text.started": {
      activeAssistant(messages)?.content.push({ type: "text", text: "" })
      break
    }
    case "session.next.text.delta": {
      const match = latestText(activeAssistant(messages))
      if (match) match.text += event.properties.delta
      break
    }
    case "session.next.text.ended": {
      const match = latestText(activeAssistant(messages))
      if (match) match.text = event.properties.text
      break
    }
    case "session.next.tool.input.started": {
      activeAssistant(messages)?.content.push({
        type: "tool",
        id: event.properties.callID,
        name: event.properties.name,
        time: { created: eventTime(event.properties.timestamp) },
        state: { status: "pending", input: "" },
      })
      break
    }
    case "session.next.tool.input.delta": {
      const match = latestTool(activeAssistant(messages), event.properties.callID)
      if (match?.state.status === "pending") match.state.input += event.properties.delta
      break
    }
    case "session.next.tool.called": {
      const match = latestTool(activeAssistant(messages), event.properties.callID)
      if (!match) return
      match.time.ran = eventTime(event.properties.timestamp)
      match.provider = event.properties.provider
      match.state = { status: "running", input: event.properties.input, structured: {}, content: [] }
      break
    }
    case "session.next.tool.progress": {
      const match = latestTool(activeAssistant(messages), event.properties.callID)
      if (match?.state.status !== "running") return
      match.state.structured = event.properties.structured
      match.state.content = [...event.properties.content]
      break
    }
    case "session.next.tool.success": {
      const match = latestTool(activeAssistant(messages), event.properties.callID)
      if (match?.state.status !== "running") return
      match.state = {
        status: "completed",
        input: match.state.input,
        structured: event.properties.structured,
        content: [...event.properties.content],
      }
      match.provider = event.properties.provider
      match.time.completed = eventTime(event.properties.timestamp)
      break
    }
    case "session.next.tool.failed": {
      const match = latestTool(activeAssistant(messages), event.properties.callID)
      if (match?.state.status !== "running") return
      match.state = {
        status: "error",
        error: event.properties.error,
        input: match.state.input,
        structured: match.state.structured,
        content: match.state.content,
      }
      match.provider = event.properties.provider
      match.time.completed = eventTime(event.properties.timestamp)
      break
    }
    case "session.next.reasoning.started": {
      activeAssistant(messages)?.content.push({
        type: "reasoning",
        id: event.properties.reasoningID,
        text: "",
      })
      break
    }
    case "session.next.reasoning.delta": {
      const match = latestReasoning(activeAssistant(messages), event.properties.reasoningID)
      if (match) match.text += event.properties.delta
      break
    }
    case "session.next.reasoning.ended": {
      const match = latestReasoning(activeAssistant(messages), event.properties.reasoningID)
      if (match) match.text = event.properties.text
      break
    }
    case "session.next.compaction.started": {
      messages.unshift({
        id: event.id,
        type: "compaction",
        reason: event.properties.reason,
        summary: "",
        time: { created: eventTime(event.properties.timestamp) },
      })
      break
    }
    case "session.next.compaction.delta": {
      const match = activeCompaction(messages)
      if (match) match.summary += event.properties.text
      break
    }
    case "session.next.compaction.ended": {
      const match = activeCompaction(messages)
      if (!match) return
      match.summary = event.properties.text
      match.include = event.properties.include
      break
    }
  }
}
