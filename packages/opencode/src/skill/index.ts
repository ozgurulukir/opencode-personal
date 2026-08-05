import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { createHash } from "node:crypto"
import { Effect, Layer, Context, Schema } from "effect"
import { zod } from "@opencode-ai/core/effect-zod"
import { withStatics } from "@opencode-ai/core/schema"
import { NamedError } from "@opencode-ai/core/util/error"
import type { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { Permission } from "@/permission"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { Glob } from "@opencode-ai/core/util/glob"
import { Hash } from "@opencode-ai/core/util/hash"
import * as Log from "@opencode-ai/core/util/log"
import { Discovery } from "./discovery"
import { EmbeddingService, defaultLayer as embeddingDefaultLayer } from "@/search/embedding"
import { ZvecIndex } from "@/search/zvec"
import CUSTOMIZE_OPENCODE_SKILL_BODY from "./prompt/customize-opencode.md" with { type: "text" }

const log = Log.create({ service: "skill" })
const CLAUDE_EXTERNAL_DIR = ".claude"
const AGENTS_EXTERNAL_DIR = ".agents"
const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
const OPENCODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
const SKILL_PATTERN = "**/SKILL.md"

export const Event = {
  Loaded: BusEvent.define(
    "skill.loaded",
    Schema.Struct({
      name: Schema.String,
      location: Schema.String,
    }),
  ),
  Unloaded: BusEvent.define(
    "skill.unloaded",
    Schema.Struct({
      name: Schema.String,
      location: Schema.String,
    }),
  ),
  Warning: BusEvent.define(
    "skill.warning",
    Schema.Struct({
      name: Schema.String,
      location: Schema.String,
      message: Schema.String,
    }),
  ),
}

// Built-in skill that ships with opencode. The model's intuition for what an
// opencode.json should look like is often wrong, and opencode hard-fails on
// invalid config, so users hit cryptic startup errors. Loading this skill
// when the model is asked to touch opencode's own config files gives it the
// actual schemas instead of guesses.
const CUSTOMIZE_OPENCODE_SKILL_NAME = "customize-opencode"
const CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION =
  "Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing opencode agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself."

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  location: Schema.String,
  content: Schema.String,
  license: Schema.optional(Schema.String),
  compatibility: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  allowedTools: Schema.optional(Schema.String),
  warnings: Schema.optional(Schema.Array(Schema.String)),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export const InvalidError = NamedError.create(
  "SkillInvalidError",
  z.object({
    path: z.string(),
    message: z.string().optional(),
    issues: z.custom<z.core.$ZodIssue[]>().optional(),
  }),
)

export const NameMismatchError = NamedError.create(
  "SkillNameMismatchError",
  z.object({
    path: z.string(),
    expected: z.string(),
    actual: z.string(),
  }),
)

type State = {
  skills: Record<string, Info>
  dirs: Set<string>
  loadedSkills: Set<string>
  manifest: SkillManifest
}

type SkillManifest = {
  version: number
  skills: Record<string, { contentHash: string }>
}

type DiscoveryState = {
  matches: string[]
  dirs: string[]
}

type ScanState = {
  matches: Set<string>
  dirs: Set<string>
}

function skillContentHash(skill: Info): string {
  return createHash("sha1").update(`${skill.name}\n${skill.description}\n${skill.content}`).digest("hex")
}

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly all: () => Effect.Effect<Info[]>
  readonly allIncludingInvalid: () => Effect.Effect<Info[]>
  readonly dirs: () => Effect.Effect<string[]>
  readonly available: (agent?: Agent.Info) => Effect.Effect<Info[]>
  readonly markLoaded: (name: string) => Effect.Effect<void>
  readonly matchBySemantics: (
    userMessage: string,
    agent: Agent.Info,
    opts: { count: number; threshold: number },
  ) => Effect.Effect<Info[]>
}

const add = Effect.fnUntraced(function* (state: State, match: string, bus: Bus.Interface) {
  const md = yield* Effect.tryPromise({
    try: () => ConfigMarkdown.parse(match),
    catch: (err) => err,
  }).pipe(
    Effect.catch(
      Effect.fnUntraced(function* (err) {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        const { Session } = yield* Effect.promise(() => import("@/session/session"))
        yield* bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      }),
    ),
  )

  if (!md) return

  const folderName = path.basename(path.dirname(match))

  const FRONTMATTER_SCHEMA = z.object({
    name: z
      .string()
      .min(1, "name must not be empty")
      .max(64, "name must be ≤64 characters"),
    description: z
      .string()
      .max(1024, "description must be ≤1024 characters")
      .optional(),
    license: z.string().optional(),
    compatibility: z
      .string()
      .max(500, "compatibility must be ≤500 characters")
      .optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    "allowed-tools": z.string().optional(),
  })

  const parsed = FRONTMATTER_SCHEMA.safeParse(md.data)
  const warnings: string[] = []
  const rawName =
    typeof md.data?.name === "string" && md.data.name.length > 0 ? md.data.name : folderName

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    const message = `Invalid frontmatter: ${issues}`
    warnings.push(message)
    yield* bus.publish(Event.Warning, {
      name: rawName,
      location: match,
      message,
    })
    log.warn("skill schema invalid", { skill: match, issues: parsed.error.issues })
  }

  if (parsed.success && (!parsed.data.description || parsed.data.description.trim() === "")) {
    const message = "Missing or empty description"
    warnings.push(message)
    yield* bus.publish(Event.Warning, {
      name: parsed.data.name,
      location: match,
      message,
    })
    log.warn("skill missing description", { skill: match })
  }

  if (parsed.success && parsed.data.name !== folderName) {
    const message = `name "${parsed.data.name}" does not match folder "${folderName}"`
    warnings.push(message)
    yield* bus.publish(Event.Warning, {
      name: parsed.data.name,
      location: match,
      message,
    })
    log.warn("skill name does not match folder", { skill: match, expected: folderName, actual: parsed.data.name })
  }

  if (parsed.success && state.skills[parsed.data.name]) {
    const existing = state.skills[parsed.data.name]
    if (existing.location !== "<built-in>") {
      log.warn("duplicate skill name", {
        name: parsed.data.name,
        existing: existing.location,
        duplicate: match,
      })
    } else {
      log.warn("skill overridden by user disk skill", {
        name: parsed.data.name,
        builtin: existing.location,
        userSkill: match,
      })
    }
  }

  state.dirs.add(path.dirname(match))
  const skillName = parsed.success ? parsed.data.name : rawName
  state.skills[skillName] = {
    name: skillName,
    description: parsed.success ? (parsed.data.description ?? "") : "",
    location: match,
    content: md.content,
    license: parsed.success ? parsed.data.license : undefined,
    compatibility: parsed.success ? parsed.data.compatibility : undefined,
    metadata: parsed.success ? parsed.data.metadata : undefined,
    allowedTools: parsed.success ? parsed.data["allowed-tools"] : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
  yield* bus.publish(Event.Loaded, { name: skillName, location: match })
})

const scan = Effect.fnUntraced(function* (
  state: ScanState,
  root: string,
  pattern: string,
  opts?: { dot?: boolean; scope?: string },
) {
  const matches = yield* Effect.tryPromise({
    try: () =>
      Glob.scan(pattern, {
        cwd: root,
        absolute: true,
        include: "file",
        symlink: true,
        dot: opts?.dot,
      }),
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) => {
      if (!opts?.scope) return Effect.die(error)
      log.error(`failed to scan ${opts.scope} skills`, { dir: root, error })
      return Effect.succeed([] as string[])
    }),
  )

  for (const match of matches) {
    state.matches.add(match)
    state.dirs.add(path.dirname(match))
  }
})

const discoverSkills = Effect.fnUntraced(function* (
  config: Config.Interface,
  discovery: Discovery.Interface,
  fsys: AppFileSystem.Interface,
  global: Global.Interface,
  directory: string,
  worktree: string,
) {
  const state: ScanState = { matches: new Set(), dirs: new Set() }

  const externalDirs: string[] = []
  if (!Flag.OPENCODE_DISABLE_EXTERNAL_SKILLS) {
    if (!Flag.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS) externalDirs.push(CLAUDE_EXTERNAL_DIR)
    externalDirs.push(AGENTS_EXTERNAL_DIR)

    for (const dir of externalDirs) {
      const root = path.join(global.home, dir)
      if (!(yield* fsys.isDir(root))) continue
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global" })
    }

    const upDirs = yield* fsys
      .up({ targets: externalDirs, start: directory, stop: worktree })
      .pipe(Effect.catch(() => Effect.succeed([] as string[])))

    for (const root of upDirs) {
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "project" })
    }
  }

  const configDirs = yield* config.directories()
  for (const dir of configDirs) {
    yield* scan(state, dir, OPENCODE_SKILL_PATTERN)
  }

  const cfg = yield* config.get()
  for (const item of cfg.skills?.paths ?? []) {
    const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
    const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
    if (!(yield* fsys.isDir(dir))) {
      log.warn("skill path not found", { path: dir })
      continue
    }

    yield* scan(state, dir, SKILL_PATTERN)
  }

  for (const url of cfg.skills?.urls ?? []) {
    const pulledDirs = yield* discovery.pull(url)
    for (const dir of pulledDirs) {
      yield* scan(state, dir, SKILL_PATTERN)
    }
  }

  return {
    matches: Array.from(state.matches),
    dirs: Array.from(state.dirs),
  }
})

const loadSkills = Effect.fnUntraced(function* (state: State, discovered: DiscoveryState, bus: Bus.Interface) {
  yield* Effect.forEach(discovered.matches, (match) => add(state, match, bus), {
    concurrency: "unbounded",
    discard: true,
  })

  log.info("init", { count: Object.keys(state.skills).length })
})

export class Service extends Context.Service<Service, Interface>()("@opencode/Skill") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* Discovery.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const fsys = yield* AppFileSystem.Service
    const global = yield* Global.Service
    const embedder = yield* EmbeddingService
    const discovered = yield* InstanceState.make(
      Effect.fn("Skill.discovery")(function* (ctx) {
        return yield* discoverSkills(config, discovery, fsys, global, ctx.directory, ctx.worktree)
      }),
    )

    const zvecIndex = yield* InstanceState.make(
      Effect.fn("Skill.zvecIndex")(function* () {
        const directory = yield* InstanceState.directory
        const dirHash = Hash.fast(directory)
        const indexPath = path.join(Global.Path.cache, "zvec", "skills", dirHash)
        yield* fsys.ensureDir(path.join(Global.Path.cache, "zvec", "skills")).pipe(Effect.catch(() => Effect.void))
        return new ZvecIndex(indexPath)
      }),
    )

    const state = yield* InstanceState.make(
      Effect.fn("Skill.state")(function* () {
        const directory = yield* InstanceState.directory
        const dirHash = Hash.fast(directory)
        const manifestPath = path.join(Global.Path.cache, "zvec", "skills", `${dirHash}_manifest.json`)

        const s: State = {
          skills: {},
          dirs: new Set(),
          loadedSkills: new Set(),
          manifest: { version: 1, skills: {} },
        }

        // Load persisted manifest
        const manifestExists = yield* fsys.existsSafe(manifestPath)
        if (manifestExists) {
          const raw = yield* fsys.readJson(manifestPath).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          )
          if (raw && typeof raw === "object" && (raw as any).version === 1 && (raw as any).skills) {
            s.manifest = raw as any
          }
        }

        // Register the built-in skill BEFORE disk discovery so a user-disk
        // skill with the same name can override it.
        if (Flag.OPENCODE_EXPERIMENTAL_CUSTOMIZE_SKILL) {
          s.skills[CUSTOMIZE_OPENCODE_SKILL_NAME] = {
            name: CUSTOMIZE_OPENCODE_SKILL_NAME,
            description: CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION,
            location: "<built-in>",
            content: CUSTOMIZE_OPENCODE_SKILL_BODY,
          }
        }
        yield* loadSkills(s, yield* InstanceState.get(discovered), bus)

        // Incremental indexing: find changed/new skills, embed, upsert to zvec
        const zi = yield* InstanceState.get(zvecIndex)
        const toIndex: Array<{ id: string; path: string; content: string; embedding: number[]; mtime: number }> = []
        const toDelete: string[] = []
        const currentNames = new Set(Object.keys(s.skills))

        for (const name of currentNames) {
          const sk = s.skills[name]
          const ch = skillContentHash(sk)
          const existing = s.manifest.skills[name]
          if (!existing || existing.contentHash !== ch) {
            toIndex.push({
              id: `skill:${name}`,
              path: sk.location,
              content: `${sk.name}\n${sk.description}\n${sk.content}`,
              embedding: [],
              mtime: Date.now(),
            })
          }
        }

        // Find deleted skills
        for (const cachedName of Object.keys(s.manifest.skills)) {
          if (!currentNames.has(cachedName)) {
            toDelete.push(`skill:${cachedName}`)
          }
        }

        // Delete removed skills from zvec
        if (toDelete.length > 0) {
          yield* zi.delete(toDelete).pipe(Effect.catch(() => Effect.void))
        }

        // Embed and index new/changed skills
        if (toIndex.length > 0) {
          const contents = toIndex.map((c) => c.content)
          const vectors = yield* embedder.embed(contents).pipe(Effect.orDie)
          const enriched = toIndex.map((c, i) => ({ ...c, embedding: vectors[i] }))
          yield* zi.index(enriched).pipe(Effect.catch(() => Effect.void))

          // Update manifest
          for (const c of toIndex) {
            const name = c.id.slice("skill:".length)
            s.manifest.skills[name] = { contentHash: skillContentHash(s.skills[name]) }
          }
        }

        // Remove deleted from manifest
        for (const id of toDelete) {
          const name = id.slice("skill:".length)
          delete s.manifest.skills[name]
          yield* bus.publish(Event.Unloaded, { name, location: s.skills[name]?.location ?? "" })
        }

        // Persist manifest
        yield* fsys.writeJson(manifestPath, s.manifest).pipe(Effect.catch(() => Effect.void))

        return s
      }),
    )

    const get = Effect.fn("Skill.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.skills[name]
    })

    const all = Effect.fn("Skill.all")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.skills).filter((skill) => !skill.warnings || skill.warnings.length === 0)
    })

    const allIncludingInvalid = Effect.fn("Skill.allIncludingInvalid")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.skills)
    })

    const dirs = Effect.fn("Skill.dirs")(function* () {
      return (yield* InstanceState.get(discovered)).dirs
    })

    const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
      const s = yield* InstanceState.get(state)
      const list = Object.values(s.skills)
        .filter((skill) => !skill.warnings || skill.warnings.length === 0)
        .toSorted((a, b) => a.name.localeCompare(b.name))
      if (!agent) return list
      return list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny")
    })

    const markLoaded = Effect.fn("Skill.markLoaded")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      s.loadedSkills.add(name)
    })

    const matchBySemantics = Effect.fn("Skill.matchBySemantics")(function* (
      userMessage: string,
      agent: Agent.Info,
      opts: { count: number; threshold: number },
    ) {
      const s = yield* InstanceState.get(state)
      const zi = yield* InstanceState.get(zvecIndex)

      const [queryVec] = yield* embedder.embed([userMessage]).pipe(Effect.orDie)
      const results = yield* zi.search(userMessage, queryVec, opts.count * 2).pipe(
        Effect.catch(() => Effect.succeed([] as Array<{ id: string; score: number; path: string; content: string }>)),
      )

      // Filter by loadedSkills, permission, and threshold
      const matched: Info[] = []
      for (const r of results) {
        const name = r.id.startsWith("skill:") ? r.id.slice("skill:".length) : ""
        if (!name || !s.skills[name]) continue
        if (s.loadedSkills.has(name)) continue
        if (r.score < opts.threshold) continue
        if (Permission.evaluate("skill", name, agent.permission).action === "deny") continue
        matched.push(s.skills[name])
        if (matched.length >= opts.count) break
      }

      return matched
    })

    return Service.of({ get, all, allIncludingInvalid, dirs, available, markLoaded, matchBySemantics })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Bus.layer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(embeddingDefaultLayer),
)

export function fmt(list: Info[], opts: { verbose: boolean }) {
  if (list.length === 0) {
    return "No skills are currently available."
  }
  if (opts.verbose) {
    return [
      "<available_skills>",
      ...list.flatMap((skill) => [
        "  <skill>",
        `    <name>${skill.name}</name>`,
        `    <description>${skill.description}</description>`,
        `    <location>${pathToFileURL(skill.location).href}</location>`,
        "  </skill>",
      ]),
      "</available_skills>",
    ].join("\n")
  }

  return [
    "## Available Skills",
    ...list.map((skill) => `- **${skill.name}**: ${skill.description}`),
  ].join("\n")
}

export * as Skill from "."
