import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Auth } from "../../src/auth"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(Auth.defaultLayer, node))

describe("Auth", () => {
  it.live("set normalizes trailing slashes in keys", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com/", {
          type: "wellknown",
          key: "TOKEN",
          token: "abc",
        })
        const data = yield* auth.all()
        expect(data["https://example.com"]).toBeDefined()
        expect(data["https://example.com/"]).toBeUndefined()
      }),
    ),
  )

  it.live("set cleans up pre-existing trailing-slash entry", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com/", {
          type: "wellknown",
          key: "TOKEN",
          token: "old",
        })
        yield* auth.set("https://example.com", {
          type: "wellknown",
          key: "TOKEN",
          token: "new",
        })
        const data = yield* auth.all()
        const keys = Object.keys(data).filter((key) => {
          try {
            return new URL(key).hostname === "example.com"
          } catch {
            return false
          }
        })
        expect(keys).toEqual(["https://example.com"])
        const entry = data["https://example.com"]!
        expect(entry.type).toBe("wellknown")
        if (entry.type === "wellknown") expect(entry.token).toBe("new")
      }),
    ),
  )

  it.live("remove deletes both trailing-slash and normalized keys", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com", {
          type: "wellknown",
          key: "TOKEN",
          token: "abc",
        })
        yield* auth.remove("https://example.com/")
        const data = yield* auth.all()
        expect(data["https://example.com"]).toBeUndefined()
        expect(data["https://example.com/"]).toBeUndefined()
      }),
    ),
  )

  it.live("set and remove are no-ops on keys without trailing slashes", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("anthropic", {
          type: "api",
          key: "sk-test",
        })
        const data = yield* auth.all()
        expect(data["anthropic"]).toBeDefined()
        yield* auth.remove("anthropic")
        const after = yield* auth.all()
        expect(after["anthropic"]).toBeUndefined()
      }),
    ),
  )

  it.live("parallel set() for different keys does not lose entries", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const keys = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"]

        // Unbounded concurrent whole-file read-modify-write: without the
        // per-file flock, the last writer wins and silently drops the other
        // writers' entries.
        yield* Effect.forEach(
          keys,
          (key) => auth.set(key, { type: "api", key: `sk-${key}` }),
          { concurrency: "unbounded" },
        )

        const data = yield* auth.all()
        for (const key of keys) {
          const entry = data[key]
          expect(entry?.type).toBe("api")
          if (entry?.type === "api") expect(entry.key).toBe(`sk-${key}`)
        }
      }),
    ),
  )

  it.live("parallel remove() and set() interleave without losing entries", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const keep = ["keep-a", "keep-b", "keep-c", "keep-d"]

        // Seed all entries first, then race removals of half the keys against
        // sets of the others; the flock must serialize each read-modify-write.
        for (const key of [...keep, "gone-a", "gone-b"]) {
          yield* auth.set(key, { type: "api", key: `sk-${key}` })
        }

        yield* Effect.all(
          [
            ...["gone-a", "gone-b"].map((key) => auth.remove(key)),
            ...keep.map((key) => auth.set(key, { type: "api", key: `sk-${key}-updated` })),
          ],
          { concurrency: "unbounded", discard: true },
        )

        const data = yield* auth.all()
        for (const key of keep) {
          const entry = data[key]
          if (entry?.type === "api") expect(entry.key.endsWith("-updated")).toBe(true)
        }
        expect(data["gone-a"]).toBeUndefined()
        expect(data["gone-b"]).toBeUndefined()
      }),
    ),
  )
})
