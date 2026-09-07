import { TextField as Kobalte } from "@kobalte/core/text-field"
import { createSignal, Show, splitProps } from "solid-js"
import type { ComponentProps } from "solid-js"
import { useI18n } from "../context/i18n"
import { IconButton } from "./icon-button"
import { Tooltip } from "./tooltip"

export interface TextFieldProps
  extends
    ComponentProps<typeof Kobalte.Input>,
    Partial<
      Pick<
        ComponentProps<typeof Kobalte>,
        | "name"
        | "defaultValue"
        | "value"
        | "onChange"
        | "onKeyDown"
        | "validationState"
        | "required"
        | "disabled"
        | "readOnly"
      >
    > {
  label?: string
  hideLabel?: boolean
  description?: string
  error?: string
  variant?: "normal" | "ghost"
  copyable?: boolean
  copyKind?: "clipboard" | "link"
  multiline?: boolean
  autofocus?: boolean
  onClear?: () => void
}

export function TextField(props: TextFieldProps) {
  const i18n = useI18n()
  const [local, others] = splitProps(props, [
    "name",
    "defaultValue",
    "value",
    "onChange",
    "onKeyDown",
    "validationState",
    "required",
    "disabled",
    "readOnly",
    "class",
    "label",
    "hideLabel",
    "description",
    "error",
    "variant",
    "copyable",
    "copyKind",
    "multiline",
    "autofocus",
    "onClear",
  ])
  const [copied, setCopied] = createSignal(false)
  let inputRef: HTMLInputElement | HTMLTextAreaElement | undefined

  const label = () => {
    if (copied()) return i18n.t("ui.textField.copied")
    if (local.copyKind === "link") return i18n.t("ui.textField.copyLink")
    return i18n.t("ui.textField.copyToClipboard")
  }

  const icon = () => {
    if (copied()) return "check"
    if (local.copyKind === "link") return "link"
    return "copy"
  }

  async function handleCopy() {
    const value = local.value ?? local.defaultValue ?? ""
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleClick() {
    if (local.copyable) void handleCopy()
  }

  function handleClear() {
    local.onClear?.()
    inputRef?.focus()
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && local.onClear && (local.value || inputRef?.value)) {
      e.preventDefault()
      e.stopPropagation()
      handleClear()
      return
    }

    if (typeof local.onKeyDown === "function") {
      local.onKeyDown(e)
    } else if (Array.isArray(local.onKeyDown)) {
      // SolidJS bound event handler tuple: [handler, argument]
      local.onKeyDown[0](local.onKeyDown[1], e)
    }
  }

  return (
    <Kobalte
      data-component="input"
      data-variant={local.variant || "normal"}
      name={local.name}
      defaultValue={local.defaultValue}
      value={local.value}
      onChange={local.onChange}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      required={local.required}
      disabled={local.disabled}
      readOnly={local.readOnly}
      validationState={local.validationState}
    >
      <Show when={local.label}>
        <Kobalte.Label data-slot="input-label" classList={{ "sr-only": local.hideLabel }}>
          {local.label}
        </Kobalte.Label>
      </Show>
      <div data-slot="input-wrapper">
        <Show
          when={local.multiline}
          fallback={
            <Kobalte.Input
              {...others}
              autofocus={local.autofocus}
              ref={(el: HTMLInputElement) => (inputRef = el)}
              data-slot="input-input"
              class={local.class}
            />
          }
        >
          <Kobalte.TextArea
            {...others}
            autoResize
            autofocus={local.autofocus}
            ref={(el: HTMLTextAreaElement) => (inputRef = el)}
            data-slot="input-input"
            class={local.class}
          />
        </Show>
        <Show when={local.copyable}>
          <Tooltip value={label()} placement="top" gutter={4} forceOpen={copied()} skipDelayDuration={0}>
            <IconButton
              type="button"
              icon={icon()}
              variant="ghost"
              onClick={handleCopy}

              data-slot="input-copy-button"
              aria-label={label()}
            />
          </Tooltip>
        </Show>
        <Show when={local.onClear && !!local.value}>
          <IconButton
            type="button"
            icon="circle-x"
            variant="ghost"
            onClick={handleClear}
            tabIndex={-1}
            data-slot="input-clear-button"
            aria-label={i18n.t("common.clear")}
          />
        </Show>
      </div>
      <Show when={local.description}>
        <Kobalte.Description data-slot="input-description">{local.description}</Kobalte.Description>
      </Show>
      <Kobalte.ErrorMessage data-slot="input-error">{local.error}</Kobalte.ErrorMessage>
    </Kobalte>
  )
}
