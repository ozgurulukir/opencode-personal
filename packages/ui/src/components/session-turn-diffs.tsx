import { createEffect, createMemo, createResource, createSignal, For, on, Show, type ValidComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { Accordion } from "./accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { DiffChanges } from "./diff-changes"
import { Icon } from "./icon"
import { normalize, type ViewDiff } from "./session-diff"
import { MAX_FILES, type SummaryDiff } from "./session-turn-utils"

export function SessionTurnDiffs(props: {
  diffs: SummaryDiff[]
  edited: number
  working: boolean
  fileComponent: ValidComponent
  autoScroll: { pause: () => void }
  t: (key: string, params?: Record<string, string | number | boolean>) => string
}) {
  const [state, setState] = createStore({
    showAll: false,
    expanded: [] as string[],
  })
  const showAll = () => state.showAll
  const expanded = () => state.expanded
  const overflow = createMemo(() => Math.max(0, props.edited - MAX_FILES))
  const visible = createMemo(() => (showAll() ? props.diffs : props.diffs.slice(0, MAX_FILES)))
  const [views, setViews] = createResource(visible, (diffs) => Promise.all(diffs.map((d) => normalize(d))))
  const toggleAll = () => {
    props.autoScroll.pause()
    setState("showAll", !showAll())
  }

  return (
    <Show when={props.edited > 0 && !props.working}>
      <div
        data-slot="session-turn-diffs"
        data-component="session-turn-diffs-group"
        data-show-all={showAll() || undefined}
      >
        <div data-slot="session-turn-diffs-header">
          <span data-slot="session-turn-diffs-label">
            {props.edited} {props.t("ui.sessionTurn.diffs.changed")}{" "}
            {props.t(props.edited === 1 ? "ui.common.file.one" : "ui.common.file.other")}
          </span>
          <DiffChanges changes={props.diffs} />
          <Show when={overflow() > 0}>
            <span data-slot="session-turn-diffs-toggle" onClick={toggleAll}>
              {showAll() ? props.t("ui.sessionTurn.diffs.showLess") : props.t("ui.sessionTurn.diffs.showAll")}
            </span>
          </Show>
        </div>
        <div data-component="session-turn-diffs-content">
          <Accordion
            multiple
            style={{ "--sticky-accordion-offset": "44px" }}
            value={expanded()}
            onChange={(value) => setState("expanded", Array.isArray(value) ? value : value ? [value] : [])}
          >
            <For each={views() ?? []}>
              {(diff, i) => {
                const view = diff
                const active = createMemo(() => expanded().includes(diff.file))
                const [shown, setShown] = createSignal(false)

                createEffect(
                  on(
                    active,
                    (value) => {
                      if (!value) {
                        setShown(false)
                        return
                      }

                      requestAnimationFrame(() => {
                        if (!active()) return
                        setShown(true)
                      })
                    },
                    { defer: true },
                  ),
                )

                return (
                  <Accordion.Item value={diff.file}>
                    <StickyAccordionHeader>
                      <Accordion.Trigger>
                        <div data-slot="session-turn-diff-trigger">
                          <span data-slot="session-turn-diff-path">
                            <Show when={diff.file.includes("/")}>
                              <span data-slot="session-turn-diff-directory">
                                {`\u202A${getDirectory(diff.file)}\u202C`}
                              </span>
                            </Show>
                            <span data-slot="session-turn-diff-filename">{getFilename(diff.file)}</span>
                          </span>
                          <div data-slot="session-turn-diff-meta">
                            <span data-slot="session-turn-diff-changes">
                              <DiffChanges changes={diff} />
                            </span>
                            <span data-slot="session-turn-diff-chevron">
                              <Icon name="chevron-down" size="small" />
                            </span>
                          </div>
                        </div>
                      </Accordion.Trigger>
                    </StickyAccordionHeader>
                    <Accordion.Content>
                      <Show when={shown()}>
                        <div data-slot="session-turn-diff-view" data-scrollable>
                          <Dynamic component={props.fileComponent} mode="diff" fileDiff={view.fileDiff} />
                        </div>
                      </Show>
                    </Accordion.Content>
                  </Accordion.Item>
                )
              }}
            </For>
          </Accordion>
          <Show when={!showAll() && overflow() > 0}>
            <div data-slot="session-turn-diffs-more" onClick={toggleAll}>
              {props.t("ui.sessionTurn.diffs.more", { count: String(overflow()) })}
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
