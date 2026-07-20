import { describe, expect, test } from "bun:test"
import {
  createPromptHistory,
  pushPromptHistory,
  movePromptHistory,
  promptInfo,
  promptHit,
  promptCycle,
  promptKeys,
  isExitCommand,
  isNewCommand,
  promptSame,
  promptCopy,
} from "../../../../src/cli/cmd/run/prompt.shared"
import type { FooterKeybinds, RunPrompt } from "../../../../src/cli/cmd/run/types"

// ─── promptInfo ──────────────────────────────────────────────────────────────

describe("promptInfo", () => {
  test("converts space name", () => {
    const info = promptInfo({ name: " " })
    expect(info.name).toBe("space")
  })

  test("preserves other names", () => {
    const info = promptInfo({ name: "return" })
    expect(info.name).toBe("return")
  })

  test("defaults modifiers to false", () => {
    const info = promptInfo({ name: "a" })
    expect(info.ctrl).toBe(false)
    expect(info.meta).toBe(false)
    expect(info.shift).toBe(false)
    expect(info.super).toBe(false)
    expect(info.leader).toBe(false)
  })

  test("preserves modifier flags", () => {
    const info = promptInfo({ name: "a", ctrl: true, meta: true })
    expect(info.ctrl).toBe(true)
    expect(info.meta).toBe(true)
  })
})

// ─── isExitCommand ───────────────────────────────────────────────────────────

describe("isExitCommand", () => {
  test("matches /exit", () => {
    expect(isExitCommand("/exit")).toBe(true)
  })

  test("matches /quit", () => {
    expect(isExitCommand("/quit")).toBe(true)
  })

  test("matches :q", () => {
    expect(isExitCommand(":q")).toBe(true)
  })

  test("is case insensitive", () => {
    expect(isExitCommand("/EXIT")).toBe(true)
    expect(isExitCommand("/Quit")).toBe(true)
  })

  test("trims whitespace", () => {
    expect(isExitCommand("  /exit  ")).toBe(true)
  })

  test("returns false for other commands", () => {
    expect(isExitCommand("/help")).toBe(false)
    expect(isExitCommand("hello")).toBe(false)
  })
})

// ─── isNewCommand ────────────────────────────────────────────────────────────

describe("isNewCommand", () => {
  test("matches /new", () => {
    expect(isNewCommand("/new")).toBe(true)
  })

  test("is case insensitive", () => {
    expect(isNewCommand("/NEW")).toBe(true)
  })

  test("trims whitespace", () => {
    expect(isNewCommand("  /new  ")).toBe(true)
  })

  test("returns false for other commands", () => {
    expect(isNewCommand("/exit")).toBe(false)
  })
})

// ─── promptSame ──────────────────────────────────────────────────────────────

describe("promptSame", () => {
  test("returns true for identical prompts", () => {
    const a: RunPrompt = { text: "hello", parts: [] }
    const b: RunPrompt = { text: "hello", parts: [] }
    expect(promptSame(a, b)).toBe(true)
  })

  test("returns false for different text", () => {
    const a: RunPrompt = { text: "hello", parts: [] }
    const b: RunPrompt = { text: "world", parts: [] }
    expect(promptSame(a, b)).toBe(false)
  })

  test("returns false for different parts", () => {
    const a: RunPrompt = { text: "hello", parts: [{ type: "file", mime: "text/plain", url: "file:///a", filename: "a" }] }
    const b: RunPrompt = { text: "hello", parts: [] }
    expect(promptSame(a, b)).toBe(false)
  })
})

// ─── promptCopy ───────────────────────────────────────────────────────────────

describe("promptCopy", () => {
  test("creates a deep copy", () => {
    const original: RunPrompt = { text: "hello", parts: [{ type: "file", mime: "text/plain", url: "file:///a", filename: "a" }] }
    const copy = promptCopy(original)
    expect(copy).toEqual(original)
    expect(copy).not.toBe(original)
    expect(copy.parts).not.toBe(original.parts)
  })
})

// ─── createPromptHistory ─────────────────────────────────────────────────────

describe("createPromptHistory", () => {
  test("creates empty history when no items", () => {
    const h = createPromptHistory()
    expect(h.items).toEqual([])
    expect(h.index).toBeNull()
    expect(h.draft).toBe("")
  })

  test("filters out empty prompts", () => {
    const h = createPromptHistory([
      { text: "hello", parts: [] },
      { text: "   ", parts: [] },
      { text: "", parts: [] },
    ])
    expect(h.items.length).toBe(1)
    expect(h.items[0].text).toBe("hello")
  })

  test("deduplicates consecutive identical prompts", () => {
    const h = createPromptHistory([
      { text: "hello", parts: [] },
      { text: "hello", parts: [] },
      { text: "world", parts: [] },
    ])
    expect(h.items.length).toBe(2)
  })

  test("respects HISTORY_LIMIT (200)", () => {
    const items = Array.from({ length: 250 }, (_, i) => ({ text: `prompt ${i}`, parts: [] }))
    const h = createPromptHistory(items)
    expect(h.items.length).toBe(200)
    expect(h.items[0].text).toBe("prompt 50")
  })

  test("deep copies items", () => {
    const items: RunPrompt[] = [{ text: "hello", parts: [] }]
    const h = createPromptHistory(items)
    items[0].text = "modified"
    expect(h.items[0].text).toBe("hello")
  })
})

// ─── pushPromptHistory ───────────────────────────────────────────────────────

describe("pushPromptHistory", () => {
  test("adds prompt to history", () => {
    const h = createPromptHistory()
    const next = pushPromptHistory(h, { text: "hello", parts: [] })
    expect(next.items.length).toBe(1)
    expect(next.items[0].text).toBe("hello")
    expect(next.index).toBeNull()
  })

  test("ignores empty prompts", () => {
    const h = createPromptHistory()
    const next = pushPromptHistory(h, { text: "", parts: [] })
    expect(next.items.length).toBe(0)
  })

  test("ignores whitespace-only prompts", () => {
    const h = createPromptHistory()
    const next = pushPromptHistory(h, { text: "   ", parts: [] })
    expect(next.items.length).toBe(0)
  })

  test("deduplicates against last item", () => {
    const h = createPromptHistory([{ text: "hello", parts: [] }])
    const next = pushPromptHistory(h, { text: "hello", parts: [] })
    expect(next.items.length).toBe(1)
  })

  test("resets index and draft", () => {
    const h = createPromptHistory([{ text: "hello", parts: [] }])
    const withIndex = { ...h, index: 0, draft: "old" }
    const next = pushPromptHistory(withIndex, { text: "world", parts: [] })
    expect(next.index).toBeNull()
    expect(next.draft).toBe("")
  })

  test("respects HISTORY_LIMIT when pushing", () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ text: `prompt ${i}`, parts: [] }))
    const h = createPromptHistory(items)
    const next = pushPromptHistory(h, { text: "new prompt", parts: [] })
    expect(next.items.length).toBe(200)
    expect(next.items[next.items.length - 1].text).toBe("new prompt")
  })
})

// ─── movePromptHistory ───────────────────────────────────────────────────────

describe("movePromptHistory", () => {
  test("returns apply:false when history is empty", () => {
    const h = createPromptHistory()
    const result = movePromptHistory(h, -1, "current", 0)
    expect(result.apply).toBe(false)
  })

  test("returns apply:false when cursor is not at start for up", () => {
    const h = createPromptHistory([{ text: "hello", parts: [] }])
    const result = movePromptHistory(h, -1, "current", 3)
    expect(result.apply).toBe(false)
  })

  test("returns apply:false when cursor is not at end for down", () => {
    const h = createPromptHistory([{ text: "hello", parts: [] }])
    const result = movePromptHistory(h, 1, "current", 3)
    expect(result.apply).toBe(false)
  })

  test("returns apply:false for down when index is null", () => {
    const h = createPromptHistory([{ text: "hello", parts: [] }])
    const result = movePromptHistory(h, 1, "current", 7)
    expect(result.apply).toBe(false)
  })

  test("moves to last item on first up", () => {
    const h = createPromptHistory([{ text: "first", parts: [] }, { text: "last", parts: [] }])
    const result = movePromptHistory(h, -1, "current", 0)
    expect(result.apply).toBe(true)
    expect(result.text).toBe("last")
    expect(result.cursor).toBe(0)
    expect(result.state.index).toBe(1)
    expect(result.state.draft).toBe("current")
  })

  test("moves to previous item on subsequent up", () => {
    const h = createPromptHistory([{ text: "first", parts: [] }, { text: "last", parts: [] }])
    const first = movePromptHistory(h, -1, "current", 0)
    const result = movePromptHistory(first.state, -1, "last", 0)
    expect(result.apply).toBe(true)
    expect(result.text).toBe("first")
    expect(result.cursor).toBe(0)
    expect(result.state.index).toBe(0)
  })

  test("returns apply:false when at first item and pressing up", () => {
    const h = createPromptHistory([{ text: "first", parts: [] }, { text: "last", parts: [] }])
    const first = movePromptHistory(h, -1, "current", 0)
    const second = movePromptHistory(first.state, -1, "last", 0)
    const result = movePromptHistory(second.state, -1, "first", 0)
    expect(result.apply).toBe(false)
  })

  test("restores draft when moving past end", () => {
    const h = createPromptHistory([{ text: "hello", parts: [] }])
    const first = movePromptHistory(h, -1, "my draft", 0)
    // first.state has index:0, text is "hello" (length 5)
    // To move down, cursor must be at text.length (5)
    const result = movePromptHistory(first.state, 1, "hello", 5)
    expect(result.apply).toBe(true)
    expect(result.text).toBe("my draft")
    expect(result.cursor).toBe(8)
    expect(result.state.index).toBeNull()
  })

  test("moves to next item on down (within range)", () => {
    // Start with index at 1 (middle item), move down to index 2 (last item)
    const h = createPromptHistory([{ text: "first", parts: [] }, { text: "middle", parts: [] }, { text: "last", parts: [] }])
    // Manually set index to 1 (middle)
    const state = { ...h, index: 1, draft: "current" }
    // text is "middle" (length 6), cursor at end
    const result = movePromptHistory(state, 1, "middle", 6)
    expect(result.apply).toBe(true)
    expect(result.text).toBe("last")
    expect(result.cursor).toBe(4)
    expect(result.state.index).toBe(2)
  })

  test("restores draft when moving past end", () => {
    const h = createPromptHistory([{ text: "hello", parts: [] }])
    const first = movePromptHistory(h, -1, "my draft", 0)
    // first.state has index:0, text is "hello" (length 5)
    // To move down, cursor must be at text.length (5)
    const result = movePromptHistory(first.state, 1, "hello", 5)
    expect(result.apply).toBe(true)
    expect(result.text).toBe("my draft")
    expect(result.cursor).toBe(8)
    expect(result.state.index).toBeNull()
  })
})

// ─── promptHit ───────────────────────────────────────────────────────────────

describe("promptHit", () => {
  const bindings = [
    { name: "return", ctrl: true, meta: false, shift: false, super: false, leader: false },
  ]

  test("returns true when binding matches", () => {
    expect(promptHit(bindings, { name: "return", ctrl: true, meta: false, shift: false, super: false, leader: false })).toBe(true)
  })

  test("returns false when name differs", () => {
    expect(promptHit(bindings, { name: "escape", ctrl: true, meta: false, shift: false, super: false, leader: false })).toBe(false)
  })

  test("returns false when modifier differs", () => {
    expect(promptHit(bindings, { name: "return", ctrl: false, meta: false, shift: false, super: false, leader: false })).toBe(false)
  })

  test("returns false for empty bindings", () => {
    expect(promptHit([], { name: "return", ctrl: true, meta: false, shift: false, super: false, leader: false })).toBe(false)
  })
})

// ─── promptCycle ─────────────────────────────────────────────────────────────

describe("promptCycle", () => {
  const leader: any = { name: "space", ctrl: true, meta: false, shift: false, super: false, leader: false }
  // When armed, the cycle key is checked with leader:true, so the binding must have leader:true
  const cycle: any = { name: "v", ctrl: true, meta: false, shift: false, super: false, leader: true }

  test("arms on leader press when not armed", () => {
    const result = promptCycle(false, leader, [leader], [cycle])
    expect(result.arm).toBe(true)
    expect(result.cycle).toBe(false)
    expect(result.consume).toBe(true)
  })

  test("cycles on second press when armed", () => {
    const result = promptCycle(true, cycle, [leader], [cycle])
    expect(result.arm).toBe(false)
    expect(result.clear).toBe(true)
    expect(result.cycle).toBe(true)
    expect(result.consume).toBe(true)
  })

  test("consumes but does not cycle on non-cycle key when armed", () => {
    const other = { name: "x", ctrl: true, meta: false, shift: false, super: false, leader: false }
    const result = promptCycle(true, other, [leader], [cycle])
    expect(result.arm).toBe(false)
    expect(result.clear).toBe(true)
    expect(result.cycle).toBe(false)
    expect(result.consume).toBe(true)
  })

  test("cycles directly when not armed and cycle key pressed (leader:false binding)", () => {
    const directCycle: any = { name: "v", ctrl: true, meta: false, shift: false, super: false, leader: false }
    const result = promptCycle(false, directCycle, [leader], [directCycle])
    expect(result.arm).toBe(false)
    expect(result.clear).toBe(false)
    expect(result.cycle).toBe(true)
    expect(result.consume).toBe(true)
  })

  test("does not consume when no match", () => {
    const other = { name: "x", ctrl: true, meta: false, shift: false, super: false, leader: false }
    const result = promptCycle(false, other, [leader], [cycle])
    expect(result.arm).toBe(false)
    expect(result.clear).toBe(false)
    expect(result.cycle).toBe(false)
    expect(result.consume).toBe(false)
  })
})

// ─── promptKeys ──────────────────────────────────────────────────────────────

describe("promptKeys", () => {
  const keybinds: FooterKeybinds = {
    leader: "ctrl+space",
    leaderTimeout: 1000,
    commandList: [{ key: "ctrl+p", event: "press" }],
    variantCycle: [{ key: "ctrl+v", event: "press" }],
    interrupt: [{ key: "ctrl+c", event: "press" }],
    historyPrevious: [{ key: "ctrl+up", event: "press" }],
    historyNext: [{ key: "ctrl+down", event: "press" }],
    inputClear: [{ key: "escape", event: "press" }],
    inputSubmit: [{ key: "ctrl+return", event: "press" }],
    inputNewline: [{ key: "ctrl+enter", event: "press" }],
  }

  test("parses all keybind categories", () => {
    const keys = promptKeys(keybinds)
    expect(keys.leaders.length).toBeGreaterThan(0)
    expect(keys.cycles.length).toBeGreaterThan(0)
    expect(keys.interrupts.length).toBeGreaterThan(0)
    expect(keys.previous.length).toBeGreaterThan(0)
    expect(keys.next.length).toBeGreaterThan(0)
    expect(keys.clear.length).toBeGreaterThan(0)
    expect(keys.bindings.length).toBeGreaterThan(0)
  })

  test("generates textarea bindings for submit and newline", () => {
    const keys = promptKeys(keybinds)
    const submit = keys.bindings.find((b) => b.action === "submit")
    expect(submit).toBeDefined()
    const newline = keys.bindings.find((b) => b.action === "newline")
    expect(newline).toBeDefined()
  })
})
