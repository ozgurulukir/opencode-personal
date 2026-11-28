import { expect, test } from "bun:test"
import { Effect } from "effect"
import { WithInstance } from "../../src/project/with-instance"
import { tmpdir } from "../fixture/fixture"
import { McpAuth } from "../../src/mcp/auth"

function run<A>(fx: Effect.Effect<A, unknown, McpAuth.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(McpAuth.defaultLayer)))
}

test("parallel mcp auth mutations for different servers do not lose entries", async () => {
  await using tmp = await tmpdir()

  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const servers = ["server-a", "server-b", "server-c", "server-d", "server-e", "server-f"]

      // Unbounded concurrent whole-file read-modify-write, mirroring the MCP
      // state-init connect fan-out where OAuth servers persist clientInfo and
      // tokens mid-connect: without the per-file flock the last writer wins
      // and silently drops the other servers' entries.
      await run(
        McpAuth.Service.use((auth) =>
          Effect.forEach(
            servers,
            (name) => auth.updateTokens(name, { accessToken: `token-${name}` }),
            { concurrency: "unbounded" },
          ),
        ),
      )

      const data = await run(McpAuth.Service.use((auth) => auth.all()))
      for (const name of servers) {
        expect(data[name]?.tokens?.accessToken).toBe(`token-${name}`)
      }
    },
  })
})

test("parallel updateField and remove interleave without losing entries", async () => {
  await using tmp = await tmpdir()

  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const keep = ["keep-a", "keep-b", "keep-c", "keep-d"]
      const gone = ["gone-a", "gone-b"]

      await run(
        McpAuth.Service.use((auth) =>
          Effect.gen(function* () {
            for (const name of [...keep, ...gone]) {
              yield* auth.set(name, { tokens: { accessToken: `token-${name}` } })
            }
          }),
        ),
      )

      await run(
        McpAuth.Service.use((auth) =>
          // Race removals against token updates concurrently; the flock
          // serializes each whole-file read-modify-write.
          Effect.all(
            [
              ...gone.map((name) => auth.remove(name)),
              ...keep.map((name) => auth.updateTokens(name, { accessToken: `token-${name}-updated` })),
            ],
            { concurrency: "unbounded", discard: true },
          ),
        ),
      )

      const data = await run(McpAuth.Service.use((auth) => auth.all()))
      for (const name of keep) {
        expect(data[name]?.tokens?.accessToken).toBe(`token-${name}-updated`)
      }
      expect(data["gone-a"]).toBeUndefined()
      expect(data["gone-b"]).toBeUndefined()
    },
  })
})
