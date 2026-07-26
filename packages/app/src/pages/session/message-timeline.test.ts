import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore, type Store } from "solid-js/store"
import type { Part, TextPart, UserMessage } from "@opencode-ai/sdk/v2"
import { createTimelineStaging } from "./message-staging"
import { messageComments, taskDescription } from "./message-comments"
import { pace } from "./message-staging"
import { boundaryTarget, markBoundaryGesture } from "./message-gesture"

/* ------------------------------------------------------------------ */
/* pace */
/* ------------------------------------------------------------------ */
describe("pace", () => {
  test("clamps to minimum 1200ms", () => {
    expect(pace(100)).toBe(1200)
  })

  test("clamps to maximum 3200ms", () => {
    expect(pace(4000)).toBe(3200)
  })

  test("scales with width between bounds", () => {
    const result = pace(900)
    expect(result).toBeGreaterThanOrEqual(1200)
    expect(result).toBeLessThanOrEqual(3200)
  })
})

/* ------------------------------------------------------------------ */
/* messageComments */
/* ------------------------------------------------------------------ */
describe("messageComments", () => {
  test("returns empty array for non-text parts", () => {
    const parts: Part[] = [
      { type: "tool", tool: "bash", id: "1", sessionID: "s", messageID: "m", callID: "c" } as unknown as Part,
    ]
    expect(messageComments(parts)).toEqual([])
  })

  test("returns empty array for text parts without synthetic flag or metadata", () => {
    const parts: TextPart[] = [
      { type: "text", text: "hello", id: "1", sessionID: "s", messageID: "m" } as unknown as TextPart,
    ]
    expect(messageComments(parts)).toEqual([])
  })

  test("extracts comment from synthetic text part with metadata", () => {
    const parts: TextPart[] = [
      {
        type: "text",
        text: "some text",
        synthetic: true,
        metadata: {
          opencodeComment: {
            path: "src/a.ts",
            selection: { startLine: 1, startChar: 0, endLine: 3, endChar: 10 },
            comment: "rename this",
          },
        },
        id: "1",
        sessionID: "s",
        messageID: "m",
      } as unknown as TextPart,
    ]
    expect(messageComments(parts)).toEqual([
      {
        path: "src/a.ts",
        comment: "rename this",
        selection: { startLine: 1, endLine: 3 },
      },
    ])
  })

  test("parses inline comment note when metadata is absent", () => {
    const parts: TextPart[] = [
      {
        type: "text",
        text: "The user made the following comment regarding line 5 of src/b.ts: check this",
        synthetic: true,
        metadata: {},
        id: "1",
        sessionID: "s",
        messageID: "m",
      } as unknown as TextPart,
    ]
    expect(messageComments(parts)).toEqual([
      {
        path: "src/b.ts",
        comment: "check this",
        selection: { startLine: 5, endLine: 5 },
      },
    ])
  })

  test("falls back to metadata when both metadata and note are present", () => {
    const parts: TextPart[] = [
      {
        type: "text",
        text: "The user made the following comment regarding this file of src/c.ts: note",
        synthetic: true,
        metadata: {
          opencodeComment: {
            path: "src/c.ts",
            comment: "meta",
          },
        },
        id: "1",
        sessionID: "s",
        messageID: "m",
      } as unknown as TextPart,
    ]
    expect(messageComments(parts)).toEqual([
      {
        path: "src/c.ts",
        comment: "meta",
      },
    ])
  })
})

/* ------------------------------------------------------------------ */
/* taskDescription */
/* ------------------------------------------------------------------ */
describe("taskDescription", () => {
  test("returns undefined for non-tool parts", () => {
    expect(
      taskDescription({ type: "text", text: "x", id: "1", sessionID: "s", messageID: "m" } as unknown as Part, "session-1"),
    ).toBeUndefined()
  })

  test("returns undefined for tool parts that are not task", () => {
    expect(
      taskDescription({ type: "tool", tool: "bash", id: "1", sessionID: "s", messageID: "m", callID: "c" } as unknown as Part, "session-1"),
    ).toBeUndefined()
  })

  test("returns undefined when metadata sessionId does not match", () => {
    expect(
      taskDescription(
        {
          type: "tool",
          tool: "task",
          id: "1",
          sessionID: "s",
          messageID: "m",
          callID: "c",
          state: {
            metadata: { sessionId: "other" },
            input: { description: "desc" },
          },
        } as unknown as Part,
        "session-1",
      ),
    ).toBeUndefined()
  })

  test("returns description string when sessionId matches", () => {
    expect(
      taskDescription(
        {
          type: "tool",
          tool: "task",
          id: "1",
          sessionID: "s",
          messageID: "m",
          callID: "c",
          state: {
            metadata: { sessionId: "session-1" },
            input: { description: "my task" },
          },
        } as unknown as Part,
        "session-1",
      ),
    ).toBe("my task")
  })

  test("returns undefined when description is missing", () => {
    expect(
      taskDescription(
        {
          type: "tool",
          tool: "task",
          id: "1",
          sessionID: "s",
          messageID: "m",
          callID: "c",
          state: {
            metadata: { sessionId: "session-1" },
            input: {},
          },
        } as unknown as Part,
        "session-1",
      ),
    ).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/* boundaryTarget */
/* ------------------------------------------------------------------ */
describe("boundaryTarget", () => {
  test("returns root when target is null", () => {
    const root = document.createElement("div")
    expect(boundaryTarget(root, null)).toBe(root)
  })

  test("returns root when closest nested scroller is root itself", () => {
    const root = document.createElement("div")
    root.setAttribute("data-scrollable", "")
    expect(boundaryTarget(root, root)).toBe(root)
  })

  test("returns nested HTMLElement when inside a scrollable", () => {
    const root = document.createElement("div")
    const nested = document.createElement("div")
    nested.setAttribute("data-scrollable", "")
    root.appendChild(nested)
    expect(boundaryTarget(root, nested)).toBe(nested)
  })

  test("returns root when closest nested scroller is not HTMLElement", () => {
    const root = document.createElement("div")
    const nested = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    nested.setAttribute("data-scrollable", "")
    root.appendChild(nested)
    expect(boundaryTarget(root, nested)).toBe(root)
  })
})

/* ------------------------------------------------------------------ */
/* markBoundaryGesture */
/* ------------------------------------------------------------------ */
describe("markBoundaryGesture", () => {
  test("marks root scroll gesture when target resolves to root", () => {
    const root = document.createElement("div")
    const calls: (EventTarget | null | undefined)[] = []
    markBoundaryGesture({
      root,
      target: root,
      delta: 20,
      onMarkScrollGesture: (t: EventTarget | null | undefined) => calls.push(t),
    })
    expect(calls.length).toBe(1)
    expect(calls[0]).toBe(root)
  })

  test("marks root when nested scroller cannot consume movement", () => {
    const root = document.createElement("div")
    const nested = document.createElement("div")
    nested.setAttribute("data-scrollable", "")
    root.appendChild(nested)
    Object.defineProperty(nested, "scrollTop", { value: 0, writable: true, configurable: true })
    Object.defineProperty(nested, "scrollHeight", { value: 300, writable: true, configurable: true })
    Object.defineProperty(nested, "clientHeight", { value: 300, writable: true, configurable: true })
    const calls: (EventTarget | null | undefined)[] = []
    markBoundaryGesture({
      root,
      target: nested,
      delta: 20,
      onMarkScrollGesture: (t: EventTarget | null | undefined) => calls.push(t),
    })
    expect(calls.length).toBe(1)
    expect(calls[0]).toBe(root)
  })

  test("does not mark when nested scroller can consume movement", () => {
    const root = document.createElement("div")
    const nested = document.createElement("div")
    nested.setAttribute("data-scrollable", "")
    root.appendChild(nested)
    Object.defineProperty(nested, "scrollTop", { value: 200, writable: true, configurable: true })
    Object.defineProperty(nested, "scrollHeight", { value: 1000, writable: true, configurable: true })
    Object.defineProperty(nested, "clientHeight", { value: 400, writable: true, configurable: true })
    const calls: (EventTarget | null | undefined)[] = []
    markBoundaryGesture({
      root,
      target: nested,
      delta: 20,
      onMarkScrollGesture: (t: EventTarget | null | undefined) => calls.push(t),
    })
    expect(calls.length).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* createTimelineStaging */
/* ------------------------------------------------------------------ */
describe("createTimelineStaging", () => {
  const makeInput = (
    messages: UserMessage[],
    overrides: {
      sessionKey?: string
      turnStart?: number
      config?: { init: number; batch: number }
    } = {},
  ) => {
    const sessionKey = overrides.sessionKey ?? "session-1"
    const turnStart = overrides.turnStart ?? 0
    const config = overrides.config ?? { init: 1, batch: 3 }
    return {
      sessionKey: () => sessionKey,
      turnStart: () => turnStart,
      messages: () => messages,
      config,
    }
  }

  // SolidJS server build no-ops createEffect, so we patch it to run
  // the effect synchronously so the staging store gets initialized.
  const { mock } = require("bun:test")
  mock.module("solid-js", (exports: Record<string, unknown>) => {
    return {
      ...exports,
      createEffect: (fn: () => void) => fn(),
    }
  })

  test("returns all messages when turnStart is 0", () => {
    const messages = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}` } as UserMessage))
    createRoot((dispose) => {
      const staging = createTimelineStaging(makeInput(messages))
      expect(staging.messages().length).toBe(5)
      expect(staging.isStaging()).toBe(false)
      dispose()
    })
  })

  test("returns init-sized slice when windowed and not completed", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}` } as UserMessage))
    createRoot((dispose) => {
      const staging = createTimelineStaging(makeInput(messages, { turnStart: 2 }))
      expect(staging.messages().length).toBe(1)
      expect(staging.isStaging()).toBe(true)
      dispose()
    })
  })

  test("returns all messages when total is less than init", () => {
    const messages = Array.from({ length: 2 }, (_, i) => ({ id: `m${i}` } as UserMessage))
    createRoot((dispose) => {
      const staging = createTimelineStaging(makeInput(messages, { turnStart: 2, config: { init: 5, batch: 3 } }))
      expect(staging.messages().length).toBe(2)
      expect(staging.isStaging()).toBe(false)
      dispose()
    })
  })

  test("isStaging is true while activeSession matches", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}` } as UserMessage))
    createRoot((dispose) => {
      const staging = createTimelineStaging(makeInput(messages, { turnStart: 2 }))
      expect(staging.isStaging()).toBe(true)
      dispose()
    })
  })

  test("isStaging is false when turnStart is 0", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}` } as UserMessage))
    createRoot((dispose) => {
      const staging = createTimelineStaging(makeInput(messages))
      expect(staging.isStaging()).toBe(false)
      dispose()
    })
  })
})
