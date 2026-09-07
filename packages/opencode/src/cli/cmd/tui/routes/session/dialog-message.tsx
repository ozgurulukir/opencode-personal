import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import * as Clipboard from "@tui/util/clipboard"
import type { PromptInfo } from "@tui/component/prompt/history"
import { fromUserMessage } from "@tui/component/prompt/part"

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const sdk = useSDK()
  const message = createMemo(() => sync.data.messages[props.sessionID]?.find((x) => x.id === props.messageID))
  const route = useRoute()

  return (
    <DialogSelect
      title="Message Actions"
      options={[
        {
          title: "Revert",
          value: "session.revert",
          description: "undo messages and file changes",
          onSelect: (dialog) => {
            const msg = message()
            if (!msg) return

            void sdk.client.v2.session.revert({
              sessionID: props.sessionID,
              messageID: msg.id,
            })

            if (props.setPrompt && msg.type === "user") {
              props.setPrompt(fromUserMessage(msg))
            }

            dialog.clear()
          },
        },
        {
          title: "Copy",
          value: "message.copy",
          description: "message text to clipboard",
          onSelect: async (dialog) => {
            const msg = message()
            if (!msg) return

            await Clipboard.copy(msg.type === "user" ? msg.text : "")
            dialog.clear()
          },
        },
        {
          title: "Fork",
          value: "session.fork",
          description: "create a new session",
          onSelect: async (dialog) => {
            const result = await sdk.client.v2.session.fork({
              sessionID: props.sessionID,
              messageID: props.messageID,
            })
            const msg = message()
            const prompt = msg?.type === "user" ? fromUserMessage(msg) : undefined
            route.navigate({
              sessionID: result.data!.id,
              type: "session",
              prompt,
            })
            dialog.clear()
          },
        },
      ]}
    />
  )
}
