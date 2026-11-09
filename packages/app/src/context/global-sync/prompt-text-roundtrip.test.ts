import { describe, expect, test } from "bun:test"
import type {
  PromptAgentAttachment,
  PromptFileAttachment,
  SessionMessage,
  SessionMessageUser,
} from "@opencode-ai/sdk/v2/client"
import { createStore } from "solid-js/store"
import { buildRequestParts } from "@/components/prompt-input/build-request-parts"
import type { ImageAttachmentPart, Prompt } from "@/context/prompt"
import { applyDirectoryEvent } from "./event-reducer"
import type { State } from "./types"
import { messageText, sessionMessagesToV1 } from "./v2-adapter"

// Prompt text round-trip: draft → optimistic → server projection → live event
// → load. Optimistic confirmation matches by prompt text (resolveOptimistic /
// sync.tsx), so every stage must yield the identical string for one draft:
//
//   draft text + attachments
//     → buildRequestParts
//     → optimisticParts ── messageText() ──────────────── stage A
//     → requestParts non-synthetic text joined "\n"      stage B (mirrors
//         create-user-message.ts:440-445,510)
//     → promptedEvent → applyDirectoryEvent → messageText stage C
//     → SessionMessage fixture → sessionMessagesToV1
//         → messageText ───────────────────────────────── stage D
//
// Known divergence (documented, canaried below): messageText also filters
// `ignored` text parts, while the server projection only filters `synthetic`.
// Harmless today because buildRequestParts never sets `ignored: true`; if that
// changes, stage B must gain the ignored filter.

const sessionID = "ses_roundtrip"
const eventID = "evt_prompted"
const optimisticID = "msg_opt"

const emptyState = () => ({ message: {}, part: {} }) as State

const sessionUser = (
  text: string,
  files: PromptFileAttachment[],
  agents: PromptAgentAttachment[],
): SessionMessageUser => ({
  id: eventID,
  type: "user",
  text,
  ...(files.length ? { files } : {}),
  ...(agents.length ? { agents } : {}),
  agent: "assistant",
  model: { id: "gpt", providerID: "openai", variant: "default" },
  time: { created: 1 },
})

function roundTrip(input: {
  text: string
  prompt?: Prompt
  context?: Parameters<typeof buildRequestParts>[0]["context"]
  images?: ImageAttachmentPart[]
}) {
  const { requestParts, optimisticParts } = buildRequestParts({
    prompt: input.prompt ?? [],
    context: input.context ?? [],
    images: input.images ?? [],
    text: input.text,
    messageID: optimisticID,
    sessionID,
    sessionDirectory: "/repo",
  })

  // Stage A — client optimistic text (messageText filters synthetic/ignored).
  const stageA = messageText(optimisticParts)

  // Stage B — server projection: non-synthetic text parts joined "\n"
  // (create-user-message.ts:440-445,510). No `ignored` filter — see header.
  const stageB = requestParts
    .flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : []))
    .join("\n")

  // Prompt attachments mapped the way the server projects V1 parts into the
  // prompted event (create-user-message.ts:446-475).
  const files: PromptFileAttachment[] = requestParts.flatMap((part) =>
    part.type === "file"
      ? [
          {
            uri: part.url,
            mime: part.mime,
            name: part.filename,
            ...(part.source
              ? { source: { start: part.source.text.start, end: part.source.text.end, text: part.source.text.value } }
              : {}),
          },
        ]
      : [],
  )
  const agents: PromptAgentAttachment[] = requestParts.flatMap((part) =>
    part.type === "agent"
      ? [
          {
            name: part.name,
            ...(part.source
              ? { source: { start: part.source.start, end: part.source.end, text: part.source.value } }
              : {}),
          },
        ]
      : [],
  )

  // Stage C — live event path.
  const [store, setStore] = createStore(emptyState())
  applyDirectoryEvent({
    event: {
      id: eventID,
      type: "session.next.prompted",
      properties: {
        sessionID,
        timestamp: 1,
        prompt: { text: stageB, ...(files.length ? { files } : {}), ...(agents.length ? { agents } : {}) },
        agent: "assistant",
        model: { id: "gpt", providerID: "openai" },
      },
    },
    store,
    setStore,
    push() {},
    directory: "/tmp",
    loadLsp() {},
  })
  // The server emits each synthetic text as its own session.next.synthetic
  // event after prompted (create-user-message.ts:516-524) — replay them so
  // stage C exercises the synthetic filter instead of trivially matching.
  const synthetic = requestParts.flatMap((part) => (part.type === "text" && part.synthetic ? [part.text] : []))
  synthetic.forEach((text, index) =>
    applyDirectoryEvent({
      event: {
        id: `evt_synth_${index}`,
        type: "session.next.synthetic",
        properties: { sessionID, timestamp: 1, text },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    }),
  )
  const stageC = messageText(store.part[eventID] ?? [])

  // Stage D — load path.
  const loaded = sessionMessagesToV1(
    [
      sessionUser(stageB, files, agents),
      ...synthetic.map(
        (text, index): SessionMessage => ({
          id: `evt_synth_${index}`,
          type: "synthetic",
          sessionID,
          text,
          time: { created: 1 },
        }),
      ),
    ],
    sessionID,
  )
  const stageD = messageText(loaded.part[eventID] ?? [])

  return { requestParts, optimisticParts, synthetic, stageA, stageB, stageC, stageD, store, loaded }
}

describe("prompt text round-trip", () => {
  test("plain single-line draft text is identical at every stage", () => {
    const text = "hello world"
    const r = roundTrip({ text })

    expect(r.stageA).toBe(text)
    expect(r.stageB).toBe(text)
    expect(r.stageC).toBe(text)
    expect(r.stageD).toBe(text)
  })

  test("multi-line draft text is not trimmed or normalized at any stage", () => {
    const text = "line1\nline2"
    const r = roundTrip({ text })

    expect(r.stageA).toBe(text)
    expect(r.stageB).toBe(text)
    expect(r.stageC).toBe(text)
    expect(r.stageD).toBe(text)
  })

  test("file attachment does not change the text at any stage", () => {
    const text = "check this file"
    const r = roundTrip({
      text,
      prompt: [{ type: "file", path: "src/foo.ts", content: "const x = 1", start: 12, end: 23 }],
    })

    expect(r.stageA).toBe(text)
    expect(r.stageB).toBe(text)
    expect(r.stageC).toBe(text)
    expect(r.stageD).toBe(text)

    // The file part survives as a non-text part at every stage.
    expect(r.optimisticParts.some((part) => part.type === "file")).toBe(true)
    expect(r.requestParts.some((part) => part.type === "file")).toBe(true)
    expect((r.store.part[eventID] ?? []).some((part) => part.type === "file")).toBe(true)
    expect((r.loaded.part[eventID] ?? []).some((part) => part.type === "file")).toBe(true)
  })

  test("agent attachment does not change the text at any stage", () => {
    const text = "ask the planner"
    const r = roundTrip({
      text,
      prompt: [{ type: "agent", name: "planner", content: "@planner", start: 16, end: 24 }],
    })

    expect(r.stageA).toBe(text)
    expect(r.stageB).toBe(text)
    expect(r.stageC).toBe(text)
    expect(r.stageD).toBe(text)

    expect(r.optimisticParts.some((part) => part.type === "agent")).toBe(true)
    expect(r.requestParts.some((part) => part.type === "agent")).toBe(true)
    expect((r.store.part[eventID] ?? []).some((part) => part.type === "agent")).toBe(true)
    expect((r.loaded.part[eventID] ?? []).some((part) => part.type === "agent")).toBe(true)
  })

  test("context comment stays synthetic and is excluded from every stage", () => {
    const text = "please review"
    const r = roundTrip({
      text,
      context: [{ key: "ctx:1", type: "file", path: "src/bar.ts", comment: "fix this" }],
    })

    expect(r.stageA).toBe(text)
    expect(r.stageB).toBe(text)
    expect(r.stageC).toBe(text)
    expect(r.stageD).toBe(text)

    // The synthetic comment text is present as a part, so the stage
    // assertions above prove the filters exclude it (not its absence).
    expect(r.synthetic).toHaveLength(1)
    expect(r.optimisticParts.some((part) => part.type === "text" && part.synthetic)).toBe(true)
    expect(r.requestParts.some((part) => part.type === "text" && part.synthetic)).toBe(true)
    expect((r.store.part[eventID] ?? []).some((part) => part.type === "text" && part.synthetic)).toBe(true)
    expect((r.loaded.part[eventID] ?? []).some((part) => part.type === "text" && part.synthetic)).toBe(true)

    // The context file itself arrives as a non-text part.
    expect(r.requestParts.some((part) => part.type === "file")).toBe(true)
    expect((r.store.part[eventID] ?? []).some((part) => part.type === "file")).toBe(true)
  })

  test("image attachment does not change the text at any stage", () => {
    const text = "see attached"
    const r = roundTrip({
      text,
      images: [
        { type: "image", id: "img_1", filename: "shot.png", mime: "image/png", dataUrl: "data:image/png;base64,AAAA" },
      ],
    })

    expect(r.stageA).toBe(text)
    expect(r.stageB).toBe(text)
    expect(r.stageC).toBe(text)
    expect(r.stageD).toBe(text)

    expect(r.requestParts.some((part) => part.type === "file" && part.url.startsWith("data:"))).toBe(true)
    expect((r.store.part[eventID] ?? []).some((part) => part.type === "file")).toBe(true)
  })

  test("canary: request parts never set ignored (stage B would not filter it)", () => {
    const r = roundTrip({
      text: "rich draft",
      prompt: [
        { type: "file", path: "src/foo.ts", content: "const x = 1", start: 12, end: 23 },
        { type: "agent", name: "planner", content: "@planner", start: 24, end: 32 },
      ],
      context: [{ key: "ctx:1", type: "file", path: "src/bar.ts", comment: "note" }],
      images: [
        { type: "image", id: "img_1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
      ],
    })

    expect(r.requestParts.every((part) => !(part.type === "text" && part.ignored === true))).toBe(true)
    expect(r.optimisticParts.every((part) => !(part.type === "text" && part.ignored === true))).toBe(true)
  })
})
