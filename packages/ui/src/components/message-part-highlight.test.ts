// Characterization tests (Rule 3, #380 Phase 1/2): lock highlightSegments —
// the pure plain/file/agent segmenter behind HighlightedText — in
// message-part-highlight.tsx before/after the god-file split.
import { describe, expect, test } from "bun:test"
import type { AgentPart, FilePart } from "@opencode-ai/sdk/v2"
import { highlightSegments } from "./message-part-highlight"

// Minimal part fixtures cast to the SDK types: highlightSegments only reads
// the source ranges, not the rest of the part shape.
const filePart = (start: number, end: number): FilePart =>
  ({
    id: "f",
    type: "file",
    source: { text: { start, end } },
  }) as FilePart

const agentPart = (start: number, end: number): AgentPart =>
  ({
    id: "a",
    type: "agent",
    source: { start, end },
  }) as AgentPart

describe("highlightSegments", () => {
  test("text without references is a single plain segment", () => {
    expect(highlightSegments("hello world", [], [])).toEqual([{ text: "hello world" }])
  })

  test("empty text yields no segments", () => {
    expect(highlightSegments("", [], [])).toEqual([])
  })

  test("a file reference highlights only its source range", () => {
    expect(highlightSegments("see src/a.ts now", [filePart(4, 12)], [])).toEqual([
      { text: "see " },
      { text: "src/a.ts", type: "file" },
      { text: " now" },
    ])
  })

  test("an agent reference highlights its source range", () => {
    expect(highlightSegments("ask @build", [], [agentPart(4, 10)])).toEqual([
      { text: "ask " },
      { text: "@build", type: "agent" },
    ])
  })

  test("file and agent references sort by start regardless of input order", () => {
    // "f.ts" spans [7,11)
    expect(highlightSegments("x @a y f.ts z", [filePart(7, 11)], [agentPart(2, 4)])).toEqual([
      { text: "x " },
      { text: "@a", type: "agent" },
      { text: " y " },
      { text: "f.ts", type: "file" },
      { text: " z" },
    ])
  })

  test("references overlapping already-consumed text are skipped", () => {
    // [2,7) overlaps [0,5): after [0,5) sets lastIndex=5, [2,7) starts at 2 < 5 -> dropped
    expect(highlightSegments("abcdefghi", [filePart(0, 5), filePart(2, 7)], [])).toEqual([
      { text: "abcde", type: "file" },
      { text: "fghi" },
    ])
  })

  test("a reference starting exactly at lastIndex is honored, not skipped", () => {
    // [5,8) starts at lastIndex 5 set by [0,5) — adjacent refs are kept
    expect(highlightSegments("abcdefgh", [filePart(0, 5), filePart(5, 8)], [])).toEqual([
      { text: "abcde", type: "file" },
      { text: "fgh", type: "file" },
    ])
  })

  test("references with partial source ranges are ignored", () => {
    // start present, end missing -> dropped
    const partial = ({ id: "p", type: "file", source: { text: { start: 2 } } }) as FilePart
    expect(highlightSegments("abcde", [partial], [])).toEqual([{ text: "abcde" }])
  })

  test("a reference extending past the text end clamps to the text length", () => {
    expect(highlightSegments("abc", [filePart(1, 99)], [])).toEqual([
      { text: "a" },
      { text: "bc", type: "file" },
    ])
  })
})
