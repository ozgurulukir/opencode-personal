import { Context, Effect, Layer } from "effect"

import { InstanceState } from "@/effect/instance-state"

import PROMPT_CORE from "./prompt/core.txt"
import PROMPT_DELTA_ANTHROPIC from "./prompt/delta-anthropic.txt"
import PROMPT_DELTA_BEAST from "./prompt/delta-beast.txt"
import PROMPT_DELTA_CODEX from "./prompt/delta-codex.txt"
import PROMPT_DELTA_DEFAULT from "./prompt/delta-default.txt"
import PROMPT_DELTA_GEMINI from "./prompt/delta-gemini.txt"
import PROMPT_DELTA_GPT from "./prompt/delta-gpt.txt"
import PROMPT_DELTA_KIMI from "./prompt/delta-kimi.txt"
import PROMPT_DELTA_QWEN from "./prompt/delta-qwen.txt"
import PROMPT_DELTA_GLM from "./prompt/delta-glm.txt"
import PROMPT_DELTA_DEEPSEEK from "./prompt/delta-deepseek.txt"
import PROMPT_DELTA_TRINITY from "./prompt/delta-trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"

export type Prompt = {
  /** Cacheable core identity prompt (core + provider delta). */
  prefix: string
}

export function provider(model: Provider.Model): Prompt {
  const delta = matchDelta(model)
  return { prefix: [PROMPT_CORE, delta].join("\n") }
}

function matchDelta(model: Provider.Model): string {
  const id = model.api.id
  // Beast delta: GPT-4 family (incl. gpt-4o, gpt-4.1) and o1/o3 reasoning models.
  // Anchored so "megpt-4" can't false-match, but "gpt-4o-beast" still does (starts with gpt-4).
  if (/(?:^|\/)gpt-4|(?:\b|-)o[13]\b/.test(id)) return PROMPT_DELTA_BEAST
  // Codex checked before generic GPT to avoid false match on the broader gpt rule.
  if (/codex/i.test(id)) return PROMPT_DELTA_CODEX
  if (/(?:^|\/)gpt/.test(id)) return PROMPT_DELTA_GPT
  if (/gemini-/i.test(id)) return PROMPT_DELTA_GEMINI
  if (/claude/i.test(id)) return PROMPT_DELTA_ANTHROPIC
  if (/trinity/i.test(id)) return PROMPT_DELTA_TRINITY
  if (/kimi/i.test(id)) return PROMPT_DELTA_KIMI
  if (/qwen/i.test(id)) return PROMPT_DELTA_QWEN
  if (/glm/i.test(id)) return PROMPT_DELTA_GLM
  if (/deepseek/i.test(id)) return PROMPT_DELTA_DEEPSEEK
  return PROMPT_DELTA_DEFAULT
}

export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (
    agent: Agent.Info,
    userMessage?: string,
    autoMatchOpts?: { autoMatch: boolean; count: number; threshold: number },
  ) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
        const ctx = yield* InstanceState.context
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `<environment>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</environment>`,
          ].join("\n"),
        ]
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (
        agent: Agent.Info,
        userMessage?: string,
        autoMatchOpts?: { autoMatch: boolean; count: number; threshold: number },
      ) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        // Auto-match mode: use semantic search to find relevant skills
        if (userMessage && autoMatchOpts?.autoMatch) {
          const matched = yield* skill.matchBySemantics(userMessage, agent, {
            count: autoMatchOpts.count,
            threshold: autoMatchOpts.threshold,
          })
          if (matched.length === 0) return
          return [
            "<skills>",
            "Skills provide specialized instructions and workflows for specific tasks.",
            "Use the skill tool to load a skill when a task matches its description.",
            Skill.fmt(matched, { verbose: true }),
            "</skills>",
          ].join("\n")
        }

        // Fallback: list all available skills
        const list = yield* skill.available(agent)
        return [
          "<skills>",
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          Skill.fmt(list, { verbose: true }),
          "</skills>",
        ].join("\n")
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer))

export * as SystemPrompt from "./system"
