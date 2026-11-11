/**
 * User-message inline highlighting extracted from message-part.tsx (#380
 * Phase 2): splits user text into plain/file/agent segments from the file and
 * agent parts' source ranges so mentions render highlighted inline.
 * highlightSegments is the pure core, characterized by
 * message-part-highlight.test.ts (Rule 3).
 */
import { For, createMemo } from "solid-js"
import type { AgentPart, FilePart } from "@opencode-ai/sdk/v2"

export type HighlightSegment = { text: string; type?: "file" | "agent" }

export function highlightSegments(text: string, references: FilePart[], agents: AgentPart[]): HighlightSegment[] {
  // ⚡ Bolt Optimization: Replace chained .filter().map() with direct loops
  const allRefs: { start: number; end: number; type: "file" | "agent" }[] = []

  for (let i = 0; i < references.length; i++) {
    const r = references[i]
    if (r.source?.text?.start !== undefined && r.source?.text?.end !== undefined) {
      allRefs.push({ start: r.source.text.start, end: r.source.text.end, type: "file" })
    }
  }

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i]
    if (a.source?.start !== undefined && a.source?.end !== undefined) {
      allRefs.push({ start: a.source.start, end: a.source.end, type: "agent" })
    }
  }

  allRefs.sort((a, b) => a.start - b.start)

  const result: HighlightSegment[] = []
  let lastIndex = 0

  for (const ref of allRefs) {
    if (ref.start < lastIndex) continue

    if (ref.start > lastIndex) {
      result.push({ text: text.slice(lastIndex, ref.start) })
    }

    result.push({ text: text.slice(ref.start, ref.end), type: ref.type })
    lastIndex = ref.end
  }

  if (lastIndex < text.length) {
    result.push({ text: text.slice(lastIndex) })
  }

  return result
}

export function HighlightedText(props: { text: string; references: FilePart[]; agents: AgentPart[] }) {
  const segments = createMemo(() => highlightSegments(props.text, props.references, props.agents))

  return <For each={segments()}>{(segment) => <span data-highlight={segment.type}>{segment.text}</span>}</For>
}