import { Flag } from "@opencode-ai/core/flag/flag"
import type { SyntaxStyle } from "@opentui/core"
import { Match, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"

/**
 * Single seam for rendering assistant markdown text, owning the
 * OPENCODE_EXPERIMENTAL_MARKDOWN flag switch. v1 (`routes/session`) and v2
 * (`feature-plugins/system/session-v2`) both consume this so the flag cannot
 * drift between routes again.
 */
export function AssistantMarkdown(props: {
  content: string
  streaming?: boolean
  conceal: boolean
  syntax: SyntaxStyle
}) {
  const { theme } = useTheme()
  return (
    <Switch>
      <Match when={Flag.OPENCODE_EXPERIMENTAL_MARKDOWN}>
        <markdown
          syntaxStyle={props.syntax}
          streaming={props.streaming ?? true}
          content={props.content}
          conceal={props.conceal}
          fg={theme.markdownText}
          bg={theme.background}
        />
      </Match>
      <Match when={!Flag.OPENCODE_EXPERIMENTAL_MARKDOWN}>
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={props.streaming ?? true}
          syntaxStyle={props.syntax}
          content={props.content}
          conceal={props.conceal}
          fg={theme.text}
        />
      </Match>
    </Switch>
  )
}
