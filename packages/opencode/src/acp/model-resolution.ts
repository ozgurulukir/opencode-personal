import * as Log from "@opencode-ai/core/util/log"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { OpencodeClient, AssistantMessage, SessionMessageResponse } from "@opencode-ai/sdk/v2"
import { ProviderID, ModelID } from "../provider/schema"
import { Provider } from "@/provider/provider"
import type { ACPConfig } from "./types"

const log = Log.create({ service: "acp-model-resolution" })

export async function getContextLimit(
  sdk: OpencodeClient,
  providerID: ProviderID,
  modelID: ModelID,
  directory: string,
): Promise<number | null> {
  const providers = await sdk.config
    .providers({ directory })
    .then((x) => x.data?.providers ?? [])
    .catch((error) => {
      log.error("failed to get providers for context limit", { error })
      return []
    })

  const provider = providers.find((p) => p.id === providerID)
  const model = provider?.models[modelID]
  return model?.limit?.context ?? null
}

export async function sendUsageUpdate(
  connection: AgentSideConnection,
  sdk: OpencodeClient,
  sessionID: string,
  directory: string,
): Promise<void> {
  const messages = await sdk.session
    .messages({ sessionID, directory }, { throwOnError: true })
    .then((x) => x.data)
    .catch((error) => {
      log.error("failed to fetch messages for usage update", { error })
      return undefined
    })

  if (!messages) return

  const assistantMessages = messages.filter(
    (m): m is { info: AssistantMessage; parts: SessionMessageResponse["parts"] } => m.info.role === "assistant",
  )

  const lastAssistant = assistantMessages[assistantMessages.length - 1]
  if (!lastAssistant) return

  const msg = lastAssistant.info
  if (!msg.providerID || !msg.modelID) return
  const size = await getContextLimit(sdk, ProviderID.make(msg.providerID), ModelID.make(msg.modelID), directory)

  if (!size) {
    // Cannot calculate usage without known context size
    return
  }

  const used = msg.tokens.input + (msg.tokens.cache?.read ?? 0)
  const totalCost = assistantMessages.reduce((sum, m) => sum + m.info.cost, 0)

  await connection
    .sessionUpdate({
      sessionId: sessionID,
      update: {
        sessionUpdate: "usage_update",
        used,
        size,
        cost: { amount: totalCost, currency: "USD" },
      },
    })
    .catch((error) => {
      log.error("failed to send usage update", { error })
    })
}

export async function defaultModel(
  config: ACPConfig,
  cwd?: string,
): Promise<{ providerID: ProviderID; modelID: ModelID }> {
  const sdk = config.sdk
  const configured = config.defaultModel
  if (configured) return configured

  const directory = cwd ?? process.cwd()

  const specified = await sdk.config
    .get({ directory }, { throwOnError: true })
    .then((resp) => {
      const cfg = resp.data
      if (!cfg || !cfg.model) return undefined
      return Provider.parseModel(cfg.model)
    })
    .catch((error) => {
      log.error("failed to load user config for default model", { error })
      return undefined
    })

  const providers = await sdk.config
    .providers({ directory }, { throwOnError: true })
    .then((x) => x.data?.providers ?? [])
    .catch((error) => {
      log.error("failed to list providers for default model", { error })
      return []
    })

  if (specified && providers.length) {
    const provider = providers.find((p) => p.id === specified.providerID)
    if (provider && provider.models[specified.modelID]) return specified
  }

  if (specified && !providers.length) return specified

  const lastUsed = await lastUsedModel(sdk, directory, providers)
  if (lastUsed) return lastUsed

  const opencodeProvider = providers.find((p) => p.id === "opencode")
  if (opencodeProvider) {
    const [best] = Provider.sort(Object.values(opencodeProvider.models))
    if (best) {
      return {
        providerID: ProviderID.make(best.providerID),
        modelID: ModelID.make(best.id),
      }
    }
  }

  const models = providers.flatMap((p) => Object.values(p.models))
  const [best] = Provider.sort(models)
  if (best) {
    return {
      providerID: ProviderID.make(best.providerID),
      modelID: ModelID.make(best.id),
    }
  }

  if (specified) return specified
  throw new Error("No models available")
}

export async function lastUsedModel(
  sdk: OpencodeClient,
  directory: string,
  providers: Array<{ id: string; models: Record<string, unknown> }>,
): Promise<{ providerID: ProviderID; modelID: ModelID } | undefined> {
  const session = await sdk.session
    .list({ directory, roots: true, limit: 1 }, { throwOnError: true })
    .then((x) => x.data?.[0])
    .catch((error) => {
      log.error("failed to list sessions for default model", { error })
      return undefined
    })
  if (!session) return

  const lastUser = await sdk.session
    .messages({ sessionID: session.id, directory, limit: 20 }, { throwOnError: true })
    .then((x) => x.data?.findLast((message) => message.info.role === "user")?.info)
    .catch((error) => {
      log.error("failed to load session messages for default model", { error, sessionID: session.id })
      return undefined
    })
  if (lastUser?.role !== "user") return

  const provider = providers.find((entry) => entry.id === lastUser.model.providerID)
  if (!provider?.models[lastUser.model.modelID]) return
  return {
    providerID: ProviderID.make(lastUser.model.providerID),
    modelID: ModelID.make(lastUser.model.modelID),
  }
}
