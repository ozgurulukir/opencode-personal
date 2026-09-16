import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { Event } from "@opencode-ai/sdk/v2"
import { WithInstance } from "../../src/project/with-instance"
import { tmpdir } from "../fixture/fixture"

type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
type RequestPermissionParams = Parameters<AgentSideConnection["requestPermission"]>[0]
type RequestPermissionResult = Awaited<ReturnType<AgentSideConnection["requestPermission"]>>

type GlobalEventEnvelope = {
  directory?: string
  payload?: Event
}

type EventController = {
  push: (event: GlobalEventEnvelope) => void
  close: () => void
}

function inProgressText(update: SessionUpdateParams["update"]) {
  if (update.sessionUpdate !== "tool_call_update") return undefined
  if (update.status !== "in_progress") return undefined
  if (!update.content || !Array.isArray(update.content)) return undefined
  const first = update.content[0]
  if (!first || first.type !== "content") return undefined
  if (first.content.type !== "text") return undefined
  return first.content.text
}

function isToolCallUpdate(
  update: SessionUpdateParams["update"],
): update is Extract<SessionUpdateParams["update"], { sessionUpdate: "tool_call_update" }> {
  return update.sessionUpdate === "tool_call_update"
}

function completedToolUpdate(sessionUpdates: SessionUpdateParams[], sessionId: string, callID: string) {
  return sessionUpdates
    .filter((u) => u.sessionId === sessionId)
    .map((u) => u.update)
    .filter(isToolCallUpdate)
    .find((u) => u.toolCallId === callID && u.status === "completed")
}

// V2 event factories — the global stream carries SessionEvent.* events
// (session.next.tool.*) instead of V1 message.part.updated parts.
let eventSequence = 0

function eventID(callID: string) {
  eventSequence += 1
  return `evt_${callID}_${eventSequence}`
}

function calledEvent(sessionId: string, cwd: string, callID: string, tool: string, input: Record<string, unknown>) {
  const payload: Event = {
    id: eventID(callID),
    type: "session.next.tool.called",
    properties: {
      timestamp: Date.now(),
      sessionID: sessionId,
      callID,
      tool,
      input,
      provider: { executed: false },
    },
  } as Event
  return { directory: cwd, payload }
}

function progressEvent(
  sessionId: string,
  cwd: string,
  callID: string,
  structured: Record<string, unknown> = {},
  content: Array<{ type: "text"; text: string }> = [],
): GlobalEventEnvelope {
  const payload: Event = {
    id: eventID(callID),
    type: "session.next.tool.progress",
    properties: {
      timestamp: Date.now(),
      sessionID: sessionId,
      callID,
      structured,
      content,
    },
  } as Event
  return { directory: cwd, payload }
}

function bashProgressEvent(
  sessionId: string,
  cwd: string,
  callID: string,
  output: string,
): GlobalEventEnvelope {
  return progressEvent(sessionId, cwd, callID, { output })
}

function successEvent(
  sessionId: string,
  cwd: string,
  callID: string,
  output: string,
  structured: Record<string, unknown> = {},
  attachments?: any[],
): GlobalEventEnvelope {
  const payload: Event = {
    id: eventID(callID),
    type: "session.next.tool.success",
    properties: {
      timestamp: Date.now(),
      sessionID: sessionId,
      callID,
      structured,
      content: [
        { type: "text", text: output },
        ...(attachments ?? []).map((a) => ({ type: "file" as const, uri: a.url, mime: a.mime, name: a.filename })),
      ],
      provider: { executed: false },
    },
  } as Event
  return { directory: cwd, payload }
}

function createEventStream() {
  const queue: GlobalEventEnvelope[] = []
  const waiters: Array<(value: GlobalEventEnvelope | undefined) => void> = []
  const state = { closed: false }

  const push = (event: GlobalEventEnvelope) => {
    const waiter = waiters.shift()
    if (waiter) {
      waiter(event)
      return
    }
    queue.push(event)
  }

  const close = () => {
    state.closed = true
    for (const waiter of waiters.splice(0)) {
      waiter(undefined)
    }
  }

  const stream = async function* (signal?: AbortSignal) {
    while (true) {
      if (signal?.aborted) return
      const next = queue.shift()
      if (next) {
        yield next
        continue
      }
      if (state.closed) return
      const value = await new Promise<GlobalEventEnvelope | undefined>((resolve) => {
        waiters.push(resolve)
        if (!signal) return
        signal.addEventListener("abort", () => resolve(undefined), { once: true })
      })
      if (!value) return
      yield value
    }
  }

  return { controller: { push, close } satisfies EventController, stream }
}

function createFakeAgent() {
  const updates = new Map<string, string[]>()
  const chunks = new Map<string, string>()
  const sessionUpdates: SessionUpdateParams[] = []
  const record = (sessionId: string, type: string) => {
    const list = updates.get(sessionId) ?? []
    list.push(type)
    updates.set(sessionId, list)
  }

  const connection = {
    async sessionUpdate(params: SessionUpdateParams) {
      sessionUpdates.push(params)
      const update = params.update
      const type = update?.sessionUpdate ?? "unknown"
      record(params.sessionId, type)
      if (update?.sessionUpdate === "agent_message_chunk") {
        const content = update.content
        if (content?.type !== "text") return
        if (typeof content.text !== "string") return
        chunks.set(params.sessionId, (chunks.get(params.sessionId) ?? "") + content.text)
      }
    },
    async requestPermission(_params: RequestPermissionParams): Promise<RequestPermissionResult> {
      return { outcome: { outcome: "selected", optionId: "once" } } as RequestPermissionResult
    },
  } as unknown as AgentSideConnection

  const { controller, stream } = createEventStream()
  const calls = {
    eventSubscribe: 0,
    sessionCreate: 0,
  }

  // V2 SDK surface: ACPSessionManager and the replay path read sdk.v2.session.*;
  // session.messages returns { data: { items } } in V2 (was { data: [] } in V1).
  const global = {
    event: async function (this: object, opts?: { signal?: AbortSignal }) {
      if (this !== global) throw new Error("global event receiver lost")
      calls.eventSubscribe++
      return { stream: stream(opts?.signal) }
    },
  }
  const sdk = {
    global,
    v2: {
      session: {
        create: async (_params?: any) => {
          calls.sessionCreate++
          return {
            data: {
              id: `ses_${calls.sessionCreate}`,
              directory: "/tmp/opencode-acp-test",
              time: { created: Date.now(), updated: Date.now() },
            },
          }
        },
        get: async (_params?: any) => {
          return {
            data: {
              id: "ses_1",
              directory: "/tmp/opencode-acp-test",
              time: { created: Date.now(), updated: Date.now() },
            },
          }
        },
        list: async () => ({ data: { items: [] } }),
        messages: async () => ({ data: { items: [] } }),
      },
    },
    session: {
      messages: async () => ({ data: { items: [] } }),
      message: async (params?: any) => {
        // Return a message with parts that can be looked up by partID
        return {
          data: {
            info: {
              role: "assistant",
            },
            parts: [
              {
                id: params?.messageID ? `${params.messageID}_part` : "part_1",
                type: "text",
                text: "",
              },
            ],
          },
        }
      },
    },
    permission: {
      respond: async () => {
        return { data: true }
      },
      reply: async () => {
        return { data: true }
      },
    },
    config: {
      providers: async () => {
        return {
          data: {
            providers: [
              {
                id: "opencode",
                name: "opencode",
                models: {
                  "big-pickle": { id: "big-pickle", name: "big-pickle" },
                },
              },
            ],
          },
        }
      },
    },
    app: {
      agents: async () => {
        return {
          data: [
            {
              name: "build",
              description: "build",
              mode: "agent",
            },
          ],
        }
      },
    },
    command: {
      list: async () => {
        return { data: [] }
      },
    },
    mcp: {
      add: async () => {
        return { data: true }
      },
    },
  } as any

  const agent = new ACP.Agent(connection, {
    sdk,
    defaultModel: { providerID: "opencode", modelID: "big-pickle" },
  } as any)

  const stop = () => {
    controller.close()
    ;(agent as any).eventAbort.abort()
  }

  return { agent, controller, calls, updates, chunks, sessionUpdates, stop, sdk, connection }
}

describe("acp.agent event subscription", () => {
  test("routes message.part.delta by the event sessionID (no cross-session pollution)", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, updates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"

        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const sessionB = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "session.next.text.delta",
            properties: {
              sessionID: sessionB,
              delta: "hello",
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 10))

        expect((updates.get(sessionA) ?? []).includes("agent_message_chunk")).toBe(false)
        expect((updates.get(sessionB) ?? []).includes("agent_message_chunk")).toBe(true)

        stop()
      },
    })
  })

  test("live stream emits only agent chunks (user content is replay-only)", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        // The live event loop carries only assistant-side V2 events
        // (text deltas, tool state). User content is replayed via the
        // session.messages path — the live loop must never emit user chunks.
        controller.push({
          directory: cwd,
          payload: {
            type: "session.next.text.delta",
            properties: { sessionID: sessionId, delta: "assistant streaming" },
          },
        } as any)
        await new Promise((r) => setTimeout(r, 20))

        const userChunks = sessionUpdates.filter(
          (u) => u.sessionId === sessionId && u.update.sessionUpdate === "user_message_chunk",
        )
        expect(userChunks).toHaveLength(0)

        const agentChunks = sessionUpdates.filter(
          (u) => u.sessionId === sessionId && u.update.sessionUpdate === "agent_message_chunk",
        )
        expect(agentChunks.length).toBeGreaterThanOrEqual(1)

        stop()
      },
    })
  })

  test("deduplicates raw and sync envelope copies of the same event", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, chunks, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const eventID = "evt_duplicate_text"
        const data = { sessionID: sessionId, delta: "assistant streaming" }

        controller.push({
          directory: cwd,
          payload: { id: eventID, type: "session.next.text.delta", properties: data },
        } as any)
        controller.push({
          id: eventID,
          directory: cwd,
          payload: {
            type: "sync",
            syncEvent: {
              id: eventID,
              type: "session.next.text.delta/1",
              data,
            },
          },
        } as any)
        await new Promise((r) => setTimeout(r, 20))

        expect(chunks.get(sessionId)).toBe("assistant streaming")
        stop()
      },
    })
  })

  test("forwards live shell commands and output", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const callID = "shell_1"

        controller.push({
          directory: cwd,
          payload: {
            id: "shell_started_1",
            type: "session.next.shell.started",
            properties: { timestamp: Date.now(), sessionID: sessionId, callID, command: "git status" },
          },
        } as any)
        controller.push({
          directory: cwd,
          payload: {
            id: "shell_ended_1",
            type: "session.next.shell.ended",
            properties: { timestamp: Date.now(), sessionID: sessionId, callID, output: "On branch main" },
          },
        } as any)
        await new Promise((r) => setTimeout(r, 20))

        try {
          const updates = sessionUpdates
            .filter((u) => u.sessionId === sessionId)
            .map((u) => u.update)
            .filter((u) => u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update")
          expect(updates.map((u) => u.sessionUpdate)).toEqual(["tool_call", "tool_call_update", "tool_call_update"])
          expect((updates[0] as any).title).toBe("git status")
          expect((updates[0] as any).rawInput).toEqual({ command: "git status" })
          expect((updates[0] as any).content).toContainEqual({
            type: "content",
            content: { type: "text", text: "$ git status" },
          })
          expect((updates[1] as any).rawInput).toEqual({ command: "git status" })
          expect((updates[2] as any).status).toBe("completed")
          expect((updates[2] as any).content).toContainEqual({
            type: "content",
            content: { type: "text", text: "On branch main" },
          })
        } finally {
          stop()
        }
      },
    })
  })

  test("keeps concurrent sessions isolated when message.part.delta events are interleaved", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, chunks, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"

        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const sessionB = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        const tokenA = ["ALPHA_", "111", "_X"]
        const tokenB = ["BETA_", "222", "_Y"]

        const push = (sessionId: string, _messageID: string, delta: string) => {
          controller.push({
            directory: cwd,
            payload: {
              type: "session.next.text.delta",
              properties: {
                sessionID: sessionId,
                delta,
              },
            },
          } as any)
        }

        push(sessionA, "msg_a", tokenA[0])
        push(sessionB, "msg_b", tokenB[0])
        push(sessionA, "msg_a", tokenA[1])
        push(sessionB, "msg_b", tokenB[1])
        push(sessionA, "msg_a", tokenA[2])
        push(sessionB, "msg_b", tokenB[2])

        await new Promise((r) => setTimeout(r, 20))

        const a = chunks.get(sessionA) ?? ""
        const b = chunks.get(sessionB) ?? ""

        expect(a).toContain(tokenA.join(""))
        expect(b).toContain(tokenB.join(""))
        for (const part of tokenB) expect(a).not.toContain(part)
        for (const part of tokenA) expect(b).not.toContain(part)

        stop()
      },
    })
  })

  test("does not create additional event subscriptions on repeated loadSession()", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, calls, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)

        expect(calls.eventSubscribe).toBe(1)

        stop()
      },
    })
  })

  test("permission.asked events are handled and replied", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const permissionReplies: string[] = []
        const { agent, controller, stop, sdk } = createFakeAgent()
        sdk.permission.reply = async (params: any) => {
          permissionReplies.push(params.requestID)
          return { data: true }
        }
        const cwd = "/tmp/opencode-acp-test"

        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "session.next.permission.asked",
            properties: {
              sessionID: sessionA,
              request: {
                id: "perm_1",
                sessionID: sessionA,
                permission: "bash",
                patterns: ["*"],
                metadata: {},
                always: [],
              },
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        expect(permissionReplies).toContain("perm_1")

        stop()
      },
    })
  })

  test("permission prompt on session A does not block message updates for session B", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const permissionReplies: string[] = []
        let resolvePermissionA: (() => void) | undefined
        const permissionABlocking = new Promise<void>((r) => {
          resolvePermissionA = r
        })

        const { agent, controller, chunks, stop, sdk, connection } = createFakeAgent()

        // Make permission request for session A block until we release it
        const originalRequestPermission = connection.requestPermission.bind(connection)
        let _permissionCalls = 0
        connection.requestPermission = async (params: RequestPermissionParams) => {
          _permissionCalls++
          if (params.sessionId.endsWith("1")) {
            await permissionABlocking
          }
          return originalRequestPermission(params)
        }

        sdk.permission.reply = async (params: any) => {
          permissionReplies.push(params.requestID)
          return { data: true }
        }

        const cwd = "/tmp/opencode-acp-test"

        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const sessionB = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        // Push permission.asked for session A (will block)
        controller.push({
          directory: cwd,
          payload: {
            type: "session.next.permission.asked",
            properties: {
              sessionID: sessionA,
              request: {
                id: "perm_a",
                sessionID: sessionA,
                permission: "bash",
                patterns: ["*"],
                metadata: {},
                always: [],
              },
            },
          },
        } as any)

        // Give time for permission handling to start
        await new Promise((r) => setTimeout(r, 10))

        // Push message for session B while A's permission is still pending
        controller.push({
          directory: cwd,
          payload: {
            type: "session.next.text.delta",
            properties: {
              sessionID: sessionB,
              delta: "session_b_message",
            },
          },
        } as any)

        // Wait for session B's message to be processed
        await new Promise((r) => setTimeout(r, 20))

        // Session B should have received message even though A's permission is still pending
        expect(chunks.get(sessionB) ?? "").toContain("session_b_message")
        expect(permissionReplies).not.toContain("perm_a")

        // Release session A's permission
        resolvePermissionA!()
        await new Promise((r) => setTimeout(r, 20))

        // Now session A's permission should be replied
        expect(permissionReplies).toContain("perm_a")

        stop()
      },
    })
  })

  test("streams running bash output snapshots and de-dupes identical snapshots", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const input = { command: "echo hello", description: "run command" }

        controller.push(calledEvent(sessionId, cwd, "call_1", "bash", input))
        for (const output of ["a", "a", "ab"]) {
          controller.push(bashProgressEvent(sessionId, cwd, "call_1", output))
        }
        await new Promise((r) => setTimeout(r, 20))

        const snapshots = sessionUpdates
          .filter((u) => u.sessionId === sessionId)
          .filter((u) => isToolCallUpdate(u.update))
          .map((u) => inProgressText(u.update))

        expect(snapshots).toEqual(["a", undefined, "ab"])
        stop()
      },
    })
  })

  test("emits synthetic pending before first running update for any tool", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push(calledEvent(sessionId, cwd, "call_bash", "bash", { command: "echo hi" }))
        controller.push(bashProgressEvent(sessionId, cwd, "call_bash", "hi\n"))
        controller.push(calledEvent(sessionId, cwd, "call_read", "read", { filePath: "/tmp/example.txt" }))
        controller.push(progressEvent(sessionId, cwd, "call_read"))
        await new Promise((r) => setTimeout(r, 20))

        const types = sessionUpdates
          .filter((u) => u.sessionId === sessionId)
          .map((u) => u.update.sessionUpdate)
          .filter((u) => u === "tool_call" || u === "tool_call_update")
        expect(types).toEqual(["tool_call", "tool_call_update", "tool_call", "tool_call_update"])

        const pendings = sessionUpdates.filter(
          (u) => u.sessionId === sessionId && u.update.sessionUpdate === "tool_call",
        )
        expect(pendings.every((p) => p.update.sessionUpdate === "tool_call" && p.update.status === "pending")).toBe(
          true,
        )
        stop()
      },
    })
  })

  test("forwards tool progress content and shell final output", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push(calledEvent(sessionId, cwd, "call_bash_content", "bash", { command: "echo hi" }))
        controller.push(
          progressEvent(sessionId, cwd, "call_bash_content", {}, [{ type: "text", text: "hi\n" }]),
        )
        controller.push(
          successEvent(sessionId, cwd, "call_bash_content", "", { output: "hi\n" }),
        )
        await new Promise((r) => setTimeout(r, 20))

        const progress = sessionUpdates.find(
          (u) =>
            u.sessionId === sessionId &&
            u.update.sessionUpdate === "tool_call_update" &&
            u.update.status === "in_progress",
        )
        const progressContent = progress?.update.sessionUpdate === "tool_call_update" ? progress.update.content : undefined
        expect(progressContent).toContainEqual({
          type: "content",
          content: { type: "text", text: "hi\n" },
        })

        const completed = completedToolUpdate(sessionUpdates, sessionId, "call_bash_content")
        expect(completed?.content).toContainEqual({
          type: "content",
          content: { type: "text", text: "hi\n" },
        })
        expect(completed?.rawOutput).toEqual({ output: "hi\n", metadata: { output: "hi\n" } })
        stop()
      },
    })
  })

  test("emits image attachments as ACP tool content blocks on live completed tool updates", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const data = Buffer.from("image-data").toString("base64")

        controller.push(calledEvent(sessionId, cwd, "call_image", "read", { filePath: "/tmp/image.png" }))
        controller.push(
          successEvent(sessionId, cwd, "call_image", "Image read successfully", {}, [
            {
              id: "part_image",
              sessionID: sessionId,
              messageID: "msg_image",
              type: "file",
              mime: "image/png",
              filename: "image.png",
              url: `data:image/png;base64,${data}`,
            },
            {
              id: "part_text",
              sessionID: sessionId,
              messageID: "msg_image",
              type: "file",
              mime: "text/plain",
              filename: "note.txt",
              url: "data:text/plain;base64,Zm9v",
            },
          ]),
        )
        await new Promise((r) => setTimeout(r, 20))

        const update = completedToolUpdate(sessionUpdates, sessionId, "call_image")
        expect(update?.content).toContainEqual({
          type: "content",
          content: { type: "text", text: "Image read successfully" },
        })
        expect(update?.content).toContainEqual({
          type: "content",
          content: { type: "image", mimeType: "image/png", data },
        })
        expect(update?.content?.some((item) => item.type === "content" && item.content.type === "resource")).toBe(false)

        stop()
      },
    })
  })

  test("replays completed tool image attachments as ACP tool content blocks", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, sessionUpdates, stop, sdk } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const data = Buffer.from("replay-image").toString("base64")

        sdk.v2.session.messages = async () => ({
          data: {
            items: [
              {
                type: "assistant",
                id: "msg_replay",
                sessionID: sessionId,
                model: { providerID: "opencode", id: "big-pickle" },
                tokens: { input: 0, output: 0 },
                cost: 0,
                time: { created: Date.now() },
                content: [
                  {
                    id: "call_replay_image",
                    type: "tool",
                    callID: "call_replay_image",
                    name: "webfetch",
                    state: {
                      status: "completed",
                      input: { url: "https://example.com/image.png" },
                      structured: {},
                      content: [
                        { type: "text", text: "Image fetched successfully" },
                        {
                          type: "file",
                          uri: `data:image/jpeg;base64,${data}`,
                          mime: "image/jpeg",
                          name: "image.jpg",
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        } as any)

        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)

        const update = completedToolUpdate(sessionUpdates, sessionId, "call_replay_image")
        expect(update?.content).toContainEqual({
          type: "content",
          content: { type: "text", text: "Image fetched successfully" },
        })
        expect(update?.content).toContainEqual({
          type: "content",
          content: { type: "image", mimeType: "image/jpeg", data },
        })

        stop()
      },
    })
  })

  test("does not emit duplicate synthetic pending after replayed running tool", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop, sdk } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const input = { command: "echo hi", description: "run command" }

        sdk.v2.session.messages = async () => ({
          data: {
            items: [
              {
                type: "assistant",
                id: "msg_replay",
                sessionID: sessionId,
                model: { providerID: "opencode", id: "big-pickle" },
                tokens: { input: 0, output: 0 },
                cost: 0,
                time: { created: Date.now() },
                content: [
                  {
                    // V2 replay: the tool item id doubles as the ACP toolCallId,
                    // and the live stream keys progress updates by the same callID.
                    id: "call_1",
                    type: "tool",
                    callID: "call_1",
                    name: "bash",
                    state: {
                      status: "running",
                      input,
                      structured: { output: "hi\n" },
                      content: [],
                    },
                  },
                ],
              },
            ],
          },
        } as any)

        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        controller.push(calledEvent(sessionId, cwd, "call_1", "bash", input))
        controller.push(bashProgressEvent(sessionId, cwd, "call_1", "hi\nthere\n"))
        await new Promise((r) => setTimeout(r, 20))

        const types = sessionUpdates
          .filter((u) => u.sessionId === sessionId)
          .map((u) => u.update)
          .filter((u) => "toolCallId" in u && u.toolCallId === "call_1")
          .map((u) => u.sessionUpdate)
          .filter((u) => u === "tool_call" || u === "tool_call_update")

        expect(types).toEqual(["tool_call", "tool_call_update", "tool_call_update"])
        stop()
      },
    })
  })

  test("clears bash snapshot marker on pending state", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const input = { command: "echo hello", description: "run command" }

        controller.push(calledEvent(sessionId, cwd, "call_1", "bash", input))
        controller.push(bashProgressEvent(sessionId, cwd, "call_1", "a"))
        // A re-called tool starts a fresh output stream (pending reset)
        controller.push(calledEvent(sessionId, cwd, "call_1", "bash", input))
        controller.push(bashProgressEvent(sessionId, cwd, "call_1", "a"))
        await new Promise((r) => setTimeout(r, 20))

        const snapshots = sessionUpdates
          .filter((u) => u.sessionId === sessionId)
          .filter((u) => isToolCallUpdate(u.update))
          .map((u) => inProgressText(u.update))

        expect(snapshots).toEqual(["a", "a"])
        stop()
      },
    })
  })
})
