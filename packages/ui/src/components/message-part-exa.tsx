/**
 * Exa (websearch) tool-output rendering extracted from message-part.tsx
 * (#380 Phase 2): renders the URLs the search returned as a plain link list.
 * The only logic — link extraction — is `urls`, already characterized by
 * message-part-shared.test.ts.
 */
import { For, Show, createMemo } from "solid-js"

import { urls } from "./message-part-shared"

export function ExaOutput(props: { output?: string }) {
  const links = createMemo(() => urls(props.output))

  return (
    <Show when={links().length > 0}>
      <div data-component="exa-tool-output">
        <div data-slot="exa-tool-links">
          <For each={links()}>
            {(url) => (
              <a
                data-slot="exa-tool-link"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                {url}
              </a>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
