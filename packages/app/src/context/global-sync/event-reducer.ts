import { Binary } from "@opencode-ai/core/util/binary"
import { produce, reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type {
  Message,
  Part,
  PermissionRequest,
  Project,
  QuestionRequest,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import type { State, VcsCache } from "./types"
import { trimSessions } from "./session-trim"
import { dropSessionCaches } from "./session-cache"
import { diffs as list, message as clean } from "@/utils/diffs"

const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])

export function applyGlobalEvent(input: {
  event: { type: string; properties?: unknown }
  project: Project[]
  setGlobalProject: (next: Project[] | ((draft: Project[]) => Project[])) => void
  refresh: () => void
}) {
  if (input.event.type === "global.disposed" || input.event.type === "server.connected") {
    input.refresh()
    return
  }

  if (input.event.type !== "project.updated") return
  const properties = input.event.properties as Project
  const result = Binary.search(input.project, properties.id, (s) => s.id)
  if (result.found) {
    input.setGlobalProject(
      produce((draft) => {
        draft[result.index] = { ...draft[result.index], ...properties }
      }),
    )
    return
  }
  input.setGlobalProject(
    produce((draft) => {
      draft.splice(result.index, 0, properties)
    }),
  )
}

function cleanupSessionCaches(
  setStore: SetStoreFunction<State>,
  sessionID: string,
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void,
) {
  if (!sessionID) return
  setSessionTodo?.(sessionID, undefined)
  setStore(
    produce((draft) => {
      dropSessionCaches(draft, [sessionID])
    }),
  )
}

export function cleanupDroppedSessionCaches(
  store: Store<State>,
  setStore: SetStoreFunction<State>,
  next: Session[],
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void,
) {
  const keep = new Set(next.map((item) => item.id))
  const stale = [
    ...Object.keys(store.message),
    ...Object.keys(store.session_diff),
    ...Object.keys(store.todo),
    ...Object.keys(store.permission),
    ...Object.keys(store.question),
    ...Object.keys(store.session_status),
    ...Object.values(store.part)
      .map((parts) => parts?.find((part) => !!part?.sessionID)?.sessionID)
      .filter((sessionID): sessionID is string => !!sessionID),
  ].filter((sessionID, index, list) => !keep.has(sessionID) && list.indexOf(sessionID) === index)
  if (stale.length === 0) return
  for (const sessionID of stale) {
    setSessionTodo?.(sessionID, undefined)
  }
  setStore(
    produce((draft) => {
      dropSessionCaches(draft, stale)
    }),
  )
}

function sessionUpdatedAt(session: Session) {
  return session.time.updated ?? session.time.created
}

function handleSessionCreated(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  info: Session
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
}) {
  const result = Binary.search(input.store.session, input.info.id, (s) => s.id)
  if (result.found) {
    input.setStore("session", result.index, reconcile(input.info))
    return
  }
  const next = input.store.session.slice()
  next.splice(result.index, 0, input.info)
  const trimmed = trimSessions(next, { limit: input.store.limit, permission: input.store.permission })
  input.setStore("session", reconcile(trimmed, { key: "id" }))
  cleanupDroppedSessionCaches(input.store, input.setStore, trimmed, input.setSessionTodo)
  if (!input.info.parentID) input.setStore("sessionTotal", (value) => value + 1)
}

function handleSessionUpdated(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  info: Session
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
}) {
  const result = Binary.search(input.store.session, input.info.id, (s) => s.id)
  if (input.info.time.archived) {
    if (result.found) {
      input.setStore(
        "session",
        produce((draft) => {
          draft.splice(result.index, 1)
        }),
      )
    }
    cleanupSessionCaches(input.setStore, input.info.id, input.setSessionTodo)
    if (input.info.parentID) return
    input.setStore("sessionTotal", (value) => Math.max(0, value - 1))
    return
  }
  if (result.found) {
    input.setStore("session", result.index, reconcile(input.info))
    return
  }
  const next = input.store.session.slice()
  next.splice(result.index, 0, input.info)
  const trimmed = trimSessions(next, { limit: input.store.limit, permission: input.store.permission })
  input.setStore("session", reconcile(trimmed, { key: "id" }))
  cleanupDroppedSessionCaches(input.store, input.setStore, trimmed, input.setSessionTodo)
}

function handleSessionDeleted(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  info: Session
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
}) {
  const result = Binary.search(input.store.session, input.info.id, (s) => s.id)
  if (result.found) {
    input.setStore(
      "session",
      produce((draft) => {
        draft.splice(result.index, 1)
      }),
    )
  }
  cleanupSessionCaches(input.setStore, input.info.id, input.setSessionTodo)
  if (input.info.parentID) return
  input.setStore("sessionTotal", (value) => Math.max(0, value - 1))
}

function handleSessionDiff(input: {
  setStore: SetStoreFunction<State>
  sessionID: string
  diff: SnapshotFileDiff[]
}) {
  input.setStore("session_diff", input.sessionID, reconcile(list(input.diff), { key: "file" }))
}

function handleTodoUpdated(input: {
  setStore: SetStoreFunction<State>
  sessionID: string
  todos: Todo[]
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
}) {
  input.setStore("todo", input.sessionID, reconcile(input.todos, { key: "id" }))
  input.setSessionTodo?.(input.sessionID, input.todos)
}

function handleSessionStatus(input: {
  setStore: SetStoreFunction<State>
  sessionID: string
  status: SessionStatus
}) {
  input.setStore("session_status", input.sessionID, reconcile(input.status))
}

function handleMessageUpdated(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  info: Message
}) {
  const messages = input.store.message[input.info.sessionID]
  if (!messages) {
    input.setStore("message", input.info.sessionID, [input.info])
    return
  }
  const result = Binary.search(messages, input.info.id, (m) => m.id)
  if (result.found) {
    input.setStore("message", input.info.sessionID, result.index, reconcile(input.info))
    return
  }
  input.setStore(
    "message",
    input.info.sessionID,
    produce((draft) => {
      draft.splice(result.index, 0, input.info)
    }),
  )
}

function handleMessageRemoved(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  sessionID: string
  messageID: string
}) {
  input.setStore(
    produce((draft) => {
      const messages = draft.message[input.sessionID]
      if (messages) {
        const result = Binary.search(messages, input.messageID, (m) => m.id)
        if (result.found) messages.splice(result.index, 1)
      }
      delete draft.part[input.messageID]
    }),
  )
}

function handleMessagePartUpdated(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  part: Part
}) {
  if (SKIP_PARTS.has(input.part.type)) return
  const parts = input.store.part[input.part.messageID]
  if (!parts) {
    input.setStore("part", input.part.messageID, [input.part])
    return
  }
  const result = Binary.search(parts, input.part.id, (p) => p.id)
  if (result.found) {
    input.setStore("part", input.part.messageID, result.index, reconcile(input.part))
    return
  }
  input.setStore(
    "part",
    input.part.messageID,
    produce((draft) => {
      draft.splice(result.index, 0, input.part)
    }),
  )
}

function handleMessagePartRemoved(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  messageID: string
  partID: string
}) {
  const parts = input.store.part[input.messageID]
  if (!parts) return
  const result = Binary.search(parts, input.partID, (p) => p.id)
  if (!result.found) return
  input.setStore(
    produce((draft: any) => {
      const list = draft.part[input.messageID]
      if (!list) return
      const next = Binary.search(list as Part[], input.partID, (p) => p.id)
      if (!next.found) return
      list.splice(next.index, 1)
      if (list.length === 0) delete draft.part[input.messageID]
    }),
  )
}

function handleMessagePartDelta(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  messageID: string
  partID: string
  field: string
  delta: string
}) {
  const parts = input.store.part[input.messageID]
  if (!parts) return
  const result = Binary.search(parts, input.partID, (p) => p.id)
  if (!result.found) return
  input.setStore(
    "part",
    input.messageID,
    produce((draft) => {
      const part = draft[result.index]
      const field = input.field as keyof typeof part
      const existing = part[field] as string | undefined
      ;(part[field] as string) = (existing ?? "") + input.delta
    }),
  )
}

function handleVcsBranchUpdated(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  branch?: string
  vcsCache?: VcsCache
}) {
  if (input.store.vcs?.branch === input.branch) return
  const next = { ...input.store.vcs, branch: input.branch }
  input.setStore("vcs", next)
  if (input.vcsCache) input.vcsCache.setStore("value", next)
}

function handlePermissionAsked(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  permission: PermissionRequest
}) {
  const permissions = input.store.permission[input.permission.sessionID]
  if (!permissions) {
    input.setStore("permission", input.permission.sessionID, [input.permission])
    return
  }
  const result = Binary.search(permissions, input.permission.id, (p) => p.id)
  if (result.found) {
    input.setStore("permission", input.permission.sessionID, result.index, reconcile(input.permission))
    return
  }
  input.setStore(
    "permission",
    input.permission.sessionID,
    produce((draft) => {
      draft.splice(result.index, 0, input.permission)
    }),
  )
}

function handlePermissionReplied(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  sessionID: string
  requestID: string
}) {
  const permissions = input.store.permission[input.sessionID]
  if (!permissions) return
  const result = Binary.search(permissions, input.requestID, (p) => p.id)
  if (!result.found) return
  input.setStore(
    "permission",
    input.sessionID,
    produce((draft) => {
      draft.splice(result.index, 1)
    }),
  )
}

function handleQuestionAsked(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  question: QuestionRequest
}) {
  const questions = input.store.question[input.question.sessionID]
  if (!questions) {
    input.setStore("question", input.question.sessionID, [input.question])
    return
  }
  const result = Binary.search(questions, input.question.id, (q) => q.id)
  if (result.found) {
    input.setStore("question", input.question.sessionID, result.index, reconcile(input.question))
    return
  }
  input.setStore(
    "question",
    input.question.sessionID,
    produce((draft) => {
      draft.splice(result.index, 0, input.question)
    }),
  )
}

function handleQuestionRepliedRejected(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  sessionID: string
  requestID: string
}) {
  const questions = input.store.question[input.sessionID]
  if (!questions) return
  const result = Binary.search(questions, input.requestID, (q) => q.id)
  if (!result.found) return
  input.setStore(
    "question",
    input.sessionID,
    produce((draft) => {
      draft.splice(result.index, 1)
    }),
  )
}

export function applyDirectoryEvent(input: {
  event: { type: string; properties?: unknown }
  store: Store<State>
  setStore: SetStoreFunction<State>
  push: (directory: string) => void
  directory: string
  loadLsp: () => void
  vcsCache?: VcsCache
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
}) {
  const event = input.event
  switch (event.type) {
    case "server.instance.disposed": {
      input.push(input.directory)
      return
    }
    case "session.created": {
      handleSessionCreated({
        store: input.store,
        setStore: input.setStore,
        info: (event.properties as { info: Session }).info,
        setSessionTodo: input.setSessionTodo,
      })
      break
    }
    case "session.updated": {
      handleSessionUpdated({
        store: input.store,
        setStore: input.setStore,
        info: (event.properties as { info: Session }).info,
        setSessionTodo: input.setSessionTodo,
      })
      break
    }
    case "session.deleted": {
      handleSessionDeleted({
        store: input.store,
        setStore: input.setStore,
        info: (event.properties as { info: Session }).info,
        setSessionTodo: input.setSessionTodo,
      })
      break
    }
    case "session.diff": {
      const props = event.properties as { sessionID: string; diff: SnapshotFileDiff[] }
      handleSessionDiff({
        setStore: input.setStore,
        sessionID: props.sessionID,
        diff: props.diff,
      })
      break
    }
    case "todo.updated": {
      const props = event.properties as { sessionID: string; todos: Todo[] }
      handleTodoUpdated({
        setStore: input.setStore,
        sessionID: props.sessionID,
        todos: props.todos,
        setSessionTodo: input.setSessionTodo,
      })
      break
    }
    case "session.status": {
      const props = event.properties as { sessionID: string; status: SessionStatus }
      handleSessionStatus({
        setStore: input.setStore,
        sessionID: props.sessionID,
        status: props.status,
      })
      break
    }
    case "message.updated": {
      handleMessageUpdated({
        store: input.store,
        setStore: input.setStore,
        info: clean((event.properties as { info: Message }).info),
      })
      break
    }
    case "message.removed": {
      const props = event.properties as { sessionID: string; messageID: string }
      handleMessageRemoved({
        store: input.store,
        setStore: input.setStore,
        sessionID: props.sessionID,
        messageID: props.messageID,
      })
      break
    }
    case "message.part.updated": {
      handleMessagePartUpdated({
        store: input.store,
        setStore: input.setStore,
        part: (event.properties as { part: Part }).part,
      })
      break
    }
    case "message.part.removed": {
      const props = event.properties as { messageID: string; partID: string }
      handleMessagePartRemoved({
        store: input.store,
        setStore: input.setStore,
        messageID: props.messageID,
        partID: props.partID,
      })
      break
    }
    case "message.part.delta": {
      const props = event.properties as { messageID: string; partID: string; field: string; delta: string }
      handleMessagePartDelta({
        store: input.store,
        setStore: input.setStore,
        messageID: props.messageID,
        partID: props.partID,
        field: props.field,
        delta: props.delta,
      })
      break
    }
    case "vcs.branch.updated": {
      const props = event.properties as { branch?: string }
      handleVcsBranchUpdated({
        store: input.store,
        setStore: input.setStore,
        branch: props.branch,
        vcsCache: input.vcsCache,
      })
      break
    }
    case "permission.asked": {
      handlePermissionAsked({
        store: input.store,
        setStore: input.setStore,
        permission: event.properties as PermissionRequest,
      })
      break
    }
    case "permission.replied": {
      const props = event.properties as { sessionID: string; requestID: string }
      handlePermissionReplied({
        store: input.store,
        setStore: input.setStore,
        sessionID: props.sessionID,
        requestID: props.requestID,
      })
      break
    }
    case "question.asked": {
      handleQuestionAsked({
        store: input.store,
        setStore: input.setStore,
        question: event.properties as QuestionRequest,
      })
      break
    }
    case "question.replied":
    case "question.rejected": {
      const props = event.properties as { sessionID: string; requestID: string }
      handleQuestionRepliedRejected({
        store: input.store,
        setStore: input.setStore,
        sessionID: props.sessionID,
        requestID: props.requestID,
      })
      break
    }
    case "lsp.updated": {
      input.loadLsp()
      break
    }
  }
}
