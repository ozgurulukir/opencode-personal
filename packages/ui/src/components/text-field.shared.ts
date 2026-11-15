import type { JSX } from "solid-js"

/**
 * Escape clears a clearable field instead of bubbling to the parent dialog.
 * Returns true when the field has a value and an onClear handler, meaning the
 * caller must stop propagation so the dialog does not close underneath.
 */
export function shouldClearOnEscape(key: string, hasOnClear: boolean, hasValue: boolean): boolean {
  return key === "Escape" && hasOnClear && hasValue
}

/**
 * Invokes a user-supplied onKeyDown, supporting SolidJS bound handler tuples
 * ([handler, argument]) in addition to plain functions.
 */
export function forwardKeyDown(
  onKeyDown: JSX.EventHandlerUnion<HTMLInputElement | HTMLTextAreaElement, KeyboardEvent> | undefined,
  e: KeyboardEvent,
) {
  if (typeof onKeyDown === "function") {
    onKeyDown(e as Parameters<typeof onKeyDown>[0])
  } else if (Array.isArray(onKeyDown)) {
    onKeyDown[0](onKeyDown[1], e as Parameters<(typeof onKeyDown)[0]>[1])
  }
}
