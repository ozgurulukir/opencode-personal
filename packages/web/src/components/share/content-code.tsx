import { codeToHtml, bundledLanguages } from "shiki"
import { createResource, Suspense, createEffect } from "solid-js"
import DOMPurify from "isomorphic-dompurify"
import style from "./content-code.module.css"

interface Props {
  code: string
  lang?: string
  flush?: boolean
}
export function ContentCode(props: Props) {
  const [html] = createResource(
    () => [props.code, props.lang],
    async ([code, lang]) => {
      const htmlOutput = await codeToHtml(code || "", {
        lang: lang && lang in bundledLanguages ? lang : "text",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
      })
      return htmlOutput
    },
  )

  let codeRef!: HTMLDivElement

  createEffect(() => {
    const content = html()
    if (content && codeRef) {
      codeRef.innerHTML = ""
      if (!DOMPurify.isSupported) {
        return
      }
      const fragment = DOMPurify.sanitize(content, { RETURN_DOM_FRAGMENT: true }) as unknown as DocumentFragment
      codeRef.appendChild(fragment.cloneNode(true))
    }
  })

  return (
    <Suspense>
      <div ref={codeRef} class={style.root} data-flush={props.flush === true ? true : undefined} />
    </Suspense>
  )
}
