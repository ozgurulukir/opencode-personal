import type { SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { ProjectTable } from "../project/project.sql"
import { SessionTable, MessageTable, PartTable, TodoTable, PermissionTable } from "../session/session.sql"
import { SessionShareTable } from "../share/share.sql"
import path from "path"
import { existsSync } from "fs"
import { Filesystem } from "@/util/filesystem"
import { Glob } from "@opencode-ai/core/util/glob"

const log = Log.create({ service: "json-migration" })

export type Progress = {
  current: number
  total: number
  label: string
}

type Options = {
  progress?: (event: Progress) => void
}

export async function run(db: SQLiteBunDatabase<any, any> | NodeSQLiteDatabase<any, any>, options?: Options) {
  const storageDir = path.join(Global.Path.data, "storage")

  if (!existsSync(storageDir)) {
    log.info("storage directory does not exist, skipping migration")
    return {
      projects: 0,
      sessions: 0,
      messages: 0,
      parts: 0,
      todos: 0,
      permissions: 0,
      shares: 0,
      errors: [] as string[],
    }
  }

  log.info("starting json to sqlite migration", { storageDir })
  const start = performance.now()

  // const db = drizzle({ client: sqlite })

  // Optimize SQLite for bulk inserts
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = OFF")
  db.run("PRAGMA cache_size = 10000")
  db.run("PRAGMA temp_store = MEMORY")
  const stats = {
    projects: 0,
    sessions: 0,
    messages: 0,
    parts: 0,
    todos: 0,
    permissions: 0,
    shares: 0,
    errors: [] as string[],
  }
  const orphans = {
    sessions: 0,
    todos: 0,
    permissions: 0,
    shares: 0,
  }
  const errs = stats.errors

  const batchSize = 1000
  const now = Date.now()

  async function list(pattern: string) {
    return Glob.scan(pattern, { cwd: storageDir, absolute: true })
  }

  async function read<T>(
    files: string[],
    start: number,
    end: number,
    map: (data: any, index: number) => T | undefined,
  ): Promise<T[]> {
    const count = end - start
    // oxlint-disable-next-line unicorn/no-new-array -- pre-allocated for index-based batch fill
    const tasks = new Array(count)
    for (let i = 0; i < count; i++) {
      const fileIdx = start + i
      tasks[i] = Filesystem.readJson(files[fileIdx]).then((data) => map(data, fileIdx))
    }
    const results = await Promise.allSettled(tasks)
    const items: T[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === "fulfilled") {
        if (result.value !== undefined) {
          items.push(result.value)
        }
        continue
      }
      errs.push(`failed to read ${files[start + i]}: ${result.reason}`)
    }
    return items
  }

  function insert(values: unknown[], table: Parameters<typeof db.insert>[0], label: string) {
    if (values.length === 0) return 0
    try {
      db.insert(table).values(values).onConflictDoNothing().run()
      return values.length
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errs.push(`failed to migrate ${label} batch: ${msg}`)
      return 0
    }
  }

  // Pre-scan all files upfront to avoid repeated glob operations
  log.info("scanning files...")
  const [projectFiles, sessionFiles, messageFiles, partFiles, todoFiles, permFiles, shareFiles] = await Promise.all([
    list("project/*.json"),
    list("session/*/*.json"),
    list("message/*/*.json"),
    list("part/*/*.json"),
    list("todo/*.json"),
    list("permission/*.json"),
    list("session_share/*.json"),
  ])

  log.info("file scan complete", {
    projects: projectFiles.length,
    sessions: sessionFiles.length,
    messages: messageFiles.length,
    parts: partFiles.length,
    todos: todoFiles.length,
    permissions: permFiles.length,
    shares: shareFiles.length,
  })

  const total = Math.max(
    1,
    projectFiles.length +
      sessionFiles.length +
      messageFiles.length +
      partFiles.length +
      todoFiles.length +
      permFiles.length +
      shareFiles.length,
  )
  const progress = options?.progress
  let current = 0
  const step = (label: string, count: number) => {
    current = Math.min(total, current + count)
    progress?.({ current, total, label })
  }

  progress?.({ current, total, label: "starting" })

  db.run("BEGIN TRANSACTION")

  // Migrate projects first (no FK deps)
  // Derive all IDs from file paths, not JSON content
  const projectIds = new Set<string>()
  for (let i = 0; i < projectFiles.length; i += batchSize) {
    const end = Math.min(i + batchSize, projectFiles.length)
    const values = await read(projectFiles, i, end, (data, idx) => {
      if (!data) return undefined
      const id = path.basename(projectFiles[idx], ".json")
      projectIds.add(id)
      return {
        id,
        worktree: data.worktree ?? "/",
        vcs: data.vcs,
        name: data.name ?? undefined,
        icon_url: data.icon?.url,
        icon_url_override: data.icon?.override,
        icon_color: data.icon?.color,
        time_created: data.time?.created ?? now,
        time_updated: data.time?.updated ?? now,
        time_initialized: data.time?.initialized,
        sandboxes: data.sandboxes ?? [],
        commands: data.commands,
      }
    })
    stats.projects += insert(values, ProjectTable, "project")
    step("projects", end - i)
  }
  log.info("migrated projects", { count: stats.projects, duration: Math.round(performance.now() - start) })

  // Migrate sessions (depends on projects)
  // Derive all IDs from directory/file paths, not JSON content, since earlier
  // migrations may have moved sessions to new directories without updating the JSON
  const sessionProjects = sessionFiles.map((file) => path.basename(path.dirname(file)))
  const sessionIds = new Set<string>()
  for (let i = 0; i < sessionFiles.length; i += batchSize) {
    const end = Math.min(i + batchSize, sessionFiles.length)
    let sessionOrphans = 0
    const values = await read(sessionFiles, i, end, (data, idx) => {
      if (!data) return undefined
      const id = path.basename(sessionFiles[idx], ".json")
      const projectID = sessionProjects[idx]
      if (!projectIds.has(projectID)) {
        sessionOrphans++
        return undefined
      }
      sessionIds.add(id)
      return {
        id,
        project_id: projectID,
        parent_id: data.parentID ?? null,
        slug: data.slug ?? "",
        directory: data.directory ?? "",
        path: data.path ?? null,
        title: data.title ?? "",
        version: data.version ?? "",
        share_url: data.share?.url ?? null,
        summary_additions: data.summary?.additions ?? null,
        summary_deletions: data.summary?.deletions ?? null,
        summary_files: data.summary?.files ?? null,
        summary_diffs: data.summary?.diffs ?? null,
        revert: data.revert ?? null,
        permission: data.permission ?? null,
        time_created: data.time?.created ?? now,
        time_updated: data.time?.updated ?? now,
        time_compacting: data.time?.compacting ?? null,
        time_archived: data.time?.archived ?? null,
      }
    })
    orphans.sessions += sessionOrphans
    stats.sessions += insert(values, SessionTable, "session")
    step("sessions", end - i)
  }
  log.info("migrated sessions", { count: stats.sessions })
  if (orphans.sessions > 0) {
    log.warn("skipped orphaned sessions", { count: orphans.sessions })
  }

  // Migrate messages using pre-scanned file map
  const allMessageFiles = [] as string[]
  const allMessageSessions = [] as string[]
  const messageSessions = new Map<string, string>()
  for (const file of messageFiles) {
    const sessionID = path.basename(path.dirname(file))
    if (!sessionIds.has(sessionID)) continue
    allMessageFiles.push(file)
    allMessageSessions.push(sessionID)
  }

  for (let i = 0; i < allMessageFiles.length; i += batchSize) {
    const end = Math.min(i + batchSize, allMessageFiles.length)
    const values = await read(allMessageFiles, i, end, (data, idx) => {
      if (!data) return undefined
      const file = allMessageFiles[idx]
      const id = path.basename(file, ".json")
      const sessionID = allMessageSessions[idx]
      messageSessions.set(id, sessionID)
      const rest = data
      delete rest.id
      delete rest.sessionID
      return {
        id,
        session_id: sessionID,
        time_created: data.time?.created ?? now,
        time_updated: data.time?.updated ?? now,
        data: rest,
      }
    })
    stats.messages += insert(values, MessageTable, "message")
    step("messages", end - i)
  }
  log.info("migrated messages", { count: stats.messages })

  // Migrate parts using pre-scanned file map
  for (let i = 0; i < partFiles.length; i += batchSize) {
    const end = Math.min(i + batchSize, partFiles.length)
    const partErrs = [] as string[]
    const values = await read(partFiles, i, end, (data, idx) => {
      if (!data) return undefined
      const file = partFiles[idx]
      const id = path.basename(file, ".json")
      const messageID = path.basename(path.dirname(file))
      const sessionID = messageSessions.get(messageID)
      if (!sessionID) {
        partErrs.push(`part missing message session: ${file}`)
        return undefined
      }
      if (!sessionIds.has(sessionID)) return undefined
      const rest = data
      delete rest.id
      delete rest.messageID
      delete rest.sessionID
      return {
        id,
        message_id: messageID,
        session_id: sessionID,
        time_created: data.time?.created ?? now,
        time_updated: data.time?.updated ?? now,
        data: rest,
      }
    })
    errs.push(...partErrs)
    stats.parts += insert(values, PartTable, "part")
    step("parts", end - i)
  }
  log.info("migrated parts", { count: stats.parts })

  // Migrate todos
  const todoSessions = todoFiles.map((file) => path.basename(file, ".json"))
  for (let i = 0; i < todoFiles.length; i += batchSize) {
    const end = Math.min(i + batchSize, todoFiles.length)
    let todoOrphans = 0
    const todoErrs = [] as string[]
    const batchValues = await read(todoFiles, i, end, (data, idx) => {
      if (!data) return undefined
      const sessionID = todoSessions[idx]
      if (!sessionIds.has(sessionID)) {
        todoOrphans++
        return undefined
      }
      if (!Array.isArray(data)) {
        todoErrs.push(`todo not an array: ${todoFiles[idx]}`)
        return undefined
      }
      const list = []
      for (let position = 0; position < data.length; position++) {
        const todo = data[position]
        if (!todo?.content || !todo?.status || !todo?.priority) continue
        list.push({
          session_id: sessionID,
          content: todo.content,
          status: todo.status,
          priority: todo.priority,
          position,
          time_created: now,
          time_updated: now,
        })
      }
      return list
    })
    orphans.todos += todoOrphans
    errs.push(...todoErrs)
    const values = batchValues.flat()
    stats.todos += insert(values, TodoTable, "todo")
    step("todos", end - i)
  }
  log.info("migrated todos", { count: stats.todos })
  if (orphans.todos > 0) {
    log.warn("skipped orphaned todos", { count: orphans.todos })
  }

  // Migrate permissions
  const permProjects = permFiles.map((file) => path.basename(file, ".json"))
  for (let i = 0; i < permFiles.length; i += batchSize) {
    const end = Math.min(i + batchSize, permFiles.length)
    let permOrphans = 0
    const values = await read(permFiles, i, end, (data, idx) => {
      if (!data) return undefined
      const projectID = permProjects[idx]
      if (!projectIds.has(projectID)) {
        permOrphans++
        return undefined
      }
      return { project_id: projectID, data }
    })
    orphans.permissions += permOrphans
    stats.permissions += insert(values, PermissionTable, "permission")
    step("permissions", end - i)
  }
  log.info("migrated permissions", { count: stats.permissions })
  if (orphans.permissions > 0) {
    log.warn("skipped orphaned permissions", { count: orphans.permissions })
  }

  // Migrate session shares
  const shareSessions = shareFiles.map((file) => path.basename(file, ".json"))
  for (let i = 0; i < shareFiles.length; i += batchSize) {
    const end = Math.min(i + batchSize, shareFiles.length)
    let shareOrphans = 0
    const shareErrs = [] as string[]
    const values = await read(shareFiles, i, end, (data, idx) => {
      if (!data) return undefined
      const sessionID = shareSessions[idx]
      if (!sessionIds.has(sessionID)) {
        shareOrphans++
        return undefined
      }
      if (!data?.id || !data?.secret || !data?.url) {
        shareErrs.push(`session_share missing id/secret/url: ${shareFiles[idx]}`)
        return undefined
      }
      return { session_id: sessionID, id: data.id, secret: data.secret, url: data.url }
    })
    orphans.shares += shareOrphans
    errs.push(...shareErrs)
    stats.shares += insert(values, SessionShareTable, "session_share")
    step("shares", end - i)
  }
  log.info("migrated session shares", { count: stats.shares })
  if (orphans.shares > 0) {
    log.warn("skipped orphaned session shares", { count: orphans.shares })
  }

  db.run("COMMIT")

  log.info("json migration complete", {
    projects: stats.projects,
    sessions: stats.sessions,
    messages: stats.messages,
    parts: stats.parts,
    todos: stats.todos,
    permissions: stats.permissions,
    shares: stats.shares,
    errorCount: stats.errors.length,
    duration: Math.round(performance.now() - start),
  })

  if (stats.errors.length > 0) {
    log.warn("migration errors", { errors: stats.errors.slice(0, 20) })
  }

  progress?.({ current: total, total, label: "complete" })

  return stats
}

export * as JsonMigration from "./json-migration"
