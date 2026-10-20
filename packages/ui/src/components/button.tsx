import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, Show, splitProps } from "solid-js"
import { Icon, IconProps } from "./icon"
import { Spinner } from "./spinner"

export interface ButtonProps
  extends ComponentProps<typeof Kobalte>,
    Pick<ComponentProps<"button">, "class" | "classList" | "children"> {
  size?: "small" | "normal" | "large"
  variant?: "primary" | "secondary" | "ghost"
  icon?: IconProps["name"]
  loading?: boolean
}

export function Button(props: ButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList", "loading", "disabled"])
  return (
    <Kobalte
      {...rest}
      disabled={split.disabled || split.loading}
      data-component="button"
      data-size={split.size || "normal"}
      data-variant={split.variant || "secondary"}
      data-icon={split.icon}
      data-loading={split.loading}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <Show when={split.loading}>
        <Spinner class="size-4" />
      </Show>
      <Show when={split.icon && !split.loading}>
        <Icon name={split.icon!} size="small" />
      </Show>
      {props.children}
    </Kobalte>
  )
}
