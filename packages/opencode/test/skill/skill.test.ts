import { mock, afterAll } from "bun:test"
mock.module("onnxruntime-web", () => {
  class InferenceSession {
    inputNames = ["input_ids", "attention_mask", "token_type_ids"]
    outputNames = ["output"]
    async run() {
      return { output: { data: new Float32Array(384).fill(0) } }
    }
    static create() {
      return Promise.resolve(new InferenceSession())
    }
  }
  return {
    InferenceSession,
    Tensor: class {
      constructor() {}
    },
    env: { wasm: {} },
  }
})

// mock.module() persists across test files — restore to prevent leakage (AGENTS.md).
afterAll(() => mock.restore())

import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import * as os from "node:os"
import { Skill, type Interface } from "../../src/skill"
import { Discovery } from "../../src/skill/discovery"
import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Hash } from "@opencode-ai/core/util/hash"
import { EmbeddingService } from "@/search/embedding"
import { manifestPathFor } from "@/search/manifest"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideInstance, provideTmpdirInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import path from "path"
import fs from "fs/promises"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(Skill.defaultLayer, node))

async function createGlobalSkill(homeDir: string) {
  const skillDir = path.join(homeDir, ".claude", "skills", "global-test-skill")
  await fs.mkdir(skillDir, { recursive: true })
  await Bun.write(
    path.join(skillDir, "SKILL.md"),
    `---
name: global-test-skill
description: A global skill from ~/.claude/skills for testing.
---

# Global Test Skill

This skill is loaded from the global home directory.
`,
  )
}

const withHome = <A, E, R>(home: string, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.OPENCODE_TEST_HOME
      process.env.OPENCODE_TEST_HOME = home
      return prev
    }),
    () => self,
    (prev) =>
      Effect.sync(() => {
        process.env.OPENCODE_TEST_HOME = prev
      }),
  )

describe("skill", () => {
  it.live("discovers skills from .opencode/skill/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "test-skill", "SKILL.md"),
              `---
name: test-skill
description: A test skill for verification.
---

# Test Skill

Instructions here.
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "test-skill")
          expect(item).toBeDefined()
          expect(item!.description).toBe("A test skill for verification.")
          expect(item!.location).toContain(path.join("skill", "test-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("returns skill directories from Skill.dirs", () =>
    provideTmpdirInstance(
      (dir) =>
        withHome(
          dir,
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              Bun.write(
                path.join(dir, ".opencode", "skill", "dir-skill", "SKILL.md"),
                `---
name: dir-skill
description: Skill for dirs test.
---

# Dir Skill
`,
              ),
            )

            const skill = yield* Skill.Service
            const dirs = yield* skill.dirs()
            expect(dirs).toContain(path.join(dir, ".opencode", "skill", "dir-skill"))
            expect(dirs.length).toBe(1)
          }),
        ),
      { git: true },
    ),
  )

  it.live("discovers multiple skills from .opencode/skill/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".opencode", "skill", "skill-one", "SKILL.md"),
                `---
name: skill-one
description: First test skill.
---

# Skill One
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skill", "skill-two", "SKILL.md"),
                `---
name: skill-two
description: Second test skill.
---

# Skill Two
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(2)
          expect(list.find((x) => x.name === "skill-one")).toBeDefined()
          expect(list.find((x) => x.name === "skill-two")).toBeDefined()
        }),
      { git: true },
    ),
  )

  it.live("skips skills with missing frontmatter", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "no-frontmatter", "SKILL.md"),
              `# No Frontmatter

Just some content without YAML frontmatter.
`,
            ),
          )

          const skill = yield* Skill.Service
          expect(yield* skill.all()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("drops skills with missing description", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "manual-skill", "SKILL.md"),
              `---
name: manual-skill
---

# Manual Skill

Instructions here.
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(0)
        }),
      { git: true },
    ),
  )

  it.live("discovers skills from .claude/skills/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
              `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "claude-skill")
          expect(item).toBeDefined()
          expect(item!.location).toContain(path.join(".claude", "skills", "claude-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("discovers global skills from ~/.claude/skills/ directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )

      yield* withHome(
        tmp.path,
        Effect.gen(function* () {
          yield* Effect.promise(() => createGlobalSkill(tmp.path))
          yield* Effect.gen(function* () {
            const skill = yield* Skill.Service
            const list = yield* skill.all()
            expect(list.length).toBe(1)
            expect(list[0].name).toBe("global-test-skill")
            expect(list[0].description).toBe("A global skill from ~/.claude/skills for testing.")
            expect(list[0].location).toContain(path.join(".claude", "skills", "global-test-skill", "SKILL.md"))
          }).pipe(provideInstance(tmp.path))
        }),
      )
    }),
  )

  it.live("returns empty array when no skills exist", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          expect(yield* skill.all()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("discovers skills from .agents/skills/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
              `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "agent-skill")
          expect(item).toBeDefined()
          expect(item!.location).toContain(path.join(".agents", "skills", "agent-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("discovers global skills from ~/.agents/skills/ directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )

      yield* withHome(
        tmp.path,
        Effect.gen(function* () {
          const skillDir = path.join(tmp.path, ".agents", "skills", "global-agent-skill")
          yield* Effect.promise(() => fs.mkdir(skillDir, { recursive: true }))
          yield* Effect.promise(() =>
            Bun.write(
              path.join(skillDir, "SKILL.md"),
              `---
name: global-agent-skill
description: A global skill from ~/.agents/skills for testing.
---

# Global Agent Skill

This skill is loaded from the global home directory.
`,
            ),
          )

          yield* Effect.gen(function* () {
            const skill = yield* Skill.Service
            const list = yield* skill.all()
            expect(list.length).toBe(1)
            expect(list[0].name).toBe("global-agent-skill")
            expect(list[0].description).toBe("A global skill from ~/.agents/skills for testing.")
            expect(list[0].location).toContain(path.join(".agents", "skills", "global-agent-skill", "SKILL.md"))
          }).pipe(provideInstance(tmp.path))
        }),
      )
    }),
  )

  it.live("discovers skills from both .claude/skills/ and .agents/skills/", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
                `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
              ),
              Bun.write(
                path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
                `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(2)
          expect(list.find((x) => x.name === "claude-skill")).toBeDefined()
          expect(list.find((x) => x.name === "agent-skill")).toBeDefined()
        }),
      { git: true },
    ),
  )

  it.live("properly resolves directories that skills live in", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
                `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
              ),
              Bun.write(
                path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
                `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skill", "agent-skill", "SKILL.md"),
                `---
name: opencode-skill
description: A skill in the .opencode/skill directory.
---

# OpenCode Skill
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skills", "agent-skill", "SKILL.md"),
                `---
name: opencode-skill
description: A skill in the .opencode/skills directory.
---

# OpenCode Skill
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          expect((yield* skill.dirs()).length).toBe(4)
        }),
      { git: true },
    ),
  )

  it.live("drops skills with empty name", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "empty-name", "SKILL.md"),
              `---
name: ""
description: Skill with empty name.
---

# Empty Name
`,
            ),
          )

          const skill = yield* Skill.Service
          expect(yield* skill.all()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("drops skills with name exceeding 64 characters", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const longName = "a".repeat(65)
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", longName, "SKILL.md"),
              `---
name: ${longName}
description: Skill with too-long name.
---

# Long Name
`,
            ),
          )

          const skill = yield* Skill.Service
          expect(yield* skill.all()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("drops skills with uppercase name", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "pdf-processing", "SKILL.md"),
              `---
name: PDF-Processing
description: Skill with uppercase name.
---

# Uppercase Name
`,
            ),
          )

          const skill = yield* Skill.Service
          expect(yield* skill.all()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("drops skills with leading hyphen in name", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "pdf-processing", "SKILL.md"),
              `---
name: -pdf
description: Skill with leading hyphen.
---

# Leading Hyphen
`,
            ),
          )

          const skill = yield* Skill.Service
          expect(yield* skill.all()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("drops skills with consecutive hyphens in name", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "pdf-processing", "SKILL.md"),
              `---
name: pdf--processing
description: Skill with consecutive hyphens.
---

# Consecutive Hyphens
`,
            ),
          )

          const skill = yield* Skill.Service
          expect(yield* skill.all()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("drops skills with name not matching folder", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "pdf-processing", "SKILL.md"),
              `---
name: pdf
description: Name mismatch with folder.
---

# Different Name
`,
            ),
          )

          const skill = yield* Skill.Service
          expect(yield* skill.all()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("drops skills with empty description", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "no-description", "SKILL.md"),
              `---
name: no-description
description: ""
---

# Empty Description
`,
            ),
          )

          const skill = yield* Skill.Service
          expect(yield* skill.all()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("drops skills with description exceeding 1024 characters", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const longDesc = "a".repeat(1025)
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "long-description", "SKILL.md"),
              `---
name: long-description
description: ${longDesc}
---

# Long Description
`,
            ),
          )

          const skill = yield* Skill.Service
          expect(yield* skill.all()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("accepts skill with all optional frontmatter fields", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "full-skill", "SKILL.md"),
              `---
name: full-skill
description: A skill with all optional fields.
license: MIT
compatibility: opencode >= 1.0
metadata:
  author: test
  version: "1.0"
allowed-tools: Read Glob
---

# Full Skill
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(1)
          expect(list[0].name).toBe("full-skill")
          expect(list[0].license).toBe("MIT")
          expect(list[0].compatibility).toBe("opencode >= 1.0")
          expect(list[0].metadata).toEqual({ author: "test", version: "1.0" })
          expect(list[0].allowedTools).toBe("Read Glob")
        }),
      { git: true },
    ),
  )

  it.live("accepts skill name at exactly 64 character limit", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const name64 = "a".repeat(64)
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", name64, "SKILL.md"),
              `---
name: ${name64}
description: Boundary name length.
---

# Name 64
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(1)
          expect(list[0].name).toBe(name64)
        }),
      { git: true },
    ),
  )

  it.live("drops skills with name not matching folder", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "my-folder", "SKILL.md"),
              `---
name: different-name
description: Name mismatch with folder.
---

# Different Name
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(0)
        }),
      { git: true },
    ),
  )
})

describe("skill.fmt", () => {
  const mkSkill = (name: string, description: string): Skill.Info => ({
    name,
    description,
    location: `/skills/${name}/SKILL.md`,
    content: "body",
  })

  test("returns placeholder for empty list", () => {
    expect(Skill.fmt([], { verbose: false })).toBe("No skills are currently available.")
    expect(Skill.fmt([], { verbose: true })).toBe("No skills are currently available.")
  })

  test("lists described skills in non-verbose mode", () => {
    const result = Skill.fmt([mkSkill("alpha", "Alpha skill")], { verbose: false })
    expect(result).toContain("## Available Skills")
    expect(result).toContain("**alpha**")
    expect(result).toContain("Alpha skill")
  })

  test("lists described skills in verbose mode", () => {
    const result = Skill.fmt([mkSkill("alpha", "Alpha skill")], { verbose: true })
    expect(result).toContain("<available_skills>")
    expect(result).toContain("<name>alpha</name>")
    expect(result).toContain("<description>Alpha skill</description>")
  })

  test("preserves input order without re-sorting", () => {
    const input = [mkSkill("zebra", "z"), mkSkill("alpha", "a")]
    const result = Skill.fmt(input, { verbose: false })
    expect(result.indexOf("zebra")).toBeLessThan(result.indexOf("alpha"))
  })
})

describe("skill duplicates", () => {
  it.live("keeps single entry when duplicate names exist", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".opencode", "skill", "dupename", "SKILL.md"),
                `---
name: dupename
description: First definition.
---

# First
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skills", "dupename", "SKILL.md"),
                `---
name: dupename
description: Second definition.
---

# Second
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(1)
          expect(list[0].name).toBe("dupename")
        }),
      { git: true },
    ),
  )
})

describe("skill permission filtering", () => {
  it.live("filters denied skills by agent permission", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".opencode", "skill", "good-skill", "SKILL.md"),
                `---
name: good-skill
description: A good skill.
---

# Good
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skill", "evil-skill", "SKILL.md"),
                `---
name: evil-skill
description: An evil skill.
---

# Evil
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const agent = {
            name: "restricted",
            description: "Agent with skill deny rules",
            mode: "primary" as const,
            permission: [{ permission: "skill", pattern: "evil-*", action: "deny" as const }],
            options: {},
          }
          const available = yield* skill.available(agent)
          expect(available.length).toBe(1)
          expect(available[0].name).toBe("good-skill")
        }),
      { git: true },
    ),
  )

  it.live("returns all skills for agent without deny rules", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "any-skill", "SKILL.md"),
              `---
name: any-skill
description: Any skill.
---

# Any
`,
            ),
          )

          const skill = yield* Skill.Service
          const agent = {
            name: "build",
            description: "Default agent",
            mode: "primary" as const,
            permission: [],
            options: {},
          }
          const available = yield* skill.available(agent)
          expect(available.length).toBe(1)
          expect(available[0].name).toBe("any-skill")
        }),
      { git: true },
    ),
  )
})

describe("skill semantic index resilience", () => {
  // Regression (H3+H4): a failing embedder must not kill skill loading or the
  // system-prompt build, and the manifest must only record successful indexing —
  // stale hashes are retried on the next session's state init.
  test("embedding failure degrades, keeps manifest retryable, and retries next session", async () => {
    let embedCalls = 0
    let embedFails = false
    const embedderLayer = Layer.succeed(EmbeddingService, {
      embed: (texts: string[]) =>
        embedFails
          ? Effect.fail(new Error("embedder unavailable (test)"))
          : Effect.sync(() => {
              embedCalls += texts.length
              return texts.map(() => Array(4).fill(0.25))
            }),
      resolve: Effect.void,
      dimension: 4,
    })

    // A fresh layer value per runtime: Effect memoizes layer builds by reference,
    // so reusing one value would share the InstanceState cache across sessions and
    // never re-run the state init this test needs to observe.
    const makeSkillLayer = () =>
      Skill.layer.pipe(
        Layer.provide(Discovery.defaultLayer),
        Layer.provide(Config.defaultLayer),
        Layer.provide(Bus.layer),
        Layer.provide(AppFileSystem.defaultLayer),
        Layer.provide(Global.layer),
        Layer.provide(embedderLayer),
      )

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-skill-h34-"))
    const indexPath = path.join(Global.Path.cache, "zvec", "skills", Hash.fast(dir))
    const manifestPath = manifestPathFor(indexPath)

    // Assertions must run inside the provided effect: InstanceState-backed methods
    // (all/matchBySemantics/state init) read the instance context lazily.
    const runSkill = <A>(use: (skill: Interface) => Effect.Effect<A>) =>
      Effect.gen(function* () {
        const skill = yield* Skill.Service
        return yield* use(skill)
      }).pipe(Effect.provide(makeSkillLayer()), Effect.provide(node), provideInstance(dir), Effect.runPromise)

    const readManifest = async () => JSON.parse(await fs.readFile(manifestPath, "utf8"))

    try {
      await Bun.write(
        path.join(dir, ".opencode", "skill", "s1", "SKILL.md"),
        `---
name: s1
description: Skill one.
---

# S1

body
`,
      )

      const agent = {
        name: "build",
        description: "Default agent",
        mode: "primary" as const,
        permission: [],
        options: {},
      }

      // Runtime 1: embedding fails — skills must still load, semantic matching
      // degrades to [], and the manifest must NOT record the skill as indexed.
      embedFails = true
      const r1 = await runSkill((skill) =>
        Effect.gen(function* () {
          return {
            list: yield* skill.all(),
            matched: yield* skill.matchBySemantics("query", agent, { count: 3, threshold: 0 }),
          }
        }),
      )
      expect(r1.list).toHaveLength(1)
      expect(r1.matched).toEqual([])
      expect((await readManifest()).skills).toEqual({})

      // Runtime 2: embedder recovers — the unrecorded hash makes it retry, and the
      // manifest now records the skill.
      embedFails = false
      embedCalls = 0
      // Calling all() forces the lazy state init (embedding + manifest update).
      await runSkill((skill) => skill.all())
      expect(embedCalls).toBeGreaterThanOrEqual(1)
      expect((await readManifest()).skills["s1"]).toBeDefined()

      // Runtime 3: hashes match — nothing re-embedded.
      embedCalls = 0
      await runSkill((skill) => skill.all())
      expect(embedCalls).toBe(0)
    } finally {
      await fs.rm(indexPath, { recursive: true, force: true }).catch(() => {})
      await fs.rm(manifestPath, { force: true }).catch(() => {})
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
