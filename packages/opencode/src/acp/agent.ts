import {
  RequestError,
  type Agent as ACPAgent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type AuthMethod,
  type CancelNotification,
  type CloseSessionRequest,
  type CloseSessionResponse,
  type ForkSessionRequest,
  type ForkSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type NewSessionRequest,
  type PermissionOption,
  type PromptRequest,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionInfo,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type Usage,
} from "@agentclientprotocol/sdk"

import * as Log from "@opencode-ai/core/util/log"
import { Filesystem } from "@/util/filesystem"
import { ACPSessionManager } from "./session"
import type { ACPConfig } from "./types"
import { ModelID, ProviderID } from "../provider/schema"
import { Agent as AgentModule } from "../agent/agent"
import { AppRuntime } from "@/effect/app-runtime"
import { MessageV2 } from "@/session/message-v2"
import { ConfigMCP } from "@/config/mcp"
import { LoadAPIKeyError } from "ai"
import type { AssistantMessage, Event, OpencodeClient, SessionMessageResponse, ToolPart } from "@opencode-ai/sdk/v2"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { handleToolPartUpdate, toToolKind, toLocations } from "./tool-dispatch"
import { getContextLimit, sendUsageUpdate, defaultModel, lastUsedModel } from "./model-resolution"
import { processMessage, parseUri, getNewContent } from "./message-replay"
import {
  type ModeOption,
  type ModelOption,
  sortProvidersByName,
  modelVariantsFromProviders,
  buildAvailableModels,
  formatModelIdWithVariant,
  buildVariantMeta,
  parseModelSelection,
  buildConfigOptions,
} from "./session-config"

const log = Log.create({ service: "acp-agent" })

/**
 * Maps a caught error to an ACP auth-required request error and rethrows.
 * Note: MessageV2.fromError returns a serialized plain object, so the
 * LoadAPIKeyError branch is unreachable for fromError outputs today — it is
 * preserved verbatim from the original inline catch blocks. Pinned by
 * test/acp/agent-auth-error.characterization.test.ts.
 */
export function rethrowAuthAware(e: unknown, defaultProviderID: string | undefined): never {
  const error = MessageV2.fromError(e, {
    providerID: ProviderID.make(defaultProviderID ?? "unknown"),
  })
  if (LoadAPIKeyError.isInstance(error)) {
    throw RequestError.authRequired()
  }
  throw e
}

function unwrapSyncEvent(event: any): any {
  if (event?.type !== "sync" || !event.syncEvent) return event
  const syncEvent = event.syncEvent
  // Strip version suffix: "message.part.updated.1" → "message.part.updated"
  const type = syncEvent.type.replace(/\.\d+$/, "")
  const data = syncEvent.data ?? {}
  return {
    id: syncEvent.id ?? event.id,
    type,
    properties: data,
  }
}

export function init({ sdk: _sdk }: { sdk: OpencodeClient }) {
  return {
    create: (connection: AgentSideConnection, fullConfig: ACPConfig) => {
      return new Agent(connection, fullConfig)
    },
  }
}

export class Agent implements ACPAgent {
  private connection: AgentSideConnection
  private config: ACPConfig
  private sdk: OpencodeClient
  private sessionManager: ACPSessionManager
  private eventAbort = new AbortController()
  private eventStarted = false
  private shellSnapshots = new Map<string, string>()
  private toolStarts = new Set<string>()
  private permissionQueues = new Map<string, Promise<void>>()
  private permissionOptions: PermissionOption[] = [
    { optionId: "once", kind: "allow_once", name: "Allow once" },
    { optionId: "always", kind: "allow_always", name: "Always allow" },
    { optionId: "reject", kind: "reject_once", name: "Reject" },
  ]

  constructor(connection: AgentSideConnection, config: ACPConfig) {
    this.connection = connection
    this.config = config
    this.sdk = config.sdk
    this.sessionManager = new ACPSessionManager(this.sdk)
    this.startEventSubscription()
  }

  private startEventSubscription() {
    if (this.eventStarted) return
    this.eventStarted = true
    this.runEventSubscription().catch((error) => {
      if (this.eventAbort.signal.aborted) return
      log.error("event subscription failed", { error })
    })
  }

  private async runEventSubscription() {
    while (true) {
      if (this.eventAbort.signal.aborted) return
      const events = await this.sdk.global.event({
        signal: this.eventAbort.signal,
      })
      for await (const event of events.stream) {
        if (this.eventAbort.signal.aborted) return
        const payload = event?.payload
        if (!payload) continue
        await this.handleEvent(payload as Event).catch((error) => {
          log.error("failed to handle event", { error, type: payload.type })
        })
      }
    }
  }

  private async handleEvent(rawEvent: Event) {
    const event = unwrapSyncEvent(rawEvent) as Event
    switch (event.type) {
      case "permission.asked": {
        const permission = event.properties
        const session = await this.sessionManager.tryGetOrLoad(permission.sessionID)
        if (!session) return

        const prev = this.permissionQueues.get(permission.sessionID) ?? Promise.resolve()
        const next = prev
          .then(async () => {
            const directory = session.cwd

            const res = await this.connection
              .requestPermission({
                sessionId: permission.sessionID,
                toolCall: {
                  toolCallId: permission.tool?.callID ?? permission.id,
                  status: "pending",
                  title: permission.permission,
                  rawInput: permission.metadata,
                  kind: toToolKind(permission.permission),
                  locations: toLocations(permission.permission, permission.metadata),
                },
                options: this.permissionOptions,
              })
              .catch(async (error) => {
                log.error("failed to request permission from ACP", {
                  error,
                  permissionID: permission.id,
                  sessionID: permission.sessionID,
                })
                await this.sdk.permission.reply({
                  requestID: permission.id,
                  reply: "reject",
                  directory,
                })
                return undefined
              })

            if (!res) return
            if (res.outcome.outcome !== "selected") {
              await this.sdk.permission.reply({
                requestID: permission.id,
                reply: "reject",
                directory,
              })
              return
            }

            if (res.outcome.optionId !== "reject" && permission.permission == "edit") {
              const metadata = permission.metadata || {}
              const filepath = typeof metadata["filepath"] === "string" ? metadata["filepath"] : ""
              const diff = typeof metadata["diff"] === "string" ? metadata["diff"] : ""
              const content = (await Filesystem.exists(filepath)) ? await Filesystem.readText(filepath) : ""
              const newContent = getNewContent(content, diff)

              if (newContent) {
                void this.connection.writeTextFile({
                  sessionId: session.id,
                  path: filepath,
                  content: newContent,
                })
              }
            }

            await this.sdk.permission.reply({
              requestID: permission.id,
              reply: res.outcome.optionId as "once" | "always" | "reject",
              directory,
            })
          })
          .catch((error) => {
            log.error("failed to handle permission", { error, permissionID: permission.id })
          })
          .finally(() => {
            if (this.permissionQueues.get(permission.sessionID) === next) {
              this.permissionQueues.delete(permission.sessionID)
            }
          })
        this.permissionQueues.set(permission.sessionID, next)
        return
      }

      case "message.part.updated": {
        log.info("message part updated", { event: event.properties })
        const props = event.properties
        const part = props.part
        const session = await this.sessionManager.tryGetOrLoad(part.sessionID)
        if (!session) return
        const sessionId = session.id

        if (part.type === "tool") {
          await handleToolPartUpdate(this.connection, this.shellSnapshots, this.toolStarts, sessionId, part)
          return
        }

        // ACP clients already know the prompt they just submitted, so replaying
        // live user parts duplicates the message. We still replay user history in
        // loadSession() and forkSession() via processMessage().
        if (part.type !== "text" && part.type !== "file") return

        return
      }

      case "message.part.delta": {
        const props = event.properties
        const session = await this.sessionManager.tryGetOrLoad(props.sessionID)
        if (!session) return
        const sessionId = session.id

        const message = await this.sdk.session
          .message(
            {
              sessionID: props.sessionID,
              messageID: props.messageID,
              directory: session.cwd,
            },
            { throwOnError: true },
          )
          .then((x) => x.data)
          .catch((error) => {
            log.error("unexpected error when fetching message", { error })
            return undefined
          })

        if (!message || message.info.role !== "assistant") return

        const part = message.parts.find((p) => p.id === props.partID)
        if (!part) return

        if (part.type === "text" && props.field === "text" && part.ignored !== true) {
          await this.connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                messageId: props.messageID,
                content: {
                  type: "text",
                  text: props.delta,
                },
              },
            })
            .catch((error) => {
              log.error("failed to send text delta to ACP", { error })
            })
          return
        }

        if (part.type === "reasoning" && props.field === "text") {
          await this.connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "agent_thought_chunk",
                messageId: props.messageID,
                content: {
                  type: "text",
                  text: props.delta,
                },
              },
            })
            .catch((error) => {
              log.error("failed to send reasoning delta to ACP", { error })
            })
        }
        return
      }

      case "message.part.removed": {
        // No-op: part removal doesn't need to be forwarded to ACP clients
        return
      }
    }
  }

  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    log.info("initialize", { protocolVersion: params.protocolVersion })

    const authMethod: AuthMethod = {
      description: "Run `opencode auth login` in the terminal",
      name: "Login with opencode",
      id: "opencode-login",
    }

    // If client supports terminal-auth capability, use that instead.
    if (params.clientCapabilities?._meta?.["terminal-auth"] === true) {
      authMethod._meta = {
        "terminal-auth": {
          command: "opencode",
          args: ["auth", "login"],
          label: "OpenCode Login",
        },
      }
    }

    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        mcpCapabilities: {
          http: true,
          sse: true,
        },
        promptCapabilities: {
          embeddedContext: true,
          image: true,
        },
        sessionCapabilities: {
          close: {},
          fork: {},
          list: {},
          resume: {},
        },
      },
      authMethods: [authMethod],
      agentInfo: {
        name: "OpenCode",
        version: InstallationVersion,
      },
    }
  }

  async authenticate(_params: AuthenticateRequest) {
    throw new Error("Authentication not implemented")
  }

  async newSession(params: NewSessionRequest) {
    const directory = params.cwd
    try {
      const model = await defaultModel(this.config, directory)

      // Store ACP session state
      const state = await this.sessionManager.create(params.cwd, params.mcpServers, model)
      const sessionId = state.id

      log.info("creating_session", { sessionId, mcpServers: params.mcpServers.length })

      const load = await this.loadSessionMode({
        cwd: directory,
        mcpServers: params.mcpServers,
        sessionId,
      })

      return {
        sessionId,
        configOptions: load.configOptions,
        models: load.models,
        modes: load.modes,
        _meta: load._meta,
      }
    } catch (e) {
      rethrowAuthAware(e, this.config.defaultModel?.providerID)
    }
  }

  async loadSession(params: LoadSessionRequest) {
    const directory = params.cwd
    const sessionId = params.sessionId

    try {
      const model = await defaultModel(this.config, directory)

      // Store ACP session state
      await this.sessionManager.load(sessionId, params.cwd, params.mcpServers, model)

      const messages = await this.loadSessionMessages(directory, sessionId)
      this.restoreSessionStateFromMessages(sessionId, messages)

      log.info("load_session", { sessionId, mcpServers: params.mcpServers.length })

      const result = await this.loadSessionMode({
        cwd: directory,
        mcpServers: params.mcpServers,
        sessionId,
      })

      for (const msg of messages ?? []) {
        log.debug("replay message", msg)
        await processMessage(this.connection, this.shellSnapshots, this.toolStarts, msg)
      }

      await sendUsageUpdate(this.connection, this.sdk, sessionId, directory)

      return result
    } catch (e) {
      rethrowAuthAware(e, this.config.defaultModel?.providerID)
    }
  }

  async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    try {
      const cursor = params.cursor ? Number(params.cursor) : undefined
      const limit = 100

      const sessions = await this.sdk.session
        .list(
          {
            directory: params.cwd ?? undefined,
            roots: true,
          },
          { throwOnError: true },
        )
        .then((x) => x.data ?? [])

      const sorted = sessions.toSorted((a, b) => b.time.updated - a.time.updated)
      const filtered = cursor ? sorted.filter((s) => s.time.updated < cursor) : sorted
      const page = filtered.slice(0, limit)

      const entries: SessionInfo[] = page.map((session) => ({
        sessionId: session.id,
        cwd: session.directory,
        title: session.title,
        updatedAt: new Date(session.time.updated).toISOString(),
      }))

      const last = page[page.length - 1]
      const next = filtered.length > limit && last ? String(last.time.updated) : undefined

      const response: ListSessionsResponse = {
        sessions: entries,
      }
      if (next) response.nextCursor = next
      return response
    } catch (e) {
      rethrowAuthAware(e, this.config.defaultModel?.providerID)
    }
  }

  async unstable_forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse> {
    const directory = params.cwd
    const mcpServers = params.mcpServers ?? []

    try {
      const model = await defaultModel(this.config, directory)

      const forked = await this.sdk.session
        .fork(
          {
            sessionID: params.sessionId,
            directory,
          },
          { throwOnError: true },
        )
        .then((x) => x.data)

      if (!forked) {
        throw new Error("Fork session returned no data")
      }

      const sessionId = forked.id
      await this.sessionManager.load(sessionId, directory, mcpServers, model)

      const messages = await this.loadSessionMessages(directory, sessionId)
      this.restoreSessionStateFromMessages(sessionId, messages)

      log.info("fork_session", { sessionId, mcpServers: mcpServers.length })

      const mode = await this.loadSessionMode({
        cwd: directory,
        mcpServers,
        sessionId,
      })

      for (const msg of messages ?? []) {
        log.debug("replay message", msg)
        await processMessage(this.connection, this.shellSnapshots, this.toolStarts, msg)
      }

      await sendUsageUpdate(this.connection, this.sdk, sessionId, directory)

      return mode
    } catch (e) {
      rethrowAuthAware(e, this.config.defaultModel?.providerID)
    }
  }

  async resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    const directory = params.cwd
    const sessionId = params.sessionId
    const mcpServers = params.mcpServers ?? []

    try {
      const model = await defaultModel(this.config, directory)
      await this.sessionManager.load(sessionId, directory, mcpServers, model)

      const messages = await this.loadSessionMessages(directory, sessionId, 20)
      this.restoreSessionStateFromMessages(sessionId, messages)

      log.info("resume_session", { sessionId, mcpServers: mcpServers.length })

      const result = await this.loadSessionMode({
        cwd: directory,
        mcpServers,
        sessionId,
      })

      await sendUsageUpdate(this.connection, this.sdk, sessionId, directory)

      return result
    } catch (e) {
      rethrowAuthAware(e, this.config.defaultModel?.providerID)
    }
  }

  async closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    const session = this.sessionManager.remove(params.sessionId)
    if (!session) return {}

    await this.sdk.session
      .abort(
        {
          sessionID: params.sessionId,
          directory: session.cwd,
        },
        { throwOnError: true },
      )
      .catch((error) => {
        log.error("failed to abort session while closing ACP session", { error, sessionID: params.sessionId })
      })

    this.permissionQueues.delete(params.sessionId)
    log.info("close_session", { sessionId: params.sessionId })
    return {}
  }

  private async loadAvailableModes(directory: string): Promise<ModeOption[]> {
    const agents = await this.config.sdk.app
      .agents(
        {
          directory,
        },
        { throwOnError: true },
      )
      .then((resp) => resp.data!)

    return agents
      .filter((agent) => agent.mode !== "subagent" && !agent.hidden)
      .map((agent) => ({
        id: agent.name,
        name: agent.name,
        description: agent.description,
      }))
  }

  private async resolveModeState(
    directory: string,
    sessionId: string,
  ): Promise<{ availableModes: ModeOption[]; currentModeId?: string }> {
    const availableModes = await this.loadAvailableModes(directory)
    const storedModeId = (await this.sessionManager.getOrLoad(sessionId)).modeId
    if (storedModeId && availableModes.some((mode) => mode.id === storedModeId)) {
      return { availableModes, currentModeId: storedModeId }
    }

    const currentModeId = await (async () => {
      if (!availableModes.length) return undefined
      const defaultAgentName = await AppRuntime.runPromise(AgentModule.Service.use((svc) => svc.defaultAgent()))
      const resolvedModeId = availableModes.find((mode) => mode.name === defaultAgentName)?.id ?? availableModes[0].id
      this.sessionManager.setMode(sessionId, resolvedModeId)
      return resolvedModeId
    })()

    return { availableModes, currentModeId }
  }

  private async loadSessionMode(params: LoadSessionRequest) {
    const directory = params.cwd
    const sessionId = params.sessionId
    const model = (await this.sessionManager.getOrLoad(sessionId)).model ?? (await defaultModel(this.config, directory))

    const providers = await this.sdk.config.providers({ directory }).then((x) => x.data!.providers)
    const entries = sortProvidersByName(providers)
    const availableVariants = modelVariantsFromProviders(entries, model)
    const currentVariant = this.sessionManager.getVariant(sessionId)
    if (currentVariant && !availableVariants.includes(currentVariant)) {
      this.sessionManager.setVariant(sessionId, undefined)
    }
    const availableModels = buildAvailableModels(entries)
    const modeState = await this.resolveModeState(directory, sessionId)
    const currentModeId = modeState.currentModeId
    const modes = currentModeId
      ? {
          availableModes: modeState.availableModes,
          currentModeId,
        }
      : undefined

    const commands = await this.config.sdk.command
      .list(
        {
          directory,
        },
        { throwOnError: true },
      )
      .then((resp) => resp.data!)

    const availableCommands = commands.map((command) => ({
      name: command.name,
      description: command.description ?? "",
    }))
    const names = new Set(availableCommands.map((c) => c.name))
    if (!names.has("compact"))
      availableCommands.push({
        name: "compact",
        description: "compact the session",
      })

    const mcpServers: Record<string, ConfigMCP.Info> = {}
    for (const server of params.mcpServers) {
      if ("type" in server) {
        if (server.type === "http" || server.type === "sse") {
          mcpServers[server.name] = {
            url: server.url,
            headers: server.headers.reduce<Record<string, string>>((acc, { name, value }) => {
              acc[name] = value
              return acc
            }, {}),
            type: "remote",
          }
        }
        // acp type: skip — ACP transport MCP servers are handled by the ACP channel
      } else {
        mcpServers[server.name] = {
          type: "local",
          command: [server.command, ...server.args],
          environment: server.env.reduce<Record<string, string>>((acc, { name, value }) => {
            acc[name] = value
            return acc
          }, {}),
        }
      }
    }

    await Promise.all(
      Object.entries(mcpServers).map(async ([key, mcp]) => {
        await this.sdk.mcp
          .add(
            {
              directory,
              name: key,
              config: mcp,
            },
            { throwOnError: true },
          )
          .catch((error) => {
            log.error("failed to add mcp server", { name: key, error })
          })
      }),
    )

    setTimeout(() => {
      void this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands,
        },
      })
    }, 0)

    return {
      sessionId,
      models: {
        currentModelId: formatModelIdWithVariant(model, currentVariant, availableVariants, false),
        availableModels,
      },
      modes,
      configOptions: buildConfigOptions({
        currentModelId: formatModelIdWithVariant(model, currentVariant, availableVariants, false),
        availableModels,
        currentVariant,
        availableVariants,
        modes,
      }),
      _meta: buildVariantMeta({
        model,
        variant: this.sessionManager.getVariant(sessionId),
        availableVariants,
      }),
    }
  }

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse | void> {
    const session = await this.sessionManager.getOrLoad(params.sessionId)
    const availableModes = await this.loadAvailableModes(session.cwd)
    if (!availableModes.some((mode) => mode.id === params.modeId)) {
      throw new Error(`Agent not found: ${params.modeId}`)
    }
    this.sessionManager.setMode(params.sessionId, params.modeId)
  }

  async setSessionConfigOption(params: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse> {
    const session = await this.sessionManager.getOrLoad(params.sessionId)
    const providers = await this.sdk.config
      .providers({ directory: session.cwd }, { throwOnError: true })
      .then((x) => x.data!.providers)
    const entries = sortProvidersByName(providers)

    if (params.configId === "model") {
      if (typeof params.value !== "string") throw RequestError.invalidParams("model value must be a string")
      const selection = parseModelSelection(params.value, providers)
      this.sessionManager.setModel(session.id, selection.model)
      this.sessionManager.setVariant(session.id, selection.variant)
    } else if (params.configId === "effort") {
      if (typeof params.value !== "string") throw RequestError.invalidParams("effort value must be a string")
      const current = session.model ?? (await defaultModel(this.config, session.cwd))
      const availableVariants = modelVariantsFromProviders(entries, current)
      if (!availableVariants.includes(params.value)) {
        throw RequestError.invalidParams(JSON.stringify({ error: `Effort not found: ${params.value}` }))
      }
      this.sessionManager.setVariant(session.id, params.value)
    } else if (params.configId === "mode") {
      if (typeof params.value !== "string") throw RequestError.invalidParams("mode value must be a string")
      const availableModes = await this.loadAvailableModes(session.cwd)
      if (!availableModes.some((mode) => mode.id === params.value)) {
        throw RequestError.invalidParams(JSON.stringify({ error: `Mode not found: ${params.value}` }))
      }
      this.sessionManager.setMode(session.id, params.value)
    } else {
      throw RequestError.invalidParams(JSON.stringify({ error: `Unknown config option: ${params.configId}` }))
    }

    const updatedSession = await this.sessionManager.getOrLoad(session.id)
    const model = updatedSession.model ?? (await defaultModel(this.config, session.cwd))
    const availableVariants = modelVariantsFromProviders(entries, model)
    const currentModelId = formatModelIdWithVariant(model, updatedSession.variant, availableVariants, false)
    const availableModels = buildAvailableModels(entries)
    const modeState = await this.resolveModeState(session.cwd, session.id)
    const modes = modeState.currentModeId
      ? { availableModes: modeState.availableModes, currentModeId: modeState.currentModeId }
      : undefined

    return {
      configOptions: buildConfigOptions({
        currentModelId,
        availableModels,
        currentVariant: updatedSession.variant,
        availableVariants,
        modes,
      }),
    }
  }

  async prompt(params: PromptRequest) {
    const sessionID = params.sessionId
    const session = await this.sessionManager.getOrLoad(sessionID)
    const directory = session.cwd

    const current = session.model
    const model = current ?? (await defaultModel(this.config, directory))
    if (!current) {
      this.sessionManager.setModel(session.id, model)
    }
    const agent = session.modeId ?? (await AppRuntime.runPromise(AgentModule.Service.use((svc) => svc.defaultAgent())))

    const parts: Array<
      | { type: "text"; text: string; synthetic?: boolean; ignored?: boolean }
      | { type: "file"; url: string; filename: string; mime: string }
    > = []
    for (const part of params.prompt) {
      switch (part.type) {
        case "text":
          const audience = part.annotations?.audience
          const forAssistant = audience?.length === 1 && audience[0] === "assistant"
          const forUser = audience?.length === 1 && audience[0] === "user"
          parts.push({
            type: "text" as const,
            text: part.text,
            ...(forAssistant && { synthetic: true }),
            ...(forUser && { ignored: true }),
          })
          break
        case "image": {
          const parsed = parseUri(part.uri ?? "")
          const filename = parsed.type === "file" ? parsed.filename : "image"
          if (part.data) {
            parts.push({
              type: "file",
              url: `data:${part.mimeType};base64,${part.data}`,
              filename,
              mime: part.mimeType,
            })
          } else if (part.uri && part.uri.startsWith("http:")) {
            parts.push({
              type: "file",
              url: part.uri,
              filename,
              mime: part.mimeType,
            })
          }
          break
        }

        case "resource_link":
          const parsed = parseUri(part.uri)
          // Use the name from resource_link if available
          if (part.name && parsed.type === "file") {
            parsed.filename = part.name
          }
          parts.push(parsed)

          break

        case "resource": {
          const resource = part.resource
          if ("text" in resource && resource.text) {
            parts.push({
              type: "text",
              text: resource.text,
            })
          } else if ("blob" in resource && resource.blob && resource.mimeType) {
            // Binary resource (PDFs, etc.): store as file part with data URL
            const parsed = parseUri(resource.uri ?? "")
            const filename = parsed.type === "file" ? parsed.filename : "file"
            parts.push({
              type: "file",
              url: `data:${resource.mimeType};base64,${resource.blob}`,
              filename,
              mime: resource.mimeType,
            })
          }
          break
        }

        default:
          break
      }
    }

    log.info("parts", { parts })

    const cmd = (() => {
      const text = parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("")
        .trim()

      if (!text.startsWith("/")) return

      const [name, ...rest] = text.slice(1).split(/\s+/)
      return { name, args: rest.join(" ").trim() }
    })()

    const buildUsage = (msg: AssistantMessage): Usage => ({
      totalTokens:
        msg.tokens.input +
        msg.tokens.output +
        msg.tokens.reasoning +
        (msg.tokens.cache?.read ?? 0) +
        (msg.tokens.cache?.write ?? 0),
      inputTokens: msg.tokens.input,
      outputTokens: msg.tokens.output,
      thoughtTokens: msg.tokens.reasoning || undefined,
      cachedReadTokens: msg.tokens.cache?.read || undefined,
      cachedWriteTokens: msg.tokens.cache?.write || undefined,
    })

    if (!cmd) {
      const response = await this.sdk.session.prompt({
        sessionID,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
        },
        variant: this.sessionManager.getVariant(sessionID),
        parts,
        agent,
        directory,
      })
      const msg = response.data?.info

      await sendUsageUpdate(this.connection, this.sdk, sessionID, directory)

      return {
        stopReason: "end_turn" as const,
        usage: msg ? buildUsage(msg) : undefined,
        _meta: {},
      }
    }

    const command = await this.config.sdk.command
      .list({ directory }, { throwOnError: true })
      .then((x) => x.data!.find((c) => c.name === cmd.name))
    if (command) {
      const response = await this.sdk.session.command({
        sessionID,
        command: command.name,
        arguments: cmd.args,
        model: model.providerID + "/" + model.modelID,
        agent,
        directory,
      })
      const msg = response.data?.info

      await sendUsageUpdate(this.connection, this.sdk, sessionID, directory)

      return {
        stopReason: "end_turn" as const,
        usage: msg ? buildUsage(msg) : undefined,
        _meta: {},
      }
    }

    switch (cmd.name) {
      case "compact":
        await this.config.sdk.v2.session.summarize(
          {
            sessionID,
            directory,
            providerID: model.providerID,
            modelID: model.modelID,
          },
          { throwOnError: true },
        )
        break
    }

    await sendUsageUpdate(this.connection, this.sdk, sessionID, directory)

    return {
      stopReason: "end_turn" as const,
      _meta: {},
    }
  }

  async cancel(params: CancelNotification) {
    const session = await this.sessionManager.getOrLoad(params.sessionId)
    await this.config.sdk.v2.session.abort(
      {
        sessionID: params.sessionId,
        directory: session.cwd,
      },
      { throwOnError: true },
    )
  }

  private async loadSessionMessages(directory: string, sessionId: string, limit?: number) {
    return this.sdk.session
      .messages(
        {
          sessionID: sessionId,
          directory,
          limit,
        },
        { throwOnError: true },
      )
      .then((x) => x.data)
      .catch((error) => {
        log.error("unexpected error when fetching message", { error })
        return undefined
      })
  }

  private restoreSessionStateFromMessages(sessionId: string, messages: SessionMessageResponse[] | undefined) {
    const lastUser = messages?.findLast((message) => message.info.role === "user")?.info
    if (lastUser?.role !== "user") return

    this.sessionManager.setModel(sessionId, {
      providerID: ProviderID.make(lastUser.model.providerID),
      modelID: ModelID.make(lastUser.model.modelID),
    })
    this.sessionManager.setVariant(sessionId, lastUser.model.variant)
    if (lastUser.agent) {
      this.sessionManager.setMode(sessionId, lastUser.agent)
    }
  }
}


export * as ACP from "./agent"
