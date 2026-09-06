import { createStore } from "solid-js/store"

type SyncStore = {
  session: Array<{ id: string; parentID?: string }>
  permission: Record<string, Array<{ id: string; sessionID: string; permission: string; patterns: string[] }>>
  question: Record<string, Array<{ id: string; questions: unknown[] }>>
  session_diff: Record<string, Array<{ file: string }>>
  message: Record<string, Array<{ id: string; role: string }>>
  session_status: Record<string, { type: "idle" | "busy" }>
  agent: Array<{ name: string; mode: string; hidden: boolean }>
  command: Array<{ name: string; description: string; source: string }>
}

const [data, setData] = createStore<SyncStore>({
  session: [],
  permission: {},
  question: {},
  session_diff: {},
  message: {
    "story-session": [],
  },
  session_status: {},
  agent: [{ name: "build", mode: "task", hidden: false }],
  command: [{ name: "fix", description: "Run fix command", source: "project" }],
})

export function useSync() {
  return {
    data,
    set(...input: unknown[]) {
      ;(setData as (...args: unknown[]) => void)(...input)
    },
    session: {
      get(id: string) {
        return { id }
      },
      optimistic: {
        add() {},
        remove() {},
      },
    },
  }
}
