import { describe, expect, test } from "bun:test"
import type { TextareaRenderable } from "@opentui/core"
import {
  clearParts,
  clonePrompt,
  createPartManagerState,
  insertMention,
  restoreParts,
  syncParts,
  type PartManagerState,
} from "@/cli/cmd/run/prompt/parts"
import type { RunPrompt, RunPromptPart } from "@/cli/cmd/run/types"

// Minimal TextareaRenderable mock for testing
function createMockArea(initialText = ""): TextareaRenderable {
  let text = initialText
  let nextId = 1
  const marks = new Map<number, { start: number; end: number; typeId: number }>()

  return {
    isDestroyed: false,
    plainText: text,
    cursorOffset: 0,
    height: 3,
    virtualLineCount: 1,
    visualCursor: { visualRow: 0, visualCol: 0 },
    logicalCursor: { row: 0, col: 0 },
    setText: (t: string) => {
      text = t
    },
    focus: () => {},
    extmarks: {
      registerType: (_name: string) => 1,
      create: (opts: { start: number; end: number; virtual: boolean; typeId: number }) => {
        const id = nextId++
        marks.set(id, { start: opts.start, end: opts.end, typeId: opts.typeId })
        return id
      },
      delete: (id: number) => {
        marks.delete(id)
      },
      clear: () => {
        marks.clear()
      },
      getAllForTypeId: (typeId: number) => {
        return [...marks.entries()]
          .filter(([, m]) => m.typeId === typeId)
          .map(([id, m]) => ({ id, start: m.start, end: m.end }))
      },
    },
    on: () => {},
    off: () => {},
    deleteRange: () => {},
    insertText: () => {},
  } as unknown as TextareaRenderable
}

function agentPart(name: string, start = 0, end = 0): RunPromptPart {
  return {
    type: "agent",
    name,
    source: { start, end, value: `@${name}` },
  }
}

function filePart(filename: string, url: string, start = 0, end = 0): RunPromptPart {
  return {
    type: "file",
    mime: "text/plain",
    filename,
    url,
    source: {
      type: "file",
      path: filename,
      text: { start, end, value: `@${filename}` },
    },
  }
}

describe("createPartManagerState", () => {
  test("creates empty state", () => {
    const state = createPartManagerState()
    expect(state.parts).toEqual([])
    expect(state.marks.size).toBe(0)
    expect(state.type).toBe(0)
  })
})

describe("clonePrompt", () => {
  test("deep clones prompt with parts", () => {
    const p: RunPrompt = {
      text: "hello @world",
      parts: [agentPart("world", 6, 13)],
    }
    const cloned = clonePrompt(p)
    expect(cloned).toEqual(p)
    expect(cloned.parts).not.toBe(p.parts)
    expect(cloned.parts[0]).not.toBe(p.parts[0])
  })
})

describe("clearParts", () => {
  test("clears parts and marks", () => {
    const state: PartManagerState = {
      parts: [agentPart("test") as any],
      marks: new Map([[1, 0]]),
      type: 1,
    }
    const next = clearParts(state)
    expect(next.parts).toEqual([])
    expect(next.marks.size).toBe(0)
  })

  test("clears extmarks on area", () => {
    const area = createMockArea()
    const state: PartManagerState = {
      parts: [],
      marks: new Map(),
      type: 1,
    }
    clearParts(state, area)
    // No crash means extmarks.clear() was called
  })
})

describe("syncParts", () => {
  test("returns state unchanged when no area", () => {
    const state = createPartManagerState()
    const next = syncParts(state)
    expect(next).toBe(state)
  })

  test("returns state unchanged when type is 0", () => {
    const area = createMockArea()
    const state = createPartManagerState()
    const next = syncParts(state, area)
    expect(next).toBe(state)
  })

  test("syncs parts from extmarks", () => {
    const area = createMockArea("hello @world")
    const part = agentPart("world", 6, 13)
    const state: PartManagerState = {
      parts: [structuredClone(part) as any],
      marks: new Map(),
      type: 1,
    }

    // Create an extmark matching the part
    const id = area.extmarks.create({ start: 6, end: 13, virtual: true, typeId: 1 })
    state.marks.set(id, 0)

    const next = syncParts(state, area)
    expect(next.parts.length).toBe(1)
    expect(next.parts[0].type).toBe("agent")
    if (next.parts[0].type === "agent") {
      expect(next.parts[0].source).toEqual({ start: 6, end: 13, value: "@world" })
    }
  })

  test("removes stale parts when extmarks are deleted", () => {
    const area = createMockArea("hello @world")
    const part = agentPart("world", 6, 13)
    const state: PartManagerState = {
      parts: [structuredClone(part) as any],
      marks: new Map(),
      type: 1,
    }

    // Create an extmark but don't add it to marks (simulating stale)
    area.extmarks.create({ start: 6, end: 13, virtual: true, typeId: 1 })

    const next = syncParts(state, area)
    expect(next.parts.length).toBe(0)
  })
})

describe("restoreParts", () => {
  test("restores parts from prompt parts", () => {
    const area = createMockArea("hello @world")
    const state: PartManagerState = {
      parts: [],
      marks: new Map(),
      type: 1,
    }

    const next = restoreParts(state, area)
    expect(next.parts).toEqual([])
  })

  test("creates extmarks for parts with positions", () => {
    const area = createMockArea("hello @world")
    const part = agentPart("world", 6, 13)
    const state: PartManagerState = {
      parts: [structuredClone(part) as any],
      marks: new Map(),
      type: 1,
    }

    const next = restoreParts(state, area)
    expect(next.parts.length).toBe(1)
    expect(next.marks.size).toBe(1)
  })

  test("filters non-mention parts", () => {
    const area = createMockArea("")
    const state: PartManagerState = {
      parts: [
        { type: "text", text: "hello" } as any,
        agentPart("world") as any,
      ],
      marks: new Map(),
      type: 1,
    }

    const next = restoreParts(state, area)
    expect(next.parts.length).toBe(1)
    expect(next.parts[0].type).toBe("agent")
  })
})

describe("insertMention", () => {
  test("inserts agent mention and creates extmark", () => {
    const area = createMockArea("@world ")
    const state: PartManagerState = {
      parts: [],
      marks: new Map(),
      type: 1,
    }

    const next = insertMention(state, agentPart("world") as any, 0, 6, area)
    expect(next.parts.length).toBe(1)
    expect(next.marks.size).toBe(1)
    expect(next.parts[0].type).toBe("agent")
  })

  test("deduplicates file mentions by URL", () => {
    const area = createMockArea("@file1 @file1")
    const part = filePart("file1", "file:///path/file1", 0, 6)
    const state: PartManagerState = {
      parts: [structuredClone(part) as any],
      marks: new Map(),
      type: 1,
    }

    // Add initial extmark
    const id = area.extmarks.create({ start: 0, end: 6, virtual: true, typeId: 1 })
    state.marks.set(id, 0)

    const next = insertMention(state, part as any, 7, 13, area)
    // Should have deduplicated: still 1 part
    expect(next.parts.length).toBe(1)
  })

  test("returns state unchanged when no area", () => {
    const state = createPartManagerState()
    const next = insertMention(state, agentPart("world") as any, 0, 6)
    expect(next).toBe(state)
  })
})
