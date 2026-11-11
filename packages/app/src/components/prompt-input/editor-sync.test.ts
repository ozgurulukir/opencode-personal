import { describe, expect, test } from "bun:test"
import { createPill, isNormalizedEditor, parseFromDOM, renderEditor } from "./editor-sync"

function textNode(content: string) {
  return document.createTextNode(content)
}

function pillEl(kind: "file" | "agent", value: string) {
  const el = document.createElement("span")
  el.setAttribute("data-type", kind)
  if (kind === "file") el.setAttribute("data-path", value)
  if (kind === "agent") el.setAttribute("data-name", value)
  el.textContent = "@" + value
  return el
}

describe("prompt-input editor-sync", () => {
  test("createPill builds a non-editable span with data attributes", () => {
    const pill = createPill({ type: "file", path: "src/a.ts", content: "@src/a.ts", start: 0, end: 9 })
    expect(pill.textContent).toBe("@src/a.ts")
    expect(pill.getAttribute("data-type")).toBe("file")
    expect(pill.getAttribute("data-path")).toBe("src/a.ts")
    expect(pill.getAttribute("contenteditable")).toBe("false")
  })

  test("createPill records agent pills with data-name", () => {
    const pill = createPill({ type: "agent", name: "plan", content: "@plan", start: 0, end: 5 })
    expect(pill.getAttribute("data-type")).toBe("agent")
    expect(pill.getAttribute("data-name")).toBe("plan")
  })

  test("isNormalizedEditor accepts plain text nodes", () => {
    const editor = document.createElement("div")
    editor.appendChild(textNode("hello"))
    expect(isNormalizedEditor(editor)).toBe(true)
  })

  test("isNormalizedEditor rejects a zero-width char embedded in longer text", () => {
    const editor = document.createElement("div")
    editor.appendChild(textNode("a\u200Bb"))
    expect(isNormalizedEditor(editor)).toBe(false)
  })

  test("isNormalizedEditor accepts the terminal zero-width node after a break", () => {
    const editor = document.createElement("div")
    editor.appendChild(textNode("hi"))
    editor.appendChild(document.createElement("br"))
    editor.appendChild(textNode("\u200B"))
    expect(isNormalizedEditor(editor)).toBe(true)
  })

  test("isNormalizedEditor accepts file and agent pills and breaks", () => {
    const editor = document.createElement("div")
    editor.appendChild(pillEl("file", "a.ts"))
    editor.appendChild(document.createElement("br"))
    editor.appendChild(pillEl("agent", "plan"))
    expect(isNormalizedEditor(editor)).toBe(true)
  })

  test("isNormalizedEditor rejects unrelated elements", () => {
    const editor = document.createElement("div")
    editor.appendChild(document.createElement("img"))
    expect(isNormalizedEditor(editor)).toBe(false)
  })

  test("parseFromDOM reads plain text as a single part", () => {
    const editor = document.createElement("div")
    editor.appendChild(textNode("hello world"))
    expect(parseFromDOM(editor)).toEqual([{ type: "text", content: "hello world", start: 0, end: 11 }])
  })

  test("parseFromDOM splits pills out of text with sequential positions", () => {
    const editor = document.createElement("div")
    editor.appendChild(textNode("look "))
    editor.appendChild(pillEl("file", "a.ts"))
    editor.appendChild(textNode(" now"))
    const parts = parseFromDOM(editor)
    expect(parts).toEqual([
      { type: "text", content: "look ", start: 0, end: 5 },
      { type: "file", path: "a.ts", content: "@a.ts", start: 5, end: 10 },
      { type: "text", content: " now", start: 10, end: 14 },
    ])
  })

  test("parseFromDOM turns breaks into newlines and strips zero-width chars", () => {
    const editor = document.createElement("div")
    editor.appendChild(textNode("foo"))
    editor.appendChild(document.createElement("br"))
    editor.appendChild(textNode("bar\u200B"))
    expect(parseFromDOM(editor)).toEqual([{ type: "text", content: "foo\nbar", start: 0, end: 7 }])
  })

  test("parseFromDOM separates sibling block elements with a newline", () => {
    const editor = document.createElement("div")
    const first = document.createElement("div")
    first.appendChild(textNode("one"))
    const second = document.createTextNode("two")
    editor.appendChild(first)
    editor.appendChild(second)
    expect(parseFromDOM(editor)).toEqual([{ type: "text", content: "one\ntwo", start: 0, end: 7 }])
  })

  test("parseFromDOM falls back to DEFAULT_PROMPT for an empty editor", () => {
    const editor = document.createElement("div")
    expect(parseFromDOM(editor)).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
  })

  test("renderEditor then parseFromDOM round-trips text with newlines", () => {
    const editor = document.createElement("div")
    renderEditor(editor, [{ type: "text", content: "foo\nbar", start: 0, end: 7 }])
    expect(parseFromDOM(editor)).toEqual([{ type: "text", content: "foo\nbar", start: 0, end: 7 }])
  })

  test("renderEditor then parseFromDOM preserves pills with their content lengths", () => {
    const editor = document.createElement("div")
    renderEditor(editor, [
      { type: "text", content: "see ", start: 0, end: 4 },
      { type: "file", path: "x.ts", content: "@x.ts", start: 4, end: 9 },
      { type: "text", content: "", start: 9, end: 9 },
    ])
    const parts = parseFromDOM(editor)
    expect(parts).toEqual([
      { type: "text", content: "see ", start: 0, end: 4 },
      { type: "file", path: "x.ts", content: "@x.ts", start: 4, end: 9 },
    ])
  })
})
