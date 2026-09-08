import { RequestError, type McpServer } from "@agentclientprotocol/sdk"
import type { ACPSessionState } from "./types"
import * as Log from "@opencode-ai/core/util/log"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

const log = Log.create({ service: "acp-session-manager" })

export class ACPSessionManager {
  private sessions = new Map<string, ACPSessionState>()
  private pendingLoads = new Map<string, Promise<ACPSessionState>>()
  private sdk: OpencodeClient

  constructor(sdk: OpencodeClient) {
    this.sdk = sdk
  }

  tryGet(sessionId: string): ACPSessionState | undefined {
    return this.sessions.get(sessionId)
  }

  async getOrLoad(sessionId: string): Promise<ACPSessionState> {
    const cached = this.sessions.get(sessionId)
    if (cached) return cached

    const pending = this.pendingLoads.get(sessionId)
    if (pending) return pending

    const loadPromise = this.loadFromServer(sessionId)
    this.pendingLoads.set(sessionId, loadPromise)
    try {
      const session = await loadPromise
      return session
    } finally {
      this.pendingLoads.delete(sessionId)
    }
  }

  async tryGetOrLoad(sessionId: string): Promise<ACPSessionState | undefined> {
    const cached = this.sessions.get(sessionId)
    if (cached) return cached

    try {
      return await this.getOrLoad(sessionId)
    } catch {
      return undefined
    }
  }

  private async loadFromServer(sessionId: string): Promise<ACPSessionState> {
    const session = await this.sdk.v2.session
      .get({ sessionID: sessionId }, { throwOnError: true })
      .then((x) => x.data!)

    const state: ACPSessionState = {
      id: sessionId,
      cwd: session.directory,
      mcpServers: [],
      createdAt: new Date(session.time.created),
    }
    log.info("auto_loaded_session", { sessionId, directory: state.cwd })
    this.sessions.set(sessionId, state)
    return state
  }

  async create(cwd: string, mcpServers: McpServer[], model?: ACPSessionState["model"]): Promise<ACPSessionState> {
    const session = await this.sdk.v2.session
      .create(
        {
          directory: cwd,
        },
        { throwOnError: true },
      )
      .then((x) => x.data!)

    const sessionId = session.id
    const resolvedModel = model

    const state: ACPSessionState = {
      id: sessionId,
      cwd,
      mcpServers,
      createdAt: new Date(),
      model: resolvedModel,
    }
    log.info("creating_session", { state })

    this.sessions.set(sessionId, state)
    return state
  }

  async load(
    sessionId: string,
    cwd: string,
    mcpServers: McpServer[],
    model?: ACPSessionState["model"],
  ): Promise<ACPSessionState> {
    const session = await this.sdk.v2.session
      .get(
        {
          sessionID: sessionId,
          directory: cwd,
        },
        { throwOnError: true },
      )
      .then((x) => x.data!)

    const resolvedModel = model

    const state: ACPSessionState = {
      id: sessionId,
      cwd,
      mcpServers,
      createdAt: new Date(session.time.created),
      model: resolvedModel,
    }
    log.info("loading_session", { state })

    this.sessions.set(sessionId, state)
    return state
  }

  get(sessionId: string): ACPSessionState {
    const session = this.sessions.get(sessionId)
    if (!session) {
      log.error("session not found", { sessionId })
      throw RequestError.invalidParams(JSON.stringify({ error: `Session not found: ${sessionId}` }))
    }
    return session
  }

  getModel(sessionId: string) {
    const session = this.get(sessionId)
    return session.model
  }

  setModel(sessionId: string, model: ACPSessionState["model"]) {
    const session = this.get(sessionId)
    session.model = model
    this.sessions.set(sessionId, session)
    return session
  }

  getVariant(sessionId: string) {
    const session = this.get(sessionId)
    return session.variant
  }

  setVariant(sessionId: string, variant?: string) {
    const session = this.get(sessionId)
    session.variant = variant
    this.sessions.set(sessionId, session)
    return session
  }

  setMode(sessionId: string, modeId: string) {
    const session = this.get(sessionId)
    session.modeId = modeId
    this.sessions.set(sessionId, session)
    return session
  }

  remove(sessionId: string): ACPSessionState | undefined {
    const session = this.sessions.get(sessionId)
    this.sessions.delete(sessionId)
    return session
  }
}
