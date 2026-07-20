// Mention part management for the prompt textarea.
//
// Handles extmark creation, syncing, and restoration for @mentions (files/agents).
// Takes TextareaRenderable as a parameter — no TUI or SolidJS dependencies.
import type { TextareaRenderable } from "@opentui/core"
import type { RunPrompt, RunPromptPart } from "../types"

type Mention = Extract<RunPromptPart, { type: "file" | "agent" }>

export type PartManagerState = {
  parts: Mention[]
  marks: Map<number, number>
  type: number
}

export function createPartManagerState(): PartManagerState {
  return {
    parts: [],
    marks: new Map(),
    type: 0,
  }
}

export function clonePrompt(prompt: RunPrompt): RunPrompt {
  return {
    text: prompt.text,
    parts: structuredClone(prompt.parts),
  }
}

export function clearParts(state: PartManagerState, area?: TextareaRenderable): PartManagerState {
  if (area && !area.isDestroyed) {
    area.extmarks.clear()
  }
  return { ...state, parts: [], marks: new Map() }
}

export function syncParts(state: PartManagerState, area?: TextareaRenderable): PartManagerState {
  if (!area || area.isDestroyed || state.type === 0) {
    return state
  }

  const next: Mention[] = []
  const map = new Map<number, number>()
  for (const item of area.extmarks.getAllForTypeId(state.type)) {
    const idx = state.marks.get(item.id)
    if (idx === undefined) {
      continue
    }

    const part = state.parts[idx]
    if (!part) {
      continue
    }

    const text = area.plainText.slice(item.start, item.end)
    const prev =
      part.type === "agent"
        ? (part.source?.value ?? "@" + part.name)
        : (part.source?.text.value ?? "@" + (part.filename ?? ""))
    if (text !== prev) {
      continue
    }

    const copy = structuredClone(part)
    if (copy.type === "agent") {
      copy.source = {
        start: item.start,
        end: item.end,
        value: text,
      }
    }
    if (copy.type === "file" && copy.source?.text) {
      copy.source.text.start = item.start
      copy.source.text.end = item.end
      copy.source.text.value = text
    }

    map.set(item.id, next.length)
    next.push(copy)
  }

  const stale = map.size !== state.marks.size
  const newState: PartManagerState = { ...state, parts: next, marks: map }
  if (stale) {
    return restoreParts(newState, area)
  }

  return newState
}

export function restoreParts(state: PartManagerState, area?: TextareaRenderable): PartManagerState {
  const cleared = clearParts(state, area)
  const parts = state.parts
    .filter((item): item is Mention => item.type === "file" || item.type === "agent")
    .map((item) => structuredClone(item))

  if (!area || area.isDestroyed || cleared.type === 0) {
    return { ...cleared, parts }
  }

  const box = area
  const marks = new Map<number, number>()
  parts.forEach((item, idx) => {
    const start = item.type === "agent" ? item.source?.start : item.source?.text.start
    const end = item.type === "agent" ? item.source?.end : item.source?.text.end
    if (start === undefined || end === undefined) {
      return
    }

    const id = box.extmarks.create({
      start,
      end,
      virtual: true,
      typeId: cleared.type,
    })
    marks.set(id, idx)
  })

  return { ...cleared, parts, marks }
}

export function insertMention(
  state: PartManagerState,
  part: Mention,
  startOffset: number,
  endOffset: number,
  area?: TextareaRenderable,
): PartManagerState {
  if (!area || area.isDestroyed || state.type === 0) {
    return state
  }

  const text = "@" + (part.type === "agent" ? part.name : part.filename ?? "")
  const mention = structuredClone(part)
  if (mention.type === "agent") {
    mention.source = {
      start: startOffset,
      end: endOffset,
      value: text,
    }
  }
  if (mention.type === "file" && mention.source?.text) {
    mention.source.text.start = startOffset
    mention.source.text.end = endOffset
    mention.source.text.value = text
  }

  let { parts, marks } = state

  // Deduplicate file mentions by URL
  if (mention.type === "file") {
    const prev = parts.findIndex((item) => item.type === "file" && item.url === mention.url)
    if (prev !== -1) {
      const mark = [...marks.entries()].find((item) => item[1] === prev)?.[0]
      if (mark !== undefined) {
        area.extmarks.delete(mark)
      }
      parts = parts.filter((_, idx) => idx !== prev)
      marks = new Map(
        [...marks.entries()]
          .filter((item) => item[0] !== mark)
          .map((item) => [item[0], item[1] > prev ? item[1] - 1 : item[1]]),
      )
    }
  }

  const id = area.extmarks.create({
    start: startOffset,
    end: endOffset,
    virtual: true,
    typeId: state.type,
  })
  marks.set(id, parts.length)
  parts = [...parts, mention]

  return { ...state, parts, marks }
}
