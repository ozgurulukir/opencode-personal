import { describe, expect, test, mock } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import {
  handleCompactionTask,
  createAutoCompaction,
  pruneAndCheckTurnCompaction,
} from "../../src/session/loop/compaction-policy"
import type { MessageV2 } from "../../src/session/message-v2"
import type { MessageID, SessionID, PartID } from "../../src/session/schema"
import * as CompactionTrigger from "../../src/session/compaction-trigger"

describe("session/loop/compaction-policy", () => {
  const dummyUser: MessageV2.User = {
    id: "msg_user_1" as MessageID,
    sessionID: "ses_1" as SessionID,
    role: "user",
    agent: "test-agent",
    model: { providerID: "test-provider" as any, modelID: "test-model" as any },
    time: { created: Date.now() },
  }

  test("handleCompactionTask delegates to compaction.process", async () => {
    let processedInput: any = null
    const compaction = {
      process: (input: any) => {
        processedInput = input
        return Effect.succeed("continue" as const)
      },
    } as any

    const task: MessageV2.CompactionPart = {
      id: "part_1" as PartID,
      sessionID: "ses_1" as SessionID,
      messageID: "msg_comp_1" as MessageID,
      type: "compaction",
      auto: true,
      overflow: false,
    }

    const result = await Effect.runPromise(
      handleCompactionTask(
        { compaction },
        {
          task,
          lastUser: dummyUser,
          sessionID: "ses_1" as SessionID,
          msgs: [],
        },
      ),
    )

    expect(result).toBe("continue")
    expect(processedInput).toEqual({
      messages: [],
      parentID: "msg_comp_1" as MessageID,
      sessionID: "ses_1" as SessionID,
      auto: true,
      overflow: false,
    })
  })

  test("createAutoCompaction delegates to compaction.create when breaker is not tripped", async () => {
    let createdInput: any = null
    const compaction = {
      create: (input: any) => {
        createdInput = input
        return Effect.void
      },
    } as any
    const bus = {
      publish: () => Effect.void,
    } as any

    await Effect.runPromise(
      createAutoCompaction(
        { compaction, bus },
        {
          sessionID: "ses_1" as SessionID,
          consecutiveAutoCompactions: 1,
          lastUser: dummyUser,
          overflow: false,
        },
      ),
    )

    expect(createdInput).toEqual({
      sessionID: "ses_1" as SessionID,
      agent: dummyUser.agent,
      model: dummyUser.model,
      auto: true,
      overflow: false,
      tools: dummyUser.tools,
      format: dummyUser.format,
      system: dummyUser.system,
    })
  })

  test("createAutoCompaction fails typed (not a defect) and publishes error when breaker is tripped", async () => {
    let publishedError: any = null
    const compaction = {
      create: () => Effect.void,
    } as any
    const bus = {
      publish: (_event: any, payload: any) => {
        publishedError = payload
        return Effect.void
      },
    } as any

    const consecutive = CompactionTrigger.BREAKER_LIMIT

    const exit = await Effect.runPromiseExit(
      createAutoCompaction(
        { compaction, bus },
        {
          sessionID: "ses_1" as SessionID,
          consecutiveAutoCompactions: consecutive,
          lastUser: dummyUser,
        },
      ),
    )

    // Typed failure: the cause has fails and no dies — call sites catch it to
    // end the prompt cleanly instead of dying with a defect. The error
    // message itself is asserted via the published bus event below.
    expect(Exit.isFailure(exit)).toBe(true)
    const cause = (exit as any).cause
    expect(Cause.hasFails(cause)).toBe(true)
    expect(Cause.hasDies(cause)).toBe(false)

    expect(publishedError).toBeDefined()
    expect(publishedError.sessionID).toBe("ses_1")
    expect(publishedError.error.data.message).toBe(CompactionTrigger.BREAKER_MESSAGE)
  })

  test("pruneAndCheckTurnCompaction skips compaction when summary turn", async () => {
    let pruneCalled = false
    const compaction = {
      prune: () => {
        pruneCalled = true
        return Effect.succeed(0)
      },
    } as any
    const config = {
      get: () => Effect.succeed({} as any),
    } as any
    const bus = { publish: () => Effect.void } as any

    const lastFinished: MessageV2.Assistant = {
      id: "msg_ast_1" as MessageID,
      sessionID: "ses_1" as SessionID,
      parentID: "msg_user_1" as MessageID,
      role: "assistant",
      agent: "test-agent",
      modelID: "test-model" as any,
      providerID: "test-provider" as any,
      mode: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 100, output: 50, cache: { read: 0, write: 0 }, reasoning: 0 },
      time: { created: Date.now() },
      summary: true,
    }

    const shouldCompact = await Effect.runPromise(
      pruneAndCheckTurnCompaction(
        { compaction, config, bus },
        {
          sessionID: "ses_1" as SessionID,
          lastFinished,
          isCurrentTurnContinue: false,
          consecutiveAutoCompactions: 0,
          lastUser: dummyUser,
          model: {
            id: "test",
            name: "test",
            limit: { context: 1000 },
            capabilities: { toolcall: true },
          } as any,
        },
      ),
    )

    expect(pruneCalled).toBe(false)
    expect(shouldCompact).toBe(false)
  })
})
