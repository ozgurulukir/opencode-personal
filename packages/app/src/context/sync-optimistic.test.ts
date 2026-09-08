import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { applyOptimisticAdd, applyOptimisticRemove, mergeOptimisticPage } from "./sync"

type Text = Extract<Part, { type: "text" }>

const userMessage = (id: string, sessionID: string): Message => ({
  id,
  sessionID,
  role: "user",
  time: { created: 1 },
  agent: "assistant",
  model: { providerID: "openai", modelID: "gpt" },
})

const textPart = (id: string, sessionID: string, messageID: string, text = id): Text => ({
  id,
  sessionID,
  messageID,
  type: "text",
  text,
})

describe("sync optimistic reducers", () => {
  test("applyOptimisticAdd inserts message in sorted order and stores parts", () => {
    const sessionID = "ses_1"
    const draft = {
      message: { [sessionID]: [userMessage("msg_2", sessionID)] },
      part: {} as Record<string, Part[] | undefined>,
    }

    applyOptimisticAdd(draft, {
      sessionID,
      message: userMessage("msg_1", sessionID),
      parts: [textPart("prt_2", sessionID, "msg_1"), textPart("prt_1", sessionID, "msg_1")],
    })

    expect(draft.message[sessionID]?.map((x) => x.id)).toEqual(["msg_1", "msg_2"])
    expect(draft.part.msg_1?.map((x) => x.id)).toEqual(["prt_1", "prt_2"])
  })

  test("applyOptimisticRemove removes message and part entries", () => {
    const sessionID = "ses_1"
    const draft = {
      message: { [sessionID]: [userMessage("msg_1", sessionID), userMessage("msg_2", sessionID)] },
      part: {
        msg_1: [textPart("prt_1", sessionID, "msg_1")],
        msg_2: [textPart("prt_2", sessionID, "msg_2")],
      } as Record<string, Part[] | undefined>,
    }

    applyOptimisticRemove(draft, { sessionID, messageID: "msg_1" })

    expect(draft.message[sessionID]?.map((x) => x.id)).toEqual(["msg_2"])
    expect(draft.part.msg_1).toBeUndefined()
    expect(draft.part.msg_2).toHaveLength(1)
  })

  test("mergeOptimisticPage keeps pending messages in fetched timelines", () => {
    const sessionID = "ses_1"
    const page = mergeOptimisticPage(
      {
        session: [userMessage("evt_1", sessionID)],
        part: [{ id: "evt_1", part: [textPart("evt_1:0000:text", sessionID, "evt_1", "server text")] }],
        complete: true,
      },
      [
        {
          message: userMessage("msg_2", sessionID),
          parts: [textPart("prt_2", sessionID, "msg_2", "optimistic text")],
        },
      ],
    )

    expect(page.session.map((x) => x.id)).toEqual(["evt_1", "msg_2"])
    expect(page.part.find((x) => x.id === "msg_2")?.part.map((x) => x.id)).toEqual(["prt_2"])
    expect(page.confirmed).toEqual([])
    expect(page.complete).toBe(true)
  })

  test("mergeOptimisticPage confirms by prompt text and keeps the real message", () => {
    const sessionID = "ses_1"
    const page = mergeOptimisticPage(
      {
        session: [userMessage("evt_1", sessionID)],
        part: [{ id: "evt_1", part: [textPart("evt_1:0000:text", sessionID, "evt_1", "hello")] }],
        complete: true,
      },
      [
        {
          message: userMessage("msg_2", sessionID),
          parts: [textPart("prt_2", sessionID, "msg_2", "hello")],
        },
      ],
    )

    expect(page.confirmed).toEqual(["msg_2"])
    expect(page.session.map((x) => x.id)).toEqual(["evt_1"])
    expect(page.part.find((x) => x.id === "msg_2")).toBeUndefined()
  })

  test("mergeOptimisticPage ignores synthetic parts when matching text", () => {
    const sessionID = "ses_1"
    const note = "The user made the following comment regarding line 3 of src/a.ts: fix this"
    const page = mergeOptimisticPage(
      {
        session: [userMessage("evt_1", sessionID)],
        part: [{ id: "evt_1", part: [textPart("evt_1:0000:text", sessionID, "evt_1", "hello")] }],
        complete: true,
      },
      [
        {
          message: userMessage("msg_2", sessionID),
          parts: [
            textPart("prt_2", sessionID, "msg_2", "hello"),
            { ...textPart("prt_3", sessionID, "msg_2", note), synthetic: true },
          ],
        },
      ],
    )

    expect(page.confirmed).toEqual(["msg_2"])
    expect(page.session.map((x) => x.id)).toEqual(["evt_1"])
  })

  test("mergeOptimisticPage confirms one entry per matching real message", () => {
    const sessionID = "ses_1"
    const page = mergeOptimisticPage(
      {
        session: [userMessage("evt_1", sessionID)],
        part: [{ id: "evt_1", part: [textPart("evt_1:0000:text", sessionID, "evt_1", "hello")] }],
        complete: true,
      },
      [
        {
          message: userMessage("msg_2", sessionID),
          parts: [textPart("prt_2", sessionID, "msg_2", "hello")],
        },
        {
          message: userMessage("msg_3", sessionID),
          parts: [textPart("prt_3", sessionID, "msg_3", "hello")],
        },
      ],
    )

    expect(page.confirmed).toEqual(["msg_2"])
    expect(page.session.map((x) => x.id)).toEqual(["evt_1", "msg_3"])
  })
})
