import { expect, mock, test } from "bun:test"
import { Context, Effect, Exit, Layer, Option } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Config } from "@/config/config"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Npm } from "@opencode-ai/core/npm"
import { Auth } from "../../src/auth"
import { Account } from "../../src/account/account"
import { Env } from "../../src/env"
import { InstanceRuntime } from "@/project/instance-runtime"
import { WithInstance } from "../../src/project/with-instance"
import { tmpdir } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import path from "path"
import fs from "fs/promises"

/** Infra layer that provides FileSystem, Path, ChildProcessSpawner for test fixtures */
const infra = CrossSpawnSpawner.defaultLayer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
)

const emptyAccount = Layer.mock(Account.Service)({
  active: () => Effect.succeed(Option.none()),
  activeOrg: () => Effect.succeed(Option.none()),
})

const emptyAuth = Layer.mock(Auth.Service)({
  all: () => Effect.succeed({}),
})

const testFlock = EffectFlock.defaultLayer

const noopNpm = Layer.mock(Npm.Service)({
  install: () => Effect.void,
  add: () => Effect.die("not implemented"),
  which: () => Effect.succeed(Option.none()),
})

const layer = Config.layer.pipe(
  Layer.provide(testFlock),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(emptyAuth),
  Layer.provide(emptyAccount),
  Layer.provideMerge(infra),
  Layer.provide(noopNpm),
)

const load = () => Effect.runPromise(Config.Service.use((svc) => svc.get()).pipe(Effect.scoped, Effect.provide(layer)))
const save = (config: Config.Info) =>
  Effect.runPromise(Config.Service.use((svc) => svc.update(config)).pipe(Effect.scoped, Effect.provide(layer)))

const dispose = async () => {
  await InstanceRuntime.disposeAllInstances()
}

/**
 * The default filesystem with rename rigged to die, simulating a crash between
 * the tmp write and the atomic rename. Layer.build yields a Context, so the
 * wrapped service is extracted with Context.get.
 */
const crashRenameLayer = Layer.effect(
  AppFileSystem.Service,
  Effect.map(
    Effect.scoped(Layer.build(AppFileSystem.defaultLayer)),
    (ctx) => {
      const base = Context.get(ctx, AppFileSystem.Service)
      return new Proxy(base, {
        get(target, prop, receiver) {
          if (prop === "rename") return () => Effect.die(new Error("simulated crash before rename"))
          return Reflect.get(target, prop, receiver)
        },
      })
    },
  ),
)

function authLayer(auth: Record<string, Auth.Info>) {
  return Config.layer.pipe(
    Layer.provide(testFlock),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Env.defaultLayer),
    Layer.provide(
      Layer.mock(Auth.Service)({
        all: () => Effect.succeed(auth),
      }),
    ),
    Layer.provide(emptyAccount),
    Layer.provideMerge(infra),
    Layer.provide(noopNpm),
  )
}

test("an offline well-known provider is skipped and config stays usable", async () => {
  const originalFetch = globalThis.fetch
  const mocked = mock((url: string | URL | Request) => {
    const urlStr = url instanceof Request ? url.url : url instanceof URL ? url.href : url
    if (urlStr.includes(".well-known/opencode")) {
      // Network-level failure: host unreachable.
      return Promise.reject(new TypeError("fetch failed"))
    }
    return originalFetch(url)
  }) as unknown as typeof fetch
  globalThis.fetch = mocked

  try {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Effect.runPromise(
          Config.Service.use((svc) => svc.get()).pipe(
            Effect.scoped,
            Effect.provide(
              authLayer({
                "https://offline.example.com": new Auth.WellKnown({
                  type: "wellknown",
                  key: "TEST_TOKEN",
                  token: "test-token",
                }),
              }),
            ),
          ),
        )
        expect(config.username).toBeDefined()
      },
    })
  } finally {
    globalThis.fetch = originalFetch
    await dispose()
  }
})

test("a well-known provider serving malformed JSON is skipped and config stays usable", async () => {
  const originalFetch = globalThis.fetch
  const mocked = mock((url: string | URL | Request) => {
    const urlStr = url instanceof Request ? url.url : url instanceof URL ? url.href : url
    if (urlStr.includes(".well-known/opencode")) {
      return Promise.resolve(new Response("<<< not json >>>", { status: 200 }))
    }
    return originalFetch(url)
  }) as unknown as typeof fetch
  globalThis.fetch = mocked

  try {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Effect.runPromise(
          Config.Service.use((svc) => svc.get()).pipe(
            Effect.scoped,
            Effect.provide(
              authLayer({
                "https://garbage.example.com": new Auth.WellKnown({
                  type: "wellknown",
                  key: "TEST_TOKEN",
                  token: "test-token",
                }),
              }),
            ),
          ),
        )
        expect(config.username).toBeDefined()
      },
    })
  } finally {
    globalThis.fetch = originalFetch
    await dispose()
  }
})

test("a schema-invalid agent file is skipped and valid agents still load", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const agentDir = path.join(dir, ".opencode", "agent")
      await fs.mkdir(agentDir, { recursive: true })
      // Frontmatter parses as YAML but violates the agent schema: steps must
      // be a positive integer.
      await fs.writeFile(path.join(agentDir, "broken.md"), "---\nname: broken\nsteps: not-a-number\n---\nBroken")
      await fs.writeFile(path.join(agentDir, "good.md"), "---\nname: good\ndescription: fine\n---\nGood prompt body")
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await load()
      expect(config.agent?.broken).toBeUndefined()
      expect(config.agent?.good?.prompt).toBe("Good prompt body")
    },
  })
})

test("a schema-invalid command file is skipped and valid commands still load", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const commandDir = path.join(dir, ".opencode", "command")
      await fs.mkdir(commandDir, { recursive: true })
      // Frontmatter parses as YAML but violates the command schema: subtask
      // must be a boolean.
      await fs.writeFile(
        path.join(commandDir, "broken.md"),
        "---\ndescription: broken\nsubtask: not-a-boolean\n---\nBroken template",
      )
      await fs.writeFile(path.join(commandDir, "good.md"), "---\ndescription: fine\n---\nGood template body")
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await load()
      expect(config.command?.broken).toBeUndefined()
      expect(config.command?.good?.template).toBe("Good template body")
    },
  })
})

test("a malformed OPENCODE_PERMISSION env var is ignored and config stays usable", async () => {
  const prev = process.env.OPENCODE_PERMISSION
  process.env.OPENCODE_PERMISSION = "{not-valid-json"
  try {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await load()
        expect(config.username).toBeDefined()
        expect(config.permission).toBeUndefined()
      },
    })
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_PERMISSION
    else process.env.OPENCODE_PERMISSION = prev
  }
})

test("a non-object OPENCODE_PERMISSION env var is ignored", async () => {
  const prev = process.env.OPENCODE_PERMISSION
  process.env.OPENCODE_PERMISSION = '"just-a-string"'
  try {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await load()
        expect(config.username).toBeDefined()
        expect(config.permission).toBeUndefined()
      },
    })
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_PERMISSION
    else process.env.OPENCODE_PERMISSION = prev
  }
})

test("a crash mid-write leaves the previous config file intact, parseable, and tmp-free", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.writeFile(
        path.join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", username: "before-crash" }),
      )
    },
  })
  const dir = tmp.path

  const crashLayer = Config.layer.pipe(
    Layer.provide(testFlock),
    Layer.provide(crashRenameLayer),
    Layer.provide(Env.defaultLayer),
    Layer.provide(emptyAuth),
    Layer.provide(emptyAccount),
    Layer.provideMerge(infra),
    Layer.provide(noopNpm),
  )

  await WithInstance.provide({
    directory: dir,
    fn: async () => {
      const exit = await Effect.runPromise(
        Config.Service.use((svc) => Effect.exit(svc.update({ username: "after-crash" }))).pipe(
          Effect.scoped,
          Effect.provide(crashLayer),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
    },
  })

  const onDisk = JSON.parse(await fs.readFile(path.join(dir, "opencode.json"), "utf8"))
  expect(onDisk.username).toBe("before-crash")
  const entries = await fs.readdir(dir)
  expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false)
})

test("a successful update replaces the config file without tmp leftovers", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.writeFile(
        path.join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", username: "before" }),
      )
    },
  })
  const dir = tmp.path
  await WithInstance.provide({
    directory: dir,
    fn: async () => {
      const result = await save({ username: "after" })
      expect(result.changed).toBe(true)
    },
  })

  const onDisk = JSON.parse(await fs.readFile(path.join(dir, "opencode.json"), "utf8"))
  expect(onDisk.username).toBe("after")
  const entries = await fs.readdir(dir)
  expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false)
})
