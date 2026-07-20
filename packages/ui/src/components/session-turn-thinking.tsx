import { Show } from "solid-js"
import { TextShimmer } from "./text-shimmer"
import { TextReveal } from "./text-reveal"

export function SessionTurnThinking(props: {
  show: boolean
  showReasoningSummaries: boolean
  reasoningHeading: string | undefined
  t: (key: string) => string
}) {
  return (
    <Show when={props.show}>
      <div data-slot="session-turn-thinking">
        <TextShimmer text={props.t("ui.sessionTurn.status.thinking")} />
        <Show when={!props.showReasoningSummaries}>
          <TextReveal
            text={props.reasoningHeading}
            class="session-turn-thinking-heading"
            travel={25}
            duration={700}
          />
        </Show>
      </div>
    </Show>
  )
}
