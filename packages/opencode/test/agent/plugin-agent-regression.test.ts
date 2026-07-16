import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { Skill } from "../../src/skill"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { PLUGIN_AGENT } from "../fixture/agent-plugin.constants"

// Plugin.defaultLayer pulls in Config.defaultLayer which triggers heavy
// server/auth/account init that times out in test context. Use Plugin.layer
// with a TestConfig mock instead — see AGENTS.md (permission/plugin) for details.
const pluginUrl = pathToFileURL(path.join(import.meta.dir, "..", "fixture", "agent-plugin.ts")).href

// Mutable config object so the plugin's `config` hook modifications persist
// across Plugin.state init → Agent.state init (both call config.get()).
const configObj: Record<string, unknown> = {
  plugin: [pluginUrl],
  plugin_origins: [{ spec: pluginUrl, source: "", scope: "local" as const }],
}

const mockConfig = TestConfig.layer({
  get: () => Effect.succeed(configObj as Config.Info),
  directories: () => Effect.succeed([]),
})

const mockAuth = Layer.mock(Auth.Service, {
  get: () => Effect.succeed(undefined),
  all: () => Effect.succeed({}),
  set: () => Effect.void,
  remove: () => Effect.void,
})

const mockSkill = Layer.mock(Skill.Service, {
  dirs: () => Effect.succeed([]),
  get: () => Effect.succeed(undefined),
  all: () => Effect.succeed([]),
  available: () => Effect.succeed([]),
})

const mockProvider = Layer.mock(Provider.Service, {})

const pluginLayer = Plugin.layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(mockConfig),
)

const agentLayer = Agent.layer.pipe(
  Layer.provide(pluginLayer),
  Layer.provide(mockAuth),
  Layer.provide(mockSkill),
  Layer.provide(mockProvider),
  Layer.provide(mockConfig),
)

const it = testEffect(Layer.mergeAll(agentLayer, pluginLayer))

it.instance(
  "plugin-registered agents appear in Agent.list",
  () =>
    Effect.gen(function* () {
      yield* Plugin.Service.use((p) => p.init())
      const agents = yield* Agent.Service.use((svc) => svc.list())
      const added = agents.find((agent) => agent.name === PLUGIN_AGENT.name)
      expect(added?.description).toBe(PLUGIN_AGENT.description)
      expect(added?.mode).toBe(PLUGIN_AGENT.mode)
    }) as any,
  { git: true },
)
