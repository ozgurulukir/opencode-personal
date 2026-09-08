// Event loop for the non-interactive `opencode run` mode.
//
// Consumes one subscribed event stream for the active session and mirrors it
// to stdout/UI. Each event type has a dedicated handler function, and the
// `loop` function orchestrates them.
import { EOL } from "os"
import { UI } from "../../ui"
import type { Part } from "@opencode-ai/sdk/v2"
import type { LoopContext } from "./types"
import { createV2EventAdapter, isMigratedLegacyEvent } from "./v2-legacy"

function handleMessageUpdated(
  ctx: LoopContext,
  event: { properties: { sessionID: string; info: { role: string; agent: string; modelID: string } } },
) {
  if (
    event.properties.sessionID === ctx.sessionID &&
    event.properties.info.role === "assistant" &&
    ctx.args.format !== "json" &&
    ctx.toggles.get("start") !== true
  ) {
    UI.empty()
    UI.println(`> ${event.properties.info.agent} · ${event.properties.info.modelID}`)
    UI.empty()
    ctx.toggles.set("start", true)
  }
}

function handleToolPart(
  ctx: LoopContext,
  part: Part,
) {
  if (part.sessionID !== ctx.sessionID) return

  if (part.type === "tool") {
    if (part.state.status === "completed" || part.state.status === "error") {
      if (ctx.emit("tool_use", { part })) return
      if (part.state.status === "completed") {
        ctx.tool(part)
        return
      }
      ctx.toolError(part)
      UI.error(part.state.error)
    }

    if (part.tool === "task" && part.state.status === "running" && ctx.args.format !== "json") {
      if (ctx.toggles.get(part.id) === true) return
      ctx.tool(part)
      ctx.toggles.set(part.id, true)
    }
    return
  }

  if (part.type === "step-start") {
    ctx.emit("step_start", { part })
    return
  }

  if (part.type === "step-finish") {
    ctx.emit("step_finish", { part })
    return
  }

  if (part.type === "text" && part.time?.end) {
    if (ctx.emit("text", { part })) return
    const text = part.text.trim()
    if (!text) return
    if (!process.stdout.isTTY) {
      process.stdout.write(text + EOL)
      return
    }
    UI.empty()
    UI.println(text)
    UI.empty()
    return
  }

  if (part.type === "reasoning" && part.time?.end && ctx.args.thinking) {
    if (ctx.emit("reasoning", { part })) return
    const text = part.text.trim()
    if (!text) return
    const line = `Thinking: ${text}`
    if (process.stdout.isTTY) {
      UI.empty()
      UI.println(`${UI.Style.TEXT_DIM}\u001b[3m${line}\u001b[0m${UI.Style.TEXT_NORMAL}`)
      UI.empty()
      return
    }
    process.stdout.write(line + EOL)
  }
}

function handleSessionError(
  ctx: LoopContext,
  props: { sessionID?: string; error?: { name: string; message?: string; data?: { message?: string } } },
  error: string | undefined,
): string | undefined {
  if (props.sessionID !== ctx.sessionID || !props.error) return error
  // Error is a discriminated union keyed by "name":
  //   "APIError" / "AbortedError" / etc. → message field
  //   "UnknownError" → data.message field
  const err = props.error.message ?? props.error.data?.message ?? props.error.name
  const next = error ? error + EOL + err : err
  if (ctx.emit("error", { error: props.error })) return next
  UI.error(err)
  return next
}

function handleSessionStatus(
  ctx: LoopContext,
  props: { sessionID: string; status: { type: string } },
): boolean {
  return props.sessionID === ctx.sessionID && props.status.type === "idle"
}

async function handlePermissionAsked(
  ctx: LoopContext,
  permission: { id: string; sessionID: string; permission: string; patterns: string[] },
) {
  if (permission.sessionID !== ctx.sessionID) return

  if (ctx.args["dangerously-skip-permissions"]) {
    await ctx.client.permission.reply({
      requestID: permission.id,
      reply: "once",
    })
  } else {
    UI.println(
      UI.Style.TEXT_WARNING_BOLD + "!",
      UI.Style.TEXT_NORMAL +
        `permission requested: ${permission.permission} (${permission.patterns.join(", ")}); auto-rejecting`,
    )
    await ctx.client.permission.reply({
      requestID: permission.id,
      reply: "reject",
    })
  }
}

// Consume one subscribed event stream for the active session and mirror it
// to stdout/UI.
export async function loop(
  ctx: LoopContext,
  events: { stream: AsyncIterable<{ type: string; properties: Record<string, unknown> }> },
  options: { native?: boolean } = {},
) {
  let error: string | undefined
  const adapter = createV2EventAdapter()

  for await (const rawEvent of events.stream) {
    const sessionID = rawEvent.properties.sessionID
    if (options.native && isMigratedLegacyEvent(rawEvent.type) && typeof sessionID === "string") {
      continue
    }

    for (const event of adapter.adapt(rawEvent as unknown as Parameters<typeof adapter.adapt>[0])) {
      if (event.type === "message.updated") {
        handleMessageUpdated(ctx, event as unknown as Parameters<typeof handleMessageUpdated>[1])
      }

      if (event.type === "message.part.updated") {
        const part = (event.properties as { part: Part }).part
        handleToolPart(ctx, part)
      }

      if (event.type === "session.error") {
        const props = event.properties as Parameters<typeof handleSessionError>[1]
        error = handleSessionError(ctx, props, error)
      }

      if (event.type === "session.status") {
        const props = event.properties as { sessionID: string; status: { type: string } }
        if (handleSessionStatus(ctx, props)) {
          return
        }
      }

      if (event.type === "permission.asked") {
        const permission = event.properties as Parameters<typeof handlePermissionAsked>[1]
        await handlePermissionAsked(ctx, permission)
      }
    }
  }
}
