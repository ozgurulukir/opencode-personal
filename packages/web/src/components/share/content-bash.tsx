import style from "./content-bash.module.css"
import { createResource, createSignal, createEffect } from "solid-js"
import { isServer } from "solid-js/web"
import DOMPurify from "isomorphic-dompurify"
import { createOverflow, useShareMessages } from "./common"
import { codeToHtml } from "shiki"

interface Props {
  command: string
  output: string
  description?: string
  expand?: boolean
}

export function ContentBash(props: Props) {
  const messages = useShareMessages()
  let commandRef: HTMLDivElement | undefined
  let outputRef: HTMLDivElement | undefined

  const [commandHtml] = createResource(
    () => props.command,
    async (command) => {
      const html = await codeToHtml(command || "", {
        lang: "bash",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
      })
      return html
    },
  )

  const [outputHtml] = createResource(
    () => props.output,
    async (output) => {
      const html = await codeToHtml(output || "", {
        lang: "console",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
      })
      return html
    },
  )

  const [expanded, setExpanded] = createSignal(false)
  const overflow = createOverflow()

  createEffect(() => {
    const content = commandHtml()
    if (!isServer && commandRef && content) {
      commandRef.textContent = ""
      commandRef.appendChild(DOMPurify.sanitize(content, { RETURN_DOM_FRAGMENT: true }))
    }
  })

  createEffect(() => {
    const content = outputHtml()
    if (!isServer && outputRef && content) {
      outputRef.textContent = ""
      outputRef.appendChild(DOMPurify.sanitize(content, { RETURN_DOM_FRAGMENT: true }))
    }
  })

  return (
    <div class={style.root} data-expanded={expanded() || props.expand === true ? true : undefined}>
      <div data-slot="body">
        <div data-slot="header">
          <span>{props.description}</span>
        </div>
        <div data-slot="content">
          <div ref={commandRef} />
          <div data-slot="output" ref={(el) => { outputRef = el; overflow.ref(el) }} />
          <noscript>
            <pre>{props.command}</pre>
            <pre>{props.output}</pre>
          </noscript>
        </div>
      </div>

      {!props.expand && overflow.status && (
        <button
          type="button"
          data-component="text-button"
          data-slot="expand-button"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded() ? messages.show_less : messages.show_more}
        </button>
      )}
    </div>
  )
}
