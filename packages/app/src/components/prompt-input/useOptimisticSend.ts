import type { Message, Part } from "@opencode-ai/sdk/v2"

export type OptimisticSend = {
  session: {
    optimistic: {
      add: (input: { directory: string; sessionID: string; message: Message; parts: Part[] }) => void
      remove: (input: { directory: string; sessionID: string; messageID: string }) => void
    }
  }
}

export const optimisticAdd = (sync: OptimisticSend, directory: string, sessionID: string, message: Message, parts: Part[]) => {
  sync.session.optimistic.add({ directory, sessionID, message, parts })
}

export const optimisticRemove = (sync: OptimisticSend, directory: string, sessionID: string, messageID: string) => {
  sync.session.optimistic.remove({ directory, sessionID, messageID })
}
