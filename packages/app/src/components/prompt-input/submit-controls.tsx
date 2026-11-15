import { Component, JSX } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ACCEPTED_FILE_TYPES } from "./files"

interface PromptSubmitControlsProps {
  space: string
  fileInputRef?: (el: HTMLInputElement) => void
  onAddFiles: (files: File[]) => void
  working: boolean
  blank: boolean
  stopping: boolean
  mode: "normal" | "shell"
  tip: JSX.Element
  buttonsSpring: number
  buttonsStyle: JSX.CSSProperties
  onPick: () => void
  t: (key: string) => string
  keybind: (id: string) => string | undefined
}

export const PromptSubmitControls: Component<PromptSubmitControlsProps> = (props) => {
  return (
    <>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 bottom-0"
        style={{
          height: props.space,
          background:
            "linear-gradient(to top, var(--surface-raised-stronger-non-alpha) calc(100% - 20px), transparent)",
        }}
      />

      <div class="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2">
        <input
          ref={props.fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILE_TYPES.join(",")}
          class="hidden"
          onChange={(e) => {
            const list = e.currentTarget.files
            if (list) props.onAddFiles(Array.from(list))
            e.currentTarget.value = ""
          }}
        />

        <div class="flex items-center gap-1 pointer-events-auto">
          <Tooltip placement="top" inactive={!props.working && props.blank} value={props.tip}>
            <IconButton
              data-action="prompt-submit"
              type="submit"
              disabled={!props.working && props.blank}
              tabIndex={props.mode === "normal" ? undefined : -1}
              icon={props.stopping ? "stop" : props.mode === "shell" ? "arrow-undo-down" : "arrow-up"}
              variant="primary"
              class="size-8"
              aria-label={props.stopping ? props.t("prompt.action.stop") : props.t("prompt.action.send")}
            />
          </Tooltip>
        </div>
      </div>

      <div class="pointer-events-none absolute bottom-2 left-2">
        <div
          aria-hidden={props.mode !== "normal"}
          class="pointer-events-auto"
          style={{
            "pointer-events": props.buttonsSpring > 0.5 ? "auto" : "none",
          }}
        >
          <TooltipKeybind
            placement="top"
            title={props.t("prompt.action.attachFile")}
            keybind={props.keybind("file.attach") ?? ""}
          >
            <IconButton
              data-action="prompt-attach"
              type="button"
              icon="plus"
              variant="ghost"
              class="size-8 p-0"
              style={props.buttonsStyle}
              onClick={props.onPick}
              disabled={props.mode !== "normal"}
              tabIndex={props.mode === "normal" ? undefined : -1}
              aria-label={props.t("prompt.action.attachFile")}
              iconSize="normal"
            />
          </TooltipKeybind>
        </div>
      </div>
    </>
  )
}
