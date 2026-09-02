import style from "./content-bash.module.css"
import { createResource, createSignal, createEffect } from "solid-js"
import { createOverflow, useShareMessages } from "./common"
import { codeToHtml } from "shiki"
import DOMPurify from "isomorphic-dompurify"

interface Props {
  command: string
  output: string
  description?: string
  expand?: boolean
}

export function ContentBash(props: Props) {
  const messages = useShareMessages()
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

  let commandRef!: HTMLDivElement
  let outputRef!: HTMLDivElement

  createEffect(() => {
    const content = commandHtml()
    if (content && commandRef) {
      commandRef.innerHTML = ""
      if (!DOMPurify.isSupported) {
        return
      }
      const fragment = DOMPurify.sanitize(content, { RETURN_DOM_FRAGMENT: true }) as unknown as DocumentFragment
      commandRef.appendChild(fragment.cloneNode(true))
    }
  })

  createEffect(() => {
    const content = outputHtml()
    if (content && outputRef) {
      outputRef.innerHTML = ""
      if (!DOMPurify.isSupported) {
        return
      }
      const fragment = DOMPurify.sanitize(content, { RETURN_DOM_FRAGMENT: true }) as unknown as DocumentFragment
      outputRef.appendChild(fragment.cloneNode(true))
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
          <div data-slot="output" ref={(el) => { overflow.ref(el); outputRef = el; }} />
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
