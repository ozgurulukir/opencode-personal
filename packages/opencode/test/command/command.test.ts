import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Command } from "../../src/command"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(Command.defaultLayer, node))

describe("command", () => {
  it.live("get resolves prototype keys to undefined", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const command = yield* Command.Service
          // A bare store lookup would resolve the inherited members and crash
          // the command runner downstream.
          expect(yield* command.get("toString")).toBeUndefined()
          expect(yield* command.get("constructor")).toBeUndefined()
          expect(yield* command.get("valueOf")).toBeUndefined()
          expect(yield* command.get("hasOwnProperty")).toBeUndefined()
          // A real command still resolves.
          expect(yield* command.get("init")).toBeDefined()
        }),
      { git: true },
    ),
  )

  it.live("a skill named toString registers as a command", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "toString", "SKILL.md"),
              `---
name: toString
description: A skill named toString.
---

# toString
`,
            ),
          )

          const command = yield* Command.Service
          const entry = yield* command.get("toString")
          expect(entry).toBeDefined()
          expect(entry?.source).toBe("skill")
          expect(entry?.description).toBe("A skill named toString.")
        }),
      { git: true },
    ),
  )
})
