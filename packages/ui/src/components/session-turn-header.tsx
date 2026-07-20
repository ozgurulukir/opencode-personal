import { Show } from "solid-js"
import { MessageDivider } from "./message-part"
import { Card } from "./card"

export function SessionTurnHeader(props: {
  divider: string
  error: unknown
  errorText: string
}) {
  return (
    <>
      <Show when={props.divider}>
        <div data-slot="session-turn-compaction">
          <MessageDivider label={props.divider} />
        </div>
      </Show>
      <Show when={props.error}>
        <Card variant="error" class="error-card">
          {props.errorText}
        </Card>
      </Show>
    </>
  )
}
