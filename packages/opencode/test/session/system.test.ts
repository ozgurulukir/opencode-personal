import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import type { Agent } from "../../src/agent/agent"
import { NamedError } from "@opencode-ai/core/util/error"
import { Skill } from "../../src/skill"
import { Permission } from "../../src/permission"
import { SystemPrompt } from "../../src/session/system"
import { testEffect } from "../lib/effect"

const skills: Skill.Info[] = [
  {
    name: "zeta-skill",
    description: "Zeta skill.",
    location: "/tmp/zeta-skill/SKILL.md",
    content: "# zeta-skill",
  },
  {
    name: "alpha-skill",
    description: "Alpha skill.",
    location: "/tmp/alpha-skill/SKILL.md",
    content: "# alpha-skill",
  },
  {
    name: "middle-skill",
    description: "Middle skill.",
    location: "/tmp/middle-skill/SKILL.md",
    content: "# middle-skill",
  },
  {
    name: "manual-skill",
    description: "Manual skill.",
    location: "/tmp/manual-skill/SKILL.md",
    content: "# manual-skill",
    // Emulates an invalid skill: real available() hides skills carrying warnings.
    warnings: ["missing description"],
  },
]

const build: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const skillService = (matched: Skill.Info[]) =>
  Skill.Service.of({
    get: (name) => Effect.succeed(skills.find((skill) => skill.name === name)),
    all: () => Effect.succeed(skills),
    allIncludingInvalid: () => Effect.succeed(skills),
    dirs: () => Effect.succeed([]),
    // Emulates the real Skill.available() contract (skill/index.ts):
    // hide invalid skills (warnings) and sort by name. fmt() preserves
    // this order — the system prompt must not re-sort or re-filter.
    available: () =>
      Effect.succeed(
        skills
          .filter((skill) => !skill.warnings || skill.warnings.length === 0)
          .toSorted((a, b) => a.name.localeCompare(b.name)),
      ),
    markLoaded: () => Effect.void,
    matchBySemantics: () => Effect.succeed(matched),
  })

const it = testEffect(
  SystemPrompt.layer.pipe(Layer.provide(Layer.succeed(Skill.Service, skillService([])))),
)

// Auto-match returns the semantic-search relevance order (skill/index.ts:matchBySemantics),
// which is intentionally NOT alphabetical. Stub it with zeta before alpha so the
// ordering contract can be locked independently of the real zvec index.
const itAutoMatch = testEffect(
  SystemPrompt.layer.pipe(Layer.provide(Layer.succeed(Skill.Service, skillService([skills[0], skills[1]])))),
)

describe("session.system", () => {
  it.effect("skills output is sorted by name and stable across calls", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const first = yield* prompt.skills(build)
      const second = yield* prompt.skills(build)
      const output = first ?? (yield* Effect.fail(new NamedError.Unknown({ message: "missing skills output" })))

      expect(first).toBe(second)

      const alpha = output.indexOf("<name>alpha-skill</name>")
      const middle = output.indexOf("<name>middle-skill</name>")
      const zeta = output.indexOf("<name>zeta-skill</name>")

      expect(alpha).toBeGreaterThan(-1)
      expect(middle).toBeGreaterThan(alpha)
      expect(zeta).toBeGreaterThan(middle)
      expect(output).not.toContain("manual-skill")
    }),
  )

  itAutoMatch.effect("auto-match preserves relevance order instead of sorting by name", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      // skills[0] = zeta-skill, skills[1] = alpha-skill: relevance order, not alphabetical.
      const output = yield* prompt.skills(build, "some task", { autoMatch: true, count: 3, threshold: 0 })
      const rendered = output ?? (yield* Effect.fail(new NamedError.Unknown({ message: "missing skills output" })))

      const zeta = rendered.indexOf("<name>zeta-skill</name>")
      const alpha = rendered.indexOf("<name>alpha-skill</name>")

      expect(zeta).toBeGreaterThan(-1)
      expect(alpha).toBeGreaterThan(zeta)
    }),
  )
})
