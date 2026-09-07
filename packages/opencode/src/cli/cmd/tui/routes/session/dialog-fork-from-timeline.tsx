import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { Locale } from "@/util/locale"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useDialog, type DialogContext } from "../../ui/dialog"
import type { PromptInfo } from "@tui/component/prompt/history"
import { fromUserMessage } from "@tui/component/prompt/part"

export function DialogForkFromTimeline(props: { sessionID: string; onMove: (messageID?: string) => void }) {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const route = useRoute()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string | undefined>[] => {
    const messages = sync.data.messages[props.sessionID] ?? []
    const fullSession = {
      title: "Full session",
      value: undefined,
      onSelect: async (dialog: DialogContext) => {
        const forked = await sdk.client.v2.session.fork({ sessionID: props.sessionID })
        route.navigate({
          sessionID: forked.data!.id,
          type: "session",
        })
        dialog.clear()
      },
    } satisfies DialogSelectOption<string | undefined>
    const result = [] as DialogSelectOption<string | undefined>[]
    for (const message of messages) {
      if (message.type !== "user") continue
      if (!message.text) continue
      result.push({
        title: message.text.replace(/\n/g, " "),
        value: message.id,
        footer: Locale.time(message.time.created),
        onSelect: async (dialog) => {
          const forked = await sdk.client.v2.session.fork({
            sessionID: props.sessionID,
            messageID: message.id,
          })
          const prompt: PromptInfo | undefined = message.type === "user" ? fromUserMessage(message) : undefined
          route.navigate({
            sessionID: forked.data!.id,
            type: "session",
            prompt,
          })
          dialog.clear()
        },
      })
    }
    return [fullSession, ...result.reverse()]
  })

  return <DialogSelect onMove={(option) => props.onMove(option.value)} title="Fork session" options={options()} />
}
