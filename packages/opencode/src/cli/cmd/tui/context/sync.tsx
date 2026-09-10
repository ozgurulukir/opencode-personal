import type {
  Agent,
  Provider,
  Session,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "@tui/context/project"
import { useEvent } from "@tui/context/event"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@opencode-ai/core/util/binary"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onMount } from "solid-js"
import * as Log from "@opencode-ai/core/util/log"
import { emptyConsoleState, type ConsoleState } from "@/config/console-state"
import path from "path"
import { useKV } from "./kv"
import { aggregateFailures } from "./aggregate-failures"
import type { SyncStore } from "./sync-schema"

// V2 event timestamps are declared as epoch millis on the wire and
// SyncEvent.process now encodes DateTime instances to millis at publish.
// Kept as a cheap normalizer because legacy EventTable rows (experimental
// workspaces replay) still carry ISO strings from before that fix.
function eventTime(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Date.parse(value)
  if (value && typeof value === "object" && "epochMilliseconds" in value)
    return (value as { epochMilliseconds: number }).epochMilliseconds
  return Date.now()
}

function activeAssistant(messages: SessionMessage[]) {
  const index = messages.findIndex((message) => message.type === "assistant" && !message.time.completed)
  if (index < 0) return
  const assistant = messages[index]
  return assistant?.type === "assistant" ? assistant : undefined
}

function activeCompaction(messages: SessionMessage[]) {
  const index = messages.findIndex((message) => message.type === "compaction")
  if (index < 0) return
  const compaction = messages[index]
  return compaction?.type === "compaction" ? compaction : undefined
}

function activeShell(messages: SessionMessage[], callID: string) {
  const index = messages.findIndex((message) => message.type === "shell" && message.callID === callID)
  if (index < 0) return
  const shell = messages[index]
  return shell?.type === "shell" ? shell : undefined
}

function latestTool(assistant: SessionMessageAssistant | undefined, callID?: string) {
  return assistant?.content.findLast(
    (item): item is SessionMessageAssistantTool => item.type === "tool" && (callID === undefined || item.id === callID),
  )
}

function latestText(assistant: SessionMessageAssistant | undefined) {
  return assistant?.content.findLast((item): item is SessionMessageAssistantText => item.type === "text")
}

function latestReasoning(assistant: SessionMessageAssistant | undefined, reasoningID: string) {
  return assistant?.content.findLast(
    (item): item is SessionMessageAssistantReasoning => item.type === "reasoning" && item.id === reasoningID,
  )
}

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<SyncStore>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      console_state: emptyConsoleState,
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
      messages: {},
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()
    const kv = useKV()

    function update(sessionID: string, fn: (messages: SessionMessage[]) => void) {
      setStore(
        "messages",
        produce((draft) => {
          fn((draft[sessionID] ??= []))
        }),
      )
    }

    const fullSyncedSessions = new Set<string>()
    let syncedWorkspace = project.workspace.current()

    function sessionListQuery(): { scope?: "project"; path?: string } {
      if (!kv.get("session_directory_filter_enabled", true)) return { scope: "project" }
      if (!project.data.instance.path.worktree || !project.data.instance.path.directory) return { scope: "project" }
      return {
        path: path
          .relative(path.resolve(project.data.instance.path.worktree), project.data.instance.path.directory)
          .replaceAll("\\", "/"),
      }
    }

    function listSessions() {
      return sdk.client.v2.session
        .list({ start: Date.now() - 30 * 24 * 60 * 60 * 1000, ...sessionListQuery() })
        .then((x) => (x.data?.items ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))
    }

    event.subscribe((event) => {
      switch (event.type) {
        case "server.instance.disposed":
          void bootstrap()
          break
        case "session.next.permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "session.next.permission.asked": {
          // Native V2 permission events intentionally keep the established
          // PermissionRequest payload under `request`; the SDK types it unknown.
          const request = event.properties.request as PermissionRequest
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "session.next.todo":
          // Lifecycle payloads are intentionally loose in the SDK because the
          // established todo/session/diff shapes are reused at this boundary.
          setStore("todo", event.properties.sessionID, event.properties.todos as Todo[])
          break

        case "session.next.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff as Snapshot.FileDiff[])
          break

        case "session.next.deleted": {
          const info = event.properties.info as Session
          const result = Binary.search(store.session, info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.next.updated": {
          // The session.next.updated `info` is a partial patch (e.g. `{title}`,
          // `{summary, time, revert}`), NOT a full session — it has no `id`.
          // Reconcile by the event's sessionID and merge the patch into the
          // existing entry so unrelated session fields survive. Searching by
          // `info.id` (undefined for partial patches) would fail to find the
          // session and mis-insert a broken entry, leaving sessions stale — e.g.
          // the TUI never learns about a `session.revert`, so undo can't clear
          // the screen back to the previous state.
          const info = event.properties.info as Partial<Session>
          const sessionID = (event.properties.sessionID as string | undefined) ?? info.id
          if (!sessionID) break
          if (info.time?.archived) {
            setStore(
              "session",
              produce((draft) => {
                const index = draft.findIndex((s) => s.id === sessionID)
                if (index >= 0) draft.splice(index, 1)
              }),
            )
            break
          }
          setStore(
            "session",
            produce((draft) => {
              const match = draft.find((s) => s.id === sessionID)
              if (match) {
                Object.assign(match, info, {
                  id: sessionID,
                  ...(info.time ? { time: { ...match.time, ...info.time } } : {}),
                })
                return
              }
            }),
          )
          break
        }

        case "session.next.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status as SessionStatus)
          break
        }

        case "session.next.prompted": {
          update(event.properties.sessionID, (draft) => {
            draft.unshift({
              id: event.id,
              type: "user",
              text: event.properties.prompt.text,
              files: event.properties.prompt.files,
              agents: event.properties.prompt.agents,
              subtask: event.properties.prompt.subtask,
              agent: event.properties.agent,
              model: event.properties.model,
              time: { created: eventTime(event.properties.timestamp) },
            })
          })
          break
        }
        case "session.next.synthetic":
          update(event.properties.sessionID, (draft) => {
            draft.unshift({
              id: event.id,
              type: "synthetic",
              sessionID: event.properties.sessionID,
              text: event.properties.text,
              time: { created: eventTime(event.properties.timestamp) },
            })
          })
          break
        case "session.next.shell.started":
          update(event.properties.sessionID, (draft) => {
            draft.unshift({
              id: event.id,
              type: "shell",
              callID: event.properties.callID,
              command: event.properties.command,
              output: "",
              time: { created: eventTime(event.properties.timestamp) },
            })
          })
          break
        case "session.next.shell.ended":
          update(event.properties.sessionID, (draft) => {
            const match = activeShell(draft, event.properties.callID)
            if (!match) return
            match.output = event.properties.output
            match.time.completed = eventTime(event.properties.timestamp)
          })
          break
        case "session.next.step.started":
          update(event.properties.sessionID, (draft) => {
            const currentAssistant = activeAssistant(draft)
            if (currentAssistant) currentAssistant.time.completed = eventTime(event.properties.timestamp)
            draft.unshift({
              id: event.id,
              type: "assistant",
              agent: event.properties.agent,
              model: event.properties.model,
              content: [],
              snapshot: event.properties.snapshot ? { start: event.properties.snapshot } : undefined,
              time: { created: eventTime(event.properties.timestamp) },
            })
          })
          break
        case "session.next.step.ended":
          update(event.properties.sessionID, (draft) => {
            const currentAssistant = activeAssistant(draft)
            if (!currentAssistant) return
            currentAssistant.time.completed = eventTime(event.properties.timestamp)
            currentAssistant.finish = event.properties.finish
            currentAssistant.cost = event.properties.cost
            currentAssistant.tokens = event.properties.tokens
            if (event.properties.snapshot)
              currentAssistant.snapshot = { ...currentAssistant.snapshot, end: event.properties.snapshot }
          })
          break
        case "session.next.step.failed":
          update(event.properties.sessionID, (draft) => {
            const currentAssistant = activeAssistant(draft)
            if (!currentAssistant) return
            currentAssistant.time.completed = eventTime(event.properties.timestamp)
            currentAssistant.finish = "error"
            currentAssistant.error = event.properties.error
          })
          break
        case "session.next.text.started":
          update(event.properties.sessionID, (draft) => {
            activeAssistant(draft)?.content.push({ type: "text", text: "" })
          })
          break
        case "session.next.text.delta":
          update(event.properties.sessionID, (draft) => {
            const match = latestText(activeAssistant(draft))
            if (match) match.text += event.properties.delta
          })
          break
        case "session.next.text.ended":
          update(event.properties.sessionID, (draft) => {
            const match = latestText(activeAssistant(draft))
            if (match) match.text = event.properties.text
          })
          break
        case "session.next.tool.input.started":
          update(event.properties.sessionID, (draft) => {
            activeAssistant(draft)?.content.push({
              type: "tool",
              id: event.properties.callID,
              name: event.properties.name,
              time: { created: eventTime(event.properties.timestamp) },
              state: { status: "pending", input: "" },
            })
          })
          break
        case "session.next.tool.input.delta":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), event.properties.callID)
            if (match?.state.status === "pending") match.state.input += event.properties.delta
          })
          break
        case "session.next.tool.input.ended":
          break
        case "session.next.tool.called":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), event.properties.callID)
            if (!match) return
            match.time.ran = eventTime(event.properties.timestamp)
            match.provider = event.properties.provider
            match.state = { status: "running", input: event.properties.input, structured: {}, content: [] }
          })
          break
        case "session.next.tool.progress":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), event.properties.callID)
            if (match?.state.status !== "running") return
            match.state.structured = event.properties.structured
            match.state.content = [...event.properties.content]
          })
          break
        case "session.next.tool.success":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), event.properties.callID)
            if (match?.state.status !== "running") return
            match.state = {
              status: "completed",
              input: match.state.input,
              structured: event.properties.structured,
              content: [...event.properties.content],
            }
            match.provider = event.properties.provider
            match.time.completed = eventTime(event.properties.timestamp)
          })
          break
        case "session.next.tool.failed":
          update(event.properties.sessionID, (draft) => {
            const match = latestTool(activeAssistant(draft), event.properties.callID)
            if (match?.state.status !== "running") return
            match.state = {
              status: "error",
              error: event.properties.error,
              input: match.state.input,
              structured: match.state.structured,
              content: match.state.content,
            }
            match.provider = event.properties.provider
            match.time.completed = eventTime(event.properties.timestamp)
          })
          break
        case "session.next.reasoning.started":
          update(event.properties.sessionID, (draft) => {
            activeAssistant(draft)?.content.push({
              type: "reasoning",
              id: event.properties.reasoningID,
              text: "",
            })
          })
          break
        case "session.next.reasoning.delta":
          update(event.properties.sessionID, (draft) => {
            const match = latestReasoning(activeAssistant(draft), event.properties.reasoningID)
            if (match) match.text += event.properties.delta
          })
          break
        case "session.next.reasoning.ended":
          update(event.properties.sessionID, (draft) => {
            const match = latestReasoning(activeAssistant(draft), event.properties.reasoningID)
            if (match) match.text = event.properties.text
          })
          break
        case "session.next.retried":
          break
        case "session.next.compaction.started":
          update(event.properties.sessionID, (draft) => {
            draft.unshift({
              id: event.id,
              type: "compaction",
              reason: event.properties.reason,
              summary: "",
              time: { created: eventTime(event.properties.timestamp) },
            })
          })
          break
        case "session.next.compaction.delta":
          update(event.properties.sessionID, (draft) => {
            const match = activeCompaction(draft)
            if (match) match.summary += event.properties.text
          })
          break
        case "session.next.compaction.ended":
          update(event.properties.sessionID, (draft) => {
            const match = activeCompaction(draft)
            if (!match) return
            match.summary = event.properties.text
            match.include = event.properties.include
          })
          break

        case "lsp.updated": {
          const workspace = project.workspace.current()
          void sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", x.data ?? []))
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap(input: { fatal?: boolean } = {}) {
      const fatal = input.fatal ?? true
      const workspace = project.workspace.current()
      if (workspace !== syncedWorkspace) {
        fullSyncedSessions.clear()
        syncedWorkspace = workspace
      }
      const projectPromise = project.sync()
      const sessionListPromise = projectPromise.then(() => listSessions())

      // blocking - include session.list when continuing a session
      const providersPromise = sdk.client.config.providers({ workspace }, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({ workspace }, { throwOnError: true })
      const consoleStatePromise = sdk.client.experimental.console
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => emptyConsoleState)
      const agentsPromise = sdk.client.app.agents({ workspace }, { throwOnError: true })
      const configPromise = sdk.client.config.get({ workspace }, { throwOnError: true })
      const blockingRequests: { name: string; promise: Promise<unknown> }[] = [
        { name: "config.providers", promise: providersPromise },
        { name: "provider.list", promise: providerListPromise },
        { name: "app.agents", promise: agentsPromise },
        { name: "config.get", promise: configPromise },
        { name: "project.sync", promise: projectPromise },
        ...(args.continue ? [{ name: "session.list", promise: sessionListPromise }] : []),
      ]

      await Promise.allSettled(blockingRequests.map((r) => r.promise))
        .then((settled) => {
          // Surface every failed endpoint in one labeled message instead of
          // letting the first rejection drown its siblings as unhandled
          // rejections.
          const failure = aggregateFailures(blockingRequests.map((r, i) => ({ name: r.name, result: settled[i] })))
          if (failure) throw failure
        })
        .then(async () => {
          const providersResponse = providersPromise.then((x) => x.data!)
          const providerListResponse = providerListPromise.then((x) => x.data!)
          const consoleStateResponse = consoleStatePromise
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data!)
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          return Promise.all([
            providersResponse,
            providerListResponse,
            consoleStateResponse,
            agentsResponse,
            configResponse,
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const providers = responses[0]
            const providerList = responses[1]
            const consoleState = responses[2]
            const agents = responses[3]
            const config = responses[4]
            const sessions = responses[5]

            batch(() => {
              setStore("provider", reconcile(providers.providers))
              setStore("provider_default", reconcile(providers.default))
              setStore("provider_next", reconcile(providerList))
              setStore("console_state", reconcile(consoleState))
              setStore("agent", reconcile(agents))
              setStore("config", reconcile(config))
              if (sessions !== undefined) setStore("session", reconcile(sessions))
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          void Promise.all([
            ...(args.continue ? [] : [sessionListPromise.then((sessions) => setStore("session", reconcile(sessions)))]),
            consoleStatePromise.then((consoleState) => setStore("console_state", reconcile(consoleState))),
            sdk.client.command.list({ workspace }).then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", reconcile(x.data ?? []))),
            sdk.client.mcp.status({ workspace }).then((x) => setStore("mcp", reconcile(x.data ?? {}))),
            sdk.client.experimental.resource
              .list({ workspace })
              .then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status({ workspace }).then((x) => setStore("formatter", reconcile(x.data ?? []))),
            sdk.client.v2.session.status({ workspace }).then((x) => {
              setStore("session_status", reconcile(x.data ?? {}))
            }),
            sdk.client.provider.auth({ workspace }).then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get({ workspace }).then((x) => setStore("vcs", reconcile(x.data))),
            project.workspace.sync(),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          Log.Default.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          if (fatal) {
            await exit(e)
          } else {
            throw e
          }
        })
    }

    onMount(() => {
      void bootstrap()
    })

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        if (process.env.OPENCODE_FAST_BOOT) return true
        return store.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        query() {
          return sessionListQuery()
        },
        async refresh() {
          const list = await listSessions()
          setStore("session", reconcile(list))
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          // V2 slice is newest-first and also carries shell/synthetic/compaction
          // records the V1 message slice never had — consider only user/assistant
          // messages so the working/idle semantics stay identical.
          const last = (store.messages[sessionID] ?? []).find((m) => m.type === "user" || m.type === "assistant")
          if (!last) return "idle"
          if (last.type === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) return
          const [session, todo, diff, v2messages] = await Promise.all([
            sdk.client.v2.session.get({ sessionID }, { throwOnError: true }),
            sdk.client.v2.session.todo({ sessionID }),
            sdk.client.v2.session.diff({ sessionID }),
            sdk.client.v2.session.messages({ sessionID }),
          ])
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session[match.index] = session.data!
              if (!match.found) draft.session.splice(match.index, 0, session.data!)
              draft.todo[sessionID] = todo.data ?? []
              draft.session_diff[sessionID] = diff.data ?? []
              // V2 read model: newest-first, same order the session.next.*
              // handlers maintain via unshift.
              draft.messages[sessionID] = v2messages.data?.items ?? []
            }),
          )
          fullSyncedSessions.add(sessionID)
        },
        message: {
          async sync(sessionID: string) {
            const response = await sdk.client.v2.session.messages({ sessionID })
            setStore("messages", sessionID, reconcile(response.data?.items ?? []))
          },
          fromSession(sessionID: string) {
            const messages = store.messages[sessionID]
            if (!messages) return []
            return messages
          },
        },
      },
      bootstrap,
    }
    return result
  },
})

// Backwards-compatible alias: the former sync-v2 context is now unified here.
export const useSyncV2 = useSync
