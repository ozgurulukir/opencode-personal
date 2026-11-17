import z from "zod"
import { and } from "drizzle-orm"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import { ProjectTable } from "./project.sql"
import { SessionTable } from "../session/session.sql"
import * as Log from "@opencode-ai/core/util/log"
import { Flag } from "@opencode-ai/core/flag/flag"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { which } from "../util/which"
import { ProjectID } from "./schema"
import { Bus } from "@/bus"
import { Command } from "@/command"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer, Path, Scope, Context, Stream, Types, Schema } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { NodePath } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { gitRunner } from "../git/local-runner"
import { zod } from "@opencode-ai/core/effect-zod"
import { NonNegativeInt, optionalOmitUndefined, withStatics } from "@opencode-ai/core/schema"
import { serviceUse } from "@/effect/service-use"

const log = Log.create({ service: "project" })

const ProjectVcs = Schema.Literal("git")

const ProjectIcon = Schema.Struct({
  url: optionalOmitUndefined(Schema.String),
  override: optionalOmitUndefined(Schema.String),
  color: optionalOmitUndefined(Schema.String),
})

const ProjectCommands = Schema.Struct({
  start: optionalOmitUndefined(
    Schema.String.annotate({ description: "Startup script to run when creating a new workspace (worktree)" }),
  ),
})

const ProjectTime = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
  initialized: optionalOmitUndefined(NonNegativeInt),
})

export const Info = Schema.Struct({
  id: ProjectID,
  worktree: Schema.String,
  vcs: optionalOmitUndefined(ProjectVcs),
  name: optionalOmitUndefined(Schema.String),
  icon: optionalOmitUndefined(ProjectIcon),
  commands: optionalOmitUndefined(ProjectCommands),
  time: ProjectTime,
  sandboxes: Schema.Array(Schema.String),
})
  .annotate({ identifier: "Project" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const Event = {
  Updated: BusEvent.define("project.updated", Info),
}

type Row = typeof ProjectTable.$inferSelect

export function fromRow(row: Row): Info {
  const icon =
    row.icon_url || row.icon_url_override || row.icon_color
      ? {
          url: row.icon_url ?? undefined,
          override: row.icon_url_override ?? undefined,
          color: row.icon_color ?? undefined,
        }
      : undefined
  return {
    id: row.id,
    worktree: row.worktree,
    vcs: row.vcs ? Schema.decodeUnknownSync(ProjectVcs)(row.vcs) : undefined,
    name: row.name ?? undefined,
    icon,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      initialized: row.time_initialized ?? undefined,
    },
    sandboxes: row.sandboxes,
    commands: row.commands ?? undefined,
  }
}

export const UpdateInput = z.object({
  projectID: ProjectID.zod,
  name: z.string().optional(),
  icon: zod(ProjectIcon).optional(),
  commands: zod(ProjectCommands).optional(),
})
export type UpdateInput = z.infer<typeof UpdateInput>

export const UpdatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  icon: Schema.optional(ProjectIcon),
  commands: Schema.optional(ProjectCommands),
})
  .annotate({ identifier: "ProjectUpdateInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type UpdatePayload = Types.DeepMutable<Schema.Schema.Type<typeof UpdatePayload>>

// ---------------------------------------------------------------------------
// Effect service
// ---------------------------------------------------------------------------

export interface Interface {
  /**
   * Per-instance setup. Subscribes to the `/init` slash command for the
   * current instance and stamps the project's initialized timestamp when it
   * fires. Subscription lifetime is tied to the per-instance state scope.
   */
  readonly init: () => Effect.Effect<void>
  readonly fromDirectory: (directory: string) => Effect.Effect<{ project: Info; sandbox: string }>
  readonly discover: (input: Info) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: ProjectID) => Effect.Effect<Info | undefined>
  readonly update: (input: UpdateInput) => Effect.Effect<Info>
  readonly initGit: (input: { directory: string; project: Info }) => Effect.Effect<Info>
  readonly setInitialized: (id: ProjectID) => Effect.Effect<void>
  readonly sandboxes: (id: ProjectID) => Effect.Effect<string[]>
  readonly addSandbox: (id: ProjectID, directory: string) => Effect.Effect<void>
  readonly removeSandbox: (id: ProjectID, directory: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Project") {}

export const layer: Layer.Layer<
  Service,
  never,
  AppFileSystem.Service | Path.Path | ChildProcessSpawner.ChildProcessSpawner | Bus.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const pathSvc = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const bus = yield* Bus.Service

    const git = gitRunner(spawner, () => ({ code: 1, text: "", stderr: "" }))

    const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
      Effect.sync(() => Database.use(fn as (trx: Database.TxOrDb) => Database.NotPromise<T>))

    const emitUpdated = (data: Info) =>
      Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: "global",
          project: data.id,
          payload: { type: Event.Updated.type, properties: data },
        }),
      )

    const fakeVcs = Schema.decodeUnknownSync(Schema.optional(ProjectVcs))(Flag.OPENCODE_FAKE_VCS)

    const resolveGitPath = (cwd: string, name: string) => {
      if (!name) return cwd
      name = name.replace(/[\r\n]+$/, "")
      if (!name) return cwd
      name = AppFileSystem.windowsPath(name)
      if (pathSvc.isAbsolute(name)) return pathSvc.normalize(name)
      return pathSvc.resolve(cwd, name)
    }

    const scope = yield* Scope.Scope

    const readCachedProjectId = Effect.fnUntraced(function* (dir: string) {
      return yield* fs.readFileString(pathSvc.join(dir, "opencode")).pipe(
        Effect.map((x) => {
          const trimmed = x.trim()
          // The cache is written by this module only: a git root-commit hash.
          // The ID is interpolated into path.join(Global.Path.data, ...) sinks
          // (snapshot/, worktree/), and path.join normalizes "..", so a crafted
          // .git/opencode would otherwise escape the data dir. Require the
          // literal hash format; discovery falls back to recomputing it.
          return /^[0-9a-f]{40,64}$/i.test(trimmed) ? ProjectID.make(trimmed) : undefined
        }),
        Effect.catch(() => Effect.void),
      )
    })

    const fromDirectory = Effect.fn("Project.fromDirectory")(function* (directory: string) {
      log.info("fromDirectory", { directory })

      // Phase 1: discover git info
      type DiscoveryResult = { id: ProjectID; worktree: string; sandbox: string; vcs: Info["vcs"] }

      const data: DiscoveryResult = yield* Effect.gen(function* () {
        const dotgitMatches = yield* fs.up({ targets: [".git"], start: directory }).pipe(Effect.orDie)
        const dotgit = dotgitMatches[0]

        if (!dotgit) {
          return {
            id: ProjectID.global,
            worktree: "/",
            sandbox: "/",
            vcs: fakeVcs,
          }
        }

        let sandbox = pathSvc.dirname(dotgit)
        const gitBinary = yield* Effect.sync(() => which("git"))
        let id = yield* readCachedProjectId(dotgit)

        if (!gitBinary) {
          return {
            id: id ?? ProjectID.global,
            worktree: sandbox,
            sandbox,
            vcs: fakeVcs,
          }
        }

        const commonDir = yield* git(["rev-parse", "--git-common-dir"], { cwd: sandbox })
        if (commonDir.code !== 0) {
          return {
            id: id ?? ProjectID.global,
            worktree: sandbox,
            sandbox,
            vcs: fakeVcs,
          }
        }
        const common = resolveGitPath(sandbox, commonDir.text.trim())
        const bareCheck = yield* git(["config", "--bool", "core.bare"], { cwd: sandbox })
        const isBareRepo = bareCheck.code === 0 && bareCheck.text.trim() === "true"
        const worktree = common === sandbox ? sandbox : isBareRepo ? common : pathSvc.dirname(common)

        if (id == null) {
          id = yield* readCachedProjectId(common)
        }

        if (!id) {
          const revList = yield* git(["rev-list", "--max-parents=0", "HEAD"], { cwd: sandbox })
          const roots = revList.text
            .split("\n")
            .filter(Boolean)
            .map((x) => x.trim())
            .toSorted()

          id = roots[0] ? ProjectID.make(roots[0]) : undefined
          if (id) {
            yield* fs.writeFileString(pathSvc.join(common, "opencode"), id).pipe(Effect.ignore)
          }
        }

        if (!id) {
          return { id: ProjectID.global, worktree: sandbox, sandbox, vcs: "git" as const }
        }

        const topLevel = yield* git(["rev-parse", "--show-toplevel"], { cwd: sandbox })
        if (topLevel.code !== 0) {
          return {
            id,
            worktree: sandbox,
            sandbox,
            vcs: fakeVcs,
          }
        }
        sandbox = resolveGitPath(sandbox, topLevel.text.trim())

        return { id, sandbox, worktree, vcs: "git" as const }
      })

      // Phase 2: atomic select + upsert inside an immediate transaction so
      // concurrent addSandbox/update calls cannot be clobbered, and without
      // persisting transient fs.exists failures that would drop sandboxes.
      const { result, discoveredTarget } = yield* Effect.sync(() =>
        Database.transaction(
          (trx) => {
            const row = trx.select().from(ProjectTable).where(eq(ProjectTable.id, data.id)).get()
            const existing = row
              ? fromRow(row)
              : {
                  id: data.id,
                  worktree: data.worktree,
                  vcs: data.vcs,
                  sandboxes: [] as string[],
                  time: { created: Date.now(), updated: Date.now() },
                }

            const sandboxes = [...existing.sandboxes]
            if (data.sandbox !== existing.worktree && !sandboxes.includes(data.sandbox)) {
              sandboxes.push(data.sandbox)
            }

            const next: Info = {
              ...existing,
              worktree: data.worktree,
              vcs: data.vcs,
              sandboxes,
              time: { ...existing.time, updated: Date.now() },
            }

            trx
              .insert(ProjectTable)
              .values({
                id: next.id,
                worktree: next.worktree,
                vcs: next.vcs ?? null,
                name: next.name,
                icon_url: next.icon?.url,
                icon_url_override: next.icon?.override,
                icon_color: next.icon?.color,
                time_created: next.time.created,
                time_updated: next.time.updated,
                time_initialized: next.time.initialized,
                sandboxes: next.sandboxes,
                commands: next.commands,
              })
              .onConflictDoUpdate({
                target: ProjectTable.id,
                set: {
                  worktree: next.worktree,
                  vcs: next.vcs ?? null,
                  time_updated: next.time.updated,
                  sandboxes: next.sandboxes,
                },
              })
              .run()

            return { result: next, discoveredTarget: existing }
          },
          { behavior: "immediate" },
        ),
      )

      if (Flag.OPENCODE_EXPERIMENTAL_ICON_DISCOVERY) {
        yield* discover(discoveredTarget).pipe(Effect.ignore, Effect.forkIn(scope))
      }

      if (data.id !== ProjectID.global) {
        yield* db((d) =>
          d
            .update(SessionTable)
            .set({ project_id: data.id })
            .where(and(eq(SessionTable.project_id, ProjectID.global), eq(SessionTable.directory, data.worktree)))
            .run(),
        )
      }

      yield* emitUpdated(result)
      return { project: result, sandbox: data.sandbox }
    })

    const discover = Effect.fn("Project.discover")(function* (input: Info) {
      if (input.vcs !== "git") return
      if (input.icon?.override) return
      if (input.icon?.url) return

      const matches = yield* fs
        .glob("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
          cwd: input.worktree,
          absolute: true,
          include: "file",
        })
        .pipe(Effect.orDie)

      let shortest: string | undefined
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i]
        if (match && (!shortest || match.length < shortest.length)) {
          shortest = match
        }
      }

      if (!shortest) return

      const buffer = yield* fs.readFile(shortest).pipe(Effect.orDie)
      const base64 = Buffer.from(buffer).toString("base64")
      const mime = AppFileSystem.mimeType(shortest)
      const url = `data:${mime};base64,${base64}`
      yield* update({ projectID: input.id, icon: { url } })
    })

    const list = Effect.fn("Project.list")(function* () {
      return yield* db((d) => d.select().from(ProjectTable).all().map(fromRow))
    })

    const get = Effect.fn("Project.get")(function* (id: ProjectID) {
      const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
      return row ? fromRow(row) : undefined
    })

    const update = Effect.fn("Project.update")(function* (input: UpdateInput) {
      const result = yield* db((d) =>
        d
          .update(ProjectTable)
          .set({
            name: input.name,
            icon_url: input.icon?.url,
            icon_url_override: input.icon?.override,
            icon_color: input.icon?.color,
            commands: input.commands,
            time_updated: Date.now(),
          })
          .where(eq(ProjectTable.id, input.projectID))
          .returning()
          .get(),
      )
      if (!result) throw new Error(`Project not found: ${input.projectID}`)
      const data = fromRow(result)
      yield* emitUpdated(data)
      return data
    })

    const initGit = Effect.fn("Project.initGit")(function* (input: { directory: string; project: Info }) {
      if (input.project.vcs === "git") return input.project
      if (!(yield* Effect.sync(() => which("git")))) throw new Error("Git is not installed")
      const result = yield* git(["init", "--quiet"], { cwd: input.directory })
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.text.trim() || "Failed to initialize git repository")
      }
      const { project } = yield* fromDirectory(input.directory)
      return project
    })

    const setInitialized = Effect.fn("Project.setInitialized")(function* (id: ProjectID) {
      yield* db((d) =>
        d.update(ProjectTable).set({ time_initialized: Date.now() }).where(eq(ProjectTable.id, id)).run(),
      )
    })

    const initState = yield* InstanceState.make(
      Effect.fn("Project.initState")(function* (ctx) {
        yield* bus.subscribe(Command.Event.Executed).pipe(
          Stream.runForEach((payload) =>
            payload.properties.name === Command.Default.INIT ? setInitialized(ctx.project.id) : Effect.void,
          ),
          Effect.forkScoped,
        )
      }),
    )

    const init = Effect.fn("Project.init")(function* () {
      yield* InstanceState.get(initState)
    })

    const sandboxes = Effect.fn("Project.sandboxes")(function* (id: ProjectID) {
      const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
      if (!row) return []
      const data = fromRow(row)
      return yield* Effect.forEach(
        data.sandboxes,
        (dir) =>
          fs.isDir(dir).pipe(
            Effect.orDie,
            Effect.map((ok) => (ok ? dir : undefined)),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))
    })

    const addSandbox = Effect.fn("Project.addSandbox")(function* (id: ProjectID, directory: string) {
      // Select + mutate + update inside one immediate transaction: concurrent
      // worktree creation can otherwise interleave and permanently drop a
      // sandbox entry from the list.
      const result = yield* Effect.sync(() =>
        Database.transaction(
          (trx) => {
            const row = trx.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get()
            if (!row) throw new Error(`Project not found: ${id}`)
            const sboxes = [...row.sandboxes]
            if (!sboxes.includes(directory)) sboxes.push(directory)
            return trx
              .update(ProjectTable)
              .set({ sandboxes: sboxes, time_updated: Date.now() })
              .where(eq(ProjectTable.id, id))
              .returning()
              .get()
          },
          { behavior: "immediate" },
        ),
      )
      if (!result) throw new Error(`Project not found: ${id}`)
      yield* emitUpdated(fromRow(result))
    })

    const removeSandbox = Effect.fn("Project.removeSandbox")(function* (id: ProjectID, directory: string) {
      // Select + mutate + update inside one immediate transaction (see addSandbox).
      const result = yield* Effect.sync(() =>
        Database.transaction(
          (trx) => {
            const row = trx.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get()
            if (!row) throw new Error(`Project not found: ${id}`)
            const sboxes = row.sandboxes.filter((s) => s !== directory)
            return trx
              .update(ProjectTable)
              .set({ sandboxes: sboxes, time_updated: Date.now() })
              .where(eq(ProjectTable.id, id))
              .returning()
              .get()
          },
          { behavior: "immediate" },
        ),
      )
      if (!result) throw new Error(`Project not found: ${id}`)
      yield* emitUpdated(fromRow(result))
    })

    return Service.of({
      init,
      fromDirectory,
      discover,
      list,
      get,
      update,
      initGit,
      setInitialized,
      sandboxes,
      addSandbox,
      removeSandbox,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Bus.defaultLayer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(NodePath.layer),
)

export const use = serviceUse(Service)

export function list() {
  return Database.use((db) =>
    db
      .select()
      .from(ProjectTable)
      .all()
      .map((row) => fromRow(row)),
  )
}

export function get(id: ProjectID): Info | undefined {
  const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
  if (!row) return undefined
  return fromRow(row)
}

export function setInitialized(id: ProjectID) {
  Database.use((db) =>
    db.update(ProjectTable).set({ time_initialized: Date.now() }).where(eq(ProjectTable.id, id)).run(),
  )
}

export * as Project from "./project"
