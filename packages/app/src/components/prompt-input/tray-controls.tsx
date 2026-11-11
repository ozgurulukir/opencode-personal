import { Show, createMemo } from "solid-js"
import type { JSX } from "solid-js"
import { useQueries } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Select } from "@opencode-ai/ui/select"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { useCommand } from "@/context/command"
import { loadAgentsQuery, loadProvidersQuery } from "@/context/global-sync/bootstrap"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useProviders } from "@/hooks/use-providers"
import { useSDK } from "@/context/sdk"

export function TrayControls(props: {
  mode: () => "normal" | "shell"
  controlStyle: () => JSX.CSSProperties
  onRestoreFocus: () => void
}) {
  const sdk = useSDK()
  const globalSDK = useGlobalSDK()
  const local = useLocal()
  const providers = useProviders()
  const dialog = useDialog()
  const command = useCommand()
  const language = useLanguage()

  const agentNames = createMemo(() => local.agent.list().map((agent) => agent.name))
  const variants = createMemo(() => ["default", ...local.model.variant.list()])

  const [agentsQuery, globalProvidersQuery, providersQuery] = useQueries(() => ({
    queries: [
      loadAgentsQuery(sdk.directory, sdk.client),
      loadProvidersQuery(null, globalSDK.client),
      loadProvidersQuery(sdk.directory, sdk.client),
    ],
  }))

  const agentsLoading = () => agentsQuery.isLoading
  const agentsShouldFadeIn = createMemo((prev) => prev ?? agentsLoading())
  const providersLoading = () => agentsLoading() || providersQuery.isLoading || globalProvidersQuery.isLoading
  const providersShouldFadeIn = createMemo((prev) => prev ?? providersLoading())

  return (
    <div class="flex items-center gap-1.5 min-w-0 flex-1 h-7">
      <Show when={!agentsLoading()}>
        <div
          data-component="prompt-agent-control"
          style={agentsShouldFadeIn() ? { animation: "fade-in 0.3s" } : undefined}
        >
          <TooltipKeybind
            placement="top"
            gutter={4}
            title={language.t("command.agent.cycle")}
            keybind={command.keybind("agent.cycle")}
          >
            <Select
              size="normal"
              options={agentNames()}
              current={local.agent.current()?.name ?? ""}
              onSelect={(value) => {
                local.agent.set(value)
                props.onRestoreFocus()
              }}
              class="capitalize max-w-[160px] text-text-base"
              valueClass="truncate text-13-regular text-text-base"
              triggerStyle={props.controlStyle()}
              triggerProps={{ "data-action": "prompt-agent" }}
              variant="ghost"
            />
          </TooltipKeybind>
        </div>
      </Show>
      <Show when={!providersLoading()}>
        <Show when={props.mode() !== "shell"}>
          <div
            data-component="prompt-model-control"
            style={providersShouldFadeIn() ? { animation: "fade-in 0.3s" } : undefined}
          >
            <Show
              when={providers.paid().length > 0}
              fallback={
                <TooltipKeybind
                  placement="top"
                  gutter={4}
                  title={language.t("command.model.choose")}
                  keybind={command.keybind("model.choose")}
                >
                  <Button
                    data-action="prompt-model"
                    as="div"
                    variant="ghost"
                    size="normal"
                    class="min-w-0 max-w-[320px] text-13-regular text-text-base group"
                    style={props.controlStyle()}
                    onClick={() => {
                      void import("@/components/dialog-select-model-unpaid").then((x) => {
                        dialog.show(() => <x.DialogSelectModelUnpaid model={local.model} />)
                      })
                    }}
                  >
                    <Show when={local.model.current()?.provider?.id}>
                      <ProviderIcon
                        id={local.model.current()?.provider?.id ?? ""}
                        class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                        style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                      />
                    </Show>
                    <span class="truncate">
                      {local.model.current()?.name ?? language.t("dialog.model.select.title")}
                    </span>
                    <Icon name="chevron-down" size="small" class="shrink-0" />
                  </Button>
                </TooltipKeybind>
              }
            >
              <TooltipKeybind
                placement="top"
                gutter={4}
                title={language.t("command.model.choose")}
                keybind={command.keybind("model.choose")}
              >
                <ModelSelectorPopover
                  model={local.model}
                  triggerAs={Button}
                  triggerProps={{
                    variant: "ghost",
                    size: "normal",
                    style: props.controlStyle(),
                    class: "min-w-0 max-w-[320px] text-13-regular text-text-base group",
                    "data-action": "prompt-model",
                  }}
                  onClose={props.onRestoreFocus}
                >
                  <Show when={local.model.current()?.provider?.id}>
                    <ProviderIcon
                      id={local.model.current()?.provider?.id ?? ""}
                      class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                      style={{ "will-change": "opacity", transform: "translateZ(0)" }}
                    />
                  </Show>
                  <span class="truncate">
                    {local.model.current()?.name ?? language.t("dialog.model.select.title")}
                  </span>
                  <Icon name="chevron-down" size="small" class="shrink-0" />
                </ModelSelectorPopover>
              </TooltipKeybind>
            </Show>
          </div>
          <Show when={variants().length > 2}>
            <div
              data-component="prompt-variant-control"
              style={providersShouldFadeIn() ? { animation: "fade-in 0.3s" } : undefined}
            >
              <TooltipKeybind
                placement="top"
                gutter={4}
                title={language.t("command.model.variant.cycle")}
                keybind={command.keybind("model.variant.cycle")}
              >
                <Select
                  size="normal"
                  options={variants()}
                  current={local.model.variant.current() ?? "default"}
                  label={(x) => (x === "default" ? language.t("common.default") : x)}
                  onSelect={(value) => {
                    local.model.variant.set(value === "default" ? undefined : value)
                    props.onRestoreFocus()
                  }}
                  class="capitalize max-w-[160px] text-text-base"
                  valueClass="truncate text-13-regular text-text-base"
                  triggerStyle={props.controlStyle()}
                  triggerProps={{ "data-action": "prompt-model-variant" }}
                  variant="ghost"
                />
              </TooltipKeybind>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  )
}
