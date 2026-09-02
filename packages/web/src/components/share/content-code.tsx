import { codeToHtml, bundledLanguages } from "shiki"
import { createResource, Suspense, createEffect } from "solid-js"
import { isServer } from "solid-js/web"
import DOMPurify from "isomorphic-dompurify"
import style from "./content-code.module.css"

interface Props {
  code: string
  lang?: string
  flush?: boolean
}
export function ContentCode(props: Props) {
  let ref: HTMLDivElement | undefined

  const [html] = createResource(
    () => [props.code, props.lang],
    async ([code, lang]) => {
      return (await codeToHtml(code || "", {
        lang: lang && lang in bundledLanguages ? lang : "text",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
      })) as string
    },
  )

  createEffect(() => {
    const content = html()
    if (!isServer && ref && content) {
      ref.innerHTML = ""
      ref.appendChild(DOMPurify.sanitize(content, { RETURN_DOM_FRAGMENT: true }) as Node)
    }
  })

  return (
    <Suspense>
      <div ref={ref} class={style.root} data-flush={props.flush === true ? true : undefined} />
      <noscript>
        <pre>{props.code}</pre>
      </noscript>
    </Suspense>
  )
}
